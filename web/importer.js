// Importación de extractos bancarios (PDF con texto, PDF escaneado mediante OCR, Excel o CSV).
// El extracto manda: dentro de su periodo sustituye lo anotado a mano en esa cuenta.
import * as C from "./core.js";

// ---------------- Lectura de archivos (solo en el navegador) ----------------
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const XLSX = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

function loadScript(src) {
  return new Promise((ok, ko) => { if (window.Tesseract) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error("No se pudo cargar el lector de texto (sin conexión)")); document.head.appendChild(s); });
}

/** Devuelve { kind: "text", text } o { kind: "rows", rows }. onProgress(texto) informa del avance. */
export async function readFile(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return { kind: "text", text: await readPdf(file, onProgress) };
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    onProgress("Leyendo la hoja de cálculo…");
    const X = await import(XLSX);
    const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    return { kind: "rows", rows: X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: "dd/mm/yyyy" }) };
  }
  if (/\.(csv|txt)$/.test(name)) { const t = await file.text(); const sep = (t.match(/;/g) || []).length > (t.match(/,/g) || []).length ? ";" : ","; return { kind: "rows", rows: t.split(/\r?\n/).map((l) => splitCsv(l, sep)) }; }
  throw new Error("Formato no admitido. Sube el extracto en PDF, Excel (.xlsx) o CSV.");
}
function splitCsv(line, sep) { const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); }

async function readPdf(file, onProgress) {
  onProgress("Abriendo el PDF…");
  const pdfjs = await import(PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  // 1) Texto real del PDF, si lo tiene.
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i), tc = await page.getTextContent();
    const lines = new Map();
    for (const it of tc.items) { const y = Math.round(it.transform[5]); lines.set(y, [...(lines.get(y) || []), it]); }
    text += [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join(" ")).join("\n") + "\n";
  }
  if ((text.match(/\d{2}\/\d{2}\/\d{4}/g) || []).length > 3) return text;
  // 2) PDF hecho de imágenes: reconocimiento de texto página a página (en el propio móvil, gratis).
  await loadScript(TESSERACT);
  const worker = await window.Tesseract.createWorker("spa");
  await worker.setParameters({ tessedit_pageseg_mode: "6" });
  text = "";
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress(`Leyendo página ${i} de ${pdf.numPages}…`);
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas"); canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const { data } = await worker.recognize(canvas);
      text += data.text + "\n";
    }
  } finally { await worker.terminate(); }
  return text;
}

// ---------------- Interpretación (puro, probado en node) ----------------
const D = /(\d{2})[/.-](\d{2})[/.-](\d{4})/;
const toISO = (m) => `${m[3]}-${m[2]}-${m[1]}`;
/** Importe del banco: «-21.78», «-1.234,56», «49.0», «123,45€», «189, 54€». */
export function bankAmount(s) {
  if (s == null) return null;
  let t = String(s).replace(/€|EUR/gi, "").replace(/\s+/g, "").replace(/[−–]/g, "-");
  if (!/\d/.test(t)) return null;
  // «189,54» o «1.234,56» → coma decimal; «-21.78» o «49.0» → punto decimal (formato de CaixaBank)
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{1,2}$/.test(t)) t = t.replace(/,/g, "");
  else t = t.replace(/[.,]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Extracto en texto (PDF u OCR). */
export function parseStatementText(text) {
  const out = { period: null, balance: null, holder: null, iban: null, rows: [], warnings: [] };
  const per = text.match(/Periodo:?\s*(\d{2}\/\d{2}\/\d{4})\s*[-–a]\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (per) out.period = { from: toISO(per[1].match(D)), to: toISO(per[2].match(D)) };
  const bal = text.match(/Saldo disponible:?\s*([-\d.,]+)/i); if (bal) out.balance = bankAmount(bal[1]);
  const iban = text.match(/\b(ES\d{2}[\d ]{20,26})/); if (iban) out.iban = iban[1].replace(/\s/g, "");
  const row = /^(.+?)\s+(\d{2}[/.-]\d{2}[/.-]\d{4})\s+([-+−–]?\s?\d[\d.,]*)\s+(.*)$/;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); const m = line.match(row); if (!m) continue;
    if (/^(periodo|titular)/i.test(m[1])) continue;
    const amount = bankAmount(m[3]); if (amount == null || amount === 0) continue;
    out.rows.push({ concept: m[1].replace(/\s+/g, " ").replace(/[|}]$/, "").trim(), date: toISO(m[2].match(D)), amount, saldo: bankAmount(m[4]) });
  }
  return finish(out);
}

/** Extracto en hoja (Excel o CSV): detecta las columnas por su nombre. */
export function parseStatementRows(rows) {
  const out = { period: null, balance: null, rows: [], warnings: [] };
  const norm = (x) => C.normalize(String(x ?? ""));
  const hi = rows.findIndex((r) => r.some((c) => /fecha/.test(norm(c))) && r.some((c) => /importe|cantidad|cargo|abono/.test(norm(c))));
  if (hi < 0) throw new Error("No encuentro las columnas Fecha e Importe en la hoja.");
  const h = rows[hi].map(norm), col = (re) => h.findIndex((c) => re.test(c));
  const cDate = col(/^fecha( operacion| oper|$)/) >= 0 ? col(/^fecha( operacion| oper|$)/) : col(/fecha/);
  const cConcept = col(/concepto|descripcion|movimiento|detalle/), cAmount = col(/importe|cantidad/), cSaldo = col(/saldo/);
  const cCargo = col(/cargo|debe/), cAbono = col(/abono|haber/);
  for (const r of rows.slice(hi + 1)) {
    const dm = String(r[cDate] ?? "").match(D) || String(r[cDate] ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!dm) continue;
    const date = dm[0].includes("-") && dm[1].length === 4 ? `${dm[1]}-${dm[2]}-${dm[3]}` : toISO(dm);
    let amount = cAmount >= 0 ? bankAmount(r[cAmount]) : (bankAmount(r[cAbono]) || 0) - Math.abs(bankAmount(r[cCargo]) || 0);
    if (!amount) continue;
    out.rows.push({ concept: String(r[cConcept] ?? "").trim() || "Movimiento", date, amount, saldo: cSaldo >= 0 ? bankAmount(r[cSaldo]) : null });
  }
  return finish(out);
}

function finish(out) {
  if (!out.rows.length) throw new Error("No he encontrado movimientos en el archivo.");
  const dates = out.rows.map((r) => r.date).sort();
  out.period ??= { from: dates[0], to: dates.at(-1) };
  // Comprobación con el saldo (los extractos van del más reciente al más antiguo): saldo[i] = saldo[i+1] + importe[i].
  const newestFirst = out.rows[0].date >= out.rows.at(-1).date;
  const seq = newestFirst ? out.rows : [...out.rows].reverse();
  let ok = 0, checked = 0, fixed = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1]; if (a.saldo == null || b.saldo == null) continue;
    checked++;
    const diff = a.saldo - b.saldo;
    if (diff === a.amount) ok++;
    else if (diff === -a.amount) { a.amount = -a.amount; fixed++; ok++; } // signo leído mal
  }
  out.check = { checked, ok, fixed, ratio: checked ? ok / checked : null };
  if (checked && ok / checked < .8) out.warnings.push(`Solo ${ok} de ${checked} saldos cuadran: puede haber importes mal leídos. Revísalos después.`);
  if (out.balance == null && seq[0]?.saldo != null) out.balance = seq[0].saldo;
  return out;
}

// ---------------- Clasificación por comercio ----------------
// [expresión, categoría existente o nueva {id, name, parentId?}, tipo forzado]
export const NEW_CATS = {
  "cat-domicilio": { id: "cat-domicilio", name: "Comida a domicilio", parentId: "ocio" },
  "cat-telefonia": { id: "cat-telefonia", name: "Teléfono e internet", parentId: "hogar" },
  "cat-tabaco": { id: "cat-tabaco", name: "Tabaco y loterías" },
  "cat-compras": { id: "cat-compras", name: "Compras" },
  "cat-cuidado": { id: "cat-cuidado", name: "Cuidado personal" },
  "cat-bizum": { id: "cat-bizum", name: "Bizum enviados" },
  "cat-efectivo": { id: "cat-efectivo", name: "Efectivo retirado" },
  "cat-ia": { id: "cat-ia", name: "Apps e IA", parentId: "suscripciones" },
  "ing-bizum": { id: "ing-bizum", name: "Bizum recibidos", income: true },
  "ing-traspaso": { id: "ing-traspaso", name: "Traspasos propios", income: true },
  "cat-mascotas": { id: "cat-mascotas", name: "Mascotas" },
  "cat-seguros": { id: "cat-seguros", name: "Seguros", parentId: "hogar" },
  "cat-transfer": { id: "cat-transfer", name: "Transferencias enviadas" },
  "cat-comisiones": { id: "cat-comisiones", name: "Comisiones bancarias" },
};
const RULES = [
  [/bizum (recibido|recib)/, "ing-bizum"], [/bizum/, "cat-bizum"],
  [/traspaso propio|transferencia propia/, "ing-traspaso"], [/nomina|n[oó]mina/, "ing-nomina"], [/transferencia (recibida|a favor)|abono/, "ing-extra"],
  [/reint|cajero|retirada/, "cat-efectivo"], [/cuota t|comision|mantenimiento cuenta/, "cat-comisiones"], [/transfer/, "cat-transfer"],
  [/glovo|just ?eat|uber ?eats|deliveroo/, "cat-domicilio"],
  [/mundo chuches|mercadona|familycash|family cash|coviran|alimentacion|supermerc|lidl|carrefour|aldi|ahorramas|alcampo|eroski|\bdia\b|hipercor|consum|bonpreu|gadis|froiz|simply|carniceria|fruteria|panaderia/, "comida-super"],
  [/family energy|moeve|gasexpress|\be s\b|gasolinera|plenergy|repsol|cepsa|galp|\bbp\b|ballenoil|plenoil|petroprix|shell|estacionamiento|parking|aparcamiento|renfe|metro|emt|cabify|uber|bolt|peaje|autopista|itv/, "transporte"],
  [/anthropic|openai|chatgpt|perplexit|paypal google|midjourney|github|google one|icloud|apple\.com/, "cat-ia"],
  [/netflix|spotify|hbo|disney|prime video|dazn|movistar\+|youtube|gimnasio|gym|basic-fit/, "suscripciones"],
  [/\bdig\b|digi|movistar|vodafone|orange|yoigo|pepephone|lowi|masmovil|simyo|jazztel|o2/, "cat-telefonia"],
  [/iberdrola|endesa|naturgy|totalenergies|holaluz|repsol luz|agua|canal de isabel|alquiler|comunidad|ikea|leroy/, "hogar"],
  [/farmacia|hospital|clinica|dental|dentist|medic|optica|fisio/, "salud"],
  [/loteria|\bloto\b|tabaco|estanco|apuesta|bet365|codere/, "cat-tabaco"],
  [/barber|peluquer|estetica|perfumeria|primor|druni/, "cat-cuidado"],
  [/wallapop|alipay|hiper asia|amazon|aliexpress|bazar|corte ingles|decathlon|mediamarkt|fnac|shein|temu|miravia/, "cat-compras"],
  [/lefties|springfield|zara|primark|bershka|pull&bear|mango|h&m|kiabi/, "ropa"],
  [/kiwoko|tiendanimal|veterinari|mascota/, "cat-mascotas"], [/mutua|mapfre|seguro|linea directa|allianz|axa\b|generali/, "cat-seguros"],
  [/steam|playstation|nintendo|xbox|padel|piscina|parque warner|the room|juegos de ingenio|escape|cine|teatro|bolera|karting/, "ocio"],
  [/kebab|fast food|\bbk \d|casa garcia|sumup|restauracion|tapas|mombasa|nomadas|bar |cafeteria|restaurante|burger|mcdonald|kfc|telepizza|domino|cerveceria|taberna|meson|pizzeria/, "ocio-rest"],
];
export function classify(concept, amount) {
  const c = C.normalize(concept) + " ";
  for (const [re, cat] of RULES) if (re.test(c)) {
    const income = cat.startsWith("ing-");
    if (income === amount > 0) return cat;
    if (!income && amount > 0 && !["cat-bizum", "cat-efectivo", "cat-transfer"].includes(cat)) return cat; // devolución de un comercio
  }
  return amount > 0 ? "ing-extra" : "otros";
}

/**
 * Plan de importación (sin tocar nada): qué se borra, qué se añade, categorías y presupuestos nuevos y ajuste de saldo.
 * Borra todo lo anotado en `accountId` dentro del periodo (lo manual y lo de importaciones anteriores) y los previstos ya vencidos.
 */
export function plan(db, st, accountId, ownerId, now) {
  const { from, to } = st.period;
  const inRange = (t) => C.dateOf(t.dateTime) >= from && C.dateOf(t.dateTime) <= to;
  const touches = (t) => t.accountId === accountId || t.toAccountId === accountId;
  const remove = db.transactions.filter((t) => !t.deleted && touches(t) && inRange(t));
  // Las filas del mismo día se ordenan de la más antigua a la más reciente para darles hora correlativa.
  const chrono = st.rows[0].date >= st.rows.at(-1).date ? [...st.rows].reverse() : [...st.rows];
  const perDay = {};
  const add = chrono.map((r) => {
    const n = (perDay[r.date] = (perDay[r.date] ?? 0) + 1);
    const time = `${String(Math.min(23, 8 + Math.floor(n / 4))).padStart(2, "0")}:${String((n * 13) % 60).padStart(2, "0")}`;
    const cat = classify(r.concept, r.amount);
    const base = { id: "imp-" + C.normalize(`${r.date} ${r.concept} ${r.amount} ${r.saldo ?? ""} ${n}`).replace(/ /g, "-"), ownerId, amount: Math.abs(r.amount),
      dateTime: `${r.date}T${time}`, status: "REALIZADO", concept: tidy(r.concept), notes: "Importado del extracto", planned: false, estimated: false, imported: true };
    // El efectivo sacado del cajero cuenta como gastado: casi nunca se apunta después en qué se fue.
    if (cat === "cat-efectivo" && r.amount < 0) return { ...base, kind: "GASTO", accountId, categoryId: "cat-efectivo" };
    if (cat === "ing-traspaso" || /\btraspaso\b/.test(C.normalize(r.concept))) return { ...base, kind: "AJUSTE", amount: r.amount, accountId, categoryId: "ing-traspaso" };
    const isIncomeCat = cat.startsWith("ing-");
    return { ...base, kind: r.amount < 0 ? "GASTO" : isIncomeCat ? "INGRESO" : "DEVOLUCION", accountId, categoryId: cat };
  });
  // Lo que ya habías corregido en una importación anterior (nombre del bizum, categoría) se conserva al reimportar.
  const before = new Map(remove.filter((t) => t.imported).map((t) => [t.id, t]));
  for (const t of add) { const o = before.get(t.id); if (!o) continue;
    if (o.who) { t.who = o.who; t.concept = o.concept; } if (o.whoUnknown) t.whoUnknown = true;
    if (o.categoryId && o.categoryId !== t.categoryId && o.kind === t.kind) t.categoryId = o.categoryId; }
  const rows = st.rows.length;
  const { confirmed, paired, dropped } = pairTransfers(db, add, remove, accountId, from, to);
  const usedCats = new Set(add.map((t) => t.categoryId).filter(Boolean));
  if (add.some((t) => t.kind === "AJUSTE")) usedCats.add("ing-traspaso");
  const newCats = Object.values(NEW_CATS).filter((c) => usedCats.has(c.id) && !db.categories.some((x) => x.id === c.id));
  // Presupuestos sugeridos: media mensual de los meses completos, redondeada hacia arriba a 10 €, solo donde no hay límite.
  const allCats = [...db.categories, ...newCats];
  const top = (id) => { let c = allCats.find((x) => x.id === id); while (c?.parentId) c = allCats.find((x) => x.id === c.parentId); return c; };
  const months = new Set(add.map((t) => t.dateTime.slice(0, 7)));
  const fullMonths = [...months].filter((m) => m > from.slice(0, 7) || from.endsWith("-01")).filter((m) => m < to.slice(0, 7) || to === C.lastDayOfMonth(to));
  const spendByTop = {};
  for (const t of add) if ((t.kind === "GASTO" || t.kind === "DEVOLUCION") && fullMonths.includes(t.dateTime.slice(0, 7))) { const k = top(t.categoryId)?.id; if (k) spendByTop[k] = (spendByTop[k] ?? 0) + (t.kind === "DEVOLUCION" ? -t.amount : t.amount); }
  const limits = Object.entries(spendByTop).filter(([id]) => !allCats.find((c) => c.id === id)?.limit && !allCats.find((c) => c.id === id)?.income)
    .map(([id, total]) => ({ categoryId: id, name: top(id)?.name, monthly: Math.ceil(total / Math.max(1, fullMonths.length) / 1000) * 1000 }))
    .filter((l) => l.monthly >= 1000 && l.categoryId !== "otros").sort((a, b) => b.monthly - a.monthly);
  // Saldo: que la cuenta cuadre con el saldo final del extracto.
  let opening = null;
  if (st.balance != null) { // saldo al final del periodo: solo cuentan los movimientos hasta esa fecha
    const keep = db.transactions.filter((t) => !t.deleted && !remove.includes(t));
    const acc = db.accounts.find((a) => a.id === accountId);
    const after = C.balances([{ ...acc, opening: 0 }], [...keep, ...add].filter((t) => C.dateOf(t.dateTime) <= to))[accountId];
    opening = st.balance - after;
  }
  const income = add.filter((t) => t.kind === "INGRESO").reduce((s, t) => s + t.amount, 0), spent = add.filter((t) => t.kind === "GASTO").reduce((s, t) => s + t.amount, 0);
  const warnings = [...st.warnings, ...dropped.map((t) => `No aparece en el extracto el traspaso de ${C.fmtMoney(t.amount)} del ${C.fmtDay(C.dateOf(t.dateTime))} que apuntaste; se quita.`)];
  return { from, to, rows, remove, add, newCats, limits, opening, income, spent, confirmed, paired, check: st.check, warnings };
}

// ——— Traspasos entre tus cuentas ———
const NEAR_DAYS = 3;
const TRANSFER_CATS = new Set(["ing-traspaso", "cat-transfer", "ing-extra"]);
const transferish = (t) => TRANSFER_CATS.has(t.categoryId) || /\btrasp|\btransf/.test(C.normalize(t.concept || ""));
const daysApart = (a, b) => Math.abs(C.dayNum(C.dateOf(a)) - C.dayNum(C.dateOf(b)));
/** Efecto con signo de un movimiento de una sola cuenta. */
const signed = (t) => (t.kind === "GASTO" || t.kind === "LIQUIDACION" ? -t.amount : t.kind === "AJUSTE" ? t.amount : t.amount);
const best = (cands, date, pref) => cands.sort((a, b) => (pref(b) - pref(a)) || daysApart(a.dateTime, date) - daysApart(b.dateTime, date))[0];

/**
 * Empareja los movimientos del extracto con traspasos entre tus cuentas (modifica `add` y `remove`):
 *  1. Un traspaso ya apuntado (a mano o de otro extracto) que coincide en importe, sentido y fecha (±3 días) se conserva y se marca como confirmado por el banco.
 *  2. Una salida o entrada que coincide con la contraria ya importada de tu otra cuenta se une en un único traspaso.
 * Si un traspaso apuntado no aparece en el extracto: si el otro banco ya lo confirmó, se queda solo esa mitad; si no, se quita.
 */
export function pairTransfers(db, add, remove, accountId, from, to) {
  const mine = new Set(db.accounts.filter((a) => a.id !== accountId && !a.archived && a.type !== "EFECTIVO").map((a) => a.id));
  const used = new Set(); let confirmed = 0, paired = 0; const dropped = [];
  // 1. Traspasos ya apuntados que tocan esta cuenta dentro del periodo
  for (const T of remove.filter((t) => t.kind === "TRASPASO" && (mine.has(t.accountId) || mine.has(t.toAccountId)))) {
    const want = T.accountId === accountId ? -T.amount : T.amount;
    const cands = add.filter((r) => !used.has(r) && r.kind !== "TRASPASO" && signed(r) === want && daysApart(r.dateTime, T.dateTime) <= NEAR_DAYS);
    const r = best(cands, T.dateTime, (x) => (transferish(x) ? 1 : 0));
    remove.splice(remove.indexOf(T), 1);
    if (r) {
      used.add(r); confirmed++;
      add[add.indexOf(r)] = { ...T, dateTime: C.dateOf(r.dateTime) + T.dateTime.slice(10), status: "REALIZADO", bank: { ...(T.bank || {}), [accountId]: true } };
    } else {
      const other = T.accountId === accountId ? T.toAccountId : T.accountId;
      remove.push(T);
      if (T.bank?.[other]) add.push({ ...T, id: T.id + "-" + other, kind: "AJUSTE", amount: T.accountId === accountId ? T.amount : -T.amount, accountId: other, toAccountId: null, categoryId: "ing-traspaso", bank: { [other]: true } });
      else dropped.push(T);
    }
  }
  // 2. Mitades sueltas en tus otras cuentas (de extractos ya importados)
  const removed = new Set(remove.map((t) => t.id));
  const loose = db.transactions.filter((t) => !t.deleted && !removed.has(t.id) && mine.has(t.accountId) && t.kind !== "TRASPASO" && t.imported && transferish(t));
  for (let i = 0; i < add.length; i++) {
    const r = add[i]; if (used.has(r) || r.kind === "TRASPASO" || !transferish(r)) continue;
    const cands = loose.filter((t) => !used.has(t) && signed(t) === -signed(r) && daysApart(t.dateTime, r.dateTime) <= NEAR_DAYS);
    const t = best(cands, r.dateTime, (x) => (x.categoryId === "ing-traspaso" ? 1 : 0)); if (!t) continue;
    used.add(t); used.add(r); paired++; remove.push(t);
    const out = signed(r) < 0 ? r : t, inn = out === r ? t : r;
    add[i] = { id: "trf-" + r.id, ownerId: r.ownerId, kind: "TRASPASO", amount: Math.abs(r.amount), dateTime: out.dateTime, status: "REALIZADO", accountId: out.accountId, toAccountId: inn.accountId,
      concept: "Traspaso entre cuentas", categoryId: null, notes: `Emparejado: «${out.concept}» y «${inn.concept}»`, planned: false, estimated: false, imported: true, bank: { [out.accountId]: true, [inn.accountId]: true } };
  }
  return { confirmed, paired, dropped };
}

/** Normaliza un IBAN para compararlo (sin espacios, en mayúsculas). */
export const cleanIban = (s) => (s || "").replace(/\s/g, "").toUpperCase();
export const accountForIban = (accounts, iban) => (iban ? accounts.find((a) => !a.archived && cleanIban(a.iban) === cleanIban(iban)) : null) || null;
const tidy = (s) => s.replace(/\s+/g, " ").replace(/\*/g, " ").trim().toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
