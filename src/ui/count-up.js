// Contagem animada de um valor em centavos.
//
// Usado só no saldo do dashboard, e só quando o valor muda com o usuário
// olhando — entrar na aba mostra o número pronto. Contar toda vez que a tela
// abre atrasa a leitura do dado que a pessoa veio ver.
//
// Valores em centavos (inteiros) do começo ao fim: a interpolação arredonda a
// cada passo, então nunca aparece fração de centavo na tela.

// Mesma curva do --ease-out do CSS (cubic-bezier(.2,.8,.2,1)) na intenção:
// arranca rápido e assenta devagar.
export const easeOutCubic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);

// Valor (em centavos) no instante `t` do percurso, com t em [0,1].
export const valorEm = (de, para, t) => {
  if (t <= 0) return de;
  if (t >= 1) return para;   // fecha exato no alvo, sem resto de arredondamento
  return Math.round(de + (para - de) * easeOutCubic(t));
};

// Driver com `raf` e `now` injetados pra rodar em teste sem browser.
// `formatar` recebe centavos e devolve o texto (fmtBRL na prática).
export const createCountUp = ({ raf, now }) => (el, { de, para, duracao, formatar }) => {
  // Sem percurso a fazer: escreve e sai. Cobre também o caso de duração zero
  // vinda do prefers-reduced-motion.
  if (!el || de === para || !(duracao > 0)) {
    if (el) el.textContent = formatar(para);
    return;
  }
  const t0 = now();
  const passo = () => {
    const t = (now() - t0) / duracao;
    el.textContent = formatar(valorEm(de, para, t));
    if (t < 1) raf(passo);
  };
  raf(passo);
};
