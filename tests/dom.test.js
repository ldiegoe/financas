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

// O sheet entra animado (slideUp) e antes saía como interruptor. Tornar a
// saída assíncrona abre uma corrida real: o app faz `closeSheet(); sheetX()`
// em detalhes.js e categoria-historico.js, então o callback de limpeza do
// sheet ANTIGO chega quando o NOVO já está na tela.
describe('createSheet — saída animada', () => {
  // Root que também responde por '.sheet-backdrop', pra exercitar o caminho
  // animado (o mock do bloco acima devolve null e cai no caminho instantâneo).
  const rootAnimavel = () => {
    const body = { innerHTML: '' };
    const backdrop = { dataset: { close: '' }, addEventListener: vi.fn(), classList: { add: vi.fn() } };
    return {
      innerHTML: '',
      _body: body,
      querySelector(sel) {
        if (sel === '.sheet-body') return body;
        if (sel === '[data-close]' || sel === '.sheet-backdrop') return backdrop;
        return null;
      },
    };
  };
  const escape = (s) => String(s);

  // `leave` falso: guarda o callback pra disparar na hora que o teste quiser.
  const leaveManual = () => {
    const pendentes = [];
    const leave = (els, opts, depois) => pendentes.push({ els, opts, depois });
    return { leave, concluir: () => pendentes.forEach((p) => p.depois()), pendentes };
  };

  it('não limpa antes da animação terminar', () => {
    const root = rootAnimavel();
    const l = leaveManual();
    const { open, close } = createSheet(root, { escapeHTML: escape, leave: l.leave, duracaoSaida: () => 200 });
    open('T', () => 'x');
    close();
    expect(root.innerHTML).not.toBe('');   // ainda saindo
    l.concluir();
    expect(root.innerHTML).toBe('');
  });

  it('marca o backdrop com a classe de saída do sheet', () => {
    const root = rootAnimavel();
    const l = leaveManual();
    const { open, close } = createSheet(root, { escapeHTML: escape, leave: l.leave, duracaoSaida: () => 200 });
    open('T', () => 'x');
    close();
    expect(l.pendentes[0].opts.classe).toBe('sheet-leaving');
  });

  // ESTE é o teste da corrida.
  it('abrir outro sheet durante a saída NÃO apaga o novo', () => {
    const root = rootAnimavel();
    const l = leaveManual();
    const { open, close } = createSheet(root, { escapeHTML: escape, leave: l.leave, duracaoSaida: () => 200 });
    open('Detalhes', () => 'a');
    close();                       // começa a sair
    open('Antecipar', () => 'b');  // `closeSheet(); sheetX()` — o padrão real
    l.concluir();                  // a limpeza do sheet ANTIGO chega agora
    expect(root.innerHTML).toContain('Antecipar');
  });

  it('com movimento desligado limpa na hora, sem animar', () => {
    const root = rootAnimavel();
    const l = leaveManual();
    const { open, close } = createSheet(root, { escapeHTML: escape, leave: l.leave, duracaoSaida: () => 0 });
    open('T', () => 'x');
    close();
    expect(root.innerHTML).toBe('');
    expect(l.pendentes).toHaveLength(0);
  });

  it('sem `leave` injetado limpa na hora (comportamento antigo preservado)', () => {
    const root = rootAnimavel();
    const { open, close } = createSheet(root, { escapeHTML: escape });
    open('T', () => 'x');
    close();
    expect(root.innerHTML).toBe('');
  });

  it('fechar sem nada aberto não quebra', () => {
    const root = rootAnimavel();
    root.querySelector = () => null;
    const l = leaveManual();
    const { close } = createSheet(root, { escapeHTML: escape, leave: l.leave, duracaoSaida: () => 200 });
    expect(() => close()).not.toThrow();
    expect(root.innerHTML).toBe('');
  });
});
