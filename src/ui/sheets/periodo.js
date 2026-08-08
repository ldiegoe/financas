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

    const gradeHTML = () => valoresDoTipo(rascunho.type).map(o => `
      <button class="pk-op ${rascunho.value === o.v ? 'active' : ''}" data-valor="${o.v}">${o.rotulo}</button>
    `).join('');

    const conteudo = () => `
      <div class="segmented" id="pk-tipo">
        ${TIPOS.map(t => `
          <button data-tipo="${t.id}" class="${rascunho.type === t.id ? 'active' : ''}">${t.rotulo}</button>
        `).join('')}
      </div>

      <div class="pk-ano">
        <button class="pk-ano-btn" id="pk-ano-prev" type="button" aria-label="Ano anterior">‹</button>
        <span class="pk-ano-valor" id="pk-ano-valor">${rascunho.year}</span>
        <button class="pk-ano-btn" id="pk-ano-next" type="button" aria-label="Próximo ano">›</button>
      </div>

      <div class="pk-grade" id="pk-valor" ${rascunho.type === 'year' ? 'hidden' : ''}>${gradeHTML()}</div>

      <div class="actions">
        <button class="secondary" id="pk-hoje">Hoje</button>
        <button class="primary"   id="pk-ok">Ver período</button>
      </div>
    `;

    // O sheet é montado UMA vez. Trocar tipo/ano atualiza o DOM no lugar — se
    // reabrisse via openSheet a cada toque, a animação de entrada tocaria de
    // novo e daria uma piscada a cada interação. (Regra da skill
    // nova-tela-sheet: abrir() só pra troca de etapa; update fino é DOM direto.)
    openSheet('Escolher período', conteudo, (body) => {
      const grade = body.querySelector('#pk-valor');
      const anoEl = body.querySelector('#pk-ano-valor');

      const pintarTipo = () => body.querySelectorAll('#pk-tipo button')
        .forEach(b => b.classList.toggle('active', b.dataset.tipo === rascunho.type));
      const pintarGrade = () => {
        grade.hidden = rascunho.type === 'year';
        grade.innerHTML = gradeHTML();
      };

      // Delegação no corpo do sheet: os handlers são ligados uma vez só e
      // sobrevivem à troca do innerHTML da grade.
      body.addEventListener('click', (e) => {
        const tipoBtn = e.target.closest('#pk-tipo button');
        if (tipoBtn) {
          rascunho.type = tipoBtn.dataset.tipo;
          // Reposiciona o valor: um índice de mês (1..12) não faz sentido como
          // trimestre. Mantém o que couber, senão volta pro primeiro.
          const max = rascunho.type === 'month' ? 12 : (rascunho.type === 'quarter' ? 4 : 2);
          if (!rascunho.value || rascunho.value > max) rascunho.value = 1;
          pintarTipo();
          pintarGrade();
          return;
        }

        if (e.target.closest('#pk-ano-prev')) { rascunho.year--; anoEl.textContent = rascunho.year; return; }
        if (e.target.closest('#pk-ano-next')) { rascunho.year++; anoEl.textContent = rascunho.year; return; }

        // Tocar no valor já confirma — é o caminho mais comum e evita o toque
        // extra no "Ver período".
        const op = e.target.closest('.pk-op');
        if (op) { rascunho.value = parseInt(op.dataset.valor, 10); aplicar(); return; }

        if (e.target.closest('#pk-hoje')) {
          const hoje = new Date();
          rascunho.year = hoje.getFullYear();
          if (rascunho.type === 'month')    rascunho.value = hoje.getMonth() + 1;
          if (rascunho.type === 'quarter')  rascunho.value = Math.floor(hoje.getMonth() / 3) + 1;
          if (rascunho.type === 'semester') rascunho.value = hoje.getMonth() <= 5 ? 1 : 2;
          aplicar();
          return;
        }

        if (e.target.closest('#pk-ok')) aplicar();
      });
    });

    const aplicar = () => {
      setPeriod(rascunho);
      closeSheet();
      render();
    };
  };
};
