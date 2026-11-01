// Despierta a Veranza en los móviles suscritos para que Vera mande su frase de las 10:00 (hora de Madrid).
// El contenido lo calcula cada móvil con sus propios datos: aquí no se envía nada más que el aviso.
import webpush from "web-push";
import { readFileSync } from "node:fs";

const PUBLIC = "BE6gHAqKHgwMMoJO1QYMDJMvuPeuk2Fj0JgCSgkJzPdugQcwAxZ2_hGfyK-7KweGaNWBZkGz1t-8chWNTAQCYpw";
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const schedule = process.env.SCHEDULE || "";
if (!PRIVATE) { console.log("Falta el secreto VAPID_PRIVATE_KEY: no se envía nada."); process.exit(0); }

// Dos horarios en UTC (08:00 y 09:00); solo se usa el que corresponde a las 10:00 en Madrid según sea horario de verano o de invierno.
if (schedule) {
  const offset = (() => { const now = new Date(); const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(now)); return ((h - now.getUTCHours()) + 24) % 24; })();
  const utcFor10 = 10 - offset, scheduledUtc = Number(schedule.split(" ")[1]);
  if (scheduledUtc !== utcFor10) { console.log(`Este horario (${scheduledUtc}:00 UTC) no es las 10:00 en Madrid hoy (desfase +${offset}). Nada que hacer.`); process.exit(0); }
}

webpush.setVapidDetails("mailto:veranza@users.noreply.github.com", PUBLIC, PRIVATE);
const subs = JSON.parse(readFileSync(new URL("./subs.json", import.meta.url)));
if (!subs.length) { console.log("No hay móviles suscritos todavía."); process.exit(0); }
let ok = 0;
for (const s of subs) {
  try { await webpush.sendNotification(s, JSON.stringify({ type: "daily" }), { TTL: 4 * 3600, urgency: "high" }); ok++; }
  catch (err) { console.log("Fallo con una suscripción:", err.statusCode, err.body); }
}
console.log(`Avisos enviados: ${ok} de ${subs.length}.`);
