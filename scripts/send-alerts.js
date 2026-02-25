/* eslint-disable no-console */
const { createClient } = require("@supabase/supabase-js");
const { addDays, addMonths, differenceInCalendarDays, formatISO } = require("date-fns");
const { utcToZonedTime } = require("date-fns-tz");

const TZ = "America/Sao_Paulo";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const TELEGRAM_BOT_TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = mustEnv("TELEGRAM_CHAT_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function addInterval(date, value, unit) {
  return unit === "months" ? addMonths(date, value) : addDays(date, value);
}

function adjustWeekend(date) {
  const dow = date.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) return addDays(date, 2);
  if (dow === 0) return addDays(date, 1);
  return date;
}

function calcNextDate(lastApplied, intervalValue, intervalUnit) {
  return adjustWeekend(addInterval(lastApplied, intervalValue, intervalUnit));
}

function toISODate(d) {
  // YYYY-MM-DD in local TZ
  return formatISO(d, { representation: "date" });
}

async function telegramSend(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram error: ${res.status} ${body}`);
  }
}

async function alreadyLogged(treatmentId, alertType, alertDate) {
  // tenta inserir no alert_log (unique impede duplicar)
  const { error } = await supabase.from("alert_log").insert([
    {
      treatment_id: treatmentId,
      alert_type: alertType,
      alert_date: alertDate, // YYYY-MM-DD
    },
  ]);

  if (!error) return false; // não existia, inseriu agora
  // 23505 = unique_violation
  if (error.code === "23505") return true;
  throw error;
}

async function main() {
  const nowUtc = new Date();
  const nowSP = utcToZonedTime(nowUtc, TZ);
  const todayISO = toISODate(nowSP);

  // 1) pega o Zeus
  const { data: pets, error: petErr } = await supabase
    .from("pets")
    .select("id,name")
    .eq("name", "Zeus")
    .limit(1);

  if (petErr) throw petErr;
  if (!pets || pets.length === 0) throw new Error('Pet "Zeus" not found');

  const zeus = pets[0];

  // 2) tratamentos
  const { data: treatments, error: trErr } = await supabase
    .from("treatments")
    .select("id,name,category,interval_value,interval_unit,alerts_days")
    .eq("pet_id", zeus.id);

  if (trErr) throw trErr;

  for (const t of treatments) {
    // 3) última aplicação
    const { data: apps, error: appErr } = await supabase
      .from("applications")
      .select("applied_on")
      .eq("treatment_id", t.id)
      .order("applied_on", { ascending: false })
      .limit(1);

    if (appErr) throw appErr;

    if (!apps || apps.length === 0) {
      // sem histórico: opcional alertar. Vou pular por padrão.
      continue;
    }

    const lastAppliedOn = apps[0].applied_on; // YYYY-MM-DD
    const last = new Date(`${lastAppliedOn}T00:00:00`);
    const next = calcNextDate(last, t.interval_value, t.interval_unit);

    const days = differenceInCalendarDays(next, nowSP);

    // ALERTAS: 30/15/5
    const alerts = Array.isArray(t.alerts_days) ? t.alerts_days : [30, 15, 5];

    // atraso: alerta diário até marcar realizado
    if (days < 0) {
      const alertType = "overdue_daily";
      const already = await alreadyLogged(t.id, alertType, todayISO);
      if (!already) {
        await telegramSend(
          `⚠️ ${zeus.name} — ${t.name} está ATRASADO há ${Math.abs(days)} dia(s).\n` +
            `Última: ${lastAppliedOn}\n` +
            `Próxima prevista: ${toISODate(next)}`
        );
        console.log("Sent overdue alert:", t.name);
      }
      continue;
    }

    if (alerts.includes(days)) {
      const alertType = `due_in_${days}`;
      const already = await alreadyLogged(t.id, alertType, todayISO);
      if (!already) {
        await telegramSend(
          `⏰ ${zeus.name} — ${t.name}\n` +
            `Faltam ${days} dia(s).\n` +
            `Última: ${lastAppliedOn}\n` +
            `Próxima: ${toISODate(next)}`
        );
        console.log("Sent due alert:", t.name, days);
      }
    }
  }

  console.log("Done", todayISO);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});