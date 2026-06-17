import { describe, it, expect } from 'vitest';
import {
  fmtBRL,
  formatCentsDisplay,
  fmtDate,
  monthName,
  yyyyMmFromDate,
  yyyyMmDdFromDate,
} from '../src/helpers/format.js';

describe('fmtBRL', () => {
  it('formata zero', () => {
    expect(fmtBRL(0)).toMatch(/R\$\s*0,00/);
  });
  it('formata valor simples', () => {
    expect(fmtBRL(12345)).toMatch(/R\$\s*123,45/);
  });
  it('formata milhares', () => {
    expect(fmtBRL(1234567)).toMatch(/R\$\s*12\.345,67/);
  });
  it('aceita null/undefined como 0', () => {
    expect(fmtBRL(null)).toMatch(/R\$\s*0,00/);
    expect(fmtBRL(undefined)).toMatch(/R\$\s*0,00/);
  });
});

describe('formatCentsDisplay', () => {
  it('zero vira string vazia', () => {
    expect(formatCentsDisplay(0)).toBe('');
  });
  it('formata centavos com vírgula', () => {
    expect(formatCentsDisplay(12345)).toBe('123,45');
  });
  it('preserva zero à direita', () => {
    expect(formatCentsDisplay(100)).toBe('1,00');
    expect(formatCentsDisplay(105)).toBe('1,05');
  });
  it('formata milhares com ponto', () => {
    expect(formatCentsDisplay(1234567)).toBe('12.345,67');
  });
});

describe('fmtDate', () => {
  it('converte ISO para DD/MM/YYYY', () => {
    expect(fmtDate('2025-05-15')).toBe('15/05/2025');
  });
  it('string vazia/null devolve string vazia', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate(null)).toBe('');
  });
});

describe('monthName', () => {
  it('devolve nome completo (default)', () => {
    expect(monthName(1)).toBe('Janeiro');
    expect(monthName(12)).toBe('Dezembro');
  });
  it('short=true devolve abreviado', () => {
    expect(monthName(1, true)).toBe('Jan');
    expect(monthName(3, true)).toBe('Mar');
  });
});

describe('yyyyMmFromDate / yyyyMmDdFromDate', () => {
  it('formata YYYY-MM', () => {
    expect(yyyyMmFromDate(new Date(2025, 0, 15))).toBe('2025-01');
    expect(yyyyMmFromDate(new Date(2025, 11, 1))).toBe('2025-12');
  });
  it('formata YYYY-MM-DD com zero à esquerda', () => {
    expect(yyyyMmDdFromDate(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(yyyyMmDdFromDate(new Date(2025, 11, 31))).toBe('2025-12-31');
  });
});
