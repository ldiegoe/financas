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
//
// `leave` e `duracaoSaida` são injetados: o sheet ENTRA animado (slideUp) e
// antes saía como interruptor. `duracaoSaida()` é função porque a resposta
// muda em tempo de execução — volta 0 quando o usuário pede menos movimento.
//
// Retorna { open, close }.
export const createSheet = (root, { escapeHTML, leave = null, duracaoSaida = () => 0 }) => {
  // Conta quantos sheets já foram abertos. É o que distingue "este sheet ainda
  // é o meu" de "outro tomou o lugar enquanto eu saía" — ver o guard no close.
  let geracao = 0;

  const open = (title, contentFn, onMount) => {
    if (!root) return;
    geracao++;
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

  const close = () => {
    if (!root) return;
    const backdrop = root.querySelector('.sheet-backdrop');
    const duracao = duracaoSaida();
    // Sem nada aberto, sem animação disponível ou com movimento desligado:
    // limpa na hora, como sempre foi.
    if (!backdrop || !leave || !(duracao > 0)) { root.innerHTML = ''; return; }

    const minhaGeracao = geracao;
    // A classe vai só no backdrop; o CSS anima ele e o .sheet lá dentro.
    leave([backdrop], { duracao, classe: 'sheet-leaving' }, () => {
      // GUARD: se outro sheet abriu enquanto este saía, o innerHTML já é dele
      // e limpar aqui apagaria a tela nova. Não é hipótese — o app faz
      // `closeSheet(); sheetX()` em pelo menos dois lugares (detalhes.js e
      // categoria-historico.js).
      if (geracao !== minhaGeracao) return;
      root.innerHTML = '';
    });
  };

  return { open, close };
};
