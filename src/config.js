// Настройки из переменных окружения. Всё, что меняется на лету (имя бота), лежит в config.botUsername.
require("dotenv").config();
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "";

const config = {
  PORT: Number(process.env.PORT || 3000),
  BOT_TOKEN,
  // если BOT_USERNAME не задан — определяется через getMe при запуске
  botUsername: (process.env.BOT_USERNAME || "").replace(/^@/, ""),
  // start: t.me/bot?start=ref_ID (работает всегда) | startapp: t.me/bot?startapp=ref_ID (нужно «основное Mini App» у бота)
  REF_MODE: process.env.REF_MODE || "start",
  DATABASE_URL: process.env.DATABASE_URL || "",
  // Если у Mini App есть короткое имя (BotFather → /newapp), ссылка будет t.me/bot/app?startapp=ref_ID
  APP_SHORT_NAME: (process.env.APP_SHORT_NAME || "").replace(/^\//, ""),
  DAILY_TZ: process.env.DAILY_TZ || "UTC", // часовой пояс «нового дня» (например Europe/Moscow)
  DAILY_REWARDS: [100, 200, 300, 500, 750, 1000, 2000], // награда за дни серии 1..7, дальше цикл заново
  // Публичный адрес сервиса (на Render подставляется сам) — нужен для вебхука бота, оплаты Stars и ссылок на карточки
  PUBLIC_URL: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""),
  REMINDERS_ON: process.env.REMINDERS !== "off",
  REMINDER_HOUR: Number(process.env.REMINDER_HOUR || 18), // с этого часа (по DAILY_TZ) шлём напоминание о серии
  WEBHOOK_SECRET: BOT_TOKEN ? crypto.createHash("sha256").update("wh:" + BOT_TOKEN).digest("hex").slice(0, 48) : "",
  RUN_KEY: crypto.createHash("sha256").update("run:" + (BOT_TOKEN || "dev")).digest(),
  ADMIN_IDS: new Set(String(process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((x) => x.trim()).filter(Boolean)),
  REF_REWARD: Number(process.env.REF_REWARD || 500), // пригласившему
  REF_BONUS: Number(process.env.REF_BONUS || 200),   // приглашённому
  INITDATA_MAX_AGE: Number(process.env.INITDATA_MAX_AGE || 86400), // сек: подпись Telegram старше этого срока не принимается
  DAILY_CHALLENGE_BONUS: Number(process.env.DAILY_CHALLENGE_BONUS || 150), // монет за первый забег ежедневного челленджа
  BROADCAST_DELAY_MS: Number(process.env.BROADCAST_DELAY_MS || 45) // пауза между сообщениями рассылки (лимит Telegram ~30/сек)
};

module.exports = config;
