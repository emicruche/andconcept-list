const CACHE = 'andconcept-v21';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './i18n.js',
  './manifest.json',
  './icon-noel-192.png', './icon-noel-512.png', './icon-noel-maskable.png',
  './icon-store-192.png', './icon-store-512.png', './icon-store-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Jamais de cache pour l'API : les données doivent toujours venir du
  // serveur (sinon les listes et réservations restent figées au cache).
  if (url.pathname.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Fichiers statiques : cache d'abord, réseau en secours.
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => cached)
    )
  );
});
