import { describe, it, expect } from 'vitest';
import {
  HEALTH_META_DEFAULTS,
  healthMetas,
  scoreOf,
  colorClass,
} from '../src/domain/health.js';

describe('HEALTH_META_DEFAULTS', () => {
  it('valores conhecidos', () => {
    expect(HEALTH_META_DEFAULTS).toEqual({ invest: 20, gastos: 70, fixo: 50, reserva: 6 });
  });
});

describe('healthMetas', () => {
  it('config vazia → defaults', () => {
    expect(healthMetas({})).toEqual(HEALTH_META_DEFAULTS);
  });
  it('null/undefined → defaults', () => {
    expect(healthMetas(null)).toEqual(HEALTH_META_DEFAULTS);
    expect(healthMetas(undefined)).toEqual(HEALTH_META_DEFAULTS);
  });
  it('valores válidos sobrescrevem', () => {
    const m = healthMetas({
      healthMetaInvest: 25,
      healthMetaGastos: 60,
      healthMetaFixo: 45,
      healthMetaReserva: 9,
    });
    expect(m).toEqual({ invest: 25, gastos: 60, fixo: 45, reserva: 9 });
  });
  it('valores zero/negativos → default', () => {
    const m = healthMetas({ healthMetaInvest: 0, healthMetaGastos: -5 });
    expect(m.invest).toBe(20);
    expect(m.gastos).toBe(70);
  });
  it('clamp no máximo', () => {
    const m = healthMetas({ healthMetaInvest: 500, healthMetaReserva: 9999 });
    expect(m.invest).toBe(100);
    expect(m.reserva).toBe(60);
  });
  it('valores não-numéricos → default', () => {
    const m = healthMetas({ healthMetaInvest: 'abc' });
    expect(m.invest).toBe(20);
  });
});

describe('scoreOf — higher é melhor (ex.: taxa de investimento)', () => {
  // good=20, warn=10
  it('v ≥ good → 100', () => {
    expect(scoreOf(20, 20, 10, true)).toBe(100);
    expect(scoreOf(30, 20, 10, true)).toBe(100);
  });
  it('v entre warn e good → 60..100 linear', () => {
    // No meio: 60 + 40 * 0.5 = 80
    expect(scoreOf(15, 20, 10, true)).toBe(80);
  });
  it('v abaixo de warn → 0..60 linear', () => {
    // Metade do warn: 60 * 0.5 = 30
    expect(scoreOf(5, 20, 10, true)).toBe(30);
  });
  it('v = 0 → 0', () => {
    expect(scoreOf(0, 20, 10, true)).toBe(0);
  });
});

describe('scoreOf — lower é melhor (ex.: gastos/renda)', () => {
  // good=70, warn=90 (ideal ≤ 70%)
  it('v ≤ good → 100', () => {
    expect(scoreOf(70, 70, 90, false)).toBe(100);
    expect(scoreOf(50, 70, 90, false)).toBe(100);
  });
  it('v entre good e warn → 60..100', () => {
    // No meio (80): 60 + 40 * 0.5 = 80
    expect(scoreOf(80, 70, 90, false)).toBe(80);
  });
  it('v acima de warn decai pra 0 no cap', () => {
    // cap = warn + (warn - good) = 110. Em 100 (meio): 60 * 0.5 = 30
    expect(scoreOf(100, 70, 90, false)).toBe(30);
    expect(scoreOf(110, 70, 90, false)).toBe(0);
    expect(scoreOf(200, 70, 90, false)).toBe(0);
  });
});

describe('colorClass', () => {
  it('higher: above good → "good"', () => {
    expect(colorClass(25, 20, 10, true)).toBe('good');
    expect(colorClass(20, 20, 10, true)).toBe('good');
  });
  it('higher: entre warn e good → ""', () => {
    expect(colorClass(15, 20, 10, true)).toBe('');
  });
  it('higher: abaixo de warn → "bad"', () => {
    expect(colorClass(5, 20, 10, true)).toBe('bad');
  });
  it('lower: below good → "good"', () => {
    expect(colorClass(50, 70, 90, false)).toBe('good');
  });
  it('lower: entre good e warn → ""', () => {
    expect(colorClass(80, 70, 90, false)).toBe('');
  });
  it('lower: acima de warn → "bad"', () => {
    expect(colorClass(100, 70, 90, false)).toBe('bad');
  });
});
