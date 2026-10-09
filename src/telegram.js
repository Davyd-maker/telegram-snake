const config = require("./config");

class TgError extends Error {
  constructor(method, j, status) {
    super(`${method}: ${j?.description || status}`);
    this.code = j?.error_code || status;
    this.retryAfter = j?.parameters?.retry_after || 0;
  }
}

async function tgApi(method, params) {
  if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is not set");
  const r = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {})
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new TgError(method, j, r.status);
  return j.result;
}

// Бот не может писать этому человеку (заблокировал, удалил аккаунт, не нажимал /start)
const isBlockedError = (e) => e?.code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(e?.message || "");

const webAppButton = (text) => config.PUBLIC_URL
  ? { inline_keyboard: [[{ text, web_app: { url: config.PUBLIC_URL } }]] }
  : undefined;

module.exports = { tgApi, TgError, isBlockedError, webAppButton };
