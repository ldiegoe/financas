// Sheet de receita (Carteira → "Nova receita" / "Editar receita").
// Fábrica: recebe as dependências de runtime do app (openSheet/closeSheet, db,
// render, toast) e devolve a função `sheetRenda(renda)`.

import { bindCurrencyInput } from '../currency-input.js';
import { escapeAttr } from '../escape.js';
import { formatCentsDisplay } from '../../helpers/format.js';
import { parseAmount, todayISO } from '../../helpers/parse.js';

export const createSheetRenda = (deps) => {
  const { openSheet, closeSheet, db, render, toast } = deps;

  return (renda) => {
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
        <input id="f-data" type="date" value="${escapeAttr(r.data)}" required />
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
               placeholder="Deixe vazio para sem fim" value="${escapeAttr(r.duracaoMeses || '')}" />
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
};
