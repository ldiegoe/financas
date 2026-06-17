// Domínio dos "vencimentos" — ocorrências pendentes nos próximos 14 dias e
// atrasadas até 30 dias atrás. Atrasadas vêm primeiro (recente→antiga),
// depois próximas (cedo→tarde). Cada item recebe _overdue.
// Puro: recebe despesas + now como argumentos.

import { expandWithRecurring } from './despesa.js';
import { isoToDate } from '../helpers/parse.js';

const HORIZON_DAYS = 14;
const OVERDUE_DAYS = 30;
const MAX_ITEMS = 12;

export const upcomingItems = (despesas, now) => {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setDate(today.getDate() + HORIZON_DAYS);
  const overdueLimit = new Date(today); overdueLimit.setDate(today.getDate() - OVERDUE_DAYS);
  const pv = new Date(today); pv.setMonth(pv.getMonth() - 1);
  const nx = new Date(today); nx.setMonth(nx.getMonth() + 1);
  const periods = [
    { type: 'month', year: pv.getFullYear(),    value: pv.getMonth() + 1 },
    { type: 'month', year: today.getFullYear(), value: today.getMonth() + 1 },
    { type: 'month', year: nx.getFullYear(),    value: nx.getMonth() + 1 },
  ];
  return periods.flatMap(p => expandWithRecurring(despesas, p))
    .filter(d => !d._pago)
    .filter(d => {
      const dt = isoToDate(d.data); dt.setHours(0, 0, 0, 0);
      return dt >= overdueLimit && dt <= horizon;
    })
    .map(d => {
      const dt = isoToDate(d.data); dt.setHours(0, 0, 0, 0);
      return { ...d, _overdue: dt < today };
    })
    .sort((a, b) => {
      if (a._overdue !== b._overdue) return a._overdue ? -1 : 1;
      return a._overdue ? b.data.localeCompare(a.data) : a.data.localeCompare(b.data);
    })
    .slice(0, MAX_ITEMS);
};
