// Modo conversación: el micro queda abierto como en una llamada.
// Detecta cuándo hablas (por volumen), corta la frase al callarte, la transcribe con Whisper en Groq
// y se la pasa a Vera. Si hablas mientras Vera habla, ella baja la voz al instante y, si de verdad
// la estás interrumpiendo (no es su propio eco), se calla.
import * as Voice from "./voice.js";

const RATE = 16000;                 // Whisper trabaja a 16 kHz
const PREROLL = .45, END_SILENCE = .75, MIN_SPEECH = .35, MAX_UTTER = 25;
const JUNK = /(subt[ií]tulos|amara\.org|gracias por ver|suscr[ií]bete|transcripci[oó]n|♪)/i;

let st = null, starting = false; // estado de la sesión

/** Abre el micro y empieza a escuchar. opts: { key, proxy, onText, onState, onLevel } */
export async function start(opts) {
  if (st || starting) return;
  starting = true;
  try { await open(opts); } finally { starting = false; }
}
async function open(opts) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el micrófono de forma continua.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    .catch((e) => { throw new Error(e.name === "NotAllowedError" ? "No tengo permiso para el micrófono. Actívalo para esta web en los ajustes del navegador." : "No puedo abrir el micrófono: " + e.message); });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  if (ac.state === "suspended") await ac.resume().catch(() => {});
  const srcNode = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(2048, 1, 1);
  const mute = ac.createGain(); mute.gain.value = 0;
  srcNode.connect(proc); proc.connect(mute); mute.connect(ac.destination);
  st = { ...opts, stream, ac, proc, ratio: ac.sampleRate / RATE, ring: [], ringLen: 0, rec: null, recLen: 0,
    floor: -60, calib: [], speechT: 0, silenceT: 0, talking: false, barge: false, busy: false, queue: [], lock: null };
  try { st.lock = await navigator.wakeLock?.request("screen"); } catch {}
  proc.onaudioprocess = (e) => tick(e.inputBuffer.getChannelData(0), e.inputBuffer.duration);
  document.addEventListener("visibilitychange", onHide);
  opts.onState?.("escuchando");
}
export const active = () => !!st || starting;
export function stop() {
  if (!st) return;
  const s = st; st = null;
  try { s.proc.disconnect(); s.stream.getTracks().forEach((t) => t.stop()); s.ac.close(); s.lock?.release?.(); } catch {}
  document.removeEventListener("visibilitychange", onHide);
  Voice.duck(false);
  s.onState?.("cerrado");
}
function onHide() { if (document.hidden) stop(); }

/** Reduce a 16 kHz (media simple) para ahorrar subida. */
function down(buf) {
  const r = st.ratio, n = Math.floor(buf.length / r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; const s = Math.floor(i * r), e = Math.min(buf.length, Math.floor((i + 1) * r)); for (let k = s; k < e; k++) a += buf[k]; out[i] = a / Math.max(1, e - s); }
  return out;
}

function tick(input, dur) {
  if (!st) return;
  let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  const db = 10 * Math.log10(sum / input.length + 1e-10);
  const pcm = down(input);
  // Ruido de fondo: se aprende al principio y se ajusta despacio cuando no hablas.
  if (st.calib.length < 12) { st.calib.push(db); st.floor = Math.max(-75, Math.min(...st.calib)); }
  else if (!st.talking && db < st.floor + 6) st.floor = st.floor * .97 + db * .03;
  const vera = Voice.isSpeaking();
  const thr = st.floor + (vera ? 20 : 11);
  st.onLevel?.(Math.max(0, Math.min(1, (db - st.floor) / 30)));

  // Pre-grabación para no perder la primera sílaba.
  st.ring.push(pcm); st.ringLen += pcm.length;
  while (st.ringLen - st.ring[0].length > PREROLL * RATE) st.ringLen -= st.ring.shift().length;

  if (!st.talking) {
    st.speechT = db > thr ? st.speechT + dur : 0;
    if (st.speechT >= (vera ? .25 : .12)) {
      st.talking = true; st.silenceT = 0; st.rec = [...st.ring]; st.recLen = st.ringLen;
      if (vera) { st.barge = true; Voice.duck(true); } // interrupción: baja la voz ya
      st.onState?.("oyendo");
    }
    return;
  }
  st.rec.push(pcm); st.recLen += pcm.length;
  st.silenceT = db > st.floor + 7 ? 0 : st.silenceT + dur;
  if (st.silenceT >= END_SILENCE || st.recLen >= MAX_UTTER * RATE) finish();
}

function finish() {
  const s = st; s.talking = false; s.speechT = 0;
  const len = s.recLen - Math.floor(s.silenceT * RATE * .8);
  const pcm = new Float32Array(s.recLen); let o = 0; for (const c of s.rec) { pcm.set(c, o); o += c.length; }
  s.rec = null; s.recLen = 0;
  const barge = s.barge; s.barge = false;
  if (len < MIN_SPEECH * RATE + PREROLL * RATE * .5) { if (barge) Voice.duck(false); s.onState?.("escuchando"); return; }
  const echoOf = barge ? Voice.spokenText() : "";
  s.onState?.("transcribiendo");
  transcribe(pcm.subarray(0, Math.max(len, 1)), s).then((text) => {
    if (st !== s) return;
    text = (text || "").trim();
    if (!text || JUNK.test(text) || text.replace(/[^\p{L}]/gu, "").length < 2) { if (barge) Voice.duck(false); s.onState?.("escuchando"); return; }
    if (barge && isEcho(text, echoOf)) { Voice.duck(false); s.onState?.("escuchando"); return; }
    if (barge || Voice.isSpeaking()) Voice.stopVoice();
    s.onState?.("escuchando");
    s.onText?.(text);
  }).catch((err) => { if (barge) Voice.duck(false); if (st === s) { s.onState?.("escuchando"); s.onError?.(err.message); } });
}

/** ¿Lo transcrito es Vera oyéndose a sí misma? */
function isEcho(text, spoken) {
  if (!spoken) return false;
  const n = (x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const a = n(text), b = new Set(n(spoken)); if (!a.length) return true;
  return a.filter((w) => b.has(w)).length / a.length >= .5;
}

function wav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function transcribe(pcm, s) {
  const fd = new FormData();
  fd.append("file", wav(pcm), "voz.wav"); fd.append("model", "whisper-large-v3-turbo"); fd.append("language", "es");
  fd.append("response_format", "json"); fd.append("temperature", "0");
  fd.append("prompt", "Conversación en español de España con Vera, asistente de finanzas: gastos, euros, bizum, presupuesto, cuenta, nómina.");
  const url = s.key ? "https://api.groq.com/openai/v1/audio/transcriptions" : s.proxy.replace(/\/$/, "") + "/stt";
  let r;
  try { r = await fetch(url, { method: "POST", headers: s.key ? { Authorization: `Bearer ${s.key}` } : {}, body: fd }); }
  catch { throw new Error("No puedo enviar el audio para transcribirlo. Revisa la conexión."); }
  if (!r.ok) throw new Error(r.status === 401 ? "La clave de Groq no es válida." : r.status === 429 ? "He agotado el cupo de transcripción de Groq por ahora." : `La transcripción ha fallado (${r.status}).`);
  return (await r.json()).text;
}
