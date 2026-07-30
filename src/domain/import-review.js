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

    const sugestao = hints.get(normalizeDesc(txn.descricao));
    const categoriaId = (sugestao && catValidas.has(sugestao)) ? sugestao : null;
    const incluir = motivo === 'nova' || motivo === 'manual';
    // `descricao` e `tags` sao editaveis na tela de revisao (o dedupKey fica
    // congelado no dado original do banco, entao renomear nao afeta a dedup).
    return { txn, dedupKey: key, motivo, categoriaId, incluir, descricao: txn.descricao, tags: [] };
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
export const rowsToDespesas = (rows, { importId, fonte, importadoEm, vencimento = null }) =>
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
      tags: r.tags || [],
      pago: false,
      fitid: r.txn.fitid,
      dedupKey: r.dedupKey,
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

    const descricao = limparDescricao(txn.descricao);
    const sugestao = hints.get(normalizeDesc(descricao));
    const categoriaId = (tipo === 'despesa' && sugestao && catValidas.has(sugestao)) ? sugestao : null;
    const incluir = motivo === 'nova' || motivo === 'manual';
    return { txn, dedupKey: key, motivo, tipo, categoriaId, incluir, descricao, tags: [], transferencia: ehTransfer };
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
