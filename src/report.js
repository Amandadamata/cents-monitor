// Conferência automática (3x por dia): verifica a saúde do monitor e manda uma
// mensagem-teste. Se a mensagem não chegar no horário, algo está errado.

import { deadlineOf, fmt, isBookable, isHome } from "./parser.js";

const EXPECTED_RATIO = 0.8; // aceita até 20% de minutos sem checagem (o cron às vezes pula)
const MAX_OK_AGE_MIN = 12;
const MAX_OUTBOX_AGE_MIN = 30;

function short(name) {
  return name.replace(/Università degli studi (di |della |G\. )?/i, "").replace(/Università /i, "");
}

/**
 * @param {object} p
 * @param {object} p.state    estado do Worker
 * @param {Array}  p.outbox   fila de reenvio
 * @param {Date}   p.now
 * @param {{at:string,checks:number}|null} p.last  conferência anterior
 * @param {Record<string,{ok:boolean,rows?:Array,error?:string,label:string}>} p.live leitura feita agora
 */
export function buildReport({ state, outbox, now, last, live }) {
  const problems = [];
  const lines = [`🕘 ${fmt(now, "America/Sao_Paulo")} (Brasília)`];

  if (last?.at && Number.isFinite(last.checks)) {
    const minutes = Math.round((now - new Date(last.at)) / 60000);
    const done = (state.checks || 0) - last.checks;
    lines.push(`📡 Checagens desde a última conferência: ${done} de ~${minutes} esperadas`);
    if (minutes >= 30 && done < minutes * EXPECTED_RATIO) problems.push(`poucas checagens: ${done} de ~${minutes}`);
  } else {
    lines.push(`📡 Checagens até agora: ${state.checks || 0} (primeira conferência)`);
  }

  const okAge = state.lastOk ? Math.round((now - new Date(state.lastOk)) / 60000) : Infinity;
  lines.push(`🕐 Última leitura bem-sucedida do CISIA: ${Number.isFinite(okAge) ? `há ${okAge} min` : "nunca"}`);
  if (okAge > MAX_OK_AGE_MIN) problems.push(`sem leitura do CISIA há ${okAge} min`);

  for (const [lingua, f] of Object.entries(state.failing || {})) problems.push(`calendário ${lingua} falhando desde ${f.since}: ${f.lastError}`);

  for (const cal of Object.values(live)) {
    if (!cal.ok) {
      lines.push(`📋 ${cal.label}: ❌ não consegui ler agora (${cal.error})`);
      problems.push(`leitura ao vivo falhou (${cal.label}): ${cal.error}`);
      continue;
    }
    const home = cal.rows.filter(isHome);
    if (!home.length) {
      lines.push(`📋 ${cal.label}: nenhuma data CENT@CASA publicada`);
      continue;
    }
    const open = home.filter((r) => isBookable(r) && (!deadlineOf(r) || deadlineOf(r) > now));
    lines.push(`📋 ${cal.label}: ${home.length} sessões CENT@CASA, ${open.length ? `🚨 ${open.length} COM VAGA` : "nenhuma com vaga"}`);
    for (const r of home) lines.push(`   • ${r.dataTest.slice(0, 5)} ${short(r.universita)} — ${r.stato}${/^\d+$/.test(r.posti) ? ` (${r.posti})` : ""}`);
  }

  const oldest = outbox.length ? Math.round((now - new Date(outbox[0].at)) / 60000) : 0;
  lines.push(`📬 Fila de reenvio (ntfy/e-mail): ${outbox.length ? `${outbox.length} pendente(s), a mais antiga há ${oldest} min` : "vazia"}`);
  if (outbox.length && oldest > MAX_OUTBOX_AGE_MIN) problems.push(`fila de reenvio parada há ${oldest} min`);

  const ok = problems.length === 0;
  if (!ok) lines.push("", "⚠️ PROBLEMAS:", ...problems.map((p) => `• ${p}`), "", "Enquanto isso, confira o CISIA manualmente.");
  lines.push("", "🔔 Esta mensagem também é o teste de notificação: se ela chegou, os alertas estão funcionando.");

  return {
    ok,
    problems,
    msg: {
      title: ok ? "✅ Conferência OK — monitor CEnT@CASA" : "⚠️ Conferência: PROBLEMA no monitor CEnT@CASA",
      message: lines.join("\n"),
      priority: ok ? 3 : 5,
      tags: [ok ? "white_check_mark" : "warning"],
      click: "https://testcisia.it/calendario.php?tolc=cents&lingua=inglese",
    },
  };
}
