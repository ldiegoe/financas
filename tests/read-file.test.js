import { describe, it, expect } from 'vitest';
import { detectEncodingFromHeader, decodeOfxBytes } from '../src/ui/read-file.js';

describe('detectEncodingFromHeader', () => {
  it('OFX 1.x com ENCODING:UTF-8 (extrato Nubank)', () => {
    expect(detectEncodingFromHeader('OFXHEADER:100\nENCODING:UTF-8\nCHARSET:NONE\n')).toBe('utf-8');
  });
  it('OFX 1.x com CHARSET:1252 (fatura Nubank)', () => {
    expect(detectEncodingFromHeader('OFXHEADER:100\nENCODING:USASCII\nCHARSET:1252\n')).toBe('windows-1252');
  });
  it('CHARSET latin/8859 vira iso-8859-1', () => {
    expect(detectEncodingFromHeader('ENCODING:USASCII\nCHARSET:8859-1\n')).toBe('iso-8859-1');
  });
  it('declaração XML (OFX 2.x)', () => {
    expect(detectEncodingFromHeader('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe('iso-8859-1');
  });
  it('sem informação → windows-1252 (default seguro)', () => {
    expect(detectEncodingFromHeader('OFXHEADER:100\nCHARSET:NONE\n')).toBe('windows-1252');
    expect(detectEncodingFromHeader('')).toBe('windows-1252');
  });
});

// Monta bytes com o acento no encoding indicado, pra provar a decodificação.
const bytesLatin1 = (str) => Uint8Array.from([...str].map(c => c.charCodeAt(0)));

describe('decodeOfxBytes', () => {
  it('decodifica extrato UTF-8 sem corromper acentos', () => {
    const texto = 'ENCODING:UTF-8\nCHARSET:NONE\n<OFX><MEMO>Transferência ITAÚ</MEMO></OFX>';
    const bytes = new TextEncoder().encode(texto); // TextEncoder é sempre UTF-8
    expect(decodeOfxBytes(bytes)).toContain('Transferência ITAÚ');
  });

  it('decodifica fatura windows-1252 sem corromper acentos', () => {
    // "Aplicação" com ç=0xE7 e ã=0xE3 (bytes 1252), cabeçalho ASCII.
    const head = 'ENCODING:USASCII\nCHARSET:1252\n<OFX><MEMO>Aplica';
    const bytes = Uint8Array.from([
      ...bytesLatin1(head), 0xE7, 0xE3, 0x6F, // ç ã o
      ...bytesLatin1('</MEMO></OFX>'),
    ]);
    expect(decodeOfxBytes(bytes)).toContain('Aplicação');
  });

  it('NÃO confunde: os mesmos bytes 1252 lidos como UTF-8 corromperiam', () => {
    // Garante que a detecção evita o bug — se caísse em UTF-8, viria caractere
    // de substituição no lugar de "çã".
    const head = 'ENCODING:USASCII\nCHARSET:1252\n<OFX><MEMO>Aplica';
    const bytes = Uint8Array.from([...bytesLatin1(head), 0xE7, 0xE3, 0x6F, ...bytesLatin1('</MEMO></OFX>')]);
    const errado = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    expect(errado).not.toContain('Aplicação');   // prova que o encoding importa
    expect(decodeOfxBytes(bytes)).toContain('Aplicação');
  });
});
