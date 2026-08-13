// Ordem dos cards do dashboard.
//
// Puro de propósito: a ordem é persistida no aparelho do usuário e sobrevive a
// mudanças de layout, então toda vez que a lista de cards muda existe um
// problema de migração — e migração errada é silenciosa (o card só aparece no
// lugar errado, ninguém "quebra").
//
// O caso que criou este módulo: os três gráficos de distribuição (categoria,
// tag, investimentos) viraram UM bloco com seletor. Quem já tinha ordem salva
// tem 'cat', 'invest' e 'tag' como itens separados lá dentro. Sem migrar, o
// filtro de chaves válidas descartaria os três e o bloco novo cairia no FIM da
// lista — o gráfico saltaria pro rodapé do dashboard justamente de quem mais
// mexeu nas preferências.

// Chaves que os três gráficos separados ocupavam antes da consolidação.
export const LEGADO_DIST = ['cat', 'invest', 'tag'];

// `salva`  — o que está em state.config.dashOrder (pode ser qualquer coisa)
// `chaves` — DASH_CARD_KEYS, a lista válida de hoje
//
// Devolve a ordem efetiva: a salva, migrada e filtrada, mais os cards que
// ainda não aparecem nela (cobre card novo depois de uma ordem já salva).
export const ordemDeCards = (salva, chaves, { legado = LEGADO_DIST, novo = 'dist' } = {}) => {
  const lista = Array.isArray(salva) ? salva : [];
  const vistos = new Set();
  const saida = [];

  for (const k of lista) {
    // Onde estava o PRIMEIRO dos gráficos antigos entra o bloco novo; os
    // outros dois somem sem deixar buraco, porque agora são chips dele.
    const chave = legado.includes(k) ? novo : k;
    if (!chaves.includes(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(chave);
  }

  return [...saida, ...chaves.filter((k) => !vistos.has(k))];
};
