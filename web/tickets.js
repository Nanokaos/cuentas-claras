// Lector de tickets: foto de la cámara o de la galería → comercio, fecha, total y categoría.
// Con clave de Groq lo lee un modelo de visión (mucho más fiable); sin ella, reconocimiento de texto en el móvil.
import * as C from "./core.js";

// Modelos de visión de Groq, por orden (si uno no existe o rechaza la petición, se prueba el siguiente).
const VISION = [
  { model: "qwen/qwen3.8-27b", extra: { reasoning_format: "hidden" } },
  { model: "qwen/qwen3.8-27b", extra: {} },
  { model: "meta-llama/llama-4-scout-17b-16e-instruct", extra: {} },
];

/** Reduce la foto (máx. 1400 px, JPEG) para enviarla rápido y dentro de los límites. */
export async function prepare(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  const img = bmp || await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("No puedo abrir esa imagen.")); i.src = URL.createObjectURL(file); });
  const w = img.width, h = img.height, k = Math.min(1, 1400 / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return { canvas: cv, dataUrl: cv.toDataURL("image/jpeg", .78) };
}

/** Lectura con IA de visión. cats: [[id, nombre]] de gasto. */
export async function readWithAI({ key, proxy, dataUrl, cats, today }) {
  const url = key ? "https://api.groq.com/openai/v1/chat/completions" : proxy.replace(/\/$/, "") + "/chat";
  const prompt = `Lee este ticket de compra español. Devuelve SOLO un JSON con:
{"comercio": string, "fecha": "AAAA-MM-DD" o null, "hora": "HH:MM" o null, "total": número en euros (el TOTAL pagado, no subtotales ni IVA), "pago": "tarjeta" | "efectivo" | null, "categoria_id": uno de [${cats.map(([id, n]) => `${id} (${n})`).join(", ")}], "lineas": [{"concepto": string, "importe": número}] (máx. 15), "legible": true/false}
Si no es un ticket o no se lee el total, "legible": false. Hoy es ${today}.`;
  let r = null, last = 0;
  for (const v of VISION) {
    try {
      r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: v.model, ...v.extra, temperature: 0, max_tokens: 1200, response_format: { type: "json_object" },
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }] }) });
    } catch { throw new Error("No puedo conectar con la IA para leer el ticket."); }
    if (r.ok) break;
    last = r.status;
    if (r.status === 401) throw new Error("La clave de Groq no es válida.");
    if (r.status === 429) throw new Error("He agotado el cupo de Groq por ahora.");
    if (![400, 404, 422].includes(r.status)) break;
  }
  if (!r.ok) throw new Error(r.status === 413 ? "La foto es demasiado grande." : `La IA no ha podido leer el ticket (${last || r.status}).`);
  let txt = (await r.json()).choices?.[0]?.message?.content || "{}";
  txt = txt.replace(/<think>[\s\S]*?<\/think>/g, "");
  const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1) || "{}");
  return normalize(j, cats);
}

function normalize(j, cats) {
  const num = (v) => (typeof v === "number" ? v : C.parseMoney(String(v ?? "").replace(/[^\d.,-]/g, "")) / 100);
  const total = Math.round(num(j.total) * 100);
  const okDate = /^\d{4}-\d{2}-\d{2}$/.test(j.fecha || "") ? j.fecha : null;
  return { legible: j.legible !== false && total > 0, merchant: String(j.comercio || "").trim().slice(0, 60), date: okDate, time: /^\d{2}:\d{2}$/.test(j.hora || "") ? j.hora : null,
    total, pay: j.pago === "efectivo" ? "efectivo" : j.pago === "tarjeta" ? "tarjeta" : null,
    categoryId: cats.some(([id]) => id === j.categoria_id) ? j.categoria_id : null,
    lines: (Array.isArray(j.lineas) ? j.lineas : []).slice(0, 15).map((l) => ({ concept: String(l.concepto || "").slice(0, 40), amount: Math.round(num(l.importe) * 100) })).filter((l) => l.concept) };
}

/** Sin IA: reconocimiento de texto en el móvil y reglas sencillas. */
export async function readWithOCR(canvas, onProgress) {
  if (!window.Tesseract) await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; s.onload = ok; s.onerror = () => ko(new Error("No se pudo cargar el lector de texto (sin conexión).")); document.head.appendChild(s); });
  const worker = await window.Tesseract.createWorker("spa", 1, { logger: (m) => m.status === "recognizing text" && onProgress?.(`Leyendo el ticket… ${Math.round(m.progress * 100)} %`) });
  try { const { data } = await worker.recognize(canvas); return parseTicketText(data.text); } finally { await worker.terminate(); }
}
export function parseTicketText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const money = (s) => { const m = s.match(/(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|eur)?\s*$/i); return m ? C.parseMoney(m[1]) : null; };
  let total = null;
  for (const l of lines) if (/\b(total|importe|a pagar|tarjeta|efectivo)\b/i.test(l) && !/subtotal|base|iva|cambio|entregado/i.test(l)) { const v = money(l); if (v && (total == null || /total/i.test(l))) total = v; }
  if (total == null) total = Math.max(0, ...lines.map(money).filter(Boolean));
  const dm = text.match(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/), date = dm ? `${dm[3].length === 2 ? "20" + dm[3] : dm[3]}-${dm[2]}-${dm[1]}` : null;
  const hm = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  const merchant = (lines.find((l) => /[a-záéíóúñ]{3,}/i.test(l) && !/factura|ticket|simplificada|cif|nif|tel/i.test(l)) || "").replace(/[^\p{L}\d .,&'-]/gu, "").slice(0, 40);
  const pay = /efectivo|entregado|cambio/i.test(text) ? "efectivo" : /tarjeta|visa|mastercard|contactless|datáfono|datafono/i.test(text) ? "tarjeta" : null;
  return { legible: total > 0, merchant, date: /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : null, time: hm ? hm[0] : null, total, pay, categoryId: null, lines: [] };
}
