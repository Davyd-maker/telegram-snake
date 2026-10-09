// Миграции базы данных. Каждая запускается ровно один раз (отметка — в таблице schema_migrations),
// по порядку, в транзакции и под блокировкой: два экземпляра сервера не применят одну миграцию дважды.
// Добавляешь изменение схемы — допиши новую миграцию в конец списка. Старые не меняй.
const MIGRATIONS = [
  {
    id: 1, name: "логи забегов, призраки, ссылки на реплеи, античит",
    up: async (q) => {
      await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS run_log TEXT`);
      await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'free'`);
      await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS eff REAL`);
      await q(`ALTER TABLE game_log ADD COLUMN IF NOT EXISTS flags TEXT NOT NULL DEFAULT ''`);
      await q(`CREATE INDEX IF NOT EXISTS game_log_flags_idx ON game_log (created_at DESC) WHERE flags<>''`);
      await q(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS game_id BIGINT`);
      await q(`ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS game_id BIGINT`);
      await q(`CREATE TABLE IF NOT EXISTS replay_shares (
        id TEXT PRIMARY KEY, game_id BIGINT NOT NULL, telegram_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
  },
  {
    id: 2, name: "настройки игрока, уведомления, ключ-значение для служебных флагов",
    up: async (q) => {
      await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT TRUE`);
      await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ru'`);
      await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS tutorial_done BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS starter_bought BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`CREATE TABLE IF NOT EXISTS notify_log (telegram_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(telegram_id, day))`);
      await q(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
  },
  {
    id: 3, name: "сезонный пропуск",
    up: async (q) => {
      await q(`CREATE TABLE IF NOT EXISTS season_pass (
        season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, telegram_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0, premium BOOLEAN NOT NULL DEFAULT FALSE,
        claimed_free INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[], claimed_prem INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
        PRIMARY KEY(season_id, telegram_id))`);
    }
  },
  {
    id: 4, name: "события (двойные монеты и т. п.)",
    up: async (q) => {
      await q(`CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, title TEXT NOT NULL, coin_mult REAL NOT NULL DEFAULT 2,
        starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
  },
  {
    id: 5, name: "турниры выходных",
    up: async (q) => {
      await q(`CREATE TABLE IF NOT EXISTS tournament_scores (
        tour TEXT NOT NULL, telegram_id TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0, game_id BIGINT,
        PRIMARY KEY(tour, telegram_id))`);
      await q(`CREATE INDEX IF NOT EXISTS tournament_rank_idx ON tournament_scores (tour, best DESC)`);
      await q(`CREATE TABLE IF NOT EXISTS tournament_claims (tour TEXT NOT NULL, telegram_id TEXT NOT NULL, rank INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tour, telegram_id))`);
    }
  },
  {
    id: 6, name: "кланы",
    up: async (q) => {
      await q(`CREATE TABLE IF NOT EXISTS clans (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '🐍',
        owner_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS clans_tag_uq ON clans (upper(tag))`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS clans_name_uq ON clans (lower(name))`);
      await q(`CREATE TABLE IF NOT EXISTS clan_members (
        telegram_id TEXT PRIMARY KEY, clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await q(`CREATE INDEX IF NOT EXISTS clan_members_clan_idx ON clan_members (clan_id)`);
      await q(`CREATE TABLE IF NOT EXISTS clan_rewards (season_id INTEGER PRIMARY KEY, done_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
  },
  {
    id: 7, name: "режим «Уровни»: прогресс игроков",
    up: async (q) => {
      await q(`CREATE TABLE IF NOT EXISTS level_progress (
        telegram_id TEXT NOT NULL, level INTEGER NOT NULL, stars INTEGER NOT NULL DEFAULT 0, best_ticks INTEGER, best_score INTEGER NOT NULL DEFAULT 0, game_id BIGINT,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(telegram_id, level))`);
      await q(`CREATE INDEX IF NOT EXISTS level_progress_player_idx ON level_progress (telegram_id)`);
    }
  }
];

async function runMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(27001)`);
    const done = new Set((await client.query(`SELECT id FROM schema_migrations`)).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await m.up((sql, params) => client.query(sql, params));
        await client.query(`INSERT INTO schema_migrations(id, name) VALUES($1,$2)`, [m.id, m.name]);
        await client.query("COMMIT");
        console.log(`migration ${m.id} applied: ${m.name}`);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`migration ${m.id} failed: ${e.message}`);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(27001)`).catch(() => {});
    client.release();
  }
}

module.exports = { MIGRATIONS, runMigrations };
