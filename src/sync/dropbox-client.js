// Cliente Dropbox: PKCE OAuth + chamadas REST (upload/download/list/account).
// Helpers puros são exportados pra testabilidade; a factory injeta dependências
// (syncState, persist, storage de verifier) pra manter o módulo testável.

// ---------- Helpers PKCE (puros) ----------

// Codifica buffer em base64url (RFC 7515).
export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

// Gera um code_verifier aleatório de 32 bytes (256 bits).
export const randomVerifier = () => {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return b64url(arr);
};

// SHA-256 -> base64url do hash. Usado como `code_challenge` no PKCE.
export const sha256B64 = async (str) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return b64url(buf);
};

// Monta a URL de autorização do Dropbox (PKCE + offline pra refresh token).
export const buildAuthURL = ({ appKey, redirectUri, challenge }) => {
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params}`;
};

// ---------- Factory do client (com side effects controlados) ----------

// deps:
//   appKey               — App key da Dropbox console
//   getRedirectUri()     — function → string (location.origin + pathname)
//   getSyncState()       — function → o objeto syncState (com tokens)
//   persistSyncState()   — function pra salvar o syncState atual
//   onRefreshFailed()    — chamado se refresh token estiver inválido
//   getVerifier()        — function → verifier salvo, ou null
//   setVerifier(v)       — salva verifier; v=null/'' limpa
export const createDropboxClient = (deps) => {
  const {
    appKey, getRedirectUri, getSyncState, persistSyncState,
    onRefreshFailed, getVerifier, setVerifier,
  } = deps;

  const authURL = async () => {
    const verifier = randomVerifier();
    setVerifier(verifier);
    const challenge = await sha256B64(verifier);
    return buildAuthURL({ appKey, redirectUri: getRedirectUri(), challenge });
  };

  const exchangeCode = async (code) => {
    const verifier = getVerifier();
    if (!verifier) throw new Error('verifier ausente');
    const params = new URLSearchParams({
      code, grant_type: 'authorization_code',
      code_verifier: verifier, client_id: appKey,
      redirect_uri: getRedirectUri(),
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`OAuth ${res.status}`);
    setVerifier(null);
    return res.json();
  };

  const refreshAccessToken = async () => {
    const ss = getSyncState();
    if (!ss.refreshToken) throw new Error('sem refresh token');
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ss.refreshToken,
      client_id: appKey,
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (res.status === 400 || res.status === 401) {
      // Refresh token inválido — usuário precisa reconectar.
      onRefreshFailed();
      throw new Error('reconecte');
    }
    if (!res.ok) throw new Error(`refresh ${res.status}`);
    const data = await res.json();
    ss.accessToken = data.access_token;
    ss.accessTokenExpiresAt = Date.now() + ((data.expires_in || 14400) - 60) * 1000;
    persistSyncState();
  };

  const ensureToken = async () => {
    const ss = getSyncState();
    if (ss.accessToken && Date.now() < (ss.accessTokenExpiresAt || 0) - 30000) {
      return ss.accessToken;
    }
    await refreshAccessToken();
    return getSyncState().accessToken;
  };

  const upload = async (path, contentStr) => {
    const token = await ensureToken();
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
        'Content-Type': 'application/octet-stream',
      },
      body: contentStr,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    return res.json();
  };

  const download = async (path) => {
    const token = await ensureToken();
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });
    if (res.status === 409) return null; // arquivo não existe
    if (!res.ok) throw new Error(`download ${res.status}`);
    const meta = JSON.parse(res.headers.get('Dropbox-API-Result'));
    const text = await res.text();
    return { meta, text };
  };

  const list = async () => {
    const token = await ensureToken();
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: false }),
    });
    if (res.status === 409) return { entries: [] }; // pasta não existe ainda
    if (!res.ok) throw new Error(`list ${res.status}`);
    return res.json();
  };

  const account = async () => {
    const token = await ensureToken();
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`account ${res.status}`);
    return res.json();
  };

  return { authURL, exchangeCode, refreshAccessToken, ensureToken, upload, download, list, account };
};
