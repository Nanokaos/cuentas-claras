// Pruebas de la frase diaria con datos inventados.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../daily.js";

const db = () => ({
  accounts: [{ id: "g", ownerId: "yo", name: "Gasto", type: "CORRIENTE", opening: 50000, liquid: true }, { id: "n", ownerId: "yo", name: "Nómina", type: "CORRIENTE", opening: 120000, liquid: false }],
  categories: [{ id: "ocio", name: "Ocio", limit: 5000 }, { id: "otros", name: "Otros" }, { id: "cat-bizum", name: "Bizums enviados" }],
  transactions: [
    { id: "a", ownerId: "yo", kind: "GASTO", amount: 8000, dateTime: "2026-11-09T21:00", status: "REALIZADO", accountId: "g", categoryId: "ocio", concept: "Cena" },
    { id: "b", ownerId: "yo", kind: "GASTO", amount: 600, dateTime: "2026-11-05T10:00", status: "REALIZADO", accountId: "g", categoryId: "cat-bizum", concept: "Bizum enviado" },
  ],
  settings: { nextPayday: "2026-11-25", buffer: 0, monthlySavings: 0, sarcasm: 2 }, goals: [], contributions: [],
});

test("calcula los datos del día sin inventar nada", () => {
  const f = D.facts(db(), "2026-11-10T09:00");
  assert.equal(f.yesterday, 8000); assert.equal(f.yBig.concept, "Cena");
  assert.equal(f.over[0].name, "Ocio"); assert.equal(f.over[0].by, 3000);
  assert.equal(f.savings, 120000); assert.equal(f.bizums, 1);
  assert.equal(f.dow, 1);
});
test("cada día una frase distinta y sin repetir las recientes", () => {
  const f = D.facts(db(), "2026-11-10T09:00"), seen = [];
  for (let i = 0; i < 4; i++) { const p = D.pickTemplate(f, 2, seen.slice(-6), 100 + i); assert.ok(!seen.includes(p.id), p.id); seen.push(p.id); assert.ok(p.text.length > 10); }
  for (let lv = 0; lv <= 4; lv++) assert.match(D.pickTemplate(f, lv, [], 1).text, /€/);
});
