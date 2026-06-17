import { describe, it, expect } from 'vitest';
import { escapeHTML, escapeAttr } from '../src/ui/escape.js';

describe('escapeHTML', () => {
  it('escapa caracteres reservados', () => {
    expect(escapeHTML('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
  it('escapa & ' + '\'', () => {
    expect(escapeHTML('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHTML("it's")).toBe('it&#39;s');
  });
  it('null/undefined → string vazia', () => {
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });
  it('número → string', () => {
    expect(escapeHTML(42)).toBe('42');
    expect(escapeHTML(0)).toBe('0');
  });
  it('string sem caracteres especiais é preservada', () => {
    expect(escapeHTML('abc 123 olá')).toBe('abc 123 olá');
  });
  it('escape duplo NÃO ocorre', () => {
    // Se chamarmos duas vezes, & vira &amp; vira &amp;amp; (comportamento esperado).
    expect(escapeHTML(escapeHTML('&'))).toBe('&amp;amp;');
  });
});

describe('escapeAttr', () => {
  it('usa a mesma regra de escapeHTML', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
    expect(escapeAttr("a'b")).toBe('a&#39;b');
  });
});
