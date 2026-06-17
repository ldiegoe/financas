// Storage do estado de sincronização (tokens Dropbox, timestamps por arquivo).
// SEPARADO do state do perfil pra: (a) tokens não vazarem no export JSON;
// (b) não trafegarem entre perfis; (c) sobreviverem a "reset all" se preferido.
// Factory pra ser testável.

export const createSyncStateStore = ({ storage, key }) => ({
  load() {
    try { return JSON.parse(storage.getItem(key)) || {}; }
    catch { return {}; }
  },
  save(state) {
    try { storage.setItem(key, JSON.stringify(state)); } catch {}
  },
  // Limpa o estado in-place pra preservar o ponteiro do caller, depois persiste vazio.
  clear(state) {
    if (state) for (const k of Object.keys(state)) delete state[k];
    try { storage.setItem(key, JSON.stringify({})); } catch {}
  },
});
