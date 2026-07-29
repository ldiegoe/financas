// Camada de revisão da importação: pega as transações do parser + o que já
// existe no app e anota cada linha (nova / duplicata / crédito / possível
// lançamento manual), sugere categoria e diz o que entra por padrão. Nada é
// gravado aqui — só decidido. Puro e testável.

import { dedupKey, normalizeDesc } from './ofx.js';

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
    return { txn, dedupKey: key, motivo, categoriaId, incluir };
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
// desfazer. `pago: true` porque a compra no cartão já aconteceu — é histórico,
// não fica pendente nos vencimentos.
export const rowsToDespesas = (rows, { importId, fonte, importadoEm }) =>
  rows.filter(r => r.incluir).map(r => ({
    descricao: r.txn.descricao,
    valor: r.txn.valor,
    data: r.txn.data,
    criadoEm: importadoEm,
    categoriaId: r.categoriaId || null,
    recorrente: false,
    parcelas: 1,
    tags: [],
    pago: true,
    fitid: r.txn.fitid,
    dedupKey: r.dedupKey,
    importId,
    fonte,
  }));
