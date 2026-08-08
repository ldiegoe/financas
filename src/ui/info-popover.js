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

  // "Tamanho do texto" (html.text-small/large) aplica `zoom`, e isso divide as
  // medidas em dois espaços. Medido no Chrome:
  //   getBoundingClientRect()  → VISUAL (já multiplicado pelo zoom)
  //   documentElement.clientWidth/Height → VISUAL (== innerWidth/Height)
  //   style.top/left que escrevemos → LOCAL (multiplicado só na hora de pintar)
  // Ou seja: dá pra fazer TODA a conta em espaço visual, onde os rects e a
  // viewport concordam, e dividir pelo zoom só o que vai pro style.
  const zoomFactor = () => {
    let z = 1;
    for (let el = pop.parentElement; el; el = el.parentElement) {
      z *= parseFloat(win.getComputedStyle(el).zoom) || 1;
    }
    return z || 1;
  };

  // Posiciona o balão já montado: centraliza no "i", prende dentro da tela e
  // vira pra cima quando não cabe embaixo.
  const place = () => {
    const z = zoomFactor();
    const a = anchor.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;

    // maxWidth é comprimento local: o balão escala junto com o resto da UI.
    pop.style.maxWidth = `${Math.min(300, vw / z - PAD * 2)}px`;
    const { width, height } = pop.getBoundingClientRect();

    // PAD/GAP são pensados em espaço local — no visual valem × zoom.
    const pad = PAD * z, gap = GAP * z;
    const left = Math.min(Math.max(pad, a.left + a.width / 2 - width / 2), vw - width - pad);
    const below = a.bottom + gap;
    const above = a.top - height - gap;
    // Só sobe se não couber embaixo E couber em cima.
    const flip = below + height > vh - pad && above >= pad;

    pop.style.left = `${left / z}px`;
    pop.style.top = `${(flip ? above : below) / z}px`;
    pop.classList.toggle('above', flip);
    // Seta aponta pro centro do "i", sem escapar dos cantos arredondados.
    const arrowX = Math.min(Math.max(14 * z, a.left + a.width / 2 - left), width - 14 * z);
    pop.style.setProperty('--arrow-x', `${arrowX / z}px`);
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
