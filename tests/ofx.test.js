import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseOfxAmount, parseOfxDate, extractParcela, normalizeDesc, dedupKey, parseOfx,
} from '../src/domain/ofx.js';

// Fixture com a MESMA estrutura de uma fatura Nubank, mas dados fictícios
// (nomes de estabelecimento, conta e FITIDs anonimizados): 46 transações, 45
// débitos + 1 crédito ("Pagamento recebido"), e — o pulo do gato — 2 FITIDs
// repetidos (compra internacional + IOF compartilham id), preservados de
// propósito porque é o caso que quebraria a deduplicação ingênua.
const OFX = readFileSync(fileURLToPath(new URL('./fixtures/nubank.ofx', import.meta.url)), 'latin1');

describe('parseOfxAmount', () => {
  it('converte valor com sinal em centavos', () => {
    expect(parseOfxAmount('-24.48')).toBe(-2448);
    expect(parseOfxAmount('3327.44')).toBe(332744);
    expect(parseOfxAmount('-0.90')).toBe(-90);
  });
  it('tolera vírgula decimal (bancos fora do padrão)', () => {
    expect(parseOfxAmount('-24,48')).toBe(-2448);
  });
  it('vazio/inválido é 0', () => {
    expect(parseOfxAmount('')).toBe(0);
    expect(parseOfxAmount(null)).toBe(0);
    expect(parseOfxAmount('abc')).toBe(0);
  });
});

describe('parseOfxDate', () => {
  it('pega YYYY-MM-DD ignorando hora e fuso', () => {
    expect(parseOfxDate('20260725000000[-3:BRT]')).toBe('2026-07-25');
    expect(parseOfxDate('20260703000000[0:GMT]')).toBe('2026-07-03');
  });
  it('sem 8 dígitos retorna null', () => {
    expect(parseOfxDate('2026')).toBe(null);
    expect(parseOfxDate('')).toBe(null);
  });
});

describe('extractParcela', () => {
  it('separa " - Parcela X/Y" da descrição', () => {
    expect(extractParcela('Mercadolivre*Mercadol - Parcela 1/10')).toEqual({
      descricao: 'Mercadolivre*Mercadol', parcelaNum: 1, parcelaTotal: 10,
    });
    expect(extractParcela('Pag*Steam - Parcela 2/3')).toEqual({
      descricao: 'Pag*Steam', parcelaNum: 2, parcelaTotal: 3,
    });
  });
  it('descrição sem parcela fica intacta', () => {
    expect(extractParcela('Drogasil')).toEqual({
      descricao: 'Drogasil', parcelaNum: null, parcelaTotal: null,
    });
  });
});

describe('dedupKey', () => {
  it('desambigua transações que compartilham FITID', () => {
    // O caso real: IOF e a compra internacional têm o MESMO fitid, mas valor e
    // descrição diferentes — a chave composta os separa.
    const iof   = { fitid: 'X', valorSigned: -90,   descricao: 'IOF de compra internacional' };
    const compra = { fitid: 'X', valorSigned: -2598, descricao: 'Discord* Nitromonthly' };
    expect(dedupKey(iof)).not.toBe(dedupKey(compra));
  });
  it('é estável entre importações (mesma transação → mesma chave)', () => {
    const t = { fitid: 'X', valorSigned: -2448, descricao: 'Mercantilmedeiros' };
    expect(dedupKey(t)).toBe(dedupKey({ ...t }));
  });
  it('normaliza a descrição na chave', () => {
    expect(dedupKey({ fitid: 'X', valorSigned: -100, descricao: 'Uber  RIDES' }))
      .toBe(dedupKey({ fitid: 'X', valorSigned: -100, descricao: 'uber rides' }));
  });
});

describe('parseOfx — fatura real do Nubank', () => {
  const r = parseOfx(OFX);

  it('lê metadados do banco', () => {
    expect(r.banco).toBe('NU PAGAMENTOS S.A.');
    expect(r.moeda).toBe('BRL');
    expect(r.conta).toBe('00000000-0000-0000-0000-000000000000');
    expect(r.saldo).toBe(-344451);
  });

  it('extrai as 46 transações', () => {
    expect(r.transacoes).toHaveLength(46);
  });

  it('classifica 45 débitos como despesa e o crédito como não-despesa', () => {
    expect(r.transacoes.filter(t => t.ehDespesa)).toHaveLength(45);
    const credito = r.transacoes.find(t => !t.ehDespesa);
    expect(credito.descricao).toBe('Pagamento recebido');
    expect(credito.valor).toBe(332744);
    expect(credito.tipo).toBe('CREDIT');
  });

  it('decodifica a primeira transação corretamente', () => {
    const primeira = r.transacoes.find(t => t.descricao === 'Mercado Central');
    expect(primeira).toMatchObject({
      data: '2026-07-25', mesRef: '2026-07', valor: 2448, valorSigned: -2448,
      tipo: 'DEBIT', ehDespesa: true, parcelaNum: null,
    });
  });

  it('período vai de 03/07 a 25/07', () => {
    expect(r.de).toBe('2026-07-03');
    expect(r.ate).toBe('2026-07-25');
  });

  it('expõe abertura e fechamento da fatura (DTSTART/DTEND)', () => {
    expect(r.abertura).toBe('2026-07-03');
    expect(r.fechamento).toBe('2026-08-03');
  });

  it('extrai a parcela das compras parceladas', () => {
    const ml = r.transacoes.find(t => t.descricao === 'Loja Online' && t.valor === 104990);
    expect(ml).toMatchObject({ parcelaNum: 1, parcelaTotal: 10 });
  });

  it('NÃO perde nenhuma linha apesar dos FITIDs repetidos', () => {
    // As duas linhas com o mesmo FITID (IOF -0,90 + Assinatura B -25,98) e as
    // outras duas (IOF -19,94 + Assinatura A -569,79) devem coexistir.
    const iofPequeno = r.transacoes.find(t => t.valor === 90 && t.descricao.startsWith('IOF'));
    const assinatura = r.transacoes.find(t => t.descricao === 'Assinatura B');
    expect(iofPequeno.fitid).toBe(assinatura.fitid);            // mesmo FITID no arquivo
    expect(dedupKey(iofPequeno)).not.toBe(dedupKey(assinatura)); // mas chaves distintas

    // Nenhuma colisão de chave em toda a fatura → nada é descartado por engano.
    const chaves = new Set(r.transacoes.map(dedupKey));
    expect(chaves.size).toBe(46);
  });

  it('soma de todas as transações confere (valor verificado fora do parser)', () => {
    // -11707 = soma dos 45 débitos (-344451) + o crédito (+332744).
    const soma = r.transacoes.reduce((s, t) => s + t.valorSigned, 0);
    expect(soma).toBe(-11707);
  });

  it('a soma dos débitos corresponde ao BALAMT da fatura', () => {
    // O BALAMT do Nubank é o total das compras (o que se deve no ciclo), não a
    // soma incluindo o pagamento. Bate a menos de 1 centavo (arredondamento do
    // próprio banco), o que confirma que lemos os débitos certos.
    const debitos = r.transacoes.filter(t => t.ehDespesa)
      .reduce((s, t) => s + t.valorSigned, 0);
    expect(Math.abs(debitos - r.saldo)).toBeLessThanOrEqual(1);
  });
});

describe('parseOfx — robustez', () => {
  it('texto vazio não quebra', () => {
    expect(parseOfx('').transacoes).toEqual([]);
    expect(parseOfx(null).transacoes).toEqual([]);
  });
  it('aceita SGML sem tags de fechamento', () => {
    const sgml = `<OFX><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260101120000[-3:BRT]
<TRNAMT>-10.00
<FITID>abc
<MEMO>Teste sem fechamento
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260102120000[-3:BRT]
<TRNAMT>-20.50
<FITID>def
<MEMO>Segunda
</BANKTRANLIST></OFX>`;
    const r = parseOfx(sgml);
    expect(r.transacoes).toHaveLength(2);
    expect(r.transacoes[0]).toMatchObject({ valor: 1000, descricao: 'Teste sem fechamento', data: '2026-01-01' });
    expect(r.transacoes[1]).toMatchObject({ valor: 2050, descricao: 'Segunda' });
  });
});
