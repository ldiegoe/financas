// Domínio de período: tipos (month/quarter/semester/year/custom), match,
// expansão em meses, navegação anterior, rótulo. Tudo puro — nenhuma
// dependência de DOM ou state global. Período é passado como parâmetro.

import { isoToDate } from '../helpers/parse.js';
import { fmtDate, monthName, yyyyMmDdFromDate } from '../helpers/format.js';

// "2025-05-15" -> { y: 2025, m: 5, q: 2, s: 1 }
export const partsOf = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return { y, m, q: Math.floor((m - 1) / 3) + 1, s: m <= 6 ? 1 : 2 };
};

// Garante que o dia caiba no mês (ex.: 31 em fevereiro vira o último dia).
export const clampDay = (y, m, d) => {
  const last = new Date(y, m, 0).getDate();
  return Math.min(d, last);
};

// True se a data ISO bate com o período.
// Período 'custom' usa from/to (dia a dia); outros usam year/value.
export const periodMatches = (iso, period) => {
  if (period.type === 'custom') {
    return iso >= period.from && iso <= period.to;
  }
  const { y, m, q, s } = partsOf(iso);
  if (period.year !== y) return false;
  if (period.type === 'year') return true;
  if (period.type === 'month') return m === period.value;
  if (period.type === 'quarter') return q === period.value;
  if (period.type === 'semester') return s === period.value;
  return true;
};

// Lista de meses cobertos pelo período (cada item: { y, m }).
export const monthsInPeriod = (period) => {
  if (period.type === 'custom') {
    const months = [];
    const start = isoToDate(period.from);
    const end = isoToDate(period.to);
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= limit) {
      months.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }
  const y = period.year;
  if (period.type === 'year') return Array.from({ length: 12 }, (_, i) => ({ y, m: i + 1 }));
  if (period.type === 'month') return [{ y, m: period.value }];
  if (period.type === 'quarter') {
    const start = (period.value - 1) * 3 + 1;
    return [start, start + 1, start + 2].map(m => ({ y, m }));
  }
  if (period.type === 'semester') {
    const start = period.value === 1 ? 1 : 7;
    return Array.from({ length: 6 }, (_, i) => ({ y, m: start + i }));
  }
  return [];
};

// Período imediatamente anterior de mesma "tamanho" lógico.
// custom → range de mesma duração imediatamente antes do `from`.
export const previousPeriod = (p) => {
  if (p.type === 'custom') {
    const start = isoToDate(p.from);
    const end = isoToDate(p.to);
    const days = Math.round((end - start) / 86400000) + 1;
    const newEnd = new Date(start); newEnd.setDate(newEnd.getDate() - 1);
    const newStart = new Date(newEnd); newStart.setDate(newStart.getDate() - days + 1);
    return { type: 'custom', from: yyyyMmDdFromDate(newStart), to: yyyyMmDdFromDate(newEnd), shortcut: p.shortcut };
  }
  const np = { ...p };
  if (p.type === 'year') { np.year--; return np; }
  const wrap = p.type === 'month' ? 12 : (p.type === 'quarter' ? 4 : 2);
  if (p.value === 1) { np.year--; np.value = wrap; } else { np.value--; }
  return np;
};

// Rótulo amigável do período (humano).
// custom → nome do atalho ou range de datas.
export const labelOfPeriod = (p) => {
  if (p.type === 'custom') {
    if (p.shortcut === 'today') return 'Hoje';
    if (p.shortcut === 'week')  return 'Últimos 7 dias';
    if (p.shortcut === 'month30') return 'Últimos 30 dias';
    if (p.shortcut === 'mtd')   return 'Mês corrido';
    return `${fmtDate(p.from)} — ${fmtDate(p.to)}`;
  }
  if (p.type === 'year')     return String(p.year);
  if (p.type === 'month')    return `${monthName(p.value)} ${p.year}`;
  if (p.type === 'quarter')  return `${p.value}º Tri ${p.year}`;
  if (p.type === 'semester') return `${p.value}º Sem ${p.year}`;
  return '';
};
