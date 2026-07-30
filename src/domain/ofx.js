// Parser de OFX (Open Financial Exchange) — o formato que os bancos exportam
// pra extrato/fatura. Foco no OFX 1.x SGML (VERSION:102), que é o que o Nubank
// e a maioria dos bancos brasileiros geram. Tudo puro; a leitura/decodificação
// do arquivo (windows-1252) fica na camada de UI.
//
// DESCOBERTA IMPORTANTE (validada com fatura real do Nubank): o FITID NÃO é
// único. Compras internacionais e a linha de IOF associada compartilham o
// mesmo FITID. Então a identidade de deduplicação precisa ser composta
// (fitid + valor + descrição), nunca só o FITID.

// Valor de uma tag folha SGML/XML: <TAG>valor  — para na próxima tag, no
// fechamento </TAG> ou na quebra de linha. Cobre tanto OFX com tags fechadas
// (Nubank) quanto o SGML clássico sem fechamento.
const tagValue = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
};

// "-24.48" / "3327.44" → centavos inteiros COM sinal. OFX usa ponto decimal e
// não tem separador de milhar; ainda assim toleramos vírgula por segurança.
export const parseOfxAmount = (s) => {
  let str = String(s ?? '').trim();
  if (!str) return 0;
  if (str.includes(',') && !str.includes('.')) str = str.replace(',', '.');
  const n = parseFloat(str);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// "20260725000000[-3:BRT]" → "2026-07-25". Ignora hora e fuso: a data contábil
// do lançamento é o que importa. Retorna null se não houver 8 dígitos.
export const parseOfxDate = (s) => {
  const d = String(s ?? '').replace(/[^0-9]/g, '').slice(0, 8);
  if (d.length < 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};

// Extrai " - Parcela X/Y" do fim do MEMO (padrão Nubank). Devolve a descrição
// limpa + os números. Cada mês da fatura traz a parcela daquele mês com FITID
// próprio, então importar mês a mês já registra o fluxo de caixa correto — não
// tentamos reconstruir a parcelada do app a partir disso.
const RE_PARCELA = /\s*[-–]\s*Parcela\s+(\d+)\s*\/\s*(\d+)\s*$/i;
export const extractParcela = (memo) => {
  const s = String(memo || '');
  const m = s.match(RE_PARCELA);
  if (!m) return { descricao: s.trim(), parcelaNum: null, parcelaTotal: null };
  return {
    descricao: s.replace(RE_PARCELA, '').trim(),
    parcelaNum: Number(m[1]),
    parcelaTotal: Number(m[2]),
  };
};

// Normaliza descrição pra comparação (dedup/sugestão): minúsculas, espaços
// colapsados. Preserva o texto original em `descricao` pra exibição.
export const normalizeDesc = (s) =>
  String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Enxuga o MEMO do extrato: os Pix do Nubank vêm com nome + CPF mascarado +
// banco + agência/conta de terceiros ("... - Fulano - •••.xxx-•• - BANCO ...
// Agência: 1 Conta: 123"). Guardamos só até o nome — o resto é ruído (e são
// dados de terceiros que iriam pro Dropbox). Descrições sem esse padrão
// (boleto, "Aplicação RDB") passam intactas.
export const limparDescricao = (memo) => {
  let s = String(memo || '').trim();
  s = s.replace(/\s*-\s*•••.*$/s, '');                             // CPF mascarado em diante
  s = s.replace(/\s*-\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}.*$/s, ''); // CNPJ em diante
  s = s.replace(/\s*-?\s*(ag[êe]ncia|conta)\s*:.*$/is, '');        // sobra de agência/conta
  return s.replace(/\s+/g, ' ').trim();
};

// Identidade de deduplicação — robusta à colisão de FITID do Nubank.
export const dedupKey = (t) =>
  `${t.fitid}|${t.valorSigned}|${normalizeDesc(t.descricao)}`;

// Quebra o texto nos blocos <STMTTRN>. Aceita blocos fechados (</STMTTRN>) e o
// SGML sem fechamento (corta no próximo <STMTTRN> ou no fim da lista).
const stmtBlocks = (text) => {
  if (/<\/STMTTRN>/i.test(text)) {
    return text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  }
  const corpo = (text.match(/<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i) || [, text])[1];
  return (corpo.split(/<STMTTRN>/i).slice(1)).map(b => `<STMTTRN>${b}`);
};

// Parseia um bloco de transação. `tipo` é DEBIT/CREDIT; `valorSigned` mantém o
// sinal do OFX (compra no cartão vem negativa, pagamento/estorno positivo);
// `valor` é o absoluto em centavos, pronto pra virar despesa.
const parseStmtTrn = (bloco) => {
  const valorSigned = parseOfxAmount(tagValue(bloco, 'TRNAMT'));
  const memo = tagValue(bloco, 'MEMO') || tagValue(bloco, 'NAME');
  const { descricao, parcelaNum, parcelaTotal } = extractParcela(memo);
  const data = parseOfxDate(tagValue(bloco, 'DTPOSTED'));
  return {
    fitid: tagValue(bloco, 'FITID'),
    tipo: tagValue(bloco, 'TRNTYPE').toUpperCase(),
    data,
    mesRef: data ? data.slice(0, 7) : null,
    valorSigned,
    valor: Math.abs(valorSigned),
    descricao: descricao || memo || 'Lançamento',
    parcelaNum,
    parcelaTotal,
    // Compra (débito) vira despesa; pagamento/estorno (crédito) não.
    ehDespesa: valorSigned < 0,
  };
};

// Parseia o OFX inteiro. Retorna metadados do banco + lista de transações.
// Não filtra nem classifica além do essencial — isso é papel da revisão.
export const parseOfx = (text) => {
  const t = String(text || '');
  const transacoes = stmtBlocks(t)
    .map(parseStmtTrn)
    .filter(x => x.data && x.valorSigned !== 0);

  // Tipo de conta: cartão (CREDITCARDMSGSRSV1/CCSTMTRS) x conta corrente
  // (BANKMSGSRSV1/STMTRS, ACCTTYPE CHECKING). Muda o tratamento na importação
  // (fatura tem vencimento; extrato tem receitas e transferências).
  let tipoConta = null;
  if (/<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(t)) tipoConta = 'creditcard';
  else if (/<BANKMSGSRSV1>|<STMTRS>|<ACCTTYPE>\s*CHECKING/i.test(t)) tipoConta = 'checking';

  const datas = transacoes.map(x => x.data).sort();
  return {
    banco: tagValue(t, 'ORG') || null,
    moeda: tagValue(t, 'CURDEF') || 'BRL',
    conta: tagValue(t, 'ACCTID') || null,
    tipoConta,
    saldo: /<BALAMT>/i.test(t) ? parseOfxAmount(tagValue(t, 'BALAMT')) : null,
    de: datas[0] || null,
    ate: datas[datas.length - 1] || null,
    // Período do extrato/fatura. Em fatura de cartão, `fechamento` (DTEND) é a
    // data de corte — útil como base pro vencimento. O OFX NÃO traz o
    // vencimento (data de pagamento da fatura), então isso o usuário informa.
    abertura: parseOfxDate(tagValue(t, 'DTSTART')),
    fechamento: parseOfxDate(tagValue(t, 'DTEND')),
    transacoes,
  };
};
