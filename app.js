// ===========================================================================
// Finanças — PWA de controle financeiro pessoal
// Stack: vanilla JS + localStorage + Chart.js (CDN)
// ===========================================================================

// --------------------------- DB --------------------------------------------
const STORAGE_KEY = 'financas:v1';

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

let state = (function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
})();

const persist = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.dispatchEvent(new CustomEvent('db:changed'));
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
  // direction: -1 sobe, +1 desce. Troca com o vizinho na ordem do array,
  // que é a ordem usada para listar categorias em todas as telas.
  moveCategoria(id, direction) {
    const i = state.categorias.findIndex(c => c.id === id);
    if (i < 0) return;
    const j = i + direction;
    if (j < 0 || j >= state.categorias.length) return;
    [state.categorias[i], state.categorias[j]] = [state.categorias[j], state.categorias[i]];
    persist();
  },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
    state = { ...defaultState(), ...parsed };
    persist();
  },
  reset() { state = defaultState(); persist(); },
};

// --------------------------- Utils -----------------------------------------
const fmtBRL = (cents) =>
  ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

const toast = (msg) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2000);
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
  const filterChips = `
    <div class="filter-bar" id="filter-type">
      <button class="chip ${period.type==='month'?'active':''}"   data-type="month">Mês</button>
      <button class="chip ${period.type==='quarter'?'active':''}" data-type="quarter">Trimestre</button>
      <button class="chip ${period.type==='semester'?'active':''}"data-type="semester">Semestre</button>
      <button class="chip ${period.type==='year'?'active':''}"    data-type="year">Ano</button>
    </div>
    <div class="filter-bar" id="filter-value">${valueChips()}</div>
  `;

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

  root.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h2>Período</h2>
        <div style="font-size:18px;font-weight:600;">${periodLabel()}</div>
      </div>
      <button class="link" id="prev-year">${period.year - 1}</button>
      <span style="font-weight:600;">${period.year}</span>
      <button class="link" id="next-year">${period.year + 1}</button>
    </div>

    ${filterChips}

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

    <div class="card">
      <h2>Receitas vs Despesas</h2>
      <div class="chart-wrap"><canvas id="ch-bars"></canvas></div>
    </div>

    <div class="card">
      <h2>Despesas por categoria</h2>
      ${catData.length === 0
        ? `<div class="empty"><span class="ico">📭</span>Sem despesas no período.</div>`
        : `<div class="chart-wrap donut"><canvas id="ch-donut"></canvas></div>
           <ul class="list" style="margin-top:12px;">
             ${catData.map(c => {
                const pct = c.meta ? Math.min(100, Math.round((c.valor / c.meta) * 100)) : null;
                const cls = !c.meta ? '' : (c.valor > c.meta ? 'over' : (c.valor > c.meta*0.8 ? 'warn' : ''));
                return `
                  <li>
                    <span class="swatch" style="background:${c.cor}"></span>
                    <div class="grow">
                      <div class="t">${escapeHTML(c.nome)}</div>
                      ${c.meta ? `
                        <div class="s">${fmtBRL(c.valor)} de ${fmtBRL(c.meta)}${pct!=null?` · ${pct}%`:''}</div>
                        <div class="progress"><i class="${cls}" style="width:${Math.min(100,pct)}%"></i></div>
                      ` : `<div class="s">${fmtBRL(c.valor)}</div>`}
                    </div>
                  </li>`;
             }).join('')}
           </ul>`
      }
    </div>
  `;

  // Listeners de filtro
  root.querySelectorAll('#filter-type .chip').forEach(b => {
    b.addEventListener('click', () => {
      period.type = b.dataset.type;
      // ao mudar tipo, ajusta valor padrão
      const today = new Date();
      if (period.type === 'month')    period.value = today.getMonth() + 1;
      if (period.type === 'quarter')  period.value = Math.floor(today.getMonth()/3) + 1;
      if (period.type === 'semester') period.value = today.getMonth() <= 5 ? 1 : 2;
      if (period.type === 'year')     period.value = null;
      render();
    });
  });
  root.querySelectorAll('#filter-value .chip').forEach(b => {
    b.addEventListener('click', () => {
      period.value = parseInt(b.dataset.value, 10);
      render();
    });
  });
  root.querySelector('#prev-year').addEventListener('click', () => { period.year--; render(); });
  root.querySelector('#next-year').addEventListener('click', () => { period.year++; render(); });

  // Gráficos
  if (window.Chart) {
    new Chart(root.querySelector('#ch-bars'), {
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

    if (catData.length > 0) {
      const donutOptions = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: getCSS('--text'),
              font: { size: 11 },
              // Acrescenta "— 23%" ao lado do nome da categoria na legenda.
              // fontColor por item garante contraste no tema escuro — quando
              // generateLabels e custom, o labels.color global as vezes nao
              // propaga e o Chart.js cai no default cinza ilegivel.
              generateLabels: (chart) => {
                const ds = chart.data.datasets[0];
                const total = ds.data.reduce((a, b) => a + b, 0);
                const textColor = getCSS('--text');
                return chart.data.labels.map((label, i) => {
                  const pct = total > 0 ? ((ds.data[i] / total) * 100).toFixed(0) : '0';
                  return {
                    text: `${label} — ${pct}%`,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    fontColor: textColor,
                    lineWidth: 0,
                    hidden: false,
                    index: i,
                  };
                });
              },
            },
          },
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
      new Chart(root.querySelector('#ch-donut'), {
        type: 'doughnut',
        data: {
          labels: catData.map(c => c.nome),
          datasets: [{
            data: catData.map(c => c.valor / 100),
            backgroundColor: catData.map(c => c.cor),
            borderWidth: 0,
          }],
        },
        options: donutOptions,
      });
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
    y: { ticks: { color: getCSS('--text-2'), callback: v => `R$${v}` }, grid: { color: getCSS('--separator') } },
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
          <li class="swipe-row" data-id="${r.id}" data-real="${!r._virtual}">
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
          <li class="swipe-row" data-id="${d.id}" data-real="${!d._virtual}">
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

  const last = state.categorias.length - 1;
  root.innerHTML = `
    <p style="color:var(--text-2);margin:4px 4px 14px;font-size:14px;">
      Use as setas para reordenar. Arraste a linha para a esquerda para editar ou excluir.
    </p>
    ${state.categorias.length === 0 ? `
      <div class="empty"><span class="ico">🏷️</span>Nenhuma categoria.</div>
    ` : `
      <ul class="list">
        ${state.categorias.map((c, i) => {
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
              <div class="reorder">
                <button class="reorder-btn" data-action="up"   ${i===0    ? 'disabled' : ''} aria-label="Subir">↑</button>
                <button class="reorder-btn" data-action="down" ${i===last ? 'disabled' : ''} aria-label="Descer">↓</button>
              </div>
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
  root.querySelectorAll('[data-action="up"]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = e.target.closest('[data-id]').dataset.id;
    db.moveCategoria(id, -1); render();
  }));
  root.querySelectorAll('[data-action="down"]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = e.target.closest('[data-id]').dataset.id;
    db.moveCategoria(id, +1); render();
  }));
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
  root.innerHTML = `
    <div class="card">
      <h2>Aparência</h2>
      <div class="segmented" id="theme-picker">
        <button data-t="system" class="${tema==='system'?'active':''}">Sistema</button>
        <button data-t="light"  class="${tema==='light'?'active':''}">Claro</button>
        <button data-t="dark"   class="${tema==='dark'?'active':''}">Escuro</button>
      </div>
      <p style="color:var(--text-2);font-size:13px;margin:10px 2px 0;">
        "Sistema" segue o tema do dispositivo automaticamente.
      </p>
    </div>

    <div class="card">
      <h2>Backup</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
        Os dados ficam apenas neste dispositivo. Exporte um arquivo JSON
        regularmente para não perder histórico.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="primary"   id="export">Exportar JSON</button>
        <button class="secondary" id="import">Importar JSON</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
    </div>

    <div class="card">
      <h2>Resumo dos dados</h2>
      <ul class="list" style="box-shadow:none;">
        <li><div class="grow">Receitas</div><div class="amount">${state.rendas.length}</div></li>
        <li><div class="grow">Despesas</div><div class="amount">${state.despesas.length}</div></li>
        <li><div class="grow">Categorias</div><div class="amount">${state.categorias.length}</div></li>
      </ul>
    </div>

    <div class="card">
      <h2>Zona perigosa</h2>
      <p style="color:var(--text-2);font-size:14px;margin:6px 0 12px;">
        Apaga todos os dados deste dispositivo. Faça backup antes.
      </p>
      <button class="danger" id="reset">Apagar tudo</button>
    </div>

    <p style="text-align:center;color:var(--text-2);font-size:12px;margin-top:24px;">
      Finanças PWA · v1.0
    </p>
  `;

  root.querySelectorAll('#theme-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.t;
      state.config = { ...state.config, tema: t };
      persist();
      applyTheme(t);
      render();
    });
  });

  root.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([db.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financas-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exportado');
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
const periodHeader = () => `
  <div class="filter-bar" id="filter-type">
    <button class="chip ${period.type==='month'?'active':''}"   data-type="month">Mês</button>
    <button class="chip ${period.type==='quarter'?'active':''}" data-type="quarter">Trimestre</button>
    <button class="chip ${period.type==='semester'?'active':''}"data-type="semester">Semestre</button>
    <button class="chip ${period.type==='year'?'active':''}"    data-type="year">Ano</button>
  </div>
  <div class="filter-bar" id="filter-value">${valueChips()}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 8px;">
    <button class="link" id="prev-year">‹ ${period.year - 1}</button>
    <strong>${periodLabel()}</strong>
    <button class="link" id="next-year">${period.year + 1} ›</button>
  </div>
`;
const bindPeriodHeader = (root) => {
  root.querySelectorAll('#filter-type .chip').forEach(b => {
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
      <input id="f-parcelas" type="number" min="2" max="120" inputmode="numeric"
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
        const n = Math.max(2, Math.min(120, parseInt(parcEl.value, 10) || 0));
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
        parcelas = Math.max(2, Math.min(120, parseInt(parcEl.value, 10) || 0));
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

const palette = ['#FF6B6B','#FF9F0A','#FFD60A','#30D158','#4ECDC4','#0A84FF','#5E5CE6','#BF5AF2','#FF375F','#A8E6CF','#FFD93D','#95E1D3','#C9C9C9'];

const sheetCategoria = (cat) => {
  const isEdit = !!cat;
  const c = cat || { nome: '', cor: palette[Math.floor(Math.random()*palette.length)], meta: null };
  openSheet(isEdit ? 'Editar categoria' : 'Nova categoria', () => `
    <label class="field"><span>Nome</span>
      <input id="f-nome" type="text" value="${escapeAttr(c.nome || '')}" required />
    </label>
    <label class="field"><span>Cor</span>
      <div class="color-picker" id="f-cores">
        ${palette.map(p => `<div class="swatch-pick ${p===c.cor?'active':''}" data-cor="${p}" style="background:${p}"></div>`).join('')}
      </div>
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

// Init
const initial = location.hash.replace('#/', '') || 'dashboard';
if (!location.hash) location.hash = '#/dashboard';
setTab(initial);
