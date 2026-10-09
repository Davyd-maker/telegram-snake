// Бот: вебхук (оплата Stars, /start), напоминания о серии, рассылки админа
const config = require("./config");
const { pool } = require("./db");
const { tgApi, isBlockedError, webAppButton } = require("./telegram");
const { getPlayer } = require("./players");
const { parseItemPayload, logPaymentError, grantPaidItem } = require("./payments");
const { notifySeasonWinners } = require("./seasons");
const { t, langFromCode } = require("./i18n");
const langOf = async (id, code) => (await pool.query(`SELECT lang FROM players WHERE telegram_id=$1`, [String(id)]).catch(() => ({ rows: [] }))).rows[0]?.lang || langFromCode(code);

async function handleUpdate(upd) {
  // 1) Telegram спрашивает «можно ли списать?» — отвечаем за 10 секунд
  if (upd.pre_checkout_query) {
    const q = upd.pre_checkout_query;
    const it = parseItemPayload(q.invoice_payload, q.from?.id);
    const ok = !!it && q.currency === "XTR" && Number(q.total_amount) === it.def.price;
    if (!ok) await logPaymentError({ telegramId: q.from?.id, kind: "pre_checkout_rejected", reason: "Заказ не прошёл проверку (payload/цена)", payload: q.invoice_payload, stars: q.total_amount, raw: q });
    await tgApi("answerPreCheckoutQuery", ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: "Не удалось подтвердить заказ, попробуй ещё раз" });
    return;
  }
  const m = upd.message;
  if (!m) return;
  // 2) Платёж прошёл — выдаём покупку
  if (m.successful_payment) {
    const sp = m.successful_payment;
    const it = parseItemPayload(sp.invoice_payload, m.from?.id);
    if (!it || sp.currency !== "XTR" || Number(sp.total_amount) !== it.def.price) {
      console.error("suspicious payment", JSON.stringify(sp));
      await logPaymentError({ telegramId: m.from?.id, kind: "suspicious_payment", reason: "Деньги списаны, но платёж не совпал с каталогом — проверь и выдай вручную или верни Stars",
        payload: sp.invoice_payload, chargeId: sp.telegram_payment_charge_id, stars: sp.total_amount, raw: sp });
      return;
    }
    const { kind, def } = it;
    let fresh = false;
    try {
      fresh = await grantPaidItem(m.from.id, kind, def, sp.telegram_payment_charge_id, def.price, it.ref || 0);
    } catch (e) {
      console.error("grant failed", e);
      await logPaymentError({ telegramId: m.from.id, kind: "grant_failed", reason: "Не удалось выдать покупку: " + e.message,
        payload: sp.invoice_payload, chargeId: sp.telegram_payment_charge_id, stars: sp.total_amount, raw: sp });
      return;
    }
    const lang = await langOf(m.from.id, m.from.language_code);
    const key = kind === "product" ? (def.id === "pass" ? "paid_pass" : "paid_starter") : kind === "field" ? "paid_field" : "paid_skin";
    if (fresh) await tgApi("sendMessage", { chat_id: m.chat.id, text: t(lang, key, { emoji: def.emoji, name: def.name }) }).catch(() => {});
    return;
  }
  // 3) /notify_off, /notify_on — сообщения от бота (о друзьях, рейтинге, вызовах)
  if (typeof m.text === "string" && /^\/notify_(on|off)\b/.test(m.text) && m.from?.id) {
    const on = m.text.startsWith("/notify_on");
    await pool.query(`UPDATE players SET notify=$1 WHERE telegram_id=$2`, [on, String(m.from.id)]).catch(() => {});
    await tgApi("sendMessage", { chat_id: m.chat.id, text: t(await langOf(m.from.id, m.from.language_code), on ? "notify_on" : "notify_off") }).catch(() => {});
    return;
  }
  // 4) /start [ref_ID | ch_ID | rp_ID] — регистрируем игрока, засчитываем реферал и даём кнопку запуска игры
  if (typeof m.text === "string" && /^\/start(\s|$)/.test(m.text) && m.from?.id) {
    const param = m.text.split(/\s+/)[1] || "";
    const pl = await getPlayer({ id: m.from.id, username: m.from.username, first_name: m.from.first_name, start_param: param, language_code: m.from.language_code });
    pool.query(`UPDATE players SET bot_blocked=FALSE WHERE telegram_id=$1 AND bot_blocked`, [String(m.from.id)]).catch(() => {});
    const lang = pl?.lang || langFromCode(m.from.language_code);
    let text = t(lang, "start");
    const ch = /^ch_([0-9a-f]{10})$/.exec(param), rp = /^rp_([0-9a-f]{10})$/.exec(param);
    let appUrl = config.PUBLIC_URL;
    if (ch && config.PUBLIC_URL) { appUrl = `${config.PUBLIC_URL}/?challenge=${ch[1]}`; text = t(lang, "start_challenge"); }
    if (rp && config.PUBLIC_URL) { appUrl = `${config.PUBLIC_URL}/?replay=${rp[1]}`; text = t(lang, "start_replay"); }
    const lv = /^lv_([0-9a-f]{8})$/.exec(param), du = /^du_([0-9a-f]{8})$/.exec(param);
    if (lv && config.PUBLIC_URL) { appUrl = `${config.PUBLIC_URL}/?level=${lv[1]}`; text = t(lang, "start_level"); }
    if (du && config.PUBLIC_URL) { appUrl = `${config.PUBLIC_URL}/?duel=${du[1]}`; text = t(lang, "start_duel"); }
    if (pl?.ref_applied) text = t(lang, "invited_bonus", { name: pl.invited_by || "", bonus: config.REF_BONUS }) + "\n\n" + text;
    await tgApi("sendMessage", {
      chat_id: m.chat.id, text,
      reply_markup: appUrl ? { inline_keyboard: [[{ text: t(lang, "play"), web_app: { url: appUrl } }]] } : undefined
    }).catch(() => {});
  }
}

async function setupWebhook() {
  if (!config.BOT_TOKEN) return console.warn("BOT_TOKEN не задан — Stars и бот отключены");
  if (!config.PUBLIC_URL) return console.warn("PUBLIC_URL не задан — вебхук бота не установлен, оплата Stars не будет завершаться. Укажи PUBLIC_URL (https://твой-сервис.onrender.com)");
  try {
    await tgApi("setWebhook", {
      url: `${config.PUBLIC_URL}/telegram/webhook`,
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: ["message", "pre_checkout_query"]
    });
    console.log("Telegram webhook set:", `${config.PUBLIC_URL}/telegram/webhook`);
  } catch (e) {
    console.error("setWebhook failed:", e.message);
  }
}

// ---------- Напоминания о серии ----------
// Если игрок забрал награду вчера, а сегодня ещё нет — вечером шлём одно сообщение от бота.
async function runReminders() {
  if (!config.REMINDERS_ON || !config.BOT_TOKEN) return;
  try {
    const { rows } = await pool.query(
      `SELECT telegram_id, daily_streak, lang FROM players
       WHERE daily_streak>0 AND NOT banned AND NOT bot_blocked AND notify
         AND EXTRACT(HOUR FROM NOW() AT TIME ZONE $1) >= $2
         AND to_char(daily_bonus_claimed_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char((NOW() AT TIME ZONE $1)::date - 1,'YYYY-MM-DD')
         AND (last_reminded_day IS NULL OR last_reminded_day <> to_char(NOW() AT TIME ZONE $1,'YYYY-MM-DD'))
       LIMIT 200`,
      [config.DAILY_TZ, config.REMINDER_HOUR]
    );
    for (const r of rows) {
      await pool.query(`UPDATE players SET last_reminded_day=to_char(NOW() AT TIME ZONE $1,'YYYY-MM-DD') WHERE telegram_id=$2`, [config.DAILY_TZ, r.telegram_id]);
      await tgApi("sendMessage", {
        chat_id: r.telegram_id,
        text: t(r.lang, "reminder", { streak: r.daily_streak }),
        reply_markup: webAppButton(t(r.lang, "claim"))
      }).catch((e) => { if (isBlockedError(e)) pool.query(`UPDATE players SET bot_blocked=TRUE WHERE telegram_id=$1`, [r.telegram_id]).catch(() => {}); });
      await new Promise((ok) => setTimeout(ok, 60)); // лимит Telegram ~30 сообщений/сек
    }
  } catch (e) {
    console.error("reminders error", e.message);
  }
}

// ---------- Рассылка ----------
const AUDIENCES = {
  all:      { label: "Все игроки",                     where: "TRUE" },
  active7:  { label: "Играли за последние 7 дней",     where: "telegram_id IN (SELECT telegram_id FROM activity WHERE day >= to_char((NOW() AT TIME ZONE $1)::date - 6,'YYYY-MM-DD'))" },
  inactive7:{ label: "Не заходили 7+ дней",            where: "telegram_id NOT IN (SELECT telegram_id FROM activity WHERE day >= to_char((NOW() AT TIME ZONE $1)::date - 6,'YYYY-MM-DD'))" },
  news:     { label: "Все, кто не отключил сообщения бота", where: "notify" }
};
const audienceSql = (a) => `NOT banned AND NOT bot_blocked AND ${AUDIENCES[a].where}`;

async function countAudience(audience) {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM players WHERE ${audienceSql(audience)}`, AUDIENCES[audience].where.includes("$1") ? [config.DAILY_TZ] : []);
  return r.rows[0].n;
}

let activeBroadcast = null;
async function sendOne(chatId, text, withButton, lang = "ru") {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await tgApi("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, reply_markup: withButton ? webAppButton(t(lang, "play")) : undefined });
      return "sent";
    } catch (e) {
      if (e.retryAfter) { await new Promise((ok) => setTimeout(ok, (e.retryAfter + 1) * 1000)); continue; }
      return isBlockedError(e) ? "blocked" : "failed";
    }
  }
  return "failed";
}

// Запускает рассылку в фоне и сразу возвращает её id; прогресс виден в таблице broadcasts.
// text — строка или { ru, en }: тогда каждому игроку уходит текст на его языке.
async function startBroadcast({ text, audience, withButton, adminId }) {
  if (activeBroadcast) throw Object.assign(new Error("Другая рассылка ещё идёт"), { status: 409 });
  const params = AUDIENCES[audience].where.includes("$1") ? [config.DAILY_TZ] : [];
  const { rows: ids } = await pool.query(`SELECT telegram_id, lang FROM players WHERE ${audienceSql(audience)} ORDER BY created_at`, params);
  const textFor = (lang) => (typeof text === "string" ? text : text[lang] || text.ru);
  const ins = await pool.query(
    `INSERT INTO broadcasts(text, audience, with_button, total, created_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [textFor("ru"), audience, withButton, ids.length, String(adminId)]);
  const id = ins.rows[0].id;
  activeBroadcast = { id, cancel: false };
  (async () => {
    let sent = 0, failed = 0, blocked = 0, i = 0;
    try {
      for (const { telegram_id, lang } of ids) {
        if (activeBroadcast.cancel) break;
        const r = await sendOne(telegram_id, textFor(lang), withButton, lang);
        if (r === "sent") sent++; else if (r === "blocked") { blocked++; pool.query(`UPDATE players SET bot_blocked=TRUE WHERE telegram_id=$1`, [telegram_id]).catch(() => {}); } else failed++;
        if (++i % 10 === 0) await pool.query(`UPDATE broadcasts SET sent=$2, failed=$3, blocked=$4 WHERE id=$1`, [id, sent, failed, blocked]).catch(() => {});
        await new Promise((ok) => setTimeout(ok, config.BROADCAST_DELAY_MS));
      }
      await pool.query(`UPDATE broadcasts SET sent=$2, failed=$3, blocked=$4, status=$5, finished_at=NOW() WHERE id=$1`,
        [id, sent, failed, blocked, activeBroadcast.cancel ? "cancelled" : "done"]);
    } catch (e) {
      console.error("broadcast error", e);
      await pool.query(`UPDATE broadcasts SET sent=$2, failed=$3, blocked=$4, status='error', finished_at=NOW() WHERE id=$1`, [id, sent, failed, blocked]).catch(() => {});
    } finally { activeBroadcast = null; }
  })();
  return { id, total: ids.length };
}
const cancelBroadcast = () => { if (activeBroadcast) { activeBroadcast.cancel = true; return true; } return false; };
const broadcastRunning = () => !!activeBroadcast;

// Тестовая отправка только себе
const sendTest = (chatId, text, withButton) => sendOne(chatId, text, withButton);

function startBackgroundJobs() {
  if (config.REMINDERS_ON && config.BOT_TOKEN) setInterval(runReminders, 20 * 60 * 1000).unref();
  if (config.BOT_TOKEN) setInterval(() => notifySeasonWinners().catch((e) => console.error("season notify:", e.message)), 5 * 60 * 1000).unref();
  // карточки результатов хранятся 30 дней
  setInterval(() => pool.query(`DELETE FROM share_cards WHERE created_at < NOW() - INTERVAL '30 days'`).catch(() => {}), 6 * 3600 * 1000).unref();
  require("./jobs").start();
}

module.exports = {
  handleUpdate, setupWebhook, runReminders, startBackgroundJobs,
  AUDIENCES, countAudience, startBroadcast, cancelBroadcast, broadcastRunning, sendTest
};
