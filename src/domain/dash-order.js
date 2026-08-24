// Ordem dos cards da Início.
//
// Puro de propósito: a ordem é persistida no aparelho do usuário e sobrevive a
// mudanças de layout, então toda vez que a lista de cards muda existe um
// problema de migração — e migração errada é silenciosa (o card só aparece no
// lugar errado, ou some, sem nada "quebrar").
//
// Já aconteceram duas mudanças assim:
//   1. categoria, tag e investimentos (três cards) viraram um bloco só;
//   2. esse bloco, mais "receitas vs despesas" e "comparação", saíram da
//      Início pra tela de Análise.
// Depois da segunda, nenhuma dessas chaves é card da Início — então elas
// simplesmente não constam mais em `chaves` e são descartadas aqui. Não há
// mapeamento a fazer: o destino delas é outra tela, não outra posição.

// `salva`  — o que está em state.config.dashOrder (pode ser qualquer coisa)
// `chaves` — DASH_CARD_KEYS, a lista válida de hoje
//
// Devolve a ordem efetiva: a salva, filtrada e sem repetição, mais os cards
// que ainda não aparecem nela (cobre card novo depois de uma ordem já salva).
export const ordemDeCards = (salva, chaves) => {
  const lista = Array.isArray(salva) ? salva : [];
  const vistos = new Set();
  const saida = [];

  for (const k of lista) {
    // Chave que não é card desta tela (herdada de um layout antigo, ou lixo)
    // é descartada em silêncio — e a repetida entra uma vez só.
    if (!chaves.includes(k) || vistos.has(k)) continue;
    vistos.add(k);
    saida.push(k);
  }

  return [...saida, ...chaves.filter((k) => !vistos.has(k))];
};
