const { telegramUser, isAdminId } = require("./auth");
const { getPlayer } = require("./players");
const { pool } = require("./db");
const { rateLimiter } = require("./ratelimit");
const { serverError } = require("./notify");

// Обёртка для игровых эндпоинтов: подпись Telegram → игрок из БД → проверка бана → единая обработка ошибок.
// Общий лимит на игрока и точечные лимиты для дорогих/чувствительных эндпоинтов.
const anyLimit = rateLimiter({ windowMs: 60 * 1000, max: 240 });
const named = new Map();
function limited(name, uid, max, windowMs) {
  if (!named.has(name)) named.set(name, rateLimiter({ windowMs, max }));
  return named.get(name)(uid);
}
const tooMany = (res) => res.set("Retry-After", "30").status(429).json({ error: "Too many requests", retry_after: 30 });

// Обёртка для игровых эндпоинтов: подпись Telegram → лимиты → игрок из БД → проверка бана → единая обработка ошибок.
// opts.limit = [max, windowMs] — отдельный лимит этого эндпоинта (ключ — метод и путь).
function player(handler, { allowBanned = false, limit = null } = {}) {
  return async (req, res) => {
    const u = telegramUser(req);
    if (!u) return res.status(401).json(req.initExpired ? { error: "Session expired, reopen the game", expired: true } : { error: "Telegram authorization required" });
    const uid = String(u.id);
    if (!(await anyLimit(uid))) return tooMany(res);
    if (limit && !(await limited(req.method + req.route.path, uid, limit[0], limit[1]))) return tooMany(res);
    try {
      const p = await getPlayer(u);
      if (p.banned && !allowBanned) return res.status(403).json({ error: "Banned", banned: true });
      await handler(req, res, { u, p, uid });
    } catch (e) {
      console.error(req.method, req.path, e);
      serverError(req.method + " " + req.path, e);
      if (!res.headersSent) res.status(500).json({ error: "Database error" });
    }
  };
}

// Лимит по IP для всего /api и публичных страниц (до проверки подписи)
const ipHits = rateLimiter({ windowMs: 60 * 1000, max: 600 });
function ipLimit(req, res, next) {
  ipHits(req.ip || "?").then((ok) => (ok ? next() : tooMany(res)), () => next());
}

// Обёртка для админских эндпоинтов
function admin(handler) {
  return async (req, res) => {
    const u = telegramUser(req);
    if (!u || !isAdminId(u.id)) return res.status(403).json(req.initExpired ? { error: "Session expired", expired: true } : { error: "Admin access required" });
    try {
      await handler(req, res, { adminId: String(u.id), u });
    } catch (e) {
      console.error(req.method, req.path, e);
      serverError(req.method + " " + req.path, e);
      if (!res.headersSent) res.status(500).json({ error: "Database error" });
    }
  };
}

// Журнал действий администратора
const logAdmin = (adminId, action, target = "", details = {}) =>
  pool.query(`INSERT INTO admin_log(admin_id, action, target, details) VALUES($1,$2,$3,$4::jsonb)`,
    [String(adminId), action, String(target), JSON.stringify(details)]).catch((e) => console.error("admin_log:", e.message));

module.exports = { player, admin, rateLimiter, ipLimit, logAdmin };
