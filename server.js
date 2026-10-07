require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const DATABASE_URL = process.env.DATABASE_URL || "";
// Если у Mini App есть короткое имя (BotFather → /newapp), укажи его в APP_SHORT_NAME —
// тогда ссылка будет t.me/bot/app?startapp=ref_ID. Иначе используется t.me/bot?startapp=ref_ID.
const APP_SHORT_NAME = (process.env.APP_SHORT_NAME || "").replace(/^\//, "");
const REF_REWARD = Number(process.env.REF_REWARD || 500); // пригласившему
const REF_BONUS = Number(process.env.REF_BONUS || 200);   // приглашённому

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required. Create a Render Postgres database and add its Internal Database URL to the web service environment.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      coins INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      referrals INTEGER NOT NULL DEFAULT 0,
      skin TEXT NOT NULL DEFAULT 'classic',
      owned_skins TEXT[] NOT NULL DEFAULT ARRAY['classic']::TEXT[],
      missions JSONB NOT NULL DEFAULT '{}'::jsonb,
      daily_bonus_claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Safe schema upgrades for a database created by an earlier Snake Arena v11 build.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS owned_skins TEXT[] NOT NULL DEFAULT ARRAY['classic']::TEXT[]`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS missions JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_bonus_claimed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`UPDATE players SET owned_skins=ARRAY['classic']::TEXT[] WHERE owned_skins IS NULL OR cardinality(owned_skins)=0`);
  await pool.query(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY['classic']::TEXT[])) WHERE NOT ('classic' = ANY(owned_skins))`);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function telegramUser(req) {
  try {
    const raw = req.get("X-Telegram-Init-Data") || "";
    const params = new URLSearchParams(raw);
    const hash = params.get("hash");
    if (!BOT_TOKEN || !hash) return null;

    params.delete("hash");
    const dataCheckString = [...params]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const a = Buffer.from(calculatedHash, "utf8");
    const b = Buffer.from(hash, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const u = JSON.parse(params.get("user") || "{}");
    if (!u?.id) return null;
    // start_param входит в подписанные initData, поэтому ему можно доверять
    u.start_param = params.get("start_param") || "";
    return u;
  } catch {
    return null;
  }
}

async function getPlayer(u) {
  const id = String(u.id);
  const ins = await pool.query(
    `INSERT INTO players (telegram_id, username, first_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username=EXCLUDED.username,
       first_name=EXCLUDED.first_name,
       updated_at=NOW()
     RETURNING (xmax = 0) AS inserted`,
    [id, u.username || "", u.first_name || ""]
  );
  // Реферал засчитывается один раз — только когда игрок впервые зашёл по ссылке друга
  if (ins.rows[0]?.inserted) await applyReferral(id, u.start_param);
  const { rows } = await pool.query(`SELECT * FROM players WHERE telegram_id=$1`, [id]);
  return rows[0];
}

async function applyReferral(newId, startParam) {
  const m = /^ref_(\d{1,20})$/.exec(String(startParam || ""));
  if (!m || m[1] === newId) return;
  const refId = m[1];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE players SET referrals=referrals+1, coins=coins+$1, updated_at=NOW() WHERE telegram_id=$2 RETURNING 1`,
      [REF_REWARD, refId]
    );
    if (r.rowCount) {
      await client.query(
        `UPDATE players SET referred_by=$1, coins=coins+$2 WHERE telegram_id=$3 AND referred_by IS NULL`,
        [refId, REF_BONUS, newId]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("referral error", e);
  } finally {
    client.release();
  }
}

function refLink(id) {
  if (!BOT_USERNAME) return "";
  const base = APP_SHORT_NAME ? `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}` : `https://t.me/${BOT_USERNAME}`;
  return `${base}?startapp=ref_${id}`;
}

function responsePlayer(p) {
  if (!p) return p;
  return {
    ...p,
    ref_link: refLink(p.telegram_id),
    ref_reward: REF_REWARD,
    ref_bonus: REF_BONUS,
    owned_skins: Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"]
  };
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "postgres" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/api/me", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  try {
    const p = await getPlayer(u);
    res.json({ player: responsePlayer(p), bot_username: BOT_USERNAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT username,first_name,best_score,coins
       FROM players
       ORDER BY best_score DESC, coins DESC
       LIMIT 20`
    );
    res.json({ leaderboard: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ leaderboard: [] });
  }
});

app.post("/api/score", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });

  try {
    const p = await getPlayer(u);
    const score = Math.max(0, Math.min(575, Math.floor(Number(req.body?.score) || 0)));
    // Максимум за очко ~15 монет (золото: 5 очков = 25 + 50) + бонус 100 — режем накрутку.
    const coins = Math.max(0, Math.min(Math.floor(score * 16 + 110), Math.floor(Number(req.body?.coins) || 0)));

    await pool.query(
      `UPDATE players
       SET best_score=GREATEST(best_score,$1),
           coins=coins+$2,
           updated_at=NOW()
       WHERE telegram_id=$3`,
      [score, coins, String(u.id)]
    );

    const updated = await getPlayer(u);
    res.json({ player: responsePlayer(updated), bot_username: BOT_USERNAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/profile", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });

  const allowed = { classic: 0, fire: 2000, ice: 5000, gold: 10000, cyber: 20000 };
  const skin = String(req.body?.skin || "");
  if (!(skin in allowed)) return res.status(400).json({ error: "Bad skin" });

  try {
    const p = await getPlayer(u);
    const owned = Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"];

    if (!owned.includes(skin)) {
      const price = allowed[skin];
      if (Number(p.coins) < price) return res.status(400).json({ error: "Not enough coins" });
      await pool.query(
        `UPDATE players
         SET coins=coins-$1,
             skin=$2,
             owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$2]::TEXT[])),
             updated_at=NOW()
         WHERE telegram_id=$3`,
        [price, skin, String(u.id)]
      );
    } else {
      await pool.query(
        `UPDATE players SET skin=$1, updated_at=NOW() WHERE telegram_id=$2`,
        [skin, String(u.id)]
      );
    }

    const updated = await getPlayer(u);
    res.json({ player: responsePlayer(updated), bot_username: BOT_USERNAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

async function start() {
  try {
    await initDb();
    await pool.query("SELECT 1");
    app.listen(PORT, "0.0.0.0", () => console.log(`Snake Arena v11 running on ${PORT} with PostgreSQL`));
  } catch (e) {
    console.error("Database initialization failed:", e);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
process.on("SIGINT", async () => { await pool.end(); process.exit(0); });

start();
