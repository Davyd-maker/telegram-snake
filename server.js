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
const ADMIN_IDS = new Set(String(process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(x=>x.trim()).filter(Boolean));

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
  { id: "diamond", name: "Алмаз",     emoji: "💎", price: 250,   currency: "stars", epic: true, desc: "Сверкающие грани и блики" },
  { id: "aurora", name: "Аврора", emoji: "🌠", price: 120, currency: "stars", epic: true, desc: "Северное сияние переливается по телу" },
  { id: "samurai", name: "Самурай", emoji: "⚔️", price: 180, currency: "stars", epic: true, desc: "Алый клинок и искры за хвостом" },
  { id: "void", name: "Пустота", emoji: "🕳️", price: 220, currency: "stars", epic: true, desc: "Тёмная энергия и фиолетовое свечение" },
  { id: "prism", name: "Призма", emoji: "🔷", price: 300, currency: "stars", epic: true, desc: "Радужные грани и кристальные вспышки" },
  { id: "season_champion", name: "Корона сезона", emoji: "👑", price: null, currency: "season", epic: true, seasonRank: 1, desc: "Эксклюзив за 1-е место сезона" },
  { id: "season_elite", name: "Фантом сезона", emoji: "👻", price: null, currency: "season", epic: true, seasonRank: 3, desc: "Эксклюзив за топ-3 сезона" },
  { id: "season_master", name: "Неоновый мастер", emoji: "⚡", price: null, currency: "season", epic: true, seasonRank: 10, desc: "Эксклюзив за топ-10 сезона" }
];
const SKIN_BY_ID = Object.fromEntries(SKIN_CATALOG.map((s) => [s.id, s]));
const ARTIFACT_CATALOG = [
  { id:"magnet", name:"Магнит", emoji:"🧲", rarity:"rare", desc:"Подтягивает еду, если она в 2 клетках по прямой.", color:"#55d6ff" },
  { id:"berserk", name:"Берсерк", emoji:"🔥", rarity:"epic", desc:"После 3+ комбо каждый следующий предмет даёт +25% очков.", color:"#ff7a32" },
  { id:"phantom", name:"Фантом", emoji:"👻", rarity:"legendary", desc:"Один раз за забег спасает от столкновения со стеной или телом.", color:"#b48cff" }
];
const ARTIFACT_BY_ID = Object.fromEntries(ARTIFACT_CATALOG.map(a=>[a.id,a]));
// Скин недели: палитра зависит только от даты начала недели (понедельник, UTC), поэтому id и цвета
// восстанавливаются без БД — прошлые недельные скины остаются доступными тем, кто их получил.
const WEEKLY_PALETTES = [
  ["#9affd0","#00a878","🌿","Нефритовый дух"],["#ffd1ef","#ff4f9a","🌸","Розовый комет"],
  ["#c8f5ff","#247cff","🌊","Лазурный шторм"],["#fff0a8","#ff7a00","☀️","Солнечный рейдер"],
  ["#e2c7ff","#713cff","🔮","Астральный кристалл"],["#d8ff8b","#39a900","☣️","Токсичный спектр"],
  ["#ffffff","#9ca8ff","🌙","Лунный призрак"],["#ffb4a8","#d71920","🌹","Алый феникс"]
];
function weeklySkinForDate(ymd){ // ymd = "YYYYMMDD"
  const t = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8));
  const q = WEEKLY_PALETTES[((Math.floor(t/604800000) % 8) + 8) % 8];
  return { id:`weekly_${ymd}`, name:`${q[3]} · ${ymd.slice(6,8)}.${ymd.slice(4,6)}`, emoji:q[2], price:null, currency:"season", epic:true, weekly:true,
           desc:"Уникальный скин недели. После окончания сезона получить его нельзя.", palette:q.slice(0,2) };
}
function weeklySkinFor(season){
  const d = new Date(season?.starts_at || currentSeasonBounds().starts);
  return weeklySkinForDate(d.toISOString().slice(0,10).replaceAll("-",""));
}
function weeklySkinById(id){
  const m = /^weekly_(\d{8})$/.exec(String(id||""));
  return m ? weeklySkinForDate(m[1]) : null;
}
function skinDef(id){ return SKIN_BY_ID[id] || weeklySkinById(id) || null; }
// стиль головы для рейтинга: цвета берём из каталога, у недельных — из палитры
function skinPalette(id){ const w=weeklySkinById(id); return w ? w.palette : null; }

// Каталог игровых полей. Все «красивые» поля покупаются за Telegram Stars,
// одно простое («Графит») — за 25 000 монет. Цены меняй здесь.
const FIELD_CATALOG = [
  { id: "classic",  name: "Классика", emoji: "🟩", price: 0,     currency: "coins", desc: "Стандартное зелёное поле" },
  { id: "graphite", name: "Графит",   emoji: "⬛", price: 25000, currency: "coins", desc: "Простое тёмное поле" },
  { id: "neon",     name: "Неон",     emoji: "🌃", price: 50,    currency: "stars", epic: true, desc: "Светящаяся сетка и сканер" },
  { id: "frost",    name: "Мороз",    emoji: "❄️", price: 75,    currency: "stars", epic: true, desc: "Ледяное поле, идёт снег" },
  { id: "desert",   name: "Пустыня",  emoji: "🏜️", price: 75,    currency: "stars", epic: true, desc: "Тёплый песок и закат" },
  { id: "lava",     name: "Лава",     emoji: "🌋", price: 100,   currency: "stars", epic: true, desc: "Жар поднимается снизу" },
  { id: "space",    name: "Космос",   emoji: "🌌", price: 150,   currency: "stars", epic: true, desc: "Мерцающие звёзды" },
  { id: "aurora_field", name: "Аврора", emoji: "🎇", price: 110, currency: "stars", epic: true, desc: "Сияющие волны северного света" },
  { id: "cyber_field", name: "Киберпанк", emoji: "🏙️", price: 130, currency: "stars", epic: true, desc: "Неоновый мегаполис и сканирующая сетка" },
  { id: "volcano_field", name: "Вулкан", emoji: "🔥", price: 175, currency: "stars", epic: true, desc: "Лава, пепел и раскалённые трещины" },
  { id: "crystal_field", name: "Кристалл", emoji: "💠", price: 220, currency: "stars", epic: true, desc: "Кристаллическая арена с сиянием" }
];
const FIELD_BY_ID = Object.fromEntries(FIELD_CATALOG.map((f) => [f.id, f]));

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
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS field_skin TEXT NOT NULL DEFAULT 'classic'`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS owned_fields TEXT[] NOT NULL DEFAULT ARRAY['classic']::TEXT[]`);
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
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS achievements JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS weekly JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS total_apples INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_combo INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS owned_artifacts TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS equipped_artifact TEXT NOT NULL DEFAULT 'magnet'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS seasons (id SERIAL PRIMARY KEY, name TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS season_scores (season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, telegram_id TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(season_id,telegram_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, creator_score INTEGER NOT NULL, accepted_by TEXT, accepted_score INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
  // уникальность сезона по дате старта (дубликаты, если были, убираем — оставляем самый старый)
  try {
    await pool.query(`DELETE FROM seasons a USING seasons b WHERE a.starts_at=b.starts_at AND a.id>b.id`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS seasons_starts_at_uq ON seasons(starts_at)`);
  } catch (e) { console.warn("seasons index:", e.message); }
  await pool.query(`CREATE INDEX IF NOT EXISTS players_best_idx ON players (best_score DESC, coins DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS season_scores_rank_idx ON season_scores (season_id, score DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS players_referred_idx ON players (referred_by)`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`UPDATE players SET owned_skins=ARRAY['classic']::TEXT[] WHERE owned_skins IS NULL OR cardinality(owned_skins)=0`);
  await pool.query(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY['classic']::TEXT[])) WHERE NOT ('classic' = ANY(owned_skins))`);
  await pool.query(`UPDATE players SET owned_fields=ARRAY['classic']::TEXT[] WHERE owned_fields IS NULL OR cardinality(owned_fields)=0`);
  await pool.query(`UPDATE players SET owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY['classic']::TEXT[])) WHERE NOT ('classic' = ANY(owned_fields))`);
  await pool.query(`UPDATE players SET owned_artifacts=ARRAY['magnet']::TEXT[] WHERE owned_artifacts IS NULL OR cardinality(owned_artifacts)=0`);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

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
  const row = rows[0];
  if (row) {
    row.ref_applied = refApplied; // не колонка: кто пригласил, если реферал засчитан сейчас
    // артефакты открываются по уровню: 🔥 с 3-го, 👻 с 7-го
    const lvl = levelInfo(row.xp || 0).level;
    const auto = ["magnet", ...(lvl >= 3 ? ["berserk"] : []), ...(lvl >= 7 ? ["phantom"] : [])];
    const have = Array.isArray(row.owned_artifacts) ? row.owned_artifacts : [];
    const merged = Array.from(new Set([...have, ...auto]));
    if (merged.length !== have.length) {
      await pool.query(`UPDATE players SET owned_artifacts=$1::text[] WHERE telegram_id=$2`, [merged, id]);
      row.owned_artifacts = merged;
    }
  }
  return row;
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


function currentSeasonBounds(now=new Date()) {
  const d = new Date(now); const day = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)));
  const starts = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  const ends = new Date(starts); ends.setUTCDate(ends.getUTCDate()+7); return {starts,ends};
}
async function ensureSeason() {
  const {starts,ends}=currentSeasonBounds();
  // ON CONFLICT: два одновременных запроса в начале недели не создадут два сезона
  await pool.query(`INSERT INTO seasons(name,starts_at,ends_at) VALUES($1,$2,$3) ON CONFLICT (starts_at) DO NOTHING`,[`Неделя ${starts.toISOString().slice(0,10)}`,starts,ends]);
  const r=await pool.query(`SELECT * FROM seasons WHERE starts_at=$1 LIMIT 1`,[starts]);
  return r.rows[0];
}
function levelInfo(xp=0){ const x=Math.max(0,Number(xp)||0); const level=Math.floor(Math.sqrt(x/100))+1; const cur=(level-1)*(level-1)*100, next=level*level*100; return {level,xp:x,current:cur,next,progress:Math.min(100,Math.round((x-cur)/(next-cur)*100))}; }
const ACHIEVEMENTS=[
 {id:'first',icon:'🐣',title:'Первый забег',need:p=>p.games>=1,reward:250},
 {id:'apples100',icon:'🍎',title:'100 яблок',need:p=>p.total_apples>=100,reward:500},
 {id:'score500',icon:'🔥',title:'500 очков',need:p=>p.best_score>=500,reward:750},
 {id:'combo5',icon:'⚡',title:'Комбо ×5',need:p=>p.best_combo>=5,reward:1000},
 {id:'friends5',icon:'👥',title:'5 друзей',need:p=>p.referrals>=5,reward:1500}
];
function achStats(p){return {games:Number(p.games_played||0),total_apples:Number(p.total_apples||0),best_score:Number(p.best_score||0),best_combo:Number(p.best_combo||0),referrals:Number(p.referrals||0)};}
function achievementList(p){const a=p.achievements||{},st=achStats(p);return ACHIEVEMENTS.map(({need,...x})=>({...x,claimed:!!a[x.id],ready:!!need(st)}));}

function seasonRewards(season){
  const weekly=weeklySkinFor(season);
  return [
    {rank:1, icon:weekly.emoji, title:weekly.name, skin:weekly.id, extra:["season_champion"], coins:6000, label:"Топ-1 · скин недели + Корона сезона"},
    {rank:3, icon:"👻", title:"Фантом сезона", skin:"season_elite", extra:[], coins:3000, label:"Топ-3"},
    {rank:10, icon:"⚡", title:"Неоновый мастер", skin:"season_master", extra:[], coins:1500, label:"Топ-10"}
  ].map(x=>({...x,season_id:season.id,weekly:x.skin===weekly.id}));
}
// Каталог скинов игрока: общий + скин текущей недели + прошлые недельные, которые он уже получил
function catalogFor(p) {
  const now = weeklySkinFor({ starts_at: currentSeasonBounds().starts });
  const extra = (Array.isArray(p.owned_skins) ? p.owned_skins : [])
    .filter((id) => id !== now.id).map(weeklySkinById).filter(Boolean);
  return [...SKIN_CATALOG, now, ...extra];
}
function responsePlayer(p) {
  if (!p) return p;
  return {
    ...p,
    ref_link: refLink(p.telegram_id),
    invited_by: p.invited_by || null,
    daily: dailyInfo(p),
    skins: catalogFor(p),
    artifacts: ARTIFACT_CATALOG,
    owned_artifacts: Array.isArray(p.owned_artifacts) && p.owned_artifacts.length ? p.owned_artifacts : ["magnet"],
    equipped_artifact: ARTIFACT_BY_ID[p.equipped_artifact] ? p.equipped_artifact : "magnet",
    fields: FIELD_CATALOG,
    field_skin: FIELD_BY_ID[p.field_skin] ? p.field_skin : "classic",
    stars_enabled: !!BOT_TOKEN,
    missions: missionList(p),
    ref_reward: REF_REWARD,
    ref_bonus: REF_BONUS,
    owned_skins: Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"],
    owned_fields: Array.isArray(p.owned_fields) && p.owned_fields.length ? p.owned_fields : ["classic"],
    level: levelInfo(p.xp||0), achievements_list: achievementList(p), xp: Number(p.xp||0), games_played:Number(p.games_played||0), total_apples:Number(p.total_apples||0), best_combo:Number(p.best_combo||0), season_score:Number(p.season_score||0), season:p.season||null
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
    const season=await ensureSeason(); const sr=await pool.query(`SELECT score FROM season_scores WHERE season_id=$1 AND telegram_id=$2`,[season.id,String(u.id)]);
    p.season_score=sr.rows[0]?.score||0; p.season={...season,number:await seasonNumber(season.starts_at)};
    p.season_rank=(await seasonRank(season.id,String(u.id)))?.rank||null;
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
      `SELECT telegram_id,username,first_name,best_score,skin
       FROM players
       WHERE best_score>0
       ORDER BY best_score DESC, coins DESC, telegram_id
       LIMIT 20`
    );
    let me = null;
    if (u) {
      const r = await pool.query(`SELECT best_score,coins FROM players WHERE telegram_id=$1`, [String(u.id)]);
      if (r.rows[0] && r.rows[0].best_score > 0) {
        const { best_score, coins } = r.rows[0];
        const rk = await pool.query(
          `SELECT COUNT(*)::int+1 AS rank FROM players WHERE best_score>$1 OR (best_score=$1 AND coins>$2)`,
          [best_score, coins]
        );
        me = { rank: rk.rows[0].rank, best_score };
      }
    }
    res.json({
      leaderboard: rows.map((x) => ({
        name: x.first_name || x.username || "Игрок",
        best_score: x.best_score,
        skin: skinDef(x.skin) ? x.skin : "classic",
        palette: skinPalette(x.skin),
        is_me: !!u && x.telegram_id === String(u.id)
      })),
      me
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ leaderboard: [] });
  }
});

// Последний завершённый сезон (за него можно забрать награду)
async function previousSeason() {
  const r = await pool.query(`SELECT * FROM seasons WHERE ends_at<=NOW() ORDER BY ends_at DESC LIMIT 1`);
  return r.rows[0] || null;
}
// Порядковый номер сезона (по дате старта) — id в таблице может иметь пропуски
async function seasonNumber(startsAt) {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM seasons WHERE starts_at<=$1`, [startsAt]);
  return r.rows[0].n;
}
async function seasonRank(seasonId, uid) {
  const r = await pool.query(`SELECT score FROM season_scores WHERE season_id=$1 AND telegram_id=$2`, [seasonId, uid]);
  if (!r.rows[0] || !(r.rows[0].score > 0)) return null;
  const q = await pool.query(`SELECT COUNT(*)::int+1 AS rank FROM season_scores WHERE season_id=$1 AND score>$2`, [seasonId, r.rows[0].score]);
  return { rank: q.rows[0].rank, score: r.rows[0].score };
}

app.get("/api/season", async (req, res) => {
  try {
    const u = telegramUser(req);
    const season = await ensureSeason();
    const { rows } = await pool.query(
      `SELECT ss.score, ss.telegram_id, p.first_name, p.username, p.skin
       FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
       WHERE ss.season_id=$1 AND ss.score>0
       ORDER BY ss.score DESC, ss.telegram_id LIMIT 20`,
      [season.id]
    );
    let me = null, claim = null;
    if (u) {
      me = await seasonRank(season.id, String(u.id));
      const prev = await previousSeason();
      if (prev) {
        const pr = await seasonRank(prev.id, String(u.id));
        const reward = pr && seasonRewards(prev).find((x) => pr.rank <= x.rank);
        if (reward) {
          const { rows: pl } = await pool.query(`SELECT achievements FROM players WHERE telegram_id=$1`, [String(u.id)]);
          const done = !!(pl[0]?.achievements || {})[`season:${prev.id}:${reward.skin}`];
          claim = { season_id: prev.id, season_name: prev.name, rank: pr.rank, reward, claimed: done };
        }
      }
    }
    const number = await seasonNumber(season.starts_at);
    res.json({
      season: { ...season, number },
      leaderboard: rows.map((x) => ({
        name: x.first_name || x.username || "Игрок",
        score: x.score,
        skin: skinDef(x.skin) ? x.skin : "classic",
        palette: skinPalette(x.skin),
        is_me: !!u && x.telegram_id === String(u.id)
      })),
      me, claim, rewards: seasonRewards(season)
    });
  } catch (e) { console.error(e); res.status(500).json({ leaderboard: [] }); }
});

// История сезонов игрока: его место и очки в каждом закончившемся сезоне
app.get("/api/season/history", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.starts_at, s.ends_at, ss.score,
              (SELECT COUNT(*)::int FROM seasons x WHERE x.starts_at<=s.starts_at) AS number,
              (SELECT COUNT(*)::int+1 FROM season_scores o WHERE o.season_id=s.id AND o.score>ss.score) AS rank,
              (SELECT COUNT(*)::int FROM season_scores o WHERE o.season_id=s.id AND o.score>0) AS players
       FROM seasons s JOIN season_scores ss ON ss.season_id=s.id AND ss.telegram_id=$1 AND ss.score>0
       WHERE s.ends_at<=NOW() ORDER BY s.starts_at DESC LIMIT 30`, [String(u.id)]);
    res.json({ history: rows });
  } catch (e) { console.error(e); res.status(500).json({ history: [] }); }
});

// Награда за прошлый (уже закончившийся) сезон. Раньше проверялся текущий сезон, который по определению не закончен — награду нельзя было забрать.
app.post("/api/season/claim", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  const client = await pool.connect();
  try {
    await getPlayer(u);
    const prev = await previousSeason();
    if (!prev) return res.status(400).json({ error: "No finished season" });
    const pr = await seasonRank(prev.id, String(u.id));
    const reward = pr && seasonRewards(prev).find((x) => pr.rank <= x.rank);
    if (!reward) return res.status(400).json({ error: "No reward" });
    const key = `season:${prev.id}:${reward.skin}`;
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT achievements FROM players WHERE telegram_id=$1 FOR UPDATE`, [String(u.id)]);
    const ach = rows[0]?.achievements || {};
    if (ach[key]) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Already claimed", player: responsePlayer(await getPlayer(u)) }); }
    ach[key] = true;
    const skins = [reward.skin, ...(reward.extra || [])];
    await client.query(
      `UPDATE players SET achievements=$1::jsonb, coins=coins+$2, xp=xp+$2,
         owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || $3::text[])), skin=$4, updated_at=NOW()
       WHERE telegram_id=$5`,
      [JSON.stringify(ach), reward.coins, skins, reward.skin, String(u.id)]
    );
    await client.query("COMMIT");
    res.json({ reward, rank: pr.rank, player: responsePlayer(await getPlayer(u)) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e); res.status(500).json({ error: "Database error" });
  } finally { client.release(); }
});

app.get('/api/achievements',async(req,res)=>{const u=telegramUser(req);if(!u)return res.status(401).json({error:'Telegram authorization required'});try{const p=await getPlayer(u);res.json({achievements:achievementList(p)})}catch(e){res.status(500).json({achievements:[]})}});
app.post('/api/achievement',async(req,res)=>{const u=telegramUser(req);if(!u)return res.status(401).json({error:'Telegram authorization required'});const def=ACHIEVEMENTS.find(x=>x.id===String(req.body?.id));if(!def)return res.status(400).json({error:'Bad achievement'});try{const p=await getPlayer(u);const a=p.achievements||{}; if(a[def.id])return res.status(400).json({error:'Already claimed',player:responsePlayer(p)}); const stats=achStats(p); if(!def.need(stats))return res.status(400).json({error:'Not ready',player:responsePlayer(p)});a[def.id]=true;await pool.query(`UPDATE players SET achievements=$1::jsonb,coins=coins+$2,xp=xp+$2 WHERE telegram_id=$3`,[JSON.stringify(a),def.reward,String(u.id)]);res.json({reward:def.reward,player:responsePlayer(await getPlayer(u))})}catch(e){console.error(e);res.status(500).json({error:'Database error'})}});
app.get('/api/artifacts', async (req,res)=>{
  const u=telegramUser(req); if(!u)return res.status(401).json({error:'Telegram authorization required'});
  try{ const p=await getPlayer(u); res.json({artifacts:ARTIFACT_CATALOG,owned:p.owned_artifacts||['magnet'],equipped:p.equipped_artifact||'magnet'}); }
  catch(e){res.status(500).json({error:'Database error'});}
});
app.post('/api/artifact/equip', async(req,res)=>{
  const u=telegramUser(req); if(!u)return res.status(401).json({error:'Telegram authorization required'});
  const id=String(req.body?.id||''); if(!ARTIFACT_BY_ID[id])return res.status(400).json({error:'Bad artifact'});
  try{ const p=await getPlayer(u); const owned=p.owned_artifacts||['magnet']; if(!owned.includes(id))return res.status(403).json({error:'Artifact not owned'}); await pool.query(`UPDATE players SET equipped_artifact=$1,updated_at=NOW() WHERE telegram_id=$2`,[id,String(u.id)]); res.json({ok:true,player:responsePlayer(await getPlayer(u))}); }
  catch(e){console.error(e);res.status(500).json({error:'Database error'});}
});

// ---- Вызовы друзьям: результат проверяется сервером вместе с забегом (см. /api/score)
function challengeLink(id) {
  if (!BOT_USERNAME) return PUBLIC_URL ? `${PUBLIC_URL}/?challenge=${id}` : "";
  if (APP_SHORT_NAME) return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=ch_${id}`;
  if (REF_MODE === "startapp") return `https://t.me/${BOT_USERNAME}?startapp=ch_${id}`;
  return `https://t.me/${BOT_USERNAME}?start=ch_${id}`;
}
app.get("/api/challenge/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.creator_score, c.expires_at, p.first_name AS creator_name FROM challenges c
       LEFT JOIN players p ON p.telegram_id=c.creator_id WHERE c.id=$1 AND c.expires_at>NOW()`, [String(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: "Challenge not found" });
    res.json({ challenge: r.rows[0] });
  } catch (e) { res.status(500).json({ error: "Database error" }); }
});
app.post("/api/challenge", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });
  try {
    const p = await getPlayer(u);
    // вызвать можно только результатом, который у игрока реально есть
    const score = Math.max(0, Math.min(3000, Math.floor(Number(req.body?.score) || 0), Number(p.best_score) || 0));
    if (!score) return res.status(400).json({ error: "Bad score" });
    const id = crypto.randomBytes(5).toString("hex");
    await pool.query(`INSERT INTO challenges(id,creator_id,creator_score,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '48 hours')`, [id, String(u.id), score]);
    res.json({ id, score, link: challengeLink(id) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Database error" }); }
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

    const bestRun = Math.max(0, Math.min(500, Math.floor(Number(body.combo) || 0), apples));
    const ms = missionState(p);
    ms.score = Math.max(ms.score, score);
    if (score >= 1) ms.games += 1;
    ms.apples += apples;

    const gainedXp=Math.max(5,Math.floor(score/2)+apples*3);
    await pool.query(
      `UPDATE players SET best_score=GREATEST(best_score,$1), best_nowalls=GREATEST(best_nowalls,$5), coins=coins+$2, missions=$4::jsonb, xp=xp+$6, games_played=games_played+$7, total_apples=total_apples+$8, best_combo=GREATEST(best_combo,$9), updated_at=NOW() WHERE telegram_id=$3`,
      [mode === "classic" ? score : 0, coins, String(u.id), JSON.stringify(ms), mode === "nowalls" ? score : 0, gainedXp, score>0?1:0, apples, bestRun]
    );
    if(mode==='classic' && score>0){ const season=await ensureSeason(); await pool.query(`INSERT INTO season_scores(season_id,telegram_id,score) VALUES($1,$2,$3) ON CONFLICT(season_id,telegram_id) DO UPDATE SET score=GREATEST(season_scores.score,EXCLUDED.score)`,[season.id,String(u.id),score]); }

    // вызов друга: результат засчитывается по проверенным очкам забега
    let challenge_result = null;
    const cid = String(body.challenge || "");
    if (/^[0-9a-f]{10}$/.test(cid) && mode === "classic" && score > 0) {
      const cr = await pool.query(
        `UPDATE challenges SET accepted_by=$1, accepted_score=$2
         WHERE id=$3 AND expires_at>NOW() AND accepted_by IS NULL AND creator_id<>$1
         RETURNING creator_id, creator_score`,
        [String(u.id), score, cid]
      );
      if (cr.rowCount) {
        const c = cr.rows[0], win = score > c.creator_score;
        challenge_result = { win, creator_score: c.creator_score, score };
        if (BOT_TOKEN) tgApi("sendMessage", {
          chat_id: c.creator_id,
          text: `⚔️ ${p.first_name || "Друг"} принял твой вызов: ${score} против ${c.creator_score}.\n${win ? "Он победил — отыграйся! 🐍" : "Ты победил! 🏆"}`
        }).catch(() => {});
      }
    }

    const updated = await getPlayer(u);
    res.json({ player: responsePlayer(updated), bot_username: BOT_USERNAME, challenge_result });
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
  const def = skinDef(skin);
  if (!def) return res.status(400).json({ error: "Bad skin" });

  try {
    const p = await getPlayer(u);
    if (def.currency === "season" && !((p.owned_skins || []).includes(skin))) return res.status(403).json({ error: "Season reward only" });
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

// Выбор / покупка игрового поля. За монеты — только поля с currency: "coins"; за Stars — через /api/invoice + вебхук
app.post("/api/field", async (req, res) => {
  const u = telegramUser(req);
  if (!u) return res.status(401).json({ error: "Telegram authorization required" });

  const id = String(req.body?.field || "");
  const def = FIELD_BY_ID[id];
  if (!def) return res.status(400).json({ error: "Bad field" });

  try {
    const p = await getPlayer(u);
    const owned = Array.isArray(p.owned_fields) && p.owned_fields.length ? p.owned_fields : ["classic"];

    if (!owned.includes(id)) {
      if (def.currency === "stars") return res.status(402).json({ error: "Buy with Telegram Stars" });
      const r = await pool.query(
        `UPDATE players
         SET coins=coins-$1,
             field_skin=$2,
             owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$2]::TEXT[])),
             updated_at=NOW()
         WHERE telegram_id=$3 AND coins>=$1
         RETURNING 1`,
        [def.price, id, String(u.id)]
      );
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    } else {
      await pool.query(`UPDATE players SET field_skin=$1, updated_at=NOW() WHERE telegram_id=$2`, [id, String(u.id)]);
    }

    const updated = await getPlayer(u);
    res.json({ player: responsePlayer(updated), bot_username: BOT_USERNAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// ================= Admin =================
function isAdmin(req) {
  const u = telegramUser(req);
  return !!(u && ADMIN_IDS.has(String(u.id)));
}
function adminOnly(req,res){ if(!isAdmin(req)){ res.status(403).json({error:"Admin access required"}); return false; } return true; }

app.get("/api/admin/me", async (req,res)=>{
  const u=telegramUser(req); res.json({admin:!!(u&&ADMIN_IDS.has(String(u.id))), user_id:u?.id||null});
});
app.get("/api/admin/stats", async (req,res)=>{ if(!adminOnly(req,res))return; try{
  const [players,payments,seasons]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int count, COALESCE(SUM(coins),0)::bigint coins FROM players`),
    pool.query(`SELECT COUNT(*)::int count, COALESCE(SUM(stars),0)::bigint stars FROM payments`),
    pool.query(`SELECT COUNT(*)::int count FROM seasons`)
  ]);
  res.json({players:players.rows[0],payments:payments.rows[0],seasons:seasons.rows[0],catalog:{skins:SKIN_CATALOG.filter(x=>x.currency==='stars').length,fields:FIELD_CATALOG.filter(x=>x.currency==='stars').length}});
 }catch(e){console.error(e);res.status(500).json({error:"Database error"});}});
app.get("/api/admin/players", async (req,res)=>{ if(!adminOnly(req,res))return; try{
  const q=String(req.query.q||"").trim(); const lim=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  const r= q ? await pool.query(`SELECT telegram_id,username,first_name,coins,xp,best_score,skin,field_skin,created_at FROM players WHERE telegram_id=$1 OR username ILIKE $2 OR first_name ILIKE $2 ORDER BY updated_at DESC LIMIT $3`,[q,`%${q}%`,lim]) : await pool.query(`SELECT telegram_id,username,first_name,coins,xp,best_score,skin,field_skin,created_at FROM players ORDER BY updated_at DESC LIMIT $1`,[lim]);
  res.json({players:r.rows});
 }catch(e){console.error(e);res.status(500).json({error:"Database error"});}});
app.post("/api/admin/player/grant", async (req,res)=>{ if(!adminOnly(req,res))return; try{
  const id=String(req.body?.telegram_id||"").trim(); if(!/^\d{1,20}$/.test(id))return res.status(400).json({error:"Bad telegram_id"});
  const coins=Math.trunc(Number(req.body?.coins)||0), xp=Math.trunc(Number(req.body?.xp)||0);
  const skin=String(req.body?.skin||""); const field=String(req.body?.field||"");
  if(skin && !skinDef(skin))return res.status(400).json({error:"Bad skin"});
  if(field && !FIELD_BY_ID[field])return res.status(400).json({error:"Bad field"});
  await pool.query(`INSERT INTO players(telegram_id) VALUES($1) ON CONFLICT DO NOTHING`,[id]);
  await pool.query(`UPDATE players SET coins=GREATEST(0,coins+$1),xp=GREATEST(0,xp+$2),updated_at=NOW() WHERE telegram_id=$3`,[coins,xp,id]);
  if(skin) await pool.query(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::text[])),skin=$1 WHERE telegram_id=$2`,[skin,id]);
  if(field) await pool.query(`UPDATE players SET owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$1]::text[])),field_skin=$1 WHERE telegram_id=$2`,[field,id]);
  const r=await pool.query(`SELECT telegram_id,username,first_name,coins,xp,best_score,skin,field_skin,owned_skins,owned_fields FROM players WHERE telegram_id=$1`,[id]);
  res.json({ok:true,player:r.rows[0]});
 }catch(e){console.error(e);res.status(500).json({error:"Database error"});}});
app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

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
  const kind = req.body?.field ? "field" : "skin";
  const def = kind === "field" ? FIELD_BY_ID[String(req.body.field || "")] : SKIN_BY_ID[String(req.body?.skin || "")];
  if (!def || def.currency !== "stars") return res.status(400).json({ error: kind === "field" ? "Bad field" : "Bad skin" });
  try {
    const p = await getPlayer(u);
    const have = kind === "field" ? p.owned_fields : p.owned_skins;
    if ((have || []).includes(def.id)) return res.status(400).json({ error: "Already owned" });
    const url = await tgApi("createInvoiceLink", {
      title: kind === "field" ? `Поле «${def.name}»` : `Скин «${def.name}»`,
      description: `${def.emoji} ${def.desc || (kind === "field" ? "Игровое поле" : "Эпический скин змейки")} — навсегда в Snake Arena`,
      payload: `${kind}:${def.id}:${u.id}`,
      currency: "XTR", // Telegram Stars; provider_token для Stars не нужен
      prices: [{ label: def.name, amount: def.price }]
    });
    res.json({ url });
  } catch (e) {
    console.error("invoice error", e.message);
    res.status(500).json({ error: "Invoice error" });
  }
});

function parseItemPayload(payload, userId) {
  const m = /^(skin|field):([a-z_]+):(\d+)$/.exec(String(payload || ""));
  if (!m || m[3] !== String(userId)) return null;
  const def = (m[1] === "field" ? FIELD_BY_ID : SKIN_BY_ID)[m[2]];
  return def && def.currency === "stars" ? { kind: m[1], def } : null;
}

async function grantPaidItem(userId, kind, def, chargeId, stars) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO players (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING`, [String(userId)]);
    // charge_id уникален — повторная доставка вебхука не выдаст покупку дважды
    const ins = await client.query(
      `INSERT INTO payments (charge_id, telegram_id, skin, stars) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1`,
      [chargeId, String(userId), kind === "field" ? "field:" + def.id : def.id, stars]
    );
    if (ins.rowCount) {
      if (kind === "field") {
        await client.query(
          `UPDATE players
           SET field_skin=$1, owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$1]::TEXT[])), updated_at=NOW()
           WHERE telegram_id=$2`,
          [def.id, String(userId)]
        );
      } else {
        await client.query(
          `UPDATE players
           SET skin=$1, owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])), updated_at=NOW()
           WHERE telegram_id=$2`,
          [def.id, String(userId)]
        );
      }
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
    const it = parseItemPayload(q.invoice_payload, q.from?.id);
    const ok = !!it && q.currency === "XTR" && Number(q.total_amount) === it.def.price;
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
    const it = parseItemPayload(sp.invoice_payload, m.from?.id);
    if (!it || sp.currency !== "XTR" || Number(sp.total_amount) !== it.def.price) {
      console.error("suspicious payment", JSON.stringify(sp));
      return;
    }
    const { kind, def } = it;
    const fresh = await grantPaidItem(m.from.id, kind, def, sp.telegram_payment_charge_id, def.price);
    if (fresh) await tgApi("sendMessage", { chat_id: m.chat.id, text: kind === "field"
      ? `${def.emoji} Поле «${def.name}» твоё! Оно уже включено — запускай игру 🐍`
      : `${def.emoji} Скин «${def.name}» твой! Он уже надет — запускай игру 🐍` }).catch(() => {});
    return;
  }
  // 3) /start [ref_ID] — регистрируем игрока, засчитываем реферал и даём кнопку запуска игры
  if (typeof m.text === "string" && /^\/start(\s|$)/.test(m.text) && m.from?.id) {
    const param = m.text.split(/\s+/)[1] || "";
    const pl = await getPlayer({ id: m.from.id, username: m.from.username, first_name: m.from.first_name, start_param: param });
    let text = "🐍 Snake Arena — собирай яблоки, копи серию, бей рекорды!";
    const ch = /^ch_([0-9a-f]{10})$/.exec(param);
    let appUrl = PUBLIC_URL;
    if (ch && PUBLIC_URL) {
      appUrl = `${PUBLIC_URL}/?challenge=${ch[1]}`;
      text = "⚔️ Тебя вызвали на дуэль в Snake Arena! Жми «Играть» и побей результат друга.";
    }
    if (pl?.ref_applied) text = `🎉 Тебя пригласил${pl.invited_by ? " " + pl.invited_by : " друг"} — тебе уже начислено +${REF_BONUS} 🪙!\n\n` + text;
    await tgApi("sendMessage", {
      chat_id: m.chat.id,
      text,
      reply_markup: appUrl ? { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: appUrl } }]] } : undefined
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
