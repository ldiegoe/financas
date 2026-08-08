// Popover de informação — o "i" ao lado de um controle abre um balãozinho
// ancorado com a explicação, em vez de deixar parágrafos permanentes na tela.
//
// Uso: `infoBtn('texto')` dentro do template + `mountInfoPopover()` uma única
// vez no boot. O listener é delegado no `document` porque as views são
// re-renderizadas via innerHTML — um handler por botão morreria a cada render.
//
// A captura (`capture: true`) é essencial: o "i" costuma ficar dentro de um
// `<label>`, e sem interceptar antes o clique viraria toggle do checkbox.

import { escapeAttr, escapeHTML } from './escape.js';
import { icon } from './icons.js';

// Margem mínima entre o balão e a borda da tela.
const PAD = 12;
// Distância entre o balão e o "i" (deixa espaço pra seta de 6px).
const GAP = 10;

// Botão "i". O texto viaja no data-attr — sem registry, sobrevive a re-render.
export const infoBtn = (text) =>
  `<button type="button" class="info-btn" data-info="${escapeAttr(text)}"
           aria-label="Mais informações" aria-expanded="false">${icon('info', 17)}</button>`;

export const mountInfoPopover = (doc = document) => {
  const win = doc.defaultView || window;
  let pop = null;     // balão aberto (ou null)
  let anchor = null;  // botão que o abriu

  const close = () => {
    if (!pop) return;
    pop.remove();
    anchor.setAttribute('aria-expanded', 'false');
    pop = null;
    anchor = null;
  };

  // Posiciona o balão já montado: centraliza no "i", prende dentro da tela e
  // vira pra cima quando não cabe embaixo.
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;

    pop.style.maxWidth = `${Math.min(300, vw - PAD * 2)}px`;
    const { width, height } = pop.getBoundingClientRect();

    const left = Math.min(Math.max(PAD, a.left + a.width / 2 - width / 2), vw - width - PAD);
    const below = a.bottom + GAP;
    const above = a.top - height - GAP;
    // Só sobe se não couber embaixo E couber em cima.
    const flip = below + height > vh - PAD && above >= PAD;

    pop.style.left = `${left}px`;
    pop.style.top = `${flip ? above : below}px`;
    pop.classList.toggle('above', flip);
    // Seta aponta pro centro do "i", sem escapar dos cantos arredondados.
    const arrowX = Math.min(Math.max(14, a.left + a.width / 2 - left), width - 14);
    pop.style.setProperty('--arrow-x', `${arrowX}px`);
  };

  const open = (btn) => {
    close();
    anchor = btn;
    pop = doc.createElement('div');
    pop.className = 'info-pop';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = escapeHTML(btn.dataset.info);
    doc.body.appendChild(pop);
    place();
    btn.setAttribute('aria-expanded', 'true');
  };

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.info-btn');
    if (!btn) { close(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (btn === anchor) close(); else open(btn);
  }, true);

  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // O balão é position:fixed e ancorado — rolar a tela o descolaria do "i".
  doc.addEventListener('scroll', close, true);
  win.addEventListener('resize', close);

  return { close };
};
