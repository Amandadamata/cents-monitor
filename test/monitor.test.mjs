import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCalendar, isBookable, isHome, deadlineOf, fmt } from "../src/parser.js";
import { runCheck, emptyState, URGENT_TITLE, FAIL_ALERT_AFTER_MS } from "../src/core.js";

const EN = readFileSync(new URL("./fixtures/inglese-2026-11-12.html", import.meta.url), "utf8");
const IT_EMPTY = readFileSync(new URL("./fixtures/italiano-vuoto-2026-11-12.html", import.meta.url), "utf8");

// Reabre a CENT@CASA da Sapienza em 17/12 (troca "---"/ESAURITI por 7/DISPONIBILI só nessa linha).
function reopenSapienza17(html, posti = "7") {
  return html.replace(
    /(<td>CENT@CASA<\/td><td>Sapienza Università di Roma<\/td><td>LAZIO<\/td><td>ROMA<\/td><td>11\/12\/2026<\/td><td class="center">)---(<\/td><td class="center">)<span[^>]*>POSTI ESAURITI<\/span>/,
    `$1${posti}$2<a href="https://testcisia.it/studenti_tolc/login_sso.php"><span>POSTI DISPONIBILI</span></a>`,
  );
}

function pages(en, it = IT_EMPTY) {
  return async (url) => ({ status: 200, text: url.includes("inglese") ? en : it });
}

function collector() {
  const sent = [];
  return { sent, notify: async (m) => (sent.push(m), { push: 200 }) };
}

const NOW = new Date("2026-11-12T18:00:00Z");

test("lê a página real de 12/11: 10 linhas, 6 CENT@CASA, nenhuma reservável", () => {
  const p = parseCalendar(EN);
  assert.equal(p.ok, true);
  assert.equal(p.rows.length, 10);
  const home = p.rows.filter(isHome);
  assert.equal(home.length, 6);
  assert.equal(home.filter(isBookable).length, 0);
  const s17 = home.find((r) => r.dataTest === "17/12/2026");
  assert.equal(s17.universita, "Sapienza Università di Roma");
  assert.equal(s17.stato, "POSTI ESAURITI");
});

test("CENT@UNI com vagas nunca é considerado", () => {
  const uni = parseCalendar(EN).rows.filter((r) => !isHome(r) && isBookable(r));
  assert.ok(uni.length >= 2); // Trieste e Messina têm vagas, mas são presenciais
});

test("calendário italiano vazio é válido (zero linhas, sem erro)", () => {
  assert.deepEqual(parseCalendar(IT_EMPTY), { ok: true, rows: [] });
});

test("prazo: 11/12/2026 14:00 Itália = 10:00 Brasília", () => {
  const dl = deadlineOf({ fineIscrizioni: "11/12/2026" });
  assert.equal(fmt(dl, "Europe/Rome"), "11/12/2026, 14:00");
  assert.equal(fmt(dl, "America/Sao_Paulo"), "11/12/2026, 10:00");
});

test("estado atual (tudo esgotado) não gera alerta", async () => {
  const c = collector();
  const r = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(EN), notify: c.notify });
  assert.equal(c.sent.length, 0);
  assert.equal(r.state.snapshot.inglese.length, 6);
});

test("17/12 Sapienza reabre → 1 alerta urgente com tudo que foi pedido; sem repetição", async () => {
  const c = collector();
  let { state } = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(EN), notify: c.notify });
  const opened = reopenSapienza17(EN);
  assert.notEqual(opened, EN);

  ({ state } = await runCheck({ state, now: new Date(+NOW + 60e3), fetchPage: pages(opened), notify: c.notify }));
  assert.equal(c.sent.length, 1);
  const m = c.sent[0];
  assert.equal(m.title, URGENT_TITLE);
  assert.equal(m.priority, 5);
  assert.equal(m.email, true);
  for (const s of ["17/12/2026", "Sapienza Università di Roma", "Vagas: 7", "11/12/2026, 14:00 (Itália)", "11/12/2026, 10:00 (Brasília)", "Detectado em", "login_sso.php", "INGLÊS"]) {
    assert.ok(m.message.includes(s), `faltou "${s}" em:\n${m.message}`);
  }

  // Mesma disponibilidade no minuto seguinte: nada novo.
  ({ state } = await runCheck({ state, now: new Date(+NOW + 120e3), fetchPage: pages(opened), notify: c.notify }));
  assert.equal(c.sent.length, 1);

  // Esgota de novo e reabre: novo alerta.
  ({ state } = await runCheck({ state, now: new Date(+NOW + 180e3), fetchPage: pages(EN), notify: c.notify }));
  ({ state } = await runCheck({ state, now: new Date(+NOW + 240e3), fetchPage: pages(reopenSapienza17(EN, "2")), notify: c.notify }));
  assert.equal(c.sent.length, 2);
  assert.ok(c.sent[1].message.includes("Vagas: 2"));
});

test("se o envio do alerta falhar, tenta de novo na próxima rodada", async () => {
  let fail = true;
  const sent = [];
  const notify = async (m) => (sent.push(m), fail ? { push: 500 } : { push: 200 });
  let { state } = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(reopenSapienza17(EN)), notify });
  assert.equal(sent.length, 1);
  fail = false;
  ({ state } = await runCheck({ state, now: new Date(+NOW + 60e3), fetchPage: pages(reopenSapienza17(EN)), notify }));
  assert.equal(sent.length, 2);
  ({ state } = await runCheck({ state, now: new Date(+NOW + 120e3), fetchPage: pages(reopenSapienza17(EN)), notify }));
  assert.equal(sent.length, 2);
});

test("nova sessão CENT@CASA já com vagas (ex.: janeiro) → alerta", async () => {
  const c = collector();
  const row = `<tr><td>CENT@CASA</td><td>Politecnico di Milano</td><td>LOMBARDIA</td><td>MILANO</td><td>08/01/2027</td><td class="center">120</td><td class="center"><span>POSTI DISPONIBILI</span></td><td>14/01/2027</td></tr>`;
  const withJan = EN.replace("</tr>							<tbody>", "</tr>" + row + "							<tbody>");
  let { state } = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(EN), notify: c.notify });
  ({ state } = await runCheck({ state, now: new Date(+NOW + 60e3), fetchPage: pages(withJan), notify: c.notify }));
  assert.equal(c.sent.length, 1);
  assert.ok(c.sent[0].message.includes("14/01/2027"));
});

test("nova sessão CENT@CASA esgotada → sem alerta", async () => {
  const c = collector();
  const row = `<tr><td>CENT@CASA</td><td>Politecnico di Milano</td><td>LOMBARDIA</td><td>MILANO</td><td>08/01/2027</td><td class="center">---</td><td class="center"><span>POSTI ESAURITI</span></td><td>14/01/2027</td></tr>`;
  const withJan = EN.replace("</tr>							<tbody>", "</tr>" + row + "							<tbody>");
  let { state } = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(EN), notify: c.notify });
  await runCheck({ state, now: new Date(+NOW + 60e3), fetchPage: pages(withJan), notify: c.notify });
  assert.equal(c.sent.length, 0);
});

test("status desconhecido numa CENT@CASA → aviso de atenção (uma vez)", async () => {
  const c = collector();
  const odd = EN.replace(
    /(<td>CENT@CASA<\/td><td>Sapienza Università di Roma<\/td><td>LAZIO<\/td><td>ROMA<\/td><td>11\/12\/2026<\/td><td class="center">---<\/td><td class="center">)<span[^>]*>POSTI ESAURITI<\/span>/,
    "$1<span>ISCRIZIONI DAL 20/11</span>",
  );
  assert.notEqual(odd, EN);
  let { state } = await runCheck({ state: emptyState(), now: NOW, fetchPage: pages(odd), notify: c.notify });
  await runCheck({ state, now: new Date(+NOW + 60e3), fetchPage: pages(odd), notify: c.notify });
  assert.equal(c.sent.length, 1);
  assert.match(c.sent[0].title, /status novo/);
});

test("site fora do ar: alerta técnico só após 10 min, uma vez, e aviso de volta", async () => {
  const c = collector();
  const down = async () => ({ status: 503, text: "" });
  let state = emptyState();
  for (let i = 0; i <= 12; i++) {
    ({ state } = await runCheck({ state, now: new Date(+NOW + i * 60e3), fetchPage: down, notify: c.notify }));
  }
  assert.equal(c.sent.length, 2); // um por calendário (inglês e italiano)
  assert.match(c.sent[0].title, /não consigo ler/);
  ({ state } = await runCheck({ state, now: new Date(+NOW + FAIL_ALERT_AFTER_MS + 5 * 60e3), fetchPage: pages(EN), notify: c.notify }));
  assert.equal(c.sent.length, 4);
  assert.match(c.sent[2].title, /voltou/);
});

test("página com formato novo é falha (nunca 'zero vagas' silencioso)", () => {
  const p = parseCalendar(EN.replace("<th>POSTI</th>", "<th>SEATS</th>"));
  assert.equal(p.ok, false);
  assert.equal(parseCalendar("<html>" + "x".repeat(600) + "</html>").ok, false);
});
