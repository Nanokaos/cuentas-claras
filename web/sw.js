// Veranza: funciona sin conexión y manda la frase diaria de Vera.
import { dailyNote } from "./daily.js";

const CACHE = "cc-v9";
const CORE = ["./", "./index.html", "./app.js", "./core.js", "./voice.js", "./ai.js", "./importer.js", "./daily.js", "./vera.html", "./manifest.webmanifest", "./icon-192.png", "./badge.png", "./splash.jpg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), own = url.origin === location.origin;
  // Archivos propios: primero la red (siempre la última versión), y si no hay conexión, la copia guardada.
  // Librerías externas (Three.js, fuentes): primero la copia guardada.
  e.respondWith(own
    ? fetch(e.request, { cache: "no-cache" }).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    : caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })));
});

// ——— Notificación diaria ———
async function showDaily({ force = false, mustShow = false } = {}) {
  let note = null;
  try { note = await dailyNote({ force }); if (!note && mustShow) note = await dailyNote({ force: true, useAI: false }); } catch (err) { console.warn(err); }
  if (!note && mustShow) note = { title: "Vera", body: "Abre Veranza: tengo cuentas que comentarte." };
  if (!note) return;
  await self.registration.showNotification(note.title, { body: note.body, icon: "icon-192.png", badge: "badge.png", tag: "vera-diaria", renotify: true, lang: "es-ES", data: { url: "./#inicio" } });
}
// Aviso de GitHub Actions a las 10:00 (hora de Madrid). Siempre hay que enseñar algo.
self.addEventListener("push", (e) => { e.waitUntil(showDaily({ mustShow: true })); });
// Respaldo sin servidor (Chrome en Android con la app instalada): el sistema despierta la app de vez en cuando.
self.addEventListener("periodicsync", (e) => {
  if (e.tag !== "vera-diaria") return;
  const h = new Date().getHours(); e.waitUntil(h >= 10 && h < 22 ? showDaily() : Promise.resolve());
});
// La app pide una prueba o recupera la de hoy si no llegó.
self.addEventListener("message", (e) => {
  if (e.data?.type === "daily-test") e.waitUntil(showDaily({ force: true, mustShow: true }));
  if (e.data?.type === "daily-catchup") e.waitUntil(showDaily());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes(self.registration.scope)); if (c) return c.focus();
    return self.clients.openWindow(e.notification.data?.url || "./");
  }));
});
