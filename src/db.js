const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const q = (sql, params) => pool.query(sql, params);

async function initDb() {
  await q(`
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

  // Безопасные обновления схемы: колонки добавляются при запуске, если их ещё нет.
  const cols = [
    `owned_skins TEXT[] NOT NULL DEFAULT ARRAY['classic']::TEXT[]`,
    `missions JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `daily_bonus_claimed_at TIMESTAMPTZ`,
    `referred_by TEXT`,
    `best_nowalls INTEGER NOT NULL DEFAULT 0`,
    `last_run_ts BIGINT NOT NULL DEFAULT 0`,
    `last_reminded_day TEXT`,
    `field_skin TEXT NOT NULL DEFAULT 'classic'`,
    `owned_fields TEXT[] NOT NULL DEFAULT ARRAY['classic']::TEXT[]`,
    `daily_streak INTEGER NOT NULL DEFAULT 0`,
    `xp INTEGER NOT NULL DEFAULT 0`,
    `achievements JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `weekly JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `games_played INTEGER NOT NULL DEFAULT 0`,
    `total_apples INTEGER NOT NULL DEFAULT 0`,
    `best_combo INTEGER NOT NULL DEFAULT 0`,
    `owned_artifacts TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
    `equipped_artifact TEXT NOT NULL DEFAULT 'magnet'`,
    `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    // v26: бан читеров и пометка «бот заблокирован» (чтобы рассылка не стучалась зря)
    `banned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ban_reason TEXT NOT NULL DEFAULT ''`,
    `banned_at TIMESTAMPTZ`,
    `bot_blocked BOOLEAN NOT NULL DEFAULT FALSE`,
    // v27: уровни артефактов {"magnet":2}
    `artifact_levels JSONB NOT NULL DEFAULT '{}'::jsonb`
  ];
  for (const c of cols) await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ${c}`);

  await q(`CREATE TABLE IF NOT EXISTS payments (
    charge_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, skin TEXT NOT NULL, stars INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`);
  await q(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_by TEXT`);
  await q(`CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at DESC)`);

  await q(`CREATE TABLE IF NOT EXISTS seasons (id SERIAL PRIMARY KEY, name TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  // notified: бот уже написал победителям. У старых сезонов — TRUE (не будим людей задним числом), у новых по умолчанию FALSE
  await q(`ALTER TABLE seasons ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`ALTER TABLE seasons ALTER COLUMN notified SET DEFAULT FALSE`);
  await q(`CREATE TABLE IF NOT EXISTS season_scores (season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, telegram_id TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(season_id,telegram_id))`);
  await q(`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, creator_score INTEGER NOT NULL, accepted_by TEXT, accepted_score INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);

  // v26: статистика по дням, журнал админа, ошибки платежей, рассылки, карточки результатов
  await q(`CREATE TABLE IF NOT EXISTS activity (day TEXT NOT NULL, telegram_id TEXT NOT NULL, PRIMARY KEY(day, telegram_id))`);
  await q(`CREATE TABLE IF NOT EXISTS game_log (
    id BIGSERIAL PRIMARY KEY, telegram_id TEXT NOT NULL, score INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'classic',
    apples INTEGER NOT NULL DEFAULT 0, verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS game_log_created_idx ON game_log (created_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS game_log_player_idx ON game_log (telegram_id, created_at DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS admin_log (
    id BIGSERIAL PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS payment_errors (
    id BIGSERIAL PRIMARY KEY, telegram_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '', charge_id TEXT NOT NULL DEFAULT '', stars INTEGER NOT NULL DEFAULT 0,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb, resolved BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS broadcasts (
    id SERIAL PRIMARY KEY, text TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all', with_button BOOLEAN NOT NULL DEFAULT TRUE,
    total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running', created_by TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
  )`);
  await q(`CREATE TABLE IF NOT EXISTS share_cards (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, score INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'classic',
    image BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS share_cards_player_idx ON share_cards (telegram_id, created_at DESC)`);

  // v27: проверка забегов по реплею, режимы, ежедневный челлендж, реплеи сезона
  await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS seed BIGINT`);
  await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS diff TEXT NOT NULL DEFAULT 'normal'`);
  await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS ticks INTEGER NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS reject TEXT NOT NULL DEFAULT ''`);
  await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS cfg JSONB`);
  await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS seed BIGINT`);
  await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'classic'`);
  await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS diff TEXT NOT NULL DEFAULT 'normal'`);
  await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS art TEXT NOT NULL DEFAULT ''`);
  await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS art_level INTEGER NOT NULL DEFAULT 1`);
  await q(`CREATE TABLE IF NOT EXISTS mode_scores (telegram_id TEXT NOT NULL, mode TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(telegram_id, mode))`);
  await q(`CREATE INDEX IF NOT EXISTS mode_scores_rank_idx ON mode_scores (mode, best DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS daily_scores (day TEXT NOT NULL, telegram_id TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, telegram_id))`);
  await q(`CREATE INDEX IF NOT EXISTS daily_scores_rank_idx ON daily_scores (day, best DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS season_replays (
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, telegram_id TEXT NOT NULL, score INTEGER NOT NULL,
    cfg JSONB NOT NULL, ticks INTEGER NOT NULL, run_log TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(season_id, telegram_id)
  )`);

  // уникальность сезона по дате старта (дубликаты, если были, убираем — оставляем самый старый)
  try {
    await q(`DELETE FROM seasons a USING seasons b WHERE a.starts_at=b.starts_at AND a.id>b.id`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS seasons_starts_at_uq ON seasons(starts_at)`);
  } catch (e) { console.warn("seasons index:", e.message); }
  await q(`CREATE INDEX IF NOT EXISTS players_best_idx ON players (best_score DESC, coins DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS season_scores_rank_idx ON season_scores (season_id, score DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS players_referred_idx ON players (referred_by)`);
  await q(`CREATE INDEX IF NOT EXISTS players_created_idx ON players (created_at)`);

  await q(`UPDATE players SET owned_skins=ARRAY['classic']::TEXT[] WHERE owned_skins IS NULL OR cardinality(owned_skins)=0`);
  await q(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY['classic']::TEXT[])) WHERE NOT ('classic' = ANY(owned_skins))`);
  await q(`UPDATE players SET owned_fields=ARRAY['classic']::TEXT[] WHERE owned_fields IS NULL OR cardinality(owned_fields)=0`);
  await q(`UPDATE players SET owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY['classic']::TEXT[])) WHERE NOT ('classic' = ANY(owned_fields))`);
  await q(`UPDATE players SET owned_artifacts=ARRAY['magnet']::TEXT[] WHERE owned_artifacts IS NULL OR cardinality(owned_artifacts)=0`);
  // рассылка, прерванная перезапуском сервера
  await q(`UPDATE broadcasts SET status='interrupted', finished_at=NOW() WHERE status='running'`);
  // всё, что добавлено после v27, — через пронумерованные миграции (src/migrations.js)
  await require("./migrations").runMigrations(pool);
}

module.exports = { pool, q, initDb };
