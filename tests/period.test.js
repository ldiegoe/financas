import { describe, it, expect } from 'vitest';
import {
  partsOf,
  clampDay,
  periodMatches,
  monthsInPeriod,
  previousPeriod,
  labelOfPeriod,
} from '../src/domain/period.js';

describe('partsOf', () => {
  it('extrai ano e mês', () => {
    expect(partsOf('2025-05-15')).toMatchObject({ y: 2025, m: 5 });
  });
  it('calcula trimestre', () => {
    expect(partsOf('2025-01-01').q).toBe(1);
    expect(partsOf('2025-03-31').q).toBe(1);
    expect(partsOf('2025-04-01').q).toBe(2);
    expect(partsOf('2025-12-31').q).toBe(4);
  });
  it('calcula semestre', () => {
    expect(partsOf('2025-06-30').s).toBe(1);
    expect(partsOf('2025-07-01').s).toBe(2);
  });
});

describe('clampDay', () => {
  it('mantém dia válido', () => {
    expect(clampDay(2025, 1, 15)).toBe(15);
  });
  it('reduz fevereiro 30 → 28 (ano comum)', () => {
    expect(clampDay(2025, 2, 30)).toBe(28);
  });
  it('reduz fevereiro 30 → 29 (ano bissexto)', () => {
    expect(clampDay(2024, 2, 30)).toBe(29);
  });
  it('reduz abril 31 → 30', () => {
    expect(clampDay(2025, 4, 31)).toBe(30);
  });
});

describe('periodMatches', () => {
  it('month', () => {
    const p = { type: 'month', year: 2025, value: 5 };
    expect(periodMatches('2025-05-01', p)).toBe(true);
    expect(periodMatches('2025-05-31', p)).toBe(true);
    expect(periodMatches('2025-04-30', p)).toBe(false);
    expect(periodMatches('2025-06-01', p)).toBe(false);
    expect(periodMatches('2024-05-15', p)).toBe(false);
  });
  it('quarter', () => {
    const p = { type: 'quarter', year: 2025, value: 2 }; // Abr-Mai-Jun
    expect(periodMatches('2025-04-01', p)).toBe(true);
    expect(periodMatches('2025-06-30', p)).toBe(true);
    expect(periodMatches('2025-03-31', p)).toBe(false);
    expect(periodMatches('2025-07-01', p)).toBe(false);
  });
  it('semester', () => {
    const p = { type: 'semester', year: 2025, value: 1 };
    expect(periodMatches('2025-01-15', p)).toBe(true);
    expect(periodMatches('2025-06-30', p)).toBe(true);
    expect(periodMatches('2025-07-01', p)).toBe(false);
  });
  it('year', () => {
    const p = { type: 'year', year: 2025 };
    expect(periodMatches('2025-01-01', p)).toBe(true);
    expect(periodMatches('2025-12-31', p)).toBe(true);
    expect(periodMatches('2026-01-01', p)).toBe(false);
  });
  it('custom: dia-a-dia inclusivo', () => {
    const p = { type: 'custom', from: '2025-05-10', to: '2025-05-20' };
    expect(periodMatches('2025-05-10', p)).toBe(true);
    expect(periodMatches('2025-05-15', p)).toBe(true);
    expect(periodMatches('2025-05-20', p)).toBe(true);
    expect(periodMatches('2025-05-09', p)).toBe(false);
    expect(periodMatches('2025-05-21', p)).toBe(false);
  });
});

describe('monthsInPeriod', () => {
  it('month: um mês', () => {
    expect(monthsInPeriod({ type: 'month', year: 2025, value: 5 }))
      .toEqual([{ y: 2025, m: 5 }]);
  });
  it('quarter: 3 meses', () => {
    expect(monthsInPeriod({ type: 'quarter', year: 2025, value: 2 }))
      .toEqual([{ y: 2025, m: 4 }, { y: 2025, m: 5 }, { y: 2025, m: 6 }]);
  });
  it('semester: 6 meses', () => {
    const months = monthsInPeriod({ type: 'semester', year: 2025, value: 1 });
    expect(months).toHaveLength(6);
    expect(months[0]).toEqual({ y: 2025, m: 1 });
    expect(months[5]).toEqual({ y: 2025, m: 6 });
  });
  it('year: 12 meses', () => {
    expect(monthsInPeriod({ type: 'year', year: 2025 })).toHaveLength(12);
  });
  it('custom: meses cobertos pelo range', () => {
    const months = monthsInPeriod({ type: 'custom', from: '2025-11-15', to: '2026-01-10' });
    expect(months).toEqual([
      { y: 2025, m: 11 },
      { y: 2025, m: 12 },
      { y: 2026, m: 1 },
    ]);
  });
});

describe('previousPeriod', () => {
  it('month → mês anterior', () => {
    expect(previousPeriod({ type: 'month', year: 2025, value: 5 }))
      .toEqual({ type: 'month', year: 2025, value: 4 });
  });
  it('month janeiro → dezembro do ano anterior', () => {
    expect(previousPeriod({ type: 'month', year: 2025, value: 1 }))
      .toEqual({ type: 'month', year: 2024, value: 12 });
  });
  it('quarter → trimestre anterior (wrap de ano)', () => {
    expect(previousPeriod({ type: 'quarter', year: 2025, value: 1 }))
      .toEqual({ type: 'quarter', year: 2024, value: 4 });
  });
  it('year → ano anterior', () => {
    expect(previousPeriod({ type: 'year', year: 2025 }))
      .toEqual({ type: 'year', year: 2024 });
  });
  it('custom → range de mesma duração imediatamente antes', () => {
    const prev = previousPeriod({ type: 'custom', from: '2025-05-10', to: '2025-05-20' });
    expect(prev).toMatchObject({
      type: 'custom',
      from: '2025-04-29',
      to: '2025-05-09',
    });
  });
});

describe('labelOfPeriod', () => {
  it('month', () => {
    expect(labelOfPeriod({ type: 'month', year: 2025, value: 5 })).toBe('Maio 2025');
  });
  it('quarter', () => {
    expect(labelOfPeriod({ type: 'quarter', year: 2025, value: 2 })).toBe('2º Tri 2025');
  });
  it('semester', () => {
    expect(labelOfPeriod({ type: 'semester', year: 2025, value: 1 })).toBe('1º Sem 2025');
  });
  it('year', () => {
    expect(labelOfPeriod({ type: 'year', year: 2025 })).toBe('2025');
  });
  it('custom com atalho', () => {
    expect(labelOfPeriod({ type: 'custom', shortcut: 'today', from: '2025-05-15', to: '2025-05-15' })).toBe('Hoje');
    expect(labelOfPeriod({ type: 'custom', shortcut: 'week', from: '2025-05-09', to: '2025-05-15' })).toBe('Últimos 7 dias');
    expect(labelOfPeriod({ type: 'custom', shortcut: 'month30', from: '2025-04-16', to: '2025-05-15' })).toBe('Últimos 30 dias');
    expect(labelOfPeriod({ type: 'custom', shortcut: 'mtd', from: '2025-05-01', to: '2025-05-15' })).toBe('Mês corrido');
  });
  it('custom sem atalho mostra range', () => {
    expect(labelOfPeriod({ type: 'custom', from: '2025-05-10', to: '2025-05-20' }))
      .toBe('10/05/2025 — 20/05/2025');
  });
});
