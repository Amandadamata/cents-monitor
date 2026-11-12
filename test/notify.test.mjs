import { test } from "node:test";
import assert from "node:assert/strict";
import { sendNotification } from "../src/notify.js";

const cfg = { ntfyTopic: "t", ntfyToken: "tk", alertEmail: "a@b.c", telegramToken: "x", telegramChatId: "1" };
const msg = { title: "T", message: "M", priority: 5, email: true, actions: [{ action: "view", label: "RESERVAR AGORA", url: "https://r" }] };

test("ntfy com cota estourada mas Telegram ok → entregue", async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.includes("telegram")) return new Response("{}", { status: 200 });
    return new Response("quota", { status: 429 });
  };
  const r = await sendNotification(cfg, msg, f);
  assert.equal(r.delivered, true);
  assert.equal(r.telegram, 200);
  assert.equal(r.push, 429);
  const tg = calls.find((c) => c.url.includes("telegram")).body;
  assert.equal(tg.chat_id, "1");
  assert.equal(tg.reply_markup.inline_keyboard[0][0].text, "RESERVAR AGORA");
  assert.ok(calls.some((c) => c.body.topic === "t-mail" && c.body.email === "a@b.c"));
});

test("tudo falhando → não entregue (o alerta de vaga será repetido)", async () => {
  const r = await sendNotification(cfg, msg, async () => new Response("x", { status: 500 }));
  assert.equal(r.delivered, false);
});

test("erro de rede num canal não derruba o outro", async () => {
  const f = async (url) => {
    if (url.includes("telegram")) throw new Error("offline");
    return new Response("{}", { status: 200 });
  };
  const r = await sendNotification(cfg, msg, f);
  assert.equal(r.delivered, true);
  assert.equal(r.telegram, 0);
});
