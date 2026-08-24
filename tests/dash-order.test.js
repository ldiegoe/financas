// Ordem dos cards da Início.
//
// Migração de ordem falha em silêncio: nada quebra, o card só aparece no lugar
// errado — ou some. E falha exatamente pra quem mais personalizou, já que quem
// nunca arrastou nada não tem ordem salva e não vê problema nenhum.
//
// Duas mudanças de layout já passaram por aqui: os três gráficos de
// distribuição viraram um bloco só, e depois os blocos de análise saíram da
// Início pra tela de Análise.

import { describe, it, expect } from 'vitest';
import { ordemDeCards } from '../src/domain/dash-order.js';

// A lista de hoje: só o que é card da Início.
const CHAVES = ['goals', 'health', 'upcoming'];
// Chaves que já foram cards desta tela e hoje vivem em Análise.
const MUDOU_DE_TELA = ['compare', 'bars', 'dist', 'cat', 'invest', 'tag'];

describe('ordemDeCards — sem ordem salva', () => {
  it('devolve a lista completa na ordem padrão', () => {
    expect(ordemDeCards(undefined, CHAVES)).toEqual(CHAVES);
    expect(ordemDeCards(null, CHAVES)).toEqual(CHAVES);
    expect(ordemDeCards([], CHAVES)).toEqual(CHAVES);
  });

  it('ignora lixo no lugar da ordem sem quebrar', () => {
    expect(ordemDeCards('nao-é-array', CHAVES)).toEqual(CHAVES);
    expect(ordemDeCards({ 0: 'goals' }, CHAVES)).toEqual(CHAVES);
  });
});

describe('ordemDeCards — cards que mudaram de tela', () => {
  it('descarta as chaves que hoje vivem em Análise', () => {
    const salva = ['dist', 'goals', 'bars', 'health', 'compare', 'upcoming'];
    expect(ordemDeCards(salva, CHAVES)).toEqual(['goals', 'health', 'upcoming']);
  });

  it('descarta também as chaves do layout anterior a esse', () => {
    // Quem não abre o app há duas versões tem 'cat'/'invest'/'tag' salvos.
    const salva = ['cat', 'goals', 'invest', 'tag', 'health'];
    const r = ordemDeCards(salva, CHAVES);
    for (const antigo of MUDOU_DE_TELA) expect(r).not.toContain(antigo);
    expect(r.slice(0, 2)).toEqual(['goals', 'health']);
  });

  it('ordem só com chaves que saíram volta ao padrão, sem tela vazia', () => {
    expect(ordemDeCards(MUDOU_DE_TELA, CHAVES)).toEqual(CHAVES);
  });
});

describe('ordemDeCards — invariantes', () => {
  const CASOS = [
    ['vazia', []],
    ['só chaves que saíram', MUDOU_DE_TELA],
    ['mistura', ['cat', 'goals', 'bars', 'health', 'dist']],
    ['com chave morta', ['goals', 'chave-que-nao-existe', 'upcoming']],
    ['completa', CHAVES],
    ['com repetição', ['goals', 'goals', 'health', 'health']],
    ['ordem invertida', ['upcoming', 'health', 'goals']],
  ];

  it('devolve sempre exatamente as chaves válidas, sem faltar nem sobrar', () => {
    // Verificação independente do algoritmo: seja qual for a entrada, a saída
    // é uma permutação de CHAVES. Card sumido da tela é o pior defeito
    // possível aqui, e é o que ninguém percebe ao escrever.
    for (const [nome, salva] of CASOS) {
      const r = ordemDeCards(salva, CHAVES);
      expect([...r].sort(), `${nome}: conjunto diferente`).toEqual([...CHAVES].sort());
      expect(r.length, `${nome}: repetiu chave`).toBe(new Set(r).size);
    }
  });

  it('nunca inventa chave que não está na lista válida', () => {
    const r = ordemDeCards(['goals', 'inexistente', 'dist'], CHAVES);
    expect(r.every((k) => CHAVES.includes(k))).toBe(true);
  });

  it('preserva a ordem relativa do que o usuário arrastou', () => {
    expect(ordemDeCards(['upcoming', 'health', 'goals'], CHAVES))
      .toEqual(['upcoming', 'health', 'goals']);
  });

  it('card novo (ainda não na ordem salva) entra no fim', () => {
    const r = ordemDeCards(['goals', 'health'], [...CHAVES, 'novinho']);
    expect(r.at(-1)).toBe('novinho');
  });
});
