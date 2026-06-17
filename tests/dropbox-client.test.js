import { describe, it, expect } from 'vitest';
import {
  b64url,
  randomVerifier,
  sha256B64,
  buildAuthURL,
} from '../src/sync/dropbox-client.js';

describe('b64url', () => {
  it('codifica buffer sem chars não-URL-safe', () => {
    const buf = new Uint8Array([255, 255, 255]).buffer;
    const out = b64url(buf);
    expect(out).not.toMatch(/[+/=]/);
  });
  it('round-trip para string simples', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(b64url(buf)).toBe('aGVsbG8');
  });
});

describe('randomVerifier', () => {
  it('gera string base64url do tamanho esperado', () => {
    const v = randomVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes em base64url → ~43 chars
    expect(v.length).toBeGreaterThanOrEqual(40);
    expect(v.length).toBeLessThanOrEqual(50);
  });
  it('verifiers consecutivos diferem', () => {
    expect(randomVerifier()).not.toBe(randomVerifier());
  });
});

describe('sha256B64', () => {
  it('hash conhecido de "abc"', async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    // base64url do hash binário:
    const expected = 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0';
    expect(await sha256B64('abc')).toBe(expected);
  });
  it('strings diferentes → hashes diferentes', async () => {
    const a = await sha256B64('hello');
    const b = await sha256B64('world');
    expect(a).not.toBe(b);
  });
});

describe('buildAuthURL', () => {
  it('inclui parâmetros PKCE + offline + redirect', () => {
    const url = buildAuthURL({
      appKey: 'XYZ',
      redirectUri: 'https://app.example.com/',
      challenge: 'abc123',
    });
    expect(url).toMatch(/^https:\/\/www\.dropbox\.com\/oauth2\/authorize\?/);
    expect(url).toMatch(/client_id=XYZ/);
    expect(url).toMatch(/code_challenge=abc123/);
    expect(url).toMatch(/code_challenge_method=S256/);
    expect(url).toMatch(/token_access_type=offline/);
    expect(url).toMatch(/response_type=code/);
    expect(url).toMatch(/redirect_uri=https%3A%2F%2Fapp\.example\.com%2F/);
  });
});
