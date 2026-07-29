import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOfx, dedupKey } from '../src/domain/ofx.js';
import {
  buildCategoriaHints, annotateImport, resumoRows, rowsToDespesas,
} from '../src/domain/import-review.js';

const OFX = readFileSync(fileURLToPath(new URL('./fixtures/nubank.ofx', import.meta.url)), 'latin1');
const parsed = parseOfx(OFX);
const cats = [
  { id: 'saude', nome: 'Saúde' },
  { id: 'lazer', nome: 'Lazer' },
];

describe('buildCategoriaHints', () => {
  it('mapeia descrição normalizada → categoria da última ocorrência', () => {
    const m = buildCategoriaHints([
      { descricao: 'Drogasil', categoriaId: 'saude' },
      { descricao: 'DROGASIL', categoriaId: 'lazer' }, // mesma normalizada, vence
      { descricao: 'Sem cat', categoriaId: null },
    ]);
    expect(m.get('drogasil')).toBe('lazer');
    expect(m.has('sem cat')).toBe(false);
  });
});

describe('annotateImport — primeira importação (app vazio)', () => {
  const { rows, resumo } = annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats });

  it('marca as 45 compras e desmarca o crédito', () => {
    expect(resumo.total).toBe(46);
    expect(resumo.novas).toBe(45);
    expect(resumo.creditos).toBe(1);
    expect(resumo.incluir).toBe(45);
  });
  it('o crédito "Pagamento recebido" entra desmarcado', () => {
    const credito = rows.find(r => r.txn.descricao === 'Pagamento recebido');
    expect(credito.motivo).toBe('credito');
    expect(credito.incluir).toBe(false);
  });
  it('a soma a incluir é a soma dos débitos (≈ BALAMT)', () => {
    expect(Math.abs(resumo.somaIncluir - Math.abs(parsed.saldo))).toBeLessThanOrEqual(1);
  });
  it('sem histórico, ninguém recebe categoria sugerida', () => {
    expect(rows.every(r => r.categoriaId === null)).toBe(true);
  });
});

describe('annotateImport — reimportar o mesmo arquivo', () => {
  it('tudo vira duplicata e nada entra', () => {
    // Simula que a 1ª importação já gravou as despesas (com dedupKey).
    const jaGravadas = rowsToDespesas(
      annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats }).rows,
      { importId: 'imp1', fonte: 'nubank.ofx', importadoEm: '2026-07-28' }
    );
    const { resumo } = annotateImport({ transacoes: parsed.transacoes, despesas: jaGravadas, categorias: cats });
    expect(resumo.duplicatas).toBe(45);
    expect(resumo.incluir).toBe(0);
  });
});

describe('annotateImport — colisão de FITID não descarta linha', () => {
  it('IOF e compra internacional (mesmo FITID) contam como 2 novas', () => {
    const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats });
    const iof = rows.find(r => r.txn.valor === 90 && r.txn.descricao.startsWith('IOF'));
    const assinatura = rows.find(r => r.txn.descricao === 'Assinatura B');
    expect(iof.txn.fitid).toBe(assinatura.txn.fitid);
    expect(iof.motivo).toBe('nova');
    expect(assinatura.motivo).toBe('nova');
    expect(iof.incluir && assinatura.incluir).toBe(true);
  });
});

describe('annotateImport — duplicata dentro do próprio arquivo', () => {
  it('a segunda ocorrência idêntica vira duplicata-lote', () => {
    const t = { fitid: 'z', data: '2026-07-10', mesRef: '2026-07', valorSigned: -1000, valor: 1000, descricao: 'Cafe', ehDespesa: true };
    const { rows, resumo } = annotateImport({ transacoes: [t, { ...t }], despesas: [], categorias: cats });
    expect(rows[0].motivo).toBe('nova');
    expect(rows[1].motivo).toBe('duplicata-lote');
    expect(resumo.incluir).toBe(1);
  });
});

describe('annotateImport — sobreposição com lançamento manual', () => {
  it('bate data+valor com despesa manual → motivo manual, mas ainda entra', () => {
    const manual = { id: 'm1', data: '2026-07-25', valor: 2448, descricao: 'Mercado (digitado)' }; // sem dedupKey
    const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: [manual], categorias: cats });
    const alvo = rows.find(r => r.txn.descricao === 'Mercado Central');
    expect(alvo.motivo).toBe('manual');
    expect(alvo.incluir).toBe(true);
  });
});

describe('annotateImport — sugestão de categoria pelo histórico', () => {
  it('sugere a categoria de uma despesa anterior de mesma descrição', () => {
    const historico = [{ descricao: 'Farmacia', categoriaId: 'saude', dedupKey: 'outro|x|y' }];
    const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: historico, categorias: cats });
    const farmacia = rows.find(r => r.txn.descricao === 'Farmacia');
    expect(farmacia.categoriaId).toBe('saude');
  });
  it('ignora sugestão de categoria que não existe mais', () => {
    const historico = [{ descricao: 'Farmacia', categoriaId: 'apagada', dedupKey: 'outro|x|y' }];
    const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: historico, categorias: cats });
    expect(rows.find(r => r.txn.descricao === 'Farmacia').categoriaId).toBe(null);
  });
});

describe('resumoRows — recálculo após toggles', () => {
  it('reflete o que o usuário marcou/desmarcou', () => {
    const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats });
    rows.forEach(r => { r.incluir = false; });
    rows[0].incluir = true;
    const r = resumoRows(rows);
    expect(r.incluir).toBe(1);
    expect(r.somaIncluir).toBe(rows[0].txn.valor);
  });
});

describe('rowsToDespesas', () => {
  const { rows } = annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats });
  const out = rowsToDespesas(rows, { importId: 'imp1', fonte: 'nubank.ofx', importadoEm: '2026-07-28' });

  it('gera só as marcadas (45 débitos, sem o crédito)', () => {
    expect(out).toHaveLength(45);
    expect(out.every(d => d.pago === true)).toBe(true);
    expect(out.every(d => d.importId === 'imp1' && d.fonte === 'nubank.ofx')).toBe(true);
  });
  it('cada despesa carrega fitid e dedupKey para dedup futura', () => {
    const merc = out.find(d => d.descricao === 'Mercado Central');
    expect(merc).toMatchObject({ valor: 2448, data: '2026-07-25', parcelas: 1, recorrente: false });
    expect(merc.dedupKey).toBe(dedupKey({ fitid: merc.fitid, valorSigned: -2448, descricao: 'Mercado Central' }));
  });
  it('não gera nada se nada estiver marcado', () => {
    const zerado = rows.map(r => ({ ...r, incluir: false }));
    expect(rowsToDespesas(zerado, { importId: 'x', fonte: 'y', importadoEm: 'z' })).toEqual([]);
  });
});
