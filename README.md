# cents-monitor

Monitor pessoal de vagas **CEnT@CASA** (exame CEnT-S do CISIA).

- **Cloudflare Worker** (`src/worker.js`): lê o calendário do CISIA a cada minuto, nas versões
  da prova em inglês e em italiano. Considera só linhas `CENT@CASA` com `POSTI DISPONIBILI` (ou
  com número de vagas) e prazo de inscrição aberto.
- **Alerta** via Telegram e [ntfy](https://ntfy.sh): push para iPhone e Mac e e-mail. Sai um alerta por
  abertura; se a sessão esgotar e reabrir, sai outro.
- **Vigia de reserva** (GitHub Actions, `backup/watchdog.mjs`): a cada ~10 min confere se o
  Worker está saudável. Se não estiver, avisa e passa a checar o CISIA no lugar dele.
- **Alertas técnicos**: site fora do ar por mais de 10 min ou mudança de formato da página.
- **Conferência 3x por dia** (9h, 15h e 21h de Brasília, `src/report.js`): lê o CISIA ao vivo, confere
  checagens, falhas e fila, e manda uma mensagem-teste ✅ (ou ⚠️ se achar problema). E-mail só às 21h.
- **UptimeRobot** checa `/health` a cada 5 min e manda e-mail se o monitor parar.

Não reserva, não paga e não guarda senhas. Uma requisição por minuto por calendário.

## Comandos

```bash
npm test                         # testes do parser e da lógica de alerta
npx wrangler deploy              # publica o Worker
npx wrangler tail                # logs ao vivo
curl https://cents-monitor.cents-monitor.workers.dev/status   # estado atual
curl https://cents-monitor.cents-monitor.workers.dev/health   # 200 OK / 503 DOWN (UptimeRobot)
```

Segredos do Worker (`wrangler secret put`): `NTFY_TOPIC`, `NTFY_TOKEN`, `ALERT_EMAIL`, `ADMIN_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
Segredos do GitHub: `WORKER_URL`, `NTFY_TOPIC`, `NTFY_TOKEN`, `ALERT_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
