const { pool } = require("../db");
const C = require("../catalog");
const { telegramUser } = require("../auth");
const { player } = require("../middleware");
const P = require("../players");
const S = require("../seasons");
const Engine = require("../../public/engine.js");

const { FRIENDS_CTE } = require("../friends");

const row = (x, uid, scoreKey) => ({
  name: x.first_name || x.username || "Игрок",
  [scoreKey]: x.score,
  skin: C.skinDef(x.skin) ? x.skin : "classic",
  palette: C.skinPalette(x.skin),
  is_me: x.telegram_id === uid
});

module.exports = (app) => {
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const u = telegramUser(req);
      const { rows } = await pool.query(
        `SELECT telegram_id,username,first_name,best_score,skin FROM players
         WHERE best_score>0 AND NOT banned ORDER BY best_score DESC, coins DESC, telegram_id LIMIT 20`);
      let me = null;
      if (u) {
        const r = await pool.query(`SELECT best_score,coins,banned FROM players WHERE telegram_id=$1`, [String(u.id)]);
        if (r.rows[0] && r.rows[0].best_score > 0 && !r.rows[0].banned) {
          const { best_score, coins } = r.rows[0];
          const rk = await pool.query(
            `SELECT COUNT(*)::int+1 AS rank FROM players WHERE NOT banned AND (best_score>$1 OR (best_score=$1 AND coins>$2))`,
            [best_score, coins]);
          me = { rank: rk.rows[0].rank, best_score };
        }
      }
      res.json({
        leaderboard: rows.map((x) => ({ ...row({ ...x, score: x.best_score }, u ? String(u.id) : "", "best_score") })),
        me
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ leaderboard: [] });
    }
  });

  // Рейтинг среди друзей: ?scope=all (рекорды) | season (текущий сезон)
  app.get("/api/leaderboard/friends", player(async (req, res, { uid }) => {
    const season = req.query.scope === "season";
    const sid = season ? (await S.ensureSeason()).id : null;
    const count = await pool.query(`WITH ${FRIENDS_CTE} SELECT COUNT(*)::int AS n FROM friends WHERE telegram_id<>$1`, [uid]);
    const { rows } = await pool.query(
      `WITH ${FRIENDS_CTE}
       SELECT p.telegram_id, p.username, p.first_name, p.skin, ${season ? "COALESCE(ss.score,0)" : "p.best_score"} AS score
       FROM friends f JOIN players p ON p.telegram_id=f.telegram_id
       ${season ? "LEFT JOIN season_scores ss ON ss.season_id=$2 AND ss.telegram_id=p.telegram_id" : ""}
       WHERE NOT p.banned AND ${season ? "COALESCE(ss.score,0)" : "p.best_score"}>0
       ORDER BY score DESC, p.telegram_id LIMIT 50`,
      season ? [uid, sid] : [uid]);
    const key = season ? "score" : "best_score";
    const list = rows.map((x) => row(x, uid, key));
    const idx = list.findIndex((x) => x.is_me);
    res.json({ leaderboard: list, me: idx >= 0 ? { rank: idx + 1, [key]: list[idx][key] } : null, friends_count: count.rows[0].n });
  }, { allowBanned: true }));

  // Рейтинг по режимам (камни, лабиринт, живые стены, без стен): лучший результат игрока в режиме
  app.get("/api/leaderboard/mode", player(async (req, res, { uid }) => {
    const mode = String(req.query.mode || "");
    if (!Engine.MODES[mode] || Engine.MODES[mode].rated) return res.status(400).json({ error: "Bad mode" });
    const { rows } = await pool.query(
      `SELECT pl.telegram_id, pl.username, pl.first_name, pl.skin, m.best AS score FROM mode_scores m JOIN players pl ON pl.telegram_id=m.telegram_id
       WHERE m.mode=$1 AND m.best>0 AND NOT pl.banned ORDER BY m.best DESC, pl.telegram_id LIMIT 20`, [mode]);
    const mine = await pool.query(`SELECT best FROM mode_scores WHERE mode=$1 AND telegram_id=$2`, [mode, uid]);
    let me = null;
    if (mine.rows[0]?.best > 0) {
      const rk = await pool.query(`SELECT COUNT(*)::int+1 AS rank FROM mode_scores m JOIN players pl ON pl.telegram_id=m.telegram_id WHERE m.mode=$1 AND NOT pl.banned AND m.best>$2`, [mode, mine.rows[0].best]);
      me = { rank: rk.rows[0].rank, score: mine.rows[0].best };
    }
    res.json({ mode, leaderboard: rows.map((x) => row(x, uid, "score")), me });
  }, { allowBanned: true }));

  app.get("/api/season", async (req, res) => {
    try {
      const u = telegramUser(req);
      const season = await S.ensureSeason();
      const { rows } = await pool.query(
        `SELECT ss.score, ss.telegram_id, p.first_name, p.username, p.skin
         FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
         WHERE ss.season_id=$1 AND ss.score>0 AND NOT p.banned
         ORDER BY ss.score DESC, ss.telegram_id LIMIT 20`, [season.id]);
      let me = null, claim = null;
      if (u) {
        me = await S.seasonRank(season.id, String(u.id));
        const prev = await S.previousSeason();
        if (prev) {
          const pr = await S.seasonRank(prev.id, String(u.id));
          const reward = pr && S.seasonRewards(prev).find((x) => pr.rank <= x.rank);
          if (reward) {
            const { rows: pl } = await pool.query(`SELECT achievements FROM players WHERE telegram_id=$1`, [String(u.id)]);
            const done = !!(pl[0]?.achievements || {})[`season:${prev.id}:${reward.skin}`];
            claim = { season_id: prev.id, season_name: prev.name, rank: pr.rank, reward, claimed: done };
          }
        }
      }
      res.json({
        season: { ...season, number: await S.seasonNumber(season.starts_at) },
        leaderboard: rows.map((x) => row(x, u ? String(u.id) : "", "score")),
        me, claim, rewards: S.seasonRewards(season)
      });
    } catch (e) { console.error(e); res.status(500).json({ leaderboard: [] }); }
  });

  // История сезонов игрока: его место и очки в каждом закончившемся сезоне
  app.get("/api/season/history", player(async (req, res, { uid }) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.starts_at, s.ends_at, ss.score,
              (SELECT COUNT(*)::int FROM seasons x WHERE x.starts_at<=s.starts_at) AS number,
              (SELECT COUNT(*)::int+1 FROM season_scores o JOIN players op ON op.telegram_id=o.telegram_id WHERE o.season_id=s.id AND o.score>ss.score AND NOT op.banned) AS rank,
              (SELECT COUNT(*)::int FROM season_scores o JOIN players op ON op.telegram_id=o.telegram_id WHERE o.season_id=s.id AND o.score>0 AND NOT op.banned) AS players
       FROM seasons s JOIN season_scores ss ON ss.season_id=s.id AND ss.telegram_id=$1 AND ss.score>0
       WHERE s.ends_at<=NOW() ORDER BY s.starts_at DESC LIMIT 30`, [uid]);
    res.json({ history: rows });
  }, { allowBanned: true }));

  // Награда за прошлый (уже закончившийся) сезон
  app.post("/api/season/claim", player(async (req, res, { uid, u }) => {
    const prev = await S.previousSeason();
    if (!prev) return res.status(400).json({ error: "No finished season" });
    const pr = await S.seasonRank(prev.id, uid);
    const reward = pr && S.seasonRewards(prev).find((x) => pr.rank <= x.rank);
    if (!reward) return res.status(400).json({ error: "No reward" });
    const key = `season:${prev.id}:${reward.skin}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(`SELECT achievements FROM players WHERE telegram_id=$1 FOR UPDATE`, [uid]);
      const ach = rows[0]?.achievements || {};
      if (ach[key]) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Already claimed", player: P.responsePlayer(await P.getPlayer(u)) }); }
      ach[key] = true;
      const skins = [reward.skin, ...(reward.extra || [])];
      await client.query(
        `UPDATE players SET achievements=$1::jsonb, coins=coins+$2, xp=xp+$2,
           owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || $3::text[])), skin=$4, updated_at=NOW()
         WHERE telegram_id=$5`,
        [JSON.stringify(ach), reward.coins, skins, reward.skin, uid]);
      await client.query("COMMIT");
      res.json({ reward, rank: pr.rank, player: P.responsePlayer(await P.getPlayer(u)) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { client.release(); }
  }));
};
