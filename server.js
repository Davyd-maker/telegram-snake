const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";

const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));

  if (!hash || !authDate) return null;

  // Telegram recommends rejecting stale init data.
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    calculatedHash.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash, "utf8"),
      Buffer.from(hash, "utf8")
    )
  ) return null;

  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

function getUser(req) {
  return validateTelegramInitData(req.header("x-telegram-init-data") || "");
}

function upsertPlayer(user) {
  db.prepare(`
    INSERT INTO players (telegram_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    user.id,
    user.username || null,
    user.first_name || "Игрок"
  );
}

app.get("/api/me", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Telegram authorization required" });

  upsertPlayer(user);

  const player = db.prepare(`
    SELECT telegram_id, username, first_name, coins, best_score
    FROM players WHERE telegram_id = ?
  `).get(user.id);

  res.json({
    player: {
      id: player.telegram_id,
      username: player.username,
      firstName: player.first_name,
      coins: player.coins,
      bestScore: player.best_score
    }
  });
});

app.get("/api/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT first_name, username, best_score, coins
    FROM players
    ORDER BY best_score DESC, coins DESC
    LIMIT 20
  `).all();

  res.json({
    leaderboard: rows.map((p, i) => ({
      place: i + 1,
      name: p.username ? `@${p.username}` : p.first_name,
      score: p.best_score,
      coins: p.coins
    }))
  });
});

app.post("/api/score", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Telegram authorization required" });

  const score = Number(req.body.score);
  const earnedCoins = Number(req.body.coins);

  if (!Number.isInteger(score) || score < 0 || score > 100000) {
    return res.status(400).json({ error: "Invalid score" });
  }

  if (!Number.isInteger(earnedCoins) || earnedCoins < 0 || earnedCoins > 10000) {
    return res.status(400).json({ error: "Invalid coins" });
  }

  upsertPlayer(user);

  const player = db.prepare(`
    SELECT best_score, coins FROM players WHERE telegram_id = ?
  `).get(user.id);

  // This is intentionally simple for a starter project.
  // For a production game, validate the run server-side to prevent cheating.
  const newBest = Math.max(player.best_score, score);

  db.prepare(`
    UPDATE players
    SET best_score = ?, coins = coins + ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(newBest, earnedCoins, user.id);

  const updated = db.prepare(`
    SELECT best_score, coins FROM players WHERE telegram_id = ?
  `).get(user.id);

  res.json({
    bestScore: updated.best_score,
    coins: updated.coins
  });
});

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Snake Mini App running on http://localhost:${PORT}`);
});
