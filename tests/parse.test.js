import { describe, it, expect } from 'vitest';
import {
  looksLikeExpression,
  evaluateExpression,
  parseAmount,
  parseTags,
  isoToDate,
  todayISO,
} from '../src/helpers/parse.js';

describe('looksLikeExpression', () => {
  it('detecta + * / ()', () => {
    expect(looksLikeExpression('1+2')).toBe(true);
    expect(looksLikeExpression('1*2')).toBe(true);
    expect(looksLikeExpression('1/2')).toBe(true);
    expect(looksLikeExpression('(1)')).toBe(true);
  });
  it('detecta menos entre operandos', () => {
    expect(looksLikeExpression('10-5')).toBe(true);
    expect(looksLikeExpression('10 - 5')).toBe(true);
  });
  it('não confunde menos com número negativo isolado', () => {
    expect(looksLikeExpression('-5')).toBe(false);
  });
  it('não detecta em string simples', () => {
    expect(looksLikeExpression('1234')).toBe(false);
    expect(looksLikeExpression('1234,56')).toBe(false);
    expect(looksLikeExpression('1.234,56')).toBe(false);
  });
});

describe('evaluateExpression', () => {
  it('soma simples com vírgula BR', () => {
    expect(evaluateExpression('48,90+12+7,50')).toBe(6840);
  });
  it('respeita precedência', () => {
    expect(evaluateExpression('10+2*3')).toBe(1600);
    expect(evaluateExpression('(10+2)*3')).toBe(3600);
  });
  it('subtração', () => {
    expect(evaluateExpression('100-25,50')).toBe(7450);
  });
  it('inválido devolve 0', () => {
    expect(evaluateExpression('abc')).toBe(0);
    expect(evaluateExpression('1+')).toBe(0);
  });
  it('resultado negativo é capado em 0', () => {
    expect(evaluateExpression('5-10')).toBe(0);
  });
});

describe('parseAmount', () => {
  it('inteiro simples', () => {
    expect(parseAmount('1234')).toBe(123400);
  });
  it('decimal pt-BR', () => {
    expect(parseAmount('1234,56')).toBe(123456);
  });
  it('decimal com milhar', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
  });
  it('decimal en (ponto)', () => {
    expect(parseAmount('1234.56')).toBe(123456);
  });
  it('expressão', () => {
    expect(parseAmount('10+20')).toBe(3000);
    expect(parseAmount('100,50 + 49,50')).toBe(15000);
  });
  it('null/empty', () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
  });
});

describe('parseTags', () => {
  it('split por vírgula com trim', () => {
    expect(parseTags('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('dedupa por lowercase preservando case original', () => {
    expect(parseTags('Viagem, viagem, VIAGEM')).toEqual(['Viagem']);
  });
  it('remove vazias', () => {
    expect(parseTags(',a,,b,')).toEqual(['a', 'b']);
  });
  it('vazio/null', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });
});

describe('isoToDate', () => {
  it('converte ISO em Date local', () => {
    const d = isoToDate('2025-05-15');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(4); // maio = 4
    expect(d.getDate()).toBe(15);
  });
});

describe('todayISO', () => {
  it('devolve formato YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
