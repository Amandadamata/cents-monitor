// Vigia de reserva (GitHub Actions, a cada ~10 min).
// 1. Pergunta ao Worker da Cloudflare se ele checou o CISIA com sucesso recentemente.
// 2. Se não: avisa (alerta técnico, uma vez) e passa a checar o CISIA ele mesmo,
//    com a mesma lógica e o mesmo formato de alerta.
// Estado em state/backup-state.json (o workflow faz commit quando muda).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { runCheck, emptyState } from "../src/core.js";
import { sendNotification } from "../src/notify.js";

const STATE_FILE = new URL("../state/backup-state.json", import.meta.url);
const STALE_MS = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (compatible; CEnT-seat-monitor/1.0; personal use, backup check)";

const clean = (v) => (v ? v.replace(/\s+/g, "") : undefined);
const cfg = {
  ntfyTopic: process.env.NTFY_TOPIC,
  ntfyToken: clean(process.env.NTFY_TOKEN),
  alertEmail: process.env.ALERT_EMAIL,
  telegramToken: clean(process.env.TELEGRAM_BOT_TOKEN),
  telegramChatId: clean(process.env.TELEGRAM_CHAT_ID),
};
if (!cfg.ntfyTopic) throw new Error("NTFY_TOPIC não configurado");
const notify = (m) => sendNotification(cfg, m);

const saved = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const st = { core: saved.core || emptyState(), workerDown: saved.workerDown || null };
const before = JSON.stringify(st);
const now = new Date();

async function workerStatus() {
  try {
    const res = await fetch(`${process.env.WORKER_URL}/status`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { healthy: false, why: `status HTTP ${res.status}` };
    const s = await res.json();
    const age = s.lastOk ? now - new Date(s.lastOk) : Infinity;
    if (age > STALE_MS) return { healthy: false, why: `última leitura bem-sucedida do CISIA: ${s.lastOk || "nunca"}; falhas: ${JSON.stringify(s.failing)}` };
    return { healthy: true, s };
  } catch (e) {
    return { healthy: false, why: `Worker inacessível: ${e.message}` };
  }
}

if (process.env.SEND_TEST === "true") {
  const r = await notify({
    title: "🧪 TESTE — vigia de reserva (GitHub)",
    message: `Teste enviado pelo GitHub Actions (${now.toISOString()}). Se chegou, o monitor de reserva também consegue te avisar.`,
    priority: 4,
    tags: ["test_tube"],
    email: true,
  });
  console.log("teste de notificação:", JSON.stringify(r));
}

const w = await workerStatus();
console.log(`[${now.toISOString()}] worker healthy=${w.healthy} ${w.why || `lastOk=${w.s.lastOk} checks=${w.s.checks}`}`);

if (w.healthy) {
  if (st.workerDown?.alerted) {
    await notify({ title: "✅ Monitor principal (Cloudflare) voltou", message: `Voltou a checar a cada minuto (${now.toISOString()}). O GitHub volta a ser só reserva.`, priority: 2, tags: ["white_check_mark"] });
  }
  st.workerDown = null;
} else {
  if (!st.workerDown) st.workerDown = { since: now.toISOString(), alerted: false };
  st.workerDown.why = w.why;
  if (!st.workerDown.alerted) {
    const r = await notify({
      title: "⚠️ Monitor CEnT: Cloudflare parou — GitHub assumiu",
      message: `O monitor principal não está lendo o CISIA.\nMotivo: ${w.why}\nO GitHub está checando no lugar dele (a cada ~10 min, pode atrasar). Status: ${process.env.WORKER_URL}/status`,
      priority: 4,
      tags: ["warning"],
      email: true,
    });
    console.log("alerta técnico:", JSON.stringify(r));
    st.workerDown.alerted = r.delivered === true;
  }
  const fetchPage = async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    return { status: res.status, text: await res.text() };
  };
  const out = await runCheck({ state: st.core, now, fetchPage, notify, source: "github" });
  st.core = out.state;
  console.log("checagem de reserva:", JSON.stringify(out.state.snapshot), "notificações:", out.notifications.length, JSON.stringify(out.delivery));
}

if (JSON.stringify(st) !== before) {
  writeFileSync(STATE_FILE, JSON.stringify(st, null, 2) + "\n");
  console.log("estado alterado → será salvo");
}
