// Trava da escala de movimento.
//
// Espaçamento, tipografia e raio ganharam escala no :root e pararam de
// divergir. Movimento tinha ficado de fora: eram SEIS durações (.12/.15/.18/
// .2/.25/.3) espalhadas e nenhum easing declarado — tudo no `ease` do
// browser. Como cada animação nova é escrita num canto diferente do arquivo,
// a divergência volta sozinha se ninguém estiver conferindo.
//
// Também prende duas coisas que já morderam: `@keyframes` duplicado (havia
// dois `fadeIn` idênticos, o segundo sobrescrevendo o primeiro em silêncio) e
// a ausência de `prefers-reduced-motion`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(process.cwd(), 'app.css'), 'utf8');

// Corpo do :root (só o primeiro bloco) — onde as durações PODEM ser cruas.
const raiz = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

// O bloco de prefers-reduced-motion fica fora da varredura: ali a duração
// crua (.01ms) é o ponto, não um descuido.
const RE_REDUCE = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/;
const cssComum = css.replace(RE_REDUCE, '');

// Declarações de transition/animation, sem as definições de token do :root.
const declaracoes = () =>
  [...cssComum.matchAll(/^\s*(transition|animation)(-duration)?:\s*([^;]+);/gm)]
    .map((m) => ({ prop: m[1], valor: m[3].replace(/\s+/g, ' ').trim() }))
    .filter((d) => !raiz.includes(d.valor));

describe('app.css — escala de movimento', () => {
  it('nenhuma transition/animation usa duração crua', () => {
    // ex.: `.15s`, `0.2s`, `250ms` fora de var(--dur-*). O valor tem que vir
    // da escala, senão volta a ter uma duração por autor.
    const cruas = declaracoes().filter((d) => /(^|[\s,(])\d*\.?\d+m?s\b/.test(d.valor));
    expect(cruas.map((d) => `${d.prop}: ${d.valor}`)).toEqual([]);
  });

  it('as durações da escala são exatamente três', () => {
    const durs = [...raiz.matchAll(/--dur-([\w-]+):/g)].map((m) => m[1]).sort();
    expect(durs).toEqual(['base', 'fast', 'slow']);
  });

  it('nenhuma transition/animation usa o `ease` padrão do browser', () => {
    // `ease` desacelera cedo demais e faz tudo parecer mole. O app tem dois
    // easings próprios; qualquer curva nova sai da escala também.
    const comEase = declaracoes().filter((d) => /(^|[\s,])ease($|[\s,])/.test(d.valor));
    expect(comEase.map((d) => `${d.prop}: ${d.valor}`)).toEqual([]);
  });

  it('todo easing usado vem da escala', () => {
    const usados = new Set([...css.matchAll(/var\(\s*(--ease-[\w-]+)/g)].map((m) => m[1]));
    const definidos = new Set([...raiz.matchAll(/(--ease-[\w-]+):/g)].map((m) => m[1]));
    expect([...usados].filter((e) => !definidos.has(e))).toEqual([]);
  });
});

describe('app.css — keyframes', () => {
  it('nenhum @keyframes é declarado duas vezes', () => {
    // Duplicata não dá erro: a segunda simplesmente vence. Foi o caso do
    // `fadeIn`, definido em dois pontos distantes do arquivo.
    const nomes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    const repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i);
    expect([...new Set(repetidos)]).toEqual([]);
  });

  it('toda animação aponta pra um @keyframes que existe', () => {
    const definidos = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
    const usados = [...css.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)]
      .map((m) => m[1])
      .filter((n) => n !== 'none');
    expect([...new Set(usados)].filter((n) => !definidos.has(n))).toEqual([]);
  });
});

describe('app.css — prefers-reduced-motion', () => {
  it('existe e zera duração em vez de matar a animação', () => {
    const bloco = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
    expect(bloco, 'sem bloco de prefers-reduced-motion').toBeTruthy();
    // `animation: none` cancelaria o animationend e o estado final; zerar a
    // duração preserva os dois.
    expect(bloco[0]).toMatch(/animation-duration:\s*\.01ms\s*!important/);
    expect(bloco[0]).toMatch(/transition-duration:\s*\.01ms\s*!important/);
    expect(bloco[0]).not.toMatch(/animation:\s*none/);
  });
});
