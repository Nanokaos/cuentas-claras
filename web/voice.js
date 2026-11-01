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
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u);
}

export const canSpeak = () => !!synth;

/**
 * Habla con un tono grave y uniforme para sonar más a máquina. Devuelve una promesa que se resuelve al terminar.
 * @param {(on:boolean)=>void} onState avisa de inicio y fin (para animar a Vera).
 */
export function say(text, { rate = 1.02, pitch = .62, onState } = {}) {
  if (!synth || !text) return Promise.resolve();
  synth.cancel();
  // Lee los importes como se dicen: «12,50 €» → «12,50 euros».
  // Nada de leer símbolos: asteriscos, almohadillas, barras, guiones bajos, comillas, emojis...
  const clean = text.replace(/\u00A0/g, " ").replace(/€/g, " euros").replace(/%/g, " por ciento")
    .replace(/https?:\/\/\S+/g, "").replace(/[*#_`~|<>\[\]{}\\^=+«»"“”]/g, " ")
    .replace(/\s\/\s/g, " ").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s{2,}/g, " ").trim();
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
export const stopVoice = () => synth?.cancel();

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
    let finalText = "", partial = "", failed = null;
    rec.onresult = (e) => {
      partial = ""; finalText = "";
      for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else partial += r[0].transcript; }
      onPartial?.((finalText + " " + partial).trim());
    };
    rec.onerror = (e) => { failed = ERRORS[e.error] ?? `El dictado ha fallado (${e.error}).`; };
    rec.onend = () => {
      const text = (finalText || partial).trim();
      if (text) resolve(text);
      else if (failed) reject(new Error(failed)); else resolve("");
    };
    try { rec.start(); } catch (err) { reject(new Error("No he podido arrancar el dictado: " + err.message)); }
    listen.stop = () => { try { rec.stop(); } catch (_) {} };
  });
}
