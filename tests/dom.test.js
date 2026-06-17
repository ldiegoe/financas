import { describe, it, expect, vi } from 'vitest';
import { createToast, createSheet } from '../src/ui/dom.js';

// Mock mínimo de Element com as APIs que dom.js usa.
const createMockEl = () => ({
  textContent: '',
  innerHTML: '',
  classList: {
    _classes: new Set(),
    add(c) { this._classes.add(c); },
    remove(c) { this._classes.delete(c); },
    contains(c) { return this._classes.has(c); },
  },
});

describe('createToast', () => {
  it('seta texto e adiciona classe "show"', () => {
    const el = createMockEl();
    const toast = createToast(el);
    toast('Olá');
    expect(el.textContent).toBe('Olá');
    expect(el.classList.contains('show')).toBe(true);
  });
  it('remove "show" depois do timeout', async () => {
    vi.useFakeTimers();
    const el = createMockEl();
    const toast = createToast(el, 100);
    toast('X');
    expect(el.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(150);
    expect(el.classList.contains('show')).toBe(false);
    vi.useRealTimers();
  });
  it('chamadas seguidas resetam o timer (não some no meio)', () => {
    vi.useFakeTimers();
    const el = createMockEl();
    const toast = createToast(el, 1000);
    toast('A');
    vi.advanceTimersByTime(800);
    toast('B');
    vi.advanceTimersByTime(800);
    // Já passaram 1600ms desde 'A', mas só 800ms desde 'B' → ainda "show".
    expect(el.classList.contains('show')).toBe(true);
    expect(el.textContent).toBe('B');
    vi.advanceTimersByTime(300);
    expect(el.classList.contains('show')).toBe(false);
    vi.useRealTimers();
  });
  it('elemento null não quebra', () => {
    expect(() => createToast(null)('x')).not.toThrow();
  });
});

describe('createSheet', () => {
  // Mock root capaz de receber innerHTML e ter querySelector retornando outro mock.
  const createMockRoot = () => {
    const body = { innerHTML: '' };
    const backdrop = {
      dataset: { close: '' },
      addEventListener: vi.fn(),
    };
    return {
      innerHTML: '',
      _body: body,
      _backdrop: backdrop,
      querySelector(sel) {
        if (sel === '.sheet-body') return body;
        if (sel === '[data-close]') return backdrop;
        return null;
      },
    };
  };
  const escape = (s) => String(s);

  it('open seta innerHTML do root e chama contentFn no body', () => {
    const root = createMockRoot();
    const { open } = createSheet(root, { escapeHTML: escape });
    open('Título', () => '<p>conteúdo</p>');
    expect(root.innerHTML).toContain('Título');
    expect(root._body.innerHTML).toBe('<p>conteúdo</p>');
  });
  it('open chama onMount com o body', () => {
    const root = createMockRoot();
    const onMount = vi.fn();
    const { open } = createSheet(root, { escapeHTML: escape });
    open('T', () => '', onMount);
    expect(onMount).toHaveBeenCalledWith(root._body);
  });
  it('close zera o innerHTML', () => {
    const root = createMockRoot();
    const { open, close } = createSheet(root, { escapeHTML: escape });
    open('T', () => 'x');
    expect(root.innerHTML).not.toBe('');
    close();
    expect(root.innerHTML).toBe('');
  });
  it('root null não quebra', () => {
    const { open, close } = createSheet(null, { escapeHTML: escape });
    expect(() => open('T', () => '')).not.toThrow();
    expect(() => close()).not.toThrow();
  });
});
