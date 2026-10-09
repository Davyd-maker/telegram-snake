// Сообщения от бота игрокам (с отключением и дневным лимитом) и служебные сообщения администраторам.
const config = require("./config");
const { pool } = require("./db");
const { tgApi, isBlockedError } = require("./telegram");
const { t } = require("./i18n");

const MAX_PER_DAY = Number(process.env.NOTIFY_MAX_PER_DAY || 3); // «социальных» сообщений одному игроку в сутки
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: config.DAILY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const playButton = (lang) => (config.PUBLIC_URL ? { inline_keyboard: [[{ text: t(lang, "play"), web_app: { url: config.PUBLIC_URL } }]] } : undefined);

// key — ключ текста из i18n. opts.capped — учитывать дневной лимит (для «друг побил рекорд» и т. п.)
async function toPlayer(uid, key, params = {}, opts = {}) {
  if (!config.BOT_TOKEN) return "off";
  const r = await pool.query(`SELECT lang, notify, bot_blocked, banned FROM players WHERE telegram_id=$1`, [String(uid)]);
  const p = r.rows[0];
  if (!p || p.bot_blocked || p.banned) return "skip";
  if (opts.optional !== false && !p.notify) return "muted";
  if (opts.capped) {
    const c = await pool.query(
      `INSERT INTO notify_log(telegram_id, day, n) VALUES($1,$2,1) ON CONFLICT(telegram_id, day) DO UPDATE SET n=notify_log.n+1 RETURNING n`,
      [String(uid), today()]);
    if (c.rows[0].n > MAX_PER_DAY) return "capped";
  }
  try {
    await tgApi("sendMessage", { chat_id: String(uid), text: t(p.lang, key, params), reply_markup: opts.button === false ? undefined : playButton(p.lang) });
    return "sent";
  } catch (e) {
    if (isBlockedError(e)) await pool.query(`UPDATE players SET bot_blocked=TRUE WHERE telegram_id=$1`, [String(uid)]).catch(() => {});
    return "failed";
  }
}

// ---------- администраторам ----------
const lastAlert = new Map();
// Одинаковые тревоги (по key) — не чаще раза в 10 минут
async function alertAdmins(text, key = text.slice(0, 40)) {
  if (!config.BOT_TOKEN || !config.ADMIN_IDS.size) return;
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < 10 * 60 * 1000) return;
  lastAlert.set(key, now);
  for (const id of config.ADMIN_IDS) {
    await tgApi("sendMessage", { chat_id: id, text: "🛠 Snake Arena\n" + text, disable_web_page_preview: true }).catch(() => {});
  }
}

// Всплеск ошибок сервера: 10 ошибок 5xx за 5 минут → сообщение админу
let errTimes = [];
function serverError(where, e) {
  const now = Date.now();
  errTimes = errTimes.filter((x) => now - x < 5 * 60 * 1000);
  errTimes.push(now);
  if (errTimes.length >= 10) alertAdmins(`⚠️ Много ошибок сервера: ${errTimes.length} за 5 минут.\nПоследняя: ${where}: ${String(e?.message || e).slice(0, 200)}`, "5xx");
}

module.exports = { toPlayer, alertAdmins, serverError, today };
