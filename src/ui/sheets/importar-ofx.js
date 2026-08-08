// Sheet de importação de fatura/extrato .ofx: lê, parseia, anota
// (nova/duplicata/crédito/manual) e mostra uma tela de revisão onde o usuário
// confirma o que entra e ajusta categorias. Nada é gravado antes do "Importar".
// Fábrica: recebe as deps de runtime do app e devolve `sheetImportarOFX()`.
//
// ⚠️ O import() dinâmico de read-file.js é relativo a ESTE arquivo — o
// especificador mudou de './src/ui/read-file.js' para '../read-file.js' ao sair
// do app.js. Especificador errado só falharia em runtime, ao escolher o arquivo.

import { escapeHTML, escapeAttr } from '../escape.js';
import { icon } from '../icons.js';
import { fmtDate } from '../../helpers/format.js';
import { parseTags, todayISO } from '../../helpers/parse.js';
import { parseOfx } from '../../domain/ofx.js';
import {
  annotateImport, annotateExtrato, resumoRows, resumoExtrato,
  rowsToDespesas, rowsToRendas,
} from '../../domain/import-review.js';

const MOTIVO_BADGE = {
  duplicata:        '<span class="tag dup">já importado</span>',
  'duplicata-lote': '<span class="tag dup">repetido no arquivo</span>',
  credito:          '<span class="tag credito">crédito</span>',
  manual:           '<span class="tag manual">confira</span>',
  nova:             '',
};

export const createSheetImportarOFX = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast, getState, fmtBRL,
    allTags, topTags, catEmoji, uid,
  } = deps;

  return () => {
    let kind = null;          // 'fatura' | 'extrato' (escolhido na 1ª tela)
    let etapa = 'escolher';   // escolher → lendo → revisar → feito
    let rows = [];
    let meta = null;          // { banco, arquivo, de, ate, fechamento, aviso }
    let erro = '';
    let importId = null;
    // Vencimento (só fatura): quando ligado, despesas entram nesta data.
    let vencOn = true;
    let vencDate = null;
    let removidas = 0;

    const catsExpense = () => getState().categorias.filter(c => !c.poupanca);

    const catOptions = (selected) =>
      `<option value="">— sem categoria —</option>` +
      catsExpense().map(c =>
        `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${catEmoji(c) ? catEmoji(c) + ' ' : ''}${escapeHTML(c.nome)}</option>`
      ).join('');

    const checkSvg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const catBlock = (r, i) => `
      <select class="imp-cat" data-i="${i}">${catOptions(r.categoriaId)}</select>
      <div class="imp-tagwrap">
        <input class="imp-tags" data-i="${i}" list="imp-taglist"
               value="${escapeAttr((r.tags || []).join(', '))}"
               placeholder="+ tags" autocapitalize="none" autocorrect="off" aria-label="Tags" />
      </div>`;

    // Linha da FATURA: despesa (crédito = pagamento, readonly).
    const rowFatura = (r, i) => {
      const t = r.txn;
      const parcela = t.parcelaTotal ? `<span class="tag installment">${t.parcelaNum}/${t.parcelaTotal}</span>` : '';
      const editavel = t.ehDespesa;
      return `
        <li class="imp-row ${r.incluir ? 'on' : ''}" data-i="${i}">
          <button class="imp-check" type="button" aria-label="${r.incluir ? 'Não importar' : 'Importar'}">${checkSvg}</button>
          <div class="imp-main">
            <div class="imp-line1">
              <input class="imp-name" data-i="${i}" value="${escapeAttr(r.descricao)}" ${editavel ? '' : 'readonly'} aria-label="Descrição" />
              <span class="imp-amount ${editavel ? 'neg' : 'pos'}">${fmtBRL(t.valor)}</span>
            </div>
            <div class="imp-sub"><span>${fmtDate(t.data)}</span> ${parcela} ${MOTIVO_BADGE[r.motivo] || ''}</div>
            ${editavel ? catBlock(r, i) : ''}
          </div>
        </li>`;
    };

    // Linha do EXTRATO: tipo (despesa/receita) alternável; categoria/tags só
    // aparecem em despesa (via classe .tipo-*). Transferências vêm desmarcadas.
    const rowExtrato = (r, i) => {
      const t = r.txn;
      const badge = r.transferencia ? '<span class="tag manual">transferência</span>' : (MOTIVO_BADGE[r.motivo] || '');
      return `
        <li class="imp-row tipo-${r.tipo} ${r.incluir ? 'on' : ''}" data-i="${i}">
          <button class="imp-check" type="button" aria-label="${r.incluir ? 'Não importar' : 'Importar'}">${checkSvg}</button>
          <div class="imp-main">
            <div class="imp-line1">
              <input class="imp-name" data-i="${i}" value="${escapeAttr(r.descricao)}" aria-label="Descrição" />
              <span class="imp-amount">${fmtBRL(t.valor)}</span>
            </div>
            <div class="imp-sub">
              <div class="imp-type">
                <button type="button" class="imp-type-btn" data-i="${i}" data-tipo="despesa">Despesa</button>
                <button type="button" class="imp-type-btn" data-i="${i}" data-tipo="receita">Receita</button>
              </div>
              <span>${fmtDate(t.data)}</span> ${badge}
            </div>
            ${catBlock(r, i)}
          </div>
        </li>`;
    };

    const rowHTML = (r, i) => kind === 'extrato' ? rowExtrato(r, i) : rowFatura(r, i);

    // Resumo do rodapé conforme o modo.
    const footerInfo = () => {
      if (kind === 'extrato') {
        const r = resumoExtrato(rows);
        return { count: r.incluir, right: `${r.despesas} desp · ${r.receitas} rec`, disabled: r.incluir === 0 };
      }
      const r = resumoRows(rows);
      return { count: r.incluir, right: fmtBRL(r.somaIncluir), disabled: r.incluir === 0 };
    };

    const headerChips = () => {
      if (kind === 'extrato') {
        const r = resumoExtrato(rows);
        return [
          r.despesas ? `<span class="imp-chip desp">${r.despesas} despesa${r.despesas === 1 ? '' : 's'}</span>` : '',
          r.receitas ? `<span class="imp-chip receita">${r.receitas} receita${r.receitas === 1 ? '' : 's'}</span>` : '',
          r.transferencias ? `<span class="imp-chip credito">${r.transferencias} transferência${r.transferencias === 1 ? '' : 's'}</span>` : '',
          r.duplicatas ? `<span class="imp-chip dup">${r.duplicatas} já no app</span>` : '',
        ].filter(Boolean).join('');
      }
      const r = resumoRows(rows);
      const novas = r.novas + r.manuais;
      return [
        novas ? `<span class="imp-chip nova">${novas} nova${novas === 1 ? '' : 's'}</span>` : '',
        r.duplicatas ? `<span class="imp-chip dup">${r.duplicatas} já no app</span>` : '',
        r.creditos ? `<span class="imp-chip credito">${r.creditos} crédito${r.creditos === 1 ? '' : 's'}</span>` : '',
      ].filter(Boolean).join('');
    };

    const conteudo = () => {
      if (etapa === 'lendo') {
        return `<p style="text-align:center;padding:24px 0;color:var(--text-2);">Lendo o arquivo…</p>`;
      }

      if (etapa === 'feito') {
        const msg = kind === 'extrato'
          ? 'As despesas entraram como pagas (o dinheiro já saiu) e as receitas foram lançadas.'
          : 'As despesas entraram como pendentes — marque cada uma como paga quando quitar a fatura.';
        return `
          <div class="boleto-resumo">
            <strong>${removidas === 0 ? 'Importação concluída' : 'Importação desfeita'}</strong>
            ${removidas === 0 ? `<div class="s">${msg}</div>` : ''}
          </div>
          <div class="actions">
            ${removidas === 0 ? `<button class="danger" id="undo">Desfazer importação</button>` : ''}
            <button class="primary" id="done">Concluir</button>
          </div>`;
      }

      if (etapa === 'revisar') {
        const f = footerInfo();
        return `
          <div class="imp-head">
            <div class="imp-head-top">
              <span class="imp-bank">${escapeHTML(meta.banco || (kind === 'extrato' ? 'Extrato' : 'Fatura'))}</span>
              <span class="imp-period">${fmtDate(meta.de)} – ${fmtDate(meta.ate)}</span>
            </div>
            <div class="imp-file">${escapeHTML(meta.arquivo)}</div>
            <div class="imp-chips">${headerChips()}</div>
            ${meta.aviso ? `<p class="boleto-aviso" style="margin-top:10px;">${escapeHTML(meta.aviso)}</p>` : ''}
          </div>

          <div class="imp-toolbar">
            <div class="imp-seg">
              <button type="button" id="bulk-default">Padrão</button>
              <button type="button" id="bulk-none">Limpar</button>
            </div>
            <select id="bulk-cat" class="imp-bulkcat" aria-label="Categoria para as marcadas">
              <option value="">Categoria em massa…</option>
              ${catsExpense().map(c => `<option value="${c.id}">${catEmoji(c) ? catEmoji(c) + ' ' : ''}${escapeHTML(c.nome)}</option>`).join('')}
            </select>
          </div>

          ${kind === 'fatura' ? `
            <div class="imp-venc">
              <label class="imp-venc-row">
                <input type="checkbox" id="venc-on" ${vencOn ? 'checked' : ''}/>
                <span>Lançar tudo no vencimento da fatura</span>
              </label>
              <input type="date" id="venc-date" value="${vencDate || ''}" ${vencOn ? '' : 'disabled'}/>
              <small>
                ${meta.fechamento ? `A fatura fecha em <strong>${fmtDate(meta.fechamento)}</strong>. ` : ''}Ajuste
                para o dia em que você paga. A data de cada compra fica guardada.
              </small>
            </div>
          ` : ''}

          <datalist id="imp-taglist">${allTags().map(t => `<option value="${escapeAttr(t)}"></option>`).join('')}</datalist>
          <ul class="imp-list">${rows.map(rowHTML).join('')}</ul>

          <div class="imp-footer">
            <button class="secondary" id="cancel">Cancelar</button>
            <button class="primary" id="confirm" ${f.disabled ? 'disabled' : ''}>
              Importar <span id="imp-count">${f.count}</span> · <span id="imp-soma">${f.right}</span>
            </button>
          </div>`;
      }

      // etapa 'escolher' — dois caminhos
      return `
        <p style="color:var(--text-2);font-size:14px;margin:0 2px 14px;line-height:1.5;">
          Importe um arquivo <strong>OFX</strong> do seu banco. Escolha o tipo:
        </p>
        ${erro ? `<p class="boleto-aviso">${escapeHTML(erro)}</p>` : ''}
        <input id="f-ofx" type="file" accept=".ofx,application/x-ofx,application/octet-stream" hidden />
        <button class="imp-choice" id="pick-fatura" type="button">
          <strong>${icon('card', 18)} Fatura do cartão</strong>
          <span>Compras do cartão de crédito. Viram despesas; dá pra lançar tudo no vencimento.</span>
        </button>
        <button class="imp-choice" id="pick-extrato" type="button">
          <strong>${icon('wallet', 18)} Extrato da conta</strong>
          <span>Pix, transferências e boletos. Separa despesa, receita e transferência (caixinha).</span>
        </button>
        <div class="actions"><button class="secondary" id="cancel">Cancelar</button></div>`;
    };

    const processarArquivo = async (file) => {
      erro = '';
      etapa = 'lendo';
      abrir();
      try {
        const { readTextFile } = await import('../read-file.js');
        const texto = await readTextFile(file);
        const parsed = parseOfx(texto);
        if (parsed.transacoes.length === 0) {
          erro = 'Nenhuma transação encontrada. Confirme que é um arquivo .ofx.';
          etapa = 'escolher';
        } else {
          // Aviso se o tipo detectado no arquivo diverge do escolhido.
          let aviso = '';
          if (kind === 'fatura' && parsed.tipoConta === 'checking')
            aviso = 'Este arquivo parece um extrato de conta, não uma fatura. Você pode voltar e escolher "Extrato da conta".';
          if (kind === 'extrato' && parsed.tipoConta === 'creditcard')
            aviso = 'Este arquivo parece uma fatura de cartão. Você pode voltar e escolher "Fatura do cartão".';

          const anot = kind === 'extrato'
            ? annotateExtrato({ transacoes: parsed.transacoes, despesas: getState().despesas, rendas: getState().rendas, categorias: getState().categorias })
            : annotateImport({ transacoes: parsed.transacoes, despesas: getState().despesas, categorias: getState().categorias });
          rows = anot.rows;
          meta = { banco: parsed.banco, arquivo: file.name, de: parsed.de, ate: parsed.ate, fechamento: parsed.fechamento, aviso };
          vencDate = parsed.fechamento || parsed.ate || todayISO();
          etapa = 'revisar';
        }
      } catch (e) {
        erro = 'Não consegui ler este arquivo. Ele precisa estar no formato OFX.';
        etapa = 'escolher';
      }
      abrir();
    };

    const abrir = () => openSheet(kind === 'extrato' ? 'Importar extrato' : 'Importar fatura', conteudo, (body) => {
      const cancel = body.querySelector('#cancel');
      if (cancel) cancel.addEventListener('click', closeSheet);

      // --- etapa escolher: dois botões, mesmo input ---
      const input = body.querySelector('#f-ofx');
      const pickFatura = body.querySelector('#pick-fatura');
      const pickExtrato = body.querySelector('#pick-extrato');
      if (input) {
        if (pickFatura) pickFatura.addEventListener('click', () => { kind = 'fatura'; input.click(); });
        if (pickExtrato) pickExtrato.addEventListener('click', () => { kind = 'extrato'; input.click(); });
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (file) processarArquivo(file);
        });
      }

      // --- etapa revisar ---
      const footerRefresh = () => {
        const f = footerInfo();
        const cnt = body.querySelector('#imp-count');
        const soma = body.querySelector('#imp-soma');
        const btn = body.querySelector('#confirm');
        if (cnt) cnt.textContent = f.count;
        if (soma) soma.textContent = f.right;
        if (btn) btn.disabled = f.disabled;
      };

      const lista = body.querySelector('.imp-list');
      if (lista) {
        // Chips de tags frequentes sob o campo de tags em foco.
        let chipTimer = null;
        const removeChips = () => lista.querySelector('.imp-tagchips')?.remove();
        const showChips = (inp) => {
          const usadas = new Set(parseTags(inp.value).map(t => t.toLowerCase()));
          const sug = topTags(40).filter(t => !usadas.has(t.toLowerCase()));
          const wrap = inp.parentElement;
          wrap.querySelector('.imp-tagchips')?.remove();
          if (sug.length === 0) return;
          const bar = document.createElement('div');
          bar.className = 'imp-tagchips';
          bar.innerHTML = sug.map(t => `<button type="button" class="imp-tagchip" data-tag="${escapeAttr(t)}">#${escapeHTML(t)}</button>`).join('');
          wrap.appendChild(bar);
        };
        lista.addEventListener('focusin', (e) => {
          if (!e.target.classList.contains('imp-tags')) return;
          if (chipTimer) { clearTimeout(chipTimer); chipTimer = null; }
          removeChips(); showChips(e.target);
        });
        lista.addEventListener('focusout', (e) => {
          if (!e.target.classList.contains('imp-tags')) return;
          chipTimer = setTimeout(removeChips, 250);
        });

        lista.addEventListener('click', (e) => {
          // Tap num chip de tag.
          const chip = e.target.closest('.imp-tagchip');
          if (chip) {
            const wrap = chip.closest('.imp-tagwrap');
            const inp = wrap.querySelector('.imp-tags');
            const i = Number(inp.dataset.i);
            const cur = parseTags(inp.value);
            const tag = chip.dataset.tag;
            if (!cur.some(t => t.toLowerCase() === tag.toLowerCase())) cur.push(tag);
            inp.value = cur.join(', ');
            rows[i].tags = cur;
            inp.focus(); showChips(inp);
            return;
          }
          // Alternar tipo (extrato): muda a classe da linha, sem re-render.
          const typeBtn = e.target.closest('.imp-type-btn');
          if (typeBtn) {
            const i = Number(typeBtn.dataset.i);
            rows[i].tipo = typeBtn.dataset.tipo;
            const li = typeBtn.closest('.imp-row');
            li.classList.remove('tipo-despesa', 'tipo-receita');
            li.classList.add('tipo-' + rows[i].tipo);
            footerRefresh();
            return;
          }
          // Toggle de inclusão: SÓ ao tocar na bolinha, pra não desmarcar sem
          // querer ao mirar no nome/tags/categoria.
          const checkBtn = e.target.closest('.imp-check');
          if (checkBtn) {
            const li = checkBtn.closest('.imp-row');
            const i = Number(li.dataset.i);
            rows[i].incluir = !rows[i].incluir;
            li.classList.toggle('on', rows[i].incluir);
            checkBtn.setAttribute('aria-label', rows[i].incluir ? 'Não importar' : 'Importar');
            footerRefresh();
          }
        });
        lista.addEventListener('input', (e) => {
          const el = e.target;
          const i = Number(el.dataset.i);
          if (el.classList.contains('imp-name')) rows[i].descricao = el.value;
          else if (el.classList.contains('imp-tags')) rows[i].tags = parseTags(el.value);
        });
        lista.addEventListener('change', (e) => {
          const sel = e.target.closest('.imp-cat');
          if (sel) rows[Number(sel.dataset.i)].categoriaId = sel.value || null;
        });
      }

      // Controle de vencimento (só fatura).
      const vencOnEl = body.querySelector('#venc-on');
      const vencDateEl = body.querySelector('#venc-date');
      if (vencOnEl) vencOnEl.addEventListener('change', () => {
        vencOn = vencOnEl.checked;
        if (vencDateEl) vencDateEl.disabled = !vencOn;
      });
      if (vencDateEl) vencDateEl.addEventListener('change', () => { if (vencDateEl.value) vencDate = vencDateEl.value; });

      const bulkDefault = body.querySelector('#bulk-default');
      if (bulkDefault) bulkDefault.addEventListener('click', () => {
        rows.forEach(r => { r.incluir = (r.motivo === 'nova' || r.motivo === 'manual'); });
        abrir();
      });
      const bulkNone = body.querySelector('#bulk-none');
      if (bulkNone) bulkNone.addEventListener('click', () => {
        rows.forEach(r => { r.incluir = false; });
        abrir();
      });
      const bulkCat = body.querySelector('#bulk-cat');
      if (bulkCat) bulkCat.addEventListener('change', () => {
        const id = bulkCat.value || null;
        if (!id) return;
        rows.forEach(r => { if (r.incluir && r.tipo !== 'receita') r.categoriaId = id; });
        abrir();
      });

      const confirm = body.querySelector('#confirm');
      if (confirm) confirm.addEventListener('click', () => {
        importId = uid();
        const despesas = rowsToDespesas(rows, {
          importId,
          fonte: meta.arquivo,
          importadoEm: todayISO(),
          vencimento: (kind === 'fatura' && vencOn && vencDate) ? vencDate : null,
          // Extrato: o dinheiro já saiu → nasce paga. Fatura: paga depois.
          pago: kind === 'extrato',
        });
        const rendas = kind === 'extrato'
          ? rowsToRendas(rows, { importId, importadoEm: todayISO() })
          : [];
        if (despesas.length === 0 && rendas.length === 0) return;
        if (despesas.length) db.addDespesasBatch(despesas);
        if (rendas.length) db.addRendasBatch(rendas);
        removidas = 0;
        etapa = 'feito';
        abrir();
        render();
      });

      // --- etapa feito ---
      const undo = body.querySelector('#undo');
      if (undo) undo.addEventListener('click', () => {
        removidas = db.removeImport(importId);
        etapa = 'feito';
        abrir();
        render();
      });
      const done = body.querySelector('#done');
      if (done) done.addEventListener('click', () => {
        closeSheet();
        toast(removidas === 0 ? 'Importação concluída' : 'Importação desfeita');
      });
    });

    abrir();
  };
};
