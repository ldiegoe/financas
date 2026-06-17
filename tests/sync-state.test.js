import { describe, it, expect } from 'vitest';
import { createSyncStateStore } from '../src/storage/sync-state.js';
import { createMemoryStorage } from './_helpers.js';

const make = (initial) => {
  const storage = createMemoryStorage(initial);
  const store = createSyncStateStore({ storage, key: 'financas:sync' });
  return { storage, store };
};

describe('createSyncStateStore', () => {
  it('load vazio → {}', () => {
    const { store } = make();
    expect(store.load()).toEqual({});
  });
  it('JSON corrompido → {}', () => {
    const { store } = make({ 'financas:sync': '{{{' });
    expect(store.load()).toEqual({});
  });
  it('round-trip', () => {
    const { store } = make();
    const s = {
      provider: 'dropbox',
      refreshToken: 'rt_abc',
      accessToken: 'at_xyz',
      accountEmail: 'a@b',
      autoSync: true,
    };
    store.save(s);
    expect(store.load()).toEqual(s);
  });
  it('save sobrescreve', () => {
    const { store } = make();
    store.save({ a: 1 });
    store.save({ b: 2 });
    expect(store.load()).toEqual({ b: 2 });
  });
  it('clear esvazia o objeto in-place e persiste vazio', () => {
    const { store } = make();
    const s = { provider: 'dropbox', refreshToken: 'rt' };
    store.save(s);
    store.clear(s);
    expect(s).toEqual({});         // limpou in-place
    expect(store.load()).toEqual({}); // limpou storage
  });
});
