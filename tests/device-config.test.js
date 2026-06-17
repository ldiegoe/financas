import { describe, it, expect } from 'vitest';
import { createDeviceConfig, DEVICE_CONFIG_KEYS } from '../src/storage/device-config.js';
import { createMemoryStorage } from './_helpers.js';

const make = (initial) => {
  const storage = createMemoryStorage(initial);
  const cfg = createDeviceConfig({ storage, key: 'financas:device-config' });
  return { storage, cfg };
};

describe('DEVICE_CONFIG_KEYS', () => {
  it('inclui chaves principais conhecidas', () => {
    expect(DEVICE_CONFIG_KEYS).toContain('tema');
    expect(DEVICE_CONFIG_KEYS).toContain('valuesHidden');
    expect(DEVICE_CONFIG_KEYS).toContain('notifEnabled');
    expect(DEVICE_CONFIG_KEYS).toContain('dashOrder');
  });
});

describe('createDeviceConfig', () => {
  it('get vazio quando nada salvo', () => {
    const { cfg } = make();
    expect(cfg.get()).toEqual({});
  });
  it('get com JSON corrompido → {}', () => {
    const { cfg } = make({ 'financas:device-config': 'oops' });
    expect(cfg.get()).toEqual({});
  });
  it('update mescla sem perder chaves anteriores', () => {
    const { cfg } = make();
    cfg.update({ tema: 'dark' });
    cfg.update({ textSize: 'large' });
    expect(cfg.get()).toEqual({ tema: 'dark', textSize: 'large' });
  });
  it('update sobrescreve chaves existentes', () => {
    const { cfg } = make();
    cfg.update({ tema: 'dark' });
    cfg.update({ tema: 'light' });
    expect(cfg.get().tema).toBe('light');
  });
});

describe('createDeviceConfig.applyOverlay', () => {
  it('sobrepõe device-config nas chaves device-wide do state.config', () => {
    const { cfg } = make();
    cfg.update({ tema: 'oled', valuesHidden: true });
    const state = { config: { tema: 'system', moeda: 'BRL' } };
    cfg.applyOverlay(state);
    expect(state.config.tema).toBe('oled');
    expect(state.config.valuesHidden).toBe(true);
    expect(state.config.moeda).toBe('BRL'); // preserva chaves NÃO device-wide
  });
  it('chaves NÃO listadas em DEVICE_CONFIG_KEYS são ignoradas', () => {
    const { cfg } = make();
    cfg.update({ algumaNaoDeviceWide: 'X' });
    const state = { config: { moeda: 'BRL' } };
    cfg.applyOverlay(state);
    expect(state.config.algumaNaoDeviceWide).toBeUndefined();
  });
  it('valores undefined no device-config não sobrescrevem', () => {
    const { cfg, storage } = make();
    // Simula um device-config que tem a chave mas como null
    storage.setItem('financas:device-config', JSON.stringify({ tema: 'dark' }));
    const state = { config: { tema: 'light', valuesHidden: false } };
    cfg.applyOverlay(state);
    expect(state.config.tema).toBe('dark');
    expect(state.config.valuesHidden).toBe(false); // não foi sobrescrita
  });
});
