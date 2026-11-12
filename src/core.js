import { BOOKING_URL, CALENDARS, KNOWN_STATES, deadlineOf, fmt, isBookable, isHome, parseCalendar, sessionKey } from "./parser.js";

export const FAIL_ALERT_AFTER_MS = 10 * 60 * 1000;
const MAX_EVENTS = 60;

export const URGENT_TITLE = "🚨 URGENTE! ABRIU VAGA CEnT@CASA — RESERVE AGORA!";

export function emptyState() {
  return { sessions: {}, unknownSeen: {}, failing: {}, events: [], checks: 0, lastCheck: null, lastOk: null, snapshot: {} };
}

function both(date) {
  return `${fmt(date, "Europe/Rome")} (Itália) = ${fmt(date, "America/Sao_Paulo")} (Brasília)`;
}

function describeSession(cal, row, now) {
  const dl = deadlineOf(row);
  const n = parseInt(row.posti, 10);
  return [
    `📅 Data da prova: ${row.dataTest} — ${cal.label}`,
    `🏛 Universidade: ${row.universita} (${row.citta}, ${row.regione})`,
    `🎟 Vagas: ${Number.isFinite(n) ? n : "não informado"} — status "${row.stato}"`,
    `⏰ Inscrições até: ${dl ? both(dl) : row.fineIscrizioni + " 14:00 (Itália)"}`,
    `🔎 Detectado em: ${both(now)}`,
    `👉 Reserve: ${BOOKING_URL}`,
    `📋 Calendário: ${cal.url}`,
  ].join("\n");
}

function logEvent(state, now, text) {
  state.events.unshift({ at: now.toISOString(), text });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
}

/**
 * Uma rodada de checagem. Não lança exceção: falhas viram estado.
 * @param {object} p
 * @param {object} p.state       estado anterior (ou emptyState())
 * @param {Date}   p.now
 * @param {(url:string)=>Promise<{status:number,text:string}>} p.fetchPage
 * @param {(msg:object)=>Promise<any>} p.notify
 * @param {string} [p.source]    "cloudflare" | "github"
 */
export async function runCheck({ state, now, fetchPage, notify, source = "cloudflare" }) {
  state = state ? structuredClone(state) : emptyState();
  for (const k of Object.keys(emptyState())) if (state[k] === undefined) state[k] = emptyState()[k];
  const notifications = [];
  let allOk = true;

  for (const cal of CALENDARS) {
    let parsed;
    try {
      const res = await fetchPage(cal.url);
      parsed = res.status === 200 ? parseCalendar(res.text) : { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      parsed = { ok: false, error: `erro de rede: ${e?.message || e}` };
    }

    if (!parsed.ok) {
      allOk = false;
      const f = (state.failing[cal.lingua] ||= { since: now.toISOString(), alerted: false });
      f.lastError = parsed.error;
      if (!f.alerted && now - new Date(f.since) >= FAIL_ALERT_AFTER_MS) {
        f.alerted = true;
        notifications.push({
          title: "⚠️ Monitor CEnT: não consigo ler o calendário do CISIA",
          message: `Calendário ${cal.label} falhando desde ${both(new Date(f.since))}.\nÚltimo erro: ${parsed.error}\nMonitor: ${source}.\nEnquanto isso, confira manualmente: ${cal.url}`,
          priority: 4,
          tags: ["warning"],
          click: cal.url,
          email: true,
        });
        logEvent(state, now, `ALERTA TÉCNICO ${cal.lingua}: ${parsed.error}`);
      }
      continue;
    }

    const f = state.failing[cal.lingua];
    if (f) {
      if (f.alerted) {
        notifications.push({
          title: "✅ Monitor CEnT voltou a ler o calendário",
          message: `Calendário ${cal.label} legível de novo (${both(now)}). O monitoramento continua.`,
          priority: 2,
          tags: ["white_check_mark"],
        });
      }
      logEvent(state, now, `${cal.lingua} recuperado (falhava desde ${f.since})`);
      delete state.failing[cal.lingua];
    }

    const homeRows = parsed.rows.filter(isHome);
    state.snapshot[cal.lingua] = homeRows.map((r) => `${r.dataTest} ${r.universita} ${r.posti} ${r.stato}`);
    const seen = new Set();
    const opened = [];

    for (const row of homeRows) {
      const key = sessionKey(cal.lingua, row);
      seen.add(key);
      const prev = state.sessions[key];
      const bookable = isBookable(row);
      const dl = deadlineOf(row);
      const open = bookable && (!dl || dl > now);

      if (open && !prev?.open) {
        opened.push(row);
        logEvent(state, now, `VAGA ABERTA ${key} posti=${row.posti} stato=${row.stato}`);
      } else if (!open && prev?.open) {
        logEvent(state, now, `esgotou/fechou ${key} stato=${row.stato}`);
      } else if (!prev) {
        logEvent(state, now, `nova sessão no calendário (sem vaga) ${key} stato=${row.stato}`);
      }

      if (!KNOWN_STATES.test(row.stato) && !state.unknownSeen[`${key}|${row.stato}`]) {
        state.unknownSeen[`${key}|${row.stato}`] = now.toISOString();
        if (!open) {
          notifications.push({
            title: "👀 CEnT@CASA com status novo no CISIA",
            message: `Status diferente do normal — pode ser abertura de reservas.\n${describeSession(cal, row, now)}`,
            priority: 4,
            tags: ["eyes"],
            click: cal.url,
            email: true,
          });
        }
        logEvent(state, now, `status desconhecido ${key}: ${row.stato}`);
      }

      state.sessions[key] = { open, posti: row.posti, stato: row.stato, lastSeen: now.toISOString() };
    }

    for (const key of Object.keys(state.sessions)) {
      if (key.startsWith(cal.lingua + "|") && !seen.has(key)) {
        logEvent(state, now, `sessão saiu do calendário ${key}`);
        delete state.sessions[key];
      }
    }

    if (opened.length) {
      notifications.unshift({
        title: URGENT_TITLE,
        message: opened.map((r) => describeSession(cal, r, now)).join("\n\n———\n\n"),
        priority: 5,
        tags: ["rotating_light"],
        click: BOOKING_URL,
        actions: [
          { action: "view", label: "RESERVAR AGORA", url: BOOKING_URL, clear: false },
          { action: "view", label: "Ver calendário", url: cal.url, clear: false },
        ],
        email: true,
        retryKeys: opened.map((r) => sessionKey(cal.lingua, r)),
      });
    }
  }

  state.checks += 1;
  state.lastCheck = now.toISOString();
  state.lastSource = source;
  if (allOk) state.lastOk = now.toISOString();

  const delivery = [];
  for (const { retryKeys, ...n } of notifications) {
    let r;
    try {
      r = await notify(n);
    } catch (e) {
      r = { error: String(e?.message || e) };
    }
    delivery.push(r);
    // Push da vaga não chegou ao ntfy? Desmarca para tentar de novo na próxima rodada.
    if (retryKeys && r?.push !== 200) {
      for (const k of retryKeys) if (state.sessions[k]) state.sessions[k].open = false;
      logEvent(state, now, `falha ao enviar alerta de vaga, vou repetir: ${JSON.stringify(r)}`);
    }
  }
  if (notifications.length) logEvent(state, now, `notificações enviadas: ${notifications.length} ${JSON.stringify(delivery)}`);

  return { state, notifications, delivery };
}
