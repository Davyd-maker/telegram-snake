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
const DAILY_TZ = process.env.DAILY_TZ || "UTC"; // часовой пояс, по которому «новый день» (например Europe/Moscow)
const DAILY_REWARDS = [100, 200, 300, 500, 750, 1000, 2000]; // награда за дни серии 1..7, дальше цикл заново
const MISSIONS = [
  { id: "score",  icon: "🎯", title: "Набери 50 очков за раунд", target: 50, reward: 300 },
  { id: "games",  icon: "🐍", title: "Сыграй 3 раунда",          target: 3,  reward: 500 },
  { id: "apples", icon: "🍎", title: "Съешь 30 яблок",           target: 30, reward: 700 }
];
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
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0`);
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
  const { rows } = await pool.query(
    `SELECT *,
            to_char(daily_bonus_claimed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS last_day,
            to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today
     FROM players WHERE telegram_id=$1`,
    [id, DAILY_TZ]
  );
  return rows[0];
}

// Состояние ежедневной награды. Серия растёт, если заходить каждый день; пропуск дня сбрасывает на 1-й день.
// Задания дня: прогресс хранится в JSONB и сбрасывается при смене дня
function missionState(p) {
  const m = p.missions && typeof p.missions === "object" ? p.missions : {};
  if (m.day !== p.today) return { day: p.today, score: 0, games: 0, apples: 0, claimed: {} };
  return { day: m.day, score: +m.score || 0, games: +m.games || 0, apples: +m.apples || 0, claimed: m.claimed || {} };
}
function missionList(p) {
  const s = missionState(p);
  return MISSIONS.map((x) => ({ ...x, progress: Math.min(x.target, s[x.id]), claimed: !!s.claimed[x.id] }));
}

function dayDiff(a, b) { // b - a в днях, строки YYYY-MM-DD
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function dailyInfo(p) {
  const streak = Number(p.daily_streak) || 0;
  const diff = p.last_day ? dayDiff(p.last_day, p.today) : null;
  const claimedToday = diff === 0;
  const canClaim = !claimedToday;
  const broken = canClaim && streak > 0 && diff !== 1;
  const nextStreak = canClaim ? (diff === 1 ? streak + 1 : 1) : streak;
  const idx = (nextStreak - 1) % DAILY_REWARDS.length;
  return {
    streak: broken ? 0 : streak,
    can_claim: canClaim,
    broken,
    next_streak: nextStreak,
    reward: canClaim ? DAILY_REWARDS[idx] : 0,
    cycle_claimed: canClaim ? idx : ((streak - 1) % DAILY_REWARDS.length) + 1,
    rewards: DAILY_REWARDS
  };
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
    daily: dailyInfo(p),
    missions: missionList(p),
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

app.get("/api/leaderboard", async (req, res) => {
  try {
    const u = telegramUser(req);
    const { rows } = await pool.query(
      `SELECT telegram_id,username,first_name,best_score,coins
       FROM players
       WHERE best_score>0
       ORDER BY best_score DESC, coins DESC
       LIMIT 20`
    );
    let me = null;
    if (u) {
      const r = await pool.query(`SELECT best_score,coins FROM players WHERE telegram_id=$1`, [String(u.id)]);
      if (r.rows[0]) {
        const { best_score, coins } = r.rows[0];
        const rk = await pool.query(
          `SELECT COUNT(*)::int+1 AS rank FROM players WHERE best_score>$1 OR (best_score=$1 AND coins>$2)`,
          [best_score, coins]
        );
        me = { rank: rk.rows[0].rank, best_score };
      }
    }
    res.json({
      leaderboard: rows.map(({ telegram_id, ...x }) => ({ ...x, is_me: !!u && telegram_id === String(u.id) })),
      me
    });
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

    const apples = Math.max(0, Math.min(score, Math.floor(Number(req.body?.apples) || 0)));
    const ms = missionState(p);
    ms.score = Math.max(ms.score, score);
    if (score >= 1) ms.games += 1;
    ms.apples += apples;

    await pool.query(
      `UPDATE players
       SET best_score=GREATEST(best_score,$1),
           coins=coins+$2,
           missions=$4::jsonb,
           updated_at=NOW()
       WHERE telegram_id=$3`,
      [score, coins, String(u.id), JSON.stringify(ms)]
    );

    const updated = await getPlayer(u);
    res.json({ player: responsePlayer(updated), bot_username: BOT_USERNAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/daily", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  const client = await pool.connect();
  try {
    await getPlayer(u); // гарантируем, что игрок есть
    await client.query("BEGIN");
    // блокировка строки — двойной тап не даст забрать награду дважды
    const { rows } = await client.query(
      `SELECT *,
              to_char(daily_bonus_claimed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS last_day,
              to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today
       FROM players WHERE telegram_id=$1 FOR UPDATE`,
      [String(u.id), DAILY_TZ]
    );
    const info = dailyInfo(rows[0]);
    if (!info.can_claim) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Already claimed today", player: responsePlayer(await getPlayer(u)) });
    }
    await client.query(
      `UPDATE players SET coins=coins+$1, daily_streak=$2, daily_bonus_claimed_at=NOW(), updated_at=NOW() WHERE telegram_id=$3`,
      [info.reward, info.next_streak, String(u.id)]
    );
    await client.query("COMMIT");
    res.json({ reward: info.reward, player: responsePlayer(await getPlayer(u)) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Database error" });
  } finally {
    client.release();
  }
});

app.post("/api/mission", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  const def = MISSIONS.find((x) => x.id === String(req.body?.id || ""));
  if (!def) return res.status(400).json({ error: "Bad mission" });
  const client = await pool.connect();
  try {
    await getPlayer(u);
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT *, to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today
       FROM players WHERE telegram_id=$1 FOR UPDATE`,
      [String(u.id), DAILY_TZ]
    );
    const ms = missionState(rows[0]);
    if (ms[def.id] < def.target || ms.claimed[def.id]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Not available", player: responsePlayer(await getPlayer(u)) });
    }
    ms.claimed[def.id] = true;
    await client.query(
      `UPDATE players SET coins=coins+$1, missions=$2::jsonb, updated_at=NOW() WHERE telegram_id=$3`,
      [def.reward, JSON.stringify(ms), String(u.id)]
    );
    await client.query("COMMIT");
    res.json({ reward: def.reward, player: responsePlayer(await getPlayer(u)) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Database error" });
  } finally {
    client.release();
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
