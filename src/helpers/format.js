// Helpers de formatação de valores e datas (puros, sem dependência de DOM).
// Convenção pt-BR: vírgula como separador decimal, ponto como milhar.

// "12345" centavos -> "R$ 123,45"  |  "1234567" -> "R$ 12.345,67"
export const fmtBRL = (cents) => {
  const value = (cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// "12345" centavos -> "123,45"  |  "1234567" -> "12.345,67"
// (sem o "R$" — usado em inputs de moeda)
export const formatCentsDisplay = (cents) => {
  if (!cents) return '';
  const reais = Math.floor(cents / 100);
  const c2    = String(cents % 100).padStart(2, '0');
  return `${reais.toLocaleString('pt-BR')},${c2}`;
};

// "2025-05-15" -> "15/05/2025"
export const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Número do mês -> nome do mês em pt-BR. short=true devolve abreviado.
export const monthName = (m, short = false) => {
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const sht   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return (short ? sht : names)[m - 1];
};

// Date -> "YYYY-MM"
export const yyyyMmFromDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Date -> "YYYY-MM-DD"
export const yyyyMmDdFromDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
