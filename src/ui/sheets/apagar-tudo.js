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

  return () => {
    const optStyle = 'border:1px solid var(--separator);border-radius:12px;padding:12px 14px;margin-bottom:10px;';
    openSheet('Apagar tudo', () => `
      <p style="color:var(--text-2);font-size:14px;line-height:1.5;margin:0 0 14px;">
        O Dropbox está conectado. Escolha o que apagar:
      </p>
      <div style="${optStyle}">
        <strong>Só neste aparelho</strong>
        <p style="color:var(--text-2);font-size:13px;line-height:1.45;margin:6px 0 0;">
          Desconecta o Dropbox e apaga os dados só aqui. Sua cópia na nuvem e nos
          outros aparelhos fica intacta — dá pra recuperar reconectando.
        </p>
      </div>
      <div style="${optStyle}">
        <strong style="color:var(--red);">Apagar em todo lugar</strong>
        <p style="color:var(--text-2);font-size:13px;line-height:1.45;margin:6px 0 0;">
          Apaga aqui e também no Dropbox e nos seus outros aparelhos.
          Não dá pra desfazer.
        </p>
      </div>
      <div class="actions" style="flex-direction:column;">
        <button class="secondary" id="scope-local">Só neste aparelho</button>
        <button class="danger"    id="scope-all">Apagar em todo lugar</button>
        <button class="link"      id="scope-cancel" style="margin-top:4px;">Cancelar</button>
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
