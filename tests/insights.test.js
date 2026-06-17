import { describe, it, expect } from 'vitest';
import { computeInsights } from '../src/domain/insights.js';

// Helper de formatador "previsível" pra checar substrings nos testes.
const fmt = (cents) => `R$ ${(cents / 100).toFixed(2)}`;

// "now" fixo: 15/maio/2025
const now = new Date(2025, 4, 15);
const today = '2025-05-15';

describe('computeInsights — categoria com aumento grande', () => {
  it('detecta gasto +30% vs média de 3 meses', () => {
    // Cat A: 2025-02 → 200, 2025-03 → 250, 2025-04 → 300 (média ~250)
    // Cat A: 2025-05 → 50000 (aumento gigante)
    const despesas = [
      { id: '1', data: '2025-02-15', categoriaId: 'a', valor: 20000 },
      { id: '2', data: '2025-03-15', categoriaId: 'a', valor: 25000 },
      { id: '3', data: '2025-04-15', categoriaId: 'a', valor: 30000 },
      { id: '4', data: '2025-05-10', categoriaId: 'a', valor: 50000 },
    ];
    const categorias = [{ id: 'a', nome: 'Alimentação' }];
    const result = computeInsights({ despesas, categorias, objetivos: [], now, today, fmtMoney: fmt });
    const up = result.find(r => r.title.includes('Alimentação'));
    expect(up).toBeDefined();
    expect(up.severity).toBe('warn');
    expect(up.body).toMatch(/% acima/);
  });

  it('NÃO dispara se diff for menor que R$50', () => {
    const despesas = [
      { id: '1', data: '2025-02-15', categoriaId: 'a', valor: 10000 },
      { id: '2', data: '2025-03-15', categoriaId: 'a', valor: 10000 },
      { id: '3', data: '2025-04-15', categoriaId: 'a', valor: 10000 },
      { id: '4', data: '2025-05-10', categoriaId: 'a', valor: 12000 }, // +R$20 só
    ];
    const result = computeInsights({ despesas, categorias: [{ id: 'a', nome: 'X' }], objetivos: [], now, today, fmtMoney: fmt });
    expect(result.filter(r => r.severity === 'warn')).toHaveLength(0);
  });

  it('IGNORA categorias de investimento (poupanca)', () => {
    const despesas = [
      { id: '4', data: '2025-05-10', categoriaId: 'inv', valor: 100000 },
    ];
    const categorias = [{ id: 'inv', nome: 'Tesouro', poupanca: true }];
    const result = computeInsights({ despesas, categorias, objetivos: [], now, today, fmtMoney: fmt });
    expect(result).toEqual([]);
  });
});

describe('computeInsights — categoria com queda grande', () => {
  it('detecta economia (-30%) vs média de 3 meses', () => {
    const despesas = [
      { id: '1', data: '2025-02-15', categoriaId: 'a', valor: 30000 },
      { id: '2', data: '2025-03-15', categoriaId: 'a', valor: 30000 },
      { id: '3', data: '2025-04-15', categoriaId: 'a', valor: 30000 },
      { id: '4', data: '2025-05-10', categoriaId: 'a', valor: 5000 }, // -25k
    ];
    const result = computeInsights({ despesas, categorias: [{ id: 'a', nome: 'Lazer' }], objetivos: [], now, today, fmtMoney: fmt });
    const down = result.find(r => r.title.includes('Lazer'));
    expect(down).toBeDefined();
    expect(down.severity).toBe('good');
    expect(down.body).toMatch(/abaixo/);
  });
});

describe('computeInsights — objetivos', () => {
  it('objetivo concluído (≥100%)', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'pop', valor: 100000 },
    ];
    const objetivos = [{ id: 'o', nome: 'Reserva', alvo: 80000, categoriaIds: ['pop'] }];
    const result = computeInsights({ despesas, categorias: [], objetivos, now, today, fmtMoney: fmt });
    const done = result.find(r => r.title.includes('Reserva'));
    expect(done).toBeDefined();
    expect(done.severity).toBe('good');
    expect(done.title).toMatch(/concluído/);
  });

  it('objetivo perto (≥90% e <100%)', () => {
    const despesas = [
      { id: '1', data: '2025-01-10', categoriaId: 'pop', valor: 9000 },
    ];
    const objetivos = [{ id: 'o', nome: 'Viagem', alvo: 10000, categoriaIds: ['pop'] }];
    const result = computeInsights({ despesas, categorias: [], objetivos, now, today, fmtMoney: fmt });
    const near = result.find(r => r.title.includes('Falta pouco'));
    expect(near).toBeDefined();
    expect(near.body).toMatch(/90%/);
  });

  it('objetivo com alvo 0 é ignorado', () => {
    const objetivos = [{ id: 'o', nome: 'X', alvo: 0, categoriaIds: ['pop'] }];
    const result = computeInsights({ despesas: [], categorias: [], objetivos, now, today, fmtMoney: fmt });
    expect(result.find(r => r.title.includes('X'))).toBeUndefined();
  });
});

describe('computeInsights — limite de 4', () => {
  it('máximo de 4 insights mesmo com muitos objetivos completos', () => {
    const despesas = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`, data: '2025-01-10', categoriaId: `c${i}`, valor: 100000,
    }));
    const objetivos = Array.from({ length: 10 }, (_, i) => ({
      id: `o${i}`, nome: `Obj ${i}`, alvo: 50000, categoriaIds: [`c${i}`],
    }));
    const result = computeInsights({ despesas, categorias: [], objetivos, now, today, fmtMoney: fmt });
    expect(result.length).toBeLessThanOrEqual(4);
  });
});
