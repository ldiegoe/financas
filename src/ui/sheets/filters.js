// Sheet com TODOS os controles de filtro (categoria, tag, status, tipo,
// intervalo de datas). Toques nos chips/inputs aplicam IMEDIATAMENTE (muta o
// objeto `filters` + render do view de fundo); o sheet fica aberto pra o
// usuário continuar ajustando. "Limpar tudo" zera tudo, inclusive a busca.
// Fábrica: recebe as deps de runtime do app e devolve `sheetFilters()`.
//
// Recebe o objeto `filters` (lê e escreve propriedades individuais) e
// `resetFilters`. Mutação de propriedade propaga por referência — é o que
// permite o sheet morar em outro módulo.
//
// Os value= dos inputs de data não passam por escapeAttr de propósito: saem de
// <input type="date">.value (browser restringe a '' ou ISO) e nunca são
// persistidos nem vêm de arquivo importado.

import { escapeHTML, escapeAttr } from '../escape.js';

export const createSheetFilters = (deps) => {
  const {
    openSheet, closeSheet, render, getState, allTags, filters, resetFilters,
  } = deps;

  return () => {
    const tags = allTags();
    const despesasCats = getState().categorias.filter(c => !c.poupanca);
    openSheet('Filtros', () => `
      ${despesasCats.length > 0 ? `
        <div class="filter-group">
          <div class="filter-group-label">Categoria</div>
          <div class="filter-bar" id="sheet-cat-filter">
            <button class="chip ${filters.category.size===0?'active':''}" data-cat="">Todas</button>
            ${despesasCats.map(c => `
              <button class="chip ${filters.category.has(c.id)?'active':''}" data-cat="${c.id}">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.cor};margin-right:6px;vertical-align:middle;"></span>${escapeHTML(c.nome)}
              </button>`).join('')}
          </div>
        </div>
      ` : ''}
      ${tags.length > 0 ? `
        <div class="filter-group">
          <div class="filter-group-label">Tag</div>
          <div class="filter-bar" id="sheet-tag-filter">
            <button class="chip ${filters.tag.size===0?'active':''}" data-tag="">Todas</button>
            ${tags.map(t => `<button class="chip ${filters.tag.has(t.toLowerCase())?'active':''}" data-tag="${escapeAttr(t.toLowerCase())}">#${escapeHTML(t)}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="filter-group">
        <div class="filter-group-label">Status</div>
        <div class="filter-bar" id="sheet-status-filter">
          <button class="chip ${filters.status===null?'active':''}" data-status="">Todas</button>
          <button class="chip ${filters.status==='pago'?'active':''}" data-status="pago">Pagas</button>
          <button class="chip ${filters.status==='pendente'?'active':''}" data-status="pendente">Pendentes</button>
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-group-label">Tipo</div>
        <div class="filter-bar" id="sheet-type-filter">
          <button class="chip ${filters.type===null?'active':''}" data-type="">Todos</button>
          <button class="chip ${filters.type==='mensal'?'active':''}" data-type="mensal">Mensais</button>
          <button class="chip ${filters.type==='parcelada'?'active':''}" data-type="parcelada">Parceladas</button>
          <button class="chip ${filters.type==='unica'?'active':''}" data-type="unica">Apenas neste mês</button>
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-group-label">Intervalo de datas</div>
        <div class="segmented" id="sheet-date-basis" style="margin-bottom:10px;">
          <button data-basis="pagamento" class="${filters.dateBasis==='pagamento'?'active':''}">Por pagamento</button>
          <button data-basis="cadastro"  class="${filters.dateBasis==='cadastro' ?'active':''}">Por cadastro</button>
        </div>
        <div class="date-range-row">
          <label class="date-range-field">
            <span>De</span>
            <input type="date" id="sheet-date-from" value="${filters.dateFrom || ''}" />
          </label>
          <label class="date-range-field">
            <span>Até</span>
            <input type="date" id="sheet-date-to" value="${filters.dateTo || ''}" />
          </label>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" id="sheet-filters-clear">Limpar tudo</button>
        <button class="primary"   id="sheet-filters-close">Concluir</button>
      </div>
    `, (body) => {
      const syncCls = (sel, getter) => body.querySelectorAll(sel).forEach(x => x.classList.toggle('active', getter(x)));
      body.querySelectorAll('#sheet-cat-filter .chip').forEach(b => b.addEventListener('click', () => {
        const c = b.dataset.cat;
        if (!c) filters.category.clear();
        else filters.category.has(c) ? filters.category.delete(c) : filters.category.add(c);
        syncCls('#sheet-cat-filter .chip', x => x.dataset.cat ? filters.category.has(x.dataset.cat) : filters.category.size === 0);
        render();
      }));
      body.querySelectorAll('#sheet-tag-filter .chip').forEach(b => b.addEventListener('click', () => {
        const t = b.dataset.tag;
        if (!t) filters.tag.clear();
        else filters.tag.has(t) ? filters.tag.delete(t) : filters.tag.add(t);
        syncCls('#sheet-tag-filter .chip', x => x.dataset.tag ? filters.tag.has(x.dataset.tag) : filters.tag.size === 0);
        render();
      }));
      body.querySelectorAll('#sheet-status-filter .chip').forEach(b => b.addEventListener('click', () => {
        filters.status = b.dataset.status || null;
        syncCls('#sheet-status-filter .chip', x => (x.dataset.status || null) === filters.status);
        render();
      }));
      body.querySelectorAll('#sheet-type-filter .chip').forEach(b => b.addEventListener('click', () => {
        filters.type = b.dataset.type || null;
        syncCls('#sheet-type-filter .chip', x => (x.dataset.type || null) === filters.type);
        render();
      }));
      body.querySelectorAll('#sheet-date-basis button').forEach(b => b.addEventListener('click', () => {
        filters.dateBasis = b.dataset.basis;
        syncCls('#sheet-date-basis button', x => x.dataset.basis === filters.dateBasis);
        if (filters.dateFrom || filters.dateTo) render();
      }));
      const dFrom = body.querySelector('#sheet-date-from');
      if (dFrom) dFrom.addEventListener('change', () => { filters.dateFrom = dFrom.value || null; render(); });
      const dTo = body.querySelector('#sheet-date-to');
      if (dTo) dTo.addEventListener('change', () => { filters.dateTo = dTo.value || null; render(); });
      body.querySelector('#sheet-filters-clear').addEventListener('click', () => {
        resetFilters();
        // Atualiza as classes/valores do sheet sem fechar/reabrir (sem flash).
        syncCls('#sheet-cat-filter .chip',    x => !x.dataset.cat);
        syncCls('#sheet-tag-filter .chip',    x => !x.dataset.tag);
        syncCls('#sheet-status-filter .chip', x => !x.dataset.status);
        syncCls('#sheet-type-filter .chip',   x => !x.dataset.type);
        syncCls('#sheet-date-basis button',   x => x.dataset.basis === 'pagamento');
        const df = body.querySelector('#sheet-date-from'); if (df) df.value = '';
        const dt = body.querySelector('#sheet-date-to');   if (dt) dt.value = '';
        render();
      });
      body.querySelector('#sheet-filters-close').addEventListener('click', closeSheet);
    });
  };
};
