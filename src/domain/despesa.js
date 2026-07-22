// Domínio de despesas/lançamentos: expansão de recorrentes/parceladas,
// soma de valores e cálculo dos patches de pagamento.
// Tudo puro — nenhuma referência ao state global, ao db ou ao DOM.

import { partsOf, monthsInPeriod, clampDay, periodMatches } from './period.js';

// Soma .valor de uma lista de lançamentos (ignora undefined/null).
export const sumAmount = (arr) => arr.reduce((acc, x) => acc + (x.valor || 0), 0);

// Verdadeiro se a despesa "ocorre múltiplas vezes" (recorrente ou parcelada).
// Single → uma única ocorrência (mesma data do cadastro).
export const hasOccurrences = (despesa) =>
  !!despesa.recorrente || (despesa.parcelas || 0) > 1;

// Meses decorridos entre o mês de início da despesa e um 'YYYY-MM'.
const monthDelta = (despesa, mesRef) => {
  const [sy, sm] = despesa.data.slice(0, 7).split('-').map(Number);
  const [y, m]   = String(mesRef).split('-').map(Number);
  return (y - sy) * 12 + (m - sm);
};

// A despesa tem ocorrência neste mês? Mesma regra do expandWithRecurring, mas
// respondendo pontualmente em vez de expandir um período inteiro — usado para
// casar boletos importados com a parcela certa.
export const cobreMes = (despesa, mesRef) => {
  if (!hasOccurrences(despesa)) return despesa.data.slice(0, 7) === mesRef;
  const delta = monthDelta(despesa, mesRef);
  if (delta < 0) return false;
  if ((despesa.parcelas || 0) > 1) return delta < despesa.parcelas;
  if (despesa.duracaoMeses > 0) return delta < despesa.duracaoMeses;
  return true; // recorrente sem fim
};

// Número da parcela (1-based) que cai neste mês, ou null se a despesa não for
// parcelada ou o mês estiver fora do intervalo.
export const parcelaDoMes = (despesa, mesRef) => {
  if (!((despesa.parcelas || 0) > 1)) return null;
  const delta = monthDelta(despesa, mesRef);
  return (delta >= 0 && delta < despesa.parcelas) ? delta + 1 : null;
};

// Expande os items pro período pedido considerando:
//  - recorrentes (recorrente=true): repete todo mês a partir da data (limitado
//    por duracaoMeses se definido — rendas temporárias);
//  - parcelados (parcelas>1): repete por N meses consecutivos e encerra;
//  - únicos: aparecem só na data exata.
// Cada ocorrência ganha _virtual=true se for projeção (não a original),
// _pago refletindo o status (single → it.pago; outras → via pagasEm),
// _parcelaNum/_parcelaTotal nas parceladas.
export const expandWithRecurring = (items, period) => {
  const out = [];
  for (const it of items) {
    const parcelas = it.parcelas && it.parcelas > 1 ? it.parcelas : 0;
    const isRecurring = !!it.recorrente;
    const isInstallment = parcelas > 1;
    // Rendas temporárias: recorrente com duração definida (ex.: seguro-desemprego
    // por 4 meses). Encerra após `duracaoMeses` ocorrências a partir da data.
    const recDur = (isRecurring && it.duracaoMeses && it.duracaoMeses > 0) ? it.duracaoMeses : 0;

    if (!isRecurring && !isInstallment) {
      if (periodMatches(it.data, period)) {
        out.push({ ...it, _virtual: false, _pago: it.pago === true });
      }
      continue;
    }

    const start = partsOf(it.data);
    const day = parseInt(it.data.split('-')[2], 10);
    const months = monthsInPeriod(period);
    const pagasEm = it.pagasEm || [];

    for (const { y, m } of months) {
      const monthsFromStart = (y - start.y) * 12 + (m - start.m);
      if (monthsFromStart < 0) continue;
      if (isInstallment && monthsFromStart >= parcelas) continue;
      if (recDur && monthsFromStart >= recDur) continue;

      const projectedDay = clampDay(y, m, day);
      const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
      const iso = `${yyyyMm}-${String(projectedDay).padStart(2, '0')}`;
      // Em períodos custom (intervalo livre), checa dia-a-dia.
      if (period.type === 'custom' && (iso < period.from || iso > period.to)) continue;
      const isOriginal = (y === start.y && m === start.m);
      const occ = { ...it, data: iso, _virtual: !isOriginal, _pago: pagasEm.includes(yyyyMm) };
      if (isInstallment) {
        occ._parcelaNum = monthsFromStart + 1;
        occ._parcelaTotal = parcelas;
      }
      out.push(occ);
    }
  }
  return out;
};

// Patch pra TOGGLAR (alternar) o status de pagamento de uma ocorrência.
// Single → inverte o campo `pago`.
// Recorrente/parcelada → alterna 'YYYY-MM' no array pagasEm.
// Retorna null se a `base` não existir.
export const computeTogglePagoPatch = (base, occurrence) => {
  if (!base) return null;
  if (!hasOccurrences(base)) {
    return { pago: !base.pago };
  }
  const yyyyMm = occurrence.data.slice(0, 7);
  const pagasEm = base.pagasEm ? [...base.pagasEm] : [];
  const idx = pagasEm.indexOf(yyyyMm);
  if (idx >= 0) pagasEm.splice(idx, 1);
  else pagasEm.push(yyyyMm);
  return { pagasEm };
};

// Patch pra DEFINIR o status (sem alternar) de uma ocorrência específica.
// Útil pro batch de "Marcar pagas" do card Vencimentos.
// Retorna null se já está no estado desejado (caller pode pular o update).
export const setOcorrenciaPagaPatch = (base, yyyyMm, want) => {
  if (!base) return null;
  if (!hasOccurrences(base)) {
    if (!!base.pago === !!want) return null;
    return { pago: !!want };
  }
  const pagasEm = base.pagasEm ? [...base.pagasEm] : [];
  const idx = pagasEm.indexOf(yyyyMm);
  if (want && idx < 0) pagasEm.push(yyyyMm);
  else if (!want && idx >= 0) pagasEm.splice(idx, 1);
  else return null;
  return { pagasEm };
};
