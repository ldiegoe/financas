// Trava mecânica do precache do service worker.
//
// A regra "todo módulo novo de src/ entra na lista ASSETS do sw.js" estava
// escrita em vários documentos e dependia de alguém lembrar. O sintoma de
// esquecer é caro: o app quebra OFFLINE, só na PWA instalada — não aparece no
// desenvolvimento normal. Este teste transforma a regra em verificação.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ler = (f) => readFileSync(path.join(process.cwd(), f), 'utf8');

// Caminhos de src/ declarados na lista ASSETS do sw.js.
const assetsDoSw = () =>
  [...ler('sw.js').matchAll(/'\.\/(src\/[^']+\.js)'/g)].map((m) => m[1]);

// Módulos de src/ alcançáveis a partir do app.js — segue tanto
// `from './x.js'` quanto `import('./x.js')`. Especificador dinâmico com
// template literal é ignorado de propósito (não resolve estaticamente).
const alcancaveis = () => {
  const vistos = new Set();
  const fila = ['app.js'];
  while (fila.length) {
    const f = fila.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    let src;
    try { src = ler(f); } catch { continue; }
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+\.js)['"]/g)) {
      fila.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
    }
  }
  return [...vistos].filter((f) => f.startsWith('src/')).sort();
};

describe('sw.js — precache', () => {
  it('todo módulo de src/ alcançável pelo app.js está no ASSETS', () => {
    const assets = assetsDoSw();
    // Fora do ASSETS o módulo não é precacheado: a PWA fixada quebra offline.
    expect(alcancaveis().filter((f) => !assets.includes(f))).toEqual([]);
  });

  it('nenhuma entrada de src/ no ASSETS aponta para arquivo inexistente', () => {
    // Só existência: módulos carregados apenas por import() dinâmico (pdf-text,
    // read-file) precisam estar no ASSETS mesmo sem serem alcançados na varredura.
    const inexistentes = assetsDoSw().filter((f) => {
      try { ler(f); return false; } catch { return true; }
    });
    expect(inexistentes).toEqual([]);
  });
});
