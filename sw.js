// Omni service worker: keeps the app usable offline and always shows the newest version online.
// Build 0433132865.
// Why the fetch options matter: GitHub Pages sends Cache-Control: max-age=600, so a plain fetch()
// can be answered from the browser's HTTP cache with a copy up to 10 minutes old even when online.
// Every page and file here is revalidated with the server (cache: 'no-cache', cheap 304s via ETag),
// and version.json is never cached at all.
const CACHE = 'omni-0433132865';
// The landing page ('./' and index.html) is the 3D map; the tracker is tracker.html.
const SHELL = ['./', 'index.html', 'tracker.html', 'map.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the HTTP cache so the offline copy is this build, not an older one.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('omni-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Safari refuses a redirected response for a page load; rebuild it as a plain response.
const clean = res => res.redirected
  ? res.blob().then(b => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }))
  : res;

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(url.href, { cache: 'no-store' }).catch(() =>
      new Response('{}', { headers: { 'content-type': 'application/json' } })));
    return;
  }
  url.hash = '';
  const key = url.href.split('?')[0];
  // On weak signal, don't hang: after 6 seconds without an answer, show the saved copy instead.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin', signal: ctl.signal }).then(clean).then(res => {
      clearTimeout(timer);
      // Save a copy for offline use without holding this request open, so a new version can take over at once.
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}); }
      return res;
    }).catch(() => { clearTimeout(timer); return caches.match(key, { ignoreSearch: true })
      .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
      .then(r => r || Response.error()); })
  );
});
