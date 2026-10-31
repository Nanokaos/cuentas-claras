// Mismos casos que core/src/test en Kotlin. Ejecutar: node --test web/test/
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../core.js";

const ANA = "ana", LUIS = "luis", NOW = "2026-11-10T12:00", TODAY = "2026-11-10";
const e = (s) => C.parseMoney(s);
const accounts = [
  { id: "cc", ownerId: ANA, name: "Cuenta corriente", type: "CORRIENTE", opening: e("1500"), liquid: true },
  { id: "cash", ownerId: ANA, name: "Efectivo", type: "EFECTIVO", opening: e("100"), liquid: true },
  { id: "sav", ownerId: ANA, name: "Ahorro", type: "AHORRO", opening: e("2000"), liquid: false },
  { id: "luis-cc", ownerId: LUIS, name: "Cuenta Luis", type: "CORRIENTE", opening: e("900"), liquid: true },
];
let seq = 0;
const tx = (kind, amount, o = {}) => ({ id: o.id ?? `t${++seq}`, ownerId: o.owner ?? ANA, kind, amount: e(amount), dateTime: o.date ?? "2026-11-10T11:00",
  status: o.status ?? "REALIZADO", accountId: o.account === undefined ? "cc" : o.account, toAccountId: o.to ?? null, concept: o.concept ?? "",
  categoryId: o.category ?? null, split: o.split ?? null, planned: o.planned ?? (o.status === "PREVISTO"), estimated: o.estimated ?? false,
  refundOf: o.refundOf ?? null, debtId: o.debtId ?? null, counterpartUserId: o.counterpart ?? null, goalId: null, deleted: false });
const day = (d, h = 9) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00`;
const planned = (amount, d, o = {}) => tx(o.kind ?? "GASTO", amount, { ...o, date: `2026-${String(o.month ?? 11).padStart(2, "0")}-${String(d).padStart(2, "0")}T09:00`, status: "PREVISTO" });
const S28 = { buffer: e("200"), monthlySavings: e("100"), nextPayday: "2026-11-28" };
const run = (txs, o = {}) => C.computeBudget({ userId: o.user ?? ANA, now: NOW, accounts, transactions: txs, settings: o.settings ?? S28,
  goals: o.goals ?? [], contributions: o.contributions ?? [], categories: o.categories ?? [], limits: o.limits ?? [], settlementOwed: o.owed ?? 0 }, o.kind ?? "HASTA_COBRO");
const half = (payer) => ({ payerId: payer, rule: { type: "equal", participants: [ANA, LUIS] } });

test("dinero: formatos de España", () => {
  assert.equal(e("23,50"), 2350); assert.equal(e("23.50 €"), 2350); assert.equal(e("1.234,56"), 123456); assert.equal(e("1.234"), 123400);
  assert.equal(e("8 euros"), 800); assert.equal(e("-15"), -1500); assert.equal(e("23,456"), 2346); assert.equal(e("abc"), null); assert.equal(e(""), null);
  assert.equal(C.fmtMoney(123450), "1234,50 €"); assert.equal(C.fmtMoney(1234500), "12.345,00 €"); assert.equal(C.fmtMoney(-5), "-0,05 €");
  assert.equal(C.floorDiv(1000, 3), 333); assert.equal(C.floorDiv(-1000, 3), -334);
});
test("repartos exactos y saldo de pareja", () => {
  const sh = C.shares(e("10,01"), { type: "equal", participants: [LUIS, ANA] }); assert.equal(sh[ANA], 501); assert.equal(sh[LUIS], 500);
  assert.throws(() => C.shares(e("100"), { type: "percent", bp: { [ANA]: 6000, [LUIS]: 3000 } }));
  assert.equal(C.shares(e("10"), { type: "amounts", amounts: { [ANA]: e("70"), [LUIS]: e("30") } })[ANA], e("7"));
  const cena = tx("GASTO", "100", { split: half(ANA), id: "cena" }), luisPaga = tx("GASTO", "60", { owner: LUIS, account: "luis-cc", split: half(LUIS) });
  assert.equal(C.balanceBetween(ANA, LUIS, [cena, luisPaga]), e("20"));
  const dev = tx("DEVOLUCION", "40", { refundOf: "cena" }); assert.equal(C.balanceBetween(ANA, LUIS, [cena, luisPaga, dev]), 0);
  const liq = tx("LIQUIDACION", "20", { owner: LUIS, account: "luis-cc", to: "cc", counterpart: ANA });
  assert.equal(C.balanceBetween(ANA, LUIS, [cena, luisPaga, dev, liq]), e("-20"));
});
test("saldos: traspasos, previstos, devoluciones y ajustes", () => {
  const t = tx("TRASPASO", "300", { to: "sav" }); const b = C.balances(accounts, [t]); assert.equal(b.cc, e("1200")); assert.equal(b.sav, e("2300"));
  const futuro = planned("50", 20), vencido = planned("30", 5);
  assert.equal(C.effectiveStatus(futuro, NOW), "PREVISTO"); assert.equal(C.effectiveStatus(vencido, NOW), "PENDIENTE");
  assert.equal(C.balances(accounts, [futuro, vencido]).cc, e("1500"));
  const compra = tx("GASTO", "80", { category: "ropa", id: "c1" }), dev = tx("DEVOLUCION", "30", { refundOf: "c1" }), byId = { c1: compra, [dev.id]: dev };
  assert.equal(C.categoryOf(dev, byId), "ropa"); assert.equal(C.spendingShare(dev, ANA, byId), e("-30"));
  assert.equal(C.balances(accounts, [tx("AJUSTE", "-12,34")]).cc, e("1487,66"));
  const s = tx("GASTO", "90", { split: half(ANA) }); assert.equal(C.spendingShare(s, LUIS, {}), e("45")); assert.equal(C.householdSpending(s), e("90"));
});
test("recurrentes: día 31, cuotas e idempotencia", () => {
  const r = { id: "r", template: tx("GASTO", "10"), frequency: "MENSUAL", interval: 1, start: "2026-01-31" };
  assert.deepEqual(C.recurrenceDates(r, "2026-01-01", "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  const cuota = { id: "movil", template: tx("GASTO", "25", { debtId: "d" }), frequency: "MENSUAL", interval: 1, start: "2026-09-05", count: 12 };
  const all = C.materialize(cuota, "2026-01-01", "2028-01-01", new Set()); assert.equal(all.length, 12); assert.equal(C.dateOf(all.at(-1).dateTime), "2027-08-05");
  const paid = all.filter((t) => C.dateOf(t.dateTime) < TODAY).map((t) => C.confirmTx(t)); assert.equal(C.debtRemaining("d", e("300"), paid), e("225"));
  const luz = { id: "luz", template: tx("GASTO", "60"), frequency: "MENSUAL", interval: 1, start: "2026-11-15" };
  const first = C.materialize(luz, TODAY, "2027-01-10", new Set()); assert.equal(first.length, 2);
  assert.equal(C.materialize(luz, TODAY, "2027-01-10", new Set(first.map((t) => t.id))).length, 0);
});
test("presupuesto: reservas antes de disponible", () => {
  const r = run([planned("60", 15), planned("30", 28), planned("700", 1, { month: 12 })]);
  assert.equal(r.totalBalance, e("3600")); assert.equal(r.liquidBalance, e("1600")); assert.equal(r.reserved.obligations, e("90"));
  assert.equal(r.available, e("1210")); assert.equal(r.horizon.days, 18); assert.equal(r.dailyRate, e("67,22")); assert.equal(r.thisWeek, e("403,32"));
  const m = run([planned("60", 15), planned("30", 28), planned("700", 1, { month: 12 })], { kind: "FIN_DE_MES" }); assert.equal(m.horizon.days, 21); assert.equal(m.dailyRate, e("57,61"));
});
test("presupuesto: confirmar no duplica; ingresos futuros no cuentan", () => {
  const luz = planned("60", 5), before = run([luz]); assert.ok(before.warnings.some((w) => w.code === "PENDIENTES_VENCIDOS"));
  const after = run([C.confirmTx(luz, luz.amount, "2026-11-10T11:00")]); assert.equal(before.available, after.available); assert.equal(after.spentToday, 0);
  const nomina = planned("1400", 28, { kind: "INGRESO", estimated: true }), extra = planned("300", 20, { kind: "INGRESO" });
  assert.equal(run([nomina, extra]).available, run([]).available); assert.equal(run([nomina, extra]).expectedIncome, e("300"));
  const month = run([nomina, extra], { kind: "FIN_DE_MES" }); assert.equal(month.expectedIncome, e("1700")); assert.ok(month.expectedIncomeIsEstimate);
});
test("presupuesto: cambio de cobro, provisional y déficit", () => {
  const at25 = run([planned("50", 26)], { settings: { ...S28, nextPayday: "2026-11-25" } }); assert.equal(at25.horizon.days, 15); assert.equal(at25.available, run([planned("50", 26)]).available + e("50"));
  assert.ok(run([], { settings: { ...S28, nextPayday: null } }).horizon.provisional);
  assert.ok(run([], { settings: { ...S28, nextPayday: "2026-11-08" } }).warnings.some((w) => w.code === "FECHA_COBRO_PASADA"));
  const d = run([planned("1450", 20)]); assert.equal(d.available, e("-150")); assert.equal(d.deficit, e("150")); assert.equal(d.today, 0);
  assert.ok(run([tx("GASTO", "100")]).today < 0);
});
test("presupuesto: ahorro, devolución, gasto compartido, objetivos", () => {
  const s = { monthlySavings: e("100"), nextPayday: "2026-11-28" };
  assert.equal(run([], { settings: s }).available, run([tx("TRASPASO", "100", { date: day(3), to: "sav" })], { settings: s }).available);
  assert.equal(run([tx("TRASPASO", "100", { date: day(20), to: "sav", status: "PREVISTO" })], { settings: s }).reserved.savings, e("100"));
  const lim = [{ categoryId: "ropa", monthlyLimit: e("100") }], cats = [{ id: "ropa", name: "Ropa" }];
  const compra = tx("GASTO", "80", { category: "ropa", id: "zara" }), dev = tx("DEVOLUCION", "30", { refundOf: "zara" });
  const b = run([compra, dev], { limits: lim, categories: cats }); assert.equal(b.available, run([compra], { limits: lim, categories: cats }).available + e("30")); assert.equal(b.categories[0].spent, e("50"));
  const cats2 = [{ id: "comida", name: "Comida" }, { id: "super", name: "Super", parentId: "comida" }];
  const r = run([tx("GASTO", "90", { category: "super", split: half(ANA), date: day(4) }), tx("GASTO", "40", { category: "super", split: half(LUIS), owner: LUIS, account: "luis-cc", date: day(6) }), planned("50", 20, { category: "comida" })],
    { limits: [{ categoryId: "comida", monthlyLimit: e("300") }], categories: cats2 });
  const c = r.categories[0]; assert.equal(c.spent, e("65")); assert.equal(c.committed, e("50")); assert.equal(c.remaining, e("185")); assert.equal(c.perDay, e("8,80")); assert.equal(c.state, "BIEN");
  const g = run([], { goals: [{ id: "vac", ownerId: ANA, target: e("1000"), monthlyContribution: e("150"), heldInLiquidAccount: true }, { id: "tv", ownerId: ANA, target: e("200"), monthlyContribution: e("50"), heldInLiquidAccount: false }],
    contributions: [{ goalId: "vac", amount: e("300"), date: "2026-10-03" }, { goalId: "vac", amount: e("50"), date: "2026-11-02" }, { goalId: "tv", amount: e("180"), date: "2026-10-01" }] });
  assert.equal(g.reserved.goals, e("470"));
  assert.equal(run([], { owed: e("25") }).reserved.settlementDebt, e("25"));
});
test("duplicados e intérprete de frases", () => {
  const a = tx("GASTO", "23", { concept: "Mercadona" }), b = tx("GASTO", "23", { concept: "mercadona ", date: "2026-11-10T14:00" }), c = tx("GASTO", "23", { concept: "Gasolina" });
  assert.deepEqual(C.duplicateSuspects(b, [a, c]).map((t) => t.id), [a.id]);
  const r = C.parseEntry("Ayer gasté 23 euros en el supermercado y 8 en cenar; los 23 los pagué con tarjeta y los 8 en efectivo", NOW);
  assert.equal(r.drafts.length, 2); const [x, y] = r.drafts;
  assert.deepEqual([x.amount, x.concept, x.categoryKey, x.payment, x.dateTime.slice(0, 10)], [2300, "Supermercado", "comida", "TARJETA", "2026-11-09"]);
  assert.deepEqual([y.amount, y.concept, y.categoryKey, y.payment], [800, "Cenar", "ocio", "EFECTIVO"]);
  const g = C.parseEntry("15,50 en gasolina", NOW).drafts[0]; assert.equal(g.dateTime, NOW); assert.equal(g.categoryKey, "transporte"); assert.deepEqual(g.missing, ["CUENTA"]);
  const i = C.parseEntry("El viernes cobré 250 euros de un trabajo extra a las 18:30 por transferencia", NOW).drafts[0];
  assert.deepEqual([i.kind, i.amount, i.dateTime, i.payment], ["INGRESO", 25000, "2026-11-06T18:30", "TRANSFERENCIA"]);
  const t = C.parseEntry("he gastado 12 en el bar y 30 en la farmacia, todo con tarjeta", NOW).drafts; assert.ok(t.every((d) => d.payment === "TARJETA")); assert.equal(t[1].categoryKey, "salud");
});
