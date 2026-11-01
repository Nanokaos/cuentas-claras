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
  assert.equal(kinds["Reint.cajero"], "TRASPASO");
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
