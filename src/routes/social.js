const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const { pool } = require("../db");
const { player, rateLimiter } = require("../middleware");
const P = require("../players");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CARD_W = 1200, CARD_H = 630, CARD_MAX_BYTES = 400 * 1024, MAX_CARDS_PER_PLAYER = 20;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const shareLimit = rateLimiter({ windowMs: 3600 * 1000, max: 12 });

// Принимаем только настоящий PNG ровно нужного размера: карточка результата не должна превращаться в файлообменник
function validCardPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 100 && buf.length <= CARD_MAX_BYTES &&
    buf.subarray(0, 8).equals(PNG_SIG) && buf.toString("ascii", 12, 16) === "IHDR" &&
    buf.readUInt32BE(16) === CARD_W && buf.readUInt32BE(20) === CARD_H;
}
const baseUrl = (req) => config.PUBLIC_URL || `https://${req.get("host")}`;

module.exports = (app) => {
  // Кого я пригласил
  app.get("/api/referrals", player(async (req, res, { uid }) => {
    const { rows } = await pool.query(
      `SELECT first_name, username, created_at FROM players WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 100`, [uid]);
    res.json({
      friends: rows.map((r) => ({ name: r.first_name || r.username || "Игрок", username: r.username || "", joined: r.created_at })),
      reward: config.REF_REWARD
    });
  }, { allowBanned: true }));

  // Карточка результата: клиент рисует PNG на canvas (1200×630) и присылает сюда сырым телом.
  // Подпись и ссылка на игру берутся из БД, а не от клиента. Возвращаем ссылку на страницу с превью.
  app.post("/api/share", express.raw({ type: "image/png", limit: "500kb" }), player(async (req, res, { p, uid }) => {
    if (!(await shareLimit(uid))) return res.status(429).json({ error: "Too many cards, try later" });
    if (!validCardPng(req.body)) return res.status(400).json({ error: "Bad image" });
    // очки на карточке не выше лучшего проверенного результата игрока в этом режиме
    const mode = /^[a-z]{3,12}$/.test(String(req.query.mode || "")) ? String(req.query.mode) : "classic";
    const mb = await pool.query(`SELECT COALESCE(MAX(best),0)::int AS best FROM mode_scores WHERE telegram_id=$1 AND mode=$2`, [uid, mode]);
    const day = await pool.query(`SELECT COALESCE(MAX(best),0)::int AS best FROM daily_scores WHERE telegram_id=$1 AND day >= to_char(NOW() - INTERVAL '2 days','YYYY-MM-DD')`, [uid]);
    const best = Math.max(Number(mode === "nowalls" ? p.best_nowalls : mode === "classic" ? p.best_score : 0) || 0, mb.rows[0].best, mode === "classic" ? day.rows[0].best : 0);
    const score = Math.min(best, Math.max(0, Math.floor(Number(req.query.score) || 0)));
    if (!score) return res.status(400).json({ error: "Bad score" });
    const id = crypto.randomBytes(6).toString("hex");
    await pool.query(`INSERT INTO share_cards(id, telegram_id, score, mode, image) VALUES($1,$2,$3,$4,$5)`, [id, uid, score, mode, req.body]);
    pool.query(
      `DELETE FROM share_cards WHERE telegram_id=$1 AND id NOT IN (SELECT id FROM share_cards WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT $2)`,
      [uid, MAX_CARDS_PER_PLAYER]).catch(() => {});
    const url = `${baseUrl(req)}/s/${id}`;
    const text = `🐍 Я набрал ${score} очков в Snake Arena! Сможешь побить?`;
    res.json({ id, url, score, text, share_url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` });
  }));

  // Публичная страница карточки: из неё Telegram и соцсети берут превью (og:image)
  async function loadCard(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
    const r = await pool.query(
      `SELECT c.id, c.score, c.mode, c.telegram_id, p.first_name, p.username FROM share_cards c
       JOIN players p ON p.telegram_id=c.telegram_id WHERE c.id=$1 AND NOT p.banned`, [id]);
    return r.rows[0] || null;
  }
  app.get("/s/:id", async (req, res) => {
    try {
      const c = await loadCard(req.params.id);
      if (!c) return res.status(404).send("Карточка не найдена");
      const name = c.first_name || c.username || "Игрок";
      const title = `${name}: ${c.score} очков в Snake Arena`;
      const desc = "Сможешь побить рекорд? Заходи в игру и попробуй!";
      const img = `${baseUrl(req)}/s/${c.id}/card.png`;
      const play = P.refLink(c.telegram_id) || config.PUBLIC_URL || "/";
      res.set("Cache-Control", "public, max-age=300");
      res.type("html").send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="${CARD_W}"><meta property="og:image:height" content="${CARD_H}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06100b;color:#f3fff8;font:16px system-ui;text-align:center}main{max-width:680px;padding:20px}img{width:100%;border-radius:18px;border:1px solid #244a36}a.b{display:inline-block;margin-top:18px;padding:14px 28px;border-radius:14px;background:#2ee88a;color:#04140b;font-weight:800;text-decoration:none}</style></head>
<body><main><img src="${esc(img)}" alt="${esc(title)}"><h1>${esc(title)}</h1><p>${esc(desc)}</p><a class="b" href="${esc(play)}">🎮 Играть</a></main></body></html>`);
    } catch (e) { console.error(e); res.status(500).send("error"); }
  });
  app.get("/s/:id/card.png", async (req, res) => {
    try {
      const c = await loadCard(req.params.id);
      if (!c) return res.status(404).send("not found");
      const r = await pool.query(`SELECT image FROM share_cards WHERE id=$1`, [c.id]);
      res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
      res.send(r.rows[0].image);
    } catch (e) { console.error(e); res.status(500).send("error"); }
  });
};
module.exports.validCardPng = validCardPng;
