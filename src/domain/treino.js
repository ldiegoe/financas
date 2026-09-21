// Domínio do timer de treino (circuito HIIT/Tabata).
//
// DECISÃO CENTRAL: a rotina é "achatada" numa LINHA DO TEMPO de fases, e todo
// o estado do treino passa a ser função pura do tempo decorrido. O player
// nunca acumula contadores — ele calcula `Date.now() - inicio` e pergunta
// "que fase é essa?". Isso tem três consequências boas:
//   1. sem drift: somar 1s a cada tick erra vários segundos num treino de 10min;
//   2. a lógica inteira é testável sem timer, sem DOM e sem esperar;
//   3. pular/voltar fase e pausar viram aritmética, não máquina de estados.

// Fases possíveis: 'prep' (contagem inicial), 'exec' (exercício),
// 'intervalo' (entre exercícios) e 'descanso' (entre séries).

export const PREP_PADRAO = 10;

// Rotina nova com valores que refletem o circuito clássico 20/10.
export const rotinaVazia = () => ({
  id: `t${Date.now().toString(36)}`,
  nome: '',
  execucao: 20,
  intervalo: 10,
  descanso: 120,
  series: 3,
  preparacao: PREP_PADRAO,
  exercicios: [],
});

// Achata a rotina em fases sequenciais.
//
// Regra importante: NÃO existe intervalo depois do último exercício da série —
// ali entra o descanso entre séries direto. Emendar 10s de intervalo com 2min
// de descanso seria um respiro a mais que o usuário não pediu. E a última
// série não termina em descanso: o treino acaba no último exercício.
export const construirLinha = (rotina) => {
  const {
    execucao = 0, intervalo = 0, descanso = 0,
    series = 1, preparacao = 0, exercicios = [],
  } = rotina || {};

  const fases = [];
  if (!exercicios.length || series < 1) return fases;

  if (preparacao > 0) {
    fases.push({ tipo: 'prep', rotulo: 'Prepare-se', dur: preparacao, serie: 1, exIdx: 0, proximo: exercicios[0] });
  }

  for (let s = 1; s <= series; s++) {
    exercicios.forEach((nome, i) => {
      const ultimoEx = i === exercicios.length - 1;
      fases.push({ tipo: 'exec', rotulo: nome, dur: execucao, serie: s, exIdx: i });

      if (!ultimoEx && intervalo > 0) {
        fases.push({ tipo: 'intervalo', rotulo: 'Intervalo', dur: intervalo, serie: s, exIdx: i, proximo: exercicios[i + 1] });
      }
    });

    if (s < series && descanso > 0) {
      fases.push({ tipo: 'descanso', rotulo: 'Descanso', dur: descanso, serie: s, exIdx: exercicios.length - 1, proximo: exercicios[0] });
    }
  }

  return fases;
};

export const duracaoTotal = (linha) => linha.reduce((s, f) => s + f.dur, 0);

// Onde o treino está em `decorrido` segundos. Devolve null quando acabou —
// o caller usa isso como sinal de fim, sem precisar de flag separada.
export const faseEm = (linha, decorrido) => {
  if (decorrido < 0) decorrido = 0;
  let inicio = 0;
  for (let i = 0; i < linha.length; i++) {
    const fase = linha[i];
    const fim = inicio + fase.dur;
    if (decorrido < fim) {
      return {
        indice: i,
        fase,
        inicio,
        // Arredonda pra CIMA: enquanto sobrar qualquer fração de segundo o
        // mostrador ainda marca 1 — assim o número só vira 0 quando a fase
        // realmente terminou, e nunca se vê "0" parado na tela.
        restante: Math.ceil(fim - decorrido),
        decorridoNaFase: decorrido - inicio,
      };
    }
    inicio = fim;
  }
  return null;
};

// Instante em que a fase `indice` começa — usado por pular/voltar, que apenas
// reposicionam o relógio em vez de mexer em estado mutável.
export const inicioDaFase = (linha, indice) => {
  let acc = 0;
  for (let i = 0; i < Math.min(indice, linha.length); i++) acc += linha[i].dur;
  return acc;
};

// Quantos exercícios já foram concluídos (pra barra de progresso da série).
export const progressoSerie = (linha, indice) => {
  const fase = linha[indice];
  if (!fase) return { serie: 0, exIdx: 0 };
  return { serie: fase.serie, exIdx: fase.exIdx ?? 0 };
};

export const fmtMMSS = (segundos) => {
  const s = Math.max(0, Math.round(segundos));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
