// Notificações via ntfy.sh.
// O push vai para o canal secreto (app ntfy no iPhone e no Mac).
// O e-mail sai por um segundo canal sem assinantes ("<canal>-mail"), para que
// um limite de e-mail estourado nunca impeça o push de chegar.

export async function sendNotification(cfg, msg, fetchImpl = fetch) {
  const base = {
    title: msg.title,
    message: msg.message,
    priority: msg.priority ?? 3,
    tags: msg.tags ?? [],
  };
  if (msg.click) base.click = msg.click;
  if (msg.actions) base.actions = msg.actions;

  const headers = { "Content-Type": "application/json" };
  if (cfg.ntfyToken) headers.Authorization = `Bearer ${cfg.ntfyToken}`;
  const server = cfg.ntfyServer || "https://ntfy.sh";

  const results = {};
  const push = await fetchImpl(server, { method: "POST", headers, body: JSON.stringify({ ...base, topic: cfg.ntfyTopic }) });
  results.push = push.status;
  if (!push.ok) results.pushError = (await push.text()).slice(0, 300);

  if (msg.email && cfg.alertEmail && cfg.ntfyToken) {
    const mail = await fetchImpl(server, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...base, topic: `${cfg.ntfyTopic}-mail`, email: cfg.alertEmail }),
    });
    results.email = mail.status;
    if (!mail.ok) results.emailError = (await mail.text()).slice(0, 300);
  } else if (msg.email) {
    results.email = "pulado (sem NTFY_TOKEN ou ALERT_EMAIL)";
  }
  return results;
}
