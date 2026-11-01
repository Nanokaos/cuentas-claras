// Voz de Vera (síntesis del sistema, gratis y sin red) y dictado (reconocimiento del navegador).

const synth = window.speechSynthesis;
let voices = [], unlocked = false;
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

/** Mejor voz en español de España disponible; si no, cualquier español. */
function pickVoice() {
  const es = voices.filter((v) => /^es/i.test(v.lang));
  return es.find((v) => /es[-_]ES/i.test(v.lang) && /google|neural|natural|online/i.test(v.name))
    || es.find((v) => /es[-_]ES/i.test(v.lang)) || es[0] || null;
}

/** En móviles la voz solo arranca tras un toque del usuario: se desbloquea con el primero. */
export function unlockVoice() {
  try { const ac = audioCtx(); if (ac?.state === "suspended") ac.resume(); } catch {}
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u);
}

export const canSpeak = () => !!synth || !!(cfg.fishKey && cfg.fishVoice);

// ---------------- Voz clonada (Fish Audio) ----------------
// Si hay clave e identificador de voz, Vera habla con la voz clonada; si algo falla, vuelve a la voz del móvil.
const cfg = { fishKey: "", fishVoice: "", proxy: "", robot: 0 };
let ctx = null, current = null, aborter = null, fishDownUntil = 0;
export const fishState = { ok: null, error: "" };
const cache = new Map(); // texto → ArrayBuffer (las frases repetidas no gastan)
export function configure(o) {
  const changed = o.fishKey !== cfg.fishKey || o.fishVoice !== cfg.fishVoice || o.proxy !== cfg.proxy;
  Object.assign(cfg, o); if (changed) { fishDownUntil = 0; fishState.ok = null; fishState.error = ""; cache.clear(); }
}
const fishOn = () => !!(cfg.fishKey && cfg.fishVoice) && Date.now() > fishDownUntil;
function audioCtx() { if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); } return ctx; }

function cleanText(text) {
  // Lee los importes como se dicen: «12,50 €» → «12,50 euros».
  // Nada de leer símbolos: asteriscos, almohadillas, barras, guiones bajos, comillas, emojis...
  return text.replace(/ /g, " ").replace(/€/g, " euros").replace(/%/g, " por ciento")
    .replace(/https?:\/\/\S+/g, "").replace(/[*#_`~|<>\[\]{}\\^=+«»"“”]/g, " ")
    .replace(/\s\/\s/g, " ").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

async function fishAudio(text, signal) {
  if (cache.has(text)) return cache.get(text).slice(0);
  const url = cfg.proxy ? cfg.proxy.replace(/\/$/, "") + "/fish" : "https://api.fish.audio/v1/tts";
  let r;
  try {
    r = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.fishKey}`, model: "s2.1-pro-free" },
      body: JSON.stringify({ text, reference_id: cfg.fishVoice, format: "mp3", mp3_bitrate: 64, latency: "balanced", normalize: true, language: "es" }) });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw Object.assign(new Error(cfg.proxy ? "No puedo contactar con el intermediario." : "El navegador ha bloqueado la conexión directa con Fish Audio. Hace falta el intermediario gratuito (Ajustes › Voz)."), { soft: true });
  }
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json()).message || ""; } catch {}
    const why = r.status === 401 ? "La clave de Fish Audio no es válida." : r.status === 402 ? "Fish Audio pide pago: se acabó lo gratuito o el saldo." : r.status === 404 || /reference|model/i.test(msg) ? "No encuentro esa voz. Revisa el identificador." : r.status === 503 || r.status === 429 ? "Fish Audio está saturado; uso la voz del móvil un rato." : `Fish Audio ha fallado (${r.status}).`;
    throw Object.assign(new Error(why), { soft: r.status === 503 || r.status === 429 });
  }
  const buf = await r.arrayBuffer();
  cache.set(text, buf.slice(0)); if (cache.size > 40) cache.delete(cache.keys().next().value);
  return buf;
}

/** Cadena de efectos: un toque metálico (eco corto con realimentación) y modulación en anillo suave. */
function chain(ac, src, amount) {
  const out = ac.createGain(); out.gain.value = 1;
  if (!amount) { src.connect(out); out.connect(ac.destination); return; }
  const a = amount / 100;
  const dry = ac.createGain(); dry.gain.value = 1 - a * .45;
  const delay = ac.createDelay(); delay.delayTime.value = .011;
  const fb = ac.createGain(); fb.gain.value = .35 + a * .3;
  const wet = ac.createGain(); wet.gain.value = a * .6;
  const ring = ac.createGain(); ring.gain.value = 0;
  const osc = ac.createOscillator(); osc.frequency.value = 38; const depth = ac.createGain(); depth.gain.value = a * .5;
  osc.connect(depth); depth.connect(ring.gain); osc.start();
  const ringOut = ac.createGain(); ringOut.gain.value = a * .5;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120 + a * 180;
  src.connect(dry); dry.connect(hp);
  src.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(hp);
  src.connect(ring); ring.connect(ringOut); ringOut.connect(hp);
  hp.connect(out); out.connect(ac.destination);
  src.onended = () => { try { osc.stop(); } catch {} };
}

async function sayFish(clean, onState) {
  aborter?.abort(); aborter = new AbortController();
  const ac = audioCtx(); if (!ac) throw new Error("Este navegador no reproduce audio.");
  if (ac.state === "suspended") await ac.resume().catch(() => {});
  const buf = await fishAudio(clean, aborter.signal);
  const data = await ac.decodeAudioData(buf);
  stopCurrent();
  const src = ac.createBufferSource(); src.buffer = data; chain(ac, src, cfg.robot);
  current = src; fishState.ok = true; fishState.error = "";
  return new Promise((resolve) => { src.onended = ((prev) => () => { prev?.(); if (current === src) current = null; onState?.(false); resolve(); })(src.onended); onState?.(true); src.start(); });
}
function stopCurrent() { if (current) { try { current.stop(); } catch {} current = null; } }

/**
 * Habla: con la voz clonada si está configurada; si no (o si falla), con la del sistema en tono grave.
 * Devuelve una promesa que se resuelve al terminar. onState avisa de inicio y fin (para animar a Vera).
 */
export async function say(text, { rate = 1.02, pitch = .62, onState } = {}) {
  if (!text) return;
  const clean = cleanText(text); if (!clean) return;
  synth?.cancel(); stopCurrent();
  if (fishOn()) {
    try { return await sayFish(clean, onState); }
    catch (err) {
      if (err.name === "AbortError") return;
      fishState.ok = false; fishState.error = err.message;
      fishDownUntil = Date.now() + (err.soft ? 5 * 60e3 : 30 * 60e3);
      console.warn("Fish Audio:", err.message);
    }
  }
  return saySystem(clean, { rate, pitch, onState });
}
/** Prueba la voz clonada y devuelve el error si lo hay (para Ajustes). */
export async function testFish(text) {
  fishDownUntil = 0; cache.delete(cleanText(text));
  try { await sayFish(cleanText(text)); return null; } catch (err) { fishState.ok = false; fishState.error = err.message; return err.message; }
}
function saySystem(clean, { rate, pitch, onState }) {
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = v?.lang || "es-ES"; u.rate = rate; u.pitch = pitch;
    u.onstart = () => onState?.(true);
    u.onend = u.onerror = () => { onState?.(false); resolve(); };
    synth.speak(u);
    // Algunos Android se quedan colgados con textos largos: se reanuda si se pausa sola.
    const keep = setInterval(() => { if (!synth.speaking) clearInterval(keep); else if (synth.paused) synth.resume(); }, 4000);
  });
}
export const stopVoice = () => { aborter?.abort(); stopCurrent(); synth?.cancel(); };

// ---------------- Dictado ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;

const ERRORS = {
  "not-allowed": "No tengo permiso para usar el micrófono. Actívalo en los permisos del navegador para esta web.",
  "service-not-allowed": "Este navegador no permite dictar aquí (pasa en algunos iPhone con la app instalada). Ábrela en Safari o Chrome, o usa el micrófono del teclado.",
  "audio-capture": "No encuentro el micrófono. Revisa que no lo esté usando otra app.",
  "network": "El dictado necesita conexión a internet en este navegador.",
  "no-speech": "No te he oído. Pulsa el micrófono y habla justo después.",
  "aborted": "",
  "language-not-supported": "Este navegador no dicta en español de España.",
};

/**
 * Escucha una frase. onPartial recibe el texto parcial; resuelve con el texto final ("" si no hubo nada).
 * Rechaza con un mensaje en español si algo falla.
 */
export function listen(onPartial) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error("Este navegador no permite dictar. Usa Chrome en Android o Safari en iPhone, o el micrófono del teclado."));
    stopVoice();
    const rec = new SR();
    rec.lang = "es-ES"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = "", partial = "", failed = null, aborted = false;
    rec.onresult = (e) => {
      partial = ""; finalText = "";
      for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else partial += r[0].transcript; }
      onPartial?.((finalText + " " + partial).trim());
    };
    rec.onerror = (e) => { failed = ERRORS[e.error] ?? `El dictado ha fallado (${e.error}).`; };
    rec.onend = () => {
      listen.active = false;
      if (aborted) return resolve("");
      const text = (finalText || partial).trim();
      if (text) resolve(text);
      else if (failed) reject(new Error(failed)); else resolve("");
    };
    try { rec.start(); listen.active = true; } catch (err) { listen.active = false; reject(new Error("No he podido arrancar el dictado: " + err.message)); }
    listen.stop = () => { try { rec.stop(); } catch (_) {} };
    /** Cierra el micro y descarta lo oído. */
    listen.abort = () => { aborted = true; try { rec.abort(); } catch (_) { resolve(""); } };
  });
}
