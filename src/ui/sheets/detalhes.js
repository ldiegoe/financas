// Sheets de detalhes (tocar numa linha da lista): despesa, receita e o de
// antecipar parcelas.
// Os três moram juntos porque sheetDespesaDetalhes chama
// sheetAnteciparParcelas — no mesmo módulo a chamada resolve internamente.
// Fábrica: recebe as deps de runtime do app e devolve os três.

import { escapeHTML } from '../escape.js';
import { icon } from '../icons.js';
import { fmtDate } from '../../helpers/format.js';
import { todayISO } from '../../helpers/parse.js';
import { partsOf } from '../../domain/period.js';
import { formatLinha } from '../../domain/boleto.js';

export const createSheetsDetalhes = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast, getState, fmtBRL,
    boletoDaOcorrencia, boletosDaDespesa, daysSince, copyToClipboard,
    toggleDespesaPago, sheetDespesa, sheetRenda, sheetImportarBoletos,
  } = deps;

  const sheetAnteciparParcelas = (d) => {
    const desp = getState().despesas.find(x => x.id === d.id);
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
    const cat = getState().categorias.find(c => c.id === d.categoriaId);
    const tipo = d.recorrente
      ? 'Mensal recorrente'
      : (d._parcelaTotal ? `Parcelada (${d._parcelaNum}/${d._parcelaTotal})`
        : (d.parcelaImport ? `Parcela ${d.parcelaImport} da fatura` : 'Apenas neste mês'));
    const tags = d.tags || [];

    // Boleto do mes desta ocorrencia (se o carne ja foi importado).
    const boleto = boletoDaOcorrencia(d);
    const totalBoletos = boletosDaDespesa(d.id).length;
    const diasDesdeVencimento = boleto ? daysSince(boleto.vencimento) : 0;
    const boletoVencido = !!boleto && !d._pago && diasDesdeVencimento > 0;
    const boletoValorDiverge = !!boleto && boleto.valor !== d.valor;

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

      ${boleto ? `
        <div class="boleto-box">
          <div class="boleto-head">
            ${icon('barcode', 18)}
            <span>Boleto · vence ${fmtDate(boleto.vencimento)}</span>
          </div>
          <div class="boleto-linha" id="boleto-linha">${formatLinha(boleto.linha)}</div>
          <button class="primary boleto-copy" id="copy-boleto">
            ${icon('copy', 16)} Copiar código
          </button>
          ${boletoValorDiverge ? `
            <p class="boleto-aviso">O boleto é de ${fmtBRL(boleto.valor)}, diferente
              do valor cadastrado (${fmtBRL(d.valor)}).</p>` : ''}
          ${boletoVencido ? `
            <p class="boleto-aviso">Vencido há ${diasDesdeVencimento}
              ${diasDesdeVencimento === 1 ? 'dia' : 'dias'} — o banco pode recusar este
              código ou cobrar multa e juros por fora.</p>` : ''}
          <div class="boleto-meta">
            ${escapeHTML(boleto.origem || 'importado')}${totalBoletos > 1
              ? ` · ${totalBoletos} boletos nesta despesa` : ''}
            <button class="link" id="del-boleto">Remover</button>
          </div>
        </div>
      ` : `
        <button id="add-boleto" class="secondary boleto-add">
          ${icon('barcode', 16)} ${totalBoletos > 0
            ? 'Sem boleto para este mês — importar outro PDF'
            : 'Anexar carnê (PDF)'}
        </button>
      `}

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

      const copyBtn = body.querySelector('#copy-boleto');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(boleto.linha);
        toast(ok ? 'Código copiado' : 'Não consegui copiar — toque e segure no código');
      });
      const addBoleto = body.querySelector('#add-boleto');
      if (addBoleto) addBoleto.addEventListener('click', () => {
        sheetImportarBoletos(getState().despesas.find(x => x.id === d.id));
      });
      const delBoleto = body.querySelector('#del-boleto');
      if (delBoleto) delBoleto.addEventListener('click', () => {
        if (!confirm(`Remover o boleto de ${fmtDate(boleto.vencimento)}?`)) return;
        db.removeBoleto(boleto.id);
        closeSheet();
        toast('Boleto removido');
        render();
      });

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
        sheetDespesa(getState().despesas.find(x => x.id === d.id));
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
        sheetRenda(getState().rendas.find(x => x.id === r.id));
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

  return { sheetDespesaDetalhes, sheetAnteciparParcelas, sheetRendaDetalhes };
};
