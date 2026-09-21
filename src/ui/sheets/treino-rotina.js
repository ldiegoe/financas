// Editor de rotina de treino.
//
// Fábrica: recebe as deps de runtime do app e devolve `sheetTreinoRotina(rotina)`.
// `rotina` undefined = criar nova.
//
// O sheet é montado UMA vez; adicionar/remover exercício mexe só na lista, via
// delegação de evento. Reabrir com openSheet a cada toque faria a animação de
// entrada tocar de novo e piscaria (regra da skill nova-tela-sheet).

import { rotinaVazia, construirLinha, duracaoTotal, fmtMMSS } from '../../domain/treino.js';

export const createSheetTreinoRotina = (deps) => {
  const { openSheet, closeSheet, escapeHTML, escapeAttr, salvar, render, toast } = deps;

  return (original) => {
    // Rascunho: editar não afeta nada até salvar, e Cancelar não deixa rastro.
    const r = original
      ? { ...original, exercicios: [...original.exercicios] }
      : rotinaVazia();

    const num = (id, rotulo, valor, sufixo, min, max) => `
      <label class="field tr-num">
        <span>${rotulo}</span>
        <input type="number" id="${id}" value="${valor}" min="${min}" max="${max}" inputmode="numeric">
        <small>${sufixo}</small>
      </label>
    `;

    const listaHTML = () => r.exercicios.length === 0
      ? '<li class="tr-vazio">Nenhum exercício ainda.</li>'
      : r.exercicios.map((nome, i) => `
          <li class="tr-ex" data-i="${i}">
            <span class="tr-ex-n">${i + 1}</span>
            <input class="tr-ex-nome" data-i="${i}" value="${escapeAttr(nome)}" placeholder="Nome do exercício">
            <button class="tr-ex-del" data-i="${i}" type="button" aria-label="Remover">&#10005;</button>
          </li>
        `).join('');

    const resumoHTML = () => {
      const total = duracaoTotal(construirLinha(r));
      if (!total) return 'Adicione exercícios para ver a duração.';
      return `${r.exercicios.length} exercício${r.exercicios.length > 1 ? 's' : ''} · ${r.series} série${r.series > 1 ? 's' : ''} · <strong>${fmtMMSS(total)}</strong>`;
    };

    const conteudo = () => `
      <label class="field">
        <span>Nome da rotina</span>
        <input id="tr-nome" value="${escapeAttr(r.nome)}" placeholder="Ex.: Aeróbico 20/10">
      </label>

      <div class="tr-nums">
        ${num('tr-exec',  'Execução',   r.execucao,   'seg', 1, 3600)}
        ${num('tr-int',   'Intervalo',  r.intervalo,  'seg', 0, 3600)}
        ${num('tr-desc',  'Descanso',   r.descanso,   'seg', 0, 3600)}
        ${num('tr-ser',   'Séries',     r.series,     'voltas', 1, 99)}
      </div>

      <div class="section-title">Exercícios</div>
      <ul class="tr-lista" id="tr-lista">${listaHTML()}</ul>
      <button class="secondary tr-add" id="tr-add" type="button">+ Adicionar exercício</button>

      <div class="tr-resumo" id="tr-resumo">${resumoHTML()}</div>

      <div class="actions">
        <button class="secondary" id="tr-cancelar">Cancelar</button>
        <button class="primary"   id="tr-salvar">Salvar rotina</button>
      </div>
    `;

    openSheet(original ? 'Editar rotina' : 'Nova rotina', conteudo, (body) => {
      const lista  = body.querySelector('#tr-lista');
      const resumo = body.querySelector('#tr-resumo');

      const repintarLista = () => { lista.innerHTML = listaHTML(); repintarResumo(); };
      const repintarResumo = () => { resumo.innerHTML = resumoHTML(); };

      // Campos numéricos: leitura tolerante. Vazio ou lixo cai no mínimo em vez
      // de virar NaN e quebrar o cálculo da linha do tempo.
      const lerNum = (sel, min, padrao) => {
        const v = parseInt(body.querySelector(sel).value, 10);
        return Number.isFinite(v) && v >= min ? v : padrao;
      };
      const sincronizarNums = () => {
        r.execucao  = lerNum('#tr-exec', 1, 20);
        r.intervalo = lerNum('#tr-int',  0, 0);
        r.descanso  = lerNum('#tr-desc', 0, 0);
        r.series    = lerNum('#tr-ser',  1, 1);
        repintarResumo();
      };

      body.addEventListener('input', (e) => {
        if (e.target.closest('.tr-num input')) { sincronizarNums(); return; }
        // Digitar o nome do exercício atualiza o rascunho sem repintar a lista
        // (repintar tiraria o foco do campo a cada tecla).
        const campo = e.target.closest('.tr-ex-nome');
        if (campo) r.exercicios[Number(campo.dataset.i)] = campo.value;
      });

      body.addEventListener('click', (e) => {
        if (e.target.closest('#tr-add')) {
          r.exercicios.push('');
          repintarLista();
          const ultimo = lista.querySelector('.tr-ex:last-child .tr-ex-nome');
          if (ultimo) ultimo.focus();
          return;
        }
        const del = e.target.closest('.tr-ex-del');
        if (del) { r.exercicios.splice(Number(del.dataset.i), 1); repintarLista(); return; }
        if (e.target.closest('#tr-cancelar')) { closeSheet(); return; }
        if (e.target.closest('#tr-salvar')) {
          sincronizarNums();
          r.nome = body.querySelector('#tr-nome').value.trim();
          r.exercicios = r.exercicios.map(x => x.trim()).filter(Boolean);
          if (!r.nome) { toast('Dê um nome à rotina'); return; }
          if (!r.exercicios.length) { toast('Adicione pelo menos um exercício'); return; }
          salvar(r);
          closeSheet();
          render();
          toast(original ? 'Rotina atualizada' : 'Rotina criada');
        }
      });
    });
  };
};
