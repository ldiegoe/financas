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

describe('annotateImport — herda o nome editado de importações anteriores', () => {
  it('usa o nome salvo (via srcDesc) quando a mesma origem se repete', () => {
    // Mês passado: "Discord* Nitromonthly" foi importado e renomeado p/ "Discord".
    const mesPassado = [{
      descricao: 'Discord', dedupKey: 'f1|-2598|discord* nitromonthly|/',
      srcDesc: 'discord* nitromonthly',
    }];
    const txn = { fitid: 'f2', valorSigned: -2598, valor: 2598, data: '2026-08-14',
      descricao: 'Discord* Nitromonthly', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: mesPassado, categorias: [] });
    expect(rows[0].descricao).toBe('Discord');   // herdou o nome editado
  });

  it('fallback: herda mesmo sem srcDesc, lendo a origem da dedupKey', () => {
    // Despesa importada antes de existir srcDesc — a origem sai da dedupKey.
    const antigo = [{ descricao: 'Netflix assinatura', dedupKey: 'fx|-5590|netflix.com|/' }];
    const txn = { fitid: 'fy', valorSigned: -5590, valor: 5590, data: '2026-08-01',
      descricao: 'Netflix.com', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: antigo, categorias: [] });
    expect(rows[0].descricao).toBe('Netflix assinatura');
  });

  it('fallback funciona também com a dedupKey no formato ANTIGO (3 partes)', () => {
    // Julho foi importado antes do campo de parcela na chave.
    const julho = [{ descricao: 'Netflix', dedupKey: 'fx|-5590|netflix.com' }];
    const txn = { fitid: 'fy', valorSigned: -5590, valor: 5590, data: '2026-08-01',
      descricao: 'Netflix.com', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: julho, categorias: [] });
    expect(rows[0].descricao).toBe('Netflix');
  });

  it('sem histórico, usa a descrição do banco', () => {
    const txn = { fitid: 'f', valorSigned: -1000, valor: 1000, data: '2026-08-01',
      descricao: 'Loja Nova', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: [], categorias: [] });
    expect(rows[0].descricao).toBe('Loja Nova');
  });

  it('rowsToDespesas grava srcDesc pra alimentar o próximo mês', () => {
    const txn = { fitid: 'f', valorSigned: -1000, valor: 1000, data: '2026-08-01',
      descricao: 'Loja Nova', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: [], categorias: [] });
    const out = rowsToDespesas(rows, { importId: 'i', fonte: 'f', importadoEm: 'z' });
    expect(out[0].srcDesc).toBe('loja nova');
  });
});

describe('annotateImport — herda as tags de importações anteriores', () => {
  it('parcela do mês seguinte herda as tags (mesmo FITID e valor)', () => {
    // Julho: "Amazon - Parcela 3/10" importado com tags.
    const julho = [{
      descricao: 'Amazon', tags: ['eletronico', 'parcelado'],
      dedupKey: 'AMZ|-5620|amazon|3/10', fitid: 'AMZ', srcDesc: 'amazon',
    }];
    const ago = { fitid: 'AMZ', valorSigned: -5620, valor: 5620, data: '2026-08-03',
      descricao: 'Amazon', ehDespesa: true, parcelaNum: 4, parcelaTotal: 10 };
    const { rows } = annotateImport({ transacoes: [ago], despesas: julho, categorias: [] });
    expect(rows[0].tags).toEqual(['eletronico', 'parcelado']);
  });

  it('NÃO herda de outra transação que só compartilha o FITID (IOF x compra)', () => {
    // A compra internacional (Discord) foi tagueada; o IOF compartilha o FITID
    // mas tem valor diferente — não pode herdar as tags do Discord.
    const antes = [{
      descricao: 'Discord', tags: ['assinatura'],
      dedupKey: 'COL|-2598|discord* nitromonthly|/', fitid: 'COL', srcDesc: 'discord* nitromonthly',
    }];
    const iof = { fitid: 'COL', valorSigned: -90, valor: 90, data: '2026-08-14',
      descricao: 'IOF de compra internacional', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [iof], despesas: antes, categorias: [] });
    expect(rows[0].tags).toEqual([]);
  });

  it('assinatura (FITID muda a cada mês) herda pelas descrição de origem', () => {
    const julho = [{
      descricao: 'Netflix', tags: ['streaming'],
      dedupKey: 'N1|-5590|netflix.com|/', fitid: 'N1', srcDesc: 'netflix.com',
    }];
    const ago = { fitid: 'N2', valorSigned: -5590, valor: 5590, data: '2026-08-01',
      descricao: 'Netflix.com', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [ago], despesas: julho, categorias: [] });
    expect(rows[0].tags).toEqual(['streaming']);
  });

  it('sem histórico de tags, vem vazio', () => {
    const txn = { fitid: 'Z', valorSigned: -100, valor: 100, data: '2026-08-01',
      descricao: 'Loja', ehDespesa: true, parcelaNum: null, parcelaTotal: null };
    const { rows } = annotateImport({ transacoes: [txn], despesas: [], categorias: [] });
    expect(rows[0].tags).toEqual([]);
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
    expect(out.every(d => d.importId === 'imp1' && d.fonte === 'nubank.ofx')).toBe(true);
  });
  it('despesas importadas nascem NÃO pagas (usuário marca ao quitar)', () => {
    expect(out.every(d => d.pago === false)).toBe(true);
  });
  it('usa a descrição e as tags editadas na revisão', () => {
    const { rows: edit } = annotateImport({ transacoes: parsed.transacoes, despesas: [], categorias: cats });
    const alvo = edit.find(r => r.txn.descricao === 'Mercado Central');
    alvo.descricao = 'Mercado do Zé';
    alvo.tags = ['mercado', 'essencial'];
    const gerado = rowsToDespesas(edit, { importId: 'i', fonte: 'f', importadoEm: '2026-07-28' })
      .find(d => d.valor === alvo.txn.valor && d.data === alvo.txn.data);
    expect(gerado.descricao).toBe('Mercado do Zé');
    expect(gerado.tags).toEqual(['mercado', 'essencial']);
    // renomear NÃO muda o dedupKey (continua o do dado original do banco)
    expect(gerado.dedupKey).toBe(alvo.dedupKey);
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

  it('guarda o selo de parcela (X/Y) nas parceladas, e null nas avulsas', () => {
    const out2 = rowsToDespesas(rows, { importId: 'i', fonte: 'f', importadoEm: 'z' });
    // "Loja Online - Parcela 1/10" no fixture → selo "1/10".
    const parcelada = out2.find(d => d.descricao === 'Loja Online');
    expect(parcelada.parcelaImport).toBe('1/10');
    // Compra avulsa não recebe selo.
    const avulsa = out2.find(d => d.descricao === 'Mercado Central');
    expect(avulsa.parcelaImport).toBe(null);
    // Continua avulsa de verdade (não vira parcelada projetada).
    expect(parcelada.parcelas).toBe(1);
    expect(parcelada.recorrente).toBe(false);
  });

  it('com vencimento, lança tudo na data da fatura e guarda a compra em criadoEm', () => {
    const comVenc = rowsToDespesas(rows, {
      importId: 'i', fonte: 'f', importadoEm: '2026-08-01', vencimento: '2026-08-10',
    });
    // Toda despesa vence em 10/08; a data da compra fica em criadoEm.
    expect(comVenc.every(d => d.data === '2026-08-10')).toBe(true);
    const merc = comVenc.find(d => d.descricao === 'Mercado Central');
    expect(merc.criadoEm).toBe('2026-07-25');   // data original da compra
    // dedupKey NÃO muda com a troca de data (segue o dado do banco).
    expect(merc.dedupKey).toBe(dedupKey({ fitid: merc.fitid, valorSigned: -2448, descricao: 'Mercado Central' }));
  });

  it('sem vencimento, mantém a data da compra (comportamento padrão)', () => {
    const merc = out.find(d => d.descricao === 'Mercado Central');
    expect(merc.data).toBe('2026-07-25');
    expect(merc.criadoEm).toBe('2026-07-28');   // importadoEm
  });
});
