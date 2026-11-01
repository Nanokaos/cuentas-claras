// Frase diaria de Vera para la notificación de las 10:00.
// Funciona igual en la app y en el service worker: lee tus datos del almacenamiento del dispositivo,
// calcula las cifras con core.js y elige una frase distinta cada día. Si hay clave de Groq, la IA la redacta.
import * as C from "./core.js";

const ME = "yo";

// ——— Almacenamiento compartido con el service worker (IndexedDB) ———
const DB_NAME = "veranza", STORE = "kv";
function idb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
export async function kvGet(k) { const d = await idb(); return new Promise((ok, ko) => { const r = d.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); }
export async function kvSet(k, v) { const d = await idb(); return new Promise((ok, ko) => { const t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).put(v, k); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); }); }

// ——— Datos del día ———
export function budgetInput(db, now) {
  return { userId: ME, now, accounts: db.accounts.filter((a) => !a.archived), transactions: db.transactions, settings: db.settings,
    goals: (db.goals || []).map((g) => ({ ...g, ownerId: ME })), contributions: db.contributions || [], categories: db.categories,
    limits: db.categories.filter((c) => c.limit > 0).map((c) => ({ categoryId: c.id, monthlyLimit: c.limit })) };
}
const top = (cats, id) => { let c = cats.find((x) => x.id === id); while (c?.parentId) c = cats.find((x) => x.id === c.parentId); return c; };

/** Cifras que pueden salir en la frase. Todas calculadas, ninguna inventada. */
export function facts(db, now) {
  const r = C.computeBudget(budgetInput(db, now), "HASTA_COBRO");
  const today = C.dateOf(now), yest = C.addDays(today, -1), monthStart = today.slice(0, 8) + "01";
  const live = db.transactions.filter((t) => !t.deleted && t.status !== "PREVISTO");
  const spend = (t) => t.kind === "GASTO" && !t.planned;
  const yList = live.filter((t) => spend(t) && C.dateOf(t.dateTime) === yest);
  const yBig = [...yList].sort((a, b) => b.amount - a.amount)[0];
  const byTop = {};
  for (const t of live) if (spend(t) && C.dateOf(t.dateTime) >= monthStart && C.dateOf(t.dateTime) <= today) { const c = top(db.categories, t.categoryId); const k = c?.name || "Otros"; byTop[k] = (byTop[k] || 0) + t.amount; }
  const [topCat, topAmt] = Object.entries(byTop).filter(([k]) => k !== "Otros").sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const bal = C.balances(db.accounts, db.transactions);
  const savingsAcc = db.accounts.filter((a) => !a.archived && !a.liquid && a.type !== "INVERSION");
  const upcoming = db.transactions.filter((t) => !t.deleted && t.status === "PREVISTO" && t.kind === "GASTO" && C.dateOf(t.dateTime) >= today && C.dateOf(t.dateTime) <= C.addDays(today, 3)).sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1))[0];
  const bizums = db.transactions.filter((t) => !t.deleted && !t.who && !t.whoUnknown && (["cat-bizum", "ing-bizum"].includes(t.categoryId) || /bizum/i.test(t.concept || ""))).length;
  return {
    today: r.today, daily: r.dailyRate, available: r.available, deficit: r.deficit, days: r.horizon.days, payday: r.horizon.provisional ? null : r.horizon.endDate,
    week: r.thisWeek, yesterday: yList.reduce((s, t) => s + t.amount, 0), yCount: yList.length, yBig: yBig ? { concept: yBig.concept || "algo", amount: yBig.amount } : null,
    over: r.categories.filter((c) => c.state === "SUPERADO").map((c) => ({ name: c.name, by: -c.remaining })),
    warn: r.categories.filter((c) => c.state === "ATENCION").map((c) => ({ name: c.name, left: c.remaining })),
    topCat, topAmt, savings: savingsAcc.reduce((s, a) => s + (bal[a.id] || 0), 0), hasSavings: savingsAcc.length > 0,
    upcoming: upcoming ? { concept: upcoming.concept, amount: upcoming.amount, date: C.dateOf(upcoming.dateTime) } : null, bizums,
    dow: C.dow(today), day: Number(today.slice(8)),
  };
}

// ——— Plantillas: [id, condición, [5 niveles de sarcasmo]] ———
const M = C.fmtMoney;
const when = (d) => C.fmtDay(d);
const T = [
  ["deficit", (f) => f.deficit > 0, (f) => [
    `Vas ${M(f.deficit)} por debajo de lo reservado hasta el cobro. Hoy toca no gastar.`,
    `Faltan ${M(f.deficit)} para cubrir lo reservado. Hoy, cartera cerrada.`,
    `Buenos días. Te faltan ${M(f.deficit)} para llegar al cobro. Hoy tu presupuesto es cero. Exactamente cero.`,
    `${M(f.deficit)} en números rojos respecto a lo reservado. Hoy no compres ni aire.`,
    `Déficit de ${M(f.deficit)}. Felicidades, has convertido el sueldo en una deuda con fecha. Hoy no gastas nada, sujeto de pruebas.`]],
  ["over", (f) => f.over.length > 0, (f) => { const o = f.over[0]; return [
    `${o.name} ya ha superado su presupuesto en ${M(o.by)}. Hoy puedes gastar ${M(Math.max(0, f.today))}.`,
    `${o.name} va ${M(o.by)} por encima del límite. Para hoy: ${M(Math.max(0, f.today))}.`,
    `${o.name}: ${M(o.by)} por encima del límite. Impresionante disciplina. Hoy tienes ${M(Math.max(0, f.today))}.`,
    `${o.name} reventado por ${M(o.by)}. Hoy tienes ${M(Math.max(0, f.today))}, y ni uno más para ${o.name.toLowerCase()}.`,
    `Has pulverizado el presupuesto de ${o.name.toLowerCase()} por ${M(o.by)}. Un logro patético. Hoy: ${M(Math.max(0, f.today))}.`]; }],
  ["yesterday-big", (f) => f.yBig && f.yBig.amount >= Math.max(2000, f.daily * 1.5), (f) => [
    `Ayer gastaste ${M(f.yesterday)}, sobre todo en ${f.yBig.concept}. Hoy dispones de ${M(Math.max(0, f.today))}.`,
    `Ayer se fueron ${M(f.yesterday)}; lo gordo, ${f.yBig.concept} (${M(f.yBig.amount)}). Hoy: ${M(Math.max(0, f.today))}.`,
    `${M(f.yBig.amount)} en ${f.yBig.concept} ayer. Supongo que era imprescindible. Hoy tienes ${M(Math.max(0, f.today))}.`,
    `Ayer: ${M(f.yBig.amount)} en ${f.yBig.concept}. Tu cartera aún tiembla. Hoy, ${M(Math.max(0, f.today))} y gracias.`,
    `${M(f.yBig.amount)} en ${f.yBig.concept}. Ayer. Sin pestañear. Hoy te quedan ${M(Math.max(0, f.today))}; intenta no avergonzarme otra vez.`]],
  ["yesterday-zero", (f) => f.yCount === 0 && f.today > 0, (f) => [
    `Ayer no gastaste nada. Hoy tienes ${M(f.today)} disponibles.`,
    `Ayer, cero gastos. Bien. Hoy puedes gastar ${M(f.today)}.`,
    `Ayer no gastaste ni un euro. Sospechoso, pero lo acepto. Hoy: ${M(f.today)}.`,
    `Un día entero sin gastar. ¿Estabas enfermo? Hoy tienes ${M(f.today)}.`,
    `Ayer gasto cero. Por fin un día en que no me has decepcionado. No te acostumbres: hoy tienes ${M(f.today)}.`]],
  ["upcoming", (f) => !!f.upcoming, (f) => [
    `El ${when(f.upcoming.date)} se cobra ${f.upcoming.concept}: ${M(f.upcoming.amount)}. Ya está reservado. Hoy: ${M(Math.max(0, f.today))}.`,
    `Recordatorio: ${f.upcoming.concept} (${M(f.upcoming.amount)}) el ${when(f.upcoming.date)}. Hoy tienes ${M(Math.max(0, f.today))}.`,
    `${f.upcoming.concept} viene a por ${M(f.upcoming.amount)} el ${when(f.upcoming.date)}. Yo ya lo he apartado. De nada. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.upcoming.concept}, ${M(f.upcoming.amount)}, el ${when(f.upcoming.date)}. Que no te pille con la cuenta vacía. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.upcoming.concept} te desplumará ${M(f.upcoming.amount)} el ${when(f.upcoming.date)}. Yo lo recuerdo; tú, claramente, no. Hoy: ${M(Math.max(0, f.today))}.`]],
  ["warn", (f) => f.warn.length > 0, (f) => { const w = f.warn[0]; return [
    `A ${w.name} le quedan ${M(w.left)} este mes. Hoy dispones de ${M(Math.max(0, f.today))}.`,
    `${w.name} va justo: quedan ${M(w.left)}. Hoy, ${M(Math.max(0, f.today))}.`,
    `${w.name} agoniza: ${M(w.left)} para el resto del mes. Hoy tienes ${M(Math.max(0, f.today))}.`,
    `${M(w.left)} en ${w.name.toLowerCase()} para todo el mes. Ánimo con eso. Hoy: ${M(Math.max(0, f.today))}.`,
    `A ${w.name.toLowerCase()} le quedan ${M(w.left)}. Sé que lo vas a reventar. Me encantará decírtelo. Hoy: ${M(Math.max(0, f.today))}.`]; }],
  ["payday", (f) => f.payday && f.days <= 3 && f.today >= 0, (f) => [
    `Faltan ${f.days} días para el cobro. Hoy tienes ${M(f.today)}.`,
    `Recta final: ${f.days} días para cobrar y ${M(f.today)} para hoy.`,
    `${f.days} días para el cobro. Aguanta. Hoy: ${M(f.today)}. No es tanto pedir.`,
    `Quedan ${f.days} días para cobrar. Intenta llegar con algo de dignidad. Hoy: ${M(f.today)}.`,
    `${f.days} días para el cobro. Si llegas sin arrastrarte, será un milagro estadístico. Hoy: ${M(f.today)}.`]],
  ["top", (f) => f.topCat && f.topAmt > 0 && f.day >= 8, (f) => [
    `Este mes donde más gastas es ${f.topCat}: ${M(f.topAmt)}. Hoy dispones de ${M(Math.max(0, f.today))}.`,
    `${f.topCat} lidera el mes con ${M(f.topAmt)}. Hoy: ${M(Math.max(0, f.today))}.`,
    `${M(f.topAmt)} en ${f.topCat.toLowerCase()} este mes. Tus prioridades, siempre tan claras. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.topCat}: ${M(f.topAmt)} este mes. Esto ya no es un gasto, es un estilo de vida. Hoy: ${M(Math.max(0, f.today))}.`,
    `${M(f.topAmt)} en ${f.topCat.toLowerCase()}. Si gastaras la mitad de cerebro que de dinero, iríamos bien. Hoy: ${M(Math.max(0, f.today))}.`]],
  ["savings", (f) => f.hasSavings && f.savings > 0, (f) => [
    `Tienes ${M(f.savings)} en la cuenta de ahorro. Hoy puedes gastar ${M(Math.max(0, f.today))} de la de gasto.`,
    `Ahorro: ${M(f.savings)}. Para hoy, ${M(Math.max(0, f.today))}.`,
    `${M(f.savings)} ahorrados. No los mires mucho, que se asustan. Hoy: ${M(Math.max(0, f.today))}.`,
    `${M(f.savings)} en ahorro. Lo único que haces bien. No lo toques. Hoy: ${M(Math.max(0, f.today))}.`,
    `${M(f.savings)} de ahorro. Tu único logro. Si lo tocas, lo sabré. Hoy: ${M(Math.max(0, f.today))}.`]],
  ["bizums", (f) => f.bizums >= 3, (f) => [
    `Tienes ${f.bizums} bizums sin identificar. Dime a quién fueron cuando puedas. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.bizums} bizums sin nombre esperan en tareas. Hoy tienes ${M(Math.max(0, f.today))}.`,
    `${f.bizums} bizums anónimos. Repartes dinero como un mecenas sin memoria. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.bizums} bizums y ni idea de a quién. Muy transparente todo. Hoy: ${M(Math.max(0, f.today))}.`,
    `${f.bizums} bizums a desconocidos. O tienes muchos amigos o muy poca memoria. Hoy: ${M(Math.max(0, f.today))}.`]],
  ["monday", (f) => f.dow === 0 && f.week > 0, (f) => [
    `Empieza la semana con ${M(f.week)} disponibles hasta el domingo.`,
    `Lunes. Para toda la semana: ${M(f.week)}.`,
    `Lunes. Tienes ${M(f.week)} para siete días. Repártelos, si sabes dividir.`,
    `Lunes y ${M(f.week)} para la semana. Veremos cuánto duran.`,
    `Lunes. ${M(f.week)} para toda la semana. Apuesto a que el jueves ya lloras.`]],
  ["friday", (f) => f.dow === 4 && f.today > 0, (f) => [
    `Viernes. Hoy puedes gastar ${M(f.today)}; el fin de semana también cuenta.`,
    `Es viernes: ${M(f.today)} para hoy. Piensa en el sábado.`,
    `Viernes. ${M(f.today)} para hoy. Sé que el plan es tirarlo todo; no lo hagas.`,
    `Viernes. Hoy ${M(f.today)}. Tu historial de fines de semana me preocupa.`,
    `Viernes, el día favorito de tu irresponsabilidad. Hoy: ${M(f.today)}. Ni un céntimo más.`]],
  ["base", () => true, (f) => [
    `Hoy puedes gastar ${M(Math.max(0, f.today))}. Hasta el cobro quedan ${M(Math.max(0, f.available))}.`,
    `Disponible hoy: ${M(Math.max(0, f.today))}. ${f.days} días hasta el cobro.`,
    `Buenos días. Hoy tienes ${M(Math.max(0, f.today))}. Intenta que sobre algo.`,
    `${M(Math.max(0, f.today))} para hoy. Una cifra modesta para alguien de gustos caros.`,
    `Hoy tienes ${M(Math.max(0, f.today))}. Es lo que hay. Gástalo con la poca sensatez que te queda.`]],
];

/** Elige plantilla: las que aplican, sin repetir las de los últimos días, rotando por fecha. */
export function pickTemplate(f, level, recent = [], seed = 0) {
  const ok = T.filter(([, cond]) => { try { return cond(f); } catch { return false; } });
  const fresh = ok.filter(([id]) => !recent.includes(id));
  const pool = fresh.length ? fresh : ok;
  const [id, , make] = pool[(seed % pool.length + pool.length) % pool.length];
  return { id, text: make(f)[Math.max(0, Math.min(4, level ?? 2))] };
}

const PERSONA = ["neutra y profesional", "con ironía suave", "fría, sarcástica e inteligente", "muy sarcástica y mordaz, sin insultar",
  "cruel: humillas sus hábitos de gasto con desprecio frío (nunca su físico, origen, salud o identidad, sin insultos soeces)"];

async function aiLine(db, f, level, avoid) {
  const s = db.settings || {}; if (!s.groqKey && !s.proxy) return null;
  const url = s.proxy ? s.proxy.replace(/\/$/, "") + "/chat" : "https://api.groq.com/openai/v1/chat/completions";
  const datos = { hoy_puedes_gastar: M(Math.max(0, f.today)), al_dia: M(f.daily), hasta_el_cobro: M(f.available), dias_para_cobrar: f.days, deficit: f.deficit ? M(f.deficit) : null,
    ayer_gastado: M(f.yesterday), mayor_gasto_ayer: f.yBig ? `${f.yBig.concept} ${M(f.yBig.amount)}` : null, presupuestos_superados: f.over.map((o) => `${o.name} +${M(o.by)}`),
    categoria_mas_gasto_mes: f.topCat ? `${f.topCat} ${M(f.topAmt)}` : null, ahorro: f.hasSavings ? M(f.savings) : null,
    proximo_recibo: f.upcoming ? `${f.upcoming.concept} ${M(f.upcoming.amount)} el ${when(f.upcoming.date)}` : null, bizums_sin_identificar: f.bizums || null,
    dia_semana: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][f.dow] };
  const body = { model: s.aiModel || "llama-3.3-70b-versatile", temperature: 1, max_tokens: 120, messages: [
    { role: "system", content: `Eres Vera, un robot esférico que vigila las finanzas del usuario. Personalidad: ${PERSONA[level] ?? PERSONA[2]}. Escribe UNA notificación de buenos días en español de España: 1 o 2 frases, máximo 160 caracteres, sin emojis ni comillas. Usa solo cifras de los datos, tal cual. Elige un dato distinto de los de estos últimos días: ${avoid.join(" | ") || "ninguno"}.` },
    { role: "user", content: JSON.stringify(datos) }] };
  const headers = { "Content-Type": "application/json" }; if (s.groqKey) headers.Authorization = `Bearer ${s.groqKey}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) return null;
    const txt = (await r.json()).choices?.[0]?.message?.content?.trim().replace(/^["«]|["»]$/g, "");
    return txt && txt.length <= 260 ? txt : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Mensaje del día y registro para no repetir. `force` lo genera aunque ya se haya enviado hoy. */
export async function dailyNote({ force = false, useAI = true } = {}) {
  const db = await kvGet("db"); if (!db) return null;
  const now = C.nowLocal(), today = C.dateOf(now), hist = (await kvGet("dailyHist")) || [];
  if (!force && hist.at(-1)?.date === today) return null;
  const f = facts(db, now), level = db.settings?.sarcasm ?? 2;
  const recentIds = hist.slice(-6).map((h) => h.id), seed = C.dayNum(today);
  let { id, text } = pickTemplate(f, level, recentIds, seed);
  if (useAI) { const ai = await aiLine(db, f, level, hist.slice(-5).map((h) => h.text)); if (ai) { text = ai; id = "ia"; } }
  if (!force) { hist.push({ date: today, id, text }); await kvSet("dailyHist", hist.slice(-30)); }
  return { title: "Vera", body: text };
}
