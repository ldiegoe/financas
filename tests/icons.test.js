import { describe, it, expect } from 'vitest';
import { ICONS, icon } from '../src/ui/icons.js';

describe('ICONS', () => {
  it('contém ícones da tabbar', () => {
    expect(ICONS.dashboard).toBeDefined();
    expect(ICONS.wallet).toBeDefined();
    expect(ICONS.card).toBeDefined();
    expect(ICONS.tag).toBeDefined();
    expect(ICONS.settings).toBeDefined();
  });
  it('contém ícones de feature', () => {
    expect(ICONS.trending).toBeDefined();
    expect(ICONS.target).toBeDefined();
    expect(ICONS.filter).toBeDefined();
    expect(ICONS.clock).toBeDefined();
    expect(ICONS.sparkles).toBeDefined();
  });
});

describe('icon()', () => {
  it('envelopa o path no SVG canônico', () => {
    const out = icon('target');
    expect(out).toMatch(/^<svg viewBox="0 0 24 24"/);
    expect(out).toMatch(/<\/svg>$/);
    expect(out).toMatch(/stroke="currentColor"/);
    expect(out).toMatch(/aria-hidden="true"/);
    expect(out).toContain(ICONS.target);
  });
  it('usa size 22 por padrão', () => {
    expect(icon('target')).toMatch(/width="22"/);
    expect(icon('target')).toMatch(/height="22"/);
  });
  it('aceita size customizado', () => {
    const out = icon('target', 48);
    expect(out).toMatch(/width="48"/);
    expect(out).toMatch(/height="48"/);
  });
  it('nome desconhecido devolve SVG vazio (sem path)', () => {
    const out = icon('nao-existe');
    expect(out).toMatch(/^<svg /);
    expect(out).toMatch(/><\/svg>$/);
  });
});
