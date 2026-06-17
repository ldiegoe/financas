// Utilitários DOM. NÃO são puros (tocam document), mas centralizam o pouco
// que faz side effect — facilita testes que mockem document via jsdom no
// futuro. Toast e Sheet/Modal são instanciados com factories pra permitir
// injetar elementos diferentes nos testes.

// Factory de toast: passa o elemento que receberá o conteúdo + classe `.show`.
// Retorna `toast(msg)` que pulsa a mensagem por `durationMs`.
export const createToast = (el, durationMs = 2000) => {
  let timer = null;
  return (msg) => {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), durationMs);
  };
};

// Factory de sheet/modal: o elemento `root` recebe o markup do sheet.
// `contentFn`/`onMount` mantêm a mesma assinatura do openSheet original.
// Retorna { open, close }.
export const createSheet = (root, { escapeHTML }) => {
  const open = (title, contentFn, onMount) => {
    if (!root) return;
    root.innerHTML = `
      <div class="sheet-backdrop" data-close>
        <div class="sheet" role="dialog" aria-modal="true">
          <h3>${escapeHTML(title)}</h3>
          <div class="sheet-body"></div>
        </div>
      </div>`;
    const body = root.querySelector('.sheet-body');
    body.innerHTML = contentFn();
    root.querySelector('[data-close]').addEventListener('click', (e) => {
      if (e.target.dataset.close !== undefined) close();
    });
    if (onMount) onMount(body);
  };
  const close = () => { if (root) root.innerHTML = ''; };
  return { open, close };
};
