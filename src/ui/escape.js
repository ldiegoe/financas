// Escape de HTML/atributos — puros. Usados em todo lugar que interpolamos
// dados do usuário em template strings.

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Escapa caracteres reservados em texto HTML. Aceita null/undefined.
export const escapeHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, c => HTML_ENTITIES[c]);

// Mesma regra de HTML serve pra contexto de atributo (HTML5 padroniza).
export const escapeAttr = (s) => escapeHTML(s);
