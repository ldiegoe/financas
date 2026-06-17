import { describe, it, expect } from 'vitest';
import { upcomingItems } from '../src/domain/upcoming.js';

// "Hoje": 15/maio/2025 (terça)
const now = new Date(2025, 4, 15);

describe('upcomingItems', () => {
  it('vazio quando não há despesas', () => {
    expect(upcomingItems([], now)).toEqual([]);
  });

  it('inclui pendente nos próximos 14 dias', () => {
    const despesas = [
      { id: '1', data: '2025-05-20', valor: 100 }, // 5 dias
      { id: '2', data: '2025-05-28', valor: 200 }, // 13 dias
      { id: '3', data: '2025-06-15', valor: 999 }, // 31 dias — fora
    ];
    const result = upcomingItems(despesas, now);
    expect(result.map(d => d.id).sort()).toEqual(['1', '2']);
  });

  it('inclui atrasada dentro dos últimos 30 dias com _overdue=true', () => {
    const despesas = [
      { id: 'a', data: '2025-05-10', valor: 100 },  // 5 dias atrás
      { id: 'b', data: '2025-04-20', valor: 200 },  // 25 dias atrás
    ];
    const result = upcomingItems(despesas, now);
    expect(result).toHaveLength(2);
    expect(result.every(d => d._overdue)).toBe(true);
  });

  it('exclui atrasada além de 30 dias', () => {
    const despesas = [{ id: 'z', data: '2025-03-01', valor: 100 }]; // ~75 dias
    expect(upcomingItems(despesas, now)).toEqual([]);
  });

  it('exclui despesas já pagas', () => {
    const despesas = [
      { id: '1', data: '2025-05-20', valor: 100, pago: true },
      { id: '2', data: '2025-05-22', valor: 200 },
    ];
    const result = upcomingItems(despesas, now);
    expect(result.map(d => d.id)).toEqual(['2']);
  });

  it('atrasadas vêm primeiro (mais recente antes), depois futuras (mais cedo antes)', () => {
    const despesas = [
      { id: 'futura1', data: '2025-05-22', valor: 100 },     // futura, 7d
      { id: 'futura2', data: '2025-05-18', valor: 100 },     // futura, 3d
      { id: 'atrasada1', data: '2025-05-05', valor: 100 },   // atrasada 10d
      { id: 'atrasada2', data: '2025-05-12', valor: 100 },   // atrasada 3d
    ];
    const result = upcomingItems(despesas, now);
    expect(result.map(d => d.id)).toEqual(['atrasada2', 'atrasada1', 'futura2', 'futura1']);
  });

  it('expande recorrente mensal trazendo atrasada e futura', () => {
    const despesas = [
      // Recorrente começando há 2 meses, vence dia 20 →
      // ocorrências: 03/20 (60d, fora 30d), 04/20 (25d atrás, atrasada),
      // 05/20 (5d futura), 06/20 (36d, fora janela 14d).
      { id: 'rec', data: '2025-03-20', valor: 100, recorrente: true },
    ];
    const result = upcomingItems(despesas, now);
    expect(result).toHaveLength(2);
    expect(result.map(d => d.data)).toEqual(['2025-04-20', '2025-05-20']);
    expect(result[0]._overdue).toBe(true);
    expect(result[1]._overdue).toBe(false);
  });

  it('limita a 12 itens', () => {
    const despesas = Array.from({ length: 30 }, (_, i) => ({
      id: `d${i}`, data: '2025-05-20', valor: 100,
    }));
    expect(upcomingItems(despesas, now)).toHaveLength(12);
  });
});
