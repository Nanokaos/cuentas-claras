// Motor financiero determinista (versión web). Mismas reglas que core/ en Kotlin.
// Dinero: enteros en céntimos. Fechas: texto "AAAA-MM-DD" y "AAAA-MM-DDTHH:MM", aritmética en días UTC.

// ---------------- Dinero ----------------
export const fmtMoney = (c, plus = false) => {
  const neg = c < 0, a = Math.abs(c), e = Math.floor(a / 100).toString(), ct = (a % 100).toString().padStart(2, "0");
  const g = e.length < 5 ? e : e.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : plus && c > 0 ? "+" : ""}${g},${ct} €`;
};
export function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/(€|euros?|eur)/gi, "").replace(/[\s ]/g, "");
  if (!s) return null;
  let neg = false;
  if (s[0] === "-" || s[0] === "−") { neg = true; s = s.slice(1); } else if (s[0] === "+") s = s.slice(1);
  const hc = s.includes(","), hd = s.includes(".");
  let n;
  if (hc && hd) n = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (hc) n = (s.match(/,/g).length === 1) ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (hd) { const dots = s.match(/\./g).length, after = s.length - s.lastIndexOf(".") - 1; n = (dots > 1 || after === 3) ? s.replace(/\./g, "") : s; }
  else n = s;
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  const [ip, fp = ""] = n.split(".");
  let cents = Number(ip) * 100 + Number((fp + "00").slice(0, 2));
  if (fp.length > 2 && Number(fp[2]) >= 5) cents += 1; // redondeo half-up
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}
export const floorDiv = (c, n) => Math.floor(c / n);

// ---------------- Fechas ----------------
const pad = (n) => String(n).padStart(2, "0");
export const dayNum = (d) => { const [y, m, dd] = d.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, dd) / 864e5; };
export const fromDayNum = (n) => { const t = new Date(n * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const addDays = (d, k) => fromDayNum(dayNum(d) + k);
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const dateOf = (dt) => dt.slice(0, 10);
export const dow = (d) => (new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7; // 0 = lunes
export const lastDayOfMonth = (d) => { const [y, m] = d.split("-").map(Number); return fromDayNum(Date.UTC(y, m, 0) / 864e5); };
export const firstDayOfMonth = (d) => d.slice(0, 8) + "01";
export function addMonths(d, k) {
  const [y, m, dd] = d.split("-").map(Number); const t = (y * 12 + (m - 1)) + k, ny = Math.floor(t / 12), nm = t % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(dd, last))}`;
}
export const nowLocal = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const fmtDay = (d) => `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}`;
export const fmtDayLong = (d) => `${DIAS[dow(d)]} ${fmtDay(d)}`;

// ---------------- Movimientos ----------------
// tx: { id, ownerId, kind: GASTO|INGRESO|TRASPASO|DEVOLUCION|AJUSTE|LIQUIDACION, amount (céntimos), dateTime,
//       status: REALIZADO|PREVISTO, accountId, toAccountId, concept, categoryId, notes, split, planned, estimated,
//       recurrenceId, refundOf, goalId, counterpartUserId, deleted }
export const effectiveStatus = (tx, now) => tx.status === "REALIZADO" ? "REALIZADO" : (tx.dateTime <= now ? "PENDIENTE" : "PREVISTO");
export const confirmTx = (tx, amount = tx.amount, dateTime = tx.dateTime) => ({ ...tx, status: "REALIZADO", amount, dateTime, estimated: false });

// ---------------- Repartos ----------------
export function allocate(total, weights) {
  const ids = Object.keys(weights).sort(), sumW = ids.reduce((a, k) => a + weights[k], 0);
  if (sumW <= 0) throw new Error("Pesos vacíos");
  const sign = total < 0 ? -1 : 1, abs = Math.abs(total), base = {}, rem = [];
  for (const k of ids) { const p = abs * weights[k]; const q = Math.floor(p / sumW); base[k] = q; rem.push([k, p - q * sumW]); }
  let left = abs - ids.reduce((a, k) => a + base[k], 0);
  rem.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [k] of rem) { if (left <= 0) break; base[k]++; left--; }
  const out = {}; for (const k of ids) out[k] = base[k] * sign; return out;
}
// rule: {type:"equal", participants:[...]} | {type:"percent", bp:{id:6000}} | {type:"amounts", amounts:{id:cents}}
export function shares(total, rule) {
  if (rule.type === "equal") { if (!rule.participants.length) throw new Error("Reparto sin participantes"); return allocate(total, Object.fromEntries([...new Set(rule.participants)].map((p) => [p, 1]))); }
  if (rule.type === "percent") { const s = Object.values(rule.bp).reduce((a, b) => a + b, 0); if (s !== 10000 || Object.values(rule.bp).some((v) => v < 0)) throw new Error("Los porcentajes deben sumar 100 %"); return allocate(total, rule.bp); }
  const sum = Object.values(rule.amounts).reduce((a, b) => a + b, 0);
  return sum === total ? { ...rule.amounts } : allocate(total, rule.amounts);
}
export const participants = (split) => split.rule.type === "equal" ? split.rule.participants : Object.keys(split.rule.type === "percent" ? split.rule.bp : split.rule.amounts);
export const shareOf = (tx, user, split = tx.split) => !split ? (tx.ownerId === user ? tx.amount : 0) : (shares(tx.amount, split.rule)[user] ?? 0);
export function balanceBetween(a, b, txs) {
  const byId = Object.fromEntries(txs.map((t) => [t.id, t])); let net = 0;
  for (const t of txs) {
    if (t.deleted || t.status !== "REALIZADO") continue;
    if (t.kind === "GASTO" || t.kind === "DEVOLUCION") {
      const split = t.kind === "DEVOLUCION" ? byId[t.refundOf]?.split : t.split; if (!split) continue;
      const sh = shares(t.amount, split.rule), dir = t.kind === "GASTO" ? 1 : -1;
      if (split.payerId === a) net += (sh[b] ?? 0) * dir;
      if (split.payerId === b) net -= (sh[a] ?? 0) * dir;
    } else if (t.kind === "LIQUIDACION") {
      if (t.ownerId === b && t.counterpartUserId === a) net -= t.amount;
      if (t.ownerId === a && t.counterpartUserId === b) net += t.amount;
    }
  }
  return net;
}

// ---------------- Saldos y gasto ----------------
export function balanceEffects(t) {
  switch (t.kind) {
    case "GASTO": return t.accountId ? [[t.accountId, -t.amount]] : [];
    case "INGRESO": case "DEVOLUCION": case "AJUSTE": return t.accountId ? [[t.accountId, t.amount]] : [];
    default: return [...(t.accountId ? [[t.accountId, -t.amount]] : []), ...(t.toAccountId ? [[t.toAccountId, t.amount]] : [])];
  }
}
export function balances(accounts, txs) {
  const r = Object.fromEntries(accounts.map((a) => [a.id, a.opening ?? 0]));
  for (const t of txs) { if (t.deleted || t.status !== "REALIZADO") continue; for (const [id, d] of balanceEffects(t)) if (id in r) r[id] += d; }
  return r;
}
export const categoryOf = (t, byId) => t.categoryId ?? byId[t.refundOf]?.categoryId ?? null;
export function spendingShare(t, user, byId) {
  if (t.kind === "GASTO") return shareOf(t, user);
  if (t.kind === "DEVOLUCION") {
    const o = byId[t.refundOf], split = o?.split ?? t.split, owner = o?.ownerId ?? t.ownerId;
    return -(!split ? (owner === user ? t.amount : 0) : (shares(t.amount, split.rule)[user] ?? 0));
  }
  return 0;
}
export function householdSpending(t) {
  if (!t.split && !t.refundOf) return 0;
  return t.kind === "GASTO" ? t.amount : t.kind === "DEVOLUCION" ? -t.amount : 0;
}
export function subtree(rootId, cats) {
  const out = new Set(), stack = [rootId];
  while (stack.length) { const id = stack.pop(); if (out.has(id)) continue; out.add(id); cats.filter((c) => c.parentId === id).forEach((c) => stack.push(c.id)); }
  return out;
}
export const debtRemaining = (debtId, total, txs) => Math.max(0, total - txs.filter((t) => t.debtId === debtId && !t.deleted && t.status === "REALIZADO" && t.kind === "GASTO").reduce((a, t) => a + t.amount, 0));

// ---------------- Recurrentes ----------------
// rule: { id, template (tx), frequency: DIARIA|SEMANAL|MENSUAL|ANUAL, interval, start, end, count, time:"HH:MM", active }
export const occurrenceId = (ruleId, d) => `${ruleId}@${d}`;
function nth(rule, n) {
  const k = n * (rule.interval || 1);
  switch (rule.frequency) { case "DIARIA": return addDays(rule.start, k); case "SEMANAL": return addDays(rule.start, 7 * k); case "MENSUAL": return addMonths(rule.start, k); default: return addMonths(rule.start, 12 * k); }
}
export function recurrenceDates(rule, from, to) {
  if (rule.active === false || to < from) return [];
  const out = [];
  for (let n = 0; n < 100000; n++) {
    if (rule.count != null && n >= rule.count) break;
    const d = nth(rule, n); if (d > to) break; if (rule.end && d > rule.end) break;
    if (d >= from) out.push(d);
  }
  return out;
}
export const materialize = (rule, from, to, existingIds) => recurrenceDates(rule, from, to)
  .map((d) => [occurrenceId(rule.id, d), d]).filter(([id]) => !existingIds.has(id))
  .map(([id, d]) => ({ ...rule.template, id, dateTime: `${d}T${rule.time || "09:00"}`, status: "PREVISTO", planned: true, recurrenceId: rule.id, deleted: false }));

// ---------------- Presupuesto ----------------
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
/**
 * input: { userId, now:"AAAA-MM-DDTHH:MM", accounts, transactions, settings:{buffer, monthlySavings, nextPayday, reserveSettlementDebt=true},
 *          goals, contributions, categories, limits:[{categoryId, monthlyLimit}], settlementOwed }
 */
export function computeBudget(input, kind) {
  const today = dateOf(input.now), warnings = [], st = { reserveSettlementDebt: true, buffer: 0, monthlySavings: 0, ...input.settings };
  const monthEnd = lastDayOfMonth(today);
  let horizon;
  if (kind === "FIN_DE_MES") horizon = { kind, endDate: monthEnd, days: daysBetween(today, monthEnd) + 1, provisional: false };
  else if (!st.nextPayday) { warnings.push({ code: "SIN_FECHA_COBRO", message: "Indica la fecha de tu próximo cobro para calcular hasta entonces. Mientras, se usa fin de mes." }); horizon = { kind, endDate: monthEnd, days: daysBetween(today, monthEnd) + 1, provisional: true }; }
  else if (st.nextPayday <= today) { warnings.push({ code: "FECHA_COBRO_PASADA", message: `La fecha del próximo cobro (${fmtDay(st.nextPayday)}) ya ha llegado. Actualízala. Mientras, se usa fin de mes.` }); horizon = { kind, endDate: monthEnd, days: daysBetween(today, monthEnd) + 1, provisional: true }; }
  else horizon = { kind, endDate: st.nextPayday, days: daysBetween(today, st.nextPayday), provisional: false };

  const mine = input.accounts.filter((a) => a.ownerId === input.userId && !a.archived);
  const liquid = new Set(mine.filter((a) => a.liquid).map((a) => a.id)), myIds = new Set(mine.map((a) => a.id));
  const live = input.transactions.filter((t) => !t.deleted), byId = Object.fromEntries(input.transactions.map((t) => [t.id, t]));
  const bal = balances(mine, live);
  const totalBalance = sum(mine, (a) => bal[a.id]), liquidBalance = sum(mine.filter((a) => a.liquid), (a) => bal[a.id]);

  const notDone = live.filter((t) => t.status === "PREVISTO" && dateOf(t.dateTime) <= horizon.endDate);
  const obligationItems = notDone.filter((t) => (t.kind === "GASTO" || t.kind === "LIQUIDACION") && liquid.has(t.accountId))
    .sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1))
    .map((t) => ({ transactionId: t.id, concept: t.concept, date: dateOf(t.dateTime), amount: t.amount, overdue: effectiveStatus(t, input.now) === "PENDIENTE" }));
  const scheduledSettlements = sum(notDone.filter((t) => t.kind === "LIQUIDACION" && liquid.has(t.accountId)), (t) => t.amount);
  const obligations = sum(obligationItems, (i) => i.amount);
  const overdue = obligationItems.filter((i) => i.overdue);
  if (overdue.length) warnings.push({ code: "PENDIENTES_VENCIDOS", message: `Hay ${overdue.length} pago(s) con fecha pasada sin confirmar (${fmtMoney(sum(overdue, (i) => i.amount))}). Se siguen reservando hasta que los confirmes o elimines.` });

  const monthStart = firstDayOfMonth(today);
  const savingsDone = sum(live.filter((t) => t.kind === "TRASPASO" && t.status === "REALIZADO" && !t.goalId && liquid.has(t.accountId) && myIds.has(t.toAccountId) && !liquid.has(t.toAccountId) && dateOf(t.dateTime) >= monthStart && dateOf(t.dateTime) <= today), (t) => t.amount);
  const scheduledSavings = sum(notDone.filter((t) => t.kind === "TRASPASO" && !t.goalId && liquid.has(t.accountId) && !liquid.has(t.toAccountId)), (t) => t.amount);
  const savings = Math.max(Math.max(0, st.monthlySavings - savingsDone), scheduledSavings);

  const goals = sum((input.goals || []).filter((g) => g.active !== false && g.ownerId === input.userId), (g) => {
    const all = (input.contributions || []).filter((c) => c.goalId === g.id), saved = sum(all, (c) => c.amount);
    const thisMonth = sum(all.filter((c) => c.date >= monthStart && c.date <= today), (c) => c.amount);
    const monthly = Math.max(0, Math.min(g.monthlyContribution, Math.max(0, g.target - saved)) - thisMonth);
    return monthly + (g.heldInLiquidAccount ? Math.max(0, Math.min(saved, g.target)) : 0);
  });
  const settlementDebt = st.reserveSettlementDebt ? Math.max(0, Math.max(0, input.settlementOwed || 0) - scheduledSettlements) : 0;
  const reserved = { obligations, obligationItems, savings, goals, buffer: Math.max(0, st.buffer), settlementDebt };
  reserved.total = obligations + savings + goals + reserved.buffer + settlementDebt;
  const available = liquidBalance - reserved.total, deficit = available < 0 ? -available : 0;

  const spentToday = sum(live.filter((t) => t.kind === "GASTO" && t.status === "REALIZADO" && !t.planned && dateOf(t.dateTime) === today && liquid.has(t.accountId)), (t) => t.amount);
  const startOfDay = available + spentToday;
  const dailyRate = startOfDay > 0 ? floorDiv(startOfDay, horizon.days) : 0;
  const todayAllowance = dailyRate - spentToday;
  const sunday = addDays(today, 6 - dow(today)), lastSpend = addDays(today, horizon.days - 1);
  const weekEnd = sunday < lastSpend ? sunday : lastSpend;
  const thisWeek = Math.min(dailyRate * Math.max(1, daysBetween(today, weekEnd) + 1) - spentToday, Math.max(available, 0));

  const incomeTxs = notDone.filter((t) => t.kind === "INGRESO" && liquid.has(t.accountId) && (kind === "FIN_DE_MES" || horizon.provisional || dateOf(t.dateTime) < horizon.endDate));
  const expectedIncome = sum(incomeTxs, (t) => t.amount), expectedIncomeIsEstimate = incomeTxs.some((t) => t.estimated);
  if (expectedIncomeIsEstimate) warnings.push({ code: "INGRESOS_ESTIMADOS", message: "Algunos ingresos previstos son estimaciones; el importe real puede variar." });
  if (available < 0) warnings.push({ code: "DEFICIT", message: `Faltan ${fmtMoney(deficit)} para cubrir lo reservado hasta el ${fmtDay(horizon.endDate)}. Si no cambia nada, tendrás que usar el colchón, retrasar el ahorro o aplazar algún pago.` });

  const categories = categoryStatuses(input, today, byId, live);
  const explanation = [{ kind: "BASE", text: "Saldo líquido en tus cuentas", amount: liquidBalance }];
  if (obligations > 0) explanation.push({ kind: "RESTA", text: `Recibos y cuotas hasta el ${fmtDay(horizon.endDate)} (${obligationItems.length})`, amount: obligations });
  if (savings > 0) explanation.push({ kind: "RESTA", text: "Ahorro del mes por apartar", amount: savings });
  if (goals > 0) explanation.push({ kind: "RESTA", text: "Objetivos", amount: goals });
  if (reserved.buffer > 0) explanation.push({ kind: "RESTA", text: "Colchón", amount: reserved.buffer });
  if (settlementDebt > 0) explanation.push({ kind: "RESTA", text: "Lo que debes a tu pareja", amount: settlementDebt });
  explanation.push({ kind: "RESULTADO", text: `Disponible para ${horizon.days} día(s)`, amount: available });
  if (dailyRate > 0) explanation.push({ kind: "NOTA", text: `Unos ${fmtMoney(dailyRate)} al día` });
  if (expectedIncome > 0) explanation.push({ kind: "NOTA", text: `No incluye ${fmtMoney(expectedIncome)} de ingresos previstos${expectedIncomeIsEstimate ? " (estimados)" : ""}: aún no los has cobrado.` });
  if (horizon.provisional) explanation.push({ kind: "NOTA", text: "Cálculo provisional hasta fin de mes: falta la fecha del próximo cobro." });

  return { horizon, totalBalance, liquidBalance, reserved, available, deficit, dailyRate, today: todayAllowance, thisWeek, spentToday,
    expectedIncome, expectedIncomeIsEstimate, availableWithExpectedIncome: available + expectedIncome, categories, explanation, warnings };
}
function categoryStatuses(input, today, byId, live) {
  if (!input.limits?.length) return [];
  const ms = firstDayOfMonth(today), me = lastDayOfMonth(today), dim = Number(me.slice(8)), daysLeft = daysBetween(today, me) + 1;
  const inMonth = live.filter((t) => dateOf(t.dateTime) >= ms && dateOf(t.dateTime) <= me);
  const names = Object.fromEntries((input.categories || []).map((c) => [c.id, c.name]));
  return input.limits.map((l) => {
    const ids = subtree(l.categoryId, input.categories || []), inCat = inMonth.filter((t) => ids.has(categoryOf(t, byId)));
    const spent = sum(inCat.filter((t) => t.status === "REALIZADO"), (t) => spendingShare(t, input.userId, byId));
    const committed = sum(inCat.filter((t) => t.status === "PREVISTO" && t.kind === "GASTO"), (t) => spendingShare(t, input.userId, byId));
    const remaining = l.monthlyLimit - spent - committed, pace = Math.trunc(l.monthlyLimit * Number(today.slice(8)) / dim);
    return { categoryId: l.categoryId, name: names[l.categoryId] ?? l.categoryId, limit: l.monthlyLimit, spent, committed, remaining,
      perDay: remaining > 0 ? floorDiv(remaining, daysLeft) : 0, state: remaining < 0 ? "SUPERADO" : spent > pace ? "ATENCION" : "BIEN" };
  });
}

// ---------------- Duplicados ----------------
export const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export function duplicateSuspects(c, existing, maxDays = 1) {
  const sim = (a, b) => { const x = normalize(a), y = normalize(b); return !x || !y || x === y || x.includes(y) || y.includes(x); };
  return existing.filter((t) => !t.deleted && t.id !== c.id && t.ownerId === c.ownerId && t.kind === c.kind && t.amount === c.amount
    && Math.abs(daysBetween(dateOf(t.dateTime), dateOf(c.dateTime))) <= maxDays && sim(t.concept || "", c.concept || ""));
}

// ---------------- Intérprete de frases (sin IA) ----------------
const WEEK = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CAT_WORDS = [
  ["comida", ["supermercado", "super", "mercadona", "lidl", "carrefour", "dia", "aldi", "eroski", "alcampo", "compra", "fruteria", "carniceria", "panaderia", "pescaderia"]],
  ["ocio", ["cenar", "cena", "comer fuera", "restaurante", "bar", "cafe", "copas", "cine", "concierto", "teatro", "tapas", "cerveza", "brunch", "desayunar"]],
  ["suscripciones", ["netflix", "spotify", "hbo", "max", "disney", "prime", "suscripcion", "gimnasio", "gym", "icloud", "youtube"]],
  ["transporte", ["gasolina", "gasoil", "diesel", "metro", "bus", "autobus", "taxi", "uber", "cabify", "tren", "renfe", "parking", "aparcamiento", "peaje", "abono"]],
  ["hogar", ["alquiler", "hipoteca", "luz", "agua", "gas", "internet", "fibra", "comunidad", "ikea", "limpieza"]],
  ["salud", ["farmacia", "medico", "dentista", "fisio", "optica"]],
  ["ropa", ["ropa", "zapatos", "zapatillas", "zara", "primark"]],
];
const FILLERS = new Set(("el la los las lo un una unos unas en de del al para por con me he ha hemos se mi mis nos gaste gastado gastamos pague pagado pagamos pago cobre cobrado ingreso ingresaron ingresado recibi han hoy que y e eso tarjeta efectivo bizum transferencia metalico cash visa debito credito euro euros eur pavos gasto compre comprado costo costado fueron fue todo toda todos todas ambos ambas dos echado echo").split(" "));
const INCOME = /\b(cobre|cobrado|ingreso|ingresaron|ingresado|nomina|me pagaron|me han pagado|me devolvieron|recibi)\b/;
const AMOUNT = /(?<![\d:])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d:])\s*(€|euros?|eur|pavos)?/;
export const categoryFor = (concept) => { const c = ` ${normalize(concept)} `; return CAT_WORDS.find(([, w]) => w.some((x) => c.includes(` ${x} `)))?.[0] ?? null; };
function payment(seg) {
  if (/\btarjeta|\bvisa\b|\bdebito\b|\bcredito\b|\bdatafono\b/.test(seg)) return "TARJETA";
  if (/\befectivo\b|\bmetalico\b|\bcash\b|\ben mano\b/.test(seg)) return "EFECTIVO";
  if (/\bbizum\b/.test(seg)) return "BIZUM";
  if (/\btransferencia\b/.test(seg)) return "TRANSFERENCIA";
  return null;
}
export function parseEntry(text, now) {
  let s = text.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const today = dateOf(now); let date = today, explicit = false, m;
  const cut = (mm) => { s = s.slice(0, mm.index) + s.slice(mm.index + mm[0].length); };
  if ((m = s.match(/\b(anteayer|antes de ayer|antier)\b/))) { date = addDays(today, -2); explicit = true; cut(m); }
  else if ((m = s.match(/\bayer\b/))) { date = addDays(today, -1); explicit = true; cut(m); }
  else if ((m = s.match(/\bpasado manana\b/))) { date = addDays(today, 2); explicit = true; cut(m); }
  else if ((m = s.match(/\bmanana\b/))) { date = addDays(today, 1); explicit = true; cut(m); }
  else if ((m = s.match(/\bhoy\b/))) { explicit = true; cut(m); }
  else if ((m = s.match(new RegExp(`\\b(?:el )?(\\d{1,2}) de (${MONTHS.join("|")})(?: de (\\d{4}))?\\b`)))) {
    const y = m[3] ? Number(m[3]) : Number(today.slice(0, 4)), mo = MONTHS.indexOf(m[2]) + 1, d = Number(m[1]);
    const cand = `${y}-${pad(mo)}-${pad(d)}`; if (lastDayOfMonth(cand.slice(0, 8) + "01") >= cand) { date = cand; explicit = true; cut(m); }
  } else if ((m = s.match(/\bel dia (\d{1,2})\b/))) {
    const d = Number(m[1]), cand = today.slice(0, 8) + pad(d);
    if (d >= 1 && cand <= lastDayOfMonth(today)) { date = cand <= today ? cand : (() => { const pm = addMonths(today, -1); return pm.slice(0, 8) + pad(Math.min(d, Number(lastDayOfMonth(pm).slice(8)))); })(); explicit = true; cut(m); }
  } else if ((m = s.match(new RegExp(`\\b(?:el )?(?:pasado )?(${Object.keys(WEEK).join("|")})(?: pasado)?\\b`)))) {
    const target = WEEK[m[1]]; let back = (dow(today) - target + 7) % 7; if (back === 0) back = 7; date = addDays(today, -back); explicit = true; cut(m);
  }
  let time = now.slice(11, 16);
  if ((m = s.match(/\ba las (\d{1,2})(?::(\d{2}))?\b/))) { const h = Number(m[1]), mi = Number(m[2] ?? 0); if (h < 24 && mi < 60) { time = `${pad(h)}:${pad(mi)}`; cut(m); } }
  const sentenceIncome = INCOME.test(s);
  const items = [], general = [];
  const segs = s.split(";").flatMap((x) => x.split(/(?<!\d),|,(?!\d)|\by\b|\be\b/)).map((x) => x.trim()).filter(Boolean);
  for (const seg of segs) {
    const pay = payment(seg), am = seg.match(AMOUNT), amountText = am?.[1] ?? null, amount = amountText ? parseMoney(amountText) : null;
    const clean = (t) => t.replace(/[^a-z0-9ñ ]/g, " ").split(" ").filter((w) => w && !FILLERS.has(w)).join(" ");
    const concept = am ? (clean(seg.slice(am.index + am[0].length)) || clean(seg.slice(0, am.index))) : clean(seg);
    const refers = amountText != null && items.some((i) => i.amountText === amountText);
    if (pay && !concept && (amountText == null || refers)) {
      if (amountText == null) general.push(pay); else items.filter((i) => i.amountText === amountText && !i.payment).forEach((i) => { i.payment = pay; });
      continue;
    }
    if (amount == null) continue;
    const kind = INCOME.test(seg) || (sentenceIncome && !/\b(gaste|pague|gastado|pagado)\b/.test(seg)) ? "INGRESO" : "GASTO";
    items.push({ amount, amountText, concept, kind, payment: pay });
  }
  if (general.length === 1) items.filter((i) => !i.payment).forEach((i) => { i.payment = general[0]; });
  return {
    dateWasExplicit: explicit,
    drafts: items.map((i) => ({
      kind: i.kind, amount: i.amount, concept: i.concept ? i.concept[0].toUpperCase() + i.concept.slice(1) : "",
      categoryKey: i.kind === "GASTO" ? categoryFor(i.concept) : null, dateTime: `${date}T${time}`, payment: i.payment,
      missing: [...(i.amount == null ? ["IMPORTE"] : []), ...(i.payment ? [] : ["CUENTA"]), ...(i.concept ? [] : ["CONCEPTO"])],
    })),
  };
}
