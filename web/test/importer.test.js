// Pruebas del lector de extractos con datos inventados (formato de texto como el de CaixaBank).
import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../importer.js";

const TEXT = `1/2
Titular: Persona de Prueba IBAN:
ES0000000000000000000000
Periodo: 01/10/2026-31/10/2026 Saldo disponible: 167.54
Concepto Fecha Importe Saldo
SumUp *BAR PEPE 31/10/2026 -8.0 167,54€
DIGI SPAIN TEL 30/10/2026 49.0 175,54€
DIGI SPAIN TEL 30/10/2026 -49.0 126, 54€
BIZUM RECIBIDO 29/10/2026 500.0 175,54€
MERCADONA ALOVERA 28/10/2026 -45.2 -324,46€
REINT.CAJERO 27/10/2026 -50.0 -279,26€
TRASPASO PROPIO 26/10/2026 84.0 -229,26€
GASEXPRESS TORRE} 25/10/2026 -15.0 -313,26€`;

const db = () => ({
  accounts: [{ id: "cc", ownerId: "yo", name: "CC", type: "CORRIENTE", opening: 0, liquid: true }, { id: "cash", ownerId: "yo", name: "Efectivo", type: "EFECTIVO", opening: 0, liquid: true }],
  categories: [{ id: "comida", name: "Comida" }, { id: "comida-super", name: "Super", parentId: "comida" }, { id: "ocio", name: "Ocio" }, { id: "ocio-rest", name: "Rest", parentId: "ocio" }, { id: "transporte", name: "Transporte" }, { id: "hogar", name: "Hogar" }, { id: "suscripciones", name: "Susc" }, { id: "otros", name: "Otros" }, { id: "ing-nomina", name: "Nómina", income: true }, { id: "ing-extra", name: "Extra", income: true }],
  transactions: [
    { id: "manual-dentro", ownerId: "yo", kind: "GASTO", amount: 1000, dateTime: "2026-10-15T10:00", status: "REALIZADO", accountId: "cc" },
    { id: "manual-fuera", ownerId: "yo", kind: "GASTO", amount: 1000, dateTime: "2026-09-30T10:00", status: "REALIZADO", accountId: "cc" },
    { id: "efectivo-dentro", ownerId: "yo", kind: "GASTO", amount: 500, dateTime: "2026-10-15T10:00", status: "REALIZADO", accountId: "cash" },
  ],
});

test("lee periodo, saldo, filas e importes con formato del banco", () => {
  const st = I.parseStatementText(TEXT);
  assert.deepEqual(st.period, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(st.balance, 16754);
  assert.equal(st.rows.length, 8);
  assert.equal(st.rows[0].amount, -800); assert.equal(st.rows[1].amount, 4900); assert.equal(st.rows[2].saldo, 12654);
  assert.equal(I.bankAmount("-1.234,56"), -123456); assert.equal(I.bankAmount("189, 54€"), 18954); assert.equal(I.bankAmount("-21.78"), -2178);
});
test("clasifica comercios y trata devoluciones, efectivo y traspasos", () => {
  assert.equal(I.classify("MERCADONA ALOVERA", -4520), "comida-super");
  assert.equal(I.classify("DIGI SPAIN TEL", 4900), "cat-telefonia"); // devolución del operador
  assert.equal(I.classify("BIZUM RECIBIDO", 50000), "ing-bizum");
  assert.equal(I.classify("BIZUM ENVIADO", -600), "cat-bizum");
  assert.equal(I.classify("GASEXPRESS TORRE}", -1500), "transporte");
  const p = I.plan(db(), I.parseStatementText(TEXT), "cc", "yo", "2026-11-01T09:00");
  const kinds = Object.fromEntries(p.add.map((t) => [t.concept, t.kind]));
  assert.equal(kinds["Reint.cajero"], "GASTO");
  assert.equal(kinds["Traspaso Propio"], "AJUSTE");
  assert.equal(p.add.find((t) => t.kind === "DEVOLUCION").categoryId, "cat-telefonia");
});
test("sustituye lo anotado a mano en esa cuenta dentro del periodo y nada más", () => {
  const p = I.plan(db(), I.parseStatementText(TEXT), "cc", "yo", "2026-11-01T09:00");
  assert.deepEqual(p.remove.map((t) => t.id), ["manual-dentro"]);
  assert.equal(p.add.length, 8);
  assert.ok(p.newCats.some((c) => c.id === "cat-telefonia"));
});
test("el saldo de la cuenta cuadra con el extracto tras importar", () => {
  const d = db(), p = I.plan(d, I.parseStatementText(TEXT), "cc", "yo", "2026-11-01T09:00");
  const keep = d.transactions.filter((t) => !p.remove.includes(t));
  let bal = p.opening; for (const t of [...keep, ...p.add]) { if (t.accountId === "cc") bal += t.kind === "GASTO" || t.kind === "TRASPASO" ? -t.amount : t.amount; }
  assert.equal(bal, 16754);
});
test("hojas de cálculo: detecta columnas", () => {
  const st = I.parseStatementRows([["Banco"], ["Fecha", "Concepto", "Importe", "Saldo"], ["02/10/2026", "Mercadona", "-12,50", "100,00"], ["01/10/2026", "Nómina", "1.200,00", "112,50"]]);
  assert.equal(st.rows.length, 2); assert.equal(st.rows[1].amount, 120000);
});

// ——— Dos cuentas: nómina (ahorro) y gasto ———
const two = () => ({
  accounts: [{ id: "gasto", ownerId: "yo", name: "Gasto", type: "CORRIENTE", opening: 0, liquid: true, iban: "ES11 2222 3333 4444 5555 6666" },
    { id: "nom", ownerId: "yo", name: "Nómina", type: "CORRIENTE", opening: 0, liquid: false }],
  categories: [{ id: "otros", name: "Otros" }, { id: "ing-nomina", name: "Nómina", income: true }, { id: "ing-extra", name: "Extra", income: true }],
  transactions: [],
});
const stmt = (lines) => I.parseStatementText(`Periodo: 01/10/2026-31/10/2026 Saldo disponible: 0\n${lines}`);

test("reconoce la cuenta por el IBAN", () => {
  assert.equal(I.accountForIban(two().accounts, "ES1122223333444455556666").id, "gasto");
  assert.equal(I.accountForIban(two().accounts, "ES0000000000000000000000"), null);
});
test("un traspaso dicho a mano se confirma con el extracto y no se duplica", () => {
  const d = two();
  d.transactions.push({ id: "dicho", ownerId: "yo", kind: "TRASPASO", amount: 90000, dateTime: "2026-10-26T12:00", status: "REALIZADO", accountId: "nom", toAccountId: "gasto", concept: "Paso a gasto" });
  const p = I.plan(d, stmt("TRANSFERENCIA A SU FAVOR 27/10/2026 900.0 900,00€\nMERCADONA 28/10/2026 -20.0 880,00€"), "gasto", "yo", "2026-11-01T09:00");
  assert.equal(p.confirmed, 1);
  assert.equal(p.remove.length, 0);
  const t = p.add.find((x) => x.id === "dicho");
  assert.equal(t.kind, "TRASPASO"); assert.equal(t.dateTime, "2026-10-27T12:00"); assert.ok(t.bank.gasto);
  assert.equal(p.add.filter((x) => x.kind === "INGRESO" || x.kind === "AJUSTE").length, 0);
});
test("las dos mitades de un traspaso de dos extractos se unen en uno", () => {
  const d = two();
  const p1 = I.plan(d, stmt("NOMINA EMPRESA 25/10/2026 1400.0 1400,00€\nTRASPASO A CUENTA PROPIA 26/10/2026 -900.0 500,00€"), "nom", "yo", "2026-11-01T09:00");
  d.transactions.push(...p1.add);
  assert.equal(p1.paired, 0);
  const p2 = I.plan(d, stmt("TRASPASO PROPIO 26/10/2026 900.0 900,00€"), "gasto", "yo", "2026-11-01T09:00");
  assert.equal(p2.paired, 1);
  const t = p2.add.find((x) => x.kind === "TRASPASO");
  assert.deepEqual([t.accountId, t.toAccountId, t.amount], ["nom", "gasto", 90000]);
  assert.ok(p2.remove.some((x) => x.accountId === "nom" && x.amount === -90000));
  // reimportar la cuenta de nómina conserva el traspaso
  const removeIds = new Set(p2.remove.map((x) => x.id));
  d.transactions = d.transactions.filter((x) => !removeIds.has(x.id)).concat(p2.add);
  const p3 = I.plan(d, stmt("NOMINA EMPRESA 25/10/2026 1400.0 1400,00€\nTRASPASO A CUENTA PROPIA 26/10/2026 -900.0 500,00€"), "nom", "yo", "2026-11-01T09:00");
  assert.equal(p3.confirmed, 1);
  assert.equal(p3.add.filter((x) => x.kind === "TRASPASO").length, 1);
  assert.equal(p3.add.length, 2);
});
test("un traspaso apuntado que el banco no muestra se quita", () => {
  const d = two();
  d.transactions.push({ id: "dicho", ownerId: "yo", kind: "TRASPASO", amount: 50000, dateTime: "2026-10-10T12:00", status: "REALIZADO", accountId: "nom", toAccountId: "gasto", concept: "x" });
  const p = I.plan(d, stmt("MERCADONA 28/10/2026 -20.0 -20,00€"), "gasto", "yo", "2026-11-01T09:00");
  assert.equal(p.remove[0].id, "dicho"); assert.equal(p.warnings.length, 1);
});
