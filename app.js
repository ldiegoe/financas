// ===========================================================================
// Finanças — PWA de controle financeiro pessoal
// Stack: vanilla JS + localStorage + Chart.js (CDN)
// ===========================================================================

// --------------------------- DB --------------------------------------------
const PROFILES_KEY     = 'financas:profiles';
const PROFILE_PREFIX   = 'financas:profile:';
const DEVICE_CONFIG_KEY = 'financas:device-config';
const LEGACY_KEY       = 'financas:v1';

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

const defaultCategorias = () => [
  { id: uid(), nome: 'Alimentação', cor: '#FF6B6B', meta: null },
  { id: uid(), nome: 'Transporte',  cor: '#4ECDC4', meta: null },
  { id: uid(), nome: 'Moradia',     cor: '#FFD93D', meta: null },
  { id: uid(), nome: 'Lazer',       cor: '#95E1D3', meta: null },
  { id: uid(), nome: 'Saúde',       cor: '#A8E6CF', meta: null },
  { id: uid(), nome: 'Outros',      cor: '#C9C9C9', meta: null },
];

const defaultState = () => ({
  version: 1,
  rendas: [],
  despesas: [],
  categorias: defaultCategorias(),
  objetivos: [],
  config: { moeda: 'BRL' },
});

// Cada perfil tem dados/categorias proprios em storage separado. O bloqueio
// continua device-wide (em lockStore). Configs visuais (tema, textSize,
// dashboard prefs) tambem ficam device-wide via DEVICE_CONFIG_KEY pra
// trocar de perfil nao bagunçar a aparencia.
const profileStore = {
  meta() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || null; }
    catch { return null; }
  },
  setMeta(m) { localStorage.setItem(PROFILES_KEY, JSON.stringify(m)); },
  loadState(id) {
    try {
      const raw = localStorage.getItem(`${PROFILE_PREFIX}${id}`);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch { return defaultState(); }
  },
  saveState(id, s) { localStorage.setItem(`${PROFILE_PREFIX}${id}`, JSON.stringify(s)); },
  removeState(id) { localStorage.removeItem(`${PROFILE_PREFIX}${id}`); },
};

// Migracao: usuarios antigos tem state em LEGACY_KEY. Vira o perfil "Pessoal"
// automaticamente sem perder nada. LEGACY_KEY fica como salvaguarda (pode ser
// limpado manualmente em "Apagar tudo" depois).
const initProfiles = () => {
  let meta = profileStore.meta();
  if (!meta || !Array.isArray(meta.list) || meta.list.length === 0) {
    const id = uid();
    meta = { list: [{ id, name: 'Pessoal' }], current: id };
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) localStorage.setItem(`${PROFILE_PREFIX}${id}`, legacy);
    profileStore.setMeta(meta);
  }
  if (!meta.list.find(p => p.id === meta.current)) {
    meta.current = meta.list[0].id;
    profileStore.setMeta(meta);
  }
  return meta;
};

const _profilesMeta = initProfiles();
let activeProfileId = _profilesMeta.current;

// Chaves de config que valem pro dispositivo todo (compartilhadas entre
// perfis). Demais chaves de config (ex.: lastBackupAt) ficam por perfil.
const DEVICE_CONFIG_KEYS = [
  'tema','textSize','valuesHidden','backupReminderDays',
  'dashCompareShow','dashBarsShow','dashTagShow','dashUpcomingShow','dashGoalsShow','dashHealthShow','dashCollapsed',
  // Por grafico (investimentos) — card proprio no dashboard
  'dashInvestShow','dashInvestDonutShow','dashInvestDonutType','dashInvestDonutInnerPct','dashInvestListShow','dashInvestListPct',
  'onboardingDone','showCategoryIcons',
  // Legacy (fallback): aplicado quando ainda nao existem as chaves namespaced
  'dashDonutShow','dashDonutType','dashDonutInnerPct','dashListShow','dashListPct',
  // Por grafico (categoria)
  'dashCatDonutShow','dashCatDonutType','dashCatDonutInnerPct','dashCatListShow','dashCatListPct',
  // Por grafico (tag) — inclui o modo de contagem multi-tag
  'dashTagDonutShow','dashTagDonutType','dashTagDonutInnerPct','dashTagListShow','dashTagListPct',
  'dashTagSplit',
];

// Le config namespaced (dashCatDonutShow, dashTagDonutType, ...) com fallback
// pra chave legacy (dashDonutShow, dashDonutType, ...). Mantem compatibilidade
// com configs ja salvas antes do split categoria/tag.
const cfg = (suffix, prefix) => {
  const ns = state.config[`dash${prefix}${suffix}`];
  if (ns !== undefined) return ns;
  return state.config[`dash${suffix}`];
};
const deviceConfigGet = () => {
  try { return JSON.parse(localStorage.getItem(DEVICE_CONFIG_KEY)) || {}; }
  catch { return {}; }
};
const deviceConfigUpdate = (patch) => {
  localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify({ ...deviceConfigGet(), ...patch }));
};

// Sobrepoe config device-wide sobre a config-do-perfil pra manter aparencia
// consistente ao trocar de perfil/resetar/importar.
const applyDeviceOverlay = (s) => {
  const dev = deviceConfigGet();
  for (const k of DEVICE_CONFIG_KEYS) {
    if (dev[k] !== undefined) s.config[k] = dev[k];
  }
  return s;
};

const isoToDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const yyyyMmFromDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

// Migracao do pago/pendente: rodada na carga do state. Despesas existentes
// nao tem o campo `pago` (nao-recorrentes) nem `pagasEm` (recorrentes/parc).
// Comportamento atual eh "tudo conta como gasto", entao migracao trata tudo
// como pago: nao-recorrentes ganham pago=true; recorrentes/parc ganham
// pagasEm preenchido com todos os meses de data inicial ate o mes corrente
// (limitado pelo numero de parcelas pra parceladas). Apenas roda quando os
// campos ainda nao existem.
const migratePago = (s) => {
  let migrated = false;
  for (const d of s.despesas) {
    const isRecurring = !!d.recorrente;
    const isInstallment = (d.parcelas || 0) > 1;
    if (!isRecurring && !isInstallment) {
      if (d.pago === undefined) { d.pago = true; migrated = true; }
    } else {
      if (d.pagasEm === undefined) {
        const start = isoToDate(d.data);
        const now = new Date();
        const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
        const limitMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const months = [];
        let cur = new Date(startMonth);
        let count = 0;
        while (cur <= limitMonth) {
          if (isInstallment && count >= d.parcelas) break;
          months.push(yyyyMmFromDate(cur));
          cur.setMonth(cur.getMonth() + 1);
          count++;
        }
        d.pagasEm = months;
        migrated = true;
      }
    }
    // criadoEm: data de cadastro (imutavel). Para despesas antigas sem o
    // campo, usa o `data` como aproximacao — nao temos historico melhor.
    if (d.criadoEm === undefined) { d.criadoEm = d.data; migrated = true; }
  }
  return migrated;
};

let state = (function load() {
  const s = profileStore.loadState(activeProfileId);
  if (migratePago(s)) profileStore.saveState(activeProfileId, s);
  return applyDeviceOverlay(s);
})();

const persist = () => {
  profileStore.saveState(activeProfileId, state);
  document.dispatchEvent(new CustomEvent('db:changed'));
};

// Atualiza config do estado: salva no perfil ativo e tambem espelha chaves
// device-wide no storage proprio. Use isso em vez de mexer state.config direto.
const updateConfig = (patch) => {
  state.config = { ...state.config, ...patch };
  persist();
  const devicePatch = {};
  for (const k of DEVICE_CONFIG_KEYS) {
    if (k in patch) devicePatch[k] = patch[k];
  }
  if (Object.keys(devicePatch).length) deviceConfigUpdate(devicePatch);
};

// --------------------------- Profiles --------------------------------------
const switchProfile = (id) => {
  const meta = profileStore.meta();
  if (!meta.list.find(p => p.id === id) || id === meta.current) return;
  meta.current = id;
  profileStore.setMeta(meta);
  location.reload();
};

const createProfile = (name) => {
  const meta = profileStore.meta();
  const id = uid();
  meta.list.push({ id, name });
  meta.current = id;
  profileStore.setMeta(meta);
  profileStore.saveState(id, defaultState());
  location.reload();
};

const renameProfile = (id, name) => {
  const meta = profileStore.meta();
  const p = meta.list.find(x => x.id === id);
  if (!p) return;
  p.name = name;
  profileStore.setMeta(meta);
};

const deleteProfileById = (id) => {
  const meta = profileStore.meta();
  if (meta.list.length <= 1 || id === meta.current) return;
  meta.list = meta.list.filter(x => x.id !== id);
  profileStore.setMeta(meta);
  profileStore.removeState(id);
};

const currentProfileName = () => {
  const meta = profileStore.meta();
  const p = meta.list.find(x => x.id === meta.current);
  return p ? p.name : '';
};

const db = {
  get state() { return state; },

  addRenda(r)     { state.rendas.push({ id: uid(), ...r }); persist(); },
  updateRenda(id, patch) {
    const i = state.rendas.findIndex(x => x.id === id);
    if (i >= 0) { state.rendas[i] = { ...state.rendas[i], ...patch }; persist(); }
  },
  removeRenda(id) { state.rendas = state.rendas.filter(x => x.id !== id); persist(); },

  addDespesa(d)   { state.despesas.push({ id: uid(), criadoEm: todayISO(), ...d }); persist(); },
  updateDespesa(id, patch) {
    const i = state.despesas.findIndex(x => x.id === id);
    if (i >= 0) { state.despesas[i] = { ...state.despesas[i], ...patch }; persist(); }
  },
  removeDespesa(id) { state.despesas = state.despesas.filter(x => x.id !== id); persist(); },

  addCategoria(c) { state.categorias.push({ id: uid(), meta: null, ...c }); persist(); },
  updateCategoria(id, patch) {
    const i = state.categorias.findIndex(x => x.id === id);
    if (i >= 0) { state.categorias[i] = { ...state.categorias[i], ...patch }; persist(); }
  },
  removeCategoria(id) {
    // Mantém integridade: despesas dessa categoria viram "sem categoria" e os
    // objetivos param de contar essa categoria.
    state.despesas = state.despesas.map(d =>
      d.categoriaId === id ? { ...d, categoriaId: null } : d
    );
    state.objetivos = (state.objetivos || []).map(o =>
      ({ ...o, categoriaIds: (o.categoriaIds || []).filter(c => c !== id) })
    );
    state.categorias = state.categorias.filter(x => x.id !== id);
    persist();
  },
  // Reordena a lista inteira a partir de uma sequencia de ids. A ordem do
  // array de categorias eh usada em todas as telas (combo de despesas, donut,
  // etc), entao o drag-and-drop chama isso ao soltar.
  reorderCategorias(orderedIds) {
    const byId = new Map(state.categorias.map(c => [c.id, c]));
    state.categorias = orderedIds.map(id => byId.get(id));
    persist();
  },

  addObjetivo(o) { state.objetivos.push({ id: uid(), ...o }); persist(); },
  updateObjetivo(id, patch) {
    const i = state.objetivos.findIndex(x => x.id === id);
    if (i >= 0) { state.objetivos[i] = { ...state.objetivos[i], ...patch }; persist(); }
  },
  removeObjetivo(id) { state.objetivos = state.objetivos.filter(x => x.id !== id); persist(); },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
    state = applyDeviceOverlay({ ...defaultState(), ...parsed });
    persist();
  },
  reset() { state = applyDeviceOverlay(defaultState()); persist(); },
};

// --------------------------- Utils -----------------------------------------
const APP_VERSION = '1.5';

// Quando o usuario ativa "Ocultar valores", todo R$ que aparece via fmtBRL
// vira mascara — facilita compartilhar a tela sem revelar saldo.
const fmtBRL = (cents) => {
  if (state && state.config && state.config.valuesHidden) return 'R$ ••••';
  return ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// "12345" centavos -> "123,45"  |  "1234567" -> "12.345,67"
const formatCentsDisplay = (cents) => {
  if (!cents) return '';
  const reais = Math.floor(cents / 100);
  const c2    = String(cents % 100).padStart(2, '0');
  return `${reais.toLocaleString('pt-BR')},${c2}`;
};

// Faz o input se comportar como campo de moeda (estilo Nubank): cada dígito
// digitado entra pela direita como centavo, separadores são re-aplicados.
const bindCurrencyInput = (input) => {
  const reformat = () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) { input.value = ''; return; }
    input.value = formatCentsDisplay(parseInt(digits, 10));
    // cursor sempre no fim para o padrão "digitar da direita p/ esquerda"
    requestAnimationFrame(() => {
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch {}
    });
  };
  input.addEventListener('input', reformat);
  // Bloqueia teclas que não façam sentido (deixa só dígitos, backspace, navegação)
  input.addEventListener('keydown', (e) => {
    const ok = /^[0-9]$/.test(e.key) || ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key) || e.metaKey || e.ctrlKey;
    if (!ok) e.preventDefault();
  });
};

// "1.234,56" / "1234,56" / "1234.56" / "1234" -> integer cents
const parseAmount = (s) => {
  if (s == null || s === '') return 0;
  let str = String(s).trim().replace(/\s/g, '');
  if (str.includes(',')) {
    // Convenção pt-BR: vírgula é decimal, ponto é separador de milhar
    str = str.replace(/\./g, '').replace(',', '.');
  }
  // Sem vírgula: ponto vira decimal natural ("123.45")
  const n = parseFloat(str);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
};

const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const monthName = (m, short = false) => {
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const sht   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return (short ? sht : names)[m - 1];
};

// Period filter helpers
const partsOf = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return { y, m, q: Math.floor((m - 1) / 3) + 1, s: m <= 6 ? 1 : 2 };
};

const periodMatches = (iso, period) => {
  const { y, m, q, s } = partsOf(iso);
  if (period.year !== y) return false;
  if (period.type === 'year') return true;
  if (period.type === 'month') return m === period.value;
  if (period.type === 'quarter') return q === period.value;
  if (period.type === 'semester') return s === period.value;
  return true;
};

// Expande lançamentos para o período pedido considerando:
//  - recorrentes (recorrente=true): repete todo mês indefinidamente a partir da data
//  - parcelados (parcelas>1): repete por N meses consecutivos e encerra
//  - únicos: aparecem só na data exata
// Ocorrências projetadas (não a original) ganham _virtual=true para a UI.
const expandWithRecurring = (items, period) => {
  const out = [];
  for (const it of items) {
    const parcelas = it.parcelas && it.parcelas > 1 ? it.parcelas : 0;
    const isRecurring = !!it.recorrente;
    const isInstallment = parcelas > 1;
    // Rendas temporárias: recorrente com duração definida (ex.: seguro-desemprego
    // por 4 meses). Encerra após `duracaoMeses` ocorrências a partir da data.
    const recDur = (isRecurring && it.duracaoMeses && it.duracaoMeses > 0) ? it.duracaoMeses : 0;

    if (!isRecurring && !isInstallment) {
      if (periodMatches(it.data, period)) out.push({ ...it, _virtual: false, _pago: it.pago === true });
      continue;
    }

    const start = partsOf(it.data);
    const day = parseInt(it.data.split('-')[2], 10);
    const months = monthsInPeriod(period);
    const pagasEm = it.pagasEm || [];

    for (const { y, m } of months) {
      const monthsFromStart = (y - start.y) * 12 + (m - start.m);
      if (monthsFromStart < 0) continue;
      if (isInstallment && monthsFromStart >= parcelas) continue;
      if (recDur && monthsFromStart >= recDur) continue;

      const projectedDay = clampDay(y, m, day);
      const yyyyMm = `${y}-${String(m).padStart(2,'0')}`;
      const iso = `${yyyyMm}-${String(projectedDay).padStart(2,'0')}`;
      const isOriginal = (y === start.y && m === start.m);
      const occ = { ...it, data: iso, _virtual: !isOriginal, _pago: pagasEm.includes(yyyyMm) };
      if (isInstallment) {
        occ._parcelaNum = monthsFromStart + 1;
        occ._parcelaTotal = parcelas;
      }
      out.push(occ);
    }
  }
  return out;
};

const monthsInPeriod = (period) => {
  const y = period.year;
  if (period.type === 'year') return Array.from({length:12}, (_,i)=>({y, m:i+1}));
  if (period.type === 'month') return [{ y, m: period.value }];
  if (period.type === 'quarter') {
    const start = (period.value - 1) * 3 + 1;
    return [start, start+1, start+2].map(m => ({ y, m }));
  }
  if (period.type === 'semester') {
    const start = period.value === 1 ? 1 : 7;
    return Array.from({length: 6}, (_,i) => ({ y, m: start + i }));
  }
  return [];
};

const clampDay = (y, m, d) => {
  const last = new Date(y, m, 0).getDate();
  return Math.min(d, last);
};

const sumAmount = (arr) => arr.reduce((acc, x) => acc + (x.valor || 0), 0);

// Metas configuráveis do painel de saúde financeira (Ajustes). Os defaults
// reproduzem os valores fixos originais. Clamp evita limiares quebrados.
const HEALTH_META_DEFAULTS = { invest: 20, gastos: 70, fixo: 50, reserva: 6 };
const healthMetas = () => {
  const cfg = state.config || {};
  const pick = (v, d, max) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? Math.min(n, max) : d;
  };
  return {
    invest:  pick(cfg.healthMetaInvest,  HEALTH_META_DEFAULTS.invest,  100),
    gastos:  pick(cfg.healthMetaGastos,  HEALTH_META_DEFAULTS.gastos,  100),
    fixo:    pick(cfg.healthMetaFixo,    HEALTH_META_DEFAULTS.fixo,    100),
    reserva: pick(cfg.healthMetaReserva, HEALTH_META_DEFAULTS.reserva, 60),
  };
};

// --------------------------- Objetivos (calculos) --------------------------
// Soma de despesas (expandindo recorrentes/parceladas) nas categorias do
// idSet, com data <= hoje e >= `desde` se definido. Itera ano a ano da
// despesa mais antiga relevante ate o ano corrente. Base do progresso de
// objetivos e do "reserva acumulada" no painel de saude.
const sumCategoriasAteHoje = (idSet, desde) => {
  if (idSet.size === 0) return 0;
  const relevantes = state.despesas.filter(d => idSet.has(d.categoriaId));
  if (relevantes.length === 0) return 0;
  const today = todayISO();
  const startYear = Math.min(...relevantes.map(d => parseInt(d.data.slice(0, 4), 10)));
  const endYear = new Date().getFullYear();
  let total = 0;
  for (let y = startYear; y <= endYear; y++) {
    for (const d of expandWithRecurring(state.despesas, { type: 'year', year: y })) {
      if (!idSet.has(d.categoriaId)) continue;
      if (d.data > today) continue;
      if (desde && d.data < desde) continue;
      total += d.valor || 0;
    }
  }
  return total;
};

// Quanto ja foi acumulado nas categorias linkadas a um objetivo.
const objetivoAtual = (o) => sumCategoriasAteHoje(new Set(o.categoriaIds || []), o.desde);

// Ocorrencias pendentes pro card Vencimentos: proximos 14 dias + atrasadas ate
// 30 dias. Atrasadas primeiro (recente->antiga), depois proximas (cedo->tarde).
// Cada item ganha _overdue. Compartilhado entre render e handlers de selecao.
const upcomingItems = () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const horizon = new Date(today); horizon.setDate(today.getDate() + 14);
  const overdueLimit = new Date(today); overdueLimit.setDate(today.getDate() - 30);
  const pv = new Date(today); pv.setMonth(pv.getMonth() - 1);
  const nx = new Date(today); nx.setMonth(nx.getMonth() + 1);
  const periods = [
    { type: 'month', year: pv.getFullYear(),    value: pv.getMonth() + 1 },
    { type: 'month', year: today.getFullYear(), value: today.getMonth() + 1 },
    { type: 'month', year: nx.getFullYear(),    value: nx.getMonth() + 1 },
  ];
  return periods.flatMap(p => expandWithRecurring(state.despesas, p))
    .filter(d => !d._pago)
    .filter(d => {
      const dt = isoToDate(d.data); dt.setHours(0,0,0,0);
      return dt >= overdueLimit && dt <= horizon;
    })
    .map(d => {
      const dt = isoToDate(d.data); dt.setHours(0,0,0,0);
      return { ...d, _overdue: dt < today };
    })
    .sort((a, b) => {
      if (a._overdue !== b._overdue) return a._overdue ? -1 : 1;
      return a._overdue ? b.data.localeCompare(a.data) : a.data.localeCompare(b.data);
    })
    .slice(0, 12);
};

// Marca uma lista de ocorrencias como pagas (recorrente/parcelada: adiciona o
// YYYY-MM em pagasEm; unica: pago=true). Usado pela selecao em lote do card.
const marcarOcorrenciasPagas = (occs) => {
  for (const occ of occs) {
    const base = state.despesas.find(x => x.id === occ.id);
    if (!base) continue;
    const isRecurring = !!base.recorrente;
    const isInstallment = (base.parcelas || 0) > 1;
    if (!isRecurring && !isInstallment) {
      db.updateDespesa(occ.id, { pago: true });
    } else {
      const yyyyMm = occ.data.slice(0, 7);
      const pagasEm = [...(base.pagasEm || [])];
      if (!pagasEm.includes(yyyyMm)) pagasEm.push(yyyyMm);
      db.updateDespesa(occ.id, { pagasEm });
    }
  }
};

// Resumo de tags pra exibir inline (compacto): "#primeira +N". '' se nao houver.
const tagsInline = (tags) => {
  if (!tags || tags.length === 0) return '';
  const first = `#${escapeHTML(tags[0])}`;
  return tags.length > 1 ? `${first} +${tags.length - 1}` : first;
};

// Media mensal de aporte nas categorias do objetivo nos 3 meses completos
// anteriores (exclui o mes corrente parcial). 0 se nada nesse periodo.
const objetivoRitmo = (o) => {
  const idSet = new Set(o.categoriaIds || []);
  if (idSet.size === 0) return 0;
  const now = new Date();
  let soma = 0;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    for (const occ of expandWithRecurring(state.despesas, { type: 'month', year: d.getFullYear(), value: d.getMonth() + 1 })) {
      if (!idSet.has(occ.categoriaId)) continue;
      if (o.desde && occ.data < o.desde) continue;
      soma += occ.valor || 0;
    }
  }
  return Math.round(soma / 3);
};

// Meses inteiros de hoje (mes corrente) ate uma data ISO. >= 0.
const monthsUntil = (iso) => {
  const t = isoToDate(iso);
  const now = new Date();
  return Math.max(0, (t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth()));
};

// Normaliza string de tags vinda do form: "Mercado, viagem, viagem" -> ["Mercado","viagem"]
const parseTags = (str) => {
  if (!str) return [];
  const seen = new Set();
  return String(str)
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .filter(t => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
};

// Lista única de tags já usadas no banco (para datalist + filtro)
const allTags = () => {
  const set = new Map(); // key=lower, value=label original
  for (const d of state.despesas) {
    for (const t of (d.tags || [])) {
      const k = t.toLowerCase();
      if (!set.has(k)) set.set(k, t);
    }
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
};

// Cabecalho colapsavel pros cards do dashboard. Retorna o <h2> com chevron;
// o body do card eh renderizado condicionalmente pelo caller via isCollapsed.
const isCollapsed = (key) => !!(state.config.dashCollapsed || {})[key];
const collapseHeader = (key, title) => `
  <h2 class="collapsible-h" data-collapse="${key}">
    <span>${escapeHTML(title)}</span>
    <svg class="chevron ${isCollapsed(key)?'collapsed':''}" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
      <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </h2>`;

// Sub-secao colapsavel dentro de um card (usada pra organizar "Personalizar
// dashboard"). Reaproveita o mesmo mecanismo de collapse (dashCollapsed).
const subSection = (key, title, contentHtml) => {
  const col = isCollapsed(key);
  return `
    <div class="subsection">
      <div class="subsection-h" data-collapse="${key}">
        <span>${escapeHTML(title)}</span>
        <svg class="chevron ${col?'collapsed':''}" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
          <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      ${col ? '' : `<div class="subsection-body">${contentHtml}</div>`}
    </div>`;
};

// Cores das tags sao geradas dinamicamente em HSL (nao da paleta fixa) — tags
// crescem sem limite, entao precisam de cores ilimitadas. Cada tag pega o
// matiz do hash do nome (estavel entre renders); se cair perto demais (<24deg)
// de um matiz ja usado nesta render, pula pelo angulo dourado (137.5deg) ate
// achar um espaco distante. "_sem" (sem tag) sempre cinza.
const assignTagColors = (sortedTags) => {
  const usedHues = [];
  const tooClose = (h) => usedHues.some(u => { const d = Math.abs(h - u); return Math.min(d, 360 - d) < 24; });
  return sortedTags.map(t => {
    if (t.id === '_sem') return { ...t, cor: '#999' };
    let n = 0;
    for (let i = 0; i < t.id.length; i++) n = (n * 31 + t.id.charCodeAt(i)) | 0;
    let hue = Math.abs(n) % 360;
    let tries = 0;
    while (tooClose(hue) && tries < 30) { hue = (hue + 137.508) % 360; tries++; }
    usedHues.push(hue);
    return { ...t, cor: `hsl(${Math.round(hue)}, 65%, 58%)` };
  });
};

// Biblioteca de icones SVG estilo Lucide (linha fina, currentColor). Centraliza
// pra manter consistencia visual em vez de mistura de emojis com SVG inline.
const ICONS = {
  // Tabbar
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  wallet:    '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  card:      '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  tag:       '<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  settings:  '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  // Empty states e diversos
  inbox:     '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sparkles:  '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/>',
  lock:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield:    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  target:    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  clock:     '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trending:  '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
};

const icon = (name, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// Se os emojis das categorias devem ser exibidos (toggle em Ajustes > Aparencia).
// Default true. Quando false, mostra so a cor (swatch) em todo lugar.
const iconsEnabled = () => state.config.showCategoryIcons !== false;
// Retorna o emoji da categoria SE habilitado, senao string vazia — usado pra
// decidir entre emoji vs swatch nos diversos lugares de exibicao.
const catEmoji = (c) => (iconsEnabled() && c && c.icone) ? c.icone : '';

// 'system' (padrão) | 'light' | 'dark'. Atributo data-theme no <html> é
// quem comanda o CSS; ausência do atributo = seguir sistema operacional.
const applyTheme = (tema) => {
  if (tema === 'light' || tema === 'dark') {
    document.documentElement.setAttribute('data-theme', tema);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

// --------------------------- Alertas / Notificacoes ------------------------
// Computa alertas ativos sobre o estado atual:
//   - Meta de categoria perto (>=80%) ou estourada (>=100%)
//   - Saldo do mes baixo (<10% da renda) ou negativo
//   - Lancamentos previstos pros proximos 7 dias
// Cada alerta tem um id estavel — quando o usuario dispensa, o id vai pro
// state.dismissedAlerts e nao reaparece. Se a condicao mudar de severidade
// (ex: warn → over), o id muda e um novo alerta surge.
const computeAlerts = () => {
  const alerts = [];
  const now = new Date();
  const cur = { type: 'month', year: now.getFullYear(), value: now.getMonth() + 1 };
  const periodKey = `${cur.year}-${String(cur.value).padStart(2,'0')}`;

  const monthDespesas = expandWithRecurring(state.despesas, cur);
  const monthRendas   = expandWithRecurring(state.rendas, cur);
  const totalDesp  = sumAmount(monthDespesas);
  const totalRenda = sumAmount(monthRendas);

  // Meta de categoria
  const gastoPorCat = new Map();
  for (const d of monthDespesas) {
    if (!d.categoriaId) continue;
    gastoPorCat.set(d.categoriaId, (gastoPorCat.get(d.categoriaId) || 0) + (d.valor || 0));
  }
  for (const c of state.categorias) {
    if (!c.meta || c.poupanca) continue; // poupanca: estourar a meta de guardar eh bom, nao alerta
    const gasto = gastoPorCat.get(c.id) || 0;
    const pct = (gasto / c.meta) * 100;
    if (pct >= 100) {
      alerts.push({
        id: `meta:${c.id}:${periodKey}:over`, severity: 'red',
        title: `${c.nome} estourou a meta`,
        message: `${fmtBRL(gasto)} de ${fmtBRL(c.meta)} (${Math.round(pct)}%)`,
        tab: 'despesas',
      });
    } else if (pct >= 80) {
      alerts.push({
        id: `meta:${c.id}:${periodKey}:warn`, severity: 'orange',
        title: `${c.nome} perto da meta`,
        message: `${fmtBRL(gasto)} de ${fmtBRL(c.meta)} (${Math.round(pct)}%)`,
        tab: 'despesas',
      });
    }
  }

  // Saldo do mes
  const saldo = totalRenda - totalDesp;
  if (saldo < 0) {
    alerts.push({
      id: `saldo:${periodKey}:negative`, severity: 'red',
      title: 'Saldo do mês ficou negativo',
      message: `Saldo atual: ${fmtBRL(saldo)}`,
      tab: 'dashboard',
    });
  } else if (totalRenda > 0 && saldo < totalRenda * 0.1) {
    alerts.push({
      id: `saldo:${periodKey}:low`, severity: 'orange',
      title: 'Saldo do mês está baixo',
      message: `Saldo atual: ${fmtBRL(saldo)}`,
      tab: 'dashboard',
    });
  }

  // Lancamentos pendentes vencendo nos proximos 7 dias — escaneia mes corrente
  // + proximo (cobre virada), filtra na janela e considera so pendentes.
  const today = new Date(now); today.setHours(0,0,0,0);
  const limit = new Date(today); limit.setDate(today.getDate() + 7);
  const nextMonthDate = new Date(today); nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextPeriod = { type: 'month', year: nextMonthDate.getFullYear(), value: nextMonthDate.getMonth() + 1 };
  const allUpcoming = [...monthDespesas, ...expandWithRecurring(state.despesas, nextPeriod)];
  let upcomingCount = 0, upcomingTotal = 0;
  for (const d of allUpcoming) {
    if (d._pago) continue;
    const dt = isoToDate(d.data); dt.setHours(0,0,0,0);
    if (dt >= today && dt <= limit) {
      upcomingCount++;
      upcomingTotal += d.valor || 0;
    }
  }
  if (upcomingCount > 0) {
    alerts.push({
      id: `upcoming:${todayISO()}`, severity: 'blue',
      title: `${upcomingCount} pendente${upcomingCount > 1 ? 's' : ''} nos próximos 7 dias`,
      message: `Total a pagar: ${fmtBRL(upcomingTotal)}`,
      tab: 'despesas',
    });
  }

  const order = { red: 0, orange: 1, blue: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
};

const activeAlerts = () => {
  const dismissed = state.dismissedAlerts || {};
  return computeAlerts().filter(a => !dismissed[a.id]);
};

const dismissAlert = (id) => {
  state.dismissedAlerts = { ...(state.dismissedAlerts || {}), [id]: true };
  persist();
};

const applyAlertBadge = () => {
  const btn = document.getElementById('alerts-btn');
  if (!btn) return;
  const badge = btn.querySelector('.badge');
  const count = activeAlerts().length;
  if (badge) badge.hidden = count === 0;
  btn.setAttribute('aria-label', count > 0 ? `${count} notificações` : 'Notificações');
};

// 'small' | 'normal' (padrão) | 'large'. Aplica via classe no html — CSS usa
// `zoom` pra escalar tudo de forma uniforme.
const applyTextSize = (size) => {
  const html = document.documentElement;
  html.classList.remove('text-small', 'text-large');
  if (size === 'small') html.classList.add('text-small');
  else if (size === 'large') html.classList.add('text-large');
};

// Atualiza o nome do perfil exibido no chip da topbar.
const applyProfileChip = () => {
  const el = document.getElementById('profile-name');
  if (el) el.textContent = currentProfileName();
};

// Atualiza o icone de olho na topbar de acordo com o estado atual de
// state.config.valuesHidden. Chamado no boot e em cada toggle.
const applyValuesVisibility = () => {
  const btn = document.getElementById('toggle-values');
  if (!btn) return;
  const hidden = !!(state.config && state.config.valuesHidden);
  btn.classList.toggle('off', hidden);
  btn.setAttribute('aria-label', hidden ? 'Mostrar valores' : 'Ocultar valores');
};

// Limpa cache do service worker e recarrega — botao "Forcar atualizacao" nos
// Ajustes pra resolver casos raros em que o usuario sente que ficou com
// versao velha cacheada.
const forceRefresh = async () => {
  if (!confirm('Forçar atualização? O app vai recarregar — seus dados ficam intactos.')) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}
  location.reload();
};

const toast = (msg) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2000);
};

// Dias inteiros entre uma data ISO (yyyy-mm-dd) e hoje. null se iso for falsy.
const daysSince = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d).setHours(0,0,0,0);
  const now  = new Date().setHours(0,0,0,0);
  return Math.floor((now - then) / 86400000);
};

// Alterna o estado pago/pendente de uma ocorrencia de despesa. Para nao-
// recorrentes muda direto o campo `pago`. Para recorrentes/parceladas, adiciona
// ou remove o YYYY-MM correspondente ao mes da ocorrencia em `pagasEm` —
// permitindo status independente por mes.
const toggleDespesaPago = (item) => {
  const base = state.despesas.find(x => x.id === item.id);
  if (!base) return;
  const isRecurring = !!base.recorrente;
  const isInstallment = (base.parcelas || 0) > 1;
  if (!isRecurring && !isInstallment) {
    db.updateDespesa(item.id, { pago: !base.pago });
  } else {
    const yyyyMm = item.data.slice(0, 7);
    const pagasEm = [...(base.pagasEm || [])];
    const idx = pagasEm.indexOf(yyyyMm);
    if (idx >= 0) pagasEm.splice(idx, 1);
    else pagasEm.push(yyyyMm);
    db.updateDespesa(item.id, { pagasEm });
  }
};

// Dispara o download do JSON e marca a data do ultimo backup. Compartilhado
// entre o botao "Exportar dados" dos Ajustes e o banner do dashboard.
const exportBackup = () => {
  const blob = new Blob([db.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Nome do perfil entra no filename pra distinguir backups (financas-pessoal-2026-05-08.json).
  const slug = currentProfileName().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
  a.download = `financas-${slug}-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  state.lastBackupAt = todayISO();
  persist();
  toast('Backup exportado');
};

// --------------------------- Lock (WebAuthn) -------------------------------
// Bloqueio de tela usando o desbloqueio nativo do dispositivo (Face ID, Touch
// ID, digital, PIN). Implementado via WebAuthn como passkey local — chave
// privada fica guardada pelo proprio aparelho. Sem servidor: nao "verificamos"
// criptograficamente a assertiva, o que protege eh o SO ter validado a
// biometria antes de devolver a resposta. Storage separado do state pra nao
// vazar pro backup/import (a credencial eh especifica deste aparelho).
const LOCK_KEY = 'financas:lock:v1';
const lockStore = {
  get() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; }
    catch { return {}; }
  },
  set(v) { localStorage.setItem(LOCK_KEY, JSON.stringify(v)); },
  clear() { localStorage.removeItem(LOCK_KEY); },
};

const lockSupported = () =>
  !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);

const lockEnabled = () => {
  const s = lockStore.get();
  return !!(s.enabled && s.credentialId);
};

const b64encode = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const b64decode = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const randBytes = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };

const lockRegister = async () => {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randBytes(32),
      rp: { name: 'Finanças' },
      user: {
        id: randBytes(16),
        name: 'financas-local',
        displayName: 'Finanças (este aparelho)',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },    // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('Não foi possível registrar.');
  return b64encode(cred.rawId);
};

const lockVerify = async (credentialIdB64) => {
  const result = await navigator.credentials.get({
    publicKey: {
      challenge: randBytes(32),
      allowCredentials: [{ type: 'public-key', id: b64decode(credentialIdB64) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!result;
};

// Tela cheia bloqueando o app ate o usuario passar pela biometria nativa.
// Qualquer toque na tela dispara o prompt — em iOS Safari o WebAuthn precisa
// de um gesto de usuario, entao o auto-fire na carga falha silenciosamente
// e o primeiro toque cobre o caso. Em navegadores que aceitam, a biometria
// abre direto sem interacao. onUnlock eh chamado em sucesso.
const showLockScreen = (onUnlock) => {
  const wrap = document.createElement('div');
  wrap.id = 'lock-screen';
  wrap.innerHTML = `
    <div class="lock-content">
      <span class="lock-ico">${icon('lock', 56)}</span>
      <h2>Finanças</h2>
      <p class="lock-msg">Toque para desbloquear</p>
      <p class="lock-error" id="lock-error" hidden></p>
    </div>
  `;
  document.body.appendChild(wrap);

  const errEl = wrap.querySelector('#lock-error');
  let busy = false;
  let hadUserGesture = false;

  const tryUnlock = async () => {
    if (busy) return;
    busy = true;
    errEl.hidden = true;
    try {
      const ok = await lockVerify(lockStore.get().credentialId);
      if (ok) { wrap.remove(); onUnlock(); return; }
      if (hadUserGesture) {
        errEl.textContent = 'Não foi possível desbloquear.';
        errEl.hidden = false;
      }
    } catch (err) {
      // Sem gesto de usuario o WebAuthn lanca NotAllowedError — esse caso eh
      // a falha esperada do auto-fire em iOS, nao mostra erro pro usuario.
      if (hadUserGesture) {
        errEl.textContent = 'Toque para tentar novamente.';
        errEl.hidden = false;
      }
    } finally {
      busy = false;
    }
  };

  wrap.addEventListener('click', () => {
    hadUserGesture = true;
    tryUnlock();
  });

  // Tenta acionar a biometria imediatamente — funciona em browsers que
  // permitem WebAuthn sem gesto. Em iOS falha silenciosamente e o primeiro
  // toque do usuario cobre.
  tryUnlock();
};

// --------------------------- Period state ----------------------------------
const period = {
  type: 'month',
  year: new Date().getFullYear(),
  value: new Date().getMonth() + 1,
};

const periodLabel = () => {
  const { type, year, value } = period;
  if (type === 'year')     return String(year);
  if (type === 'month')    return `${monthName(value)} ${year}`;
  if (type === 'quarter')  return `${value}º Tri ${year}`;
  if (type === 'semester') return `${value}º Sem ${year}`;
  return '';
};

// --------------------------- Sheet/Modal -----------------------------------
const openSheet = (title, contentFn, onMount) => {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="sheet-backdrop" data-close>
      <div class="sheet" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="sheet-body"></div>
      </div>
    </div>`;
  const body = root.querySelector('.sheet-body');
  body.innerHTML = contentFn();
  root.querySelector('[data-close]').addEventListener('click', (e) => {
    if (e.target.dataset.close !== undefined) closeSheet();
  });
  if (onMount) onMount(body);
};
const closeSheet = () => { document.getElementById('modal-root').innerHTML = ''; };

// --------------------------- Views -----------------------------------------
const views = {};

// Renderiza um card de "distribuicao" (donut/pizza/barras + lista) — comum
// entre "Despesas por categoria" e "Despesas por tag". As preferencias de
// visualizacao (tipo do grafico, % interna, lista, % na lista) sao
// compartilhadas entre os dois — usuario configura uma vez.
const renderDistribuicaoCard = (titulo, data, canvasId, collapseKey, prefix) => {
  const showDonut = cfg('DonutShow', prefix) !== false;
  const showList  = cfg('ListShow',  prefix) !== false;
  const showListPct = cfg('ListPct', prefix) !== false;
  if (!showDonut && !showList) return '';
  const headerHTML = collapseHeader(collapseKey, titulo);
  if (isCollapsed(collapseKey)) return `<div class="card">${headerHTML}</div>`;
  if (data.length === 0) {
    return `
      <div class="card">
        ${headerHTML}
        <div class="empty"><span class="ico">${icon('inbox', 48)}</span>Sem dados no período.</div>
      </div>`;
  }
  const total = data.reduce((sum, d) => sum + d.valor, 0);
  const dashType = cfg('DonutType', prefix) || 'donut';
  const donutWrapStyle = dashType === 'bars'
    ? `style="height:${Math.max(180, data.length * 36 + 40)}px;"`
    : '';
  const donutHTML = showDonut
    ? `<div class="chart-wrap donut" ${donutWrapStyle}><canvas id="${canvasId}"></canvas></div>`
    : '';
  const listHTML = showList ? `
    <ul class="list" style="margin-top:${showDonut?'12px':'0'};">
      ${data.map(c => {
        const pctTotal = total > 0 ? Math.round((c.valor / total) * 100) : 0;
        const pct = c.meta ? Math.min(100, Math.round((c.valor / c.meta) * 100)) : null;
        // Poupanca: guardar mais nao eh "estourar" — barra sempre sem warn/over.
        const cls = (!c.meta || c.poupanca) ? '' : (c.valor > c.meta ? 'over' : (c.valor > c.meta*0.8 ? 'warn' : ''));
        return `
          <li>
            ${c.icone
              ? `<span class="cat-emoji" style="background:${c.cor}22;">${c.icone}</span>`
              : `<span class="swatch" style="background:${c.cor}"></span>`}
            <div class="grow">
              <div class="t">${escapeHTML(c.nome)}${c.poupanca && !c.hideTag ? '<span class="tag poupanca">Investimento</span>' : ''}</div>
              ${c.meta ? `
                <div class="s">${fmtBRL(c.valor)} de ${fmtBRL(c.meta)}${pct!=null?` · ${pct}% da meta`:''}</div>
                <div class="progress"><i class="${cls}" style="width:${Math.min(100,pct)}%"></i></div>
              ` : `<div class="s">${fmtBRL(c.valor)}</div>`}
            </div>
            ${showListPct ? `<div class="amount">${pctTotal}%</div>` : ''}
          </li>`;
      }).join('')}
    </ul>` : '';
  return `
    <div class="card">
      ${headerHTML}
      ${donutHTML}
      ${listHTML}
    </div>`;
};

// Instancia Chart.js no canvas correspondente. Tipo (donut/pizza/barras) e
// opcoes vem das preferencias por grafico (cat/tag) em state.config.
const mountDistribuicaoChart = (canvas, data, prefix) => {
  if (!canvas || data.length === 0) return;
  const dashType = cfg('DonutType', prefix) || 'donut';
  const chartData = {
    labels: data.map(c => c.nome),
    datasets: [{
      data: data.map(c => c.valor / 100),
      backgroundColor: data.map(c => c.cor),
      borderWidth: 0,
    }],
  };
  let chartConfig;
  if (dashType === 'bars') {
    chartConfig = {
      type: 'bar',
      data: chartData,
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((ctx.parsed.x / total) * 100).toFixed(1) : '0';
                return `${fmtBRL(ctx.parsed.x * 100)} (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: getCSS('--text-2'),
              callback: v => state.config.valuesHidden ? '' : `R$${v}`,
            },
            grid: { color: getCSS('--separator') },
          },
          y: {
            ticks: { color: getCSS('--text'), font: { size: 12 } },
            grid: { display: false },
          },
        },
      },
    };
  } else {
    const donutOptions = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: dashType === 'pie' ? 0 : '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
              return `${ctx.label}: ${fmtBRL(ctx.parsed * 100)} (${pct}%)`;
            },
          },
        },
      },
    };
    // Plugin opcional: desenha "23%" centralizado em cada fatia. Ativado pelo
    // toggle em Ajustes — pula fatias < 6% pra nao poluir.
    const inSlicePctPlugin = {
      id: 'donutPct',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const arcData = chart.data.datasets[0].data;
        const total = arcData.reduce((a, b) => a + b, 0);
        if (total === 0) return;
        chart.getDatasetMeta(0).data.forEach((arc, i) => {
          const pct = (arcData[i] / total) * 100;
          if (pct < 6) return;
          const { x, y } = arc.tooltipPosition();
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${pct.toFixed(0)}%`, x, y);
          ctx.restore();
        });
      },
    };
    chartConfig = { type: 'doughnut', data: chartData, options: donutOptions };
    if (cfg('DonutInnerPct', prefix)) chartConfig.plugins = [inSlicePctPlugin];
  }
  new Chart(canvas, chartConfig);
};

// ----- Dashboard -----
views.dashboard = (root) => {
  const hoje = todayISO();
  const rendasPeriod   = expandWithRecurring(state.rendas, period);
  const despesasPeriod = expandWithRecurring(state.despesas, period);
  const totalRenda    = sumAmount(rendasPeriod);
  const totalDespesa  = sumAmount(despesasPeriod);
  const saldo         = totalRenda - totalDespesa;
  // Renda programada (data futura) ainda não entrou no caixa — separa pra que
  // o "Saldo atual" reflita só o que já foi recebido. O Saldo do período acima
  // continua sendo a projeção (renda inteira) pra planejamento/saúde/gráficos.
  const rendaRecebida   = rendasPeriod.filter(r => r.data <= hoje).reduce((s, r) => s + (r.valor || 0), 0);
  const rendaProgramada = totalRenda - rendaRecebida;
  // Gasto vs Guardado — separa consumo de poupanca/investimento. Soh exibido
  // no resumo quando ha pelo menos uma categoria de poupanca com lancamento.
  const poupancaIds    = new Set(state.categorias.filter(c => c.poupanca).map(c => c.id));
  const totalGuardado  = despesasPeriod.filter(d => poupancaIds.has(d.categoriaId)).reduce((s, d) => s + (d.valor || 0), 0);
  const totalGastos    = totalDespesa - totalGuardado;
  // Pago/Pendente — escopado aos GASTOS (consumo), nao ao total: "investimento
  // pendente" nao tem o mesmo sentido. Sem categorias de poupanca, gastos ==
  // despesa total, entao a leitura volta a ser do total (compat).
  const gastosPeriod   = despesasPeriod.filter(d => !poupancaIds.has(d.categoriaId));
  const totalPago      = gastosPeriod.filter(d => d._pago).reduce((s, d) => s + (d.valor || 0), 0);
  const totalPendente  = totalGastos - totalPago;
  // Saldo "atual" = receita - tudo que ja saiu da conta (gastos pagos +
  // poupanca paga). Considera que o que esta "guardado" ja foi transferido.
  const totalDespesaPaga = despesasPeriod.filter(d => d._pago).reduce((s, d) => s + (d.valor || 0), 0);
  const saldoAtual       = rendaRecebida - totalDespesaPaga;

  // Período anterior: total + despesas por categoria, para comparação.
  const prev = previousPeriod(period);
  const prevRendas    = expandWithRecurring(state.rendas, prev);
  const prevDespesas  = expandWithRecurring(state.despesas, prev);
  const prevRenda     = sumAmount(prevRendas);
  const prevDespesa   = sumAmount(prevDespesas);
  const prevSaldo     = prevRenda - prevDespesa;

  // calcula delta + classe ('good'/'bad'/'flat') já considerando que para
  // despesas mais gasto = ruim, e para receitas mais é bom.
  const computeDelta = (curr, prevVal, isExpense) => {
    if (curr === prevVal) return { sign: '·', label: 'sem mudança', cls: 'flat' };
    if (prevVal === 0) {
      return {
        sign: curr > 0 ? '↑' : '↓',
        label: '—',
        cls: curr > 0 ? (isExpense ? 'bad' : 'good') : (isExpense ? 'good' : 'bad'),
      };
    }
    const diff = curr - prevVal;
    const pct = Math.abs((diff / prevVal) * 100);
    const cls = diff > 0
      ? (isExpense ? 'bad' : 'good')
      : (isExpense ? 'good' : 'bad');
    return { sign: diff > 0 ? '↑' : '↓', label: `${pct.toFixed(0)}%`, cls };
  };

  const deltaDesp   = computeDelta(totalDespesa, prevDespesa, true);
  const deltaRenda  = computeDelta(totalRenda,   prevRenda,   false);
  const deltaSaldo  = computeDelta(saldo,        prevSaldo,   false);

  // Variações por categoria (apenas despesas), top 3 em valor absoluto
  const currCatMap = new Map();
  for (const d of despesasPeriod) currCatMap.set(d.categoriaId || '_sem', (currCatMap.get(d.categoriaId || '_sem') || 0) + (d.valor || 0));
  const prevCatMap = new Map();
  for (const d of prevDespesas)   prevCatMap.set(d.categoriaId || '_sem', (prevCatMap.get(d.categoriaId || '_sem') || 0) + (d.valor || 0));
  const allIds = new Set([...currCatMap.keys(), ...prevCatMap.keys()]);
  const topChanges = [...allIds].map(id => {
    const c = state.categorias.find(x => x.id === id);
    return {
      id,
      nome: c ? c.nome : 'Sem categoria',
      cor:  c ? c.cor  : '#999',
      icone: catEmoji(c),
      diff: (currCatMap.get(id) || 0) - (prevCatMap.get(id) || 0),
    };
  }).filter(x => x.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);

  // Despesas por categoria (exclui investimento — que tem card próprio).
  const porCategoria = new Map();
  for (const d of gastosPeriod) {
    const id = d.categoriaId || '_sem';
    porCategoria.set(id, (porCategoria.get(id) || 0) + (d.valor || 0));
  }
  const catData = [...porCategoria.entries()].map(([id, valor]) => {
    const c = state.categorias.find(x => x.id === id);
    return {
      id,
      nome: c ? c.nome : 'Sem categoria',
      cor:  c ? c.cor  : '#999',
      meta: c ? c.meta : null,
      icone: catEmoji(c),
      poupanca: false,
      valor,
    };
  }).sort((a, b) => b.valor - a.valor);

  // Investimentos por categoria (categorias marcadas como investimento). Card
  // próprio no dashboard; hideTag evita repetir o selo "Investimento" em todas
  // as linhas. poupanca:true mantém a barra de meta "sempre verde" (superar a
  // meta de investir é bom).
  const porInvest = new Map();
  for (const d of despesasPeriod) {
    if (!poupancaIds.has(d.categoriaId)) continue;
    porInvest.set(d.categoriaId, (porInvest.get(d.categoriaId) || 0) + (d.valor || 0));
  }
  const investData = [...porInvest.entries()].map(([id, valor]) => {
    const c = state.categorias.find(x => x.id === id);
    return {
      id,
      nome: c ? c.nome : 'Investimento',
      cor:  c ? c.cor  : '#30d158',
      meta: c ? c.meta : null,
      icone: catEmoji(c),
      poupanca: true,
      hideTag: true,
      valor,
    };
  }).sort((a, b) => b.valor - a.valor);

  // Despesas por tag — bucket "Sem tag" para despesas sem nenhuma tag.
  // Modo de contagem multi-tag controlado por state.config.dashTagSplit:
  //   - true (default): valor eh dividido igualitariamente entre as tags
  //     (R$100 com [a,b] = R$50 em cada). Soma bate com total real, donut e
  //     lista somam 100%.
  //   - false: cada tag recebe o valor inteiro (R$100 em cada). Bom pra
  //     quem usa tags como "dimensoes" — soma pode passar do total real.
  const tagSplit = state.config.dashTagSplit !== false;
  const porTag = new Map();
  for (const d of despesasPeriod) {
    const tags = d.tags || [];
    if (tags.length === 0) {
      const cur = porTag.get('_sem') || { name: 'Sem tag', valor: 0 };
      cur.valor += d.valor || 0;
      porTag.set('_sem', cur);
    } else if (tagSplit) {
      // Math.floor + restante na primeira pra soma ficar exata em centavos
      const baseShare = Math.floor((d.valor || 0) / tags.length);
      const rem = (d.valor || 0) - baseShare * tags.length;
      tags.forEach((t, i) => {
        const k = t.toLowerCase();
        const cur = porTag.get(k) || { name: t, valor: 0 };
        cur.valor += baseShare + (i === 0 ? rem : 0);
        porTag.set(k, cur);
      });
    } else {
      for (const t of tags) {
        const k = t.toLowerCase();
        const cur = porTag.get(k) || { name: t, valor: 0 };
        cur.valor += d.valor || 0;
        porTag.set(k, cur);
      }
    }
  }
  const tagData = assignTagColors(
    [...porTag.entries()]
      .map(([k, v]) => ({ id: k, nome: v.name, meta: null, valor: v.valor }))
      .sort((a, b) => b.valor - a.valor)
  );

  // Linha do tempo (12 meses do ano corrente para visão anual; ou meses do período)
  const months = monthsInPeriod(period.type === 'month' ? { ...period, type: 'year' } : period);
  const monthLabels = months.map(({m}) => monthName(m, true));
  const monthsRenda = months.map(({y, m}) =>
    sumAmount(expandWithRecurring(state.rendas,   { type:'month', year:y, value:m })));
  const monthsDespesa = months.map(({y, m}) =>
    sumAmount(expandWithRecurring(state.despesas, { type:'month', year:y, value:m })));

  // Banner de lembrete de backup. Aparece quando o lembrete esta ativado e
  // (a) nunca houve backup, ou (b) o intervalo configurado ja foi excedido.
  const reminderDays = state.config.backupReminderDays | 0;
  const dSinceBackup = daysSince(state.lastBackupAt);
  let backupBanner = '';
  if (reminderDays > 0) {
    let msg = '';
    if (dSinceBackup === null) {
      msg = 'Você ainda não fez nenhum backup dos dados.';
    } else if (dSinceBackup >= reminderDays) {
      msg = `Faz ${dSinceBackup === 1 ? '1 dia' : `${dSinceBackup} dias`} desde seu último backup.`;
    }
    if (msg) {
      backupBanner = `
        <div class="card" style="display:flex;align-items:center;gap:12px;border-left:3px solid var(--orange);">
          <div style="flex:1;">
            <div style="font-weight:600;margin-bottom:2px;">Hora de fazer backup</div>
            <div style="color:var(--text-2);font-size:14px;">${msg}</div>
          </div>
          <button class="primary" id="banner-backup">Exportar agora</button>
        </div>
      `;
    }
  }

  root.innerHTML = `
    ${backupBanner}
    ${periodHeader()}

    <div class="card summary-card ${saldo >= 0 ? 'positive' : 'negative'}">
      <div class="summary-row">
        <span class="summary-label">Receitas</span>
        <span class="summary-value positive">${fmtBRL(totalRenda)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Despesas</span>
        <span class="summary-value negative">${fmtBRL(totalDespesa)}</span>
      </div>
      ${totalGuardado > 0 ? `
        <div class="summary-sub">
          <span>Gastos <strong>${fmtBRL(totalGastos)}</strong></span>
          <span>Investido <strong>${fmtBRL(totalGuardado)}</strong></span>
        </div>
      ` : ''}
      <div class="summary-sub">
        <span>Já pago <strong>${fmtBRL(totalPago)}</strong></span>
        <span>A pagar <strong>${fmtBRL(totalPendente)}</strong></span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-row summary-row-main">
        <span class="summary-label">Saldo</span>
        <span class="summary-value ${saldo >= 0 ? 'positive' : 'negative'}">${fmtBRL(saldo)}</span>
      </div>
      <div class="summary-sub" style="justify-content:flex-end;gap:16px;">
        ${rendaProgramada > 0 ? `<span>A receber <strong>${fmtBRL(rendaProgramada)}</strong></span>` : ''}
        <span>Atual <strong>${fmtBRL(saldoAtual)}</strong></span>
      </div>
    </div>

    ${(() => {
      // Card Objetivos: barra de progresso de cada meta de poupanca. So aparece
      // se houver objetivos e o toggle estiver ligado.
      if (state.config.dashGoalsShow === false) return '';
      const objs = state.objetivos || [];
      if (objs.length === 0) return '';
      return `
        <div class="card">
          ${collapseHeader('goals', 'Objetivos')}
          ${isCollapsed('goals') ? '' : `
            <ul class="list" style="box-shadow:none;margin:0;">
              ${objs.map(o => {
                const atual = objetivoAtual(o);
                const pct = o.alvo > 0 ? Math.min(100, Math.round(atual / o.alvo * 100)) : 0;
                const done = atual >= o.alvo;
                return `
                  <li>
                    <div class="grow">
                      <div class="t">${escapeHTML(o.nome)}${done ? '<span class="tag poupanca">Concluído</span>' : ''}</div>
                      <div class="s">${fmtBRL(atual)} de ${fmtBRL(o.alvo)} · ${pct}%</div>
                      <div class="progress"><i style="width:${pct}%"></i></div>
                    </div>
                  </li>`;
              }).join('')}
            </ul>
          `}
        </div>`;
    })()}

    ${(() => {
      // Painel de saude financeira: indicadores derivados do periodo + reserva
      // acumulada. So aparece com renda no periodo (senao as razoes nao fazem
      // sentido) e com o toggle ligado.
      if (state.config.dashHealthShow === false || totalRenda <= 0) return '';
      const taxaPoup  = totalGuardado / totalRenda * 100;
      const despRenda = totalGastos   / totalRenda * 100;
      const custoFixo = despesasPeriod.filter(d => d.recorrente && !poupancaIds.has(d.categoriaId)).reduce((s, d) => s + (d.valor || 0), 0);
      const fixoRenda = custoFixo / totalRenda * 100;
      // Médias dos 3 meses completos anteriores (renda, gasto e guardado) p/ a
      // tendência das razões deste mês vs histórico.
      let pGasto = 0, pRenda = 0, pGuardado = 0;
      const nowH = new Date();
      for (let i = 1; i <= 3; i++) {
        const dm = new Date(nowH.getFullYear(), nowH.getMonth() - i, 1);
        const per = { type: 'month', year: dm.getFullYear(), value: dm.getMonth() + 1 };
        for (const occ of expandWithRecurring(state.despesas, per)) {
          if (poupancaIds.has(occ.categoriaId)) pGuardado += occ.valor || 0;
          else pGasto += occ.valor || 0;
        }
        for (const occ of expandWithRecurring(state.rendas, per)) pRenda += occ.valor || 0;
      }
      const prevTaxaPoup  = pRenda > 0 ? pGuardado / pRenda * 100 : null;
      const prevDespRenda = pRenda > 0 ? pGasto    / pRenda * 100 : null;
      // c: classe de cor (good/''/bad). higher=true → maior é melhor.
      const c = (v, good, warn, higher) => higher
        ? (v >= good ? 'good' : (v >= warn ? '' : 'bad'))
        : (v <= good ? 'good' : (v <= warn ? '' : 'bad'));
      // sub-score 0–100 por indicador (p/ a barrinha e o índice geral). 60 = limite
      // de "atenção" (warn), 100 = "bom" (good); decai linearmente fora disso.
      const scoreOf = (v, good, warn, higher) => {
        let s;
        if (higher) {
          if (v >= good) s = 100;
          else if (v >= warn) s = 60 + 40 * (v - warn) / (good - warn);
          else s = warn > 0 ? 60 * (v / warn) : 0;
        } else {
          if (v <= good) s = 100;
          else if (v <= warn) s = 60 + 40 * (warn - v) / (warn - good);
          else { const cap = warn + (warn - good); s = v >= cap ? 0 : 60 * (cap - v) / (cap - warn); }
        }
        return Math.max(0, Math.min(100, s));
      };
      // tendência: valor atual vs média dos 3 meses. higher define o que é melhorar.
      const trendOf = (cur, prev, higher) => {
        if (prev == null) return null;
        const diff = cur - prev;
        if (Math.abs(diff) < 0.5) return { sign: '→', cls: 'flat' };
        const up = diff > 0;
        return { sign: up ? '↑' : '↓', cls: (higher ? up : !up) ? 'good' : 'bad' };
      };
      // Metas configuráveis (Ajustes > Personalizar dashboard). A linha de
      // "atenção" (warn) é derivada da meta pra manter um só campo por indicador.
      const m = healthMetas();
      const rows = [
        { label: 'Taxa de investimento', val: taxaPoup,  fmt: `${taxaPoup.toFixed(0)}%`,  good: m.invest, warn: Math.round(m.invest * 0.5),  higher: true,  hint: `da renda guardada · meta ≥ ${m.invest}%`,           trend: trendOf(taxaPoup,  prevTaxaPoup,  true)  },
        { label: 'Renda comprometida',          val: despRenda, fmt: `${despRenda.toFixed(0)}%`, good: m.gastos, warn: Math.min(100, m.gastos + 20), higher: false, hint: `Fatia da renda consumida pelos gastos do mês (fora investimentos) · ideal ≤ ${m.gastos}%`, trend: trendOf(despRenda, prevDespRenda, false) },
        { label: 'Renda presa em contas fixas', val: fixoRenda, fmt: `${fixoRenda.toFixed(0)}%`, good: m.fixo,   warn: m.fixo + 15,                 higher: false, hint: `Fatia da renda já comprometida com despesas recorrentes · ideal ≤ ${m.fixo}%`,           trend: null },
      ];
      rows.forEach(r => { r.cl = c(r.val, r.good, r.warn, r.higher); r.score = scoreOf(r.val, r.good, r.warn, r.higher); });
      // Índice geral: média ponderada dos sub-scores dos indicadores.
      const weights = { 'Taxa de investimento': 0.4, 'Renda comprometida': 0.35, 'Renda presa em contas fixas': 0.25 };
      let wsum = 0, acc = 0;
      rows.forEach(r => { const w = weights[r.label] || 0.2; acc += r.score * w; wsum += w; });
      const score = wsum > 0 ? Math.round(acc / wsum) : 0;
      const status = score >= 75 ? { txt: 'Saudável', cls: 'good' } : (score >= 50 ? { txt: 'Atenção', cls: '' } : { txt: 'Crítico', cls: 'bad' });
      // Dica acionável: aponta o indicador mais fraco quando ele está abaixo do bom.
      const worst = [...rows].sort((a, b) => a.score - b.score)[0];
      const tips = {
        'Taxa de investimento': `Você está guardando pouco da renda. Tente separar ao menos ${m.invest}% assim que receber.`,
        'Renda comprometida': `Os gastos consomem boa parte da renda. Mire ficar abaixo de ${m.gastos}% cortando as maiores categorias.`,
        'Renda presa em contas fixas': 'Custo fixo alto. Revise assinaturas e recorrências que dá pra reduzir.',
      };
      const tip = (worst && worst.score < 60) ? tips[worst.label] : null;
      const barCls = (cl) => cl === 'good' ? '' : (cl === 'bad' ? 'over' : 'warn');
      return `
        <div class="card">
          ${collapseHeader('health', 'Saúde financeira')}
          ${isCollapsed('health') ? '' : `
            <div class="health-score">
              <div class="hs-ring ${status.cls}" style="--p:${score};">
                <span class="hs-num">${score}</span>
              </div>
              <div class="hs-meta">
                <div class="hs-status ${status.cls}">${status.txt}</div>
                <div class="hs-sub">Índice de saúde financeira</div>
              </div>
            </div>
            <ul class="health-list">
              ${rows.map(r => `
                <li>
                  <div class="grow">
                    <div class="hl-label">${r.label}${r.trend ? ` <span class="hl-trend ${r.trend.cls}">${r.trend.sign}</span>` : ''}</div>
                    <div class="hl-hint">${r.hint}</div>
                    <div class="progress"><i class="${barCls(r.cl)}" style="width:${r.score.toFixed(0)}%"></i></div>
                  </div>
                  <span class="hl-val ${r.cl}">${r.fmt}</span>
                </li>`).join('')}
            </ul>
            ${tip ? `<div class="health-tip"><span class="ico">${icon('sparkles', 16)}</span><span>${tip}</span></div>` : ''}
          `}
        </div>`;
    })()}

    ${(() => {
      // Vencimentos: pendentes proximos 14 dias + atrasados ate 30 dias. Toggle
      // controla exibicao. Tem modo de selecao pra marcar varias como pagas.
      if (state.config.dashUpcomingShow === false) return '';
      const items = upcomingItems();
      if (items.length === 0) return '';
      const collapsed = isCollapsed('upcoming');
      const overdueCount = items.filter(d => d._overdue).length;
      const upcomingCount = items.length - overdueCount;
      const total = items.reduce((s, d) => s + (d.valor || 0), 0);
      const summary = [
        overdueCount > 0 ? `${overdueCount} atrasada${overdueCount > 1 ? 's' : ''}` : null,
        upcomingCount > 0 ? `${upcomingCount} nos próximos 14 dias` : null,
      ].filter(Boolean).join(' + ');
      const allKeys = items.map(d => `${d.id}|${d.data}`);
      const allSel = allKeys.length > 0 && allKeys.every(k => vencSel.has(k));
      return `
        <div class="card">
          ${collapseHeader('upcoming', 'Vencimentos')}
          ${collapsed ? '' : `
            <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 10px;gap:12px;">
              <span style="color:var(--text-2);font-size:13px;">${summary} · ${fmtBRL(total)}</span>
              ${vencSelMode
                ? `<button class="link" id="venc-select-all" style="padding:0;flex:0 0 auto;">${allSel ? 'Desmarcar todas' : 'Selecionar todas'}</button>`
                : `<button class="link" id="venc-enter-select" style="padding:0;flex:0 0 auto;">Selecionar</button>`}
            </div>
            <ul class="list upcoming-list ${vencSelMode ? 'selecting' : ''}" style="box-shadow:none;margin:0;">
              ${items.map(d => {
                const c = state.categorias.find(x => x.id === d.categoriaId);
                const key = `${d.id}|${d.data}`;
                const sel = vencSel.has(key);
                const meta = [c ? escapeHTML(c.nome) : null, tagsInline(d.tags)].filter(Boolean).join(' · ');
                return `
                  <li class="upcoming-row ${vencSelMode ? 'select-row' : ''}" data-id="${d.id}" data-data="${d.data}">
                    ${vencSelMode ? `<span class="select-circle ${sel ? 'checked' : ''}">${sel ? '✓' : ''}</span>` : ''}
                    ${catEmoji(c)
                      ? `<span class="cat-emoji" style="background:${c.cor}22;">${catEmoji(c)}</span>`
                      : `<span class="swatch" style="background:${c ? c.cor : '#999'}"></span>`}
                    <div class="grow">
                      <div class="t">${escapeHTML(d.descricao || (c ? c.nome : 'Despesa'))}
                        ${d._overdue ? '<span class="tag atrasado">Atrasado</span>' : ''}
                      </div>
                      <div class="s">${fmtDate(d.data)}${meta ? ' · ' + meta : ''}</div>
                    </div>
                    <div class="amount neg">${fmtBRL(d.valor)}</div>
                  </li>`;
              }).join('')}
            </ul>
            ${vencSelMode ? `
              <div class="venc-actions">
                <span class="count">${vencSel.size} selecionada${vencSel.size === 1 ? '' : 's'}</span>
                <button class="link" id="venc-cancel">Cancelar</button>
                <button class="primary" id="venc-pay" style="padding:8px 14px;" ${vencSel.size === 0 ? 'disabled' : ''}>Marcar pagas</button>
              </div>
            ` : ''}
          `}
        </div>`;
    })()}

    ${state.config.dashCompareShow !== false ? `
      <div class="card">
        ${collapseHeader('compare', `Comparação com ${labelOfPeriod(prev)}`)}
        ${isCollapsed('compare') ? '' : `
          <div class="compare-row">
            <span class="label">Despesas</span>
            <span class="amount">${fmtBRL(totalDespesa)}</span>
            <span class="delta ${deltaDesp.cls}">${deltaDesp.sign} ${deltaDesp.label}</span>
          </div>
          <div class="compare-row">
            <span class="label">Receitas</span>
            <span class="amount">${fmtBRL(totalRenda)}</span>
            <span class="delta ${deltaRenda.cls}">${deltaRenda.sign} ${deltaRenda.label}</span>
          </div>
          <div class="compare-row">
            <span class="label">Saldo</span>
            <span class="amount">${fmtBRL(saldo)}</span>
            <span class="delta ${deltaSaldo.cls}">${deltaSaldo.sign} ${deltaSaldo.label}</span>
          </div>
          <div class="compare-sub">vs ${fmtBRL(prevDespesa)} / ${fmtBRL(prevRenda)} / ${fmtBRL(prevSaldo)}</div>

          ${topChanges.length > 0 ? `
            <div class="section-title" style="margin:14px 0 6px;">Maiores variações por categoria</div>
            <ul class="compare-changes">
              ${topChanges.map(c => `
                <li>
                  ${c.icone
                    ? `<span class="compare-emoji">${c.icone}</span>`
                    : `<span class="swatch" style="background:${c.cor}"></span>`}
                  <span class="name">${escapeHTML(c.nome)}</span>
                  <span class="diff ${c.diff > 0 ? 'bad' : 'good'}">${c.diff > 0 ? '+' : '−'}${fmtBRL(Math.abs(c.diff))}</span>
                </li>`).join('')}
            </ul>
          ` : ''}
        `}
      </div>
    ` : ''}

    ${state.config.dashBarsShow !== false ? `
      <div class="card">
        ${collapseHeader('bars', 'Receitas vs Despesas')}
        ${isCollapsed('bars') ? '' : `<div class="chart-wrap"><canvas id="ch-bars"></canvas></div>`}
      </div>
    ` : ''}

    ${renderDistribuicaoCard('Despesas por categoria', catData, 'ch-cat', 'cat', 'Cat')}
    ${(state.config.dashInvestShow !== false && investData.length > 0) ? renderDistribuicaoCard('Investimentos por categoria', investData, 'ch-invest', 'invest', 'Invest') : ''}
    ${state.config.dashTagShow ? renderDistribuicaoCard('Despesas por tag', tagData, 'ch-tag', 'tag', 'Tag') : ''}
  `;

  bindPeriodHeader(root);

  // Toggle de minimizar/expandir cards do dashboard. Preserva o scroll para
  // o usuario nao perder o lugar quando minimiza um card abaixo da dobra.
  root.querySelectorAll('[data-collapse]').forEach(h => {
    h.addEventListener('click', () => {
      const key = h.dataset.collapse;
      const cur = state.config.dashCollapsed || {};
      updateConfig({ dashCollapsed: { ...cur, [key]: !cur[key] } });
      render({ preserveScroll: true });
    });
  });

  const bannerBtn = root.querySelector('#banner-backup');
  if (bannerBtn) bannerBtn.addEventListener('click', () => { exportBackup(); render(); });

  // Card Vencimentos: fora do modo selecao, tap abre os detalhes da despesa.
  // No modo selecao, tap alterna a marca da ocorrencia.
  root.querySelectorAll('.upcoming-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const data = row.dataset.data;
      if (vencSelMode) {
        const key = `${id}|${data}`;
        if (vencSel.has(key)) vencSel.delete(key); else vencSel.add(key);
        render({ preserveScroll: true });
        return;
      }
      const occ = upcomingItems().find(x => x.id === id && x.data === data);
      if (occ) sheetDespesaDetalhes(occ);
    });
  });

  const vencEnter = root.querySelector('#venc-enter-select');
  if (vencEnter) vencEnter.addEventListener('click', () => { vencSelMode = true; vencSel.clear(); render({ preserveScroll: true }); });
  const vencCancel = root.querySelector('#venc-cancel');
  if (vencCancel) vencCancel.addEventListener('click', () => { vencSelMode = false; vencSel.clear(); render({ preserveScroll: true }); });
  const vencSelAll = root.querySelector('#venc-select-all');
  if (vencSelAll) vencSelAll.addEventListener('click', () => {
    const keys = upcomingItems().map(d => `${d.id}|${d.data}`);
    const allSel = keys.length > 0 && keys.every(k => vencSel.has(k));
    if (allSel) keys.forEach(k => vencSel.delete(k));
    else keys.forEach(k => vencSel.add(k));
    render({ preserveScroll: true });
  });
  const vencPay = root.querySelector('#venc-pay');
  if (vencPay) vencPay.addEventListener('click', () => {
    const occs = upcomingItems().filter(d => vencSel.has(`${d.id}|${d.data}`));
    if (occs.length === 0) return;
    const n = occs.length;
    marcarOcorrenciasPagas(occs);
    vencSelMode = false; vencSel.clear();
    toast(`${n} marcada${n === 1 ? '' : 's'} como paga${n === 1 ? '' : 's'}`);
    render();
  });

  // Gráficos
  if (window.Chart) {
    const barsEl = root.querySelector('#ch-bars');
    if (barsEl) {
      new Chart(barsEl, {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [
            { label: 'Receitas', data: monthsRenda.map(c => c/100),   backgroundColor: '#30d158' },
            { label: 'Despesas', data: monthsDespesa.map(c => c/100), backgroundColor: '#ff453a' },
          ],
        },
        options: chartOpts(),
      });
    }

    mountDistribuicaoChart(root.querySelector('#ch-cat'), catData, 'Cat');
    mountDistribuicaoChart(root.querySelector('#ch-invest'), investData, 'Invest');
    mountDistribuicaoChart(root.querySelector('#ch-tag'), tagData, 'Tag');
  }
};

const valueChips = () => {
  if (period.type === 'year') return '';
  if (period.type === 'month') {
    return Array.from({length:12}, (_,i) => i+1).map(m =>
      `<button class="chip ${period.value===m?'active':''}" data-value="${m}">${monthName(m,true)}</button>`
    ).join('');
  }
  if (period.type === 'quarter') {
    return [1,2,3,4].map(q =>
      `<button class="chip ${period.value===q?'active':''}" data-value="${q}">${q}º Tri</button>`
    ).join('');
  }
  if (period.type === 'semester') {
    return [1,2].map(s =>
      `<button class="chip ${period.value===s?'active':''}" data-value="${s}">${s}º Sem</button>`
    ).join('');
  }
  return '';
};

const chartOpts = () => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: getCSS('--text'), font: { size: 11 } } },
    tooltip: {
      callbacks: { label: (ctx) => `${ctx.dataset.label || ctx.label}: ${ctx.parsed.y!=null ? fmtBRL(ctx.parsed.y*100) : fmtBRL(ctx.parsed*100)}` }
    },
  },
  scales: {
    x: { ticks: { color: getCSS('--text-2'), font: { size: 10 } }, grid: { display: false } },
    y: {
      ticks: {
        color: getCSS('--text-2'),
        callback: v => state.config.valuesHidden ? '' : `R$${v}`,
      },
      grid: { color: getCSS('--separator') },
    },
  },
});

const getCSS = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ----- Carteira -----
views.carteira = (root) => {
  const hoje = todayISO();
  const rendasPeriod = expandWithRecurring(state.rendas, period);
  // Renda só "conta" a partir da data escolhida: separa recebida (data <= hoje)
  // de programada (data futura). O total exibido reflete só o que já entrou.
  const recebidas   = rendasPeriod.filter(r => r.data <= hoje);
  const programadas = rendasPeriod.filter(r => r.data >  hoje);
  const total     = sumAmount(recebidas);
  const totalProg = sumAmount(programadas);
  const proxProg  = programadas.length ? programadas.reduce((a, b) => a.data < b.data ? a : b) : null;
  // Lista por fonte (só do recebido, pra bater com o total exibido)
  const porFonte = new Map();
  for (const r of recebidas) {
    const k = r.fonte || 'Outros';
    porFonte.set(k, (porFonte.get(k) || 0) + (r.valor || 0));
  }

  root.innerHTML = `
    ${periodHeader()}
    <div class="card">
      <h2>Total de receitas em ${periodLabel()}</h2>
      <div class="big positive">${fmtBRL(total)}</div>
      ${totalProg > 0 ? `
        <div class="big-sub">
          <span class="ico">${icon('clock', 15)}</span>
          <strong>${fmtBRL(totalProg)}</strong> programado${proxProg ? ` · entra ${fmtDate(proxProg.data)}` : ''}
        </div>
      ` : ''}
    </div>

    ${porFonte.size > 0 ? `
      <div class="section-title">Por fonte</div>
      <ul class="list">
        ${[...porFonte.entries()].sort((a,b)=>b[1]-a[1]).map(([fonte, valor]) => `
          <li>
            <span class="swatch" style="background:#30d158"></span>
            <div class="grow"><div class="t">${escapeHTML(fonte)}</div></div>
            <div class="amount pos">${fmtBRL(valor)}</div>
          </li>
        `).join('')}
      </ul>
    ` : ''}

    <div class="section-title">Lançamentos</div>
    ${rendasPeriod.length === 0 ? `
      <div class="empty"><span class="ico">${icon('wallet', 48)}</span>Nenhuma receita no período.<br/><br/>
        <button class="primary" id="add-renda">Adicionar receita</button></div>
    ` : `
      <ul class="list">
        ${rendasPeriod.sort((a,b)=>b.data.localeCompare(a.data)).map(r => {
          const prog = r.data > hoje;
          return `
          <li class="swipe-row${prog ? ' is-prog' : ''}" data-id="${r.id}" data-data="${r.data}" data-real="${!r._virtual}">
            <span class="swatch" style="background:#30d158"></span>
            <div class="grow">
              <div class="t">${escapeHTML(r.fonte || 'Receita')}
                ${r.recorrente ? '<span class="tag recurring">Mensal</span>' : ''}
                ${prog ? '<span class="tag programada">Programada</span>' : ''}
              </div>
              <div class="s">${fmtDate(r.data)}${r.descricao ? ' · '+escapeHTML(r.descricao) : ''}</div>
            </div>
            <div class="amount pos">${fmtBRL(r.valor)}</div>
            ${!r._virtual ? `
              <div class="swipe-actions">
                <button class="edit" data-action="edit-renda">Editar</button>
                <button class="del"  data-action="del-renda">Excluir</button>
              </div>
            ` : ''}
          </li>
        `;}).join('')}
      </ul>
    `}

    <button class="fab" id="fab-renda" aria-label="Adicionar receita">+</button>
  `;

  bindSwipe(root);

  // Tap na linha abre os detalhes (descricao completa, valor, tipo, etc).
  // Ignora clicks nas swipe-actions (editar/excluir) e tambem se a linha
  // estiver com swipe aberto — ai o tap so fecha o swipe.
  root.querySelectorAll('.swipe-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.swipe-actions')) return;
      if (row.classList.contains('open')) { row.classList.remove('open'); return; }
      const occ = rendasPeriod.find(x => x.id === row.dataset.id && x.data === row.dataset.data);
      if (occ) sheetRendaDetalhes(occ);
    });
  });

  root.querySelectorAll('[data-action="edit-renda"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    sheetRenda(state.rendas.find(x => x.id === id));
  }));
  root.querySelectorAll('[data-action="del-renda"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    if (confirm('Excluir esta receita?')) { db.removeRenda(id); toast('Receita excluída'); render(); }
  }));
  const addBtn = root.querySelector('#add-renda');
  if (addBtn) addBtn.addEventListener('click', () => sheetRenda());
  root.querySelector('#fab-renda').addEventListener('click', () => sheetRenda());
  bindPeriodHeader(root);
};

// ----- Despesas -----
// Filtros de despesas: multi-selecao via Set. "vazio" = sem filtro (mostra
// tudo). Tap num chip toggles a inclusao; "Todas X" limpa o set.
let tagFilter = new Set();      // chaves lowercase de tags ativas
let searchQuery = '';           // texto digitado na busca
let categoryFilter = new Set(); // ids de categorias ativas
let statusFilter = null;        // null | 'pago' | 'pendente'
let typeFilter = null;          // null | 'mensal' | 'parcelada'

// Modo seleção da tela de Despesas — permite marcar várias e apagar de uma vez.
let selectionMode = false;
let selectedIds = new Set();    // ids de despesas (reais, nao virtuais) marcadas

// Modo seleção do card Vencimentos (dashboard) — marcar várias como pagas.
// Chaves sao "id|data" pra distinguir ocorrencias de recorrentes/parceladas.
let vencSelMode = false;
let vencSel = new Set();

// Aplica busca textual + filtro de categoria + filtro de tag + filtro de
// status. Multi-select: dentro de cada filtro o match eh "OU" (qualquer das
// categorias/tags selecionadas), entre filtros eh "E".
const filterDespesas = (despesas) => {
  let result = despesas;
  if (categoryFilter.size > 0) {
    result = result.filter(d => categoryFilter.has(d.categoriaId));
  }
  if (tagFilter.size > 0) {
    result = result.filter(d => (d.tags || []).some(t => tagFilter.has(t.toLowerCase())));
  }
  if (statusFilter === 'pago') result = result.filter(d => d._pago);
  if (statusFilter === 'pendente') result = result.filter(d => !d._pago);
  if (typeFilter === 'mensal') result = result.filter(d => d.recorrente);
  if (typeFilter === 'parcelada') result = result.filter(d => (d.parcelas || 1) > 1);
  if (typeFilter === 'unica') result = result.filter(d => !d.recorrente && (d.parcelas || 1) <= 1);
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(d =>
      (d.descricao || '').toLowerCase().includes(q) ||
      (d.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  return result;
};

// Período imediatamente anterior, mantendo o mesmo "tipo" (mês/tri/sem/ano).
const previousPeriod = (p) => {
  const np = { ...p };
  if (p.type === 'year') { np.year--; return np; }
  const wrap = p.type === 'month' ? 12 : (p.type === 'quarter' ? 4 : 2);
  if (p.value === 1) { np.year--; np.value = wrap; } else { np.value--; }
  return np;
};

const labelOfPeriod = (p) => {
  if (p.type === 'year')     return String(p.year);
  if (p.type === 'month')    return `${monthName(p.value)} ${p.year}`;
  if (p.type === 'quarter')  return `${p.value}º Tri ${p.year}`;
  if (p.type === 'semester') return `${p.value}º Sem ${p.year}`;
  return '';
};

views.despesas = (root) => {
  // Investimentos têm aba própria — a aba Despesas ignora as categorias de
  // investimento (tanto na lista quanto nos chips de filtro).
  const invIds = investCategoriaIds();
  const despesasCats = state.categorias.filter(c => !c.poupanca);
  const expanded = expandWithRecurring(state.despesas, period).filter(d => !invIds.has(d.categoriaId));
  const despesasPeriod = filterDespesas(expanded);
  const total = sumAmount(despesasPeriod);
  const tags = allTags();
  const hasFilter = !!searchQuery || categoryFilter.size > 0 || tagFilter.size > 0 || statusFilter !== null || typeFilter !== null;

  root.innerHTML = `
    ${periodHeader()}
    <div class="card">
      <h2>Total ${hasFilter ? '(filtrado)' : ''} em ${periodLabel()}</h2>
      <div class="big negative">${fmtBRL(total)}</div>
      ${hasFilter ? `<button class="link" id="clear-filters" style="padding:8px 0 0;">Limpar filtros</button>` : ''}
    </div>

    <div class="search-row">
      <input id="search" type="search" inputmode="search" autocapitalize="none" autocorrect="off"
             placeholder="Buscar por descrição ou tag" value="${escapeAttr(searchQuery)}" />
    </div>

    ${despesasCats.length > 0 ? `
      <div class="filter-bar" id="cat-filter">
        <button class="chip ${categoryFilter.size===0?'active':''}" data-cat="">Todas categorias</button>
        ${despesasCats.map(c => `
          <button class="chip ${categoryFilter.has(c.id)?'active':''}" data-cat="${c.id}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.cor};margin-right:6px;vertical-align:middle;"></span>${escapeHTML(c.nome)}
          </button>`).join('')}
      </div>
    ` : ''}

    ${tags.length > 0 ? `
      <div class="filter-bar" id="tag-filter">
        <button class="chip ${tagFilter.size===0?'active':''}" data-tag="">Todas tags</button>
        ${tags.map(t => `<button class="chip ${tagFilter.has(t.toLowerCase())?'active':''}" data-tag="${escapeAttr(t.toLowerCase())}">#${escapeHTML(t)}</button>`).join('')}
      </div>
    ` : ''}

    <div class="filter-bar" id="status-filter">
      <button class="chip ${statusFilter===null?'active':''}" data-status="">Todas</button>
      <button class="chip ${statusFilter==='pago'?'active':''}" data-status="pago">Pagas</button>
      <button class="chip ${statusFilter==='pendente'?'active':''}" data-status="pendente">Pendentes</button>
    </div>

    <div class="filter-bar" id="type-filter">
      <button class="chip ${typeFilter===null?'active':''}" data-type="">Todos os tipos</button>
      <button class="chip ${typeFilter==='mensal'?'active':''}" data-type="mensal">Mensais</button>
      <button class="chip ${typeFilter==='parcelada'?'active':''}" data-type="parcelada">Parceladas</button>
      <button class="chip ${typeFilter==='unica'?'active':''}" data-type="unica">Apenas neste mês</button>
    </div>

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>Lançamentos</span>
      ${despesasPeriod.length === 0 ? '' : (selectionMode
        ? (() => {
            const realIds = despesasPeriod.filter(d => !d._virtual).map(d => d.id);
            const allSel = realIds.length > 0 && realIds.every(id => selectedIds.has(id));
            return `<button class="link" id="select-all" style="padding:4px 0;">${allSel ? 'Desmarcar todas' : 'Selecionar todas'}</button>`;
          })()
        : `<button class="link" id="enter-select" style="padding:4px 0;">Selecionar</button>`)}
    </div>
    ${despesasPeriod.length === 0 ? `
      <div class="empty"><span class="ico">${icon('card', 48)}</span>${hasFilter ? 'Nenhuma despesa para os filtros aplicados.' : 'Nenhuma despesa no período.'}<br/><br/>
        <button class="primary" id="add-desp">Adicionar despesa</button></div>
    ` : `
      <ul class="list ${selectionMode ? 'selecting' : ''}">
        ${despesasPeriod.sort((a,b)=>b.data.localeCompare(a.data)).map(d => {
          const cat = state.categorias.find(c => c.id === d.categoriaId);
          const dTags = d.tags || [];
          const isReal = !d._virtual;
          const sel = selectedIds.has(d.id);
          return `
          <li class="swipe-row ${selectionMode ? 'select-row' : ''}" data-id="${d.id}" data-data="${d.data}" data-real="${isReal}">
            ${selectionMode ? `
              <span class="select-circle ${sel ? 'checked' : ''} ${isReal ? '' : 'disabled'}" ${isReal ? '' : 'title="Ocorrência projetada — não pode ser selecionada"'}>${sel ? '✓' : ''}</span>
            ` : ''}
            ${catEmoji(cat)
              ? `<span class="cat-emoji" style="background:${cat.cor}22;">${catEmoji(cat)}</span>`
              : `<span class="swatch" style="background:${cat ? cat.cor : '#999'}"></span>`}
            <div class="grow">
              <div class="t">${escapeHTML(d.descricao || (cat ? cat.nome : 'Despesa'))}
                ${d.recorrente ? '<span class="tag recurring">Mensal</span>' : ''}
                ${d._parcelaTotal ? `<span class="tag installment">${d._parcelaNum}/${d._parcelaTotal}</span>` : ''}
                ${d._pago ? '' : '<span class="tag pendente">Pendente</span>'}
              </div>
              <div class="s">${fmtDate(d.data)} · ${cat ? escapeHTML(cat.nome) : 'Sem categoria'}</div>
              ${dTags.length > 0 ? `
                <div class="tags-row">
                  ${dTags.map(t => `<span class="tag usertag">#${escapeHTML(t)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="amount neg">${fmtBRL(d.valor)}</div>
            ${!d._virtual && !selectionMode ? `
              <div class="swipe-actions">
                <button class="edit" data-action="edit-desp">Editar</button>
                <button class="del"  data-action="del-desp">Excluir</button>
              </div>
            ` : ''}
          </li>`;
        }).join('')}
      </ul>
    `}

    ${selectionMode ? `
      <div class="select-bar">
        <span class="count">${selectedIds.size} selecionada${selectedIds.size === 1 ? '' : 's'}</span>
        <button class="link" id="cancel-select">Cancelar</button>
        <button class="danger" id="delete-select" style="padding:8px 14px;" ${selectedIds.size === 0 ? 'disabled' : ''}>Apagar</button>
      </div>
    ` : `<button class="fab" id="fab-desp" aria-label="Adicionar despesa">+</button>`}
  `;

  if (selectionMode) {
    // Tap numa linha real alterna a selecao. Linhas virtuais (ocorrencias
    // projetadas) sao ignoradas — nao existem como registro proprio.
    root.querySelectorAll('.select-row[data-real="true"]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        render({ preserveScroll: true });
      });
    });
    const selAllBtn = root.querySelector('#select-all');
    if (selAllBtn) selAllBtn.addEventListener('click', () => {
      const realIds = despesasPeriod.filter(d => !d._virtual).map(d => d.id);
      const allSel = realIds.length > 0 && realIds.every(id => selectedIds.has(id));
      if (allSel) realIds.forEach(id => selectedIds.delete(id));
      else realIds.forEach(id => selectedIds.add(id));
      render({ preserveScroll: true });
    });
    root.querySelector('#cancel-select').addEventListener('click', () => {
      selectionMode = false; selectedIds.clear(); render({ preserveScroll: true });
    });
    root.querySelector('#delete-select').addEventListener('click', () => {
      const n = selectedIds.size;
      if (n === 0) return;
      if (!confirm(`Apagar ${n} despesa${n === 1 ? '' : 's'}? Recorrentes/parceladas marcadas serão removidas por completo.`)) return;
      for (const id of selectedIds) db.removeDespesa(id);
      selectionMode = false; selectedIds.clear();
      toast(`${n} despesa${n === 1 ? '' : 's'} excluída${n === 1 ? '' : 's'}`);
      render();
    });
  } else {
    bindSwipe(root);

    // Tap na linha abre os detalhes (descricao completa, valor, tipo, etc).
    // Ignora clicks nas swipe-actions (editar/excluir) e tambem se a linha
    // estiver com swipe aberto — ai o tap so fecha o swipe.
    root.querySelectorAll('.swipe-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.swipe-actions')) return;
        if (row.classList.contains('open')) { row.classList.remove('open'); return; }
        const occ = expanded.find(x => x.id === row.dataset.id && x.data === row.dataset.data);
        if (occ) sheetDespesaDetalhes(occ);
      });
    });

    root.querySelectorAll('[data-action="edit-desp"]').forEach(b => b.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      sheetDespesa(state.despesas.find(x => x.id === id));
    }));
    root.querySelectorAll('[data-action="del-desp"]').forEach(b => b.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      if (confirm('Excluir esta despesa?')) { db.removeDespesa(id); toast('Despesa excluída'); render(); }
    }));
    const enterSelBtn = root.querySelector('#enter-select');
    if (enterSelBtn) enterSelBtn.addEventListener('click', () => { selectionMode = true; selectedIds.clear(); render({ preserveScroll: true }); });
  }
  root.querySelectorAll('#tag-filter .chip').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (!t) tagFilter.clear();
    else tagFilter.has(t) ? tagFilter.delete(t) : tagFilter.add(t);
    render();
  }));
  root.querySelectorAll('#cat-filter .chip').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.cat;
    if (!c) categoryFilter.clear();
    else categoryFilter.has(c) ? categoryFilter.delete(c) : categoryFilter.add(c);
    render();
  }));
  root.querySelectorAll('#status-filter .chip').forEach(b => b.addEventListener('click', () => {
    statusFilter = b.dataset.status || null;
    render();
  }));
  root.querySelectorAll('#type-filter .chip').forEach(b => b.addEventListener('click', () => {
    typeFilter = b.dataset.type || null;
    render();
  }));
  const searchEl = root.querySelector('#search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      searchQuery = searchEl.value;
      render();
      // O re-render destrói o input antigo; recoloca o foco e o cursor no fim
      // do novo input para que a digitação continue sem perder o teclado.
      const newSearch = document.querySelector('#search');
      if (newSearch) {
        newSearch.focus();
        const len = newSearch.value.length;
        try { newSearch.setSelectionRange(len, len); } catch {}
      }
    });
  }
  const clearBtn = root.querySelector('#clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    searchQuery = ''; categoryFilter.clear(); tagFilter.clear(); statusFilter = null; typeFilter = null;
    render();
  });
  const addBtn = root.querySelector('#add-desp');
  if (addBtn) addBtn.addEventListener('click', () => sheetDespesa());
  const fab = root.querySelector('#fab-desp');
  if (fab) fab.addEventListener('click', () => sheetDespesa());
  bindPeriodHeader(root);
};

// ----- Categorias -----
views.categorias = (root) => {
  const monthPeriod = (() => {
    const today = new Date();
    return { type: 'month', year: today.getFullYear(), value: today.getMonth() + 1 };
  })();
  const despesasMes = expandWithRecurring(state.despesas, monthPeriod);
  const gastoPorCat = new Map();
  for (const d of despesasMes) {
    if (!d.categoriaId) continue;
    gastoPorCat.set(d.categoriaId, (gastoPorCat.get(d.categoriaId) || 0) + (d.valor || 0));
  }

  root.innerHTML = `
    <p style="color:var(--text-2);margin:4px 4px 14px;font-size:14px;">
      Toque numa categoria pra ver o histórico. Segure o ≡ para arrastar e reordenar; arraste a linha pra esquerda para editar/excluir.
    </p>
    ${state.categorias.length === 0 ? `
      <div class="empty"><span class="ico">${icon('tag', 48)}</span>Nenhuma categoria.</div>
    ` : `
      <ul class="list" id="cat-list">
        ${state.categorias.map(c => {
          const gasto = gastoPorCat.get(c.id) || 0;
          const pct = c.meta ? Math.min(100, Math.round((gasto / c.meta) * 100)) : null;
          // Pra poupanca, guardar mais eh bom — barra sempre "good" (sem warn/over).
          const cls = (!c.meta || c.poupanca) ? '' : (gasto > c.meta ? 'over' : (gasto > c.meta*0.8 ? 'warn' : ''));
          const metaLabel = c.poupanca ? 'guardado / meta' : '';
          return `
            <li class="swipe-row cat-row" data-id="${c.id}">
              ${catEmoji(c)
                ? `<span class="cat-emoji" style="background:${c.cor}22;">${catEmoji(c)}</span>`
                : `<span class="swatch" style="background:${c.cor}"></span>`}
              <div class="grow">
                <div class="t">${escapeHTML(c.nome)}${c.poupanca ? '<span class="tag poupanca">Investimento</span>' : ''}</div>
                ${c.meta ? `
                  <div class="s">${fmtBRL(gasto)} / ${fmtBRL(c.meta)}${metaLabel ? ' '+metaLabel : ' este mês'} · ${pct}%</div>
                  <div class="progress"><i class="${cls}" style="width:${Math.min(100,pct)}%"></i></div>
                ` : `<div class="s">${c.poupanca ? 'Sem meta' : 'Sem meta'} · ${fmtBRL(gasto)} ${c.poupanca ? 'guardado' : ''} este mês</div>`}
              </div>
              <span class="drag-handle" aria-label="Arrastar para reordenar">≡</span>
              <div class="swipe-actions">
                <button class="edit" data-action="edit-cat">Editar</button>
                <button class="del"  data-action="del-cat">Excluir</button>
              </div>
            </li>`;
        }).join('')}
      </ul>
    `}

    <button class="fab" id="fab-cat" aria-label="Adicionar categoria">+</button>
  `;

  bindSwipe(root);

  // Drag-and-drop para reordenar. Long-press de 200ms na "alça" (≡) inicia o
  // arrasto — sem isso o swipe horizontal pra revelar editar/excluir conflita.
  const ulCat = root.querySelector('#cat-list');
  if (ulCat && window.Sortable) {
    new Sortable(ulCat, {
      animation: 150,
      handle: '.drag-handle',
      delay: 200,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => {
        const ids = [...ulCat.querySelectorAll('[data-id]')].map(li => li.dataset.id);
        db.reorderCategorias(ids);
      },
    });
  }

  root.querySelectorAll('[data-action="edit-cat"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    sheetCategoria(state.categorias.find(x => x.id === id));
  }));
  root.querySelectorAll('[data-action="del-cat"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    const c = state.categorias.find(x => x.id === id);
    if (!c) return;
    const nDesp = state.despesas.filter(d => d.categoriaId === id).length;
    const msg = nDesp > 0
      ? `Excluir "${c.nome}"? ${nDesp} despesa(s) ficarão sem categoria.`
      : `Excluir "${c.nome}"?`;
    if (confirm(msg)) { db.removeCategoria(id); toast('Categoria excluída'); render(); }
  }));
  // Tap na linha (fora das swipe-actions / drag-handle) abre o historico.
  root.querySelectorAll('.cat-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.swipe-actions') || e.target.closest('.drag-handle')) return;
      if (row.classList.contains('open')) { row.classList.remove('open'); return; }
      const c = state.categorias.find(x => x.id === row.dataset.id);
      if (c) sheetCategoriaHistorico(c);
    });
  });
  root.querySelector('#fab-cat').addEventListener('click', () => sheetCategoria());
};

// Sheet de historico de uma categoria — mini grafico dos ultimos 6 meses de
// gasto nela + media mensal, maior mes e acumulado. Tap numa categoria abre.
const sheetCategoriaHistorico = (c) => {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }
  const valores = months.map(({ y, m }) =>
    sumAmount(expandWithRecurring(state.despesas, { type: 'month', year: y, value: m })
      .filter(d => d.categoriaId === c.id)));
  const totalAcum = valores.reduce((a, b) => a + b, 0);
  const mediaMes = Math.round(totalAcum / months.length);
  const maxIdx = valores.reduce((mi, v, i, arr) => v > arr[mi] ? i : mi, 0);
  const maxVal = valores[maxIdx];
  const verbo = c.poupanca ? 'Guardado' : 'Gasto';

  openSheet(`${catEmoji(c) ? catEmoji(c) + ' ' : ''}${c.nome}`, () => `
    <div class="chart-wrap" style="height:200px;"><canvas id="ch-cat-hist"></canvas></div>
    <ul class="details-list" style="margin-top:8px;">
      <li><span>Média mensal</span><span>${fmtBRL(mediaMes)}</span></li>
      <li><span>Maior mês</span><span>${fmtBRL(maxVal)} (${monthName(months[maxIdx].m, true)}/${String(months[maxIdx].y).slice(2)})</span></li>
      <li><span>Acumulado (6 meses)</span><span>${fmtBRL(totalAcum)}</span></li>
      ${c.meta ? `<li><span>${c.poupanca ? 'Meta de investimento' : 'Limite mensal'}</span><span>${fmtBRL(c.meta)}</span></li>` : ''}
    </ul>
    <div class="actions">
      <button class="secondary" id="close">Fechar</button>
      <button class="primary"   id="edit-cat-hist">Editar categoria</button>
    </div>
  `, (body) => {
    body.querySelector('#close').addEventListener('click', closeSheet);
    body.querySelector('#edit-cat-hist').addEventListener('click', () => {
      closeSheet();
      sheetCategoria(state.categorias.find(x => x.id === c.id));
    });
    const canvas = body.querySelector('#ch-cat-hist');
    if (canvas && window.Chart) {
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: months.map(({ m }) => monthName(m, true)),
          datasets: [{
            label: verbo,
            data: valores.map(v => v / 100),
            backgroundColor: c.cor,
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => `${verbo}: ${fmtBRL(ctx.parsed.y * 100)}` } },
          },
          scales: {
            x: { ticks: { color: getCSS('--text-2'), font: { size: 11 } }, grid: { display: false } },
            y: { ticks: { color: getCSS('--text-2'), callback: v => state.config.valuesHidden ? '' : `R$${v}` }, grid: { color: getCSS('--separator') } },
          },
        },
      });
    }
  });
};

// ----- Investimentos (aba) -----
// Sub-abas: "Investimentos" (aportes = despesas em categorias marcadas como
// investimento) e "Objetivos" (metas de investimento). investSub guarda a ativa.
let investSub = 'aportes'; // 'aportes' | 'objetivos'

// Ids das categorias marcadas como investimento (flag poupanca).
const investCategoriaIds = () => new Set(state.categorias.filter(c => c.poupanca).map(c => c.id));

views.investimentos = (root) => {
  const seg = `
    <div class="segmented invest-subtabs">
      <button data-sub="aportes"   class="${investSub==='aportes'?'active':''}">Investimentos</button>
      <button data-sub="objetivos" class="${investSub==='objetivos'?'active':''}">Objetivos</button>
    </div>`;
  if (investSub === 'objetivos') renderObjetivosSub(root, seg);
  else renderAportesSub(root, seg);
  root.querySelectorAll('.invest-subtabs button').forEach(b => b.addEventListener('click', () => {
    investSub = b.dataset.sub;
    render();
  }));
};

// Linha de um lançamento de investimento (mesma cara da despesa, ações próprias).
const investRowHTML = (d) => {
  const cat = state.categorias.find(c => c.id === d.categoriaId);
  const dTags = d.tags || [];
  return `
    <li class="swipe-row" data-id="${d.id}" data-data="${d.data}" data-real="${!d._virtual}">
      ${catEmoji(cat)
        ? `<span class="cat-emoji" style="background:${cat.cor}22;">${catEmoji(cat)}</span>`
        : `<span class="swatch" style="background:${cat ? cat.cor : '#999'}"></span>`}
      <div class="grow">
        <div class="t">${escapeHTML(d.descricao || (cat ? cat.nome : 'Investimento'))}
          ${d.recorrente ? '<span class="tag recurring">Mensal</span>' : ''}
          ${d._parcelaTotal ? `<span class="tag installment">${d._parcelaNum}/${d._parcelaTotal}</span>` : ''}
          ${d._pago ? '' : '<span class="tag pendente">Pendente</span>'}
        </div>
        <div class="s">${fmtDate(d.data)} · ${cat ? escapeHTML(cat.nome) : 'Sem categoria'}</div>
        ${dTags.length > 0 ? `<div class="tags-row">${dTags.map(t => `<span class="tag usertag">#${escapeHTML(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="amount">${fmtBRL(d.valor)}</div>
      ${!d._virtual ? `
        <div class="swipe-actions">
          <button class="edit" data-action="edit-invest">Editar</button>
          <button class="del"  data-action="del-invest">Excluir</button>
        </div>
      ` : ''}
    </li>`;
};

// Sub-aba "Investimentos": total + lista dos aportes do período.
const renderAportesSub = (root, seg) => {
  const invIds = investCategoriaIds();
  const all = expandWithRecurring(state.despesas, period).filter(d => invIds.has(d.categoriaId));
  const total = sumAmount(all);
  const lancs = [...all].sort((a, b) => b.data.localeCompare(a.data));
  root.innerHTML = `
    ${seg}
    ${periodHeader()}
    <div class="card">
      <h2>Total investido em ${periodLabel()}</h2>
      <div class="big">${fmtBRL(total)}</div>
    </div>
    ${invIds.size === 0 ? `
      <div class="empty"><span class="ico">${icon('trending', 48)}</span>
        Nenhuma categoria de investimento ainda.<br/><br/>
        Crie uma categoria marcando <strong>"É investimento"</strong> para começar a registrar aportes.
      </div>
    ` : (lancs.length === 0 ? `
      <div class="empty"><span class="ico">${icon('trending', 48)}</span>Nenhum investimento no período.<br/><br/>
        <button class="primary" id="add-invest">Adicionar investimento</button></div>
    ` : `
      <div class="section-title">Lançamentos</div>
      <ul class="list">
        ${lancs.map(d => investRowHTML(d)).join('')}
      </ul>
    `)}
    <button class="fab" id="fab-invest" aria-label="Adicionar investimento">+</button>
  `;
  bindSwipe(root);
  root.querySelectorAll('.swipe-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.swipe-actions')) return;
      if (row.classList.contains('open')) { row.classList.remove('open'); return; }
      const occ = all.find(x => x.id === row.dataset.id && x.data === row.dataset.data);
      if (occ) sheetDespesaDetalhes(occ);
    });
  });
  root.querySelectorAll('[data-action="edit-invest"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    sheetDespesa(state.despesas.find(x => x.id === id), { investimento: true });
  }));
  root.querySelectorAll('[data-action="del-invest"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    if (confirm('Excluir este investimento?')) { db.removeDespesa(id); toast('Investimento excluído'); render(); }
  }));
  const addBtn = root.querySelector('#add-invest');
  if (addBtn) addBtn.addEventListener('click', () => sheetDespesa(null, { investimento: true }));
  root.querySelector('#fab-invest').addEventListener('click', () => sheetDespesa(null, { investimento: true }));
  bindPeriodHeader(root);
};

// Sub-aba "Objetivos": metas de investimento (lista + progresso).
const renderObjetivosSub = (root, seg) => {
  const objetivos = state.objetivos || [];
  root.innerHTML = `
    ${seg}
    <p style="color:var(--text-2);margin:4px 4px 14px;font-size:14px;">
      Defina metas de investimento e linke as categorias que contam pra cada uma. Arraste a linha pra esquerda pra editar/excluir.
    </p>
    ${objetivos.length === 0 ? `
      <div class="empty"><span class="ico">${icon('target', 48)}</span>Nenhum objetivo ainda.<br/><br/>
        <button class="primary" id="add-obj">Criar objetivo</button></div>
    ` : `
      <ul class="list">
        ${objetivos.map(o => objetivoRowHTML(o)).join('')}
      </ul>
    `}
    <button class="fab" id="fab-obj" aria-label="Adicionar objetivo">+</button>
  `;
  bindSwipe(root);
  root.querySelectorAll('[data-action="edit-obj"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    sheetObjetivo(state.objetivos.find(x => x.id === id));
  }));
  root.querySelectorAll('[data-action="del-obj"]').forEach(b => b.addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    const o = state.objetivos.find(x => x.id === id);
    if (o && confirm(`Excluir o objetivo "${o.nome}"?`)) { db.removeObjetivo(id); toast('Objetivo excluído'); render(); }
  }));
  const addBtn = root.querySelector('#add-obj');
  if (addBtn) addBtn.addEventListener('click', () => sheetObjetivo());
  root.querySelector('#fab-obj').addEventListener('click', () => sheetObjetivo());
};

// Linha de um objetivo (lista da aba Objetivos): barra de progresso + numeros
// + (se houver prazo) quanto precisa por mes + (se houver aportes) projecao no
// ritmo atual.
const objetivoRowHTML = (o) => {
  const atual = objetivoAtual(o);
  const pct = o.alvo > 0 ? Math.min(100, Math.round(atual / o.alvo * 100)) : 0;
  const falta = Math.max(0, o.alvo - atual);
  const done = atual >= o.alvo;
  let prazoLine = '';
  if (o.prazo) {
    const m = monthsUntil(o.prazo);
    prazoLine = done
      ? `Concluído antes do prazo (${fmtDate(o.prazo)})`
      : (m > 0
          ? `Prazo ${fmtDate(o.prazo)} · ${m} ${m === 1 ? 'mês' : 'meses'} · ~${fmtBRL(Math.ceil(falta / m))}/mês pra bater`
          : `Prazo ${fmtDate(o.prazo)} venceu · faltam ${fmtBRL(falta)}`);
  }
  let ritmoLine = '';
  if (!done) {
    const ritmo = objetivoRitmo(o);
    if (ritmo > 0) {
      const mesesNoRitmo = Math.ceil(falta / ritmo);
      const proj = new Date(); proj.setMonth(proj.getMonth() + mesesNoRitmo);
      ritmoLine = `No ritmo de ~${fmtBRL(ritmo)}/mês: chega em ${monthName(proj.getMonth() + 1, true)}/${String(proj.getFullYear()).slice(2)}`;
    }
  }
  return `
    <li class="swipe-row" data-id="${o.id}">
      <div class="grow">
        <div class="t">${escapeHTML(o.nome)}${done ? '<span class="tag poupanca">Concluído</span>' : ''}</div>
        <div class="s">${fmtBRL(atual)} de ${fmtBRL(o.alvo)} · ${pct}%${done ? '' : ` · faltam ${fmtBRL(falta)}`}</div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        ${prazoLine ? `<div class="s" style="margin-top:4px;">${prazoLine}</div>` : ''}
        ${ritmoLine ? `<div class="s">${ritmoLine}</div>` : ''}
      </div>
      <div class="swipe-actions">
        <button class="edit" data-action="edit-obj">Editar</button>
        <button class="del"  data-action="del-obj">Excluir</button>
      </div>
    </li>`;
};

const sheetObjetivo = (obj) => {
  const isEdit = !!obj;
  const o = obj || { nome: '', alvo: 0, prazo: '', desde: '', categoriaIds: [] };
  const linkedSet = new Set(o.categoriaIds || []);
  // Objetivos contam só categorias de investimento.
  const investCats = state.categorias.filter(c => c.poupanca);
  openSheet(isEdit ? 'Editar objetivo' : 'Novo objetivo', () => `
    <label class="field"><span>Nome</span>
      <input id="o-nome" type="text" placeholder="Ex.: Reserva de emergência, Viagem, Carro" value="${escapeAttr(o.nome || '')}" required />
    </label>
    <label class="field"><span>Valor-alvo (R$)</span>
      <input id="o-alvo" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(o.alvo)}" required />
    </label>
    <label class="field"><span>Prazo (opcional)</span>
      <input id="o-prazo" type="date" value="${o.prazo || ''}" />
    </label>
    <label class="field"><span>Categorias que contam pra esse objetivo</span>
      <div class="check-list" id="o-cats">
        ${investCats.length === 0
          ? '<p style="color:var(--text-2);font-size:13px;margin:0;">Crie uma categoria marcada como "É investimento" primeiro.</p>'
          : investCats.map(c => `
            <label class="check-item">
              <input type="checkbox" data-cat="${c.id}" ${linkedSet.has(c.id) ? 'checked' : ''}/>
              ${catEmoji(c) ? `<span class="cat-emoji" style="background:${c.cor}22;">${catEmoji(c)}</span>` : `<span class="swatch" style="background:${c.cor}"></span>`}
              <span>${escapeHTML(c.nome)}</span>
            </label>`).join('')}
      </div>
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Só aparecem categorias marcadas como investimento.
      </small>
    </label>
    <label class="field"><span>Contar lançamentos a partir de (opcional)</span>
      <input id="o-desde" type="date" value="${o.desde || ''}" />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Vazio = conta tudo o que já existe nessas categorias.
      </small>
    </label>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Criar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#o-alvo'));
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const data = {
        nome: body.querySelector('#o-nome').value.trim(),
        alvo: parseAmount(body.querySelector('#o-alvo').value),
        prazo: body.querySelector('#o-prazo').value || null,
        desde: body.querySelector('#o-desde').value || null,
        categoriaIds: [...body.querySelectorAll('#o-cats input:checked')].map(el => el.dataset.cat),
      };
      if (!data.nome) { alert('Informe um nome.'); return; }
      if (data.alvo <= 0) { alert('Informe um valor-alvo válido.'); return; }
      if (isEdit) db.updateObjetivo(o.id, data); else db.addObjetivo(data);
      closeSheet();
      toast(isEdit ? 'Objetivo atualizado' : 'Objetivo criado');
      render();
    });
  });
};

// ----- Configurações -----
views.config = (root) => {
  const tema = state.config.tema || 'system';
  const textSize = state.config.textSize || 'normal';
  root.innerHTML = `
    <div class="card">
      <h2>Aparência</h2>
      <div class="segmented" id="theme-picker">
        <button data-t="system" class="${tema==='system'?'active':''}">Sistema</button>
        <button data-t="light"  class="${tema==='light'?'active':''}">Claro</button>
        <button data-t="dark"   class="${tema==='dark'?'active':''}">Escuro</button>
      </div>
      <p style="color:var(--text-2);font-size:13px;margin:10px 2px 14px;">
        "Sistema" segue o tema do dispositivo automaticamente.
      </p>

      <label class="field" style="margin-bottom:14px;">
        <span>Tamanho do texto</span>
        <div class="segmented" id="text-size">
          <button data-size="small"  class="${textSize==='small' ?'active':''}">Pequeno</button>
          <button data-size="normal" class="${textSize==='normal'?'active':''}">Padrão</button>
          <button data-size="large"  class="${textSize==='large' ?'active':''}">Grande</button>
        </div>
      </label>

      <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
        <input id="f-cat-icons" type="checkbox" ${iconsEnabled()?'checked':''}/>
        <label for="f-cat-icons">Mostrar ícones das categorias</label>
      </div>
      <p style="color:var(--text-2);font-size:13px;margin:6px 2px 0;">
        Quando desligado, mostra só a cor da categoria (sem o emoji).
      </p>
    </div>

    <div class="card">
      <h2>Privacidade</h2>
      ${lockSupported() ? `
        <div class="checkbox-row">
          <input id="f-lock" type="checkbox" ${lockEnabled() ? 'checked' : ''}/>
          <label for="f-lock">Exigir biometria/PIN ao abrir o app</label>
        </div>
        <p style="color:var(--text-2);font-size:13px;margin:8px 2px 14px;">
          Usa o desbloqueio nativo do dispositivo (Face ID, Touch ID, digital ou PIN).
          Nenhum dado sai daqui.
        </p>
      ` : `
        <p style="color:var(--text-2);font-size:14px;margin:6px 2px 14px;">
          Este navegador não suporta biometria via WebAuthn.
        </p>
      `}

      <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
        <input id="f-hide" type="checkbox" ${state.config.valuesHidden?'checked':''}/>
        <label for="f-hide">Ocultar valores em R$ por padrão</label>
      </div>
      <p style="color:var(--text-2);font-size:13px;margin:6px 2px 0;">
        Substitui valores por <code>R$ ••••</code> em toda a tela. Você pode alternar
        rapidinho pelo ícone de olho na barra do topo.
      </p>
    </div>

    ${(() => {
      // Controles de um grafico (categoria/tag) — 5 toggles + segmented de tipo.
      // prefix='Cat'/'Tag', idSuf='cat'/'tag' nos ids; cfg() le com fallback legacy.
      const dashControls = (prefix, idSuf, extraTail) => {
        const tipo = cfg('DonutType', prefix) || 'donut';
        return `
          <div class="checkbox-row" style="padding-top:0;">
            <input id="f-dash-${idSuf}-donut-show" type="checkbox" ${cfg('DonutShow', prefix)!==false?'checked':''}/>
            <label for="f-dash-${idSuf}-donut-show">Exibir gráfico</label>
          </div>
          <label class="field" style="margin:10px 0 0;">
            <span>Tipo do gráfico</span>
            <div class="segmented" id="dash-${idSuf}-donut-type">
              <button data-type="donut" class="${tipo==='donut'?'active':''}">Donut</button>
              <button data-type="pie"   class="${tipo==='pie'  ?'active':''}">Pizza</button>
              <button data-type="bars"  class="${tipo==='bars' ?'active':''}">Barras</button>
            </div>
          </label>
          ${tipo !== 'bars' ? `
            <div class="checkbox-row" style="margin-top:14px;">
              <input id="f-dash-${idSuf}-donut-inner" type="checkbox" ${cfg('DonutInnerPct', prefix)?'checked':''}/>
              <label for="f-dash-${idSuf}-donut-inner">Mostrar % dentro das fatias</label>
            </div>
          ` : ''}
          <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
            <input id="f-dash-${idSuf}-list-show" type="checkbox" ${cfg('ListShow', prefix)!==false?'checked':''}/>
            <label for="f-dash-${idSuf}-list-show">Exibir lista</label>
          </div>
          <div class="checkbox-row">
            <input id="f-dash-${idSuf}-list-pct" type="checkbox" ${cfg('ListPct', prefix)!==false?'checked':''}/>
            <label for="f-dash-${idSuf}-list-pct">Mostrar % na lista</label>
          </div>
          ${extraTail || ''}
        `;
      };

      const tagSplitMode = state.config.dashTagSplit !== false ? 'split' : 'each';
      const tagExtra = `
        <div style="border-top:1px solid var(--separator);padding-top:14px;margin-top:14px;">
          <div class="checkbox-row" style="padding-top:0;">
            <input id="f-dash-tag-show" type="checkbox" ${state.config.dashTagShow?'checked':''}/>
            <label for="f-dash-tag-show">Exibir card de despesas por tag</label>
          </div>
          <label class="field" style="margin:10px 0 0;">
            <span>Como contar despesas com várias tags</span>
            <div class="segmented" id="dash-tag-split">
              <button data-mode="split" class="${tagSplitMode==='split'?'active':''}">Dividir entre tags</button>
              <button data-mode="each"  class="${tagSplitMode==='each' ?'active':''}">Contar em cada tag</button>
            </div>
          </label>
          <p style="color:var(--text-2);font-size:13px;margin:8px 2px 0;">
            "Dividir": despesa de R$100 com 2 tags vira R$50 em cada (soma bate com total real).
            "Contar em cada": cada tag recebe o valor inteiro (a soma pode passar do total).
          </p>
        </div>`;

      const cardsControls = `
        <div class="checkbox-row" style="padding-top:0;">
          <input id="f-dash-compare-show" type="checkbox" ${state.config.dashCompareShow!==false?'checked':''}/>
          <label for="f-dash-compare-show">Comparação com mês anterior</label>
        </div>
        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-bars-show" type="checkbox" ${state.config.dashBarsShow!==false?'checked':''}/>
          <label for="f-dash-bars-show">Gráfico de Receitas vs Despesas</label>
        </div>
        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-upcoming-show" type="checkbox" ${state.config.dashUpcomingShow!==false?'checked':''}/>
          <label for="f-dash-upcoming-show">Vencimentos (pendentes e atrasados)</label>
        </div>
        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-goals-show" type="checkbox" ${state.config.dashGoalsShow!==false?'checked':''}/>
          <label for="f-dash-goals-show">Objetivos (progresso das metas)</label>
        </div>
        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-health-show" type="checkbox" ${state.config.dashHealthShow!==false?'checked':''}/>
          <label for="f-dash-health-show">Saúde financeira (indicadores)</label>
        </div>
        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-invest-show" type="checkbox" ${state.config.dashInvestShow!==false?'checked':''}/>
          <label for="f-dash-invest-show">Investimentos por categoria</label>
        </div>
      `;

      const hm = healthMetas();
      const healthControls = `
        <p style="color:var(--text-2);font-size:13px;margin:0 2px 14px;">
          Definem a cor dos indicadores e a nota do índice. A linha de "atenção" é derivada da meta.
        </p>
        <label class="field"><span>Taxa de investimento — meta mínima (%)</span>
          <input id="f-health-invest" type="number" min="1" max="100" inputmode="numeric" value="${hm.invest}" />
          <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">Quanto da renda você quer guardar/investir. Atingir ou passar = verde.</small>
        </label>
        <label class="field"><span>Gastos / renda — limite ideal (%)</span>
          <input id="f-health-gastos" type="number" min="1" max="100" inputmode="numeric" value="${hm.gastos}" />
          <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">Até quanto da renda os gastos podem consumir. Ficar abaixo = verde.</small>
        </label>
        <label class="field" style="margin-bottom:6px;"><span>Custo fixo / renda — limite ideal (%)</span>
          <input id="f-health-fixo" type="number" min="1" max="100" inputmode="numeric" value="${hm.fixo}" />
          <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">Peso das despesas recorrentes (não-investimento) na renda.</small>
        </label>
        <button class="link" id="health-reset" style="padding:4px 0 0;">Restaurar padrões (20% / 70% / 50%)</button>
      `;

      return `
        <div class="card">
          <h2>Personalizar dashboard</h2>
          <p style="color:var(--text-2);font-size:14px;margin:6px 0 0;">
            Toque numa seção pra expandir os controles.
          </p>
          ${subSection('ajGrpCards',  'Cards do dashboard', cardsControls)}
          ${subSection('ajGrpHealth', 'Metas da saúde financeira', healthControls)}
          ${subSection('ajGrpCat',    'Gráfico de despesas por categoria', dashControls('Cat', 'cat'))}
          ${subSection('ajGrpInvest', 'Gráfico de investimentos por categoria', dashControls('Invest', 'invest'))}
          ${subSection('ajGrpTag',    'Despesas por tag', dashControls('Tag', 'tag', tagExtra))}
        </div>
      `;
    })()}

    <div class="card">
      <h2>Backup</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
        Os dados ficam apenas neste dispositivo. Faça backup regularmente
        para não perder histórico.
      </p>
      ${state.lastBackupAt ? `
        <p style="color:var(--text-2);font-size:13px;margin:0 0 12px;">
          Último backup: ${fmtDate(state.lastBackupAt)}${(() => {
            const d = daysSince(state.lastBackupAt);
            if (d === null) return '';
            if (d === 0) return ' · hoje';
            if (d === 1) return ' · há 1 dia';
            return ` · há ${d} dias`;
          })()}
        </p>
      ` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="primary"   id="export">Exportar dados</button>
        <button class="secondary" id="import">Importar dados</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />

      <div style="margin-top:16px;border-top:1px solid var(--separator);padding-top:14px;">
        <label class="field" style="margin-bottom:0;">
          <span>Lembrete de backup</span>
          <select id="backup-reminder">
            <option value="0"  ${(state.config.backupReminderDays|0)===0?'selected':''}>Desativado</option>
            <option value="7"  ${(state.config.backupReminderDays|0)===7?'selected':''}>A cada 7 dias</option>
            <option value="14" ${(state.config.backupReminderDays|0)===14?'selected':''}>A cada 14 dias</option>
            <option value="30" ${(state.config.backupReminderDays|0)===30?'selected':''}>A cada 30 dias</option>
          </select>
        </label>
        <p style="color:var(--text-2);font-size:13px;margin:8px 0 0;">
          O navegador não permite que o app salve arquivos sozinho no aparelho,
          mas o dashboard vai avisar quando estiver na hora de exportar.
        </p>
      </div>
    </div>

    <div class="card">
      <h2>Resumo dos dados</h2>
      <ul class="list" style="box-shadow:none;">
        <li><div class="grow">Receitas</div><div class="amount">${state.rendas.length}</div></li>
        <li><div class="grow">Despesas</div><div class="amount">${state.despesas.length}</div></li>
        <li><div class="grow">Categorias</div><div class="amount">${state.categorias.length}</div></li>
      </ul>
    </div>

    ${(() => {
      const meta = profileStore.meta();
      return `
        <div class="card">
          <h2>Perfis</h2>
          <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
            Cada perfil tem dados, categorias e backups separados. Bloqueio
            biométrico e preferências visuais são compartilhados entre perfis.
          </p>
          <ul class="list" style="box-shadow:none;">
            ${meta.list.map(p => `
              <li data-pid="${p.id}">
                <div class="grow">
                  <div class="t">${escapeHTML(p.name)}${p.id===meta.current?' <span class="tag" style="background:rgba(10,132,255,.15);color:var(--tint);margin-left:6px;">atual</span>':''}</div>
                </div>
                <button class="link" data-action="rename-profile">Renomear</button>
                ${meta.list.length > 1 && p.id !== meta.current ? `<button class="link" data-action="delete-profile" style="color:var(--red);">Excluir</button>` : ''}
              </li>
            `).join('')}
          </ul>
          <button class="primary" id="add-profile" style="margin-top:12px;">+ Novo perfil</button>
        </div>
      `;
    })()}

    <div class="card">
      <h2>Manutenção</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
        Limpa o cache do app e recarrega — útil se algo travou ou se a versão
        nova não chegou. Seus dados não são afetados.
      </p>
      <button class="secondary" id="force-refresh">Forçar atualização do app</button>
    </div>

    <div class="card">
      <h2>Zona perigosa</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
        Apaga todos os dados deste dispositivo. Faça backup antes.
      </p>
      <button class="danger" id="reset">Apagar tudo</button>
    </div>

    <div class="card">
      <h2>Sobre</h2>
      <p style="margin:4px 0 4px;font-weight:600;font-size:16px;">Finanças PWA</p>
      <p style="color:var(--text-2);font-size:14px;margin:0 0 12px;">
        Sem servidor — todos os dados ficam neste aparelho.
      </p>
      <ul class="list" style="box-shadow:none;">
        <li><div class="grow">Versão</div><div class="amount">${APP_VERSION}</div></li>
        <li><div class="grow">Lançamentos</div><div class="amount">${state.rendas.length + state.despesas.length}</div></li>
        ${(() => {
          const all = [...state.rendas, ...state.despesas];
          if (!all.length) return '';
          const oldest = all.reduce((min, x) => x.data < min ? x.data : min, all[0].data);
          const days = daysSince(oldest);
          return `<li><div class="grow">Em uso há</div><div class="amount">${days === 0 ? 'hoje' : days === 1 ? '1 dia' : `${days} dias`}</div></li>`;
        })()}
      </ul>
      <button class="link" id="replay-onboarding" style="padding:8px 0 0;">Ver tutorial novamente</button>
    </div>
  `;

  root.querySelectorAll('#theme-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.t;
      updateConfig({ tema: t });
      applyTheme(t);
      render();
    });
  });

  root.querySelectorAll('#text-size button').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      updateConfig({ textSize: size });
      applyTextSize(size);
      render();
    });
  });

  const hideToggle = root.querySelector('#f-hide');
  if (hideToggle) {
    hideToggle.addEventListener('change', () => {
      updateConfig({ valuesHidden: hideToggle.checked });
      applyValuesVisibility();
      render();
    });
  }

  const catIconsToggle = root.querySelector('#f-cat-icons');
  if (catIconsToggle) {
    catIconsToggle.addEventListener('change', () => {
      updateConfig({ showCategoryIcons: catIconsToggle.checked });
      render();
    });
  }

  root.querySelector('#force-refresh').addEventListener('click', forceRefresh);

  const replayBtn = root.querySelector('#replay-onboarding');
  if (replayBtn) replayBtn.addEventListener('click', showOnboarding);

  // Card "Perfis" — renomear/excluir/criar.
  root.querySelectorAll('[data-action="rename-profile"]').forEach(b => {
    b.addEventListener('click', (e) => {
      const id = e.target.closest('[data-pid]').dataset.pid;
      sheetRenameProfile(id);
    });
  });
  root.querySelectorAll('[data-action="delete-profile"]').forEach(b => {
    b.addEventListener('click', (e) => {
      const id = e.target.closest('[data-pid]').dataset.pid;
      const meta = profileStore.meta();
      const p = meta.list.find(x => x.id === id);
      if (!p) return;
      if (!confirm(`Excluir o perfil "${p.name}"? Os dados desse perfil serão apagados deste dispositivo.`)) return;
      deleteProfileById(id);
      toast('Perfil excluído');
      render();
    });
  });
  const addProfileBtn = root.querySelector('#add-profile');
  if (addProfileBtn) addProfileBtn.addEventListener('click', sheetNewProfile);

  // Toggles do card "Personalizar dashboard". updateConfig ja persiste no
  // perfil + espelha no device-config (chaves dash* estao na lista de
  // device-wide), mantendo o layout consistente entre perfis.
  const wireToggle = (id, key) => {
    const el = root.querySelector(id);
    if (el) el.addEventListener('change', () => updateConfig({ [key]: el.checked }));
  };
  wireToggle('#f-dash-compare-show',    'dashCompareShow');
  wireToggle('#f-dash-bars-show',       'dashBarsShow');
  wireToggle('#f-dash-upcoming-show',   'dashUpcomingShow');
  wireToggle('#f-dash-goals-show',      'dashGoalsShow');
  wireToggle('#f-dash-health-show',     'dashHealthShow');
  wireToggle('#f-dash-invest-show',     'dashInvestShow');
  // Metas da saude financeira: campos numericos. Vazio/invalido -> null (volta
  // ao default em healthMetas). Sao por perfil (nao estao em DEVICE_CONFIG_KEYS).
  const wireNum = (id, key, max) => {
    const el = root.querySelector(id);
    if (!el) return;
    el.addEventListener('change', () => {
      let n = parseInt(el.value, 10);
      if (!Number.isFinite(n) || n < 1) n = null;
      else if (n > max) n = max;
      if (n != null) el.value = n;
      updateConfig({ [key]: n });
    });
  };
  wireNum('#f-health-invest',  'healthMetaInvest',  100);
  wireNum('#f-health-gastos',  'healthMetaGastos',  100);
  wireNum('#f-health-fixo',    'healthMetaFixo',    100);
  const healthReset = root.querySelector('#health-reset');
  if (healthReset) healthReset.addEventListener('click', () => {
    updateConfig({ healthMetaInvest: null, healthMetaGastos: null, healthMetaFixo: null, healthMetaReserva: null });
    toast('Metas restauradas');
    render({ preserveScroll: true });
  });
  wireToggle('#f-dash-tag-show',        'dashTagShow');
  // Categoria
  wireToggle('#f-dash-cat-donut-show',  'dashCatDonutShow');
  wireToggle('#f-dash-cat-donut-inner', 'dashCatDonutInnerPct');
  wireToggle('#f-dash-cat-list-show',   'dashCatListShow');
  wireToggle('#f-dash-cat-list-pct',    'dashCatListPct');
  root.querySelectorAll('#dash-cat-donut-type button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateConfig({ dashCatDonutType: btn.dataset.type });
      render({ preserveScroll: true });
    });
  });
  // Investimentos
  wireToggle('#f-dash-invest-donut-show',  'dashInvestDonutShow');
  wireToggle('#f-dash-invest-donut-inner', 'dashInvestDonutInnerPct');
  wireToggle('#f-dash-invest-list-show',   'dashInvestListShow');
  wireToggle('#f-dash-invest-list-pct',    'dashInvestListPct');
  root.querySelectorAll('#dash-invest-donut-type button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateConfig({ dashInvestDonutType: btn.dataset.type });
      render({ preserveScroll: true });
    });
  });
  // Tag
  wireToggle('#f-dash-tag-donut-show',  'dashTagDonutShow');
  wireToggle('#f-dash-tag-donut-inner', 'dashTagDonutInnerPct');
  wireToggle('#f-dash-tag-list-show',   'dashTagListShow');
  wireToggle('#f-dash-tag-list-pct',    'dashTagListPct');
  root.querySelectorAll('#dash-tag-donut-type button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateConfig({ dashTagDonutType: btn.dataset.type });
      render({ preserveScroll: true });
    });
  });
  root.querySelectorAll('#dash-tag-split button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateConfig({ dashTagSplit: btn.dataset.mode === 'split' });
      render({ preserveScroll: true });
    });
  });
  // Sub-secoes colapsaveis de "Personalizar dashboard" (mesmo mecanismo dos
  // cards do dashboard, chaves ajGrp*).
  root.querySelectorAll('[data-collapse]').forEach(h => {
    h.addEventListener('click', () => {
      const key = h.dataset.collapse;
      const cur = state.config.dashCollapsed || {};
      updateConfig({ dashCollapsed: { ...cur, [key]: !cur[key] } });
      render({ preserveScroll: true });
    });
  });

  const lockToggle = root.querySelector('#f-lock');
  if (lockToggle) {
    lockToggle.addEventListener('change', async () => {
      if (lockToggle.checked) {
        try {
          const credId = await lockRegister();
          lockStore.set({ enabled: true, credentialId: credId });
          toast('Bloqueio ativado');
        } catch (err) {
          lockToggle.checked = false;
          alert('Não foi possível ativar o bloqueio: ' + (err.message || err));
        }
      } else {
        lockStore.clear();
        toast('Bloqueio desativado');
      }
    });
  }

  root.querySelector('#export').addEventListener('click', () => {
    exportBackup();
    render();
  });

  root.querySelector('#backup-reminder').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10) || 0;
    updateConfig({ backupReminderDays: n });
  });

  root.querySelector('#import').addEventListener('click', () => root.querySelector('#import-file').click());
  root.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!confirm('Importar substituirá TODOS os dados atuais. Continuar?')) return;
      db.importJSON(text);
      toast('Backup importado');
      render();
    } catch (err) {
      alert('Falha ao importar: ' + err.message);
    }
  });

  root.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;
    if (!confirm('Última chance — confirma APAGAR TUDO?')) return;
    db.reset();
    toast('Dados apagados');
    render();
  });
};

// --------------------------- Period header (shared) -------------------------
// Cabecalho usado em Dashboard, Carteira e Despesas. Layout:
//   - Titulo do periodo grande e centralizado (foco visual)
//   - Stepper de ano sutil logo abaixo (pula pro ano anterior/proximo)
//   - Segmented com tipo (Mes/Tri/Sem/Ano)
//   - Chips horizontais com o valor do periodo (Jan/Fev/... ou 1Tri/2Tri/...)
const periodHeader = () => `
  <div class="period-head">
    <div class="period-title">${periodLabel()}</div>
    <div class="period-year-stepper">
      <button class="link" id="prev-year">‹ ${period.year - 1}</button>
      <button class="link" id="next-year">${period.year + 1} ›</button>
    </div>
  </div>
  <div class="segmented period-type" id="filter-type">
    <button data-type="month"    class="${period.type==='month'?'active':''}">Mês</button>
    <button data-type="quarter"  class="${period.type==='quarter'?'active':''}">Trimestre</button>
    <button data-type="semester" class="${period.type==='semester'?'active':''}">Semestre</button>
    <button data-type="year"     class="${period.type==='year'?'active':''}">Ano</button>
  </div>
  <div class="filter-bar" id="filter-value">${valueChips()}</div>
`;
const bindPeriodHeader = (root) => {
  root.querySelectorAll('#filter-type button').forEach(b => {
    b.addEventListener('click', () => {
      period.type = b.dataset.type;
      const today = new Date();
      if (period.type === 'month')    period.value = today.getMonth() + 1;
      if (period.type === 'quarter')  period.value = Math.floor(today.getMonth()/3) + 1;
      if (period.type === 'semester') period.value = today.getMonth() <= 5 ? 1 : 2;
      render();
    });
  });
  root.querySelectorAll('#filter-value .chip').forEach(b => {
    b.addEventListener('click', () => { period.value = parseInt(b.dataset.value, 10); render(); });
  });
  const prev = root.querySelector('#prev-year'); if (prev) prev.addEventListener('click', () => { period.year--; render(); });
  const next = root.querySelector('#next-year'); if (next) next.addEventListener('click', () => { period.year++; render(); });
};

// --------------------------- Sheets (forms) ---------------------------------
const sheetRenda = (renda) => {
  const isEdit = !!renda;
  const r = renda || { fonte: '', valor: 0, data: todayISO(), descricao: '', recorrente: false, duracaoMeses: null };
  openSheet(isEdit ? 'Editar receita' : 'Nova receita', () => `
    <label class="field"><span>Fonte / nome</span>
      <input id="f-fonte" type="text" placeholder="Ex.: Salário, Freela, Dividendos" value="${escapeAttr(r.fonte || '')}" required />
    </label>
    <label class="field"><span>Valor (R$)</span>
      <input id="f-valor" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(r.valor)}" required />
    </label>
    <label class="field"><span>Data</span>
      <input id="f-data" type="date" value="${r.data}" required />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        A receita só conta a partir deste dia. Datas futuras ficam como "programado".
      </small>
    </label>
    <label class="field"><span>Descrição (opcional)</span>
      <input id="f-desc" type="text" value="${escapeAttr(r.descricao || '')}" />
    </label>
    <div class="checkbox-row">
      <input id="f-rec" type="checkbox" ${r.recorrente ? 'checked' : ''}/>
      <label for="f-rec">Receita mensal recorrente</label>
    </div>
    <label class="field" id="row-dur" ${r.recorrente ? '' : 'hidden'}>
      <span>Por quantos meses?</span>
      <input id="f-dur" type="number" min="1" max="600" inputmode="numeric"
             placeholder="Deixe vazio para sem fim" value="${r.duracaoMeses || ''}" />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Para rendas temporárias (seguro-desemprego, bolsa, contrato). Vazio = recebe todo mês sem fim.
      </small>
    </label>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#f-valor'));
    // Campo de duração só faz sentido para receita recorrente.
    const rec = body.querySelector('#f-rec');
    const rowDur = body.querySelector('#row-dur');
    rec.addEventListener('change', () => { rowDur.hidden = !rec.checked; });
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const recorrente = rec.checked;
      const durRaw = parseInt(body.querySelector('#f-dur').value, 10);
      const data = {
        fonte: body.querySelector('#f-fonte').value.trim() || 'Receita',
        valor: parseAmount(body.querySelector('#f-valor').value),
        data: body.querySelector('#f-data').value,
        descricao: body.querySelector('#f-desc').value.trim(),
        recorrente,
        duracaoMeses: (recorrente && durRaw > 0) ? durRaw : null,
      };
      if (data.valor <= 0) { alert('Informe um valor válido.'); return; }
      if (isEdit) db.updateRenda(r.id, data); else db.addRenda(data);
      closeSheet();
      toast(isEdit ? 'Receita atualizada' : 'Receita adicionada');
      render();
    });
  });
};

const sheetDespesa = (desp, opts = {}) => {
  const isEdit = !!desp;
  const catById = (id) => state.categorias.find(c => c.id === id);
  // Contexto investimento: explícito (opts) ou inferido pela categoria da
  // despesa editada (categoria marcada como "É investimento").
  const investimento = !!opts.investimento || (isEdit && !!(catById(desp.categoriaId) || {}).poupanca);
  const cats = state.categorias.filter(c => investimento ? c.poupanca : !c.poupanca);
  if (investimento && cats.length === 0) {
    alert('Crie uma categoria marcada como "É investimento" primeiro.');
    return;
  }
  const d = desp || { descricao: '', valor: 0, data: todayISO(), categoriaId: cats[0]?.id || null, recorrente: false, parcelas: 1, tags: [] };
  const existingTags = allTags();
  // Determina o "tipo" inicial a partir do estado atual da despesa
  const tipoInicial = d.recorrente ? 'mensal' : ((d.parcelas || 1) > 1 ? 'parcelada' : 'unica');

  openSheet(isEdit ? (investimento ? 'Editar investimento' : 'Editar despesa') : (investimento ? 'Novo investimento' : 'Nova despesa'), () => `
    <label class="field"><span>Descrição</span>
      <input id="f-desc" type="text" placeholder="${investimento ? 'Ex.: Tesouro Direto, CDB, Ações' : 'Ex.: Mercado, Uber, Geladeira'}" value="${escapeAttr(d.descricao || '')}" required />
    </label>
    <label class="field"><span>Valor (R$)${tipoInicial==='parcelada'?' — valor de cada parcela':''}</span>
      <input id="f-valor" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(d.valor)}" required />
    </label>
    <label class="field"><span>Data de pagamento${tipoInicial==='parcelada'?' (1ª parcela)':(tipoInicial==='mensal'?' (1º mês)':'')}</span>
      <input id="f-data" type="date" value="${d.data}" required />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Quando o pagamento será feito (vencimento da fatura, dia do débito, data da compra à vista).
      </small>
    </label>
    <label class="field"><span>Data de cadastro</span>
      <input id="f-criado" type="date" value="${d.criadoEm || todayISO()}" required />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Quando a despesa aconteceu/foi registrada. Padrão: hoje. Ajuste se estiver cadastrando algo de outro dia.
      </small>
    </label>
    <label class="field"><span>Categoria${investimento ? ' (de investimento)' : ''}</span>
      <select id="f-cat">
        ${investimento ? '' : '<option value="">— Sem categoria —</option>'}
        ${cats.map(c => `<option value="${c.id}" ${c.id===d.categoriaId?'selected':''}>${catEmoji(c) ? catEmoji(c) + ' ' : ''}${escapeHTML(c.nome)}</option>`).join('')}
      </select>
    </label>
    <label class="field"><span>Tipo</span>
      <select id="f-tipo">
        <option value="unica"     ${tipoInicial==='unica'?'selected':''}>Apenas neste mês</option>
        <option value="mensal"    ${tipoInicial==='mensal'?'selected':''}>Mensal fixa (sem fim)</option>
        <option value="parcelada" ${tipoInicial==='parcelada'?'selected':''}>Parcelada</option>
      </select>
    </label>
    <label class="field" id="row-parcelas" ${tipoInicial==='parcelada'?'':'hidden'}>
      <span>Número de parcelas</span>
      <input id="f-parcelas" type="number" min="2" max="360" inputmode="numeric"
             value="${(d.parcelas && d.parcelas > 1) ? d.parcelas : 10}" />
      <small id="parcelas-info" style="display:block;color:var(--text-2);margin-top:6px;font-size:13px;"></small>
    </label>
    <label class="field"><span>Tags (separadas por vírgula)</span>
      <input id="f-tags" type="text" list="tag-suggestions" autocapitalize="none" autocorrect="off"
             placeholder="Ex.: viagem, trabalho, presente"
             value="${escapeAttr((d.tags || []).join(', '))}" />
      ${existingTags.length > 0 ? `
        <datalist id="tag-suggestions">
          ${existingTags.map(t => `<option value="${escapeAttr(t)}"></option>`).join('')}
        </datalist>
        <div class="tags-row" style="margin-top:8px;" id="tag-quick">
          ${existingTags.slice(0, 8).map(t => `<button type="button" class="tag usertag" data-tag="${escapeAttr(t)}" style="border:0;cursor:pointer;">#${escapeHTML(t)}</button>`).join('')}
        </div>
      ` : ''}
    </label>
    ${!isEdit ? `
      <div class="checkbox-row">
        <input id="f-pago" type="checkbox" ${d.data <= todayISO() ? 'checked' : ''}/>
        <label for="f-pago">Já paga</label>
      </div>
      <small id="pago-hint" style="display:block;color:var(--text-2);font-size:12px;margin:-4px 2px 12px;"></small>
    ` : ''}
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#f-valor'));
    body.querySelector('#cancel').addEventListener('click', closeSheet);

    const tipoEl     = body.querySelector('#f-tipo');
    const parcRow    = body.querySelector('#row-parcelas');
    const parcEl     = body.querySelector('#f-parcelas');
    const valorEl    = body.querySelector('#f-valor');
    const parcInfo   = body.querySelector('#parcelas-info');
    const updateInfo = () => {
      const isParc = tipoEl.value === 'parcelada';
      parcRow.hidden = !isParc;
      if (isParc) {
        const valor = parseAmount(valorEl.value);
        const n = Math.max(2, Math.min(360, parseInt(parcEl.value, 10) || 0));
        parcInfo.textContent = (valor > 0 && n >= 2)
          ? `Total: ${fmtBRL(valor * n)} em ${n}× de ${fmtBRL(valor)}.`
          : '';
      }
    };
    tipoEl.addEventListener('change', updateInfo);
    parcEl.addEventListener('input', updateInfo);
    valorEl.addEventListener('input', updateInfo);
    updateInfo();

    // Hint dinamico do "Ja paga" — semantica muda com o tipo. Soh existe no
    // form de criacao (no edit a status eh gerenciada via sheet de detalhes).
    const pagoHint = body.querySelector('#pago-hint');
    if (pagoHint) {
      const updatePagoHint = () => {
        const t = tipoEl.value;
        pagoHint.textContent = t === 'mensal'
          ? 'Marca todos os meses de início até o atual como pagos.'
          : t === 'parcelada'
            ? 'Marca todas as parcelas anteriores e a atual como pagas.'
            : '';
      };
      tipoEl.addEventListener('change', updatePagoHint);
      updatePagoHint();
    }

    // Toque numa tag sugerida → anexa ao input
    body.querySelectorAll('#tag-quick [data-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = body.querySelector('#f-tags');
        const cur = parseTags(inp.value);
        const tag = btn.dataset.tag;
        if (!cur.some(t => t.toLowerCase() === tag.toLowerCase())) {
          cur.push(tag);
          inp.value = cur.join(', ');
        }
        inp.focus();
      });
    });
    body.querySelector('#save').addEventListener('click', () => {
      const tipo = tipoEl.value;
      let recorrente = false, parcelas = 1;
      if (tipo === 'mensal') recorrente = true;
      if (tipo === 'parcelada') {
        parcelas = Math.max(2, Math.min(360, parseInt(parcEl.value, 10) || 0));
      }
      const data = {
        descricao: body.querySelector('#f-desc').value.trim(),
        valor: parseAmount(valorEl.value),
        data: body.querySelector('#f-data').value,
        criadoEm: body.querySelector('#f-criado').value || todayISO(),
        categoriaId: body.querySelector('#f-cat').value || null,
        recorrente,
        parcelas,
        tags: parseTags(body.querySelector('#f-tags').value),
      };
      if (!data.descricao) { alert('Informe uma descrição.'); return; }
      if (data.valor <= 0) { alert('Informe um valor válido.'); return; }
      if (tipo === 'parcelada' && data.parcelas < 2) { alert('Mínimo de 2 parcelas.'); return; }

      // Pago/Pendente — soh aplica em criacao (no edit, o status eh gerenciado
      // pela sheet de detalhes da ocorrencia).
      if (!isEdit) {
        const pagoChecked = !!body.querySelector('#f-pago')?.checked;
        if (tipo === 'unica') {
          data.pago = pagoChecked;
        } else {
          // Mensal/parcelada: se "ja paga" marcado, semeia pagasEm com todos
          // os meses entre data inicial e o mes corrente. Se nao marcado,
          // pagasEm fica vazio (todas ocorrencias pendentes).
          if (pagoChecked) {
            const start = isoToDate(data.data);
            const now = new Date();
            const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
            const limitMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const months = [];
            let cur = new Date(startMonth);
            let count = 0;
            while (cur <= limitMonth) {
              if (tipo === 'parcelada' && count >= parcelas) break;
              months.push(yyyyMmFromDate(cur));
              cur.setMonth(cur.getMonth() + 1);
              count++;
            }
            data.pagasEm = months;
          } else {
            data.pagasEm = [];
          }
        }
      }

      if (isEdit) db.updateDespesa(d.id, data); else db.addDespesa(data);
      closeSheet();
      toast(investimento ? (isEdit ? 'Investimento atualizado' : 'Investimento adicionado') : (isEdit ? 'Despesa atualizada' : 'Despesa adicionada'));
      render();
    });
  });
};

const palette = [
  '#FF6B6B','#FF9F0A','#FFD60A','#30D158','#4ECDC4','#0A84FF','#5E5CE6',
  '#BF5AF2','#FF375F','#A8E6CF','#FFD93D','#95E1D3','#C9C9C9',
  '#5AC8FA','#FF2D92','#FF6B35','#7B68EE','#9ACD32','#D4A574','#FF85B3',
];

// Emojis sugeridos no picker de categoria (cobrem os usos mais comuns).
// O usuario pode tambem digitar qualquer emoji no campo de texto ao lado.
const EMOJI_CHOICES = [
  '🍔','🛒','🍕','☕','🍺','🚗','⛽','🚌','✈️','🏠','💡','💧','🔥','📱','💻',
  '🎮','🎬','🎵','📚','💊','🏥','💪','👕','✂️','🎁','💰','📈','🐷','🐾','🎓',
  '⚽','🧾','🏦','🔧','✏️','🌐',
];

const sheetCategoria = (cat) => {
  const isEdit = !!cat;
  // Cores em uso por outras categorias (na edicao, ignora a propria).
  // Usado pra: (1) sugerir cor padrao nao-repetida em categorias novas,
  // (2) marcar visualmente no picker as cores ja escolhidas.
  const usedColors = new Set(
    state.categorias.filter(x => !cat || x.id !== cat.id).map(x => x.cor)
  );
  const defaultCor = palette.find(p => !usedColors.has(p))
    || palette[Math.floor(Math.random()*palette.length)];
  const c = cat || { nome: '', cor: defaultCor, meta: null, icone: '', poupanca: false };
  openSheet(isEdit ? 'Editar categoria' : 'Nova categoria', () => `
    <label class="field"><span>Nome</span>
      <input id="f-nome" type="text" value="${escapeAttr(c.nome || '')}" required />
    </label>
    <label class="field"><span>Ícone (opcional)</span>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <input id="f-icone" type="text" maxlength="4" style="width:64px;text-align:center;font-size:20px;" placeholder="—" value="${escapeAttr(c.icone || '')}" />
        <span style="color:var(--text-2);font-size:12px;">digite um emoji ou escolha abaixo</span>
      </div>
      <div class="emoji-picker" id="f-emojis">
        <button type="button" class="emoji-pick ${!c.icone?'active':''}" data-emoji="">—</button>
        ${EMOJI_CHOICES.map(e => `<button type="button" class="emoji-pick ${c.icone===e?'active':''}" data-emoji="${e}">${e}</button>`).join('')}
      </div>
    </label>
    <label class="field"><span>Cor</span>
      <div class="color-picker" id="f-cores">
        ${palette.map(p => {
          const cls = ['swatch-pick'];
          if (p === c.cor) cls.push('active');
          if (usedColors.has(p)) cls.push('used');
          const title = usedColors.has(p) ? ' title="Cor já em uso por outra categoria"' : '';
          return `<div class="${cls.join(' ')}" data-cor="${p}" style="background:${p}"${title}></div>`;
        }).join('')}
      </div>
      <small style="display:block;color:var(--text-2);margin-top:8px;font-size:12px;">
        O ponto indica cores já usadas em outras categorias.
      </small>
    </label>
    <label class="field"><span>Meta mensal (R$, opcional)</span>
      <input id="f-meta" type="text" inputmode="numeric" placeholder="Deixe vazio para sem meta"
             value="${formatCentsDisplay(c.meta)}" />
      <small id="meta-hint" style="display:block;color:var(--text-2);margin-top:6px;font-size:12px;"></small>
    </label>
    <div class="checkbox-row">
      <input id="f-poupanca" type="checkbox" ${c.poupanca?'checked':''}/>
      <label for="f-poupanca">É investimento</label>
    </div>
    <small style="display:block;color:var(--text-2);font-size:12px;margin:-4px 2px 0;">
      Despesas nessa categoria contam como "guardado", não como gasto, no resumo do dashboard.
    </small>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#f-meta'));
    // Picker em faixa rolavel: traz o item ativo pra perto do inicio visivel
    // (importante ao editar uma categoria cuja cor/emoji esta no fim da lista).
    requestAnimationFrame(() => {
      body.querySelector('#f-cores .swatch-pick.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      body.querySelector('#f-emojis .emoji-pick.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    let chosen = c.cor;
    body.querySelectorAll('#f-cores .swatch-pick').forEach(el => {
      el.addEventListener('click', () => {
        body.querySelectorAll('#f-cores .swatch-pick').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        chosen = el.dataset.cor;
      });
    });
    const iconeInput = body.querySelector('#f-icone');
    body.querySelectorAll('#f-emojis .emoji-pick').forEach(el => {
      el.addEventListener('click', () => {
        iconeInput.value = el.dataset.emoji;
        body.querySelectorAll('#f-emojis .emoji-pick').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
      });
    });
    // Digitar manualmente desmarca os botoes (pode ser um emoji fora da lista).
    iconeInput.addEventListener('input', () => {
      body.querySelectorAll('#f-emojis .emoji-pick').forEach(x => {
        x.classList.toggle('active', x.dataset.emoji === iconeInput.value.trim());
      });
    });
    // Hint da meta muda conforme "poupanca" — limite de gasto vs meta de guardar.
    const poupEl = body.querySelector('#f-poupanca');
    const metaHint = body.querySelector('#meta-hint');
    const updateMetaHint = () => {
      metaHint.textContent = poupEl.checked
        ? 'Meta de quanto guardar por mês — atingir é bom.'
        : 'Limite de gasto por mês — você é avisado ao chegar perto.';
    };
    poupEl.addEventListener('change', updateMetaHint);
    updateMetaHint();
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const data = {
        nome: body.querySelector('#f-nome').value.trim(),
        cor: chosen,
        icone: iconeInput.value.trim(),
        poupanca: poupEl.checked,
        meta: body.querySelector('#f-meta').value.trim() ? parseAmount(body.querySelector('#f-meta').value) : null,
      };
      if (!data.nome) { alert('Informe um nome.'); return; }
      if (isEdit) db.updateCategoria(c.id, data); else db.addCategoria(data);
      closeSheet();
      toast(isEdit ? 'Categoria atualizada' : 'Categoria adicionada');
      render();
    });
  });
};

// --------------------------- Sheets (notificacoes) --------------------------
const sheetAlerts = () => {
  const renderBody = (body) => {
    const alerts = activeAlerts();
    if (alerts.length === 0) {
      body.innerHTML = `
        <div class="empty"><span class="ico">${icon('sparkles', 48)}</span>Sem notificações.</div>
        <div class="actions" style="margin-top:14px;">
          <button class="secondary" id="close-sheet" style="flex:1;">Fechar</button>
        </div>`;
      body.querySelector('#close-sheet').addEventListener('click', closeSheet);
      return;
    }
    body.innerHTML = `
      <ul class="alert-list">
        ${alerts.map(a => `
          <li class="alert-item alert-${a.severity}" data-id="${escapeAttr(a.id)}">
            <div class="grow">
              <div class="t">${escapeHTML(a.title)}</div>
              <div class="s">${escapeHTML(a.message)}</div>
            </div>
            <div class="alert-actions">
              ${a.tab ? `<button class="link" data-action="goto" data-tab="${a.tab}">Ver</button>` : ''}
              <button class="alert-close" data-action="dismiss" aria-label="Dispensar">✕</button>
            </div>
          </li>`).join('')}
      </ul>
      <div class="actions" style="margin-top:14px;">
        <button class="secondary" id="close-sheet" style="flex:1;">Fechar</button>
      </div>`;
    body.querySelector('#close-sheet').addEventListener('click', closeSheet);
    body.querySelectorAll('[data-action="goto"]').forEach(b => {
      b.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        closeSheet();
        location.hash = '#/' + tab;
      });
    });
    body.querySelectorAll('[data-action="dismiss"]').forEach(b => {
      b.addEventListener('click', (e) => {
        const li = e.target.closest('[data-id]');
        dismissAlert(li.dataset.id);
        applyAlertBadge();
        // Re-renderiza o conteudo no lugar pra o usuario ver lista atualizada
        // sem fechar e abrir de novo.
        renderBody(body);
      });
    });
  };
  openSheet('Notificações', () => '', renderBody);
};

// --------------------------- Sheets (perfis) --------------------------------
const sheetProfiles = () => {
  const meta = profileStore.meta();
  openSheet('Perfis', () => `
    <ul class="list" style="margin-bottom:14px;">
      ${meta.list.map(p => `
        <li class="profile-row" data-id="${p.id}" style="cursor:pointer;">
          <div class="grow">
            <div class="t">${escapeHTML(p.name)}</div>
          </div>
          ${p.id===meta.current ? '<span style="color:var(--tint);font-weight:600;">✓</span>' : ''}
        </li>
      `).join('')}
    </ul>
    <div class="actions">
      <button class="secondary" id="cancel">Fechar</button>
      <button class="primary"   id="new-profile">+ Novo perfil</button>
    </div>
  `, (body) => {
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#new-profile').addEventListener('click', () => {
      closeSheet();
      sheetNewProfile();
    });
    body.querySelectorAll('.profile-row').forEach(li => {
      li.addEventListener('click', () => {
        const id = li.dataset.id;
        if (id !== meta.current) switchProfile(id);  // dispara reload
      });
    });
  });
};

const sheetNewProfile = () => {
  openSheet('Novo perfil', () => `
    <label class="field"><span>Nome</span>
      <input id="f-pname" type="text" placeholder="Ex.: Empresa, Família, Viagem" required />
    </label>
    <p style="color:var(--text-2);font-size:13px;margin:0;">
      Vai começar vazio com as categorias padrão. Você troca entre perfis a qualquer momento pelo nome no topo.
    </p>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="create">Criar</button>
    </div>
  `, (body) => {
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    const create = () => {
      const name = body.querySelector('#f-pname').value.trim();
      if (!name) { alert('Informe um nome.'); return; }
      createProfile(name);  // dispara reload
    };
    body.querySelector('#create').addEventListener('click', create);
    body.querySelector('#f-pname').focus();
  });
};

const sheetRenameProfile = (id) => {
  const meta = profileStore.meta();
  const p = meta.list.find(x => x.id === id);
  if (!p) return;
  openSheet('Renomear perfil', () => `
    <label class="field"><span>Nome</span>
      <input id="f-pname" type="text" value="${escapeAttr(p.name)}" required />
    </label>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">Salvar</button>
    </div>
  `, (body) => {
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const name = body.querySelector('#f-pname').value.trim();
      if (!name) { alert('Informe um nome.'); return; }
      renameProfile(id, name);
      closeSheet();
      toast('Perfil renomeado');
      render();
      applyProfileChip();
    });
    body.querySelector('#f-pname').focus();
  });
};

// --------------------------- Sheets (detalhes) ------------------------------
// Mostra os dados completos de uma despesa quando o usuario toca na linha,
// inclusive descricoes longas que ficam truncadas na lista. Aceita tanto o
// registro original quanto uma ocorrencia projetada (recorrente/parcelada),
// mas Editar/Excluir afetam sempre o registro base.
// Antecipar parcelas: o usuário informa quantas parcelas quitou adiantado e o
// total de parcelas diminui (as últimas saem da projeção). Não deixa reduzir
// abaixo da parcela atual nem das já marcadas como pagas, pra não apagar
// parcelas que já aconteceram.
const sheetAnteciparParcelas = (d) => {
  const desp = state.despesas.find(x => x.id === d.id);
  if (!desp) return;
  const total = desp.parcelas || 1;
  if (total <= 1) return;
  const start = partsOf(desp.data);
  const now = new Date();
  const monthsFromStart = (now.getFullYear() - start.y) * 12 + (now.getMonth() + 1 - start.m);
  const parcelaAtual = Math.min(total, Math.max(1, monthsFromStart + 1));
  const pagas = (desp.pagasEm || []).length;
  const minTotal = Math.max(parcelaAtual, pagas, 1);
  const maxAntecipar = total - minTotal;

  openSheet('Antecipar parcelas', () => maxAntecipar < 1 ? `
    <p style="color:var(--text-2);font-size:14px;margin:0 2px;">
      Não há parcelas futuras para antecipar — você já está na última.
    </p>
    <div class="actions"><button class="secondary" id="close">Fechar</button></div>
  ` : `
    <p style="color:var(--text-2);font-size:14px;margin:0 2px 14px;">
      ${escapeHTML(desp.descricao || 'Despesa parcelada')} — ${total}x de ${fmtBRL(desp.valor)}.
      Você está na parcela ${parcelaAtual} de ${total}.
    </p>
    <label class="field"><span>Quantas parcelas você antecipou?</span>
      <input id="f-antecipar" type="number" min="1" max="${maxAntecipar}" inputmode="numeric" value="1" />
      <small style="display:block;color:var(--text-2);font-size:12px;margin-top:6px;">
        Isso reduz o total de parcelas. Pode antecipar até ${maxAntecipar}.
      </small>
    </label>
    <div id="antecipar-preview" style="font-size:15px;color:var(--text);margin:2px 2px 4px;"></div>
    <div class="actions">
      <button class="secondary" id="close">Cancelar</button>
      <button class="primary"   id="save">Antecipar</button>
    </div>
  `, (body) => {
    body.querySelector('#close').addEventListener('click', closeSheet);
    if (maxAntecipar < 1) return;
    const input = body.querySelector('#f-antecipar');
    const preview = body.querySelector('#antecipar-preview');
    const clamp = () => {
      let x = parseInt(input.value, 10);
      if (!Number.isFinite(x) || x < 1) x = 1;
      if (x > maxAntecipar) x = maxAntecipar;
      return x;
    };
    const updatePreview = () => {
      const x = clamp();
      preview.innerHTML = `De <strong>${total}x</strong> passará para <strong>${total - x}x</strong>.`;
    };
    input.addEventListener('input', updatePreview);
    updatePreview();
    body.querySelector('#save').addEventListener('click', () => {
      const x = clamp();
      input.value = x;
      const novoTotal = total - x;
      db.updateDespesa(d.id, { parcelas: novoTotal });
      closeSheet();
      toast(`${x} parcela${x === 1 ? '' : 's'} antecipada${x === 1 ? '' : 's'} · agora ${novoTotal}x`);
      render();
    });
  });
};

const sheetDespesaDetalhes = (d) => {
  const cat = state.categorias.find(c => c.id === d.categoriaId);
  const tipo = d.recorrente
    ? 'Mensal recorrente'
    : (d._parcelaTotal ? `Parcelada (${d._parcelaNum}/${d._parcelaTotal})` : 'Apenas neste mês');
  const tags = d.tags || [];

  openSheet('Detalhes da despesa', () => `
    <div style="margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;word-break:break-word;line-height:1.3;">
        ${escapeHTML(d.descricao || (cat ? cat.nome : 'Despesa'))}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cat ? cat.cor : '#999'};"></span>
        <span style="color:var(--text-2);font-size:14px;">${cat ? escapeHTML(cat.nome) : 'Sem categoria'}</span>
      </div>
    </div>

    <div class="big negative" style="margin-bottom:14px;">${fmtBRL(d.valor)}</div>

    <ul class="details-list">
      <li><span>Status</span><span style="color:${d._pago?'var(--green)':'var(--orange)'};font-weight:600;">${d._pago ? 'Paga' : 'Pendente'}</span></li>
      <li><span>Data de pagamento</span><span>${fmtDate(d.data)}</span></li>
      <li><span>Tipo</span><span>${tipo}</span></li>
      ${d._parcelaTotal ? `
        <li><span>Total geral</span><span>${fmtBRL(d.valor * d._parcelaTotal)}</span></li>
      ` : ''}
      ${tags.length > 0 ? `
        <li><span>Tags</span><span>${tags.map(t => `#${escapeHTML(t)}`).join(' ')}</span></li>
      ` : ''}
      ${d.criadoEm ? `<li><span>Cadastrado em</span><span style="color:var(--text-2);">${fmtDate(d.criadoEm)}</span></li>` : ''}
    </ul>

    ${d._virtual ? `
      <p style="color:var(--text-2);font-size:13px;margin:14px 0 0;">
        Esta é uma ocorrência projetada — Editar/Excluir afetam o lançamento original; "Marcar como paga/pendente" afeta apenas esta ocorrência.
      </p>
    ` : ''}

    <button id="toggle-pago" class="primary" style="width:100%;margin-top:14px;">
      ${d._pago ? 'Marcar como pendente' : 'Marcar como paga'}
    </button>

    ${d._parcelaTotal ? `
      <button id="antecipar" class="secondary" style="width:100%;margin-top:8px;">Antecipar parcelas</button>
    ` : ''}

    <div class="actions">
      <button class="secondary" id="close">Fechar</button>
      <button class="primary"   id="edit">Editar</button>
      <button class="danger"    id="del">Excluir</button>
    </div>
  `, (body) => {
    body.querySelector('#close').addEventListener('click', closeSheet);
    const antBtn = body.querySelector('#antecipar');
    if (antBtn) antBtn.addEventListener('click', () => {
      closeSheet();
      sheetAnteciparParcelas(d);
    });
    body.querySelector('#toggle-pago').addEventListener('click', () => {
      const wasPago = d._pago;
      toggleDespesaPago(d);
      closeSheet();
      toast(wasPago ? 'Marcada como pendente' : 'Marcada como paga');
      render();
    });
    body.querySelector('#edit').addEventListener('click', () => {
      closeSheet();
      sheetDespesa(state.despesas.find(x => x.id === d.id));
    });
    body.querySelector('#del').addEventListener('click', () => {
      const msg = d._virtual
        ? 'Excluir o lançamento original? Isso remove esta e todas as outras ocorrências.'
        : 'Excluir esta despesa?';
      if (confirm(msg)) {
        db.removeDespesa(d.id);
        closeSheet();
        toast('Despesa excluída');
        render();
      }
    });
  });
};

const sheetRendaDetalhes = (r) => {
  const tipo = r.recorrente
    ? (r.duracaoMeses ? `Mensal por ${r.duracaoMeses} ${r.duracaoMeses === 1 ? 'mês' : 'meses'}` : 'Mensal recorrente')
    : 'Apenas neste mês';
  const programada = r.data > todayISO();
  openSheet('Detalhes da receita', () => `
    <div style="margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;word-break:break-word;line-height:1.3;">
        ${escapeHTML(r.fonte || 'Receita')}
      </div>
    </div>

    <div class="big positive" style="margin-bottom:14px;">${fmtBRL(r.valor)}</div>

    <ul class="details-list">
      <li><span>Data</span><span>${fmtDate(r.data)}</span></li>
      <li><span>Status</span><span>${programada ? 'Programada (entra na data)' : 'Recebida'}</span></li>
      <li><span>Tipo</span><span>${tipo}</span></li>
      ${r.descricao ? `
        <li><span>Descrição</span><span>${escapeHTML(r.descricao)}</span></li>
      ` : ''}
    </ul>

    ${r._virtual ? `
      <p style="color:var(--text-2);font-size:13px;margin:14px 0 0;">
        Esta é uma ocorrência projetada — Editar/Excluir afetam o lançamento original.
      </p>
    ` : ''}

    <div class="actions">
      <button class="secondary" id="close">Fechar</button>
      <button class="primary"   id="edit">Editar</button>
      <button class="danger"    id="del">Excluir</button>
    </div>
  `, (body) => {
    body.querySelector('#close').addEventListener('click', closeSheet);
    body.querySelector('#edit').addEventListener('click', () => {
      closeSheet();
      sheetRenda(state.rendas.find(x => x.id === r.id));
    });
    body.querySelector('#del').addEventListener('click', () => {
      const msg = r._virtual
        ? 'Excluir o lançamento original? Isso remove esta e todas as outras ocorrências.'
        : 'Excluir esta receita?';
      if (confirm(msg)) {
        db.removeRenda(r.id);
        closeSheet();
        toast('Receita excluída');
        render();
      }
    });
  });
};

// --------------------------- Swipe to reveal --------------------------------
function bindSwipe(root) {
  let startX = 0, currentRow = null;
  root.querySelectorAll('.swipe-row').forEach(row => {
    if (!row.querySelector('.swipe-actions')) return;
    row.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentRow = row;
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX;
      if (dx < -30) row.classList.add('open');
      else if (dx > 30) row.classList.remove('open');
    }, { passive: true });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.swipe-actions')) {
      root.querySelectorAll('.swipe-row.open').forEach(r => r.classList.remove('open'));
    }
  });
}

// --------------------------- Helpers ---------------------------------------
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const escapeAttr = (s) => escapeHTML(s);

// --------------------------- Router & init ---------------------------------
const tabs = ['dashboard','carteira','despesas','investimentos','categorias','config'];
const titles = {
  dashboard: 'Dashboard',
  carteira: 'Carteira',
  despesas: 'Despesas',
  investimentos: 'Investimentos',
  categorias: 'Categorias',
  config: 'Ajustes',
};

let currentTab = 'dashboard';

const setTab = (name) => {
  if (name === 'objetivos') name = 'investimentos'; // alias do hash antigo
  if (!tabs.includes(name)) name = 'dashboard';
  // Sair da tela de Despesas cancela o modo seleção (evita estado pendurado).
  if (name !== 'despesas') { selectionMode = false; selectedIds.clear(); }
  if (name !== 'dashboard') { vencSelMode = false; vencSel.clear(); }
  currentTab = name;
  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === name);
  });
  document.getElementById('title').textContent = titles[name];
  render();
};

const render = (opts = {}) => {
  const root = document.getElementById('view');
  // Renders leves (preserveScroll, ex: toggle de collapse) marcam o container
  // com .no-anim ANTES do innerHTML pra os cards novos nao animarem. A flag
  // fica ativa ate o proximo render "fresh" (navegacao de aba) — alternar
  // entre none e cardFadeIn no mesmo frame causa pisca-pisca, entao soh
  // removemos a flag quando intencionalmente queremos animar de novo.
  if (opts.preserveScroll) {
    root.classList.add('no-anim');
  } else {
    root.scrollTop = 0;
    root.classList.remove('no-anim');
  }
  views[currentTab](root);
  applyAlertBadge();
};

window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#/', '') || 'dashboard';
  setTab(tab);
});

document.addEventListener('db:changed', () => {
  // Re-render só do que está ativo. (Cada view consulta state diretamente.)
  // Sem re-render automático aqui pra evitar loops em fluxos de save+close.
});

// Quick-add no topo cria conforme aba
document.getElementById('quick-add').addEventListener('click', () => {
  if (currentTab === 'carteira') sheetRenda();
  else if (currentTab === 'despesas') sheetDespesa();
  else if (currentTab === 'categorias') sheetCategoria();
  else if (currentTab === 'investimentos') { if (investSub === 'objetivos') sheetObjetivo(); else sheetDespesa(null, { investimento: true }); }
  else sheetDespesa(); // default no dashboard / config
});

// Sino na topbar: abre a sheet de notificacoes.
document.getElementById('alerts-btn').addEventListener('click', sheetAlerts);

// Chip do perfil na topbar: abre a sheet de troca/criacao.
document.getElementById('profile-chip').addEventListener('click', sheetProfiles);

// Olho na topbar: alterna a flag global, atualiza icone e re-renderiza para
// que todos os fmtBRL na tela ja saiam mascarados/desmascarados.
document.getElementById('toggle-values').addEventListener('click', () => {
  updateConfig({ valuesHidden: !state.config.valuesHidden });
  applyValuesVisibility();
  render();
});

// --------------------------- Onboarding -------------------------------------
// Tutorial em carousel no primeiro acesso (controlado pelo flag onboardingDone
// no device config). Pode ser reaberto via "Ver tutorial" em Ajustes → Sobre.
const ONBOARDING_SLIDES = [
  { icon: 'shield',    title: 'Bem-vindo ao Finanças',
    body: 'Controle pessoal sem servidor — todos os dados ficam neste aparelho. Sem cadastro, sem conta.' },
  { icon: 'dashboard', title: 'Dashboard',
    body: 'Veja receitas, despesas, saldo e gráficos do período. Personalize quais cards aparecem em Ajustes.' },
  { icon: 'wallet',    title: 'Cadastre suas receitas',
    body: 'Na aba Carteira, registre salário, freela ou dividendos. Receitas mensais contam automaticamente todo mês.' },
  { icon: 'card',      title: 'Cadastre suas despesas',
    body: 'Únicas, mensais fixas ou parceladas. Marque como paga ou pendente, organize com categorias e tags.' },
  { icon: 'tag',       title: 'Organize com categorias',
    body: 'Cada categoria tem cor e meta mensal opcional. Reordene arrastando o ≡ pra esquerda.' },
  { icon: 'download',  title: 'Backup dos dados',
    body: 'Em Ajustes você exporta e importa um arquivo a qualquer momento. Ative o lembrete pra não esquecer.' },
  { icon: 'sparkles',  title: 'Tudo pronto!',
    body: 'Comece adicionando sua primeira receita ou despesa.',
    cta: 'Adicionar primeira receita' },
];

const closeOnboarding = (markDone = true) => {
  document.getElementById('onboarding')?.remove();
  if (markDone) updateConfig({ onboardingDone: true });
};

const showOnboarding = () => {
  document.getElementById('onboarding')?.remove();
  let idx = 0;
  const wrap = document.createElement('div');
  wrap.id = 'onboarding';
  document.body.appendChild(wrap);

  const renderSlide = () => {
    const slide = ONBOARDING_SLIDES[idx];
    const isFirst = idx === 0;
    const isLast  = idx === ONBOARDING_SLIDES.length - 1;
    wrap.innerHTML = `
      <div class="onb-header">
        <div class="onb-dots">
          ${ONBOARDING_SLIDES.map((_, i) => `<span class="onb-dot ${i===idx?'active':''}"></span>`).join('')}
        </div>
        <button class="onb-skip" id="onb-skip">Pular</button>
      </div>
      <div class="onb-content">
        <div class="onb-icon-wrap">${icon(slide.icon, 48)}</div>
        <h2 class="onb-title">${escapeHTML(slide.title)}</h2>
        <p class="onb-body">${escapeHTML(slide.body)}</p>
      </div>
      <div class="onb-nav">
        ${isFirst ? '<div style="flex:1;"></div>' : '<button class="secondary" id="onb-prev" style="flex:1;">Anterior</button>'}
        ${isLast
          ? `<button class="primary" id="onb-start" style="flex:1;">${escapeHTML(slide.cta || 'Começar')}</button>`
          : `<button class="primary" id="onb-next" style="flex:1;">Próximo</button>`}
      </div>
    `;
    wrap.querySelector('#onb-skip').addEventListener('click', () => closeOnboarding());
    if (!isFirst) wrap.querySelector('#onb-prev').addEventListener('click', () => { idx--; renderSlide(); });
    if (!isLast)  wrap.querySelector('#onb-next').addEventListener('click', () => { idx++; renderSlide(); });
    if (isLast) wrap.querySelector('#onb-start').addEventListener('click', () => {
      const hasCta = !!slide.cta;
      closeOnboarding();
      if (hasCta) sheetRenda();
    });
  };
  renderSlide();
};

// Init
const initApp = () => {
  applyTextSize(state.config.textSize);
  applyValuesVisibility();
  applyProfileChip();
  applyAlertBadge();
  const initial = location.hash.replace('#/', '') || 'dashboard';
  if (!location.hash) location.hash = '#/dashboard';
  setTab(initial);
  if (!state.config.onboardingDone) showOnboarding();
};

if (lockEnabled() && lockSupported()) {
  showLockScreen(initApp);
} else {
  initApp();
}
