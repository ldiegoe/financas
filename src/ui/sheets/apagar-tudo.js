// Sheet "Apagar tudo" — só é aberto quando o Dropbox está conectado (a
// condição fica no app.js, na view de Configurações). Oferece apagar só neste
// aparelho (preservando a cópia na nuvem) ou em todo lugar.
// Fábrica: recebe as deps de runtime do app e devolve `sheetApagarTudo()`.
//
// `getActiveProfileId` é um getter porque `activeProfileId` é `let` no app.js —
// injetar o valor congelaria o binding. Mesmo padrão do createSyncEngine.

export const createSheetApagarTudo = (deps) => {
  const {
    openSheet, closeSheet, db, render, toast,
    syncDisconnect, syncPushProfile, syncPushMeta, getActiveProfileId,
  } = deps;

  // O card É o botão: título + a consequência em uma linha. Nada de caixa de
  // texto seguida de botão repetindo o mesmo rótulo.
  const chevron = `<svg class="ac-chevron" viewBox="0 0 12 12" width="16" height="16" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const card = (id, cls, titulo, sub) => `
    <button type="button" class="action-card ${cls}" id="${id}">
      <span class="ac-body">
        <span class="ac-title">${titulo}</span>
        <span class="ac-sub">${sub}</span>
      </span>
      ${chevron}
    </button>`;

  return () => {
    openSheet('Apagar tudo', () => `
      ${card('scope-local', '', 'Só neste aparelho',
        'A cópia no Dropbox e nos outros aparelhos fica intacta.')}
      ${card('scope-all', 'danger', 'Apagar em todo lugar',
        'Apaga também no Dropbox e nos outros aparelhos. Não dá pra desfazer.')}
      <div class="actions" style="flex-direction:column;">
        <button class="link" id="scope-cancel">Cancelar</button>
      </div>
    `, (body) => {
      body.querySelector('#scope-cancel').addEventListener('click', closeSheet);

      body.querySelector('#scope-local').addEventListener('click', () => {
        if (!confirm('Apagar os dados deste aparelho? A cópia no Dropbox será preservada.')) return;
        // Desconecta ANTES do reset: com syncState zerado, o persist() do reset
        // não agenda push, então a nuvem não é tocada.
        syncDisconnect();
        db.reset();
        closeSheet();
        toast('Dados apagados neste aparelho');
        render();
      });

      body.querySelector('#scope-all').addEventListener('click', async () => {
        if (!confirm('Isso apaga também no Dropbox e nos seus outros aparelhos. Continuar?')) return;
        db.reset();
        closeSheet();
        // Empurra o estado vazio na hora (sem esperar o debounce) pra garantir
        // que a nuvem reflita o apagamento mesmo se o app fechar em seguida.
        try {
          await syncPushProfile(getActiveProfileId());
          await syncPushMeta();
          toast('Apagado aqui e no Dropbox');
        } catch {
          toast('Apagado aqui; falha ao apagar no Dropbox');
        }
        render();
      });
    });
  };
};
