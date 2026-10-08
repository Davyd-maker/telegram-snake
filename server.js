require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
let BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, ""); // если не задан — определяется через getMe при запуске
const REF_MODE = process.env.REF_MODE || "start"; // start: t.me/bot?start=ref_ID (работает всегда) | startapp: t.me/bot?startapp=ref_ID (нужно «основное Mini App» у бота)
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
// Публичный адрес сервиса (на Render подставляется автоматически) — нужен для вебхука бота и оплаты Stars
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const REMINDERS_ON = process.env.REMINDERS !== "off";
const REMINDER_HOUR = Number(process.env.REMINDER_HOUR || 18); // с этого часа (по DAILY_TZ) шлём напоминание о серии
const WEBHOOK_SECRET = BOT_TOKEN ? crypto.createHash("sha256").update("wh:" + BOT_TOKEN).digest("hex").slice(0, 48) : "";
const RUN_KEY = crypto.createHash("sha256").update("run:" + (BOT_TOKEN || "dev")).digest();

// Каталог скинов — единый источник правды. currency: coins — за монеты, stars — за Telegram Stars (XTR)
const SKIN_CATALOG = [
  { id: "classic", name: "Классика",  emoji: "🐍", price: 0,     currency: "coins" },
  { id: "fire",    name: "Огненная",  emoji: "🔥", price: 2000,  currency: "coins" },
  { id: "sakura",  name: "Сакура",    emoji: "🌸", price: 3000,  currency: "coins" },
  { id: "ocean",   name: "Океан",     emoji: "🌊", price: 4500,  currency: "coins" },
  { id: "ice",     name: "Ледяная",   emoji: "❄️", price: 5000,  currency: "coins" },
  { id: "toxic",   name: "Токсик",    emoji: "☣️", price: 7000,  currency: "coins" },
  { id: "sunset",  name: "Закат",     emoji: "🌅", price: 9000,  currency: "coins" },
  { id: "gold",    name: "Золотая",   emoji: "👑", price: 10000, currency: "coins" },
  { id: "cyber",   name: "Кибер",     emoji: "🤖", price: 20000, currency: "coins" },
  { id: "rainbow", name: "Радуга",    emoji: "🌈", price: 50,    currency: "stars", epic: true, desc: "Переливается всеми цветами" },
  { id: "galaxy",  name: "Галактика", emoji: "🌌", price: 100,   currency: "stars", epic: true, desc: "Мерцающие звёзды по телу" },
  { id: "inferno", name: "Дракон",    emoji: "🐲", price: 150,   currency: "stars", epic: true, desc: "Огонь и искры за хвостом" },
  { id: "diamond", name: "Алмаз",     emoji: "💎", price: 250,   currency: "stars", epic: true, desc: "Сверкающие грани и блики" }
];
const SKIN_BY_ID = Object.fromEntries(SKIN_CATALOG.map((s) => [s.id, s]));

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
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_nowalls INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_run_ts BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_reminded_day TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      charge_id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      skin TEXT NOT NULL,
      stars INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
    // запасной вариант: клиент сам прочитал tgWebAppStartParam из адреса (формат строго ref_<число>)
    const hdr = req.get("X-Start-Param") || "";
    if (!u.start_param && /^ref_\d{1,20}$/.test(hdr)) u.start_param = hdr;
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
  let refApplied = null;
  if (ins.rows[0]?.inserted) refApplied = await applyReferral(id, u.start_param, u.first_name || u.username || "Друг");
  const { rows } = await pool.query(
    `SELECT *,
            to_char(daily_bonus_claimed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS last_day,
            to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today,
            (SELECT first_name FROM players r WHERE r.telegram_id=players.referred_by) AS invited_by
     FROM players WHERE telegram_id=$1`,
    [id, DAILY_TZ]
  );
  if (rows[0]) rows[0].ref_applied = refApplied; // не колонка: кто пригласил, если реферал засчитан сейчас
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

// Возвращает id пригласившего, если реферал засчитан (иначе null).
async function applyReferral(newId, startParam, newName) {
  const m = /^ref_(\d{1,20})$/.exec(String(startParam || ""));
  if (!m || m[1] === newId) return null;
  const refId = m[1];
  const client = await pool.connect();
  let ok = false;
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
      ok = true;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("referral error", e);
    return null;
  } finally {
    client.release();
  }
  if (!ok) return null;
  // сообщаем пригласившему (не критично, если бот ему писать не может)
  if (BOT_TOKEN) {
    tgApi("sendMessage", {
      chat_id: refId,
      text: `🎉 ${newName} присоединился по твоей ссылке!\nТебе +${REF_REWARD} 🪙, а другу +${REF_BONUS} 🪙`
    }).catch(() => {});
  }
  return refId;
}

function refLink(id) {
  if (!BOT_USERNAME) return "";
  if (APP_SHORT_NAME) return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=ref_${id}`;
  if (REF_MODE === "startapp") return `https://t.me/${BOT_USERNAME}?startapp=ref_${id}`;
  return `https://t.me/${BOT_USERNAME}?start=ref_${id}`;
}

function responsePlayer(p) {
  if (!p) return p;
  return {
    ...p,
    ref_link: refLink(p.telegram_id),
    invited_by: p.invited_by || null,
    daily: dailyInfo(p),
    skins: SKIN_CATALOG,
    stars_enabled: !!BOT_TOKEN,
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

// Кого я пригласил
app.get("/api/referrals", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  try {
    const { rows } = await pool.query(
      `SELECT first_name, username, created_at FROM players WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 100`,
      [String(u.id)]
    );
    res.json({ friends: rows.map((r) => ({ name: r.first_name || r.username || "Игрок", username: r.username || "", joined: r.created_at })), reward: REF_REWARD });
  } catch (e) {
    console.error(e);
    res.status(500).json({ friends: [] });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const u = telegramUser(req);
    const { rows } = await pool.query(
      `SELECT telegram_id,username,first_name,best_score,coins,skin
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

// ---- Базовая проверка забега: сервер выдаёт подписанный токен при старте, а при финише
// сверяет заявленные очки с реально прошедшим временем. Не идеальная защита, но убирает
// «отправку 575 очков за секунду» и повторную отправку одного забега.
function makeRunToken(uid) {
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", RUN_KEY).update(`${ts}.${uid}`).digest("hex").slice(0, 32);
  return `${ts}.${sig}`;
}
function parseRunToken(token, uid) {
  const m = /^(\d{10,15})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const ts = Number(m[1]);
  const sig = crypto.createHmac("sha256", RUN_KEY).update(`${ts}.${uid}`).digest("hex").slice(0, 32);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2]))) return null;
  const age = Date.now() - ts;
  if (age < 0 || age > 6 * 3600 * 1000) return null;
  return { ts, age };
}

app.post("/api/run", (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  res.json({ token: makeRunToken(u.id) });
});

app.post("/api/score", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });

  try {
    const p = await getPlayer(u);
    const body = req.body || {};
    const mode = body.mode === "nowalls" ? "nowalls" : "classic";

    // токен забега: одноразовый, подписанный, не старше 6 часов
    let validTicks = 0;
    const run = parseRunToken(body.token, u.id);
    if (run) {
      const claim = await pool.query(
        `UPDATE players SET last_run_ts=$1 WHERE telegram_id=$2 AND last_run_ts<$1 RETURNING 1`,
        [run.ts, String(u.id)]
      );
      if (claim.rowCount) {
        const ticks = Math.max(0, Math.floor(Number(body.ticks) || 0));
        validTicks = Math.min(ticks, Math.floor(run.age / 30)); // быстрее ~30 мс/ход игра не идёт (с учётом раннего хода при повороте)
      }
    }
    const maxApples = Math.floor(validTicks / 3) + 1;
    const apples = Math.max(0, Math.min(maxApples, Math.floor(Number(body.apples) || 0)));
    // максимум очков за яблоко: золото 5 × комбо 5 × бонус ×2 = 50
    const score = Math.max(0, Math.min(3000, apples * 50, Math.floor(Number(body.score) || 0)));
    // До ~15 монет за очко (золото) + бонус 100; без валидного забега — минимум
    const coinCap = validTicks ? score * 16 + 110 : 10;
    const coins = Math.max(0, Math.min(coinCap, Math.floor(Number(body.coins) || 0)));

    const ms = missionState(p);
    ms.score = Math.max(ms.score, score);
    if (score >= 1) ms.games += 1;
    ms.apples += apples;

    await pool.query(
      `UPDATE players
       SET best_score=GREATEST(best_score,$1),
           best_nowalls=GREATEST(best_nowalls,$5),
           coins=coins+$2,
           missions=$4::jsonb,
           updated_at=NOW()
       WHERE telegram_id=$3`,
      [mode === "classic" ? score : 0, coins, String(u.id), JSON.stringify(ms), mode === "nowalls" ? score : 0]
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

  const skin = String(req.body?.skin || "");
  const def = SKIN_BY_ID[skin];
  if (!def) return res.status(400).json({ error: "Bad skin" });

  try {
    const p = await getPlayer(u);
    const owned = Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"];

    if (!owned.includes(skin)) {
      if (def.currency === "stars") return res.status(402).json({ error: "Buy with Telegram Stars" });
      const r = await pool.query(
        `UPDATE players
         SET coins=coins-$1,
             skin=$2,
             owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$2]::TEXT[])),
             updated_at=NOW()
         WHERE telegram_id=$3 AND coins>=$1
         RETURNING 1`,
        [def.price, skin, String(u.id)]
      );
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
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

// ================= Telegram Bot API / Stars =================
async function tgApi(method, params) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not set");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {})
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}

// Создаёт ссылку на счёт в Stars. Клиент открывает её через Telegram.WebApp.openInvoice
app.post("/api/invoice", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  const def = SKIN_BY_ID[String(req.body?.skin || "")];
  if (!def || def.currency !== "stars") return res.status(400).json({ error: "Bad skin" });
  try {
    const p = await getPlayer(u);
    if ((p.owned_skins || []).includes(def.id)) return res.status(400).json({ error: "Already owned" });
    const url = await tgApi("createInvoiceLink", {
      title: `Скин «${def.name}»`,
      description: `${def.emoji} ${def.desc || "Эпический скин змейки"} — навсегда в Snake Arena`,
      payload: `skin:${def.id}:${u.id}`,
      currency: "XTR", // Telegram Stars; provider_token для Stars не нужен
      prices: [{ label: def.name, amount: def.price }]
    });
    res.json({ url });
  } catch (e) {
    console.error("invoice error", e.message);
    res.status(500).json({ error: "Invoice error" });
  }
});

function parseSkinPayload(payload, userId) {
  const m = /^skin:([a-z]+):(\d+)$/.exec(String(payload || ""));
  if (!m || m[2] !== String(userId)) return null;
  const def = SKIN_BY_ID[m[1]];
  return def && def.currency === "stars" ? def : null;
}

async function grantPaidSkin(userId, def, chargeId, stars) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO players (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING`, [String(userId)]);
    // charge_id уникален — повторная доставка вебхука не выдаст скин дважды
    const ins = await client.query(
      `INSERT INTO payments (charge_id, telegram_id, skin, stars) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1`,
      [chargeId, String(userId), def.id, stars]
    );
    if (ins.rowCount) {
      await client.query(
        `UPDATE players
         SET skin=$1, owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])), updated_at=NOW()
         WHERE telegram_id=$2`,
        [def.id, String(userId)]
      );
    }
    await client.query("COMMIT");
    return !!ins.rowCount;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function handleUpdate(upd) {
  // 1) Telegram спрашивает «можно ли списать?» — отвечаем за 10 секунд
  if (upd.pre_checkout_query) {
    const q = upd.pre_checkout_query;
    const def = parseSkinPayload(q.invoice_payload, q.from?.id);
    const ok = !!def && q.currency === "XTR" && Number(q.total_amount) === def.price;
    await tgApi("answerPreCheckoutQuery", ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: "Не удалось подтвердить заказ, попробуй ещё раз" });
    return;
  }
  const m = upd.message;
  if (!m) return;
  // 2) Платёж прошёл — выдаём скин
  if (m.successful_payment) {
    const sp = m.successful_payment;
    const def = parseSkinPayload(sp.invoice_payload, m.from?.id);
    if (!def || sp.currency !== "XTR" || Number(sp.total_amount) !== def.price) {
      console.error("suspicious payment", JSON.stringify(sp));
      return;
    }
    const fresh = await grantPaidSkin(m.from.id, def, sp.telegram_payment_charge_id, def.price);
    if (fresh) await tgApi("sendMessage", { chat_id: m.chat.id, text: `${def.emoji} Скин «${def.name}» твой! Он уже надет — запускай игру 🐍` }).catch(() => {});
    return;
  }
  // 3) /start [ref_ID] — регистрируем игрока, засчитываем реферал и даём кнопку запуска игры
  if (typeof m.text === "string" && /^\/start(\s|$)/.test(m.text) && m.from?.id) {
    const param = m.text.split(/\s+/)[1] || "";
    const pl = await getPlayer({ id: m.from.id, username: m.from.username, first_name: m.from.first_name, start_param: param });
    let text = "🐍 Snake Arena — собирай яблоки, копи серию, бей рекорды!";
    if (pl?.ref_applied) text = `🎉 Тебя пригласил${pl.invited_by ? " " + pl.invited_by : " друг"} — тебе уже начислено +${REF_BONUS} 🪙!\n\n` + text;
    await tgApi("sendMessage", {
      chat_id: m.chat.id,
      text,
      reply_markup: PUBLIC_URL ? { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: PUBLIC_URL } }]] } : undefined
    }).catch(() => {});
  }
}

app.post("/telegram/webhook", (req, res) => {
  if (!WEBHOOK_SECRET || req.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) return res.sendStatus(403);
  res.sendStatus(200);
  handleUpdate(req.body || {}).catch((e) => console.error("webhook error", e.message));
});

async function setupWebhook() {
  if (!BOT_TOKEN) return console.warn("BOT_TOKEN не задан — Stars и бот отключены");
  if (!PUBLIC_URL) return console.warn("PUBLIC_URL не задан — вебхук бота не установлен, оплата Stars не будет завершаться. Укажи PUBLIC_URL (https://твой-сервис.onrender.com)");
  try {
    await tgApi("setWebhook", {
      url: `${PUBLIC_URL}/telegram/webhook`,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ["message", "pre_checkout_query"]
    });
    console.log("Telegram webhook set:", `${PUBLIC_URL}/telegram/webhook`);
  } catch (e) {
    console.error("setWebhook failed:", e.message);
  }
}

// ================= Напоминания о серии =================
// Если игрок забрал награду вчера, а сегодня ещё нет — вечером шлём одно сообщение от бота.
async function runReminders() {
  if (!REMINDERS_ON || !BOT_TOKEN) return;
  try {
    const { rows } = await pool.query(
      `SELECT telegram_id, daily_streak FROM players
       WHERE daily_streak>0
         AND EXTRACT(HOUR FROM NOW() AT TIME ZONE $1) >= $2
         AND to_char(daily_bonus_claimed_at AT TIME ZONE $1,'YYYY-MM-DD') = to_char((NOW() AT TIME ZONE $1)::date - 1,'YYYY-MM-DD')
         AND (last_reminded_day IS NULL OR last_reminded_day <> to_char(NOW() AT TIME ZONE $1,'YYYY-MM-DD'))
       LIMIT 200`,
      [DAILY_TZ, REMINDER_HOUR]
    );
    for (const r of rows) {
      await pool.query(
        `UPDATE players SET last_reminded_day=to_char(NOW() AT TIME ZONE $1,'YYYY-MM-DD') WHERE telegram_id=$2`,
        [DAILY_TZ, r.telegram_id]
      );
      await tgApi("sendMessage", {
        chat_id: r.telegram_id,
        text: `🔥 Твоя серия — ${r.daily_streak} дн.! Загляни в Snake Arena сегодня, иначе она сбросится.`,
        reply_markup: PUBLIC_URL ? { inline_keyboard: [[{ text: "🎁 Забрать награду", web_app: { url: PUBLIC_URL } }]] } : undefined
      }).catch(() => {}); // игрок мог не запускать бота или заблокировать его — это нормально
      await new Promise((ok) => setTimeout(ok, 60)); // лимит Telegram ~30 сообщений/сек
    }
  } catch (e) {
    console.error("reminders error", e.message);
  }
}

async function start() {
  try {
    await initDb();
    await pool.query("SELECT 1");
    app.listen(PORT, "0.0.0.0", () => console.log(`Snake Arena running on ${PORT} with PostgreSQL`));
    if (!BOT_USERNAME && BOT_TOKEN) {
      try { BOT_USERNAME = (await tgApi("getMe")).username || ""; console.log("BOT_USERNAME определён автоматически:", BOT_USERNAME); }
      catch (e) { console.warn("getMe failed:", e.message); }
    }
    setupWebhook();
    if (REMINDERS_ON && BOT_TOKEN) setInterval(runReminders, 20 * 60 * 1000).unref();
  } catch (e) {
    console.error("Database initialization failed:", e);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
process.on("SIGINT", async () => { await pool.end(); process.exit(0); });

start();
