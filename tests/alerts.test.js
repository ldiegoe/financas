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

describe('computeAlerts — carnê acabando', () => {
  // Parcelada longa (como um carnê de lote): 179 parcelas desde 04/2024.
  const lote = { id: 'lote', descricao: 'Lote Golden Ville', data: '2024-04-10', valor: 28909, parcelas: 179 };
  const boleto = (mesRef) => ({ id: `b${mesRef}`, despesaId: 'lote', mesRef, vencimento: `${mesRef}-10`, valor: 28909 });
  const acabando = (r) => r.find(a => a.id.startsWith('boletos:'));

  it('NÃO alerta quando ainda há boletos de sobra', () => {
    const r = run({
      despesas: [lote],
      boletos: ['2025-05', '2025-06', '2025-07', '2025-08'].map(boleto),
    });
    expect(acabando(r)).toBeUndefined();
  });

  it('alerta quando restam 2 ou menos daqui pra frente', () => {
    const r = run({
      despesas: [lote],
      boletos: ['2025-03', '2025-04', '2025-05', '2025-06'].map(boleto),
    });
    // Só 05 e 06 são >= mês atual (05/2025); 03 e 04 já passaram.
    expect(acabando(r)).toMatchObject({ severity: 'blue', tab: 'despesas' });
    expect(acabando(r).title).toContain('2 boletos restantes');
  });

  it('alerta em laranja quando não sobrou nenhum', () => {
    const r = run({ despesas: [lote], boletos: ['2025-02', '2025-03'].map(boleto) });
    expect(acabando(r)).toMatchObject({ severity: 'orange' });
    expect(acabando(r).title).toContain('Acabaram os boletos');
  });

  it('NÃO alerta se a despesa acaba junto com o último boleto', () => {
    const curta = { id: 'lote', descricao: 'Curta', data: '2025-04-10', valor: 100, parcelas: 2 };
    const r = run({ despesas: [curta], boletos: ['2025-04', '2025-05'].map(boleto) });
    expect(acabando(r)).toBeUndefined();
  });

  it('NÃO alerta para despesa que já não existe mais', () => {
    const r = run({ despesas: [], boletos: ['2025-05'].map(boleto) });
    expect(acabando(r)).toBeUndefined();
  });

  it('o id muda ao importar a remessa nova, então o aviso volta', () => {
    const antes = acabando(run({ despesas: [lote], boletos: ['2025-05'].map(boleto) }));
    const depois = acabando(run({
      despesas: [lote],
      boletos: ['2025-05', '2025-06', '2025-07'].map(boleto),
    }));
    // Com 3 boletos à frente não há aviso; e o id do aviso antigo não se repete.
    expect(depois).toBeUndefined();
    const maisTarde = acabando(run({
      despesas: [lote],
      boletos: ['2025-05', '2025-06'].map(boleto),
    }));
    expect(maisTarde.id).not.toBe(antes.id);
  });

  it('sem boletos, nenhum alerta desse tipo', () => {
    expect(acabando(run({ despesas: [lote] }))).toBeUndefined();
  });

  it('alerta por despesa, sem misturar carnês diferentes', () => {
    const outro = { id: 'carro', descricao: 'Carro', data: '2024-04-10', valor: 50000, parcelas: 60 };
    const r = run({
      despesas: [lote, outro],
      boletos: [
        boleto('2025-05'),
        { id: 'c1', despesaId: 'carro', mesRef: '2025-05', vencimento: '2025-05-10', valor: 50000 },
      ],
    });
    const todos = r.filter(a => a.id.startsWith('boletos:'));
    expect(todos).toHaveLength(2);
    expect(todos.map(a => a.title).join()).toContain('Carro');
  });
});
