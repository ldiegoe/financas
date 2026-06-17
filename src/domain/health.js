// Domínio da saúde financeira. Tudo puro — recebe config como argumento.

// Defaults reproduzem os valores fixos originais do app.
// invest/gastos/fixo são percentuais; reserva é em meses.
export const HEALTH_META_DEFAULTS = { invest: 20, gastos: 70, fixo: 50, reserva: 6 };

// Lê as metas da config (state.config), com clamp e fallback pros defaults.
// Aceita números válidos > 0 e capa pelo `max` indicado.
export const healthMetas = (config) => {
  const cfg = config || {};
  const pick = (v, d, max) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? Math.min(n, max) : d;
  };
  return {
    invest:  pick(cfg.healthMetaInvest,  HEALTH_META_DEFAULTS.invest,  100),
    gastos:  pick(cfg.healthMetaGastos,  HEALTH_META_DEFAULTS.gastos,  100),
    fixo:    pick(cfg.healthMetaFixo,    HEALTH_META_DEFAULTS.fixo,    100),
    reserva: pick(cfg.healthMetaReserva, HEALTH_META_DEFAULTS.reserva, 60),
  };
};

// Sub-score 0–100 por indicador.
// `higher`=true → MAIOR é melhor (ex.: taxa de investimento).
// `higher`=false → MENOR é melhor (ex.: gastos/renda).
// good = limiar "verde"; warn = limiar "atenção". 60 representa o limite de
// "atenção" (warn); 100 = good. Decai linearmente fora dos limiares.
export const scoreOf = (v, good, warn, higher) => {
  let s;
  if (higher) {
    if (v >= good) s = 100;
    else if (v >= warn) s = 60 + 40 * (v - warn) / (good - warn);
    else s = warn > 0 ? 60 * (v / warn) : 0;
  } else {
    if (v <= good) s = 100;
    else if (v <= warn) s = 60 + 40 * (warn - v) / (warn - good);
    else {
      const cap = warn + (warn - good);
      s = v >= cap ? 0 : 60 * (cap - v) / (cap - warn);
    }
  }
  return Math.max(0, Math.min(100, s));
};

// Classe de cor (good/''/bad) baseada nos limiares — mesma lógica do scoreOf
// mas categórica. '' = neutro (entre warn e good).
export const colorClass = (v, good, warn, higher) => {
  if (higher) {
    if (v >= good) return 'good';
    if (v >= warn) return '';
    return 'bad';
  }
  if (v <= good) return 'good';
  if (v <= warn) return '';
  return 'bad';
};
