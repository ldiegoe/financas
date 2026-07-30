// Camada de revisão da importação: pega as transações do parser + o que já
// existe no app e anota cada linha (nova / duplicata / crédito / possível
// lançamento manual), sugere categoria e diz o que entra por padrão. Nada é
// gravado aqui — só decidido. Puro e testável.

import { dedupKey, normalizeDesc, limparDescricao } from './ofx.js';

// Mapa "descrição normalizada → categoriaId" a partir das despesas existentes
// (inclui as de importações anteriores). A última ocorrência vence, então a
// categorização mais recente do usuário é a que sugere.
export const buildCategoriaHints = (despesas) => {
  const m = new Map();
  for (const d of despesas) {
    if (!d.categoriaId || !d.descricao) continue;
    m.set(normalizeDesc(d.descricao), d.categoriaId);
  }
  return m;
};

// Extrai a parte da descrição normalizada de uma dedupKey — fallback pra
// despesas importadas antes de existir o campo `srcDesc`. Robusto aos dois
// formatos de chave: o antigo "fitid|valor|desc" e o novo "fitid|valor|desc|
// parc" (a parcela, quando presente, é o último segmento, tipo "3/10" ou "/").
const memoFromDedup = (k) => {
  const parts = String(k || '').split('|');
  if (parts.length < 3) return '';
  const last = parts[parts.length - 1];
  const temParcela = /^\d*\/\d*$/.test(last);
  return parts.slice(2, temParcela ? -1 : parts.length).join('|');
};

// Mapa "origem do banco (descrição normalizada) → nome salvo". Serve pra herdar
// o nome que o usuário deu numa importação anterior: se ele renomeou a despesa
// mês passado, a deste mês já vem com o mesmo nome. Chaveia pela descrição
// ORIGINAL do banco (estável entre meses), não pelo nome editado. A última
// importação vence (nome mais recente).
export const buildNomeHints = (despesas) => {
  const m = new Map();
  for (const d of despesas) {
    const key = d.srcDesc || memoFromDedup(d.dedupKey);
    if (!key || !d.descricao) continue;
    m.set(key, d.descricao);
  }
  return m;
};

// "Chave de compra": identidade estável entre meses = dedupKey SEM a parcela
// (fitid|valor|descrição). Numa parcelada, o Nubank repete o FITID e o valor
// todo mês, mudando só a parcela — então esta chave casa julho com agosto. E,
// por incluir o valor, NÃO colide com o IOF, que compartilha FITID com a
// compra internacional mas tem valor diferente.
export const purchaseKey = (t) =>
  `${t.fitid}|${t.valorSigned}|${normalizeDesc(t.descricao)}`;

const purchaseKeyFromDedup = (k) => {
  const parts = String(k || '').split('|');
  if (parts.length < 3) return '';
  const last = parts[parts.length - 1];
  const temParcela = /^\d*\/\d*$/.test(last);
  return parts.slice(0, temParcela ? -1 : parts.length).join('|');
};

// Herança de TAGS de importações anteriores. Chaveia por:
//  - chave de compra (fitid+valor+desc) → pega a MESMA compra parcelada mês a
//    mês, com precisão (sem colidir com IOF);
//  - descrição de origem (memo) → cobre recorrentes cujo FITID muda a cada mês
//    (assinaturas). A última importação com tags vence.
export const buildTagHints = (despesas) => {
  const byPurchase = new Map();
  const bySrc = new Map();
  for (const d of despesas) {
    if (!d.tags || d.tags.length === 0) continue;
    const pk = purchaseKeyFromDedup(d.dedupKey);
    if (pk) byPurchase.set(pk, d.tags);
    const src = d.srcDesc || memoFromDedup(d.dedupKey);
    if (src) bySrc.set(src, d.tags);
  }
  return { byPurchase, bySrc };
};

const herdarTags = (tagHints, txn) => {
  const t = tagHints.byPurchase.get(purchaseKey(txn))
         || tagHints.bySrc.get(normalizeDesc(txn.descricao));
  return t ? [...t] : [];
};

// motivo de cada linha:
//   'nova'          — despesa inédita, entra marcada
//   'duplicata'     — já importada antes (dedupKey existe), entra desmarcada
//   'duplicata-lote'— repetida dentro do próprio arquivo, entra desmarcada
//   'credito'       — pagamento/estorno (não é gasto), entra desmarcada
//   'manual'        — bate data+valor com um lançamento manual; entra marcada
//                     mas sinalizada pra conferência
export const annotateImport = ({ transacoes, despesas = [], categorias = [] }) => {
  const jaImportadas = new Set(despesas.map(d => d.dedupKey).filter(Boolean));
  const catValidas = new Set(categorias.map(c => c.id));
  const hints = buildCategoriaHints(despesas);
  const nomeHints = buildNomeHints(despesas);
  const tagHints = buildTagHints(despesas);
  // Lançamentos digitados na mão (sem dedupKey) indexados por data+valor.
  const manuais = new Set(
    despesas.filter(d => !d.dedupKey).map(d => `${d.data}|${d.valor}`)
  );

  const vistosNoLote = new Set();
  const rows = transacoes.map(txn => {
    const key = dedupKey(txn);
    let motivo;
    if (!txn.ehDespesa) {
      motivo = 'credito';
    } else if (jaImportadas.has(key)) {
      motivo = 'duplicata';
    } else if (vistosNoLote.has(key)) {
      motivo = 'duplicata-lote';
    } else if (manuais.has(`${txn.data}|${txn.valor}`)) {
      motivo = 'manual';
    } else {
      motivo = 'nova';
    }
    if (txn.ehDespesa) vistosNoLote.add(key);

    const srcKey = normalizeDesc(txn.descricao);
    const sugestao = hints.get(srcKey);
    const categoriaId = (sugestao && catValidas.has(sugestao)) ? sugestao : null;
    const incluir = motivo === 'nova' || motivo === 'manual';
    // `descricao` e `tags` sao editaveis na tela de revisao (o dedupKey fica
    // congelado no dado original do banco, entao renomear nao afeta a dedup).
    // Herda o nome e as tags salvos numa importacao anterior, se houver.
    const descricao = nomeHints.get(srcKey) || txn.descricao;
    const tags = herdarTags(tagHints, txn);
    return { txn, dedupKey: key, motivo, categoriaId, incluir, descricao, tags };
  });

  return { rows, resumo: resumoRows(rows) };
};

// Resumo agregado — recalculável a qualquer momento (os toggles da tela mexem
// em row.incluir e chamam isto de novo).
export const resumoRows = (rows) => ({
  total: rows.length,
  incluir: rows.filter(r => r.incluir).length,
  novas: rows.filter(r => r.motivo === 'nova').length,
  duplicatas: rows.filter(r => r.motivo === 'duplicata' || r.motivo === 'duplicata-lote').length,
  creditos: rows.filter(r => r.motivo === 'credito').length,
  manuais: rows.filter(r => r.motivo === 'manual').length,
  somaIncluir: rows.filter(r => r.incluir).reduce((s, r) => s + r.txn.valor, 0),
});

// Converte as linhas marcadas em objetos de despesa prontos pro db. Cada uma
// carrega o vínculo de dedup (dedupKey/fitid) e o lote (importId) pra permitir
// desfazer. `pago: false` — a despesa nasce pendente e o usuário marca como
// paga quando quitar a fatura. Usa a descrição/tags editadas na revisão.
//
// `vencimento` (opcional): no cartão de crédito, o dinheiro só sai no
// vencimento da fatura, não na data da compra. Quando informado, as despesas
// (débitos) recebem `data = vencimento` e a data da compra é preservada em
// `criadoEm`. Créditos/estornos, se incluídos, mantêm a própria data.
//
// `pago`: na fatura, a despesa nasce pendente (você paga depois) → false. No
// extrato, o dinheiro já saiu (Pix, boleto) → true.
export const rowsToDespesas = (rows, { importId, fonte, importadoEm, vencimento = null, pago = false }) =>
  rows.filter(r => r.incluir && (r.tipo == null || r.tipo === 'despesa')).map(r => {
    const noVenc = !!vencimento && r.txn.ehDespesa;
    return {
      // Fallback pro texto do banco se o usuário apagou a descrição.
      descricao: (r.descricao != null && String(r.descricao).trim())
        ? String(r.descricao).trim() : r.txn.descricao,
      valor: r.txn.valor,
      data: noVenc ? vencimento : r.txn.data,
      criadoEm: noVenc ? r.txn.data : importadoEm,
      categoriaId: r.categoriaId || null,
      recorrente: false,
      parcelas: 1,
      // Selo informativo "X/Y" quando a compra é parcelada na fatura. NÃO vira
      // uma parcelada de verdade (cada mês entra avulso, exato) — é só rótulo.
      parcelaImport: r.txn.parcelaTotal ? `${r.txn.parcelaNum}/${r.txn.parcelaTotal}` : null,
      tags: r.tags || [],
      pago: !!pago,
      fitid: r.txn.fitid,
      dedupKey: r.dedupKey,
      // Descrição original do banco (normalizada), estável entre meses. Permite
      // que a próxima importação herde o nome que o usuário deu a esta.
      srcDesc: normalizeDesc(r.txn.descricao),
      importId,
      fonte,
    };
  });

// ====================== Extrato de conta (checking) ========================
// Diferente da fatura: o extrato mistura despesas, receitas e transferências
// internas (caixinha/RDB, pagamento de fatura). Estas últimas NÃO são gasto
// nem renda — entram desmarcadas pra não distorcer os totais nem duplicar o
// que já veio do cartão/carnê.

const RE_TRANSFER = /aplica[çc][ãa]o rdb|resgate rdb|pagamento de fatura/i;

// Classifica uma transação do extrato pelo texto e pelo sinal.
export const classifyExtrato = (txn) => {
  if (RE_TRANSFER.test(txn.descricao || '')) return 'transferencia';
  return txn.valorSigned < 0 ? 'despesa' : 'receita';
};

// Anota cada linha do extrato: tipo (despesa/receita), se é transferência, se
// já foi importada (dedup contra despesas E rendas) e o que entra por padrão.
export const annotateExtrato = ({ transacoes, despesas = [], rendas = [], categorias = [] }) => {
  const jaImportadas = new Set([...despesas, ...rendas].map(x => x.dedupKey).filter(Boolean));
  const catValidas = new Set(categorias.map(c => c.id));
  const hints = buildCategoriaHints(despesas);
  const nomeHints = buildNomeHints(despesas);
  const tagHints = buildTagHints(despesas);
  const manuais = new Set([
    ...despesas.filter(d => !d.dedupKey).map(d => `${d.data}|${d.valor}`),
    ...rendas.filter(r => !r.dedupKey).map(r => `${r.data}|${r.valor}`),
  ]);

  const vistosNoLote = new Set();
  const rows = transacoes.map(txn => {
    const key = dedupKey(txn);
    const classe = classifyExtrato(txn);
    const ehTransfer = classe === 'transferencia';
    // Mesmo transferência recebe um tipo (pelo sinal), caso o usuário reative.
    const tipo = ehTransfer ? (txn.valorSigned < 0 ? 'despesa' : 'receita') : classe;

    let motivo;
    if (jaImportadas.has(key)) motivo = 'duplicata';
    else if (vistosNoLote.has(key)) motivo = 'duplicata-lote';
    else if (ehTransfer) motivo = 'transferencia';
    else if (manuais.has(`${txn.data}|${txn.valor}`)) motivo = 'manual';
    else motivo = 'nova';
    vistosNoLote.add(key);

    const cleaned = limparDescricao(txn.descricao);
    // Herda o nome salvo antes (só pra despesa — receita usa outro campo).
    const nomeHint = tipo === 'despesa' ? nomeHints.get(normalizeDesc(txn.descricao)) : null;
    const descricao = nomeHint || cleaned;
    const sugestao = hints.get(normalizeDesc(descricao));
    const categoriaId = (tipo === 'despesa' && sugestao && catValidas.has(sugestao)) ? sugestao : null;
    const incluir = motivo === 'nova' || motivo === 'manual';
    const tags = tipo === 'despesa' ? herdarTags(tagHints, txn) : [];
    return { txn, dedupKey: key, motivo, tipo, categoriaId, incluir, descricao, tags, transferencia: ehTransfer };
  });

  return { rows, resumo: resumoExtrato(rows) };
};

// Resumo do extrato — separa despesas e receitas marcadas.
export const resumoExtrato = (rows) => {
  const incl = rows.filter(r => r.incluir);
  const desp = incl.filter(r => r.tipo === 'despesa');
  const rec  = incl.filter(r => r.tipo === 'receita');
  return {
    total: rows.length,
    incluir: incl.length,
    despesas: desp.length,
    receitas: rec.length,
    transferencias: rows.filter(r => r.transferencia).length,
    duplicatas: rows.filter(r => r.motivo === 'duplicata' || r.motivo === 'duplicata-lote').length,
    somaDespesas: desp.reduce((s, r) => s + r.txn.valor, 0),
    somaReceitas: rec.reduce((s, r) => s + r.txn.valor, 0),
  };
};

// Converte as linhas de receita marcadas em objetos de renda. `fonte` do
// modelo de renda recebe a descrição (origem do dinheiro).
export const rowsToRendas = (rows, { importId, importadoEm }) =>
  rows.filter(r => r.incluir && r.tipo === 'receita').map(r => ({
    fonte: (r.descricao != null && String(r.descricao).trim())
      ? String(r.descricao).trim() : r.txn.descricao,
    valor: r.txn.valor,
    data: r.txn.data,
    descricao: '',
    recorrente: false,
    duracaoMeses: null,
    fitid: r.txn.fitid,
    dedupKey: r.dedupKey,
    importId,
  }));
