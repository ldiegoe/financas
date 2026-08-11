// Saída de elemento antes de ser destruído (linha de despesa, sheet).
//
// O que está sendo travado aqui não é a estética, é a garantia: o callback que
// apaga o dado (ou limpa o modal) roda EXATAMENTE uma vez. Zero vezes = o app
// acha que fez e não fez. Duas vezes = faz em dobro. Os dois caminhos
// (animationend e timeout de segurança) existem porque nenhum dos dois sozinho
// é confiável.

import { describe, it, expect, vi } from 'vitest';
import { createLeave } from '../src/ui/leave.js';

// Elemento falso com classList e listeners de verdade o suficiente.
// `disparar` imita o borbulhamento: o alvo pode ser um descendente.
const elFalso = () => {
  const classes = new Set();
  const ouvintes = [];
  const el = {
    classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) },
    addEventListener: (tipo, fn) => ouvintes.push({ tipo, fn }),
    disparar: (alvo) =>
      ouvintes.filter((o) => o.tipo === 'animationend')
        .forEach((o) => o.fn({ target: alvo === undefined ? el : alvo })),
  };
  return el;
};

const relogio = () => {
  const timers = new Map();
  let id = 0;
  return {
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (t) => timers.delete(t),
    avancar: () => { for (const fn of [...timers.values()]) fn(); },
    pendentes: () => timers.size,
  };
};

const OPTS = { duracao: 200 };

describe('createLeave — o callback sempre roda', () => {
  it('roda quando a animação termina', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = elFalso();
    createLeave(r)(el, OPTS, depois);
    expect(depois).not.toHaveBeenCalled();   // ainda animando
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('roda pelo timeout quando animationend nunca vem', () => {
    // Aba em segundo plano, ou elemento removido por outro render no meio.
    const r = relogio();
    const depois = vi.fn();
    createLeave(r)(elFalso(), OPTS, depois);
    r.avancar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('NUNCA roda duas vezes, mesmo com os dois caminhos disparando', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = elFalso();
    createLeave(r)(el, OPTS, depois);
    el.disparar();
    r.avancar();
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('cancela o timeout ao terminar pelo evento (não deixa lixo agendado)', () => {
    const r = relogio();
    const el = elFalso();
    createLeave(r)(el, OPTS, vi.fn());
    expect(r.pendentes()).toBe(1);
    el.disparar();
    expect(r.pendentes()).toBe(0);
  });
});

describe('createLeave — animationend que borbulha', () => {
  it('ignora animationend vindo de um descendente', () => {
    // O sheet declara animação no backdrop E no .sheet dentro dele; a do filho
    // borbulha. Encerrar nela cortaria a saída antes da hora.
    const r = relogio();
    const depois = vi.fn();
    const el = elFalso();
    createLeave(r)(el, OPTS, depois);
    el.disparar({ umFilho: true });
    expect(depois).not.toHaveBeenCalled();
  });

  it('depois de descartar o do filho, ainda aceita o do próprio elemento', () => {
    // Regressão: com `{ once: true }`, o evento descartado gastava a inscrição
    // e o elemento nunca mais era ouvido — a saída caía sempre no timeout.
    const r = relogio();
    const depois = vi.fn();
    const el = elFalso();
    createLeave(r)(el, OPTS, depois);
    el.disparar({ umFilho: true });
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
    expect(r.pendentes()).toBe(0);   // terminou pelo evento, não pelo timeout
  });
});

describe('createLeave — atalhos', () => {
  it('sem movimento (duração 0) roda na hora e não agenda nada', () => {
    const r = relogio();
    const depois = vi.fn();
    createLeave(r)(elFalso(), { duracao: 0 }, depois);
    expect(depois).toHaveBeenCalledTimes(1);
    expect(r.pendentes()).toBe(0);
  });

  it('sem elemento nenhum roda na hora', () => {
    const r = relogio();
    const depois = vi.fn();
    createLeave(r)([], OPTS, depois);
    createLeave(r)(null, OPTS, depois);
    expect(depois).toHaveBeenCalledTimes(2);
  });

  it('ignora buracos na lista sem deixar de rodar', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = elFalso();
    createLeave(r)([null, el, undefined], OPTS, depois);
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });
});

describe('createLeave — marcação', () => {
  it('marca todos os elementos, não só o primeiro (exclusão em massa)', () => {
    const r = relogio();
    const els = [elFalso(), elFalso(), elFalso()];
    createLeave(r)(els, OPTS, vi.fn());
    for (const e of els) expect(e.classList.contains('leaving')).toBe(true);
  });

  it('aceita classe própria (a linha e o sheet saem de formas diferentes)', () => {
    const r = relogio();
    const el = elFalso();
    createLeave(r)(el, { ...OPTS, classe: 'row-leaving' }, vi.fn());
    expect(el.classList.contains('row-leaving')).toBe(true);
  });

  it('o primeiro animationend do lote já vale por todos', () => {
    // Os elementos animam juntos e com a mesma duração — esperar todos só
    // atrasaria a exclusão.
    const r = relogio();
    const depois = vi.fn();
    const els = [elFalso(), elFalso()];
    createLeave(r)(els, OPTS, depois);
    els[0].disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });
});
