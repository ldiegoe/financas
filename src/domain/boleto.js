// Domínio de boletos bancários (linha digitável de cobrança, 47 dígitos).
//
// A ideia central: a linha digitável já carrega o vencimento e o valor dentro
// dela. Então, ao importar um carnê em PDF, não precisamos adivinhar layout —
// basta achar as linhas digitáveis no texto e decodificar o resto por
// aritmética, validando pelos dígitos verificadores (mod 10 por campo + mod 11
// geral). Qualquer sequência de 47 dígitos que não feche os DVs é descartada,
// o que na prática elimina falso positivo (nosso número, CNPJ, etc).
//
// Tudo puro — nenhuma referência ao state global, ao db ou ao DOM.

// Só os dígitos de uma string qualquer.
export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// DV mod 10 usado nos campos 1..3 da linha digitável (pesos 2,1,2,1... da
// direita pra esquerda; dobra >9 subtrai 9).
export const mod10 = (s) => {
  let peso = 2, soma = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    let v = Number(s[i]) * peso;
    if (v > 9) v -= 9;
    soma += v;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
};

// DV geral (mod 11) do código de barras, calculado sobre os 43 dígitos que
// sobram ao remover a própria posição do DV. Resto 0, 10 ou 11 → DV = 1.
export const mod11 = (s) => {
  let peso = 2, soma = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = 11 - (soma % 11);
  return (r === 0 || r === 10 || r === 11) ? 1 : r;
};

// Linha digitável (47) → código de barras (44), reordenando os campos.
export const linhaToBarras = (d) =>
  d.slice(0, 4) + d[32] + d.slice(33) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);

// Fator de vencimento → data. O fator conta dias desde 07/10/1997 (= 1000) e,
// ao estourar 9999 em 21/02/2025, reiniciou em 1000 no dia 22/02/2025. Como o
// mesmo fator existe nos dois ciclos (separados por 9000 dias, ~24,6 anos),
// escolhemos o candidato dentro de uma janela plausível — boleto em carteira é
// sempre recente ou futuro. A janela é [-1 ano, +20 anos]: 21 anos < 24,6, o
// que garante que no máximo um candidato caiba, e ainda cobre carnê longo (um
// de 179 parcelas chega a ~15 anos). Se nenhum couber, fica o mais próximo de
// hoje. Fator 0 significa "sem vencimento" e retorna null.
const CICLO_1 = Date.UTC(1997, 9, 7);
const CICLO_2 = Date.UTC(2025, 1, 22);
const UM_DIA = 86400000;
const JANELA_ANTES = 366 * UM_DIA;
const JANELA_DEPOIS = 20 * 366 * UM_DIA;

export const fatorToVencimento = (fator, hoje = new Date()) => {
  if (!fator || fator < 1000) return null;
  const hojeMs = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const iso = (base) => new Date(base + (fator - 1000) * UM_DIA).toISOString().slice(0, 10);
  const cands = [iso(CICLO_1), iso(CICLO_2)];
  const dentroDaJanela = cands.filter(d => {
    const diff = Date.parse(d) - hojeMs;
    return diff >= -JANELA_ANTES && diff <= JANELA_DEPOIS;
  });
  const pool = dentroDaJanela.length === 1 ? dentroDaJanela : cands;
  return pool.sort((a, b) =>
    Math.abs(Date.parse(a) - hojeMs) - Math.abs(Date.parse(b) - hojeMs))[0];
};

// Formata os 47 dígitos no padrão impresso no boleto.
export const formatLinha = (d) => {
  const s = onlyDigits(d);
  if (s.length !== 47) return d;
  return `${s.slice(0,5)}.${s.slice(5,10)} ${s.slice(10,15)}.${s.slice(15,21)} `
       + `${s.slice(21,26)}.${s.slice(26,32)} ${s[32]} ${s.slice(33)}`;
};

// Decodifica uma linha digitável de cobrança. Retorna null se não tiver 47
// dígitos; caso contrário, um objeto com `valido` refletindo os 4 DVs.
export const parseLinha = (raw, hoje = new Date()) => {
  const d = onlyDigits(raw);
  if (d.length !== 47) return null;
  const c1 = d.slice(0, 9),  dv1 = Number(d[9]);
  const c2 = d.slice(10, 20), dv2 = Number(d[20]);
  const c3 = d.slice(21, 31), dv3 = Number(d[31]);
  const dvGeral = Number(d[32]);
  const c5 = d.slice(33);

  const barras = linhaToBarras(d);
  const valido = mod10(c1) === dv1 && mod10(c2) === dv2 && mod10(c3) === dv3
              && mod11(barras.slice(0, 4) + barras.slice(5)) === dvGeral;

  const fator = Number(c5.slice(0, 4));
  const vencimento = fatorToVencimento(fator, hoje);
  return {
    linha: d,
    banco: d.slice(0, 3),
    valor: Number(c5.slice(4)),   // centavos
    fator,
    vencimento,
    mesRef: vencimento ? vencimento.slice(0, 7) : null,
    valido,
  };
};

// Acha linhas digitáveis num texto solto (o que o pdf.js devolve). Aceita o
// formato impresso (com pontos e espaços) e também 47 dígitos grudados. Os
// lookarounds evitam casar pedaços de números maiores (nosso número, CNPJ).
const RE_LINHA = /(?<!\d)(\d{5})[.\s]?(\d{5})\s?(\d{5})[.\s]?(\d{6})\s?(\d{5})[.\s]?(\d{6})\s?(\d)\s?(\d{14})(?!\d)/g;

// Extrai todos os boletos válidos do texto, sem repetir, ordenados por
// vencimento. Boletos de arrecadação/concessionária (48 dígitos) não casam com
// o padrão e são naturalmente ignorados.
export const extractBoletos = (texto, hoje = new Date()) => {
  const vistos = new Set();
  const out = [];
  for (const m of String(texto || '').matchAll(RE_LINHA)) {
    const b = parseLinha(m.slice(1).join(''), hoje);
    if (!b || !b.valido || !b.vencimento) continue;
    if (vistos.has(b.linha)) continue;
    vistos.add(b.linha);
    out.push(b);
  }
  return out.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
};

// Resumo de um lote importado, pra mostrar antes de confirmar.
export const resumoBoletos = (boletos) => {
  if (boletos.length === 0) return null;
  const valores = [...new Set(boletos.map(b => b.valor))];
  return {
    total: boletos.length,
    de: boletos[0].vencimento,
    ate: boletos[boletos.length - 1].vencimento,
    valor: valores.length === 1 ? valores[0] : null,  // null = valores variados
    valorMin: Math.min(...valores),
    valorMax: Math.max(...valores),
  };
};

// Pontua o quanto uma despesa combina com o lote de boletos, pra sugerir o
// vínculo automaticamente. Peso maior pro valor bater; depois, quantos meses
// dos boletos caem em ocorrências reais da despesa.
export const scoreDespesa = (despesa, boletos, mesesDaDespesa) => {
  if (boletos.length === 0) return 0;
  const meses = new Set(mesesDaDespesa);
  const cobertos = boletos.filter(b => meses.has(b.mesRef)).length;
  const valorBate = boletos.every(b => b.valor === despesa.valor);
  return (valorBate ? 100 : 0) + Math.round((cobertos / boletos.length) * 100);
};

// Funde boletos novos na lista existente. Chave = despesa + mês de referência:
// reimportar o mesmo carnê não duplica, e um PDF novo (parcelas seguintes)
// soma sem tocar no que já existe. `substituir` atualiza quando o código mudou
// (ex.: 2ª via com novo vencimento).
export const mergeBoletos = (existentes, novos, { despesaId, origem, importadoEm, uid }) => {
  const out = [...existentes];
  const idx = new Map(out.map((b, i) => [`${b.despesaId}|${b.mesRef}`, i]));
  let adicionados = 0, atualizados = 0, iguais = 0;

  for (const n of novos) {
    const key = `${despesaId}|${n.mesRef}`;
    const i = idx.get(key);
    const registro = {
      despesaId,
      mesRef: n.mesRef,
      vencimento: n.vencimento,
      linha: n.linha,
      valor: n.valor,
      origem,
      importadoEm,
    };
    if (i === undefined) {
      out.push({ id: uid(), ...registro });
      idx.set(key, out.length - 1);
      adicionados++;
    } else if (out[i].linha !== n.linha) {
      out[i] = { ...out[i], ...registro };
      atualizados++;
    } else {
      iguais++;
    }
  }
  return { boletos: out, adicionados, atualizados, iguais };
};
