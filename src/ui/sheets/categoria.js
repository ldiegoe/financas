// Sheet de categoria (Categorias → nova/editar), incluindo os pickers de cor
// e de emoji. `palette` e `EMOJI_CHOICES` moram aqui porque só este sheet as
// usa.
// Fábrica: recebe as deps de runtime do app e devolve `sheetCategoria(cat)`.
//
// `getState` é um getter porque `state` é `let` reatribuído no app.js (troca de
// perfil, pull do sync) — injetar o valor congelaria a referência.

import { bindCurrencyInput } from '../currency-input.js';
import { escapeAttr } from '../escape.js';
import { infoBtn } from '../info-popover.js';
import { formatCentsDisplay } from '../../helpers/format.js';
import { parseAmount } from '../../helpers/parse.js';

const palette = [
  '#FF6B6B','#FF9F0A','#FFD60A','#30D158','#4ECDC4','#0A84FF','#5E5CE6',
  '#BF5AF2','#FF375F','#A8E6CF','#FFD93D','#95E1D3','#C9C9C9',
  '#5AC8FA','#FF2D92','#FF6B35','#7B68EE','#9ACD32','#D4A574','#FF85B3',
];

// Emojis sugeridos no picker de categoria (cobrem os usos mais comuns).
// O usuario pode tambem digitar qualquer emoji no campo de texto ao lado.
const EMOJI_CHOICES = [
  '🍔','🛒','🍕','☕','🍺','🚗','⛽','🚌','✈️','🏠','💡','💧','🔥','📱','💻',
  '🎮','🎬','🎵','📚','💊','🏥','💪','👕','✂️','🎁','💰','📈','🐷','🐾','🎓',
  '⚽','🧾','🏦','🔧','✏️','🌐',
];

export const createSheetCategoria = (deps) => {
  const { openSheet, closeSheet, db, render, toast, getState } = deps;

  return (cat) => {
    const isEdit = !!cat;
    // Cores em uso por outras categorias (na edicao, ignora a propria).
    // Usado pra: (1) sugerir cor padrao nao-repetida em categorias novas,
    // (2) marcar visualmente no picker as cores ja escolhidas.
    const usedColors = new Set(
      getState().categorias.filter(x => !cat || x.id !== cat.id).map(x => x.cor)
    );
    const defaultCor = palette.find(p => !usedColors.has(p))
      || palette[Math.floor(Math.random()*palette.length)];
    const c = cat || { nome: '', cor: defaultCor, meta: null, icone: '', poupanca: false, reserva: false };
    openSheet(isEdit ? 'Editar categoria' : 'Nova categoria', () => `
      <label class="field"><span>Nome</span>
        <input id="f-nome" type="text" value="${escapeAttr(c.nome || '')}" required />
      </label>
      <label class="field"><span>Ícone (opcional)</span>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <input id="f-icone" type="text" maxlength="4" style="width:64px;text-align:center;font-size:20px;" placeholder="—" value="${escapeAttr(c.icone || '')}" />
        </div>
        <div class="emoji-picker" id="f-emojis">
          <button type="button" class="emoji-pick ${!c.icone?'active':''}" data-emoji="">—</button>
          ${EMOJI_CHOICES.map(e => `<button type="button" class="emoji-pick ${c.icone===e?'active':''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
      </label>
      <label class="field"><span class="with-info">Cor${infoBtn('O ponto indica cores já usadas em outras categorias.')}</span>
        <div class="color-picker" id="f-cores">
          ${palette.map(p => {
            const cls = ['swatch-pick'];
            if (p === c.cor) cls.push('active');
            if (usedColors.has(p)) cls.push('used');
            const title = usedColors.has(p) ? ' title="Cor já em uso por outra categoria"' : '';
            return `<div class="${cls.join(' ')}" data-cor="${p}" style="background:${p}"${title}></div>`;
          }).join('')}
        </div>
      </label>
      <label class="field"><span>Meta mensal (R$, opcional)</span>
        <input id="f-meta" type="text" inputmode="numeric" placeholder="Deixe vazio para sem meta"
               value="${formatCentsDisplay(c.meta)}" />
        <small id="meta-hint" style="display:block;color:var(--text-2);margin-top:6px;font-size:12px;"></small>
      </label>
      <div class="checkbox-row">
        <input id="f-poupanca" type="checkbox" ${c.poupanca?'checked':''}/>
        <label for="f-poupanca">É investimento</label>
        ${infoBtn('Despesas nessa categoria contam como "guardado", não como gasto, no resumo do dashboard.')}
      </div>
      <div class="checkbox-row" id="row-reserva" ${c.poupanca ? '' : 'hidden'}>
        <input id="f-reserva" type="checkbox" ${c.reserva?'checked':''}/>
        <label for="f-reserva">É reserva de emergência</label>
        ${infoBtn('Conta na "Reserva de emergência" da saúde financeira — quantos meses de custo fixo estão cobertos.')}
      </div>
      <div class="actions">
        <button class="secondary" id="cancel">Cancelar</button>
        <button class="primary"   id="save">${isEdit ? 'Salvar' : 'Adicionar'}</button>
      </div>
    `, (body) => {
      bindCurrencyInput(body.querySelector('#f-meta'));
      // Picker em faixa rolavel: traz o item ativo pra perto do inicio visivel
      // (importante ao editar uma categoria cuja cor/emoji esta no fim da lista).
      requestAnimationFrame(() => {
        body.querySelector('#f-cores .swatch-pick.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
        body.querySelector('#f-emojis .emoji-pick.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      });
      let chosen = c.cor;
      body.querySelectorAll('#f-cores .swatch-pick').forEach(el => {
        el.addEventListener('click', () => {
          body.querySelectorAll('#f-cores .swatch-pick').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
          chosen = el.dataset.cor;
        });
      });
      const iconeInput = body.querySelector('#f-icone');
      body.querySelectorAll('#f-emojis .emoji-pick').forEach(el => {
        el.addEventListener('click', () => {
          iconeInput.value = el.dataset.emoji;
          body.querySelectorAll('#f-emojis .emoji-pick').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
        });
      });
      // Digitar manualmente desmarca os botoes (pode ser um emoji fora da lista).
      iconeInput.addEventListener('input', () => {
        body.querySelectorAll('#f-emojis .emoji-pick').forEach(x => {
          x.classList.toggle('active', x.dataset.emoji === iconeInput.value.trim());
        });
      });
      // "Reserva" é sub-opção de investimento: só aparece/vale quando "É
      // investimento" está marcado. O hint da meta também muda conforme poupanca.
      const poupEl = body.querySelector('#f-poupanca');
      const metaHint = body.querySelector('#meta-hint');
      const reservaRow = body.querySelector('#row-reserva');
      const reservaEl = body.querySelector('#f-reserva');
      const updatePoup = () => {
        const on = poupEl.checked;
        reservaRow.hidden = !on;
        if (!on) reservaEl.checked = false;
        metaHint.textContent = on
          ? 'Meta de quanto guardar por mês — atingir é bom.'
          : 'Limite de gasto por mês — você é avisado ao chegar perto.';
      };
      poupEl.addEventListener('change', updatePoup);
      updatePoup();
      body.querySelector('#cancel').addEventListener('click', closeSheet);
      body.querySelector('#save').addEventListener('click', () => {
        const data = {
          nome: body.querySelector('#f-nome').value.trim(),
          cor: chosen,
          icone: iconeInput.value.trim(),
          poupanca: poupEl.checked,
          reserva: poupEl.checked && reservaEl.checked,
          meta: body.querySelector('#f-meta').value.trim() ? parseAmount(body.querySelector('#f-meta').value) : null,
        };
        if (!data.nome) { alert('Informe um nome.'); return; }
        if (isEdit) db.updateCategoria(c.id, data); else db.addCategoria(data);
        closeSheet();
        toast(isEdit ? 'Categoria atualizada' : 'Categoria adicionada');
        render();
      });
    });
  };
};
