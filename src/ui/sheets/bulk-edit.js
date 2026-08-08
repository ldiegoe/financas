// Edição em lote das despesas selecionadas. Aplica UMA ação por vez (mudar
// categoria, adicionar/remover tag, marcar paga/pendente). Ocorrências
// virtuais não aparecem em selection.ids — sempre opera sobre a despesa base.
// Fábrica: recebe as deps de runtime do app e devolve `sheetBulkEdit(ids)`.
//
// Recebe `exitSelection` (não o objeto `selection`): o sheet só precisa sair
// do modo de seleção, não ler o estado dele.

import { escapeHTML, escapeAttr } from '../escape.js';
import { infoBtn } from '../info-popover.js';

export const createSheetBulkEdit = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast,
    getState, catEmoji, toggleDespesaPago, exitSelection,
  } = deps;

  return (ids) => {
    const n = ids.length;
    if (n === 0) return;
    const despesasCats = getState().categorias.filter(c => !c.poupanca);
    const investCats   = getState().categorias.filter(c => c.poupanca);
    openSheet(`Editar ${n} ${n === 1 ? 'despesa' : 'despesas'}`, () => `
      <label class="field"><span>Mudar categoria</span>
        <select id="bulk-cat">
          <option value="__none">— manter atual —</option>
          <option value="">Sem categoria</option>
          <optgroup label="Despesa">
            ${despesasCats.map(c => `<option value="${escapeAttr(c.id)}">${catEmoji(c) ? catEmoji(c) + ' ' : ''}${escapeHTML(c.nome)}</option>`).join('')}
          </optgroup>
          ${investCats.length > 0 ? `
            <optgroup label="Investimento">
              ${investCats.map(c => `<option value="${escapeAttr(c.id)}">${catEmoji(c) ? catEmoji(c) + ' ' : ''}${escapeHTML(c.nome)}</option>`).join('')}
            </optgroup>
          ` : ''}
        </select>
      </label>
      <label class="field"><span class="with-info">Adicionar tag${infoBtn('Se a despesa já tiver essa tag, ela é ignorada — não duplica.')}</span>
        <input id="bulk-tag-add" type="text" placeholder="Ex.: viagem" autocapitalize="none" autocorrect="off" />
      </label>
      <label class="field"><span>Remover tag</span>
        <input id="bulk-tag-rem" type="text" placeholder="Ex.: provisória" autocapitalize="none" autocorrect="off" />
      </label>
      <label class="field" style="margin-bottom:6px;"><span>Status de pagamento</span>
        <select id="bulk-status">
          <option value="__none">— manter atual —</option>
          <option value="paga">Marcar como paga</option>
          <option value="pendente">Marcar como pendente</option>
        </select>
      </label>
      <div class="actions">
        <button class="secondary" id="cancel">Cancelar</button>
        <button class="primary"   id="apply">Aplicar</button>
      </div>
    `, (body) => {
      body.querySelector('#cancel').addEventListener('click', closeSheet);
      body.querySelector('#apply').addEventListener('click', () => {
        const catChoice = body.querySelector('#bulk-cat').value;
        const tagAdd = body.querySelector('#bulk-tag-add').value.trim();
        const tagRem = body.querySelector('#bulk-tag-rem').value.trim().toLowerCase();
        const status = body.querySelector('#bulk-status').value;
        let changes = 0;
        for (const id of ids) {
          const d = getState().despesas.find(x => x.id === id);
          if (!d) continue;
          const patch = {};
          if (catChoice !== '__none') {
            patch.categoriaId = catChoice === '' ? null : catChoice;
          }
          if (tagAdd) {
            const cur = d.tags || [];
            if (!cur.some(t => t.toLowerCase() === tagAdd.toLowerCase())) {
              patch.tags = [...cur, tagAdd];
            }
          }
          if (tagRem) {
            const cur = patch.tags || d.tags || [];
            const next = cur.filter(t => t.toLowerCase() !== tagRem);
            if (next.length !== cur.length) patch.tags = next;
          }
          if (Object.keys(patch).length > 0) {
            db.updateDespesa(id, patch);
            changes++;
          }
          if (status !== '__none') {
            const wantPaga = status === 'paga';
            const occ = { ...d, _virtual: false, _pago: d.pago === true };
            if (wantPaga !== occ._pago) {
              toggleDespesaPago(occ);
              changes++;
            }
          }
        }
        exitSelection();
        closeSheet();
        toast(changes > 0 ? `${changes} aplicada${changes === 1 ? '' : 's'}` : 'Nenhuma alteração');
        render();
      });
    });
  };
};
