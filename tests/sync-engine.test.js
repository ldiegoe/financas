import { describe, it, expect } from 'vitest';
import {
  META_FILE_PATH,
  profileFilePath,
  wrapPayload,
  syncRelativeTime,
} from '../src/sync/engine.js';

describe('META_FILE_PATH / profileFilePath', () => {
  it('caminho meta', () => {
    expect(META_FILE_PATH).toBe('/meta.json');
  });
  it('caminho de perfil', () => {
    expect(profileFilePath('abc-123')).toBe('/profile-abc-123.json');
  });
});

describe('wrapPayload', () => {
  it('formato canônico com v/ts/device/payload', () => {
    const out = JSON.parse(wrapPayload({ a: 1 }, 'dev-x', 1234567890));
    expect(out).toEqual({
      v: 1,
      ts: 1234567890,
      device: 'dev-x',
      payload: { a: 1 },
    });
  });
  it('default de `now` usa Date.now', () => {
    const before = Date.now();
    const out = JSON.parse(wrapPayload({}, 'dev'));
    const after = Date.now();
    expect(out.ts).toBeGreaterThanOrEqual(before);
    expect(out.ts).toBeLessThanOrEqual(after);
  });
});

describe('syncRelativeTime', () => {
  const now = new Date(2025, 4, 15, 12, 0, 0).getTime();
  const min = (n) => n * 60_000;
  const hr  = (n) => n * 60 * 60_000;
  const day = (n) => n * 24 * 60 * 60_000;

  it('null/undefined → "—"', () => {
    expect(syncRelativeTime(null, now)).toBe('—');
    expect(syncRelativeTime(undefined, now)).toBe('—');
  });
  it('futuro próximo → "agora"', () => {
    expect(syncRelativeTime(now + 1000, now)).toBe('agora');
  });
  it('< 60s → "agora há pouco"', () => {
    expect(syncRelativeTime(now - 30_000, now)).toBe('agora há pouco');
  });
  it('< 60min → "há N min"', () => {
    expect(syncRelativeTime(now - min(2), now)).toBe('há 2 min');
    expect(syncRelativeTime(now - min(59), now)).toBe('há 59 min');
  });
  it('< 24h → "há N h"', () => {
    expect(syncRelativeTime(now - hr(3), now)).toBe('há 3 h');
    expect(syncRelativeTime(now - hr(23), now)).toBe('há 23 h');
  });
  it('≥ 24h → "há N dia(s)"', () => {
    expect(syncRelativeTime(now - day(1), now)).toBe('há 1 dia');
    expect(syncRelativeTime(now - day(5), now)).toBe('há 5 dias');
  });
});
