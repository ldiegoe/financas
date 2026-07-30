// Leitura de arquivo OFX respeitando o encoding declarado no próprio arquivo.
// O Nubank exporta a FATURA do cartão em windows-1252 e o EXTRATO da conta em
// UTF-8 — ler com o encoding errado corrompe acentos (ç, ã, Ú) em nomes de
// estabelecimento e de pessoas. Detectamos pelo cabeçalho antes de decodificar.
//
// As funções de detecção/decodificação são puras (recebem bytes/texto), o que
// as torna testáveis; só `readTextFile` toca o File (I/O).

// Normaliza um rótulo de encoding pro nome que o TextDecoder entende.
const normalizeLabel = (label) => {
  const l = String(label || '').toLowerCase();
  if (l.includes('utf')) return 'utf-8';
  if (l.includes('1252')) return 'windows-1252';
  if (l.includes('8859') || l.includes('latin')) return 'iso-8859-1';
  return l;
};

// Descobre o encoding a partir do cabeçalho (decodificado como latin1, onde
// 1 byte = 1 caractere, seguro pra ler as tags ASCII do topo).
//   - OFX 2.x / XML: <?xml ... encoding="utf-8"?>
//   - OFX 1.x SGML: linhas `ENCODING:UTF-8` e `CHARSET:1252`
// Sem informação → windows-1252 (USASCII puro decodifica igual, e é o que o
// cartão Nubank usa).
export const detectEncodingFromHeader = (headText) => {
  const head = String(headText || '').slice(0, 2048);
  const xml = head.match(/encoding\s*=\s*["']([\w-]+)["']/i);
  if (xml) return normalizeLabel(xml[1]);

  const enc = (head.match(/ENCODING:\s*([\w-]+)/i) || [])[1];
  if (enc && /utf-?8/i.test(enc)) return 'utf-8';

  const cs = (head.match(/CHARSET:\s*([\w-]+)/i) || [])[1];
  if (cs && !/none/i.test(cs)) {
    const norm = normalizeLabel(cs);
    if (norm) return norm;
  }
  return 'windows-1252';
};

// Decodifica os bytes de um OFX detectando o encoding pelo cabeçalho.
export const decodeOfxBytes = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 2048));
  const enc = detectEncodingFromHeader(head);
  try {
    return new TextDecoder(enc, { fatal: false }).decode(u8);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }
};

// Lê um File/Blob de OFX como texto, com o encoding certo. `forced` permite
// forçar um encoding específico (foge da detecção) se algum dia precisar.
export const readTextFile = async (file, forced) => {
  const buf = await file.arrayBuffer();
  if (forced) {
    try { return new TextDecoder(forced, { fatal: false }).decode(buf); }
    catch { return new TextDecoder('utf-8', { fatal: false }).decode(buf); }
  }
  return decodeOfxBytes(new Uint8Array(buf));
};
