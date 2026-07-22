import { describe, it, expect } from 'vitest';
import {
  onlyDigits, mod10, mod11, linhaToBarras, fatorToVencimento, formatLinha,
  parseLinha, extractBoletos, resumoBoletos, scoreDespesa, mergeBoletos,
} from '../src/domain/boleto.js';

// Carnê real (CAIXA / Golden Ville, parcelas 26N a 36N de R$ 289,09) — serve
// de fixture porque cobre virada de ano e o ciclo novo do fator de vencimento.
const CARNE = [
  ['10498.31157 44000.100048 00003.016698 8 14420000028909', '2026-05-10'],
  ['10498.31157 44000.100048 00003.016771 8 14730000028909', '2026-06-10'],
  ['10498.31157 44000.100048 00003.016854 1 15030000028909', '2026-07-10'],
  ['10498.31157 44000.100048 00003.016938 1 15340000028909', '2026-08-10'],
  ['10498.31157 44000.100048 00003.017076 3 15650000028909', '2026-09-10'],
  ['10498.31157 44000.100048 00003.017159 8 15950000028909', '2026-10-10'],
  ['10498.31157 44000.100048 00003.017233 6 16260000028909', '2026-11-10'],
  ['10498.31157 44000.100048 00003.017316 1 16560000028909', '2026-12-10'],
  ['10498.31157 44000.100048 00003.017407 9 16870000028909', '2027-01-10'],
  ['10498.31157 44000.100048 00003.017589 9 17180000028909', '2027-02-10'],
  ['10498.31157 44000.100048 00003.017662 2 17460000028909', '2027-03-10'],
];
const HOJE = new Date(2026, 6, 22);

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('10498.31157 44000')).toBe('1049831157440' + '00');
  });
  it('tolera null/undefined', () => {
    expect(onlyDigits(null)).toBe('');
    expect(onlyDigits(undefined)).toBe('');
  });
});

describe('mod10 / mod11', () => {
  it('mod10 confere os DVs de campo do carnê', () => {
    const d = onlyDigits(CARNE[0][0]);
    expect(mod10(d.slice(0, 9))).toBe(Number(d[9]));
    expect(mod10(d.slice(10, 20))).toBe(Number(d[20]));
    expect(mod10(d.slice(21, 31))).toBe(Number(d[31]));
  });
  it('mod11 confere o DV geral', () => {
    const barras = linhaToBarras(onlyDigits(CARNE[0][0]));
    expect(mod11(barras.slice(0, 4) + barras.slice(5))).toBe(Number(barras[4]));
  });
  it('resto 0/10/11 vira DV 1', () => {
    // 43 dígitos zerados → soma 0 → resto 0 → DV 1 por regra.
    expect(mod11('0'.repeat(43))).toBe(1);
  });
});

describe('linhaToBarras', () => {
  it('gera 44 dígitos', () => {
    expect(linhaToBarras(onlyDigits(CARNE[0][0]))).toHaveLength(44);
  });
  it('mantém banco/moeda no início e o campo livre no fim', () => {
    const d = onlyDigits(CARNE[0][0]);
    const b = linhaToBarras(d);
    expect(b.slice(0, 4)).toBe('1049');
    expect(b[4]).toBe(d[32]);              // DV geral
    expect(b.slice(5, 19)).toBe(d.slice(33)); // fator + valor
  });
});

describe('fatorToVencimento', () => {
  it('decodifica o ciclo novo (base 22/02/2025)', () => {
    expect(fatorToVencimento(1000, HOJE)).toBe('2025-02-22');
    expect(fatorToVencimento(1442, HOJE)).toBe('2026-05-10');
  });
  it('decodifica o ciclo antigo quando o novo cairia longe demais', () => {
    // Fator 9000 no ciclo novo daria 2047; no antigo, 2019 — mais plausível
    // pra quem importa um boleto em 2019/2020.
    expect(fatorToVencimento(9000, new Date(2019, 8, 1))).toBe('2019-09-02');
  });
  it('carnê longo (~15 anos à frente) fica no ciclo correto', () => {
    // 179 parcelas mensais a partir de 2026 chegam a 2041 — precisa continuar
    // caindo no ciclo novo, e não desandar pro antigo.
    expect(fatorToVencimento(6500, HOJE)).toBe('2040-03-15');
  });
  it('fator ausente/inválido retorna null', () => {
    expect(fatorToVencimento(0, HOJE)).toBe(null);
    expect(fatorToVencimento(999, HOJE)).toBe(null);
  });
});

describe('parseLinha', () => {
  it('decodifica vencimento e valor de todas as parcelas do carnê', () => {
    for (const [linha, venc] of CARNE) {
      const b = parseLinha(linha, HOJE);
      expect(b.valido).toBe(true);
      expect(b.vencimento).toBe(venc);
      expect(b.valor).toBe(28909);
      expect(b.banco).toBe('104');
      expect(b.mesRef).toBe(venc.slice(0, 7));
    }
  });
  it('aceita os 47 dígitos grudados', () => {
    const b = parseLinha(onlyDigits(CARNE[0][0]), HOJE);
    expect(b.vencimento).toBe('2026-05-10');
  });
  it('marca inválido quando um dígito é adulterado', () => {
    const d = onlyDigits(CARNE[0][0]).split('');
    d[5] = String((Number(d[5]) + 1) % 10);
    expect(parseLinha(d.join(''), HOJE).valido).toBe(false);
  });
  it('retorna null se não tiver 47 dígitos', () => {
    expect(parseLinha('123', HOJE)).toBe(null);
    expect(parseLinha('8' + '0'.repeat(47), HOJE)).toBe(null); // arrecadação (48)
  });
});

describe('formatLinha', () => {
  it('volta ao formato impresso', () => {
    expect(formatLinha(onlyDigits(CARNE[0][0]))).toBe(CARNE[0][0]);
  });
  it('devolve a entrada intacta se não for 47 dígitos', () => {
    expect(formatLinha('abc')).toBe('abc');
  });
});

describe('extractBoletos', () => {
  // Texto no formato que o pdf.js entrega: campos do boleto em volta do código.
  const paginaPDF = CARNE.map(([linha], i) => `
    0000527${138 + i}  28/04/2026  Nosso número 14000000000030${166 + i}-9
    104-0 ${linha}
    Vl. documento 289,09  CNPJ: 19.233.771/0001-57  CPF: 050.791.913-09
  `).join('\n');

  it('acha todos os 11 boletos do carnê', () => {
    const bs = extractBoletos(paginaPDF, HOJE);
    expect(bs).toHaveLength(11);
    expect(bs.map(b => b.vencimento)).toEqual(CARNE.map(c => c[1]));
  });
  it('vem ordenado por vencimento mesmo se o PDF estiver fora de ordem', () => {
    const embaralhado = [CARNE[5], CARNE[0], CARNE[9]].map(c => c[0]).join('\n');
    expect(extractBoletos(embaralhado, HOJE).map(b => b.vencimento))
      .toEqual(['2026-05-10', '2026-10-10', '2027-02-10']);
  });
  it('não duplica se o mesmo código aparecer duas vezes (recibo + ficha)', () => {
    expect(extractBoletos(`${CARNE[0][0]}\n${CARNE[0][0]}`, HOJE)).toHaveLength(1);
  });
  it('ignora números longos que não são boleto', () => {
    const ruido = 'Nosso número 14000000000030166-9 CNPJ 19.233.771/0001-57 '
                + '1234567890123456789012345678901234567890123456789';
    expect(extractBoletos(ruido, HOJE)).toEqual([]);
  });
  it('ignora sequência de 47 dígitos com DV errado', () => {
    const d = onlyDigits(CARNE[0][0]).split('');
    d[5] = String((Number(d[5]) + 1) % 10);
    expect(extractBoletos(d.join(''), HOJE)).toEqual([]);
  });
  it('texto vazio/nulo não quebra', () => {
    expect(extractBoletos('', HOJE)).toEqual([]);
    expect(extractBoletos(null, HOJE)).toEqual([]);
  });
});

describe('resumoBoletos', () => {
  const bs = CARNE.map(([l]) => parseLinha(l, HOJE));
  it('resume período e valor único', () => {
    expect(resumoBoletos(bs)).toMatchObject({
      total: 11, de: '2026-05-10', ate: '2027-03-10', valor: 28909,
    });
  });
  it('valor null quando as parcelas variam', () => {
    const r = resumoBoletos([{ ...bs[0], valor: 100 }, { ...bs[1], valor: 200 }]);
    expect(r.valor).toBe(null);
    expect(r.valorMin).toBe(100);
    expect(r.valorMax).toBe(200);
  });
  it('lista vazia retorna null', () => {
    expect(resumoBoletos([])).toBe(null);
  });
});

describe('scoreDespesa', () => {
  const bs = CARNE.map(([l]) => parseLinha(l, HOJE));
  const meses = CARNE.map(c => c[1].slice(0, 7));
  it('pontua alto quando valor e meses batem', () => {
    expect(scoreDespesa({ valor: 28909 }, bs, meses)).toBe(200);
  });
  it('pontua menos quando o valor difere', () => {
    expect(scoreDespesa({ valor: 50000 }, bs, meses)).toBe(100);
  });
  it('pontua menos quando os meses não se sobrepõem', () => {
    expect(scoreDespesa({ valor: 28909 }, bs, ['2030-01'])).toBe(100);
  });
  it('sem boletos, score zero', () => {
    expect(scoreDespesa({ valor: 28909 }, [], meses)).toBe(0);
  });
});

describe('mergeBoletos', () => {
  const bs = CARNE.map(([l]) => parseLinha(l, HOJE));
  let n = 0;
  const opts = () => ({ despesaId: 'd1', origem: 'carne.pdf', importadoEm: '2026-07-22', uid: () => `b${++n}` });

  it('importação inicial adiciona todos', () => {
    const r = mergeBoletos([], bs, opts());
    expect(r.adicionados).toBe(11);
    expect(r.boletos).toHaveLength(11);
    expect(r.boletos[0]).toMatchObject({ despesaId: 'd1', mesRef: '2026-05', valor: 28909 });
  });

  it('reimportar o mesmo PDF não duplica', () => {
    const primeira = mergeBoletos([], bs, opts());
    const segunda = mergeBoletos(primeira.boletos, bs, opts());
    expect(segunda.adicionados).toBe(0);
    expect(segunda.iguais).toBe(11);
    expect(segunda.boletos).toHaveLength(11);
  });

  it('PDF seguinte soma parcelas novas sem tocar nas antigas', () => {
    const primeira = mergeBoletos([], bs.slice(0, 5), opts());
    const segunda = mergeBoletos(primeira.boletos, bs, opts());
    expect(segunda.adicionados).toBe(6);
    expect(segunda.boletos).toHaveLength(11);
  });

  it('2ª via com código novo no mesmo mês atualiza no lugar', () => {
    const primeira = mergeBoletos([], bs, opts());
    const idAntes = primeira.boletos[0].id;
    const segundaVia = [{ ...bs[0], linha: onlyDigits(CARNE[1][0]) }];
    const r = mergeBoletos(primeira.boletos, segundaVia, opts());
    expect(r.atualizados).toBe(1);
    expect(r.boletos).toHaveLength(11);
    expect(r.boletos[0].id).toBe(idAntes);            // mantém identidade
    expect(r.boletos[0].linha).toBe(onlyDigits(CARNE[1][0]));
  });

  it('não mistura boletos de despesas diferentes no mesmo mês', () => {
    const primeira = mergeBoletos([], bs, opts());
    const r = mergeBoletos(primeira.boletos, bs, { ...opts(), despesaId: 'd2' });
    expect(r.adicionados).toBe(11);
    expect(r.boletos).toHaveLength(22);
  });

  it('não muta a lista original', () => {
    const orig = [];
    mergeBoletos(orig, bs, opts());
    expect(orig).toHaveLength(0);
  });
});
