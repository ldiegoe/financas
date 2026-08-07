// Faz o input se comportar como campo de moeda (estilo Nubank): cada dígito
// digitado entra pela direita como centavo, separadores são re-aplicados.
// Suporta também expressões: ao digitar +, -, *, / ou ( ele entra em "modo
// calculadora" — não formata enquanto edita e avalia no blur/save.

import { formatCentsDisplay } from '../helpers/format.js';
import { looksLikeExpression, evaluateExpression } from '../helpers/parse.js';

export const bindCurrencyInput = (input) => {
  const formatCurrency = () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) { input.value = ''; return; }
    input.value = formatCentsDisplay(parseInt(digits, 10));
    requestAnimationFrame(() => {
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch {}
    });
  };
  input.addEventListener('input', () => {
    if (looksLikeExpression(input.value)) return; // modo calculadora — sem formatar
    formatCurrency();
  });
  input.addEventListener('blur', () => {
    if (looksLikeExpression(input.value)) {
      const cents = evaluateExpression(input.value);
      if (cents > 0) input.value = formatCentsDisplay(cents);
    }
  });
  // Aceita dígitos, operadores e teclas de navegação.
  input.addEventListener('keydown', (e) => {
    const ok = /^[0-9+\-*/().,]$/.test(e.key)
      || ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End','Enter'].includes(e.key)
      || e.metaKey || e.ctrlKey;
    if (!ok) e.preventDefault();
    if (e.key === 'Enter' && looksLikeExpression(input.value)) {
      e.preventDefault();
      const cents = evaluateExpression(input.value);
      if (cents > 0) input.value = formatCentsDisplay(cents);
    }
  });
};
