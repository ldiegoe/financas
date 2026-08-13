// Ordem dos cards do dashboard, com migração dos três gráficos de
// distribuição para o bloco único de chips.
//
// Migração de ordem falha em silêncio: nada quebra, o card só aparece no lugar
// errado. E falha exatamente pra quem mais personalizou — quem nunca arrastou
// nada não tem ordem salva e não vê problema nenhum.

import { describe, it, expect } from 'vitest';
import { ordemDeCards, LEGADO_DIST } from '../src/domain/dash-order.js';

// A lista de hoje: os três gráficos viraram 'dist'.
const CHAVES = ['goals', 'health', 'upcoming', 'compare', 'bars', 'dist'];

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

describe('ordemDeCards — migração dos gráficos', () => {
  it('o bloco novo assume a posição do PRIMEIRO gráfico antigo', () => {
    // Sem isto, 'dist' iria pro fim e o gráfico saltaria pro rodapé.
    const salva = ['cat', 'goals', 'invest', 'health', 'tag'];
    expect(ordemDeCards(salva, CHAVES)).toEqual(
      ['dist', 'goals', 'health', 'upcoming', 'compare', 'bars'],
    );
  });

  it('funciona com o gráfico no meio da ordem salva', () => {
    const salva = ['goals', 'cat', 'invest', 'tag', 'health'];
    const r = ordemDeCards(salva, CHAVES);
    expect(r.slice(0, 3)).toEqual(['goals', 'dist', 'health']);
  });

  it('os outros dois gráficos somem sem deixar buraco nem duplicar', () => {
    const r = ordemDeCards(['cat', 'invest', 'tag'], CHAVES);
    expect(r.filter((k) => k === 'dist')).toHaveLength(1);
    for (const antigo of LEGADO_DIST) expect(r).not.toContain(antigo);
  });

  it('ordem que já tem "dist" salvo não duplica ao encontrar um legado', () => {
    // Estado possível entre versões: ordem gravada depois da migração, mas
    // ainda com um resto antigo dentro.
    const r = ordemDeCards(['dist', 'goals', 'cat'], CHAVES);
    expect(r.filter((k) => k === 'dist')).toHaveLength(1);
    expect(r[0]).toBe('dist');
  });
});

describe('ordemDeCards — invariantes', () => {
  const CASOS = [
    ['vazia', []],
    ['só legado', ['cat', 'invest', 'tag']],
    ['legado + atuais', ['cat', 'goals', 'invest', 'health', 'tag']],
    ['com chave morta', ['goals', 'chave-que-nao-existe', 'bars']],
    ['completa', CHAVES],
    ['com repetição', ['goals', 'goals', 'bars', 'bars']],
  ];

  it('devolve sempre exatamente as chaves válidas, sem faltar nem sobrar', () => {
    // Verificação independente do algoritmo: seja qual for a entrada, a saída
    // é uma permutação de CHAVES. Card sumido do dashboard é o pior defeito
    // possível aqui, e é o que ninguém percebe ao escrever.
    for (const [nome, salva] of CASOS) {
      const r = ordemDeCards(salva, CHAVES);
      expect([...r].sort(), `${nome}: conjunto diferente`).toEqual([...CHAVES].sort());
      expect(r.length, `${nome}: repetiu chave`).toBe(new Set(r).size);
    }
  });

  it('nunca inventa chave que não está na lista válida', () => {
    const r = ordemDeCards(['goals', 'inexistente', 'cat'], CHAVES);
    expect(r.every((k) => CHAVES.includes(k))).toBe(true);
  });

  it('preserva a ordem relativa do que o usuário arrastou', () => {
    const salva = ['bars', 'health', 'goals'];
    const r = ordemDeCards(salva, CHAVES);
    expect(r.slice(0, 3)).toEqual(['bars', 'health', 'goals']);
  });

  it('card novo (ainda não na ordem salva) entra no fim', () => {
    const r = ordemDeCards(['goals', 'health'], [...CHAVES, 'novinho']);
    expect(r.at(-1)).toBe('novinho');
  });
});
