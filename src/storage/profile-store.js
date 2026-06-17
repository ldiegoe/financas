// Storage de perfis (meta + state por perfil). Factory que recebe um adapter
// `storage` (compatível com localStorage: getItem/setItem/removeItem) — assim
// o módulo é testável com storage em memória.

export const createProfileStore = ({ storage, profilesKey, profilePrefix, defaultState }) => ({
  // meta = { list: [{id, name}, ...], current: id }
  meta() {
    try { return JSON.parse(storage.getItem(profilesKey)) || null; }
    catch { return null; }
  },
  setMeta(m) {
    storage.setItem(profilesKey, JSON.stringify(m));
  },
  // Carrega state do perfil. Defaults preenchem campos faltantes (migração leve).
  loadState(id) {
    try {
      const raw = storage.getItem(`${profilePrefix}${id}`);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch { return defaultState(); }
  },
  saveState(id, s) {
    storage.setItem(`${profilePrefix}${id}`, JSON.stringify(s));
  },
  removeState(id) {
    storage.removeItem(`${profilePrefix}${id}`);
  },
});

// Cria uma nova entrada `meta` inicial (com legacy migration se houver). Pura,
// retorna a nova meta — caller persiste. O `migrateLegacy` é opcional: se
// retornar string, é gravado como state do perfil novo.
export const initialMeta = (uid, defaultName = 'Pessoal') => {
  const id = uid();
  return { list: [{ id, name: defaultName }], current: id };
};
