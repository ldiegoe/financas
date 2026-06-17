// Domínio dos insights automáticos: detecta variações grandes por categoria
// e objetivos concluídos/perto de bater. Puro — recebe dados como argumento.

import { expandWithRecurring } from './despesa.js';
import { objetivoAtual } from './objetivo.js';

// Limites:
const MIN_DIFF_CENTS = 5000;       // R$ 50 — filtra ruído
const CHANGE_PCT_THRESHOLD = 30;   // 30% pra cima ou pra baixo
const NEAR_RATIO = 0.9;            // 90% do alvo = "falta pouco"
const MAX_INSIGHTS = 4;

// computeInsights — detecta mudanças relevantes desde o histórico.
// Args:
//   despesas      — array de despesas (forma do state)
//   categorias    — array de categorias (com .poupanca)
//   objetivos     — array de objetivos
//   now           — Date "agora" (deixe Date.now-base; injetado pra testes)
//   today         — 'YYYY-MM-DD' do dia atual (injetado pra testes)
//   fmtMoney      — função que formata centavos em string (fmtBRL ou similar)
export const computeInsights = ({ despesas, categorias, objetivos, now, today, fmtMoney }) => {
  const insights = [];
  const curMonthPeriod = { type: 'month', year: now.getFullYear(), value: now.getMonth() + 1 };
  const poupancaIds = new Set((categorias || []).filter(c => c.poupanca).map(c => c.id));

  // Gasto deste mes por categoria (despesas; exclui investimento).
  const curByCat = new Map();
  for (const d of expandWithRecurring(despesas, curMonthPeriod)) {
    if (poupancaIds.has(d.categoriaId)) continue;
    const id = d.categoriaId || '_sem';
    curByCat.set(id, (curByCat.get(id) || 0) + (d.valor || 0));
  }
  // Media dos 3 meses anteriores por categoria.
  const prevByCat = new Map();
  for (let i = 1; i <= 3; i++) {
    const dm = new Date(now.getFullYear(), now.getMonth() - i, 1);
    for (const d of expandWithRecurring(despesas, { type: 'month', year: dm.getFullYear(), value: dm.getMonth() + 1 })) {
      if (poupancaIds.has(d.categoriaId)) continue;
      const id = d.categoriaId || '_sem';
      prevByCat.set(id, (prevByCat.get(id) || 0) + (d.valor || 0));
    }
  }
  for (const [k, v] of prevByCat) prevByCat.set(k, Math.round(v / 3));

  // Lista de variações; filtra ruído.
  const changes = [];
  for (const id of new Set([...curByCat.keys(), ...prevByCat.keys()])) {
    const cur = curByCat.get(id) || 0;
    const prev = prevByCat.get(id) || 0;
    const diff = cur - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : null;
    if (Math.abs(diff) < MIN_DIFF_CENTS) continue;
    changes.push({ id, cur, prev, diff, pct });
  }
  changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Top categoria com aumento (ou nova categoria com gasto > R$50).
  const up = changes.find(c => c.diff > 0 && (c.pct === null || c.pct >= CHANGE_PCT_THRESHOLD));
  if (up) {
    const cat = (categorias || []).find(x => x.id === up.id);
    const nome = cat ? cat.nome : 'Sem categoria';
    insights.push({
      icon: 'trending', severity: 'warn',
      title: `Gasto maior em ${nome}`,
      body: up.prev > 0
        ? `${fmtMoney(up.cur)} este mês — ${Math.round(up.pct)}% acima da média de 3 meses (${fmtMoney(up.prev)}).`
        : `${fmtMoney(up.cur)} este mês — categoria que normalmente não aparece nos seus gastos.`,
    });
  }
  // Top categoria com queda.
  const down = changes.find(c => c.diff < 0 && c.pct !== null && c.pct <= -CHANGE_PCT_THRESHOLD && c.prev > 0);
  if (down) {
    const cat = (categorias || []).find(x => x.id === down.id);
    const nome = cat ? cat.nome : 'Sem categoria';
    insights.push({
      icon: 'sparkles', severity: 'good',
      title: `Economia em ${nome}`,
      body: `${fmtMoney(down.cur)} este mês — ${Math.round(Math.abs(down.pct))}% abaixo da média de 3 meses (${fmtMoney(down.prev)}).`,
    });
  }

  // Objetivos concluídos ou perto de bater.
  for (const obj of objetivos || []) {
    if (!obj.alvo || obj.alvo <= 0) continue;
    const atual = objetivoAtual(obj, despesas, today);
    const ratio = atual / obj.alvo;
    if (ratio >= 1) {
      insights.push({
        icon: 'target', severity: 'good',
        title: `Objetivo concluído: ${obj.nome}`,
        body: `Você acumulou ${fmtMoney(atual)} de ${fmtMoney(obj.alvo)}. Parabéns!`,
      });
    } else if (ratio >= NEAR_RATIO) {
      insights.push({
        icon: 'target', severity: 'good',
        title: `Falta pouco: ${obj.nome}`,
        body: `${Math.round(ratio * 100)}% concluído — faltam ${fmtMoney(obj.alvo - atual)} pra bater a meta.`,
      });
    }
  }

  return insights.slice(0, MAX_INSIGHTS);
};
