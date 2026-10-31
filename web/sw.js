// Funciona sin conexión: guarda la app y las librerías 3D tras la primera visita.
const CACHE = "cc-v1";
const CORE = ["./", "./index.html", "./app.js", "./core.js", "./vera.html", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), own = url.origin === location.origin;
  // Archivos propios: primero la red (siempre la última versión), y si no hay conexión, la copia guardada.
  // Librerías externas (Three.js, fuentes): primero la copia guardada.
  e.respondWith(own
    ? fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    : caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })));
});
