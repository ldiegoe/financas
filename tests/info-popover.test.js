import { describe, it, expect } from 'vitest';
import { infoBtn } from '../src/ui/info-popover.js';

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
