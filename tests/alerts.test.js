import { describe, it, expect } from 'vitest';
import { computeAlerts } from '../src/domain/alerts.js';

const fmt = (cents) => `R$ ${(cents / 100).toFixed(2)}`;
const now = new Date(2025, 4, 15);
const today = '2025-05-15';

const run = (opts) => computeAlerts({
  despesas: [],
  rendas: [],
  categorias: [],
  now,
  today,
  fmtMoney: fmt,
  ...opts,
});

describe('computeAlerts — meta de categoria', () => {
  it('NÃO alerta categoria sem meta', () => {
    const result = run({
      categorias: [{ id: 'a', nome: 'X' }],
      despesas: [{ id: 'd', data: '2025-05-10', categoriaId: 'a', valor: 99999 }],
    });
    expect(result.filter(a => a.id.startsWith('meta:'))).toHaveLength(0);
  });

  it('NÃO alerta categoria de poupança (estourar meta de guardar é bom)', () => {
    const result = run({
      categorias: [{ id: 'p', nome: 'Investimentos', meta: 10000, poupanca: true }],
      despesas: [{ id: 'd', data: '2025-05-10', categoriaId: 'p', valor: 20000 }],
    });
    expect(result.filter(a => a.id.startsWith('meta:'))).toHaveLength(0);
  });

  it('alerta warn quando ≥80% da meta', () => {
    const result = run({
      categorias: [{ id: 'a', nome: 'Lazer', meta: 10000 }],
      despesas: [{ id: 'd', data: '2025-05-10', categoriaId: 'a', valor: 8500 }],
    });
    const a = result.find(x => x.id.startsWith('meta:a:'));
    expect(a).toBeDefined();
    expect(a.severity).toBe('orange');
    expect(a.title).toMatch(/perto da meta/);
  });

  it('alerta red quando ≥100% (estourou)', () => {
    const result = run({
      categorias: [{ id: 'a', nome: 'Lazer', meta: 10000 }],
      despesas: [{ id: 'd', data: '2025-05-10', categoriaId: 'a', valor: 12000 }],
    });
    const a = result.find(x => x.id.startsWith('meta:a:'));
    expect(a).toBeDefined();
    expect(a.severity).toBe('red');
    expect(a.title).toMatch(/estourou/);
  });
});

describe('computeAlerts — saldo do mês', () => {
  it('alerta red quando saldo negativo', () => {
    const result = run({
      rendas:   [{ id: 'r', data: '2025-05-01', valor: 10000 }],
      despesas: [{ id: 'd', data: '2025-05-10', valor: 50000 }],
    });
    const a = result.find(x => x.id.includes('saldo:') && x.id.endsWith('negative'));
    expect(a).toBeDefined();
    expect(a.severity).toBe('red');
  });

  it('alerta orange quando saldo < 10% da renda', () => {
    const result = run({
      rendas:   [{ id: 'r', data: '2025-05-01', valor: 100000 }],
      despesas: [{ id: 'd', data: '2025-05-10', valor: 95000 }],
    });
    const a = result.find(x => x.id.includes('saldo:') && x.id.endsWith('low'));
    expect(a).toBeDefined();
    expect(a.severity).toBe('orange');
  });

  it('NÃO alerta quando saldo saudável', () => {
    const result = run({
      rendas:   [{ id: 'r', data: '2025-05-01', valor: 100000 }],
      despesas: [{ id: 'd', data: '2025-05-10', valor: 30000 }],
    });
    expect(result.find(x => x.id.includes('saldo:'))).toBeUndefined();
  });
});

describe('computeAlerts — pendentes próximos 7 dias', () => {
  it('alerta blue com contagem e total', () => {
    const result = run({
      despesas: [
        { id: '1', data: '2025-05-16', valor: 1000 }, // 1d
        { id: '2', data: '2025-05-20', valor: 2500 }, // 5d
        { id: '3', data: '2025-05-25', valor: 9999 }, // 10d — fora
      ],
    });
    const a = result.find(x => x.id.startsWith('upcoming:'));
    expect(a).toBeDefined();
    expect(a.severity).toBe('blue');
    expect(a.title).toMatch(/2 pendentes/);
    expect(a.message).toMatch(/R\$ 35\.00/);
  });

  it('NÃO alerta se já pagas', () => {
    const result = run({
      despesas: [
        { id: '1', data: '2025-05-16', valor: 1000, pago: true },
      ],
    });
    expect(result.find(x => x.id.startsWith('upcoming:'))).toBeUndefined();
  });
});

describe('computeAlerts — ordenação por severidade', () => {
  it('red vem antes de orange vem antes de blue', () => {
    const result = run({
      categorias: [
        { id: 'over', nome: 'Over', meta: 1000 },
        { id: 'warn', nome: 'Warn', meta: 1000 },
      ],
      rendas:   [{ id: 'r', data: '2025-05-01', valor: 100000 }],
      despesas: [
        { id: 'a', data: '2025-05-10', categoriaId: 'over', valor: 1500 },
        { id: 'b', data: '2025-05-10', categoriaId: 'warn', valor: 800 },
        { id: 'c', data: '2025-05-16', valor: 1000 },
      ],
    });
    // Espera ao menos um red, um orange, um blue na ordem certa.
    const sevs = result.map(a => a.severity);
    expect(sevs[0]).toBe('red');
    expect(sevs.lastIndexOf('orange')).toBeGreaterThan(sevs.lastIndexOf('red'));
    expect(sevs.lastIndexOf('blue')).toBeGreaterThan(sevs.lastIndexOf('orange'));
  });
});
