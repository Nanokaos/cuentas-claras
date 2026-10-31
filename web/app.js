// Cuentas Claras (web). Todos los importes salen de core.js; aquí solo hay datos, pantallas y la voz de Vera.
import * as C from "./core.js";

const ME = "yo";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const M = (c, plus) => C.fmtMoney(c, plus);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const moneyInput = (c) => (c == null ? "" : C.fmtMoney(c).replace(" €", ""));

// ======================= Datos (en este dispositivo) =======================
const DEFAULT_CATS = [
  { id: "comida", name: "Comida" }, { id: "comida-super", name: "Supermercado", parentId: "comida" },
  { id: "ocio", name: "Ocio" }, { id: "ocio-rest", name: "Restaurantes y bares", parentId: "ocio" },
  { id: "transporte", name: "Transporte" }, { id: "suscripciones", name: "Suscripciones" }, { id: "hogar", name: "Hogar" },
  { id: "salud", name: "Salud" }, { id: "ropa", name: "Ropa" }, { id: "otros", name: "Otros" },
  { id: "ing-nomina", name: "Nómina", income: true }, { id: "ing-extra", name: "Ingresos extra", income: true },
];
const DEFAULT_SETTINGS = { nextPayday: null, buffer: 0, monthlySavings: 0, sarcasm: 2, reduceMotion: false, quality: "alta", remarks: true };
const key = (demo) => (demo ? "cc.demo.v1" : "cc.v1");
let demo = localStorage.getItem("cc.mode") !== "real";
let db;

function blank() {
  return { version: 1, accounts: [
    { id: "cc", ownerId: ME, name: "Cuenta corriente", type: "CORRIENTE", opening: 0, liquid: true },
    { id: "cash", ownerId: ME, name: "Efectivo", type: "EFECTIVO", opening: 0, liquid: true },
    { id: "sav", ownerId: ME, name: "Ahorro", type: "AHORRO", opening: 0, liquid: false },
  ], transactions: [], categories: structuredClone(DEFAULT_CATS), recurrences: [], goals: [], contributions: [], settings: { ...DEFAULT_SETTINGS } };
}
function seedDemo() {
  const d = blank(), today = C.dateOf(C.nowLocal());
  d.accounts[0].opening = 145000; d.accounts[1].opening = 10000; d.accounts[2].opening = 200000;
  let payday = C.addDays(C.lastDayOfMonth(today), -2); if (payday <= today) payday = C.addDays(C.lastDayOfMonth(C.addMonths(today, 1)), -2);
  Object.assign(d.settings, { nextPayday: payday, buffer: 20000, monthlySavings: 10000 });
  d.categories.find((c) => c.id === "ocio").limit = 12000; d.categories.find((c) => c.id === "comida").limit = 30000; d.categories.find((c) => c.id === "transporte").limit = 8000;
  const past = (k, h) => `${C.addDays(today, -k)}T${String(h).padStart(2, "0")}:15`;
  const t = (amount, k, h, concept, categoryId, accountId = "cc") => ({ id: uid(), ownerId: ME, kind: "GASTO", amount, dateTime: past(k, h), status: "REALIZADO", accountId, concept, categoryId, notes: "", planned: false, estimated: false });
  d.transactions.push(t(4200, 1, 21, "Cena con amigos", "ocio-rest"), t(3860, 2, 18, "Mercadona", "comida-super"), t(3000, 3, 10, "Gasolina", "transporte"), t(8800, 4, 22, "Concierto", "ocio"), t(1250, 5, 13, "Menú del día", "ocio-rest", "cash"));
  const rec = (id, kind, amount, start, concept, categoryId, estimated = false) => ({ id, frequency: "MENSUAL", interval: 1, start, time: "09:00", active: true,
    template: { id: "tpl-" + id, ownerId: ME, kind, amount, dateTime: `${start}T09:00`, status: "PREVISTO", accountId: "cc", concept, categoryId, notes: "", planned: true, estimated } });
  d.recurrences.push(rec("luz", "GASTO", 6000, C.addDays(today, 5), "Luz", "hogar"), rec("gym", "GASTO", 3000, C.addDays(today, 9), "Gimnasio", "suscripciones"), rec("nomina", "INGRESO", 140000, payday, "Nómina", "ing-nomina", true));
  return d;
}
function load() {
  try { const raw = localStorage.getItem(key(demo)); if (raw) return JSON.parse(raw); } catch (e) { console.warn(e); }
  return demo ? seedDemo() : blank();
}
function save() { try { localStorage.setItem(key(demo), JSON.stringify(db)); } catch (e) { toast("No se pudo guardar en este dispositivo: " + e.message); } }
function materializeAll() {
  const today = C.dateOf(C.nowLocal()), ids = new Set(db.transactions.map((t) => t.id));
  for (const r of db.recurrences.filter((r) => r.active !== false)) for (const t of C.materialize(r, r.start, C.addDays(today, 62), ids)) { db.transactions.push(t); ids.add(t.id); }
}
/** Guardar = insertar o reemplazar por id: un reintento nunca duplica. */
function upsertTx(t) { const i = db.transactions.findIndex((x) => x.id === t.id); if (i >= 0) db.transactions[i] = t; else db.transactions.push(t); save(); }

// ======================= Cálculo =======================
let S; // estado calculado
function compute() {
  const now = C.nowLocal(), live = db.transactions.filter((t) => !t.deleted);
  const input = { userId: ME, now, accounts: db.accounts.filter((a) => !a.archived), transactions: db.transactions, settings: db.settings,
    goals: db.goals.map((g) => ({ ...g, ownerId: ME })), contributions: db.contributions, categories: db.categories,
    limits: db.categories.filter((c) => c.limit > 0).map((c) => ({ categoryId: c.id, monthlyLimit: c.limit })) };
  S = { now, live, pay: C.computeBudget(input, "HASTA_COBRO"), month: C.computeBudget(input, "FIN_DE_MES"), bal: C.balances(db.accounts, db.transactions) };
}

// ======================= Vera =======================
const frame = $("#vera");
let veraReady = false; const queue = [];
const vera = (fn) => { if (veraReady && frame.contentWindow?.vera) fn(frame.contentWindow.vera); else queue.push(fn); };
addEventListener("message", (e) => {
  const m = e.data?.vera; if (!m) return;
  if (m === "ready") { veraReady = true; configVera(); queue.splice(0).forEach((fn) => fn(frame.contentWindow.vera)); vera((v) => v.speak(Lines.hello(), Lines.mood())); }
  if (m === "tap") vera((v) => v.speak(Lines.explain(), Lines.mood()));
  if (m === "action") onVeraAction(e.data.id);
});
function configVera() { vera((v) => { v.setSarcasm(db.settings.sarcasm); v.setReduceMotion(db.settings.reduceMotion); v.setQuality(db.settings.quality); v.setRemarks(Lines.remarks()); }); }
function onVeraAction() {}

const pickL = (...v) => v[Math.min(db.settings.sarcasm, v.length - 1)];
const Lines = {
  mood: () => (db.settings.sarcasm >= 2 ? "sarcastica" : "neutral"),
  hello() {
    const r = S.pay;
    if (r.available < 0) return Lines.deficit();
    if (r.warnings.some((w) => w.code === "SIN_FECHA_COBRO")) return pickL("Hola. Indica en Ajustes la fecha de tu próximo cobro para calcular mejor.", "Hola. Me falta la fecha de tu próximo cobro; ponla en Ajustes.", "Hola. Calculo hasta fin de mes porque no sé cuándo cobras. Una pista en Ajustes y dejo de adivinar.", "Sin fecha de cobro, mis cálculos son provisionales. Como tus planes de ahorro. Ajustes, por favor.");
    return pickL(`Hola. Hoy puedes gastar ${M(r.today)}.`, `Hola. Hoy puedes gastar ${M(r.today)}. Buen comienzo.`, `Hola de nuevo. Te quedan ${M(r.today)} para hoy. Intentemos que mañana sigan existiendo.`, `Has vuelto. Tu saldo y yo lo celebramos con moderación. Hoy: ${M(r.today)}.`);
  },
  deficit() {
    const r = S.pay, cut = Math.ceil(r.deficit / Math.max(1, r.horizon.days));
    return pickL(`Aviso: faltan ${M(r.deficit)} para cubrir lo reservado. Opciones: retrasar el ahorro del mes o recortar ${M(cut)} al día.`, `Aviso: hay un déficit de ${M(r.deficit)}. Puedes retrasar el ahorro o recortar ${M(cut)} al día.`, `Aviso. Faltan ${M(r.deficit)}. No es una opinión, es aritmética. Retrasa el ahorro o recorta ${M(cut)} al día.`, `Faltan ${M(r.deficit)}. Las cifras no tienen sentido del humor y hoy yo tampoco. Retrasa el ahorro o recorta ${M(cut)} al día.`);
  },
  explain() {
    const r = S.pay, x = r.reserved;
    const b = `Saldo líquido ${M(r.liquidBalance)}. Menos recibos ${M(x.obligations)}, ahorro ${M(x.savings)}, objetivos ${M(x.goals)} y colchón ${M(x.buffer)}. Quedan ${M(r.available)} para ${r.horizon.days} días: ${M(r.dailyRate)} al día.` + (r.expectedIncome > 0 ? ` No cuento ${M(r.expectedIncome)} de ingresos que aún no has cobrado.` : "");
    return pickL(b, b + " Así de sencillo.", b + " Las cuentas no mienten. Las personas, a veces.", b + " Te lo he explicado despacio. Puedo hacerlo más despacio.");
  },
  remarks() {
    if (!db.settings.remarks || db.settings.sarcasm === 0) return [];
    const out = S.pay.categories.filter((c) => c.state === "SUPERADO").map((c) => pickL("", `${c.name} va por ${M(c.spent)} de ${M(c.limit)}.`, `${c.name}: ${M(c.spent)} de ${M(c.limit)}. No digo nada. Lo estoy diciendo.`, `He mirado ${c.name.toLowerCase()} otra vez. Sigue por encima del límite.`));
    if (S.pay.today > 0) out.push(pickL("", `Hoy te quedan ${M(S.pay.today)}.`, `Te quedan ${M(S.pay.today)} para hoy. Lo digo por si alguien pregunta.`, `${M(S.pay.today)} para hoy. Es una cifra, no un objetivo.`));
    out.push(pickL("", "Sin novedades en tus recibos.", "He revisado tus recibos. Todos en orden. Por ahora.", "Sin gastos en un rato. Sospechoso, pero lo acepto."));
    return out.filter(Boolean);
  },
  draftsReady: (n) => n === 1 ? pickL("Revisa el movimiento y confírmalo.", "Lo tengo. Revísalo y confirma.", "Preparado. No pienso guardarlo a tus espaldas: confírmalo.", "Listo. Si me equivoco, prefiero que sea culpa tuya. Confirma.")
    : pickL(`He preparado ${n} movimientos. Revísalos y confírmalos.`, `${n} movimientos preparados. Revisa y confirma.`, `${n} movimientos de una sola frase. Impresionante eficiencia gastando. Revísalos.`, `${n} de golpe. Revísalos antes de que me arrepienta de entenderte.`),
  notUnderstood: () => pickL("No he encontrado ningún importe. Prueba: «23 euros en el súper con tarjeta».", "No veo ningún importe. Ejemplo: «23 euros en el súper».", "Sin importe no hay gasto. Ni siquiera tú puedes gastar «algo». Ejemplo: «23 euros en el súper».", "Necesito una cifra. Una. Ejemplo: «23 euros en el súper»."),
  discarded: () => pickL("Descartado. No se ha guardado nada.", "Descartado.", "Descartado. Fingiré que no ha pasado.", "Descartado. Ojalá pudiera hacer lo mismo con tus cenas."),
  afterSaving(list) {
    const r = S.pay; if (r.available < 0) return [Lines.deficit(), "enfadada", "aviso"];
    const gasto = list.filter((t) => t.kind === "GASTO").reduce((a, t) => a + t.amount, 0), ingreso = list.filter((t) => t.kind === "INGRESO").reduce((a, t) => a + t.amount, 0);
    const cat = (id) => db.categories.find((c) => c.id === id);
    const over = r.categories.find((c) => c.state === "SUPERADO" && list.some((t) => { const k = cat(t.categoryId); return k && (k.id === c.categoryId || k.parentId === c.categoryId); }));
    if (over) return [pickL(`Guardado. ${over.name} va por ${M(over.spent)} de ${M(over.limit)}. Propuesta: no gastar más en ${over.name.toLowerCase()} este mes.`, `Guardado. ${over.name} supera el límite: ${M(over.spent)} de ${M(over.limit)}. Te propongo pausarlo.`, `Guardado. El límite de ${over.name.toLowerCase()} era ${M(over.limit)}; por lo visto, orientativo. Vas por ${M(over.spent)}. Propuesta: pausa hasta fin de mes.`, `${M(over.spent)} en ${over.name.toLowerCase()} con un límite de ${M(over.limit)}. Admiro tu constancia, en la dirección equivocada. Hoy te quedan ${M(r.today)}.`), db.settings.sarcasm >= 2 ? "sarcastica" : "decepcionada", "habla"];
    if (ingreso > 0 && gasto === 0) return [pickL(`Ingreso guardado: ${M(ingreso)}.`, `Ingreso de ${M(ingreso)} guardado. Bien.`, `${M(ingreso)} que entran. Lo registro antes de que encuentres en qué gastarlos.`, `Ingreso: ${M(ingreso)}. Disfruta la sensación; suele durar poco.`), "contenta", "habla"];
    return [pickL(`Guardado. Hoy te quedan ${M(r.today)}.`, `Guardado: ${M(gasto)}. Quedan ${M(r.today)} para hoy.`, `Guardado: ${M(gasto)}. Te quedan ${M(r.today)} para hoy. Lo digo por si alguien lleva la cuenta. Yo, por ejemplo.`, `Guardado. ${M(r.today)} para hoy. Es una cifra, no un reto.`), r.today < 0 ? "decepcionada" : db.settings.sarcasm >= 2 ? "sarcastica" : "contenta", "habla"];
  },
};

// ======================= Utilidades de interfaz =======================
const view = $("#view");
let tab = location.hash.replace("#", "") || "inicio";
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200); }
const catName = (id) => { const c = db.categories.find((x) => x.id === id); if (!c) return ""; const p = c.parentId && db.categories.find((x) => x.id === c.parentId); return (p ? p.name + " › " : "") + c.name; };
const accName = (id) => db.accounts.find((a) => a.id === id)?.name ?? "";
const catOptions = (kind, sel) => db.categories.filter((c) => !!c.income === (kind === "INGRESO")).map((c) => [c.id, catName(c.id)]).sort((a, b) => a[1].localeCompare(b[1], "es"))
  .map(([id, n]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(n)}</option>`).join("");
const accOptions = (sel, except) => db.accounts.filter((a) => !a.archived && a.id !== except).map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.name)}</option>`).join("");
const TYPES = { CORRIENTE: "Cuenta corriente", AHORRO: "Ahorro", EFECTIVO: "Efectivo", TARJETA: "Tarjeta", INVERSION: "Inversión" };

function openSheet(html, onMount) {
  const sh = $("#sheet"); $("#sheetBody").innerHTML = html; sh.showModal(); onMount?.($("#sheetBody"));
}
const closeSheet = () => $("#sheet").close();

// ======================= Pantallas =======================
function render() {
  compute();
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  $("#veraWrap").hidden = tab !== "inicio";
  $("#quick").hidden = tab !== "inicio";
  view.innerHTML = ({ inicio: home, movimientos: movements, presupuestos: budgets, cuentas: accounts, ajustes: settings }[tab] || home)();
  configVera();
}
function home() {
  const r = S.pay, m = S.month, neg = r.available < 0;
  const upcoming = S.live.filter((t) => C.effectiveStatus(t, S.now) !== "REALIZADO").sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1)).slice(0, 6);
  return `${demo ? `<p class="demo">Estás viendo datos de demostración. Cámbialo en Ajustes.</p>` : ""}
  <section class="card hero" data-act="explain">
    <div class="label">${neg ? "Déficit hasta el cobro" : "Disponible hoy"}</div>
    <div class="big ${neg || r.today < 0 ? "neg" : ""}">${M(neg ? r.deficit : r.today)}</div>
    <div class="sub">${r.horizon.provisional ? "Hasta fin de mes (provisional)" : `Hasta el cobro (${C.fmtDay(r.horizon.endDate)})`}: ${M(r.available)} · ${r.horizon.days} días</div>
    ${r.expectedIncome > 0 ? `<div class="sub">Sin contar ${M(r.expectedIncome)} de ingresos previstos${r.expectedIncomeIsEstimate ? " (estimados)" : ""}</div>` : ""}
    <details><summary>De dónde sale</summary>${r.explanation.map((l) => `<div class="line ${l.kind}"><span>${{ RESTA: "− ", RESULTADO: "= " }[l.kind] || ""}${esc(l.text)}</span><span>${l.amount != null ? M(l.amount) : ""}</span></div>`).join("")}</details>
  </section>
  <div class="tiles">
    <section class="card"><div class="label">Esta semana</div><div class="mid">${M(Math.max(0, r.thisWeek))}</div></section>
    <section class="card"><div class="label">Este mes</div><div class="mid ${m.available < 0 ? "neg" : ""}">${M(m.available)}</div></section>
    <section class="card"><div class="label">Saldo total</div><div class="mid">${M(r.totalBalance)}</div></section>
    <section class="card"><div class="label">Reservado</div><div class="mid">${M(r.reserved.total)}</div></section>
  </div>
  ${r.warnings.length ? `<section class="card warn">${r.warnings.map((w) => `<p>${esc(w.message)}</p>`).join("")}</section>` : ""}
  ${catCard(r)}
  <section class="card"><h3>Próximos recibos e ingresos</h3>
    ${upcoming.length ? upcoming.map((t) => { const st = C.effectiveStatus(t, S.now); return `<button class="row" data-edit="${t.id}"><span><b>${esc(t.concept || "Sin concepto")}</b><small class="${st === "PENDIENTE" ? "w" : ""}">${C.fmtDayLong(C.dateOf(t.dateTime))}${st === "PENDIENTE" ? " · pendiente de confirmar" : ""}</small></span><span class="${t.kind === "INGRESO" ? "pos" : ""}">${t.kind === "INGRESO" ? "+" : "−"}${M(t.amount)}</span></button>`; }).join("") : `<p class="muted">Nada programado. Añade recibos que se repiten con «+».</p>`}
  </section>`;
}
function catCard(r) {
  if (!r.categories.length) return "";
  return `<section class="card"><h3>Presupuestos del mes</h3>${r.categories.map((c) => `
    <div class="cat"><div class="cat-h"><span>${esc(c.name)}${c.state !== "BIEN" ? ` <i class="pill ${c.state === "SUPERADO" ? "bad" : "w"}">${c.state === "SUPERADO" ? "Superado" : "Atención"}</i>` : ""}</span><span class="muted">${M(c.spent)} de ${M(c.limit)}</span></div>
    <div class="bar"><i class="${c.state === "SUPERADO" ? "bad" : c.state === "ATENCION" ? "w" : ""}" style="width:${Math.min(100, (c.spent / Math.max(1, c.limit)) * 100)}%"></i></div>
    <small class="muted">${c.remaining < 0 ? `Superado en ${M(-c.remaining)}` : `Quedan ${M(c.remaining)} · ${M(c.perDay)} al día`}</small></div>`).join("")}</section>`;
}
let filter = "todos", query = "";
function movements() {
  const list = S.live.filter((t) => filter === "todos" || (filter === "gastos" && t.kind === "GASTO") || (filter === "ingresos" && t.kind === "INGRESO") || (filter === "previstos" && C.effectiveStatus(t, S.now) !== "REALIZADO"))
    .filter((t) => !query || C.normalize(`${t.concept} ${catName(t.categoryId)} ${t.notes || ""}`).includes(C.normalize(query)))
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
  let last = "", out = "";
  for (const t of list) {
    const d = C.dateOf(t.dateTime), st = C.effectiveStatus(t, S.now);
    if (d !== last) { last = d; out += `<h4>${C.fmtDayLong(d)}</h4>`; }
    const acc = t.kind === "TRASPASO" ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : accName(t.accountId);
    out += `<div class="card tx"><button class="row" data-edit="${t.id}"><span><b>${esc(t.concept || catName(t.categoryId) || "Sin concepto")}</b><small>${esc([catName(t.categoryId), acc, t.dateTime.slice(11, 16)].filter(Boolean).join(" · "))}</small>
      ${st === "PENDIENTE" ? `<small class="w">Pendiente de confirmar</small>` : st === "PREVISTO" ? `<small class="v">${t.estimated ? "Previsto (estimado)" : "Previsto"}</small>` : ""}</span>
      <span class="${t.kind === "INGRESO" ? "pos" : ""}">${t.kind === "INGRESO" ? "+" : t.kind === "GASTO" ? "−" : ""}${M(t.amount)}</span></button>
      ${st !== "REALIZADO" ? `<button class="link" data-confirm="${t.id}">Confirmar</button>` : ""}</div>`;
  }
  return `<h2>Movimientos</h2>
  <input class="search" id="q" type="search" placeholder="Buscar" value="${esc(query)}">
  <div class="chips">${[["todos", "Todos"], ["gastos", "Gastos"], ["ingresos", "Ingresos"], ["previstos", "Previstos"]].map(([k, l]) => `<button class="chip ${filter === k ? "on" : ""}" data-filter="${k}">${l}</button>`).join("")}</div>
  ${out || `<p class="muted">No hay movimientos con este filtro.</p>`}
  <button class="fab" data-new aria-label="Añadir movimiento">+</button>`;
}
function budgets() {
  const tops = db.categories.filter((c) => !c.parentId && !c.income);
  return `<h2>Presupuestos</h2><p class="muted">Límite mensual por categoría. Las subcategorías cuentan dentro de su categoría. Toca una para cambiarlo.</p>
  ${catCard(S.pay)}
  ${tops.map((c) => `<button class="card row" data-limit="${c.id}"><span>${esc(c.name)}</span><span class="${c.limit ? "" : "muted"}">${c.limit ? M(c.limit) + " al mes" : "Sin límite"}</span></button>`).join("")}`;
}
function accounts() {
  return `<h2>Cuentas <button class="link" data-account="">Añadir</button></h2>
  <section class="card"><div class="label">Saldo total</div><div class="mid">${M(S.pay.totalBalance)}</div><div class="label">Saldo líquido (para gastar)</div><div>${M(S.pay.liquidBalance)}</div></section>
  ${db.accounts.filter((a) => !a.archived).map((a) => `<button class="card row" data-account="${a.id}"><span><b>${esc(a.name)}</b><small>${TYPES[a.type]}${a.liquid ? "" : " · no se usa para gastar"}</small></span><span class="${S.bal[a.id] < 0 ? "neg" : ""}">${M(S.bal[a.id] ?? 0)}</span></button>`).join("")}
  <p class="muted small">Saldo = saldo inicial + movimientos realizados. Los previstos no cuentan hasta que se confirman.</p>`;
}
function settings() {
  const s = db.settings;
  return `<h2>Ajustes</h2>
  <section class="card form"><h3>Planificación</h3>
    <label>Próximo cobro<input type="date" id="sPay" value="${s.nextPayday || ""}"></label>
    <label>Colchón que nunca se gasta (€)<input inputmode="decimal" id="sBuf" value="${moneyInput(s.buffer)}"></label>
    <label>Ahorro mensual (€)<input inputmode="decimal" id="sSav" value="${moneyInput(s.monthlySavings)}"></label>
    <button class="btn" data-save-plan>Guardar</button></section>
  <section class="card form"><h3>Asistente</h3>
    <label>Sarcasmo: <b id="sarcLbl">${["Neutra", "Irónica", "Sarcástica", "Despiadada"][s.sarcasm]}</b><input type="range" min="0" max="3" step="1" id="sSarc" value="${s.sarcasm}"></label>
    <label class="sw"><span>Comentarios espontáneos</span><input type="checkbox" id="sRem" ${s.remarks ? "checked" : ""}></label>
    <label class="sw"><span>Reducir movimiento</span><input type="checkbox" id="sRm" ${s.reduceMotion ? "checked" : ""}></label>
    <label class="sw"><span>Ahorro de batería (3D sencillo)</span><input type="checkbox" id="sLow" ${s.quality === "baja" ? "checked" : ""}></label></section>
  <section class="card form"><h3>Datos</h3>
    <label class="sw"><span>Modo demostración<small>Datos de ejemplo guardados aparte. Tus datos reales no se tocan.</small></span><input type="checkbox" id="sDemo" ${demo ? "checked" : ""}></label>
    <button class="btn ghost" data-export>Descargar copia de seguridad</button>
    <button class="btn ghost" data-export-csv>Descargar movimientos (CSV)</button>
    <label class="btn ghost file">Restaurar copia…<input type="file" id="sImport" accept="application/json"></label>
    <p class="muted small">Tus datos se guardan solo en este dispositivo y navegador. Haz copias de vez en cuando hasta que llegue la sincronización.</p></section>
  <p class="muted small">Cuentas Claras · versión web · coste 0 €.</p>`;
}

// ======================= Editor de movimientos =======================
function editor(id) {
  const t = id ? db.transactions.find((x) => x.id === id) : null;
  const d = t ? { ...t } : { id: uid(), ownerId: ME, kind: "GASTO", amount: null, dateTime: C.nowLocal(), status: "REALIZADO", accountId: db.accounts.find((a) => a.liquid)?.id, concept: "", categoryId: null, notes: "" };
  openSheet(`<h3>${t ? "Editar movimiento" : "Nuevo movimiento"}</h3>
    <div class="chips" id="eKind">${[["GASTO", "Gasto"], ["INGRESO", "Ingreso"], ["TRASPASO", "Traspaso"]].map(([k, l]) => `<button type="button" class="chip ${d.kind === k ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <form id="eForm" class="form">
      <label>Importe (€)<input inputmode="decimal" name="amount" value="${moneyInput(d.amount)}" required autofocus></label>
      <label>Concepto<input name="concept" value="${esc(d.concept)}"></label>
      <label id="lAcc">${d.kind === "TRASPASO" ? "Desde la cuenta" : "Cuenta"}<select name="accountId">${accOptions(d.accountId)}</select></label>
      <label id="lTo" ${d.kind === "TRASPASO" ? "" : "hidden"}>Hacia la cuenta<select name="toAccountId">${accOptions(d.toAccountId, d.accountId)}</select></label>
      <label id="lCat" ${d.kind === "TRASPASO" ? "hidden" : ""}>Categoría<select name="categoryId"><option value="">Sin categoría</option>${catOptions(d.kind, d.categoryId)}</select></label>
      <div class="two"><label>Fecha<input type="date" name="date" value="${d.dateTime.slice(0, 10)}"></label><label>Hora<input type="time" name="time" value="${d.dateTime.slice(11, 16)}"></label></div>
      <p class="v small" id="eFuture" hidden>Fecha futura: se guarda como previsto y no se descuenta hasta que lo confirmes.</p>
      ${t ? "" : `<label>Repetir<select name="repeat"><option value="">No</option><option value="SEMANAL">Cada semana</option><option value="MENSUAL">Cada mes</option><option value="ANUAL">Cada año</option></select></label>`}
      <label class="sw" id="lEst" hidden><span>Importe aproximado</span><input type="checkbox" name="estimated" ${d.estimated ? "checked" : ""}></label>
      <label>Notas<input name="notes" value="${esc(d.notes || "")}"></label>
      <p class="w small" id="eDup" hidden></p>
      <div class="actions"><button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" data-close>Cancelar</button>${t ? `<button class="btn danger" type="button" id="eDel">Eliminar</button>` : ""}</div>
    </form>`, (root) => {
    const f = $("#eForm", root); let kind = d.kind;
    const build = () => {
      const amount = C.parseMoney(f.amount.value); const dateTime = `${f.date.value}T${f.time.value || "12:00"}`;
      if (!(amount > 0) || !f.date.value) return null;
      const future = dateTime > C.nowLocal();
      return { ...d, kind, amount, dateTime, concept: f.concept.value.trim(), accountId: f.accountId.value, toAccountId: kind === "TRASPASO" ? f.toAccountId.value : null,
        categoryId: kind === "TRASPASO" ? null : f.categoryId.value || null, notes: f.notes.value.trim(), status: future ? "PREVISTO" : "REALIZADO",
        planned: t ? (t.planned || future) : future, estimated: kind === "INGRESO" && future && f.estimated.checked };
    };
    const refresh = () => {
      const x = build(), future = `${f.date.value}T${f.time.value}` > C.nowLocal();
      $("#eFuture", root).hidden = !future; $("#lEst", root).hidden = !(future && kind === "INGRESO");
      const dup = x && !t ? C.duplicateSuspects(x, S.live)[0] : null;
      $("#eDup", root).hidden = !dup; if (dup) $("#eDup", root).textContent = `Ojo: ya tienes «${dup.concept}» con el mismo importe y fecha parecida.`;
    };
    $("#eKind", root).addEventListener("click", (e) => {
      const k = e.target.dataset.k; if (!k) return; kind = k;
      $("#eKind", root).querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.k === k));
      $("#lTo", root).hidden = k !== "TRASPASO"; $("#lCat", root).hidden = k === "TRASPASO";
      $("#lAcc", root).firstChild.textContent = k === "TRASPASO" ? "Desde la cuenta" : "Cuenta";
      f.categoryId.innerHTML = `<option value="">Sin categoría</option>${catOptions(k, null)}`; refresh();
    });
    f.addEventListener("input", refresh); refresh();
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const x = build();
      if (!x) return toast("Revisa el importe y la fecha.");
      if (x.kind === "TRASPASO" && (!x.toAccountId || x.toAccountId === x.accountId)) return toast("Elige dos cuentas distintas para el traspaso.");
      upsertTx(x);
      const rep = f.repeat?.value;
      if (rep) { const rid = "r-" + uid().slice(0, 8); db.recurrences.push({ id: rid, frequency: rep, interval: 1, start: x.dateTime.slice(0, 10), time: x.dateTime.slice(11, 16), active: true, template: { ...x, id: "tpl-" + rid, status: "PREVISTO", planned: true } });
        // la primera ocurrencia es este mismo movimiento
        db.transactions = db.transactions.filter((y) => y.id !== x.id); db.transactions.push({ ...x, id: C.occurrenceId(rid, x.dateTime.slice(0, 10)), recurrenceId: rid }); materializeAll(); save(); }
      closeSheet(); afterSave([x]);
    });
    $("#eDel", root)?.addEventListener("click", () => { if (confirm("¿Eliminar este movimiento?")) { upsertTx({ ...t, deleted: true }); closeSheet(); render(); toast("Movimiento eliminado."); } });
  });
}
function afterSave(list) {
  render(); const [text, mood, st] = Lines.afterSaving(list);
  if (tab === "inicio") vera((v) => v.speak(text, mood, st)); else toast(text);
}

// ======================= Entrada rápida (texto y voz) =======================
let drafts = [];
function quickEntry(text) {
  const res = C.parseEntry(text, C.nowLocal());
  if (!res.drafts.length) { vera((v) => v.speak(Lines.notUnderstood(), "neutral")); return; }
  const accFor = (p) => (p === "EFECTIVO" ? db.accounts.find((a) => a.type === "EFECTIVO") : p ? db.accounts.find((a) => a.type === "CORRIENTE" || a.type === "TARJETA") : null)?.id ?? db.accounts.find((a) => a.liquid)?.id;
  drafts = res.drafts.map((d) => ({ id: uid(), ownerId: ME, kind: d.kind, amount: d.amount, concept: d.concept, dateTime: d.dateTime, accountId: accFor(d.payment),
    categoryId: d.categoryKey && db.categories.some((c) => c.id === d.categoryKey) ? d.categoryKey : d.kind === "INGRESO" ? "ing-extra" : "otros", notes: "" }));
  vera((v) => v.speak(Lines.draftsReady(drafts.length), "neutral", "atencion"));
  showDrafts();
}
function showDrafts() {
  openSheet(`<h3>${drafts.length === 1 ? "Confirma el movimiento" : `Confirma ${drafts.length} movimientos`}</h3>
    <form id="dForm" class="form">${drafts.map((d, i) => `<fieldset data-i="${i}">
      <div class="two"><label>Tipo<select name="kind"><option value="GASTO" ${d.kind === "GASTO" ? "selected" : ""}>Gasto</option><option value="INGRESO" ${d.kind === "INGRESO" ? "selected" : ""}>Ingreso</option></select></label>
      <label>Importe (€)<input inputmode="decimal" name="amount" value="${moneyInput(d.amount)}"></label></div>
      <label>Concepto<input name="concept" value="${esc(d.concept)}"></label>
      <div class="two"><label>Cuenta<select name="accountId">${accOptions(d.accountId)}</select></label><label>Categoría<select name="categoryId">${catOptions(d.kind, d.categoryId)}</select></label></div>
      <div class="two"><label>Fecha<input type="date" name="date" value="${d.dateTime.slice(0, 10)}"></label><label>Hora<input type="time" name="time" value="${d.dateTime.slice(11, 16)}"></label></div>
      <p class="w small dup" hidden></p></fieldset>`).join("")}
      <div class="actions"><button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" id="dDiscard">Descartar</button></div></form>`, (root) => {
    const f = $("#dForm", root);
    const read = () => [...f.querySelectorAll("fieldset")].map((fs) => { const g = (n) => fs.querySelector(`[name=${n}]`).value; const d = drafts[fs.dataset.i];
      const dateTime = `${g("date")}T${g("time") || "12:00"}`, future = dateTime > C.nowLocal();
      return { ...d, kind: g("kind"), amount: C.parseMoney(g("amount")), concept: g("concept").trim(), accountId: g("accountId"), categoryId: g("categoryId"), dateTime, status: future ? "PREVISTO" : "REALIZADO", planned: future, estimated: false }; });
    const check = () => read().forEach((x, i) => { const p = f.querySelectorAll(".dup")[i], dup = x.amount > 0 ? C.duplicateSuspects(x, S.live)[0] : null; p.hidden = !dup; if (dup) p.textContent = `Parece repetido: ya tienes «${dup.concept}» con el mismo importe.`; });
    f.addEventListener("input", check); check();
    f.addEventListener("submit", (e) => { e.preventDefault(); const list = read(); if (list.some((x) => !(x.amount > 0))) return toast("Revisa los importes."); list.forEach(upsertTx); drafts = []; closeSheet(); afterSave(list); });
    $("#dDiscard", root).addEventListener("click", () => { drafts = []; closeSheet(); vera((v) => v.speak(Lines.discarded(), Lines.mood())); });
  });
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  if (!SR) return toast("Este navegador no permite dictar. Prueba con Chrome, o escribe la frase.");
  const rec = new SR(); rec.lang = "es-ES"; rec.interimResults = true; rec.maxAlternatives = 1;
  $("#mic").classList.add("live"); vera((v) => { v.setState("escucha"); v.show("Escuchando…"); });
  let final = "";
  rec.onresult = (e) => { let txt = ""; for (const r of e.results) { txt += r[0].transcript; if (r.isFinal) final = txt; } vera((v) => v.show("«" + txt + "…»")); };
  rec.onerror = (e) => { toast(e.error === "not-allowed" ? "Permite el micrófono para dictar." : "No te he oído bien. Prueba otra vez."); };
  rec.onend = () => { $("#mic").classList.remove("live"); if (final.trim()) { vera((v) => { v.setState("pensando"); v.show("«" + final + "»"); }); setTimeout(() => quickEntry(final), 600); } else vera((v) => { v.setState("reposo"); v.hide(); }); };
  rec.start();
}

// ======================= Eventos =======================
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-edit],[data-new],[data-confirm],[data-filter],[data-limit],[data-account],[data-save-plan],[data-export],[data-export-csv],[data-close],[data-act]");
  if (!el) return;
  if (el.dataset.edit) return editor(el.dataset.edit);
  if ("new" in el.dataset) return editor(null);
  if (el.dataset.confirm) { const t = db.transactions.find((x) => x.id === el.dataset.confirm); upsertTx(C.confirmTx(t)); afterSave([t]); return; }
  if (el.dataset.filter) { filter = el.dataset.filter; return render(); }
  if (el.dataset.limit) return limitSheet(el.dataset.limit);
  if ("account" in el.dataset) return accountSheet(el.dataset.account);
  if ("savePlan" in el.dataset) { const b = C.parseMoney($("#sBuf").value || "0"), s = C.parseMoney($("#sSav").value || "0"); if (b == null || s == null) return toast("Revisa los importes."); Object.assign(db.settings, { nextPayday: $("#sPay").value || null, buffer: b, monthlySavings: s }); save(); render(); return toast("Planificación guardada."); }
  if ("export" in el.dataset) return download(`cuentas-claras-${C.dateOf(C.nowLocal())}.json`, JSON.stringify(db, null, 2), "application/json");
  if ("exportCsv" in el.dataset) return download(`movimientos-${C.dateOf(C.nowLocal())}.csv`, csv(), "text/csv");
  if ("close" in el.dataset) return closeSheet();
  if (el.dataset.act === "explain" && !e.target.closest("details")) vera((v) => v.speak(Lines.explain(), Lines.mood()));
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { query = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }
  if (e.target.id === "sSarc") { db.settings.sarcasm = Number(e.target.value); $("#sarcLbl").textContent = ["Neutra", "Irónica", "Sarcástica", "Despiadada"][db.settings.sarcasm]; save(); configVera(); }
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "sRem") { db.settings.remarks = e.target.checked; save(); configVera(); }
  if (id === "sRm") { db.settings.reduceMotion = e.target.checked; save(); configVera(); }
  if (id === "sLow") { db.settings.quality = e.target.checked ? "baja" : "alta"; save(); configVera(); }
  if (id === "sDemo") { demo = e.target.checked; localStorage.setItem("cc.mode", demo ? "demo" : "real"); db = load(); materializeAll(); save(); render(); toast(demo ? "Modo demostración." : "Ahora ves tus datos reales."); }
  if (id === "sImport") { const file = e.target.files[0]; if (!file) return; file.text().then((txt) => { const d = JSON.parse(txt); if (!Array.isArray(d.transactions) || !Array.isArray(d.accounts)) throw new Error("formato"); if (!confirm("Esto sustituye los datos actuales de este modo por los de la copia. ¿Continuar?")) return; db = d; save(); render(); toast("Copia restaurada."); }).catch(() => toast("Ese archivo no es una copia válida de Cuentas Claras.")); }
});
addEventListener("hashchange", () => { tab = location.hash.replace("#", "") || "inicio"; render(); });
$("#quickForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#quickText").value.trim(); if (v) { quickEntry(v); $("#quickText").value = ""; } });
$("#mic").addEventListener("click", listen);
$("#add").addEventListener("click", () => editor(null));
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
// la mirada de Vera sigue al dedo también fuera de su escena
addEventListener("pointermove", (e) => { if (tab !== "inicio" || !veraReady) return; const r = frame.getBoundingClientRect(); frame.contentWindow.postMessage({ pointer: { x: e.clientX - r.left, y: e.clientY - r.top } }, "*"); }, { passive: true });

function limitSheet(id) {
  const c = db.categories.find((x) => x.id === id);
  openSheet(`<h3>Límite de ${esc(c.name)}</h3><form class="form" id="lForm"><label>€ al mes (vacío = sin límite)<input inputmode="decimal" name="v" value="${moneyInput(c.limit)}" autofocus></label>
    <div class="actions"><button class="btn">Guardar</button><button class="btn ghost" type="button" data-close>Cancelar</button></div></form>`, (root) => {
    $("#lForm", root).addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.v.value.trim(); const m = v ? C.parseMoney(v) : null; if (v && m == null) return toast("Importe no válido."); c.limit = m > 0 ? m : null; save(); closeSheet(); render(); });
  });
}
function accountSheet(id) {
  const a = id ? db.accounts.find((x) => x.id === id) : { id: uid(), ownerId: ME, name: "", type: "CORRIENTE", opening: 0, liquid: true };
  openSheet(`<h3>${id ? "Editar cuenta" : "Nueva cuenta"}</h3><form class="form" id="aForm">
    <label>Nombre<input name="name" value="${esc(a.name)}" required></label>
    <label>Tipo<select name="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === a.type ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label>Saldo inicial (€)<input inputmode="decimal" name="opening" value="${moneyInput(a.opening)}"></label>
    <label class="sw"><span>Dinero para gastar<small>Desactívalo en cuentas de ahorro o inversión.</small></span><input type="checkbox" name="liquid" ${a.liquid ? "checked" : ""}></label>
    <div class="actions"><button class="btn">Guardar</button><button class="btn ghost" type="button" data-close>Cancelar</button></div></form>`, (root) => {
    const f = $("#aForm", root);
    f.type.addEventListener("change", () => { f.liquid.checked = !["AHORRO", "INVERSION"].includes(f.type.value); });
    f.addEventListener("submit", (e) => { e.preventDefault(); const op = C.parseMoney(f.opening.value || "0"); if (op == null) return toast("Saldo inicial no válido.");
      const x = { ...a, name: f.name.value.trim(), type: f.type.value, opening: op, liquid: f.liquid.checked };
      const i = db.accounts.findIndex((y) => y.id === x.id); if (i >= 0) db.accounts[i] = x; else db.accounts.push(x); save(); closeSheet(); render(); });
  });
}
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function csv() {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["Fecha", "Hora", "Tipo", "Estado", "Importe", "Concepto", "Categoría", "Cuenta", "Cuenta destino", "Notas"]];
  for (const t of S.live.sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1))) rows.push([t.dateTime.slice(0, 10), t.dateTime.slice(11, 16), t.kind, C.effectiveStatus(t, S.now), (t.amount / 100).toFixed(2).replace(".", ","), t.concept, catName(t.categoryId), accName(t.accountId), accName(t.toAccountId), t.notes]);
  return "﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n");
}

// ======================= Arranque =======================
db = load(); materializeAll(); save(); render();
setInterval(() => { const before = S?.now?.slice(0, 10); compute(); if (S.now.slice(0, 10) !== before) { materializeAll(); save(); render(); } }, 60000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
