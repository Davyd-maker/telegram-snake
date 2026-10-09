const config = require("./config");
const { pool } = require("./db");
const { tgApi, webAppButton } = require("./telegram");
const C = require("./catalog");
const { t } = require("./i18n");

// Текущий сезон: тот, что идёт прямо сейчас. Если такого нет (началась новая неделя или сезон закрыт
// досрочно) — создаём: обычно с понедельника, а если сезон этой недели уже закрыт админом — с текущего момента.
async function ensureSeason() {
  const active = () => pool.query(`SELECT * FROM seasons WHERE starts_at<=NOW() AND ends_at>NOW() ORDER BY starts_at DESC LIMIT 1`);
  let r = await active();
  if (r.rows[0]) return r.rows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(26001)`); // два запроса в начале недели не создадут два сезона
    r = await client.query(`SELECT * FROM seasons WHERE starts_at<=NOW() AND ends_at>NOW() ORDER BY starts_at DESC LIMIT 1`);
    if (!r.rows[0]) {
      const { starts, ends } = C.currentSeasonBounds();
      const taken = await client.query(`SELECT 1 FROM seasons WHERE starts_at=$1`, [starts]);
      // старт «с текущего момента» берём по часам БД, чтобы сезон сразу считался идущим
      await client.query(`INSERT INTO seasons(name,starts_at,ends_at) VALUES($1,COALESCE($2::timestamptz,NOW()),$3) ON CONFLICT (starts_at) DO NOTHING`,
        [`Неделя ${starts.toISOString().slice(0, 10)}`, taken.rowCount ? null : starts, ends]);
      r = await client.query(`SELECT * FROM seasons WHERE starts_at<=NOW() AND ends_at>NOW() ORDER BY starts_at DESC LIMIT 1`);
    }
    await client.query("COMMIT");
    return r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

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
// Место игрока в сезоне. Забаненные в рейтинге не участвуют.
async function seasonRank(seasonId, uid) {
  const r = await pool.query(`SELECT score FROM season_scores WHERE season_id=$1 AND telegram_id=$2`, [seasonId, uid]);
  if (!r.rows[0] || !(r.rows[0].score > 0)) return null;
  const q = await pool.query(
    `SELECT COUNT(*)::int+1 AS rank FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
     WHERE ss.season_id=$1 AND ss.score>$2 AND NOT p.banned`, [seasonId, r.rows[0].score]);
  return { rank: q.rows[0].rank, score: r.rows[0].score };
}

function seasonRewards(season) {
  const weekly = C.weeklySkinFor(season);
  return [
    { rank: 1,  icon: weekly.emoji, title: weekly.name, skin: weekly.id, extra: ["season_champion"], coins: 6000, label: "Топ-1 · скин недели + Корона сезона" },
    { rank: 3,  icon: "👻", title: "Фантом сезона",   skin: "season_elite",  extra: [], coins: 3000, label: "Топ-3" },
    { rank: 10, icon: "⚡", title: "Неоновый мастер", skin: "season_master", extra: [], coins: 1500, label: "Топ-10" }
  ].map((x) => ({ ...x, season_id: season.id, weekly: x.skin === weekly.id }));
}

// Досрочно закрыть текущий сезон: он становится «прошлым» (награды можно забирать), а новый стартует с нуля
async function closeCurrentSeason() {
  const cur = await ensureSeason();
  await pool.query(`UPDATE seasons SET ends_at=NOW() WHERE id=$1`, [cur.id]);
  const next = await ensureSeason();
  return { closed: cur, next };
}

// Бот пишет топ-10 завершённого сезона, что награду можно забрать. Каждый сезон — один раз.
async function notifySeasonWinners() {
  if (!config.BOT_TOKEN) return 0;
  // забираем сезоны под себя атомарно; слишком старые не трогаем, чтобы не будить людей задним числом
  const { rows: seasons } = await pool.query(
    `UPDATE seasons SET notified=TRUE WHERE ends_at<=NOW() AND ends_at>NOW()-INTERVAL '3 days' AND NOT notified RETURNING *`);
  let sent = 0;
  for (const s of seasons) {
    const num = await seasonNumber(s.starts_at);
    const rewards = seasonRewards(s);
    const { rows } = await pool.query(
      `SELECT ss.telegram_id, ss.score, p.lang FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
       WHERE ss.season_id=$1 AND ss.score>0 AND NOT p.banned AND NOT p.bot_blocked
       ORDER BY ss.score DESC, ss.telegram_id LIMIT 10`, [s.id]);
    for (let i = 0; i < rows.length; i++) {
      const rank = i + 1, reward = rewards.find((x) => rank <= x.rank);
      if (!reward) continue;
      try {
        await tgApi("sendMessage", {
          chat_id: rows[i].telegram_id,
          text: t(rows[i].lang, "season_win", { num, rank, score: rows[i].score, icon: reward.icon, title: reward.title, coins: reward.coins }),
          reply_markup: webAppButton(t(rows[i].lang, "claim"))
        });
        sent++;
      } catch (e) {
        if (/blocked|chat not found|deactivated/i.test(e.message)) pool.query(`UPDATE players SET bot_blocked=TRUE WHERE telegram_id=$1`, [rows[i].telegram_id]).catch(() => {});
      }
      await new Promise((ok) => setTimeout(ok, config.BROADCAST_DELAY_MS));
    }
  }
  return sent;
}

module.exports = { ensureSeason, previousSeason, seasonNumber, seasonRank, seasonRewards, closeCurrentSeason, notifySeasonWinners };
