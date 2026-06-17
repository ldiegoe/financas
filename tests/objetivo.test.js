import { describe, it, expect } from 'vitest';
import {
  sumCategoriasAteHoje,
  objetivoAtual,
} from '../src/domain/objetivo.js';

describe('sumCategoriasAteHoje', () => {
  const today = '2025-05-15';

  it('idSet vazio devolve 0', () => {
    const despesas = [{ id: '1', data: '2025-01-10', categoriaId: 'a', valor: 100 }];
    expect(sumCategoriasAteHoje(despesas, new Set(), null, today)).toBe(0);
  });

  it('despesas vazias devolvem 0', () => {
    expect(sumCategoriasAteHoje([], new Set(['a']), null, today)).toBe(0);
  });

  it('soma despesas únicas dentro do critério', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'a', valor: 100 },
      { id: '2', data: '2025-03-05', categoriaId: 'a', valor: 250 },
      { id: '3', data: '2025-01-10', categoriaId: 'b', valor: 999 }, // outra categoria
    ];
    expect(sumCategoriasAteHoje(despesas, new Set(['a']), null, today)).toBe(350);
  });

  it('exclui datas futuras (> today)', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'a', valor: 100 },
      { id: '2', data: '2025-12-25', categoriaId: 'a', valor: 999 }, // futuro
    ];
    expect(sumCategoriasAteHoje(despesas, new Set(['a']), null, today)).toBe(100);
  });

  it('respeita `desde` quando definido', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'a', valor: 100 },
      { id: '2', data: '2025-03-05', categoriaId: 'a', valor: 250 },
    ];
    expect(sumCategoriasAteHoje(despesas, new Set(['a']), '2025-02-01', today)).toBe(250);
  });

  it('expande recorrentes/parceladas ao longo dos anos', () => {
    const despesas = [
      { id: 'r', data: '2025-01-15', categoriaId: 'a', valor: 100, recorrente: true },
    ];
    // De jan até maio (5 ocorrências dentro de today 2025-05-15)
    expect(sumCategoriasAteHoje(despesas, new Set(['a']), null, today)).toBe(500);
  });
});

describe('objetivoAtual', () => {
  const today = '2025-05-15';

  it('soma despesas das categorias linkadas até hoje', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'c1', valor: 300 },
      { id: '2', data: '2025-03-05', categoriaId: 'c2', valor: 200 },
      { id: '3', data: '2025-04-01', categoriaId: 'c3', valor: 999 }, // não linkada
    ];
    const obj = { categoriaIds: ['c1', 'c2'] };
    expect(objetivoAtual(obj, despesas, today)).toBe(500);
  });

  it('respeita o `desde` do objetivo', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'c1', valor: 100 },
      { id: '2', data: '2025-04-01', categoriaId: 'c1', valor: 250 },
    ];
    const obj = { categoriaIds: ['c1'], desde: '2025-03-01' };
    expect(objetivoAtual(obj, despesas, today)).toBe(250);
  });

  it('objetivo sem categoriaIds devolve 0', () => {
    const obj = {};
    expect(objetivoAtual(obj, [], today)).toBe(0);
  });
});
