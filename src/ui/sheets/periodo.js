// Sheet seletor de período. Existe porque o cabeçalho das telas foi enxugado:
// antes o topo empilhava QUATRO blocos (título, stepper de ano, segmented de
// tipo e a faixa de chips) — ~35% da tela gasta antes do primeiro número.
// Agora o cabeçalho é só `‹ Agosto 2026 ›` e todo o resto mora aqui, aberto
// sob demanda ao tocar no título.
//
// Fábrica: recebe as deps de runtime do app e devolve `sheetPeriodo()`.
// `getPeriod` é getter porque `period` é reatribuído no app.js — injetar o
// valor congelaria o binding e o sheet abriria sempre no período inicial.

import { monthName } from '../../helpers/format.js';

const TIPOS = [
  { id: 'month',    rotulo: 'Mês' },
  { id: 'quarter',  rotulo: 'Trimestre' },
  { id: 'semester', rotulo: 'Semestre' },
  { id: 'year',     rotulo: 'Ano' },
];

// Rótulos dos valores de cada tipo. 'year' não tem — o ano já é escolhido no
// stepper, então não há segunda dimensão pra selecionar.
const valoresDoTipo = (tipo) => {
  if (tipo === 'month')    return Array.from({ length: 12 }, (_, i) => ({ v: i + 1, rotulo: monthName(i + 1, true) }));
  if (tipo === 'quarter')  return [1, 2, 3, 4].map(v => ({ v, rotulo: `${v}º Tri` }));
  if (tipo === 'semester') return [1, 2].map(v => ({ v, rotulo: `${v}º Sem` }));
  return [];
};

export const createSheetPeriodo = (deps) => {
  const { openSheet, closeSheet, render, getPeriod, setPeriod } = deps;

  return () => {
    // Rascunho local: o usuário só afeta a tela ao confirmar, então dá pra
    // explorar (trocar tipo, andar de ano) e desistir sem efeito colateral.
    const atual = getPeriod();
    let rascunho = { type: atual.type, year: atual.year, value: atual.value };

    const conteudo = () => `
      <div class="segmented" id="pk-tipo">
        ${TIPOS.map(t => `
          <button data-tipo="${t.id}" class="${rascunho.type === t.id ? 'active' : ''}">${t.rotulo}</button>
        `).join('')}
      </div>

      <div class="pk-ano">
        <button class="pk-ano-btn" id="pk-ano-prev" type="button" aria-label="Ano anterior">‹</button>
        <span class="pk-ano-valor">${rascunho.year}</span>
        <button class="pk-ano-btn" id="pk-ano-next" type="button" aria-label="Próximo ano">›</button>
      </div>

      ${rascunho.type === 'year' ? '' : `
        <div class="pk-grade" id="pk-valor">
          ${valoresDoTipo(rascunho.type).map(o => `
            <button class="pk-op ${rascunho.value === o.v ? 'active' : ''}" data-valor="${o.v}">${o.rotulo}</button>
          `).join('')}
        </div>
      `}

      <div class="actions">
        <button class="secondary" id="pk-hoje">Hoje</button>
        <button class="primary"   id="pk-ok">Ver período</button>
      </div>
    `;

    const abrir = () => openSheet('Escolher período', conteudo, (body) => {
      // Trocar de tipo reposiciona o valor: um índice de mês (1..12) não faz
      // sentido como trimestre. Mantém o que couber, senão volta pro primeiro.
      body.querySelectorAll('#pk-tipo button').forEach(b => {
        b.addEventListener('click', () => {
          rascunho.type = b.dataset.tipo;
          const max = rascunho.type === 'month' ? 12 : (rascunho.type === 'quarter' ? 4 : 2);
          if (!rascunho.value || rascunho.value > max) rascunho.value = 1;
          abrir();
        });
      });

      body.querySelector('#pk-ano-prev').addEventListener('click', () => { rascunho.year--; abrir(); });
      body.querySelector('#pk-ano-next').addEventListener('click', () => { rascunho.year++; abrir(); });

      // Tocar no valor já confirma — é o caminho mais comum e evita o toque
      // extra no "Ver período".
      body.querySelectorAll('#pk-valor .pk-op').forEach(b => {
        b.addEventListener('click', () => {
          rascunho.value = parseInt(b.dataset.valor, 10);
          aplicar();
        });
      });

      body.querySelector('#pk-hoje').addEventListener('click', () => {
        const hoje = new Date();
        rascunho.year = hoje.getFullYear();
        if (rascunho.type === 'month')    rascunho.value = hoje.getMonth() + 1;
        if (rascunho.type === 'quarter')  rascunho.value = Math.floor(hoje.getMonth() / 3) + 1;
        if (rascunho.type === 'semester') rascunho.value = hoje.getMonth() <= 5 ? 1 : 2;
        aplicar();
      });

      body.querySelector('#pk-ok').addEventListener('click', aplicar);
    });

    const aplicar = () => {
      setPeriod(rascunho);
      closeSheet();
      render();
    };

    abrir();
  };
};
