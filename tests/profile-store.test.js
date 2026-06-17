import { describe, it, expect } from 'vitest';
import { createProfileStore, initialMeta } from '../src/storage/profile-store.js';
import { createMemoryStorage } from './_helpers.js';

const defaultState = () => ({ version: 1, rendas: [], despesas: [], categorias: [], config: {} });
const make = (initial) => {
  const storage = createMemoryStorage(initial);
  const store = createProfileStore({
    storage,
    profilesKey: 'financas:profiles',
    profilePrefix: 'financas:profile:',
    defaultState,
  });
  return { storage, store };
};

describe('createProfileStore.meta / setMeta', () => {
  it('meta vazia → null', () => {
    const { store } = make();
    expect(store.meta()).toBe(null);
  });
  it('meta corrompida → null', () => {
    const { store } = make({ 'financas:profiles': 'not-json' });
    expect(store.meta()).toBe(null);
  });
  it('round-trip de meta', () => {
    const { store } = make();
    const m = { list: [{ id: 'a', name: 'Pessoal' }], current: 'a' };
    store.setMeta(m);
    expect(store.meta()).toEqual(m);
  });
});

describe('createProfileStore.loadState / saveState', () => {
  it('perfil sem state → defaultState()', () => {
    const { store } = make();
    expect(store.loadState('xyz')).toEqual(defaultState());
  });
  it('round-trip de state', () => {
    const { store } = make();
    const s = { version: 1, rendas: [{ id: 'r1', valor: 100 }], despesas: [], categorias: [], config: { tema: 'dark' } };
    store.saveState('p1', s);
    expect(store.loadState('p1')).toEqual(s);
  });
  it('merge com default em state legado (campos faltantes)', () => {
    const { store } = make({
      'financas:profile:p1': JSON.stringify({ rendas: [{ id: 'r' }] }), // sem outros campos
    });
    const loaded = store.loadState('p1');
    expect(loaded.rendas).toEqual([{ id: 'r' }]);
    expect(loaded.despesas).toEqual([]);
    expect(loaded.config).toEqual({});
  });
  it('JSON corrompido → defaultState()', () => {
    const { store } = make({ 'financas:profile:p1': '{{{' });
    expect(store.loadState('p1')).toEqual(defaultState());
  });
});

describe('createProfileStore.removeState', () => {
  it('remove o state do storage', () => {
    const { store, storage } = make();
    store.saveState('p1', defaultState());
    expect(storage.getItem('financas:profile:p1')).not.toBe(null);
    store.removeState('p1');
    expect(storage.getItem('financas:profile:p1')).toBe(null);
  });
});

describe('initialMeta', () => {
  it('cria meta com 1 perfil ativo', () => {
    let i = 0;
    const uid = () => `id-${++i}`;
    const m = initialMeta(uid);
    expect(m.current).toBe('id-1');
    expect(m.list).toEqual([{ id: 'id-1', name: 'Pessoal' }]);
  });
  it('aceita nome customizado', () => {
    const m = initialMeta(() => 'X', 'Empresa');
    expect(m.list[0].name).toBe('Empresa');
  });
});
