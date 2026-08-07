// Sheet "Notificações" (sino da topbar).
// Fábrica: recebe as deps de runtime do app e devolve `sheetAlerts()`.
//
// Foge do padrão openSheet(titulo, () => html, onMount) de propósito: a
// contentFn é vazia e `renderBody` escreve o innerHTML direto, pra poder
// re-renderizar a lista in-place ao dispensar um alerta — sem fechar e
// reabrir o sheet.

import { escapeHTML, escapeAttr } from '../escape.js';
import { icon } from '../icons.js';

export const createSheetAlerts = (deps) => {
  const { openSheet, closeSheet, activeAlerts, dismissAlert, applyAlertBadge } = deps;

  return () => {
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
};
