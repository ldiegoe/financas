// Helpers de parsing/conversão (puros). Inclui calculadora pra campos de
// valor: "48,90 + 12 + 7,50" -> 6840 centavos.

// Detecta se a string parece expressão (operador entre operandos).
// Negativos sozinhos ("-5") NÃO contam — só dígito/parêntese seguido de "-".
export const looksLikeExpression = (s) => /[+*/()]/.test(s) || /[\d)]\s*-/.test(s);

// Avalia expressão tipo "48,90 + 12 + 7,50" → 6840 (centavos).
// Normaliza ponto/vírgula (BR), valida com whitelist e usa Function (não eval)
// já com a string segura: só dígitos, operadores, ponto, parênteses, espaços.
export const evaluateExpression = (raw) => {
  let s = String(raw).replace(/\s+/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
  if (!/^[\d+\-*/().]+$/.test(s)) return 0;
  try {
    const result = Function(`"use strict"; return (${s})`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return 0;
    return Math.max(0, Math.round(result * 100));
  } catch { return 0; }
};

// "1.234,56" / "1234,56" / "1234.56" / "1234" -> integer cents.
// Também aceita expressões com +, -, *, / e parênteses: "48,90+12+7,50" → 6840.
export const parseAmount = (s) => {
  if (s == null || s === '') return 0;
  let str = String(s).trim().replace(/\s/g, '');
  if (looksLikeExpression(str)) return evaluateExpression(str);
  if (str.includes(',')) {
    // pt-BR: vírgula é decimal, ponto é separador de milhar
    str = str.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(str);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
};

// "a, b , c" -> ["a", "b", "c"] (dedupado, sem strings vazias)
export const parseTags = (s) => {
  if (!s) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(s).split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
};

// "YYYY-MM-DD" -> Date local (à meia-noite). Útil pra evitar TZ shift do
// `new Date("YYYY-MM-DD")` (UTC).
export const isoToDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// "YYYY-MM-DD" do dia de hoje no fuso local.
export const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
