// Engine de sincronização: orchestra pull/push contra um client de nuvem
// (Dropbox por enquanto). Cada perfil sincroniza em arquivo próprio.
// LWW por arquivo via server_modified.
//
// Tudo que envolve side effects de fetch fica no client. Aqui orquestra o
// fluxo: lista, compara timestamps, baixa só os novos, sobe debounced.

// ---------- Constantes / helpers puros ----------

export const META_FILE_PATH = '/meta.json';
export const profileFilePath = (id) => `/profile-${id}.json`;
export const DEBOUNCE_PUSH_MS = 5000;

// Empacota o payload no formato sincronizado.
// `now`: ms desde epoch (injetado pra testes determinísticos).
export const wrapPayload = (payload, deviceIdValue, now = Date.now()) =>
  JSON.stringify({ v: 1, ts: now, device: deviceIdValue, payload });

// "há 2 min", "há 3 h", "há 1 dia", etc. Injetar `now` em testes.
export const syncRelativeTime = (ts, now = Date.now()) => {
  if (!ts) return '—';
  const diff = now - ts;
  if (diff < 0) return 'agora';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'agora há pouco';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr} h`;
  const days = Math.floor(hr / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
};

// ---------- Factory do engine ----------
// deps:
//   client                 — DropboxClient (.list/.upload/.download)
//   profileStore           — { meta, setMeta, loadState, saveState }
//   deviceConfig           — { get, applyOverlay }
//   getSyncState()         — function → syncState (mutável)
//   persistSyncState()     — salva o syncState atual
//   getActiveProfileId()   — qual perfil tá ativo (mutável)
//   getDeviceId()          — id gerado/persistido por device
//   backupBeforePull(key, contentStr)
//                          — chamado antes de sobrescrever local
//   onAfterApplyMeta(payload)
//                          — callback pra reaplicar meta in-memory
//   onAfterApplyProfile(profileId, payload)
//                          — callback se o perfil ativo precisar reload
export const createSyncEngine = (deps) => {
  const {
    client, profileStore, deviceConfig,
    getSyncState, persistSyncState,
    getActiveProfileId, getDeviceId,
    backupBeforePull, onAfterApplyMeta, onAfterApplyProfile,
  } = deps;

  const buildProfileContent = (profileId) =>
    wrapPayload(profileStore.loadState(profileId), getDeviceId());

  const buildMetaContent = () =>
    wrapPayload({ meta: profileStore.meta(), deviceConfig: deviceConfig.get() }, getDeviceId());

  // Baixa arquivos cuja versão remota é mais nova que a sincronizada por aqui.
  // Retorna { pulled, affectedActiveProfile, affectedMeta }.
  const pull = async () => {
    const ss = getSyncState();
    if (!ss.provider) return { pulled: 0, affectedActiveProfile: false, affectedMeta: false };
    const list = await client.list();
    let pulled = 0;
    let affectedActiveProfile = false;
    let affectedMeta = false;
    for (const entry of list.entries || []) {
      if (entry['.tag'] !== 'file') continue;
      const localTs = ss.filesSyncedAt?.[entry.name] || 0;
      const remoteTs = new Date(entry.server_modified).getTime();
      if (remoteTs <= localTs) continue;
      const downloaded = await client.download(entry.path_lower);
      if (!downloaded) continue;
      let envelope;
      try { envelope = JSON.parse(downloaded.text); } catch { continue; }
      if (envelope.device === getDeviceId()) {
        // Push próprio voltando — só atualiza timestamp local.
      } else if (entry.name === 'meta.json') {
        if (envelope.payload?.meta || envelope.payload?.deviceConfig) {
          if (backupBeforePull) backupBeforePull('meta-bundle', JSON.stringify(envelope.payload));
          if (envelope.payload?.meta) profileStore.setMeta(envelope.payload.meta);
          if (envelope.payload?.deviceConfig) deviceConfig.update(envelope.payload.deviceConfig);
          if (onAfterApplyMeta) onAfterApplyMeta(envelope.payload);
          affectedMeta = true;
        }
      } else if (entry.name.startsWith('profile-') && entry.name.endsWith('.json')) {
        const profileId = entry.name.replace(/^profile-/, '').replace(/\.json$/, '');
        if (backupBeforePull) backupBeforePull(`profile-${profileId}`, downloaded.text);
        profileStore.saveState(profileId, envelope.payload);
        if (profileId === getActiveProfileId()) affectedActiveProfile = true;
        if (onAfterApplyProfile) onAfterApplyProfile(profileId, envelope.payload);
      }
      ss.filesSyncedAt = { ...(ss.filesSyncedAt || {}), [entry.name]: remoteTs };
      pulled++;
    }
    ss.lastSyncAt = Date.now();
    persistSyncState();
    return { pulled, affectedActiveProfile, affectedMeta };
  };

  const pushProfile = async (profileId) => {
    const ss = getSyncState();
    if (!ss.provider) return;
    const content = buildProfileContent(profileId);
    const result = await client.upload(profileFilePath(profileId), content);
    const remoteTs = new Date(result.server_modified).getTime();
    ss.filesSyncedAt = {
      ...(ss.filesSyncedAt || {}),
      [`profile-${profileId}.json`]: remoteTs,
    };
    ss.lastSyncAt = Date.now();
    persistSyncState();
  };

  const pushMeta = async () => {
    const ss = getSyncState();
    if (!ss.provider) return;
    const content = buildMetaContent();
    const result = await client.upload(META_FILE_PATH, content);
    const remoteTs = new Date(result.server_modified).getTime();
    ss.filesSyncedAt = {
      ...(ss.filesSyncedAt || {}),
      ['meta.json']: remoteTs,
    };
    ss.lastSyncAt = Date.now();
    persistSyncState();
  };

  // Debouncer: rajadas de mudanças viram 1 push após DEBOUNCE_PUSH_MS de silêncio.
  let pushTimer = null;
  const schedulePushDebounced = (onError) => {
    const ss = getSyncState();
    if (!ss.provider || ss.autoSync === false) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      try {
        await pushProfile(getActiveProfileId());
        await pushMeta();
      } catch (err) {
        if (onError) onError(err);
      }
    }, DEBOUNCE_PUSH_MS);
  };

  return { pull, pushProfile, pushMeta, schedulePushDebounced };
};
