import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOfx, limparDescricao } from '../src/domain/ofx.js';
import {
  classifyExtrato, annotateExtrato, resumoExtrato, rowsToRendas, rowsToDespesas,
} from '../src/domain/import-review.js';

// Extrato fictício (mesma estrutura do Nubank conta): Pix enviados/recebidos,
// caixinha (Aplicação/Resgate RDB), pagamento de fatura e de boleto. UTF-8.
const OFX = readFileSync(fileURLToPath(new URL('./fixtures/extrato-nubank.ofx', import.meta.url)), 'utf8');
const parsed = parseOfx(OFX);
const cats = [{ id: 'energia', nome: 'Energia' }];

describe('parseOfx — detecta conta corrente', () => {
  it('tipoConta = checking', () => {
    expect(parsed.tipoConta).toBe('checking');
  });
  it('lê as 7 transações', () => {
    expect(parsed.transacoes).toHaveLength(7);
  });
});

describe('limparDescricao', () => {
  it('corta CPF mascarado, banco e agência/conta — guarda o nome', () => {
    expect(limparDescricao('Transferência enviada pelo Pix - BELTRANO SOUZA - •••.335.943-•• - CAIXA ECONOMICA FEDERAL (0104) Agência: 2002 Conta: 12345-0'))
      .toBe('Transferência enviada pelo Pix - BELTRANO SOUZA');
  });
  it('corta no CNPJ real', () => {
    expect(limparDescricao('Transferência enviada pelo Pix - 11.222.333 CICLANO COMERCIO LTDA - 11.222.333/0001-06 - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 98765-0'))
      .toBe('Transferência enviada pelo Pix - 11.222.333 CICLANO COMERCIO LTDA');
  });
  it('boleto e caixinha passam intactos', () => {
    expect(limparDescricao('Pagamento de boleto efetuado - CONCESSIONARIA DE ENERGIA'))
      .toBe('Pagamento de boleto efetuado - CONCESSIONARIA DE ENERGIA');
    expect(limparDescricao('Aplicação RDB')).toBe('Aplicação RDB');
  });
});

describe('classifyExtrato', () => {
  const t = (v, memo) => ({ valorSigned: v, descricao: memo });
  it('caixinha (RDB) e pagamento de fatura são transferência', () => {
    expect(classifyExtrato(t(-4500, 'Aplicação RDB'))).toBe('transferencia');
    expect(classifyExtrato(t(6500, 'Resgate RDB'))).toBe('transferencia');
    expect(classifyExtrato(t(-3327, 'Pagamento de fatura'))).toBe('transferencia');
  });
  it('débito comum é despesa, crédito comum é receita', () => {
    expect(classifyExtrato(t(-14, 'Pix - Beltrano'))).toBe('despesa');
    expect(classifyExtrato(t(4500, 'Pix recebido'))).toBe('receita');
  });
  it('pagamento de boleto NÃO é transferência (é despesa)', () => {
    expect(classifyExtrato(t(-412, 'Pagamento de boleto efetuado - ENERGIA'))).toBe('despesa');
  });
});

describe('annotateExtrato', () => {
  const { rows, resumo } = annotateExtrato({ transacoes: parsed.transacoes, despesas: [], rendas: [], categorias: cats });

  it('separa despesas, receitas e transferências', () => {
    // 7 no total: 1 pix recebido (receita), 2 pix enviados + 1 boleto (despesa),
    // 3 transferências (Aplicação/Resgate RDB + Pagamento de fatura).
    expect(resumo.total).toBe(7);
    expect(resumo.receitas).toBe(1);
    expect(resumo.despesas).toBe(3);
    expect(resumo.transferencias).toBe(3);
    expect(resumo.incluir).toBe(4);
  });

  it('transferências entram desmarcadas', () => {
    const aplic = rows.find(r => r.txn.descricao === 'Aplicação RDB');
    expect(aplic.transferencia).toBe(true);
    expect(aplic.incluir).toBe(false);
    expect(aplic.motivo).toBe('transferencia');
  });

  it('pagamento de fatura entra desmarcado (evita duplicar o cartão)', () => {
    const fat = rows.find(r => r.txn.descricao === 'Pagamento de fatura');
    expect(fat.transferencia).toBe(true);
    expect(fat.incluir).toBe(false);
  });

  it('a descrição já vem limpa', () => {
    const pix = rows.find(r => r.txn.valor === 1400);
    expect(pix.descricao).toBe('Transferência enviada pelo Pix - BELTRANO SOUZA');
  });

  it('sugere categoria para despesa a partir do histórico', () => {
    const hist = [{ descricao: 'Pagamento de boleto efetuado - CONCESSIONARIA DE ENERGIA', categoriaId: 'energia', dedupKey: 'x|y|z' }];
    const r = annotateExtrato({ transacoes: parsed.transacoes, despesas: hist, rendas: [], categorias: cats });
    const boleto = r.rows.find(x => x.txn.valor === 41208);
    expect(boleto.categoriaId).toBe('energia');
  });
});

describe('rowsToRendas / rowsToDespesas — split correto', () => {
  const { rows } = annotateExtrato({ transacoes: parsed.transacoes, despesas: [], rendas: [], categorias: cats });

  it('rowsToDespesas pega só as despesas marcadas (não receita nem transferência)', () => {
    const desp = rowsToDespesas(rows, { importId: 'i', fonte: 'extrato.ofx', importadoEm: '2026-07-30' });
    expect(desp).toHaveLength(3);
    expect(desp.every(d => d.importId === 'i')).toBe(true);
    // Sem vencimento no extrato: data = data real da transação.
    const boleto = desp.find(d => d.valor === 41208);
    expect(boleto.data).toBe('2026-07-17');
  });

  it('despesas do extrato nascem JÁ PAGAS (o dinheiro já saiu)', () => {
    const desp = rowsToDespesas(rows, { importId: 'i', fonte: 'x', importadoEm: '2026-07-30', pago: true });
    expect(desp.every(d => d.pago === true)).toBe(true);
  });

  it('rowsToRendas pega só as receitas marcadas', () => {
    const rend = rowsToRendas(rows, { importId: 'i', importadoEm: '2026-07-30' });
    expect(rend).toHaveLength(1);
    expect(rend[0]).toMatchObject({ valor: 450000, data: '2026-07-01', recorrente: false });
    expect(rend[0].fonte).toBe('Transferência recebida pelo Pix - FULANO DE TAL SILVA');
    expect(rend[0].dedupKey).toBeTruthy();
  });

  it('reimportar não duplica (dedup vs despesas E rendas já gravadas)', () => {
    const desp = rowsToDespesas(rows, { importId: 'i', fonte: 'f', importadoEm: '2026-07-30' });
    const rend = rowsToRendas(rows, { importId: 'i', importadoEm: '2026-07-30' });
    const r2 = annotateExtrato({ transacoes: parsed.transacoes, despesas: desp, rendas: rend, categorias: cats });
    expect(r2.resumo.incluir).toBe(0);
    expect(r2.resumo.duplicatas).toBe(4);
  });

  it('se o usuário reclassificar a receita real→despesa, vai pro lado certo', () => {
    // Só a receita de fato (não as transferências, que também têm tipo receita).
    const mod = rows.map(r => (r.tipo === 'receita' && !r.transferencia) ? { ...r, tipo: 'despesa', incluir: true } : r);
    expect(rowsToRendas(mod, { importId: 'i', importadoEm: 'z' })).toHaveLength(0);
    expect(rowsToDespesas(mod, { importId: 'i', fonte: 'f', importadoEm: 'z' })).toHaveLength(4);
  });
});
