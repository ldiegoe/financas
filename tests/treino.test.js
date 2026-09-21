import { describe, it, expect } from 'vitest';
import {
  rotinaVazia, construirLinha, duracaoTotal, faseEm, inicioDaFase, fmtMMSS,
} from '../src/domain/treino.js';

// Fixture realista: o circuito que o usuário descreveu — 10 exercícios,
// 20s de execução, 10s entre exercícios, 2min entre séries, 3 voltas.
const CIRCUITO = {
  nome: 'Aeróbico',
  execucao: 20,
  intervalo: 10,
  descanso: 120,
  series: 3,
  preparacao: 10,
  exercicios: ['Polichinelo','Agachamento','Abdominal','Prancha','Burpee',
               'Afundo','Montanhista','Ponte','Elevação','Corrida parada'],
};

describe('construirLinha', () => {
  it('não põe intervalo depois do último exercício da série', () => {
    const linha = construirLinha({ ...CIRCUITO, series: 1, preparacao: 0 });
    // 10 exercícios intercalados por 9 intervalos = 19 fases, terminando em exec
    expect(linha).toHaveLength(19);
    expect(linha.at(-1).tipo).toBe('exec');
    expect(linha.at(-1).rotulo).toBe('Corrida parada');
    expect(linha.filter(f => f.tipo === 'intervalo')).toHaveLength(9);
  });

  it('não põe descanso depois da última série (o treino acaba no exercício)', () => {
    const linha = construirLinha({ ...CIRCUITO, preparacao: 0 });
    expect(linha.filter(f => f.tipo === 'descanso')).toHaveLength(2); // 3 séries → 2 descansos
    expect(linha.at(-1).tipo).toBe('exec');
  });

  it('a preparação abre a linha e anuncia o primeiro exercício', () => {
    const linha = construirLinha(CIRCUITO);
    expect(linha[0]).toMatchObject({ tipo: 'prep', dur: 10, proximo: 'Polichinelo' });
  });

  it('o intervalo anuncia o próximo exercício, e o descanso volta ao primeiro', () => {
    const linha = construirLinha({ ...CIRCUITO, preparacao: 0 });
    expect(linha[1]).toMatchObject({ tipo: 'intervalo', proximo: 'Agachamento' });
    const descanso = linha.find(f => f.tipo === 'descanso');
    expect(descanso.proximo).toBe('Polichinelo');
  });

  // --- bordas ---
  it('rotina sem exercícios devolve linha vazia', () => {
    expect(construirLinha({ ...CIRCUITO, exercicios: [] })).toEqual([]);
  });
  it('series < 1 devolve linha vazia', () => {
    expect(construirLinha({ ...CIRCUITO, series: 0 })).toEqual([]);
  });
  it('um único exercício não gera nenhum intervalo', () => {
    const linha = construirLinha({ ...CIRCUITO, exercicios: ['Prancha'], series: 1, preparacao: 0 });
    expect(linha).toEqual([{ tipo: 'exec', rotulo: 'Prancha', dur: 20, serie: 1, exIdx: 0 }]);
  });
  it('intervalo/descanso zerados não viram fases de duração 0', () => {
    const linha = construirLinha({ ...CIRCUITO, intervalo: 0, descanso: 0, preparacao: 0 });
    expect(linha.every(f => f.tipo === 'exec')).toBe(true);
    expect(linha).toHaveLength(30); // 10 exercícios × 3 séries
  });
  it('rotinaVazia gera ids distintos', () => {
    expect(rotinaVazia().id).toMatch(/^t[a-z0-9]+$/);
  });
});

describe('duracaoTotal', () => {
  // VERIFICAÇÃO INDEPENDENTE: a fórmula abaixo não passa por construirLinha.
  // Se o construtor emendar uma fase a mais (ex.: intervalo antes do descanso),
  // os dois números divergem e o teste pega.
  const porFormula = (r) =>
    r.preparacao
    + r.series * r.exercicios.length * r.execucao
    + r.series * (r.exercicios.length - 1) * r.intervalo
    + (r.series - 1) * r.descanso;

  it('bate com o cálculo fechado no circuito real', () => {
    const total = duracaoTotal(construirLinha(CIRCUITO));
    expect(total).toBe(porFormula(CIRCUITO));
    expect(total).toBe(1120);            // 18min40 — conferido à mão
    expect(fmtMMSS(total)).toBe('18:40');
  });

  it('bate com o cálculo fechado em variações', () => {
    for (const r of [
      { ...CIRCUITO, series: 1 },
      { ...CIRCUITO, series: 8, exercicios: ['A','B'] },
      { ...CIRCUITO, preparacao: 0, intervalo: 5, descanso: 60 },
    ]) {
      expect(duracaoTotal(construirLinha(r))).toBe(porFormula(r));
    }
  });
});

describe('faseEm', () => {
  const linha = construirLinha(CIRCUITO);

  it('t=0 cai na preparação', () => {
    expect(faseEm(linha, 0)).toMatchObject({ indice: 0, restante: 10 });
  });

  it('a troca de fase acontece no segundo exato, sem sobreposição', () => {
    // prep dura 0..10; em t=9.9 ainda é prep, em t=10 já é o 1º exercício
    expect(faseEm(linha, 9.9).fase.tipo).toBe('prep');
    expect(faseEm(linha, 10).fase).toMatchObject({ tipo: 'exec', rotulo: 'Polichinelo' });
  });

  it('o mostrador só chega a 0 quando a fase termina', () => {
    // dentro de uma fase de 20s, faltando 0.1s, ainda mostra 1 (nunca "0" parado)
    expect(faseEm(linha, 10 + 19.9).restante).toBe(1);
    expect(faseEm(linha, 10).restante).toBe(20);
  });

  it('devolve null depois do fim — é o sinal de treino concluído', () => {
    const total = duracaoTotal(linha);
    expect(faseEm(linha, total - 0.1)).not.toBeNull();
    expect(faseEm(linha, total)).toBeNull();
    expect(faseEm(linha, total + 999)).toBeNull();
  });

  it('tempo negativo é tratado como início (protege relógio fora de ordem)', () => {
    expect(faseEm(linha, -5).indice).toBe(0);
  });

  it('linha vazia devolve null em vez de quebrar', () => {
    expect(faseEm([], 0)).toBeNull();
  });
});

describe('inicioDaFase', () => {
  const linha = construirLinha(CIRCUITO);

  it('é a inversa de faseEm: posicionar no início de uma fase cai nela', () => {
    for (const i of [0, 1, 5, 20, linha.length - 1]) {
      const t = inicioDaFase(linha, i);
      expect(faseEm(linha, t).indice).toBe(i);
      expect(faseEm(linha, t).restante).toBe(linha[i].dur);
    }
  });

  it('índice além do fim devolve a duração total (encerra o treino)', () => {
    expect(inicioDaFase(linha, 999)).toBe(duracaoTotal(linha));
  });
});

describe('fmtMMSS', () => {
  it('formata com dois dígitos e nunca mostra negativo', () => {
    expect(fmtMMSS(0)).toBe('0:00');
    expect(fmtMMSS(9)).toBe('0:09');
    expect(fmtMMSS(60)).toBe('1:00');
    expect(fmtMMSS(125)).toBe('2:05');
    expect(fmtMMSS(-3)).toBe('0:00');
  });
});
