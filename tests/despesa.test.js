import { describe, it, expect } from 'vitest';
import {
  sumAmount,
  hasOccurrences,
  expandWithRecurring,
  computeTogglePagoPatch,
  setOcorrenciaPagaPatch,
} from '../src/domain/despesa.js';

describe('sumAmount', () => {
  it('soma vazia é 0', () => {
    expect(sumAmount([])).toBe(0);
  });
  it('soma simples', () => {
    expect(sumAmount([{ valor: 100 }, { valor: 250 }, { valor: 50 }])).toBe(400);
  });
  it('ignora itens sem valor', () => {
    expect(sumAmount([{ valor: 100 }, {}, { valor: null }, { valor: 50 }])).toBe(150);
  });
});

describe('hasOccurrences', () => {
  it('única → false', () => {
    expect(hasOccurrences({ data: '2025-05-15', valor: 100 })).toBe(false);
  });
  it('recorrente → true', () => {
    expect(hasOccurrences({ recorrente: true })).toBe(true);
  });
  it('parcelada (>1) → true', () => {
    expect(hasOccurrences({ parcelas: 3 })).toBe(true);
  });
  it('parcelas=1 → false (não é parcelada de fato)', () => {
    expect(hasOccurrences({ parcelas: 1 })).toBe(false);
  });
});

// Helper: cria um período mensal simples para os testes.
const mes = (year, value) => ({ type: 'month', year, value });

describe('expandWithRecurring — único', () => {
  it('única dentro do período aparece com _virtual=false', () => {
    const items = [{ id: '1', data: '2025-05-15', valor: 100, pago: true }];
    const out = expandWithRecurring(items, mes(2025, 5));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: '1', _virtual: false, _pago: true });
  });
  it('única fora do período é filtrada', () => {
    const items = [{ id: '1', data: '2025-04-15', valor: 100 }];
    expect(expandWithRecurring(items, mes(2025, 5))).toEqual([]);
  });
  it('pago=false quando o campo está ausente', () => {
    const items = [{ id: '1', data: '2025-05-10', valor: 100 }];
    expect(expandWithRecurring(items, mes(2025, 5))[0]._pago).toBe(false);
  });
});

describe('expandWithRecurring — recorrente mensal', () => {
  it('aparece no mês de início (original) com _virtual=false', () => {
    const items = [{ id: 'a', data: '2025-05-10', valor: 100, recorrente: true }];
    const out = expandWithRecurring(items, mes(2025, 5));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', _virtual: false, data: '2025-05-10' });
  });
  it('aparece em mês posterior como projeção (_virtual=true)', () => {
    const items = [{ id: 'a', data: '2025-05-10', valor: 100, recorrente: true }];
    const out = expandWithRecurring(items, mes(2025, 8));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', _virtual: true, data: '2025-08-10' });
  });
  it('NÃO aparece antes da data de início', () => {
    const items = [{ id: 'a', data: '2025-05-10', valor: 100, recorrente: true }];
    expect(expandWithRecurring(items, mes(2025, 3))).toEqual([]);
  });
  it('pagasEm marca _pago=true só para os meses correspondentes', () => {
    const items = [{ id: 'a', data: '2025-05-10', valor: 100, recorrente: true, pagasEm: ['2025-06'] }];
    expect(expandWithRecurring(items, mes(2025, 5))[0]._pago).toBe(false);
    expect(expandWithRecurring(items, mes(2025, 6))[0]._pago).toBe(true);
  });
  it('respeita duracaoMeses (renda temporária)', () => {
    const items = [{ id: 'a', data: '2025-05-10', valor: 100, recorrente: true, duracaoMeses: 3 }];
    // Aparece em 05, 06, 07
    expect(expandWithRecurring(items, mes(2025, 5))).toHaveLength(1);
    expect(expandWithRecurring(items, mes(2025, 7))).toHaveLength(1);
    // Não aparece em 08
    expect(expandWithRecurring(items, mes(2025, 8))).toEqual([]);
  });
  it('dia 31 → último dia do mês (clamp)', () => {
    const items = [{ id: 'a', data: '2025-01-31', valor: 100, recorrente: true }];
    expect(expandWithRecurring(items, mes(2025, 2))[0].data).toBe('2025-02-28');
    expect(expandWithRecurring(items, mes(2025, 4))[0].data).toBe('2025-04-30');
    // Ano bissexto: começa em 2024-01-31 e cai em fev → dia 29.
    const bissexto = [{ id: 'b', data: '2024-01-31', valor: 100, recorrente: true }];
    expect(expandWithRecurring(bissexto, mes(2024, 2))[0].data).toBe('2024-02-29');
  });
});

describe('expandWithRecurring — parcelada', () => {
  it('gera 3 ocorrências numa parcelada de 3x', () => {
    const items = [{ id: 'p', data: '2025-05-10', valor: 100, parcelas: 3 }];
    const out5 = expandWithRecurring(items, mes(2025, 5));
    const out6 = expandWithRecurring(items, mes(2025, 6));
    const out7 = expandWithRecurring(items, mes(2025, 7));
    const out8 = expandWithRecurring(items, mes(2025, 8));
    expect(out5).toHaveLength(1);
    expect(out6).toHaveLength(1);
    expect(out7).toHaveLength(1);
    expect(out8).toEqual([]); // já terminou
  });
  it('parcelas trazem _parcelaNum e _parcelaTotal', () => {
    const items = [{ id: 'p', data: '2025-05-10', valor: 100, parcelas: 3 }];
    expect(expandWithRecurring(items, mes(2025, 5))[0]).toMatchObject({ _parcelaNum: 1, _parcelaTotal: 3 });
    expect(expandWithRecurring(items, mes(2025, 6))[0]).toMatchObject({ _parcelaNum: 2, _parcelaTotal: 3 });
    expect(expandWithRecurring(items, mes(2025, 7))[0]).toMatchObject({ _parcelaNum: 3, _parcelaTotal: 3 });
  });
});

describe('computeTogglePagoPatch', () => {
  it('null se base ausente', () => {
    expect(computeTogglePagoPatch(null, { data: '2025-05-10' })).toBe(null);
  });
  it('única não paga → { pago: true }', () => {
    const base = { id: '1', data: '2025-05-10', pago: false };
    expect(computeTogglePagoPatch(base, base)).toEqual({ pago: true });
  });
  it('única paga → { pago: false }', () => {
    const base = { id: '1', data: '2025-05-10', pago: true };
    expect(computeTogglePagoPatch(base, base)).toEqual({ pago: false });
  });
  it('recorrente: adiciona yyyy-mm em pagasEm', () => {
    const base = { id: '1', data: '2025-05-10', recorrente: true, pagasEm: [] };
    const occ  = { id: '1', data: '2025-08-10' };
    expect(computeTogglePagoPatch(base, occ)).toEqual({ pagasEm: ['2025-08'] });
  });
  it('recorrente: remove yyyy-mm já presente em pagasEm', () => {
    const base = { id: '1', data: '2025-05-10', recorrente: true, pagasEm: ['2025-06', '2025-08'] };
    const occ  = { id: '1', data: '2025-08-10' };
    expect(computeTogglePagoPatch(base, occ)).toEqual({ pagasEm: ['2025-06'] });
  });
  it('parcelada: alterna pagasEm da ocorrência', () => {
    const base = { id: '1', data: '2025-05-10', parcelas: 3, pagasEm: ['2025-05'] };
    const occ  = { id: '1', data: '2025-05-10' };
    expect(computeTogglePagoPatch(base, occ)).toEqual({ pagasEm: [] });
  });
});

describe('setOcorrenciaPagaPatch', () => {
  it('null se base ausente', () => {
    expect(setOcorrenciaPagaPatch(null, '2025-05', true)).toBe(null);
  });
  it('única: define pago como pedido se diferente', () => {
    expect(setOcorrenciaPagaPatch({ pago: false }, '2025-05', true)).toEqual({ pago: true });
    expect(setOcorrenciaPagaPatch({ pago: true }, '2025-05', false)).toEqual({ pago: false });
  });
  it('única: null quando já está no estado pedido', () => {
    expect(setOcorrenciaPagaPatch({ pago: true }, '2025-05', true)).toBe(null);
    expect(setOcorrenciaPagaPatch({ pago: false }, '2025-05', false)).toBe(null);
  });
  it('recorrente: adiciona yyyy-mm faltante quando want=true', () => {
    const base = { recorrente: true, pagasEm: ['2025-04'] };
    expect(setOcorrenciaPagaPatch(base, '2025-05', true)).toEqual({ pagasEm: ['2025-04', '2025-05'] });
  });
  it('recorrente: null quando já presente e want=true', () => {
    const base = { recorrente: true, pagasEm: ['2025-05'] };
    expect(setOcorrenciaPagaPatch(base, '2025-05', true)).toBe(null);
  });
  it('recorrente: remove quando want=false', () => {
    const base = { recorrente: true, pagasEm: ['2025-04', '2025-05'] };
    expect(setOcorrenciaPagaPatch(base, '2025-05', false)).toEqual({ pagasEm: ['2025-04'] });
  });
  it('recorrente: null quando ausente e want=false', () => {
    const base = { recorrente: true, pagasEm: ['2025-04'] };
    expect(setOcorrenciaPagaPatch(base, '2025-05', false)).toBe(null);
  });
});
