// Service Worker — cache offline + auto-update no celular
const CACHE = 'financas-v25';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Permite que a página force a troca para uma versão nova já instalada.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estratégia: HTML / app.js / app.css / manifest sempre tentam rede primeiro
// (com fallback no cache se estiver offline). Demais assets vão direto do
// cache para velocidade. Isso garante que mudanças em código apareçam logo
// na próxima abertura, mesmo com a PWA fixada na tela inicial.
const NETWORK_FIRST = /\/(index\.html|app\.js|app\.css|manifest\.webmanifest|sw\.js)$|\/$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isAppShell = url.origin === self.location.origin && NETWORK_FIRST.test(url.pathname);

  if (isAppShell) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
  } else {
    // cache-first com revalidação em background (assets estáticos / CDN)
    e.respondWith(
      caches.match(req).then(cached => {
        const fetchPromise = fetch(req).then(res => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
