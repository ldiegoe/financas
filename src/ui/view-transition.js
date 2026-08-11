// Decide o que muda no #view a cada render: classes de entrada e scroll.
//
// Isto é uma função pura, e não `classList` espalhado dentro do render, por um
// motivo concreto: a primeira versão esquecia de tirar a classe de direção no
// render de mutação. Como os filhos do #view são recriados a cada innerHTML, a
// classe grudada fazia a regra de entrada casar de novo e a tela inteira
// deslizava a cada toque — justamente o que a separação de intenções existia
// pra evitar. E a especificidade da regra de entrada
// (`main#view.view-in-right > *:not(.fab)`) ganha do `.no-anim`, então o
// freio de mão não segurava.
//
// Regra invisível num fluxo de DOM não se testa; aqui se testa.

// Toda classe que dispara animação de entrada no #view. Se entrar uma nova,
// ela precisa entrar NESTA lista, senão vaza pro render seguinte.
export const VIEW_DIR_CLASSES = ['view-in-right', 'view-in-left', 'view-in-fade'];

// `enter`          — entrou na aba: anima a entrada e sobe o scroll
// `dir`            — +1 veio da esquerda (entra pela direita), -1 o contrário,
//                    0 sem direção (primeira pintura, deep link a frio)
// `preserveScroll` — render leve (colapsar card): não mexe no scroll
//
// Devolve listas DISJUNTAS: nada aparece em `add` e `remove` ao mesmo tempo.
export const viewRenderPlan = ({ enter = false, dir = 0, preserveScroll = false } = {}) => {
  const entrada = !enter ? null
    : dir > 0 ? 'view-in-right'
    : dir < 0 ? 'view-in-left'
    : 'view-in-fade';

  // Sai toda classe de entrada que não é a desta pintura — inclusive quando
  // não há entrada nenhuma (render de mutação), que era o caso do bug.
  const remove = VIEW_DIR_CLASSES.filter((c) => c !== entrada);
  const add = [];
  if (entrada) add.push(entrada);
  // .no-anim é "grudenta" de propósito: alternar entre `none` e a animação no
  // mesmo frame causa pisca-pisca, então ela só sai quando vamos animar.
  if (enter) remove.push('no-anim'); else add.push('no-anim');

  return {
    add,
    remove,
    // SÓ entrar na aba sobe o scroll. Mutação de dado (marcar paga, excluir,
    // importar) mantém a posição: subir pro topo ao marcar uma despesa no fim
    // de uma lista longa fazia perder o lugar a cada toque.
    //
    // Com isso `preserveScroll` virou o padrão e não muda mais nada — segue
    // aceito porque documenta a intenção nos ~19 pontos que o usam, e porque
    // trocá-los seria churn sem ganho.
    resetScroll: enter,
    // Quem monta gráfico/contador consulta isto pra saber se é entrada de aba
    // ou repintura de dado — os dois não animam igual.
    anima: enter,
  };
};
