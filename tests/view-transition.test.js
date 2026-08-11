// Trava do fluxo de entrada do #view.
//
// Regressão que originou o módulo: o render de mutação (marcar despesa como
// paga, excluir, importar) não removia a classe de direção do #view. Os filhos
// são recriados a cada innerHTML, então a regra de entrada voltava a casar e a
// tela inteira deslizava 14px + fade A CADA TOQUE. O `.no-anim` não segurava
// porque `main#view.view-in-right > *:not(.fab):not(.select-bar)` tem
// especificidade (1,3,1) contra (0,2,0) de `.no-anim .card`.
//
// O motion.test.js não pega isto: ele confere o CSS, não o fluxo.

import { describe, it, expect } from 'vitest';
import { viewRenderPlan, VIEW_DIR_CLASSES } from '../src/ui/view-transition.js';

// Todas as combinações que o app realmente produz.
const CASOS = [
  { nome: 'entrada indo pra direita',   opts: { enter: true, dir: 1 } },
  { nome: 'entrada indo pra esquerda',  opts: { enter: true, dir: -1 } },
  { nome: 'entrada sem direção',        opts: { enter: true, dir: 0 } },
  { nome: 'mutação de dado',            opts: {} },
  { nome: 'render leve',                opts: { preserveScroll: true } },
];

describe('viewRenderPlan — entrada de aba', () => {
  it('indo pra direita na tabbar, a tela entra pela direita', () => {
    const p = viewRenderPlan({ enter: true, dir: 1 });
    expect(p.add).toContain('view-in-right');
    expect(p.remove).toContain('no-anim');
    expect(p.resetScroll).toBe(true);
    expect(p.anima).toBe(true);
  });

  it('voltando, entra pela esquerda', () => {
    expect(viewRenderPlan({ enter: true, dir: -1 }).add).toContain('view-in-left');
  });

  it('sem direção (primeira pintura, deep link a frio) entra só subindo', () => {
    const p = viewRenderPlan({ enter: true, dir: 0 });
    expect(p.add).toContain('view-in-fade');
    expect(p.add).not.toContain('view-in-right');
    expect(p.add).not.toContain('view-in-left');
  });
});

describe('viewRenderPlan — repintura', () => {
  // ESTE é o teste da regressão.
  it('mutação de dado remove TODA classe de entrada', () => {
    const p = viewRenderPlan();
    for (const c of VIEW_DIR_CLASSES) expect(p.remove).toContain(c);
    expect(p.add).toEqual(['no-anim']);
    expect(p.anima).toBe(false);
  });

  it('render leve também remove toda classe de entrada, e preserva o scroll', () => {
    const p = viewRenderPlan({ preserveScroll: true });
    for (const c of VIEW_DIR_CLASSES) expect(p.remove).toContain(c);
    expect(p.resetScroll).toBe(false);
  });

  it('mutação de dado mantém o scroll no topo, como antes da escala de movimento', () => {
    // Esta leva mexe em ANIMAÇÃO, não em comportamento de rolagem.
    expect(viewRenderPlan().resetScroll).toBe(true);
  });
});

describe('viewRenderPlan — invariantes', () => {
  it('add e remove nunca se cruzam, em nenhum caso', () => {
    for (const { nome, opts } of CASOS) {
      const p = viewRenderPlan(opts);
      const cruz = p.add.filter((c) => p.remove.includes(c));
      expect(cruz, `${nome}: classe em add e remove ao mesmo tempo`).toEqual([]);
    }
  });

  it('no máximo uma classe de entrada sobra ativa por render', () => {
    for (const { nome, opts } of CASOS) {
      const p = viewRenderPlan(opts);
      const entradas = p.add.filter((c) => VIEW_DIR_CLASSES.includes(c));
      expect(entradas.length, `${nome}: mais de uma classe de entrada`).toBeLessThanOrEqual(1);
    }
  });

  it('toda classe de entrada não-usada é removida, em todo caso', () => {
    // Verificação independente do filtro do módulo: para cada caso, o conjunto
    // (entrada ativa ∪ removidas) tem que ser a lista completa. Se alguém
    // acrescentar uma classe nova e esquecer de removê-la, isto acusa.
    for (const { nome, opts } of CASOS) {
      const p = viewRenderPlan(opts);
      const cobertas = new Set([...p.add, ...p.remove].filter((c) => VIEW_DIR_CLASSES.includes(c)));
      expect([...cobertas].sort(), `${nome}: classe de entrada sem destino`)
        .toEqual([...VIEW_DIR_CLASSES].sort());
    }
  });

  it('entrar na aba nunca deixa .no-anim ligado, e repintar nunca desliga', () => {
    expect(viewRenderPlan({ enter: true, dir: 1 }).add).not.toContain('no-anim');
    expect(viewRenderPlan().remove).not.toContain('no-anim');
  });
});
