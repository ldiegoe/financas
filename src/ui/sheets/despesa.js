// Sheet de despesa/investimento (o maior do app): descrição, valor, datas,
// categoria, tipo (única/mensal/parcelada), tags e templates.
// Fábrica: recebe as deps de runtime do app e devolve `sheetDespesa(desp, opts)`.
//
// `getState` é um getter porque `state` é `let` reatribuído no app.js (troca de
// perfil, pull do sync) — injetar o valor congelaria a referência. E é chamado
// em CADA uso, não snapshotado: `state.templates` é lido dentro dos handlers de
// clique, ou seja, potencialmente depois de um pull ter trocado o state.
//
// `fmtBRL` vem injetado de propósito: é o wrapper do app.js que respeita
// "Ocultar valores", não o helper puro de helpers/format.js.

import { bindCurrencyInput } from '../currency-input.js';
import { escapeHTML, escapeAttr } from '../escape.js';
import { formatCentsDisplay, yyyyMmFromDate } from '../../helpers/format.js';
import { parseAmount, parseTags, todayISO, isoToDate } from '../../helpers/parse.js';

export const createSheetDespesa = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast,
    getState, allTags, topTags, catEmoji, fmtBRL,
  } = deps;

  return (desp, opts = {}) => {
    const isEdit = !!desp;
    const catById = (id) => getState().categorias.find(c => c.id === id);
    // Contexto investimento: explícito (opts) ou inferido pela categoria da
    // despesa editada (categoria marcada como "É investimento").
    const investimento = !!opts.investimento || (isEdit && !!(catById(desp.categoriaId) || {}).poupanca);
    const cats = getState().categorias.filter(c => investimento ? c.poupanca : !c.poupanca);
    if (investimento && cats.length === 0) {
      alert('Crie uma categoria marcada como "É investimento" primeiro.');
      return;
    }
    const d = desp || { descricao: '', valor: 0, data: todayISO(), categoriaId: cats[0]?.id || null, recorrente: false, parcelas: 1, tags: [] };
    const existingTags = allTags();
    // Determina o "tipo" inicial a partir do estado atual da despesa
    const tipoInicial = d.recorrente ? 'mensal' : ((d.parcelas || 1) > 1 ? 'parcelada' : 'unica');

    openSheet(isEdit ? (investimento ? 'Editar investimento' : 'Editar despesa') : (investimento ? 'Novo investimento' : 'Nova despesa'), () => `
      ${!isEdit && !investimento && getState().templates.length > 0 ? `
        <div class="templates-row">
          ${getState().templates.map(t => `
            <button class="template-chip" data-tpl="${t.id}" type="button">
              ${escapeHTML(t.nome)}
              <span class="template-chip-x" data-del="${t.id}">×</span>
            </button>`).join('')}
        </div>
      ` : ''}
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
            ${topTags(40).map(t => `<button type="button" class="tag usertag" data-tag="${escapeAttr(t)}" style="border:0;cursor:pointer;">#${escapeHTML(t)}</button>`).join('')}
          </div>
        ` : ''}
      </label>
      ${!isEdit ? `
        <div class="checkbox-row">
          <input id="f-pago" type="checkbox" />
          <label for="f-pago">Já paga</label>
        </div>
        <small id="pago-hint" style="display:block;color:var(--text-2);font-size:12px;margin:-4px 2px 12px;"></small>
      ` : ''}
      ${!isEdit && !investimento ? `
        <button type="button" class="link" id="save-template" style="display:block;margin:12px auto 0;padding:0;">+ Salvar como template</button>
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

      // Templates de despesa: chip aplica os valores no formulário (descrição,
      // valor, categoria, tags, tipo). × remove o template após confirmação.
      const applyTemplate = (tpl) => {
        body.querySelector('#f-desc').value  = tpl.descricao || '';
        body.querySelector('#f-valor').value = formatCentsDisplay(tpl.valor || 0);
        const catSel = body.querySelector('#f-cat');
        if (catSel && tpl.categoriaId !== undefined) catSel.value = tpl.categoriaId || '';
        body.querySelector('#f-tags').value  = (tpl.tags || []).join(', ');
        const newTipo = tpl.recorrente ? 'mensal' : ((tpl.parcelas || 1) > 1 ? 'parcelada' : 'unica');
        tipoEl.value = newTipo;
        if (newTipo === 'parcelada' && tpl.parcelas > 1) parcEl.value = tpl.parcelas;
        updateInfo();
      };
      body.querySelectorAll('.template-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          if (e.target.closest('.template-chip-x')) return;
          const id = chip.dataset.tpl;
          const tpl = getState().templates.find(x => x.id === id);
          if (tpl) applyTemplate(tpl);
        });
      });
      body.querySelectorAll('.template-chip-x').forEach(x => {
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = x.dataset.del;
          const tpl = getState().templates.find(t => t.id === id);
          if (!tpl) return;
          if (!confirm(`Remover o template "${tpl.nome}"?`)) return;
          db.removeTemplate(id);
          x.closest('.template-chip').remove();
          toast('Template removido');
        });
      });
      const saveTplBtn = body.querySelector('#save-template');
      if (saveTplBtn) saveTplBtn.addEventListener('click', () => {
        const desc = body.querySelector('#f-desc').value.trim();
        const valor = parseAmount(body.querySelector('#f-valor').value);
        const catId = body.querySelector('#f-cat').value || null;
        const tagsArr = parseTags(body.querySelector('#f-tags').value);
        const tipo = tipoEl.value;
        const nome = (prompt('Nome do template:', desc) || '').trim();
        if (!nome) return;
        let parcelas = 1, recorrente = false;
        if (tipo === 'mensal') recorrente = true;
        if (tipo === 'parcelada') parcelas = Math.max(2, Math.min(360, parseInt(parcEl.value, 10) || 0));
        db.addTemplate({ nome, descricao: desc, valor, categoriaId: catId, tags: tagsArr, recorrente, parcelas });
        toast('Template salvo');
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
};
