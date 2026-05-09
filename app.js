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
  'dashCompareShow','dashBarsShow','dashDonutShow','dashDonutType',
  'dashDonutInnerPct','dashListShow','dashListPct',
];
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

let state = applyDeviceOverlay(profileStore.loadState(activeProfileId));

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

  addDespesa(d)   { state.despesas.push({ id: uid(), ...d }); persist(); },
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
    // Mantém integridade: despesas dessa categoria viram "sem categoria"
    state.despesas = state.despesas.map(d =>
      d.categoriaId === id ? { ...d, categoriaId: null } : d
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

    if (!isRecurring && !isInstallment) {
      if (periodMatches(it.data, period)) out.push({ ...it, _virtual: false });
      continue;
    }

    const start = partsOf(it.data);
    const day = parseInt(it.data.split('-')[2], 10);
    const months = monthsInPeriod(period);

    for (const { y, m } of months) {
      const monthsFromStart = (y - start.y) * 12 + (m - start.m);
      if (monthsFromStart < 0) continue;
      if (isInstallment && monthsFromStart >= parcelas) continue;

      const projectedDay = clampDay(y, m, day);
      const iso = `${y}-${String(m).padStart(2,'0')}-${String(projectedDay).padStart(2,'0')}`;
      const isOriginal = (y === start.y && m === start.m);
      const occ = { ...it, data: iso, _virtual: !isOriginal };
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

// 'system' (padrão) | 'light' | 'dark'. Atributo data-theme no <html> é
// quem comanda o CSS; ausência do atributo = seguir sistema operacional.
const applyTheme = (tema) => {
  if (tema === 'light' || tema === 'dark') {
    document.documentElement.setAttribute('data-theme', tema);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
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
      <span class="lock-ico">🔒</span>
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

// ----- Dashboard -----
views.dashboard = (root) => {
  const rendasPeriod   = expandWithRecurring(state.rendas, period);
  const despesasPeriod = expandWithRecurring(state.despesas, period);
  const totalRenda    = sumAmount(rendasPeriod);
  const totalDespesa  = sumAmount(despesasPeriod);
  const saldo         = totalRenda - totalDespesa;

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
      diff: (currCatMap.get(id) || 0) - (prevCatMap.get(id) || 0),
    };
  }).filter(x => x.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);

  // Despesas por categoria
  const porCategoria = new Map();
  for (const d of despesasPeriod) {
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
      valor,
    };
  }).sort((a, b) => b.valor - a.valor);

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

    <div class="row-cards">
      <div class="card">
        <h2>Receitas</h2>
        <div class="big positive">${fmtBRL(totalRenda)}</div>
      </div>
      <div class="card">
        <h2>Despesas</h2>
        <div class="big negative">${fmtBRL(totalDespesa)}</div>
      </div>
    </div>

    <div class="card">
      <h2>Saldo</h2>
      <div class="big ${saldo >= 0 ? 'positive' : 'negative'}">${fmtBRL(saldo)}</div>
    </div>

    ${state.config.dashCompareShow !== false ? `
      <div class="card">
        <h2>Comparação com ${escapeHTML(labelOfPeriod(prev))}</h2>
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
                <span class="swatch" style="background:${c.cor}"></span>
                <span class="name">${escapeHTML(c.nome)}</span>
                <span class="diff ${c.diff > 0 ? 'bad' : 'good'}">${c.diff > 0 ? '+' : '−'}${fmtBRL(Math.abs(c.diff))}</span>
              </li>`).join('')}
          </ul>
        ` : ''}
      </div>
    ` : ''}

    ${state.config.dashBarsShow !== false ? `
      <div class="card">
        <h2>Receitas vs Despesas</h2>
        <div class="chart-wrap"><canvas id="ch-bars"></canvas></div>
      </div>
    ` : ''}

    ${(() => {
      // Card "Despesas por categoria" eh montado conforme as preferencias do
      // usuario: pode mostrar grafico, lista, ambos ou nenhum. Se ambos
      // estiverem desligados, o card inteiro some.
      const showDonut = state.config.dashDonutShow !== false;
      const showList  = state.config.dashListShow  !== false;
      const showListPct = state.config.dashListPct !== false;
      if (!showDonut && !showList) return '';
      if (catData.length === 0) {
        return `
          <div class="card">
            <h2>Despesas por categoria</h2>
            <div class="empty"><span class="ico">📭</span>Sem despesas no período.</div>
          </div>`;
      }
      // Quando o tipo eh "barras", a altura do wrap escala com o numero de
      // categorias (uma faixa por linha). Donut/pizza ficam com altura fixa.
      const dashType = state.config.dashDonutType || 'donut';
      const donutWrapStyle = dashType === 'bars'
        ? `style="height:${Math.max(180, catData.length * 36 + 40)}px;"`
        : '';
      const donutHTML = showDonut
        ? `<div class="chart-wrap donut" ${donutWrapStyle}><canvas id="ch-donut"></canvas></div>`
        : '';
      const listHTML = showList ? `
        <ul class="list" style="margin-top:${showDonut?'12px':'0'};">
          ${catData.map(c => {
            const pctTotal = totalDespesa > 0 ? Math.round((c.valor / totalDespesa) * 100) : 0;
            const pct = c.meta ? Math.min(100, Math.round((c.valor / c.meta) * 100)) : null;
            const cls = !c.meta ? '' : (c.valor > c.meta ? 'over' : (c.valor > c.meta*0.8 ? 'warn' : ''));
            return `
              <li>
                <span class="swatch" style="background:${c.cor}"></span>
                <div class="grow">
                  <div class="t">${escapeHTML(c.nome)}</div>
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
          <h2>Despesas por categoria</h2>
          ${donutHTML}
          ${listHTML}
        </div>`;
    })()}
  `;

  bindPeriodHeader(root);

  const bannerBtn = root.querySelector('#banner-backup');
  if (bannerBtn) bannerBtn.addEventListener('click', () => { exportBackup(); render(); });

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

    if (catData.length > 0 && root.querySelector('#ch-donut')) {
      const dashType = state.config.dashDonutType || 'donut';
      const data = {
        labels: catData.map(c => c.nome),
        datasets: [{
          data: catData.map(c => c.valor / 100),
          backgroundColor: catData.map(c => c.cor),
          borderWidth: 0,
        }],
      };
      let chartConfig;
      if (dashType === 'bars') {
        // Barras horizontais: ranking de categorias (maior valor no topo). Eixo
        // X mostra valor em R$, Y mostra nome da categoria.
        chartConfig = {
          type: 'bar',
          data,
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
        // Donut ou Pizza — diferenca eh o cutout (centro vazio do donut).
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
        // Plugin opcional: desenha "23%" centralizado em cada fatia. Ativado
        // pelo toggle em Ajustes — pula fatias < 6% pra nao poluir.
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
        chartConfig = { type: 'doughnut', data, options: donutOptions };
        if (state.config.dashDonutInnerPct) chartConfig.plugins = [inSlicePctPlugin];
      }
      new Chart(root.querySelector('#ch-donut'), chartConfig);
    }
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
  const rendasPeriod = expandWithRecurring(state.rendas, period);
  const total = sumAmount(rendasPeriod);
  // Lista por fonte
  const porFonte = new Map();
  for (const r of rendasPeriod) {
    const k = r.fonte || 'Outros';
    porFonte.set(k, (porFonte.get(k) || 0) + (r.valor || 0));
  }

  root.innerHTML = `
    ${periodHeader()}
    <div class="card">
      <h2>Total de receitas em ${periodLabel()}</h2>
      <div class="big positive">${fmtBRL(total)}</div>
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
      <div class="empty"><span class="ico">💰</span>Nenhuma receita no período.<br/><br/>
        <button class="primary" id="add-renda">Adicionar receita</button></div>
    ` : `
      <ul class="list">
        ${rendasPeriod.sort((a,b)=>b.data.localeCompare(a.data)).map(r => `
          <li class="swipe-row" data-id="${r.id}" data-data="${r.data}" data-real="${!r._virtual}">
            <span class="swatch" style="background:#30d158"></span>
            <div class="grow">
              <div class="t">${escapeHTML(r.fonte || 'Receita')}
                ${r.recorrente ? '<span class="tag recurring">Mensal</span>' : ''}
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
        `).join('')}
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
let tagFilter = null;       // tag ativa no filtro (lowercase) ou null
let searchQuery = '';       // texto digitado na busca
let categoryFilter = null;  // id da categoria filtrada ou null

// Aplica busca textual + filtro de categoria + filtro de tag em sequência.
const filterDespesas = (despesas) => {
  let result = despesas;
  if (categoryFilter) {
    result = result.filter(d => d.categoriaId === categoryFilter);
  }
  if (tagFilter) {
    result = result.filter(d => (d.tags || []).some(t => t.toLowerCase() === tagFilter));
  }
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
  const expanded = expandWithRecurring(state.despesas, period);
  const despesasPeriod = filterDespesas(expanded);
  const total = sumAmount(despesasPeriod);
  const tags = allTags();
  const hasFilter = !!searchQuery || !!categoryFilter || !!tagFilter;

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

    ${state.categorias.length > 0 ? `
      <div class="filter-bar" id="cat-filter">
        <button class="chip ${!categoryFilter?'active':''}" data-cat="">Todas categorias</button>
        ${state.categorias.map(c => `
          <button class="chip ${categoryFilter===c.id?'active':''}" data-cat="${c.id}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.cor};margin-right:6px;vertical-align:middle;"></span>${escapeHTML(c.nome)}
          </button>`).join('')}
      </div>
    ` : ''}

    ${tags.length > 0 ? `
      <div class="filter-bar" id="tag-filter">
        <button class="chip ${!tagFilter?'active':''}" data-tag="">Todas tags</button>
        ${tags.map(t => `<button class="chip ${tagFilter===t.toLowerCase()?'active':''}" data-tag="${escapeAttr(t.toLowerCase())}">#${escapeHTML(t)}</button>`).join('')}
      </div>
    ` : ''}

    <div class="section-title">Lançamentos</div>
    ${despesasPeriod.length === 0 ? `
      <div class="empty"><span class="ico">💸</span>${hasFilter ? 'Nenhuma despesa para os filtros aplicados.' : 'Nenhuma despesa no período.'}<br/><br/>
        <button class="primary" id="add-desp">Adicionar despesa</button></div>
    ` : `
      <ul class="list">
        ${despesasPeriod.sort((a,b)=>b.data.localeCompare(a.data)).map(d => {
          const cat = state.categorias.find(c => c.id === d.categoriaId);
          const dTags = d.tags || [];
          return `
          <li class="swipe-row" data-id="${d.id}" data-data="${d.data}" data-real="${!d._virtual}">
            <span class="swatch" style="background:${cat ? cat.cor : '#999'}"></span>
            <div class="grow">
              <div class="t">${escapeHTML(d.descricao || (cat ? cat.nome : 'Despesa'))}
                ${d.recorrente ? '<span class="tag recurring">Mensal</span>' : ''}
                ${d._parcelaTotal ? `<span class="tag installment">${d._parcelaNum}/${d._parcelaTotal}</span>` : ''}
              </div>
              <div class="s">${fmtDate(d.data)} · ${cat ? escapeHTML(cat.nome) : 'Sem categoria'}</div>
              ${dTags.length > 0 ? `
                <div class="tags-row">
                  ${dTags.map(t => `<span class="tag usertag">#${escapeHTML(t)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="amount neg">${fmtBRL(d.valor)}</div>
            ${!d._virtual ? `
              <div class="swipe-actions">
                <button class="edit" data-action="edit-desp">Editar</button>
                <button class="del"  data-action="del-desp">Excluir</button>
              </div>
            ` : ''}
          </li>`;
        }).join('')}
      </ul>
    `}

    <button class="fab" id="fab-desp" aria-label="Adicionar despesa">+</button>
  `;

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
  root.querySelectorAll('#tag-filter .chip').forEach(b => b.addEventListener('click', () => {
    tagFilter = b.dataset.tag || null;
    render();
  }));
  root.querySelectorAll('#cat-filter .chip').forEach(b => b.addEventListener('click', () => {
    categoryFilter = b.dataset.cat || null;
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
    searchQuery = ''; categoryFilter = null; tagFilter = null;
    render();
  });
  const addBtn = root.querySelector('#add-desp');
  if (addBtn) addBtn.addEventListener('click', () => sheetDespesa());
  root.querySelector('#fab-desp').addEventListener('click', () => sheetDespesa());
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
      Toque e segure o ≡ para arrastar e reordenar. Arraste a linha para a esquerda para editar ou excluir.
    </p>
    ${state.categorias.length === 0 ? `
      <div class="empty"><span class="ico">🏷️</span>Nenhuma categoria.</div>
    ` : `
      <ul class="list" id="cat-list">
        ${state.categorias.map(c => {
          const gasto = gastoPorCat.get(c.id) || 0;
          const pct = c.meta ? Math.min(100, Math.round((gasto / c.meta) * 100)) : null;
          const cls = !c.meta ? '' : (gasto > c.meta ? 'over' : (gasto > c.meta*0.8 ? 'warn' : ''));
          return `
            <li class="swipe-row" data-id="${c.id}">
              <span class="swatch" style="background:${c.cor}"></span>
              <div class="grow">
                <div class="t">${escapeHTML(c.nome)}</div>
                ${c.meta ? `
                  <div class="s">${fmtBRL(gasto)} / ${fmtBRL(c.meta)} este mês · ${pct}%</div>
                  <div class="progress"><i class="${cls}" style="width:${Math.min(100,pct)}%"></i></div>
                ` : `<div class="s">Sem meta · ${fmtBRL(gasto)} este mês</div>`}
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
  root.querySelector('#fab-cat').addEventListener('click', () => sheetCategoria());
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

      <label class="field" style="margin-bottom:0;">
        <span>Tamanho do texto</span>
        <div class="segmented" id="text-size">
          <button data-size="small"  class="${textSize==='small' ?'active':''}">Pequeno</button>
          <button data-size="normal" class="${textSize==='normal'?'active':''}">Padrão</button>
          <button data-size="large"  class="${textSize==='large' ?'active':''}">Grande</button>
        </div>
      </label>
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

    <div class="card">
      <h2>Personalizar dashboard</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 14px;">
        Mostre ou oculte os cards do dashboard.
      </p>

      <div class="checkbox-row">
        <input id="f-dash-compare-show" type="checkbox" ${state.config.dashCompareShow!==false?'checked':''}/>
        <label for="f-dash-compare-show">Exibir comparação com mês anterior</label>
      </div>

      <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
        <input id="f-dash-bars-show" type="checkbox" ${state.config.dashBarsShow!==false?'checked':''}/>
        <label for="f-dash-bars-show">Exibir gráfico de Receitas vs Despesas</label>
      </div>

      <div style="border-top:1px solid var(--separator);margin-top:14px;padding-top:14px;">
        <p style="color:var(--text-2);font-size:13px;margin:0 0 10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">
          Despesas por categoria
        </p>

        <div class="checkbox-row">
          <input id="f-dash-donut-show" type="checkbox" ${state.config.dashDonutShow!==false?'checked':''}/>
          <label for="f-dash-donut-show">Exibir gráfico</label>
        </div>

        <label class="field" style="margin:10px 0 0;">
          <span>Tipo do gráfico</span>
          <div class="segmented" id="dash-donut-type">
            <button data-type="donut" class="${(state.config.dashDonutType||'donut')==='donut'?'active':''}">Donut</button>
            <button data-type="pie"   class="${state.config.dashDonutType==='pie'?'active':''}">Pizza</button>
            <button data-type="bars"  class="${state.config.dashDonutType==='bars'?'active':''}">Barras</button>
          </div>
        </label>

        ${state.config.dashDonutType !== 'bars' ? `
          <div class="checkbox-row" style="margin-top:14px;">
            <input id="f-dash-donut-inner" type="checkbox" ${state.config.dashDonutInnerPct?'checked':''}/>
            <label for="f-dash-donut-inner">Mostrar % dentro das fatias</label>
          </div>
        ` : ''}

        <div class="checkbox-row" style="border-top:1px solid var(--separator);padding-top:14px;margin-top:0;">
          <input id="f-dash-list-show" type="checkbox" ${state.config.dashListShow!==false?'checked':''}/>
          <label for="f-dash-list-show">Exibir lista de categorias</label>
        </div>
        <div class="checkbox-row">
          <input id="f-dash-list-pct" type="checkbox" ${state.config.dashListPct!==false?'checked':''}/>
          <label for="f-dash-list-pct">Mostrar % na lista</label>
        </div>
      </div>
    </div>

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

  root.querySelector('#force-refresh').addEventListener('click', forceRefresh);

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
  wireToggle('#f-dash-compare-show', 'dashCompareShow');
  wireToggle('#f-dash-bars-show',    'dashBarsShow');
  wireToggle('#f-dash-donut-show',   'dashDonutShow');
  wireToggle('#f-dash-donut-inner',  'dashDonutInnerPct');
  wireToggle('#f-dash-list-show',    'dashListShow');
  wireToggle('#f-dash-list-pct',     'dashListPct');
  root.querySelectorAll('#dash-donut-type button').forEach(btn => {
    btn.addEventListener('click', () => {
      updateConfig({ dashDonutType: btn.dataset.type });
      render();
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
  const r = renda || { fonte: '', valor: 0, data: todayISO(), descricao: '', recorrente: false };
  openSheet(isEdit ? 'Editar receita' : 'Nova receita', () => `
    <label class="field"><span>Fonte / nome</span>
      <input id="f-fonte" type="text" placeholder="Ex.: Salário, Freela, Dividendos" value="${escapeAttr(r.fonte || '')}" required />
    </label>
    <label class="field"><span>Valor (R$)</span>
      <input id="f-valor" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(r.valor)}" required />
    </label>
    <label class="field"><span>Data</span>
      <input id="f-data" type="date" value="${r.data}" required />
    </label>
    <label class="field"><span>Descrição (opcional)</span>
      <input id="f-desc" type="text" value="${escapeAttr(r.descricao || '')}" />
    </label>
    <div class="checkbox-row">
      <input id="f-rec" type="checkbox" ${r.recorrente ? 'checked' : ''}/>
      <label for="f-rec">Receita mensal recorrente</label>
    </div>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#f-valor'));
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const data = {
        fonte: body.querySelector('#f-fonte').value.trim() || 'Receita',
        valor: parseAmount(body.querySelector('#f-valor').value),
        data: body.querySelector('#f-data').value,
        descricao: body.querySelector('#f-desc').value.trim(),
        recorrente: body.querySelector('#f-rec').checked,
      };
      if (data.valor <= 0) { alert('Informe um valor válido.'); return; }
      if (isEdit) db.updateRenda(r.id, data); else db.addRenda(data);
      closeSheet();
      toast(isEdit ? 'Receita atualizada' : 'Receita adicionada');
      render();
    });
  });
};

const sheetDespesa = (desp) => {
  const isEdit = !!desp;
  const d = desp || { descricao: '', valor: 0, data: todayISO(), categoriaId: state.categorias[0]?.id || null, recorrente: false, parcelas: 1, tags: [] };
  const existingTags = allTags();
  // Determina o "tipo" inicial a partir do estado atual da despesa
  const tipoInicial = d.recorrente ? 'mensal' : ((d.parcelas || 1) > 1 ? 'parcelada' : 'unica');

  openSheet(isEdit ? 'Editar despesa' : 'Nova despesa', () => `
    <label class="field"><span>Descrição</span>
      <input id="f-desc" type="text" placeholder="Ex.: Mercado, Uber, Geladeira" value="${escapeAttr(d.descricao || '')}" required />
    </label>
    <label class="field"><span>Valor (R$)${tipoInicial==='parcelada'?' — valor de cada parcela':''}</span>
      <input id="f-valor" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(d.valor)}" required />
    </label>
    <label class="field"><span>Data ${tipoInicial==='parcelada'?'(1ª parcela)':'(início)'}</span>
      <input id="f-data" type="date" value="${d.data}" required />
    </label>
    <label class="field"><span>Categoria</span>
      <select id="f-cat">
        <option value="">— Sem categoria —</option>
        ${state.categorias.map(c => `<option value="${c.id}" ${c.id===d.categoriaId?'selected':''}>${escapeHTML(c.nome)}</option>`).join('')}
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
        categoriaId: body.querySelector('#f-cat').value || null,
        recorrente,
        parcelas,
        tags: parseTags(body.querySelector('#f-tags').value),
      };
      if (!data.descricao) { alert('Informe uma descrição.'); return; }
      if (data.valor <= 0) { alert('Informe um valor válido.'); return; }
      if (tipo === 'parcelada' && data.parcelas < 2) { alert('Mínimo de 2 parcelas.'); return; }
      if (isEdit) db.updateDespesa(d.id, data); else db.addDespesa(data);
      closeSheet();
      toast(isEdit ? 'Despesa atualizada' : 'Despesa adicionada');
      render();
    });
  });
};

const palette = [
  '#FF6B6B','#FF9F0A','#FFD60A','#30D158','#4ECDC4','#0A84FF','#5E5CE6',
  '#BF5AF2','#FF375F','#A8E6CF','#FFD93D','#95E1D3','#C9C9C9',
  '#5AC8FA','#FF2D92','#FF6B35','#7B68EE','#9ACD32','#D4A574','#FF85B3',
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
  const c = cat || { nome: '', cor: defaultCor, meta: null };
  openSheet(isEdit ? 'Editar categoria' : 'Nova categoria', () => `
    <label class="field"><span>Nome</span>
      <input id="f-nome" type="text" value="${escapeAttr(c.nome || '')}" required />
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
    </label>
    <div class="actions">
      <button class="secondary" id="cancel">Cancelar</button>
      <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
    </div>
  `, (body) => {
    bindCurrencyInput(body.querySelector('#f-meta'));
    let chosen = c.cor;
    body.querySelectorAll('#f-cores .swatch-pick').forEach(el => {
      el.addEventListener('click', () => {
        body.querySelectorAll('#f-cores .swatch-pick').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        chosen = el.dataset.cor;
      });
    });
    body.querySelector('#cancel').addEventListener('click', closeSheet);
    body.querySelector('#save').addEventListener('click', () => {
      const data = {
        nome: body.querySelector('#f-nome').value.trim(),
        cor: chosen,
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
      <li><span>Data</span><span>${fmtDate(d.data)}</span></li>
      <li><span>Tipo</span><span>${tipo}</span></li>
      ${d._parcelaTotal ? `
        <li><span>Total geral</span><span>${fmtBRL(d.valor * d._parcelaTotal)}</span></li>
      ` : ''}
      ${tags.length > 0 ? `
        <li><span>Tags</span><span>${tags.map(t => `#${escapeHTML(t)}`).join(' ')}</span></li>
      ` : ''}
    </ul>

    ${d._virtual ? `
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
  const tipo = r.recorrente ? 'Mensal recorrente' : 'Apenas neste mês';
  openSheet('Detalhes da receita', () => `
    <div style="margin-bottom:12px;">
      <div style="font-size:18px;font-weight:600;word-break:break-word;line-height:1.3;">
        ${escapeHTML(r.fonte || 'Receita')}
      </div>
    </div>

    <div class="big positive" style="margin-bottom:14px;">${fmtBRL(r.valor)}</div>

    <ul class="details-list">
      <li><span>Data</span><span>${fmtDate(r.data)}</span></li>
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
const tabs = ['dashboard','carteira','despesas','categorias','config'];
const titles = {
  dashboard: 'Dashboard',
  carteira: 'Carteira',
  despesas: 'Despesas',
  categorias: 'Categorias',
  config: 'Ajustes',
};

let currentTab = 'dashboard';

const setTab = (name) => {
  if (!tabs.includes(name)) name = 'dashboard';
  currentTab = name;
  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === name);
  });
  document.getElementById('title').textContent = titles[name];
  render();
};

const render = () => {
  const root = document.getElementById('view');
  root.scrollTop = 0;
  views[currentTab](root);
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
  else sheetDespesa(); // default no dashboard / config
});

// Chip do perfil na topbar: abre a sheet de troca/criacao.
document.getElementById('profile-chip').addEventListener('click', sheetProfiles);

// Olho na topbar: alterna a flag global, atualiza icone e re-renderiza para
// que todos os fmtBRL na tela ja saiam mascarados/desmascarados.
document.getElementById('toggle-values').addEventListener('click', () => {
  updateConfig({ valuesHidden: !state.config.valuesHidden });
  applyValuesVisibility();
  render();
});

// Init
const initApp = () => {
  applyTextSize(state.config.textSize);
  applyValuesVisibility();
  applyProfileChip();
  const initial = location.hash.replace('#/', '') || 'dashboard';
  if (!location.hash) location.hash = '#/dashboard';
  setTab(initial);
};

if (lockEnabled() && lockSupported()) {
  showLockScreen(initApp);
} else {
  initApp();
}
