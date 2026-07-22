// Domínio dos alertas (sino na topbar). Detecta:
//   - meta de categoria perto (≥80%) ou estourada (≥100%)
//   - saldo do mês negativo ou baixo (<10% da renda)
//   - lançamentos pendentes vencendo nos próximos 7 dias
//   - carnê acabando (boletos importados no fim, mas ainda há parcelas)
// Cada alerta tem `id` estável — se o usuário dispensar, o id vai pro
// dismissedAlerts e não reaparece. Se a severidade mudar (warn → over) o
// id muda e um novo alerta surge.
// Puro: recebe inputs como argumentos.

import { expandWithRecurring, sumAmount, cobreMes } from './despesa.js';
import { isoToDate } from '../helpers/parse.js';

const UPCOMING_HORIZON_DAYS = 7;
const BOLETOS_LOW = 2;              // ≤2 boletos restantes → hora de pedir mais
const LOW_SALDO_RATIO = 0.1;        // saldo < 10% da renda → baixo
const META_WARN_PCT = 80;
const META_OVER_PCT = 100;
const SEVERITY_ORDER = { red: 0, orange: 1, blue: 2 };

export const computeAlerts = ({ despesas, rendas, categorias, boletos = [], now, today, fmtMoney }) => {
  const alerts = [];
  const cur = { type: 'month', year: now.getFullYear(), value: now.getMonth() + 1 };
  const periodKey = `${cur.year}-${String(cur.value).padStart(2, '0')}`;

  const monthDespesas = expandWithRecurring(despesas, cur);
  const monthRendas   = expandWithRecurring(rendas, cur);
  const totalDesp  = sumAmount(monthDespesas);
  const totalRenda = sumAmount(monthRendas);

  // Meta de categoria
  const gastoPorCat = new Map();
  for (const d of monthDespesas) {
    if (!d.categoriaId) continue;
    gastoPorCat.set(d.categoriaId, (gastoPorCat.get(d.categoriaId) || 0) + (d.valor || 0));
  }
  for (const c of categorias) {
    if (!c.meta || c.poupanca) continue; // poupanca: estourar a meta de guardar é bom
    const gasto = gastoPorCat.get(c.id) || 0;
    const pct = (gasto / c.meta) * 100;
    if (pct >= META_OVER_PCT) {
      alerts.push({
        id: `meta:${c.id}:${periodKey}:over`, severity: 'red',
        title: `${c.nome} estourou a meta`,
        message: `${fmtMoney(gasto)} de ${fmtMoney(c.meta)} (${Math.round(pct)}%)`,
        tab: 'despesas',
      });
    } else if (pct >= META_WARN_PCT) {
      alerts.push({
        id: `meta:${c.id}:${periodKey}:warn`, severity: 'orange',
        title: `${c.nome} perto da meta`,
        message: `${fmtMoney(gasto)} de ${fmtMoney(c.meta)} (${Math.round(pct)}%)`,
        tab: 'despesas',
      });
    }
  }

  // Saldo do mês
  const saldo = totalRenda - totalDesp;
  if (saldo < 0) {
    alerts.push({
      id: `saldo:${periodKey}:negative`, severity: 'red',
      title: 'Saldo do mês ficou negativo',
      message: `Saldo atual: ${fmtMoney(saldo)}`,
      tab: 'dashboard',
    });
  } else if (totalRenda > 0 && saldo < totalRenda * LOW_SALDO_RATIO) {
    alerts.push({
      id: `saldo:${periodKey}:low`, severity: 'orange',
      title: 'Saldo do mês está baixo',
      message: `Saldo atual: ${fmtMoney(saldo)}`,
      tab: 'dashboard',
    });
  }

  // Lançamentos pendentes vencendo nos próximos 7 dias — escaneia mês corrente
  // + próximo (cobre virada do mês), filtra na janela e considera só pendentes.
  const todayDate = new Date(now); todayDate.setHours(0, 0, 0, 0);
  const limit = new Date(todayDate); limit.setDate(todayDate.getDate() + UPCOMING_HORIZON_DAYS);
  const nextMonthDate = new Date(todayDate); nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextPeriod = { type: 'month', year: nextMonthDate.getFullYear(), value: nextMonthDate.getMonth() + 1 };
  const allUpcoming = [...monthDespesas, ...expandWithRecurring(despesas, nextPeriod)];
  let upcomingCount = 0, upcomingTotal = 0;
  for (const d of allUpcoming) {
    if (d._pago) continue;
    const dt = isoToDate(d.data); dt.setHours(0, 0, 0, 0);
    if (dt >= todayDate && dt <= limit) {
      upcomingCount++;
      upcomingTotal += d.valor || 0;
    }
  }
  if (upcomingCount > 0) {
    alerts.push({
      id: `upcoming:${today}`, severity: 'blue',
      title: `${upcomingCount} pendente${upcomingCount > 1 ? 's' : ''} nos próximos ${UPCOMING_HORIZON_DAYS} dias`,
      message: `Total a pagar: ${fmtMoney(upcomingTotal)}`,
      tab: 'despesas',
    });
  }

  // Carnê acabando: quando os boletos importados de uma despesa estão no fim
  // mas ainda faltam parcelas, é hora de pedir/importar a próxima remessa.
  // Boletos de meses já passados não contam — o que importa é quantos ainda
  // dão pra pagar daqui pra frente.
  for (const alerta of boletosAcabandoAlerts(despesas, boletos, periodKey)) {
    alerts.push(alerta);
  }

  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return alerts;
};

// Mês seguinte a um 'YYYY-MM'.
const proximoMes = (mesRef) => {
  const [y, m] = mesRef.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

const boletosAcabandoAlerts = (despesas, boletos, mesAtual) => {
  const out = [];
  if (!boletos || boletos.length === 0) return out;

  const porDespesa = new Map();
  for (const b of boletos) {
    if (!porDespesa.has(b.despesaId)) porDespesa.set(b.despesaId, []);
    porDespesa.get(b.despesaId).push(b);
  }

  for (const [despesaId, lista] of porDespesa) {
    const despesa = despesas.find(d => d.id === despesaId);
    if (!despesa) continue;

    const ultimo = lista.map(b => b.mesRef).sort().pop();
    // Se a despesa não tem parcela depois do último boleto, o carnê acabou
    // junto com ela — não há próxima remessa pra pedir.
    if (!cobreMes(despesa, proximoMes(ultimo))) continue;

    const restantes = lista.filter(b => b.mesRef >= mesAtual).length;
    if (restantes > BOLETOS_LOW) continue;

    const nome = despesa.descricao || 'despesa';
    out.push({
      // O id inclui o último mês importado: ao importar a remessa nova o id
      // muda, então dispensar hoje não silencia o aviso da próxima vez.
      id: `boletos:${despesaId}:${ultimo}:${restantes}`,
      severity: restantes === 0 ? 'orange' : 'blue',
      title: restantes === 0
        ? `Acabaram os boletos de ${nome}`
        : `${restantes} boleto${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''} de ${nome}`,
      message: restantes === 0
        ? 'A despesa continua, mas não há mais código importado. Importe a próxima remessa do carnê.'
        : 'A despesa continua depois disso — peça/importe a próxima remessa do carnê.',
      tab: 'despesas',
    });
  }
  return out;
};
