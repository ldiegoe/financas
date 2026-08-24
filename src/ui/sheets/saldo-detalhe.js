// Detalhe do saldo do mês: a memória de cálculo que leva ao número do card.
//
// O card do dashboard mostra só a conclusão (saldo e saldo atual). Tocar nele
// abre esta tela com as parcelas que formam esse número. Somente leitura —
// não há nada pra editar aqui, então também não há `#save` nem `render()`.
//
// Recebe os totais JÁ CALCULADOS pelo dashboard em vez de recalcular: são as
// mesmas somas que pintaram o card, e refazer a conta aqui abriria espaço pra
// os dois números divergirem sem ninguém notar.

import { escapeHTML } from '../escape.js';

export const createSheetSaldoDetalhe = (deps) => {
  const { openSheet, closeSheet, fmtBRL } = deps;

  // `linha` é o par rótulo↔valor; `cor` só existe onde há polaridade real de
  // dinheiro (receita entrou, despesa saiu). O resto é neutro.
  const linha = (rotulo, valor, cor = '') => `
    <div class="sd-row">
      <span class="sd-label">${escapeHTML(rotulo)}</span>
      <span class="sd-value ${cor}">${fmtBRL(valor)}</span>
    </div>`;

  const sub = (rotulo, valor) => `
    <div class="sd-row sd-sub">
      <span class="sd-label">${escapeHTML(rotulo)}</span>
      <span class="sd-value">${fmtBRL(valor)}</span>
    </div>`;

  return (d) => openSheet(`Saldo · ${d.periodo}`, () => `
    ${linha('Receitas', d.totalRenda, 'positive')}
    ${d.rendaProgramada > 0 ? sub('A receber', d.rendaProgramada) : ''}

    <div class="sd-divider"></div>

    ${linha('Despesas', d.totalDespesa, 'negative')}
    ${d.totalGuardado > 0 ? sub('Gastos', d.totalGastos) : ''}
    ${d.totalGuardado > 0 ? sub('Investido', d.totalGuardado) : ''}
    ${sub('Já pago', d.totalPago)}
    ${sub('A pagar', d.totalPendente)}

    <div class="sd-divider"></div>

    ${linha('Saldo', d.saldo, d.saldo >= 0 ? 'positive' : 'negative')}
    ${sub('Atual (já pago)', d.saldoAtual)}

    <div class="actions">
      <button class="secondary" id="cancel">Fechar</button>
    </div>
  `, (body) => {
    body.querySelector('#cancel').addEventListener('click', closeSheet);
  });
};
