// Lê a tabela "DATE CEnT-S" do CISIA (calendario.php?tolc=cents&lingua=...).
// Colunas: MODALITÀ | UNIVERSITÀ | REGIONE/STATO ESTERO | CITTÀ | FINE ISCRIZIONI | POSTI | STATO | DATA TEST

export const BOOKING_URL = "https://testcisia.it/studenti_tolc/login_sso.php";

export const CALENDARS = [
  { lingua: "inglese", label: "prova em INGLÊS", url: "https://testcisia.it/calendario.php?tolc=cents&lingua=inglese" },
  { lingua: "italiano", label: "prova em ITALIANO", url: "https://testcisia.it/calendario.php?tolc=cents&lingua=italiano" },
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È" };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

function cellText(html) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const EXPECTED_HEADERS = ["MODALIT", "UNIVERSIT", "REGIONE", "CITT", "FINE ISCRIZIONI", "POSTI", "STATO", "DATA TEST"];

/**
 * @returns {{ ok: true, rows: Array<object> } | { ok: false, error: string }}
 */
export function parseCalendar(html) {
  if (typeof html !== "string" || html.length < 500) return { ok: false, error: "página vazia ou curta demais" };

  const tableMatch = html.match(/<table[^>]*id=["']calendario["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) {
    if (/Nessuna data disponibile/i.test(html)) return { ok: true, rows: [] };
    if (/Just a moment|cf-challenge|Attention Required/i.test(html)) return { ok: false, error: "bloqueado pela proteção anti-robô (Cloudflare)" };
    return { ok: false, error: "tabela do calendário não encontrada (o formato da página mudou?)" };
  }
  const table = tableMatch[1];

  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => cellText(m[1]).toUpperCase());
  const headerOk = EXPECTED_HEADERS.every((h, i) => (headers[i] || "").includes(h));
  if (!headerOk) return { ok: false, error: `colunas da tabela mudaram: ${headers.join(" | ")}` };

  const rows = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (tds.length === 0) continue; // linha de cabeçalho
    if (tds.length < 8) return { ok: false, error: `linha com ${tds.length} colunas: ${tds.join(" | ")}` };
    const [modalita, universita, regione, citta, fineIscrizioni, posti, stato, dataTest] = tds;
    rows.push({ modalita: modalita.toUpperCase(), universita, regione, citta, fineIscrizioni, posti, stato: stato.toUpperCase(), dataTest });
  }
  return { ok: true, rows };
}

export function isHome(row) {
  return /CENT@CASA|CENT@HOME/.test(row.modalita);
}

/** Vaga reservável: status "disponível" ou número de vagas > 0, e nunca "esgotado/fechado". */
export function isBookable(row) {
  const s = row.stato;
  if (/ESAURIT|CHIUS|NON ANCORA|SOSPES|ANNULLAT/.test(s)) return false;
  if (/DISPONIBIL|APERT/.test(s)) return true;
  const n = parseInt(row.posti, 10);
  return Number.isFinite(n) && n > 0;
}

export const KNOWN_STATES = /POSTI DISPONIBILI|POSTI ESAURITI/;

export function sessionKey(lingua, row) {
  return [lingua, row.dataTest, row.universita, row.citta].join("|");
}

/** "11/12/2026" -> {y,m,d} */
export function parseDate(dmy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || "");
  return m ? { d: +m[1], m: +m[2], y: +m[3] } : null;
}

function tzOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** Instante UTC de uma hora local de um fuso (ex.: 14:00 em Europe/Rome). */
export function zonedToDate({ y, m, d }, hour, timeZone) {
  const guess = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  const off = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - off * 60000);
}

export function fmt(date, timeZone) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Inscrições fecham às 14:00 (hora da Itália) do dia FINE ISCRIZIONI. */
export function deadlineOf(row) {
  const d = parseDate(row.fineIscrizioni);
  return d ? zonedToDate(d, 14, "Europe/Rome") : null;
}
