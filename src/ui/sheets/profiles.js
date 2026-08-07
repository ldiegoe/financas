// Sheets de perfis: lista (chip da topbar), criar e renomear.
// Os três moram juntos porque sheetProfiles chama sheetNewProfile — no mesmo
// módulo a chamada resolve internamente, sem injeção circular.
//
// Atenção: switchProfile e createProfile fazem location.reload() no app.js —
// o código depois delas não executa. É por isso que não há closeSheet()/toast()
// em seguida. Intencional.

import { escapeHTML, escapeAttr } from '../escape.js';

export const createSheetsProfiles = (deps) => {
  const {
    openSheet, closeSheet, render, toast,
    profileStore, switchProfile, createProfile, renameProfile, applyProfileChip,
  } = deps;

  const sheetNewProfile = () => {
    openSheet('Novo perfil', () => `
      <label class="field"><span>Nome</span>
        <input id="f-pname" type="text" placeholder="Ex.: Empresa, Família, Viagem" required />
      </label>
      <p style="color:var(--text-2);font-size:13px;margin:0;">
        Vai começar vazio com as categorias padrão. Você troca entre perfis a qualquer momento pelo nome no topo.
      </p>
      <div class="actions">
        <button class="secondary" id="cancel">Cancelar</button>
        <button class="primary"   id="create">Criar</button>
      </div>
    `, (body) => {
      body.querySelector('#cancel').addEventListener('click', closeSheet);
      const create = () => {
        const name = body.querySelector('#f-pname').value.trim();
        if (!name) { alert('Informe um nome.'); return; }
        createProfile(name);  // dispara reload
      };
      body.querySelector('#create').addEventListener('click', create);
      body.querySelector('#f-pname').focus();
    });
  };

  const sheetRenameProfile = (id) => {
    const meta = profileStore.meta();
    const p = meta.list.find(x => x.id === id);
    if (!p) return;
    openSheet('Renomear perfil', () => `
      <label class="field"><span>Nome</span>
        <input id="f-pname" type="text" value="${escapeAttr(p.name)}" required />
      </label>
      <div class="actions">
        <button class="secondary" id="cancel">Cancelar</button>
        <button class="primary"   id="save">Salvar</button>
      </div>
    `, (body) => {
      body.querySelector('#cancel').addEventListener('click', closeSheet);
      body.querySelector('#save').addEventListener('click', () => {
        const name = body.querySelector('#f-pname').value.trim();
        if (!name) { alert('Informe um nome.'); return; }
        renameProfile(id, name);
        closeSheet();
        toast('Perfil renomeado');
        render();
        applyProfileChip();
      });
      body.querySelector('#f-pname').focus();
    });
  };

  const sheetProfiles = () => {
    const meta = profileStore.meta();
    openSheet('Perfis', () => `
      <ul class="list" style="margin-bottom:14px;">
        ${meta.list.map(p => `
          <li class="profile-row" data-id="${p.id}" style="cursor:pointer;">
            <div class="grow">
              <div class="t">${escapeHTML(p.name)}</div>
            </div>
            ${p.id===meta.current ? '<span style="color:var(--tint);font-weight:600;">✓</span>' : ''}
          </li>
        `).join('')}
      </ul>
      <div class="actions">
        <button class="secondary" id="cancel">Fechar</button>
        <button class="primary"   id="new-profile">+ Novo perfil</button>
      </div>
    `, (body) => {
      body.querySelector('#cancel').addEventListener('click', closeSheet);
      body.querySelector('#new-profile').addEventListener('click', () => {
        closeSheet();
        sheetNewProfile();
      });
      body.querySelectorAll('.profile-row').forEach(li => {
        li.addEventListener('click', () => {
          const id = li.dataset.id;
          if (id !== meta.current) switchProfile(id);  // dispara reload
        });
      });
    });
  };

  return { sheetProfiles, sheetNewProfile, sheetRenameProfile };
};
