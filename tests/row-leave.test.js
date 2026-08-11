// Saída da linha antes de o dado sumir.
//
// O que está sendo travado aqui não é a estética, é a garantia: o callback que
// apaga o dado roda EXATAMENTE uma vez. Zero vezes = o app acha que excluiu e
// não excluiu. Duas vezes = apaga duas. Os dois caminhos (animationend e
// timeout de segurança) existem porque nenhum dos dois sozinho é confiável.

import { describe, it, expect, vi } from 'vitest';
import { createRowLeave } from '../src/ui/row-leave.js';

// Elemento falso com classList e listeners de verdade o suficiente.
const linhaFalsa = () => {
  const classes = new Set();
  const ouvintes = [];
  return {
    classList: {
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
    },
    addEventListener: (tipo, fn) => ouvintes.push({ tipo, fn }),
    // Dispara o evento como o browser faria.
    disparar: (tipo = 'animationend') =>
      ouvintes.filter((o) => o.tipo === tipo).forEach((o) => o.fn()),
  };
};

// Agenda controlado: nada roda até `avancar()`.
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

describe('createRowLeave — o dado sempre sai', () => {
  it('apaga quando a animação termina', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = linhaFalsa();
    createRowLeave(r)(el, OPTS, depois);
    expect(depois).not.toHaveBeenCalled();   // ainda animando
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('apaga pelo timeout quando animationend nunca vem', () => {
    // Aba em segundo plano, ou linha removida por outro render no meio.
    const r = relogio();
    const depois = vi.fn();
    createRowLeave(r)(linhaFalsa(), OPTS, depois);
    r.avancar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('NUNCA apaga duas vezes, mesmo com os dois caminhos disparando', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = linhaFalsa();
    createRowLeave(r)(el, OPTS, depois);
    el.disparar();
    r.avancar();
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });

  it('cancela o timeout ao terminar pelo evento (não deixa lixo agendado)', () => {
    const r = relogio();
    const el = linhaFalsa();
    createRowLeave(r)(el, OPTS, vi.fn());
    expect(r.pendentes()).toBe(1);
    el.disparar();
    expect(r.pendentes()).toBe(0);
  });
});

describe('createRowLeave — atalhos', () => {
  it('sem movimento (duração 0) apaga na hora e não agenda nada', () => {
    const r = relogio();
    const depois = vi.fn();
    createRowLeave(r)(linhaFalsa(), { duracao: 0 }, depois);
    expect(depois).toHaveBeenCalledTimes(1);
    expect(r.pendentes()).toBe(0);
  });

  it('sem linha nenhuma apaga na hora', () => {
    const r = relogio();
    const depois = vi.fn();
    createRowLeave(r)([], OPTS, depois);
    createRowLeave(r)(null, OPTS, depois);
    expect(depois).toHaveBeenCalledTimes(2);
  });

  it('ignora buracos na lista sem deixar de apagar', () => {
    const r = relogio();
    const depois = vi.fn();
    const el = linhaFalsa();
    createRowLeave(r)([null, el, undefined], OPTS, depois);
    el.disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });
});

describe('createRowLeave — marcação', () => {
  it('marca todas as linhas, não só a primeira (exclusão em massa)', () => {
    const r = relogio();
    const linhas = [linhaFalsa(), linhaFalsa(), linhaFalsa()];
    createRowLeave(r)(linhas, OPTS, vi.fn());
    for (const l of linhas) expect(l.classList.contains('row-leaving')).toBe(true);
  });

  it('o primeiro animationend do lote já vale por todos', () => {
    // As linhas animam juntas e com a mesma duração — esperar todas só
    // atrasaria a exclusão.
    const r = relogio();
    const depois = vi.fn();
    const linhas = [linhaFalsa(), linhaFalsa()];
    createRowLeave(r)(linhas, OPTS, depois);
    linhas[0].disparar();
    expect(depois).toHaveBeenCalledTimes(1);
  });
});
