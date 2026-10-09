const crypto = require("crypto");
const config = require("./config");

// Проверка подписи Telegram initData; возвращает объект пользователя или null
function telegramUser(req) {
  try {
    const raw = req.get("X-Telegram-Init-Data") || "";
    const params = new URLSearchParams(raw);
    const hash = params.get("hash");
    if (!config.BOT_TOKEN || !hash) return null;

    params.delete("hash");
    const dataCheckString = [...params]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(config.BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const a = Buffer.from(calculatedHash, "utf8");
    const b = Buffer.from(hash, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // срок жизни подписи: украденные initData нельзя использовать вечно
    const authDate = Number(params.get("auth_date") || 0), age = Math.floor(Date.now() / 1000) - authDate;
    if (!authDate || age > config.INITDATA_MAX_AGE || age < -300) { if (req) req.initExpired = true; return null; }

    const u = JSON.parse(params.get("user") || "{}");
    if (!u?.id) return null;
    // start_param входит в подписанные initData, поэтому ему можно доверять
    u.start_param = params.get("start_param") || "";
    // запасной вариант: клиент сам прочитал tgWebAppStartParam из адреса (формат строго ref_<число>)
    const hdr = req.get("X-Start-Param") || "";
    if (!u.start_param && /^ref_\d{1,20}$/.test(hdr)) u.start_param = hdr;
    return u;
  } catch {
    return null;
  }
}

const isAdminId = (id) => config.ADMIN_IDS.has(String(id));

module.exports = { telegramUser, isAdminId };
