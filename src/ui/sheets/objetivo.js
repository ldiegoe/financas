// Sheet de objetivo de investimento (aba Investimentos → novo/editar).
// Fábrica: recebe as deps de runtime do app e devolve `sheetObjetivo(obj)`.

import { bindCurrencyInput } from '../currency-input.js';
import { escapeHTML, escapeAttr } from '../escape.js';
import { infoBtn } from '../info-popover.js';
import { formatCentsDisplay } from '../../helpers/format.js';
import { parseAmount } from '../../helpers/parse.js';

export const createSheetObjetivo = (deps) => {
  const { openSheet, closeSheet, db, render, toast, getState, catEmoji } = deps;

  return (obj) => {
    const isEdit = !!obj;
    const o = obj || { nome: '', alvo: 0, prazo: '', desde: '', categoriaIds: [] };
    const linkedSet = new Set(o.categoriaIds || []);
    // Objetivos contam só categorias de investimento.
    const investCats = getState().categorias.filter(c => c.poupanca);
    openSheet(isEdit ? 'Editar objetivo' : 'Novo objetivo', () => `
      <label class="field"><span>Nome</span>
        <input id="o-nome" type="text" placeholder="Ex.: Reserva de emergência, Viagem, Carro" value="${escapeAttr(o.nome || '')}" required />
      </label>
      <label class="field"><span>Valor-alvo (R$)</span>
        <input id="o-alvo" type="text" inputmode="numeric" placeholder="0,00" value="${formatCentsDisplay(o.alvo)}" required />
      </label>
      <label class="field"><span>Prazo (opcional)</span>
        <input id="o-prazo" type="date" value="${escapeAttr(o.prazo || '')}" />
      </label>
      <label class="field"><span class="with-info">Categorias que contam pra esse objetivo${infoBtn('Só aparecem aqui as categorias marcadas como "É investimento".')}</span>
        <div class="check-list" id="o-cats">
          ${investCats.length === 0
            ? '<p style="color:var(--text-2);font-size:13px;margin:0;">Crie uma categoria marcada como "É investimento" primeiro.</p>'
            : investCats.map(c => `
              <label class="check-item">
                <input type="checkbox" data-cat="${escapeAttr(c.id)}" ${linkedSet.has(c.id) ? 'checked' : ''}/>
                ${catEmoji(c) ? `<span class="cat-emoji" style="background:${c.cor}22;">${catEmoji(c)}</span>` : `<span class="swatch" style="background:${c.cor}"></span>`}
                <span>${escapeHTML(c.nome)}</span>
              </label>`).join('')}
        </div>
      </label>
      <label class="field"><span class="with-info">Contar lançamentos a partir de (opcional)${infoBtn('Vazio = conta tudo o que já existe nessas categorias.')}</span>
        <input id="o-desde" type="date" value="${escapeAttr(o.desde || '')}" />
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
};
