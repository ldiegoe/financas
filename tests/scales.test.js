// Trava das escalas visuais do :root.
//
// Espaçamento, tipografia, raio e movimento já tinham escala. Opacidade e
// tracking não tinham: eram NOVE forças de esmaecimento (.3 .35 .4 .45 .5 .55
// .6 .62 .7) e SEIS trackings para dois usos. Passos vizinhos são
// indistinguíveis a olho — ninguém percebe ao escrever, e é justamente por
// isso que voltam sozinhos. O desalinhamento só aparece acumulado.
//
// O motion.test.js faz o mesmo para duração e easing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(process.cwd(), 'app.css'), 'utf8');

// As definições vivem no :root; o resto do arquivo é que precisa consumi-las.
const fimDoRoot = css.indexOf('* { box-sizing');
const raiz = css.slice(0, fimDoRoot);
const corpo = css.slice(fimDoRoot);

const declaracoes = (prop) =>
  [...corpo.matchAll(new RegExp(`${prop}:\\s*([^;}]+)[;}]`, 'g'))].map((m) => m[1].trim());

describe('opacidade', () => {
  it('a escala tem exatamente três forças', () => {
    const tokens = [...raiz.matchAll(/--o-([\w-]+):/g)].map((m) => m[1]).sort();
    expect(tokens).toEqual(['faint', 'muted', 'soft']);
  });

  it('nenhuma opacidade crua fora do :root', () => {
    // 0 e 1 não são "força de esmaecimento", são ligado/desligado — aparecem
    // nos keyframes de entrada e saída e não pertencem à escala.
    const cruas = declaracoes('opacity')
      .filter((v) => /^[\d.]+$/.test(v))
      .filter((v) => Number(v) > 0 && Number(v) < 1);
    expect(cruas).toEqual([]);
  });

  it('toda opacidade usada vem da escala', () => {
    const usados = new Set([...corpo.matchAll(/var\(\s*(--o-[\w-]+)/g)].map((m) => m[1]));
    const definidos = new Set([...raiz.matchAll(/(--o-[\w-]+):/g)].map((m) => m[1]));
    expect([...usados].filter((t) => !definidos.has(t))).toEqual([]);
  });
});

describe('tracking (letter-spacing)', () => {
  it('a escala tem exatamente dois valores: apertar número, abrir caixa alta', () => {
    const tokens = [...raiz.matchAll(/--track-([\w-]+):/g)].map((m) => m[1]).sort();
    expect(tokens).toEqual(['caps', 'tight']);
  });

  it('nenhum letter-spacing cru fora do :root', () => {
    const cruas = declaracoes('letter-spacing').filter((v) => /-?[\d.]+px/.test(v));
    expect(cruas).toEqual([]);
  });
});

describe('tipografia', () => {
  // A escala do :root permite sair dela "com um bom motivo". A exceção é
  // nomeada aqui: se aparecer uma segunda, o teste obriga a justificá-la.
  const EXCECOES_FONT_SIZE = ['10.5px'];   // rótulo da tabbar — ver comentário na regra

  it('font-size cru só nas exceções declaradas', () => {
    const cruas = declaracoes('font-size')
      .filter((v) => /^[\d.]+px$/.test(v))
      .filter((v) => !EXCECOES_FONT_SIZE.includes(v));
    expect(cruas).toEqual([]);
  });

  it('a exceção da tabbar continua existindo e documentada', () => {
    // Se alguém a remover, o teste avisa pra tirar da lista também — lista de
    // exceção que sobrevive ao caso vira mentira.
    expect(corpo).toContain('font-size: 10.5px');
    expect(corpo).toMatch(/ÚNICO font-size fora da escala[\s\S]{0,400}font-size: 10\.5px/);
  });

  it('os pesos ficam em 400/500/600/700', () => {
    // O 800 aparecia UMA vez no app inteiro (.hs-num). Peso exclusivo pra um
    // número só é ruído: não cria hierarquia, cria exceção.
    const pesos = [...new Set(declaracoes('font-weight'))].sort();
    expect(pesos.filter((p) => !['400', '500', '600', '700'].includes(p))).toEqual([]);
  });
});

describe('raio', () => {
  it('nenhum border-radius cru fora do :root (50% de círculo é permitido)', () => {
    const cruas = declaracoes('border-radius').filter((v) => /^[\d.]+px$/.test(v));
    expect(cruas).toEqual([]);
  });
});
