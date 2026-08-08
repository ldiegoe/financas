import { describe, it, expect } from 'vitest';
import { infoBtn, mountInfoPopover } from '../src/ui/info-popover.js';

describe('infoBtn()', () => {
  it('monta o botão com o texto no data-attr', () => {
    const out = infoBtn('Explicação curta.');
    expect(out).toContain('class="info-btn"');
    expect(out).toContain('data-info="Explicação curta."');
    expect(out).toContain('aria-label="Mais informações"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('<svg');
  });

  it('escapa o texto — o data-attr não pode ser quebrado', () => {
    const out = infoBtn('aspas " e <script>alert(1)</script> & fim');
    expect(out).toContain('data-info="aspas &quot; e &lt;script&gt;');
    // Verificação independente: fora do SVG, nenhuma aspa dupla sobra além
    // das que delimitam os atributos do próprio botão.
    const attrs = out.slice(0, out.indexOf('<svg')).match(/"/g);
    expect(attrs).toHaveLength(10); // type, class, data-info, aria-label, aria-expanded
    expect(out).not.toContain('<script>');
  });

  it('aceita texto vazio sem quebrar o markup', () => {
    expect(infoBtn('')).toContain('data-info=""');
  });
});

// --------------------------------------------------------------------------
// Posicionamento. O `document` é de mentira (o projeto não usa jsdom): só o
// que o place() toca. O ponto sensível é o zoom de "Tamanho do texto"
// (html.text-small/large). Os espaços abaixo NÃO são chute — foram medidos no
// Chrome com zoom .9: getBoundingClientRect() e clientWidth/Height vêm em
// espaço visual (clientHeight == innerHeight), e só o style.top/left que
// escrevemos é lido em espaço local.
const VIEW_W = 390, VIEW_H = 844;

// `rect` é sempre o que o browser devolveria: espaço VISUAL.
const fakeEl = (cls, rect, zoom) => ({
  className: cls, dataset: {}, attrs: {}, zoom,
  style: { setProperty(k, v) { this[k] = v; } },
  classList: {
    _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
    contains(c) { return this._s.has(c); },
  },
  parentElement: null,
  setAttribute(k, v) { this.attrs[k] = v; },
  getAttribute(k) { return this.attrs[k]; },
  remove() { this.parentElement = null; },
  closest(sel) { return sel === '.info-btn' && this.className === 'info-btn' ? this : null; },
  getBoundingClientRect() { return this.rect; },
  rect,
});

// Monta um documento com `zoom` no <html> e devolve o disparador de clique.
const fakeDoc = (zoom = 1, popRectVisual = { width: 240, height: 90 }) => {
  const html = fakeEl('html', {}, String(zoom));
  const body = fakeEl('body', {}, '1');
  body.parentElement = html;
  const listeners = {};
  const doc = {
    // Espaço VISUAL: o zoom do <html> não altera clientWidth/Height.
    documentElement: { clientWidth: VIEW_W, clientHeight: VIEW_H },
    body: Object.assign(body, {
      children: [],
      appendChild(el) { el.parentElement = body; this.children.push(el); },
    }),
    defaultView: {
      addEventListener() {},
      getComputedStyle: (el) => ({ zoom: el.zoom }),
    },
    createElement: () => fakeEl('', { ...popRectVisual, left: 0, top: 0, bottom: 0 }),
    addEventListener(type, fn, opts) {
      const key = `${type}${opts === true || opts?.capture ? ':capture' : ''}`;
      (listeners[key] ||= []).push(fn);
    },
  };
  mountInfoPopover(doc);
  return {
    doc,
    click: (target) => listeners['click:capture']
      .forEach(fn => fn({ target, preventDefault() {}, stopPropagation() {} })),
  };
};

const openOn = (zoom, anchorVisual) => {
  const { doc, click } = fakeDoc(zoom);
  const btn = fakeEl('info-btn', anchorVisual);
  btn.dataset.info = 'texto';
  click(btn);
  return { pop: doc.body.children[0], btn };
};

describe('posicionamento do balão', () => {
  // Âncora bem no meio da tela: cabe embaixo em qualquer zoom.
  const anchorAt = (topVisual) => ({
    left: 200, top: topVisual, right: 230, bottom: topVisual + 30, width: 30, height: 30,
  });

  it('sem zoom: abre logo abaixo do "i", centralizado nele', () => {
    const { pop } = openOn(1, anchorAt(100));
    expect(pop.style.top).toBe('140px');          // 130 (bottom) + 10 (gap)
    expect(pop.style.left).toBe('95px');          // 215 (centro) - 120 (metade)
    expect(pop.style['--arrow-x']).toBe('120px'); // seta no centro do balão
    expect(pop.classList.contains('above')).toBe(false);
  });

  it('texto pequeno (zoom .9): posição em espaço local, não visual', () => {
    const { pop } = openOn(0.9, anchorAt(100));
    // Local = visual / .9 → bottom 130/.9 = 144.44; + gap 10 = 154.44
    expect(parseFloat(pop.style.top)).toBeCloseTo(154.44, 1);
    // Verificação independente: de volta pro espaço visual (× zoom), o topo do
    // balão tem que cair exatamente um gap abaixo do "i" — que é o que o olho vê.
    expect(parseFloat(pop.style.top) * 0.9).toBeCloseTo(130 + 10 * 0.9, 1);
  });

  it('texto grande (zoom 1.1): idem, pro outro lado', () => {
    const { pop } = openOn(1.1, anchorAt(100));
    expect(parseFloat(pop.style.top)).toBeCloseTo(128.18, 1); // (130/1.1) + 10
    expect(parseFloat(pop.style.top) * 1.1).toBeCloseTo(130 + 10 * 1.1, 1);
  });

  it('com zoom, a seta continua apontando pro centro do "i"', () => {
    for (const z of [1, 0.9, 1.1]) {
      const { pop } = openOn(z, anchorAt(100));
      const left = parseFloat(pop.style.left);
      const arrow = parseFloat(pop.style['--arrow-x']);
      // (borda esquerda + seta) × zoom tem que bater com o centro visual do "i".
      expect((left + arrow) * z).toBeCloseTo(215, 1);
    }
  });

  it('vira pra cima no rodapé, em qualquer zoom', () => {
    for (const z of [1, 0.9, 1.1]) {
      const { pop } = openOn(z, anchorAt(800));
      expect(pop.classList.contains('above')).toBe(true);
      // Base do balão = topo do "i" menos um gap, de volta no espaço visual.
      const bottomVisual = (parseFloat(pop.style.top) + 90 / z) * z;
      expect(bottomVisual).toBeCloseTo(800 - 10 * z, 1);
    }
  });

  it('não vaza pela borda da tela, em qualquer zoom', () => {
    for (const z of [1, 0.9, 1.1]) {
      const encostado = { left: 355, top: 300, right: 385, bottom: 330, width: 30, height: 30 };
      const { pop } = openOn(z, encostado);
      const leftVisual = parseFloat(pop.style.left) * z;
      expect(leftVisual).toBeGreaterThanOrEqual(12 * z - 0.01);
      expect(leftVisual + 240).toBeLessThanOrEqual(VIEW_W - 12 * z + 0.01);
    }
  });
});
