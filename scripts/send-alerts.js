/* eslint-disable no-console */

/**
 * Zeus Alerts - GitHub Actions cron
 *
 * ENV required:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - TELEGRAM_BOT_TOKEN
 *  - TELEGRAM_CHAT_ID
 *
 * Tables expected (public):
 *  - pets (id, name, owner_id?)  // owner via pet_members
 *  - pet_members (pet_id, user_id, role)
 *  - treatments (id, pet_id, category, name, interval_value, interval_unit, alerts_days[])
 *  - applications (id, treatment_id, applied_on)
 *  - alert_log (id, treatment_id, alert_type, alert_date)
 */

const { createClient } = require("@supabase/supabase-js");
const { addDays, addMonths, differenceInCalendarDays, isWeekend } = require("date-fns");
const { toZonedTime, formatInTimeZone } = require("date-fns-tz");

// ====== ENV ======
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
}

const TZ = "America/Sao_Paulo";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ====== Helpers ======
function isoDateSP(date) {
  // YYYY-MM-DD in Sao Paulo timezone
  return formatInTimeZone(date, TZ, "yyyy-MM-dd");
}

function formatBR(date) {
  return formatInTimeZone(date, TZ, "dd/MM/yyyy");
}

function adjustIfWeekend(date) {
  // If Saturday -> +2; If Sunday -> +1
  // Using date-fns isWeekend just to check, but we need day of week
  const d = new Date(date.getTime());
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) return addDays(d, 2);
  if (dow === 0) return addDays(d, 1);
  return d;
}

function addInterval(lastApplied, value, unit) {
  if (unit === "months") return addMonths(lastApplied, value);
  return addDays(lastApplied, value);
}

function calcNextDate(lastApplied, intervalValue, intervalUnit) {
  const base = addInterval(lastApplied, intervalValue, intervalUnit);
  return adjustIfWeekend(base);
}

function daysToNext(nextDate, todaySP) {
  return differenceInCalendarDays(nextDate, todaySP);
}

async function telegramSend(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
}

// ====== Supabase queries ======
async function getOwnerPets() {
  // pets where there is a pet_members row with role=owner
  // For now, you likely have only Zeus, but this supports multiple pets.
  const { data: members, error: mErr } = await supabase
    .from("pet_members")
    .select("pet_id,user_id,role")
    .eq("role", "owner");

  if (mErr) throw mErr;

  const petIds = [...new Set((members || []).map((x) => x.pet_id))];
  if (petIds.length === 0) return [];

  const { data: pets, error: pErr } = await supabase.from("pets").select("id,name").in("id", petIds);
  if (pErr) throw pErr;

  return pets || [];
}

async function getTreatmentsByPet(petId) {
  const { data, error } = await supabase
    .from("treatments")
    .select("id,pet_id,category,name,interval_value,interval_unit,alerts_days")
    .eq("pet_id", petId)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getLastApplicationDate(treatmentId) {
  const { data, error } = await supabase
    .from("applications")
    .select("applied_on")
    .eq("treatment_id", treatmentId)
    .order("applied_on", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  // applied_on is YYYY-MM-DD
  return data[0].applied_on;
}

async function alreadyLogged(treatmentId, alertType, alertDateYYYYMMDD) {
  const { data, error } = await supabase
    .from("alert_log")
    .select("id")
    .eq("treatment_id", treatmentId)
    .eq("alert_type", alertType)
    .eq("alert_date", alertDateYYYYMMDD)
    .limit(1);

  if (error) throw error;
  return !!(data && data.length > 0);
}

async function insertLog(treatmentId, alertType, alertDateYYYYMMDD) {
  const { error } = await supabase.from("alert_log").insert([
    {
      treatment_id: treatmentId,
      alert_type: alertType,
      alert_date: alertDateYYYYMMDD,
    },
  ]);
  if (error) throw error;
}

// ====== Main ======
async function main() {
  // "today" in Sao Paulo
  const now = new Date();
  const nowSP = toZonedTime(now, TZ);
  const todayKey = isoDateSP(nowSP); // YYYY-MM-DD

  console.log(`[Zeus Alerts] Running at SP time: ${formatInTimeZone(now, TZ, "yyyy-MM-dd HH:mm:ssXXX")}`);

  const pets = await getOwnerPets();
  if (pets.length === 0) {
    console.log("[Zeus Alerts] No owner pets found. Exiting.");
    return;
  }

  let sentCount = 0;

  for (const pet of pets) {
    const treatments = await getTreatmentsByPet(pet.id);

    for (const t of treatments) {
      const lastAppliedOn = await getLastApplicationDate(t.id);

      if (!lastAppliedOn) {
        // no history yet, nothing to alert (you can change this behavior if you want)
        continue;
      }

      const lastApplied = new Date(`${lastAppliedOn}T00:00:00`);
      const nextDate = calcNextDate(lastApplied, t.interval_value, t.interval_unit);
      const days = daysToNext(nextDate, nowSP);

      const nextDateKey = isoDateSP(nextDate);

      // Alerts days: default [30,15,5] if null
      const alertsDays = Array.isArray(t.alerts_days) && t.alerts_days.length > 0 ? t.alerts_days : [30, 15, 5];

      // 1) Upcoming alerts: only when days matches exactly one of configured (e.g., 30/15/5)
      if (alertsDays.includes(days)) {
        const alertType = `upcoming_${days}`;

        const already = await alreadyLogged(t.id, alertType, todayKey);
        if (!already) {
          const msg =
            `🐶 <b>${pet.name}</b>\n` +
            `⏳ <b>Próximo</b>: ${t.name} (${t.category})\n` +
            `📌 Próxima data: <b>${formatBR(nextDate)}</b>\n` +
            `🗓️ Última aplicação: ${formatBR(lastApplied)}\n` +
            `⏱️ Faltam <b>${days}</b> dia(s).`;

          await telegramSend(msg);
          await insertLog(t.id, alertType, todayKey);

          sentCount += 1;
          console.log(`[Zeus Alerts] Sent upcoming alert (${days}d): ${t.name} -> ${nextDateKey}`);
        } else {
          console.log(`[Zeus Alerts] Skip (already logged today) upcoming ${days}d: ${t.name}`);
        }
      }

      // 2) Overdue: daily until applied (days < 0)
      if (days < 0) {
        const alertType = "overdue_daily";

        const already = await alreadyLogged(t.id, alertType, todayKey);
        if (!already) {
          const msg =
            `🐶 <b>${pet.name}</b>\n` +
            `🚨 <b>ATRASADO</b>: ${t.name} (${t.category})\n` +
            `📌 Era para: <b>${formatBR(nextDate)}</b>\n` +
            `🗓️ Última aplicação: ${formatBR(lastApplied)}\n` +
            `⏱️ Atraso de <b>${Math.abs(days)}</b> dia(s).\n\n` +
            `✅ Marque no app assim que aplicar.`;

          await telegramSend(msg);
          await insertLog(t.id, alertType, todayKey);

          sentCount += 1;
          console.log(`[Zeus Alerts] Sent overdue alert: ${t.name} (late ${Math.abs(days)}d)`);
        } else {
          console.log(`[Zeus Alerts] Skip (already logged today) overdue: ${t.name}`);
        }
      }
    }
  }

  console.log(`[Zeus Alerts] Done. Sent=${sentCount}`);
}

main().catch((err) => {
  console.error("[Zeus Alerts] Fatal:", err);
  process.exit(1);
});