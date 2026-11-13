import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCalendar } from "../src/parser.js";
import { buildReport } from "../src/report.js";

const EN = readFileSync(new URL("./fixtures/inglese-2026-11-12.html", import.meta.url), "utf8");
const NOW = new Date("2026-11-13T12:00:00Z");
const live = {
  inglese: { label: "Prova em inglês", ...parseCalendar(EN) },
  italiano: { label: "Prova em italiano", ok: true, rows: [] },
};
const healthy = { checks: 1360, lastOk: "2026-11-13T11:59:30Z", failing: {} };

test("tudo certo → ✅ com contagem, sessões e 17/12", () => {
  const r = buildReport({ state: healthy, outbox: [], now: NOW, last: { at: "2026-11-13T03:00:00Z", checks: 820 }, live });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.match(r.msg.title, /✅ Conferência OK/);
  for (const s of ["13/11/2026, 09:00 (Brasília)", "540 de ~540", "há 1 min", "6 sessões CENT@CASA, nenhuma com vaga", "17/12 Sapienza", "nenhuma data CENT@CASA publicada", "Fila de reenvio (ntfy/e-mail): vazia", "teste de notificação"]) {
    assert.ok(r.msg.message.includes(s), `faltou "${s}" em:\n${r.msg.message}`);
  }
});

test("monitor parado (poucas checagens e leitura antiga) → ⚠️ prioridade máxima", () => {
  const r = buildReport({ state: { checks: 900, lastOk: "2026-11-13T10:00:00Z", failing: {} }, outbox: [], now: NOW, last: { at: "2026-11-13T03:00:00Z", checks: 820 }, live });
  assert.equal(r.ok, false);
  assert.equal(r.msg.priority, 5);
  assert.ok(r.problems.some((p) => p.includes("poucas checagens")));
  assert.ok(r.problems.some((p) => p.includes("sem leitura do CISIA")));
});

test("CISIA ilegível agora ou fila de e-mail parada → ⚠️", () => {
  const bad = { ...live, inglese: { label: "Prova em inglês", ok: false, error: "HTTP 503" } };
  assert.equal(buildReport({ state: healthy, outbox: [], now: NOW, last: null, live: bad }).ok, false);
  const stuck = [{ at: "2026-11-13T10:00:00Z" }];
  const r = buildReport({ state: healthy, outbox: stuck, now: NOW, last: null, live });
  assert.equal(r.ok, false);
  assert.ok(r.problems[0].includes("fila de reenvio parada"));
});
