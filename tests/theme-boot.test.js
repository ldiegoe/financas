// Trava do tema no boot.
//
// O tema é decidido em DOIS lugares que precisam concordar: o script inline do
// index.html (roda antes do CSS pintar, só pra evitar flash) e o applyTheme()
// do app.js (roda no initApp, a partir do state já com overlay device-wide).
//
// O bug que originou este teste: o script inline lia `financas:v1` — a chave
// LEGADA, congelada desde a migração pra perfis — enquanto o tema passou a
// morar em `financas:device-config`, num objeto PLANO. Resultado: o OLED
// aplicava ao tocar no botão e voltava pro escuro do sistema a cada boot, com
// a opção seguindo marcada em Ajustes. E nada corrigia depois, porque o
// initApp aplicava textSize mas não o tema.
//
// Sintoma caro e invisível no desenvolvimento: só aparece recarregando o app.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ler = (f) => readFileSync(path.join(process.cwd(), f), 'utf8');

const html = ler('index.html');
const appJs = ler('app.js');
const css = ler('app.css');

// O primeiro <script> do <head> é o do tema.
const bootScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const constante = (nome) =>
  appJs.match(new RegExp(`const\\s+${nome}\\s*=\\s*'([^']+)'`))[1];

const KEYS = {
  device:  constante('DEVICE_CONFIG_KEY'),
  profiles: constante('PROFILES_KEY'),
  prefix:  constante('PROFILE_PREFIX'),
  legacy:  constante('LEGACY_KEY'),
};

// Roda o script inline contra um localStorage falso e devolve o valor que ele
// teria posto em data-theme (ou null se não pôs nada).
const temaAplicado = (registros) => {
  const storage = {
    getItem: (k) => (k in registros ? registros[k] : null),
  };
  let aplicado = null;
  const doc = { documentElement: { setAttribute: (k, v) => { if (k === 'data-theme') aplicado = v; } } };
  new Function('localStorage', 'document', bootScript)(storage, doc);
  return aplicado;
};

const json = (o) => JSON.stringify(o);

describe('tema no boot — script inline do index.html', () => {
  it('lê o tema da device-config (fonte de verdade)', () => {
    expect(temaAplicado({ [KEYS.device]: json({ tema: 'oled', textSize: 'normal' }) })).toBe('oled');
  });

  it('a device-config vence a chave legada — a regressão do OLED', () => {
    // Exatamente o estado do bug: legado congelado em 'dark', escolha real
    // 'oled' na device-config. Lendo só o legado, o OLED sumia a cada boot.
    const aplicado = temaAplicado({
      [KEYS.device]: json({ tema: 'oled' }),
      [KEYS.legacy]: json({ config: { tema: 'dark' } }),
    });
    expect(aplicado).toBe('oled');
  });

  it('cai pro state do perfil ativo quando a device-config não tem tema', () => {
    const aplicado = temaAplicado({
      [KEYS.device]: json({ textSize: 'large' }),
      [KEYS.profiles]: json({ list: [{ id: 'p1', name: 'Pessoal' }], current: 'p1' }),
      [`${KEYS.prefix}p1`]: json({ config: { tema: 'light' } }),
    });
    expect(aplicado).toBe('light');
  });

  it('cai pra chave legada quando não há device-config nem perfil', () => {
    expect(temaAplicado({ [KEYS.legacy]: json({ config: { tema: 'dark' } }) })).toBe('dark');
  });

  it('não põe atributo nenhum no tema "system" (segue o sistema operacional)', () => {
    expect(temaAplicado({ [KEYS.device]: json({ tema: 'system' }) })).toBeNull();
    expect(temaAplicado({})).toBeNull();
  });

  it('ignora storage corrompido sem lançar', () => {
    expect(temaAplicado({ [KEYS.device]: '{nao é json', [KEYS.legacy]: 'xxx' })).toBeNull();
  });

  it('usa as mesmas chaves declaradas no app.js, não literais soltos', () => {
    for (const k of Object.values(KEYS)) expect(bootScript).toContain(k);
  });
});

describe('tema no boot — applyTheme', () => {
  it('o initApp aplica o tema, não só o textSize', () => {
    // Sem isto, qualquer divergência do script inline fica sem correção e o
    // tema só volta quando o usuário toca no botão em Ajustes.
    const init = appJs.match(/const initApp = \(\) => \{[\s\S]*?\n\};/)[0];
    expect(init).toMatch(/applyTheme\(state\.config\.tema\)/);
  });

  it('script inline, applyTheme e CSS aceitam exatamente os mesmos temas', () => {
    const temasDe = (txt) => [...txt.matchAll(/'(light|dark|oled)'/g)].map((m) => m[1]);
    const doApply = new Set(temasDe(appJs.match(/const applyTheme[\s\S]*?\n\};/)[0]));
    const doBoot = new Set(temasDe(bootScript));
    // No CSS o claro é o :root base, então ele só aparece dentro do :not().
    const doCss = new Set([...css.matchAll(/data-theme="(\w+)"/g)].map((m) => m[1]));

    expect([...doBoot].sort()).toEqual([...doApply].sort());
    expect([...doCss].sort()).toEqual([...doApply].sort());
  });
});
