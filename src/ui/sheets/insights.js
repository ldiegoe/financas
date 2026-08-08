// Sheet de insights automáticos — aparece no abrir do app (no máximo 1x/dia).
// Fábrica: recebe as deps de runtime do app e devolve `sheetInsights()`.
//
// ⚠️ Retorna boolean: false se não há insights (não abre nada), true se abriu.
// O call-site do app.js depende disso pra decidir se marca a data do dia.

import { escapeHTML } from '../escape.js';
import { icon } from '../icons.js';

export const createSheetInsights = (deps) => {
  const { openSheet, closeSheet, computeInsights } = deps;

  return () => {
    const insights = computeInsights();
    if (insights.length === 0) return false;
    openSheet('Insights', () => `
      <p style="color:var(--text-2);font-size:14px;margin:0 2px 14px;">
        Coisas que merecem sua atenção desde a última vez.
      </p>
      <ul class="insights-list">
        ${insights.map(i => `
          <li class="insight-item ${i.severity}">
            <span class="insight-icon">${icon(i.icon, 22)}</span>
            <div class="grow">
              <div class="insight-title">${escapeHTML(i.title)}</div>
              <div class="insight-body">${escapeHTML(i.body)}</div>
            </div>
          </li>`).join('')}
      </ul>
      <div class="actions">
        <button class="primary" id="insights-close">Fechar</button>
      </div>
    `, (body) => {
      body.querySelector('#insights-close').addEventListener('click', closeSheet);
    });
    return true;
  };
};
