// Sheet de histórico da categoria: gráfico de barras dos últimos 6 meses +
// média, maior mês e acumulado.
// Fábrica: recebe as deps de runtime do app e devolve
// `sheetCategoriaHistorico(c)`.
//
// `Chart` é global (CDN, carregado no index.html) — usado como estava.

import { monthName } from '../../helpers/format.js';
import { sumAmount, expandWithRecurring } from '../../domain/despesa.js';

export const createSheetCategoriaHistorico = (deps) => {
  const {
    openSheet, closeSheet, getState, catEmoji, fmtBRL, getCSS, sheetCategoria,
  } = deps;

  return (c) => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
    }
    const valores = months.map(({ y, m }) =>
      sumAmount(expandWithRecurring(getState().despesas, { type: 'month', year: y, value: m })
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
        sheetCategoria(getState().categorias.find(x => x.id === c.id));
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
              y: { ticks: { color: getCSS('--text-2'), callback: v => getState().config.valuesHidden ? '' : `R$${v}` }, grid: { color: getCSS('--separator') } },
            },
          },
        });
      }
    });
  };
};
