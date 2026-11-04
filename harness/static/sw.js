// Service worker: offline app shell, and showing reminders.
const SHELL = 'zg-shell-v6';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './base.css',
  './theme/tokens.css', './theme/theme.css', './theme/icons/icon-192-v10.png', './theme/icons/icon-512-v10.png',
  './theme/icons/icon-maskable-512-v10.png', './theme/icons/apple-touch-icon-v10.png', './theme/icons/favicon-32-v10.png',
  './theme/icons/favicon-v10.ico',
  './sounds/kick.mp3', './sounds/snare.mp3', './sounds/rim.mp3', './sounds/hihat.mp3', './sounds/hihatOpen.mp3', './sounds/ride.mp3'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first, so updates arrive at once; the cached copy when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'Practice', body: 'A session is ready.', windowId: 'session', silent: false, url: './' };
  try {
    data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, tag: `zg-${data.windowId}`, silent: !!data.silent, data: { url: data.url } }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(e.notification.data?.url || './');
    }),
  );
});
