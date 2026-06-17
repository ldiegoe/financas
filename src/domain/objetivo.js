// Domínio de objetivos (e queries cumulativas usadas por eles).
// Tudo puro: recebe os inputs como argumentos, sem state global.

import { expandWithRecurring } from './despesa.js';

// Soma de despesas (expandindo recorrentes/parceladas) nas categorias do
// idSet, com data <= today e >= `desde` se definido. Itera ano a ano da
// despesa mais antiga relevante até o ano corrente.
// Base do progresso de objetivos e da "reserva acumulada" no painel de saúde.
export const sumCategoriasAteHoje = (despesas, idSet, desde, today) => {
  if (idSet.size === 0) return 0;
  const relevantes = despesas.filter(d => idSet.has(d.categoriaId));
  if (relevantes.length === 0) return 0;
  const startYear = Math.min(...relevantes.map(d => parseInt(d.data.slice(0, 4), 10)));
  const endYear = parseInt(today.slice(0, 4), 10);
  let total = 0;
  for (let y = startYear; y <= endYear; y++) {
    for (const d of expandWithRecurring(despesas, { type: 'year', year: y })) {
      if (!idSet.has(d.categoriaId)) continue;
      if (d.data > today) continue;
      if (desde && d.data < desde) continue;
      total += d.valor || 0;
    }
  }
  return total;
};

// Quanto já foi acumulado nas categorias linkadas a um objetivo.
export const objetivoAtual = (obj, despesas, today) =>
  sumCategoriasAteHoje(despesas, new Set(obj.categoriaIds || []), obj.desde, today);
