// Notificações: ntfy.sh (push + e-mail) e Telegram (push no iPhone e no Mac).
// O e-mail do ntfy sai por um segundo canal sem assinantes ("<canal>-mail"), para que
// um limite de e-mail estourado nunca impeça o push de chegar.
// `delivered` = pelo menos um canal de push (ntfy ou Telegram) aceitou a mensagem.

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { status: 0, error: String(e?.message || e) };
  }
}

export async function sendTelegram(cfg, msg, fetchImpl = fetch) {
  const buttons = (msg.actions || []).filter((a) => a.action === "view").map((a) => [{ text: a.label, url: a.url }]);
  if (!buttons.length && msg.click) buttons.push([{ text: "Abrir", url: msg.click }]);
  const body = {
    chat_id: cfg.telegramChatId,
    text: `${msg.title}\n\n${msg.message}`.slice(0, 4000),
    disable_web_page_preview: true,
    disable_notification: (msg.priority ?? 3) <= 2,
  };
  if (buttons.length) body.reply_markup = { inline_keyboard: buttons };
  const res = await fetchImpl(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, error: res.ok ? undefined : (await res.text()).slice(0, 300) };
}

export async function sendNotification(cfg, msg, fetchImpl = fetch) {
  const base = { title: msg.title, message: msg.message, priority: msg.priority ?? 3, tags: msg.tags ?? [] };
  if (msg.click) base.click = msg.click;
  if (msg.actions) base.actions = msg.actions;

  const headers = { "Content-Type": "application/json" };
  if (cfg.ntfyToken) headers.Authorization = `Bearer ${cfg.ntfyToken}`;
  const server = cfg.ntfyServer || "https://ntfy.sh";
  const results = {};

  const tasks = [];
  if (cfg.ntfyTopic && !cfg.skipPush) {
    tasks.push(
      safe(async () => {
        const r = await fetchImpl(server, { method: "POST", headers, body: JSON.stringify({ ...base, topic: cfg.ntfyTopic }) });
        return { status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 300) };
      }).then((r) => {
        results.push = r.status;
        if (r.error) results.pushError = r.error;
      }),
    );
  }
  if (cfg.telegramToken && cfg.telegramChatId) {
    tasks.push(
      safe(() => sendTelegram(cfg, msg, fetchImpl)).then((r) => {
        results.telegram = r.status;
        if (r.error) results.telegramError = r.error;
      }),
    );
  }
  if (msg.email && cfg.alertEmail && cfg.ntfyToken) {
    tasks.push(
      safe(async () => {
        const r = await fetchImpl(server, { method: "POST", headers, body: JSON.stringify({ ...base, topic: `${cfg.ntfyTopic}-mail`, email: cfg.alertEmail }) });
        return { status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 300) };
      }).then((r) => {
        results.email = r.status;
        if (r.error) results.emailError = r.error;
      }),
    );
  } else if (msg.email) {
    results.email = "pulado (sem NTFY_TOKEN)";
  }
  await Promise.all(tasks);
  results.delivered = results.push === 200 || results.telegram === 200;
  return results;
}
