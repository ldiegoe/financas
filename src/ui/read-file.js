// Leitura de arquivo texto respeitando o encoding do banco. OFX do Nubank (e da
// maioria dos bancos BR) vem em windows-1252/latin1 — ler como UTF-8 corromperia
// acentos (ç, ã) em nomes de estabelecimento. Lemos os bytes e decodificamos
// explicitamente. Isolado aqui por ser o único ponto com side effect de I/O.

export const readTextFile = async (file, encoding = 'windows-1252') => {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
};
