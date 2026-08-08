// Sheet de importação de carnê/boleto em PDF: lê o PDF, extrai os boletos,
// casa cada um com a despesa mais provável e deixa o usuário revisar antes de
// gravar.
// Fábrica: recebe as deps de runtime do app e devolve
// `sheetImportarBoletos(despesaBase)`.
//
// ⚠️ O import() dinâmico de pdf-text.js é relativo a ESTE arquivo — o
// especificador mudou de './src/ui/pdf-text.js' para '../pdf-text.js' ao sair
// do app.js. Especificador errado só falharia em runtime, ao escolher o PDF.

import { escapeHTML, escapeAttr } from '../escape.js';
import { infoBtn } from '../info-popover.js';
import { fmtDate } from '../../helpers/format.js';
import { todayISO } from '../../helpers/parse.js';
import { cobreMes, parcelaDoMes } from '../../domain/despesa.js';
import {
  extractBoletos, resumoBoletos, scoreDespesa, mergeBoletos,
} from '../../domain/boleto.js';

export const createSheetImportarBoletos = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast, getState, fmtBRL,
    boletosDaDespesa, uid,
  } = deps;

  return (despesaBase) => {
    let etapa = 'escolher';     // escolher → lendo → revisar
    let encontrados = [];
    let nomeArquivo = '';
    let erro = '';
    let progresso = '';
    let despesaId = despesaBase ? despesaBase.id : null;

    // Ranking de despesas pra sugestao — melhor palpite primeiro. Inclui as de
    // investimento de proposito: financiamento de lote/imovel e consorcio sao
    // justamente o tipo de coisa que vem em carne e que o usuario categoriza
    // como investimento.
    const ranking = () => getState().despesas
      .map(d => ({
        d,
        score: scoreDespesa(d, encontrados,
          encontrados.filter(b => cobreMes(d, b.mesRef)).map(b => b.mesRef)),
      }))
      .sort((a, b) => b.score - a.score || b.d.data.localeCompare(a.d.data));

    // Rotulo da opcao: descricao + valor + tipo, pra dar pra distinguir duas
    // despesas parecidas sem sair da tela.
    const rotuloDespesa = (d) => {
      const tipo = (d.parcelas || 0) > 1
        ? `${d.parcelas}x desde ${fmtDate(d.data).slice(3)}`
        : (d.recorrente ? 'mensal' : fmtDate(d.data));
      return `${d.descricao || 'Despesa'} — ${fmtBRL(d.valor)} · ${tipo}`;
    };

    const conteudo = () => {
      if (etapa === 'lendo') {
        return `<p style="text-align:center;padding:24px 0;color:var(--text-2);">
                  Lendo o PDF…<br/><small>${escapeHTML(progresso)}</small>
                </p>`;
      }

      if (etapa === 'revisar') {
        const r = resumoBoletos(encontrados);
        const opcoes = ranking();
        // O <select> exibe a 1a opcao quando nenhuma casa com o valor
        // selecionado — o que faria a tela mostrar uma despesa e o import ir
        // pra outra. Alinhamos o estado ao que esta visivel antes de renderizar.
        if (opcoes.length > 0 && !opcoes.some(o => o.d.id === despesaId)) {
          despesaId = opcoes[0].d.id;
        }
        const despesa = getState().despesas.find(x => x.id === despesaId);
        if (opcoes.length === 0) {
          return `
            <p class="boleto-aviso">Achei ${r.total} boleto${r.total === 1 ? '' : 's'},
              mas não há despesa cadastrada pra vincular. Cadastre a despesa
              (parcelada, ${r.valor !== null ? fmtBRL(r.valor) : 'valor variável'},
              vencendo em ${fmtDate(r.de)}) e importe de novo.</p>
            <div class="actions">
              <button class="secondary" id="cancel">Fechar</button>
            </div>`;
        }
        const foraDoPeriodo = despesa
          ? encontrados.filter(b => !cobreMes(despesa, b.mesRef)).length : 0;
        const valorDiverge = despesa && r.valor !== null && r.valor !== despesa.valor;
        const jaExistem = despesa
          ? encontrados.filter(b => boletosDaDespesa(despesa.id)
              .some(x => x.mesRef === b.mesRef && x.linha === b.linha)).length : 0;

        return `
          <div class="boleto-resumo">
            <strong>${r.total} boleto${r.total === 1 ? '' : 's'}</strong> em
            ${escapeHTML(nomeArquivo)}
            <div class="s">${fmtDate(r.de)} a ${fmtDate(r.ate)} ·
              ${r.valor !== null ? fmtBRL(r.valor) + ' cada'
                                 : `${fmtBRL(r.valorMin)} a ${fmtBRL(r.valorMax)}`}</div>
          </div>

          <label class="field"><span class="with-info">Vincular à despesa${infoBtn('Cada boleto entra no mês do seu vencimento. Reimportar o mesmo carnê não duplica nada.')}</span>
            <select id="f-despesa">
              ${opcoes.map(({ d, score }) => `
                <option value="${escapeAttr(d.id)}" ${d.id === despesaId ? 'selected' : ''}>
                  ${escapeHTML(rotuloDespesa(d))}${score >= 200 ? ' ✓' : ''}
                </option>`).join('')}
            </select>
          </label>

          ${valorDiverge ? `
            <p class="boleto-aviso">O boleto é de ${fmtBRL(r.valor)} e a despesa está
              cadastrada como ${fmtBRL(despesa.valor)}. Dá pra importar mesmo assim —
              só confira se é a despesa certa.</p>` : ''}
          ${foraDoPeriodo > 0 ? `
            <p class="boleto-aviso">${foraDoPeriodo} boleto${foraDoPeriodo === 1 ? '' : 's'}
              ${foraDoPeriodo === 1 ? 'cai' : 'caem'} em ${foraDoPeriodo === 1 ? 'mês' : 'meses'}
              sem parcela nesta despesa. ${foraDoPeriodo === 1 ? 'Ele será guardado' : 'Eles serão guardados'}
              mesmo assim, mas talvez a despesa não seja essa.</p>` : ''}
          ${jaExistem > 0 ? `
            <p style="color:var(--text-2);font-size:13px;margin:12px 2px;">
              ${jaExistem} já ${jaExistem === 1 ? 'está importado' : 'estão importados'} nesta despesa.
            </p>` : ''}

          <ul class="details-list boleto-preview">
            ${encontrados.map(b => {
              const n = despesa ? parcelaDoMes(despesa, b.mesRef) : null;
              return `<li>
                <span>${fmtDate(b.vencimento)}${n ? ` · parcela ${n}` : ''}</span>
                <span>${fmtBRL(b.valor)}</span>
              </li>`;
            }).join('')}
          </ul>

          <div class="actions">
            <button class="secondary" id="cancel">Cancelar</button>
            <button class="primary"   id="confirm" ${despesaId ? '' : 'disabled'}>Importar</button>
          </div>`;
      }

      // etapa 'escolher'
      return `
        <p style="color:var(--text-2);font-size:14px;margin:0 2px 16px;line-height:1.5;">
          Escolha o PDF do carnê — o arquivo não é armazenado.
          ${infoBtn('O app lê os códigos de barras do PDF, descobre o vencimento e o valor de cada parcela, e guarda só os códigos.')}
        </p>
        ${erro ? `<p class="boleto-aviso">${escapeHTML(erro)}</p>` : ''}
        <input id="f-pdf" type="file" accept="application/pdf,.pdf" hidden />
        <button class="primary" id="pick" style="width:100%;">Escolher PDF</button>
        <div class="actions">
          <button class="secondary" id="cancel">Cancelar</button>
        </div>`;
    };

    const abrir = () => openSheet('Importar boletos', conteudo, (body) => {
      const cancel = body.querySelector('#cancel');
      if (cancel) cancel.addEventListener('click', closeSheet);

      const pick = body.querySelector('#pick');
      if (pick) {
        const input = body.querySelector('#f-pdf');
        pick.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          nomeArquivo = file.name;
          erro = '';
          progresso = '';
          etapa = 'lendo';
          abrir();
          try {
            const { extractPdfText } = await import('../pdf-text.js');
            const texto = await extractPdfText(file, (p, total) => {
              progresso = `página ${p} de ${total}`;
              const alvo = document.querySelector('.sheet-body small');
              if (alvo) alvo.textContent = progresso;
            });
            encontrados = extractBoletos(texto, new Date());
            if (encontrados.length === 0) {
              erro = 'Nenhum boleto encontrado neste PDF. Se ele for uma imagem '
                   + '(digitalizada), o código não pode ser lido automaticamente.';
              etapa = 'escolher';
            } else {
              // Sem despesa pre-selecionada, adota o melhor palpite.
              if (!despesaId) despesaId = (ranking()[0] || {}).d?.id || null;
              etapa = 'revisar';
            }
          } catch (e) {
            erro = navigator.onLine
              ? 'Não consegui ler este PDF. Ele pode estar protegido por senha ou corrompido.'
              : 'Sem conexão — a primeira leitura de PDF precisa baixar o leitor. '
              + 'Conecte-se uma vez e depois funciona offline.';
            etapa = 'escolher';
          }
          abrir();
        });
      }

      const sel = body.querySelector('#f-despesa');
      if (sel) sel.addEventListener('change', () => { despesaId = sel.value; abrir(); });

      const confirmBtn = body.querySelector('#confirm');
      if (confirmBtn) confirmBtn.addEventListener('click', () => {
        const r = mergeBoletos(getState().boletos || [], encontrados, {
          despesaId,
          origem: nomeArquivo,
          importadoEm: todayISO(),
          uid,
        });
        db.setBoletos(r.boletos);
        closeSheet();
        const partes = [];
        if (r.adicionados)  partes.push(`${r.adicionados} importado${r.adicionados === 1 ? '' : 's'}`);
        if (r.atualizados)  partes.push(`${r.atualizados} atualizado${r.atualizados === 1 ? '' : 's'}`);
        if (r.iguais && !r.adicionados && !r.atualizados) partes.push('nada novo');
        toast(partes.join(', ') || 'Boletos importados');
        render();
      });
    });

    abrir();
  };
};
