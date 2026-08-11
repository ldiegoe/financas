// Contagem animada do saldo. Dinheiro em centavos inteiros do começo ao fim —
// o risco aqui é justamente a interpolação inventar fração de centavo ou não
// fechar exatamente no valor final.

import { describe, it, expect } from 'vitest';
import { easeOutCubic, valorEm, createCountUp } from '../src/ui/count-up.js';

// Relógio e rAF falsos: o passo avança o tempo em fatias fixas, então a
// sequência inteira é determinística.
const cronometro = (passoMs) => {
  let t = 0;
  const fila = [];
  return {
    now: () => t,
    raf: (fn) => fila.push(fn),
    // Roda até a animação terminar (ou estourar o limite de segurança).
    rodar: (limite = 1000) => {
      let n = 0;
      while (fila.length && n++ < limite) {
        const fn = fila.shift();
        t += passoMs;
        fn();
      }
      return n;
    },
  };
};

describe('easeOutCubic', () => {
  it('vai de 0 a 1 e satura fora do intervalo', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('arranca rápido: na metade do tempo já andou mais da metade', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('é monotônica', () => {
    let ant = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(ant);
      ant = v;
    }
  });
});

describe('valorEm', () => {
  it('fecha exatamente no alvo, sem resto de arredondamento', () => {
    expect(valorEm(0, 438219, 1)).toBe(438219);
    expect(valorEm(438219, 0, 1)).toBe(0);
  });

  it('começa exatamente na origem', () => {
    expect(valorEm(1234, 9999, 0)).toBe(1234);
  });

  it('devolve sempre centavos inteiros', () => {
    for (let i = 0; i <= 30; i++) {
      const v = valorEm(0, 100003, i / 30);
      expect(Number.isInteger(v), `t=${i}/30 deu ${v}`).toBe(true);
    }
  });

  it('desce quando o saldo cai (valor negativo no caminho)', () => {
    // Saldo indo de +50,00 para -20,00: a interpolação atravessa o zero.
    expect(valorEm(5000, -2000, 0)).toBe(5000);
    expect(valorEm(5000, -2000, 1)).toBe(-2000);
    expect(valorEm(5000, -2000, 0.5)).toBeLessThan(5000);
  });
});

describe('createCountUp', () => {
  const fmt = (c) => `R$ ${(c / 100).toFixed(2)}`;

  it('termina escrevendo o valor final exato', () => {
    const c = cronometro(40);
    const el = { textContent: '' };
    createCountUp(c)(el, { de: 0, para: 438219, duracao: 320, formatar: fmt });
    c.rodar();
    expect(el.textContent).toBe(fmt(438219));
  });

  it('passa por valores intermediários (não é um salto seco)', () => {
    const c = cronometro(40);
    const vistos = [];
    const el = { set textContent(v) { vistos.push(v); }, get textContent() { return vistos.at(-1); } };
    createCountUp(c)(el, { de: 0, para: 100000, duracao: 320, formatar: fmt });
    c.rodar();
    expect(vistos.length).toBeGreaterThan(2);
    // Verificação independente: nenhum passo pode ultrapassar o alvo.
    const numeros = vistos.map((s) => Number(s.replace('R$ ', '')) * 100);
    expect(Math.max(...numeros)).toBeCloseTo(100000, 0);
  });

  it('sem percurso, escreve direto e não agenda quadro nenhum', () => {
    const c = cronometro(40);
    const el = { textContent: '' };
    createCountUp(c)(el, { de: 500, para: 500, duracao: 320, formatar: fmt });
    expect(el.textContent).toBe(fmt(500));
    expect(c.rodar()).toBe(0);
  });

  it('duração zero (reduzir movimento) escreve o final sem animar', () => {
    const c = cronometro(40);
    const el = { textContent: '' };
    createCountUp(c)(el, { de: 0, para: 438219, duracao: 0, formatar: fmt });
    expect(el.textContent).toBe(fmt(438219));
    expect(c.rodar()).toBe(0);
  });

  it('não explode sem elemento', () => {
    const c = cronometro(40);
    expect(() => createCountUp(c)(null, { de: 0, para: 1, duracao: 320, formatar: fmt })).not.toThrow();
  });
});
