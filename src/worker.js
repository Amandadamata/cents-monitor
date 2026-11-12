// Cloudflare Worker: checa o calendário CISIA a cada minuto (cron "* * * * *").
// KV "STATE": guarda o estado (dedup de alertas, falhas, registro de eventos).
// Para economizar escritas no KV (limite grátis: 1000/dia), grava só quando algo
// muda ou a cada 5 minutos como sinal de vida.

import { runCheck, emptyState } from "./core.js";
import { sendNotification } from "./notify.js";

const UA = "Mozilla/5.0 (compatible; CEnT-seat-monitor/1.0; personal use, 1 req/min)";
const HEARTBEAT_MS = 5 * 60 * 1000;

// Tokens colados no terminal às vezes vêm com espaço ou quebra de linha.
const clean = (v) => (v ? String(v).replace(/\s+/g, "") : v);

function cfg(env) {
  return {
    ntfyTopic: env.NTFY_TOPIC,
    ntfyToken: clean(env.NTFY_TOKEN),
    alertEmail: env.ALERT_EMAIL,
    telegramToken: clean(env.TELEGRAM_BOT_TOKEN),
    telegramChatId: clean(env.TELEGRAM_CHAT_ID),
  };
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, cf: { cacheTtl: 0 } });
  return { status: res.status, text: await res.text() };
}

function meaningful(s) {
  // Tudo menos contadores/horários: se isso mudou, vale gravar já.
  const { checks, lastCheck, lastOk, lastSource, lastSaved, ...rest } = s;
  return JSON.stringify(rest);
}

async function check(env) {
  const prev = (await env.STATE.get("state", "json")) || emptyState();
  const now = new Date();
  const { state, notifications } = await runCheck({
    state: prev,
    now,
    fetchPage,
    notify: (m) => sendNotification(cfg(env), m),
    source: "cloudflare",
  });
  const due = !prev.lastSaved || now - new Date(prev.lastSaved) >= HEARTBEAT_MS;
  if (notifications.length || due || meaningful(prev) !== meaningful(state)) {
    state.lastSaved = now.toISOString();
    await env.STATE.put("state", JSON.stringify(state));
  }
  return state;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Status público (sem segredos): última checagem, sessões CENT@CASA vistas e registro.
    if (url.pathname === "/" || url.pathname === "/status") {
      const s = (await env.STATE.get("state", "json")) || emptyState();
      const ageMin = s.lastSaved ? Math.round((Date.now() - new Date(s.lastSaved)) / 60000) : null;
      return json({
        monitor: "CEnT@CASA seat monitor",
        healthy: ageMin !== null && ageMin <= 12 && Object.keys(s.failing).length === 0,
        minutesSinceLastSave: ageMin,
        lastCheck: s.lastCheck,
        lastOk: s.lastOk,
        checks: s.checks,
        failing: s.failing,
        homeSessions: s.snapshot,
        events: s.events,
      });
    }

    // Rotas administrativas protegidas por ADMIN_KEY.
    if (request.headers.get("x-admin-key") !== env.ADMIN_KEY || !env.ADMIN_KEY) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/test-alert") {
      const r = await sendNotification(cfg(env), {
        title: "🧪 TESTE — Monitor CEnT@CASA",
        message: `Teste de notificação (${new Date().toISOString()}).\nSe você está lendo isto no iPhone, no Mac e no e-mail, os alertas estão funcionando.\nUm alerta real terá o título: 🚨 URGENTE! ABRIU VAGA CEnT@CASA — RESERVE AGORA!`,
        priority: 5,
        tags: ["test_tube"],
        click: "https://testcisia.it/calendario.php?tolc=cents&lingua=inglese",
        email: url.searchParams.get("email") !== "0",
      });
      return json(r);
    }
    if (url.pathname === "/run-now") return json(await check(env));

    // Lista as conversas que mandaram mensagem ao bot (para descobrir o chat_id sem expor o token).
    if (url.pathname === "/telegram-chats") {
      if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN não configurado" }, 400);
      const t = clean(env.TELEGRAM_BOT_TOKEN);
      const r = await fetch(`https://api.telegram.org/bot${t}/getUpdates`);
      const d = await r.json();
      const chats = {};
      for (const u of d.result || []) {
        const c = (u.message || u.my_chat_member || {}).chat;
        if (c) chats[c.id] = { type: c.type, first_name: c.first_name, username: c.username };
      }
      // Diagnóstico sem revelar o token: tamanho e se tem o formato "números:letras".
      const shape = { length: t.length, looksValid: /^\d{6,12}:[A-Za-z0-9_-]{30,40}$/.test(t), hasSpaces: /\s/.test(t) };
      return json({ ok: d.ok, description: d.description, tokenShape: shape, chats, configuredChatId: env.TELEGRAM_CHAT_ID || null });
    }
    return json({ error: "not found" }, 404);
  },
};
