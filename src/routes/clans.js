// Кланы: создать (за монеты), вступить, выйти, исключить. Очки клана за сезон — сумма лучших
// результатов сезона у топ-20 участников. Топ-3 клана недели получают монеты (см. src/clans.js).
const { pool } = require("../db");
const C = require("../catalog");
const { player } = require("../middleware");
const P = require("../players");
const S = require("../seasons");

const q = (sql, p) => pool.query(sql, p);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Очки кланов за сезон (одним запросом, для рейтинга и для «моего клана»)
const CLAN_SCORES = `
  WITH ranked AS (
    SELECT m.clan_id, ss.score, ROW_NUMBER() OVER (PARTITION BY m.clan_id ORDER BY ss.score DESC) AS rn
    FROM clan_members m JOIN season_scores ss ON ss.telegram_id=m.telegram_id AND ss.season_id=$1
    JOIN players p ON p.telegram_id=m.telegram_id WHERE NOT p.banned AND ss.score>0
  )
  SELECT c.id, c.name, c.tag, c.emoji, c.owner_id,
         (SELECT COUNT(*)::int FROM clan_members x WHERE x.clan_id=c.id) AS members,
         COALESCE((SELECT SUM(score)::int FROM ranked r WHERE r.clan_id=c.id AND r.rn<=${C.CLAN.topCount}), 0) AS score
  FROM clans c`;

async function myClan(uid, seasonId) {
  const m = await q(`SELECT clan_id FROM clan_members WHERE telegram_id=$1`, [uid]);
  if (!m.rowCount) return null;
  const cid = m.rows[0].clan_id;
  const c = await q(`${CLAN_SCORES} WHERE c.id=$2`, [seasonId, cid]);
  if (!c.rowCount) return null;
  const rank = await q(`SELECT COUNT(*)::int+1 AS rank FROM (${CLAN_SCORES}) t WHERE t.score>$2`, [seasonId, c.rows[0].score]);
  const members = await q(
    `SELECT p.telegram_id, p.first_name, p.username, p.skin, COALESCE(ss.score,0) AS score FROM clan_members m
     JOIN players p ON p.telegram_id=m.telegram_id LEFT JOIN season_scores ss ON ss.telegram_id=m.telegram_id AND ss.season_id=$2
     WHERE m.clan_id=$1 ORDER BY score DESC, m.joined_at`, [cid, seasonId]);
  return {
    ...c.rows[0], rank: c.rows[0].score > 0 ? rank.rows[0].rank : null, is_owner: c.rows[0].owner_id === uid,
    members: members.rows.map((x) => ({ id: x.telegram_id, name: x.first_name || x.username || "Игрок", skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin), score: x.score, is_me: x.telegram_id === uid, owner: x.telegram_id === c.rows[0].owner_id }))
  };
}

module.exports = (app) => {
  app.get("/api/clans", player(async (req, res, { uid }) => {
    const season = await S.ensureSeason();
    const term = String(req.query.q || "").trim().slice(0, 30);
    const list = await q(
      `SELECT * FROM (${CLAN_SCORES}) t ${term ? "WHERE t.name ILIKE $2 OR t.tag ILIKE $2" : ""} ORDER BY t.score DESC, t.members DESC, t.id LIMIT 30`,
      term ? [season.id, `%${term}%`] : [season.id]);
    res.json({ clans: list.rows.map(({ owner_id, ...x }) => x), mine: await myClan(uid, season.id), cfg: { cost: C.CLAN.createCost, max: C.CLAN.maxMembers, rewards: C.CLAN.rewards, emojis: C.CLAN.emojis, top: C.CLAN.topCount } });
  }, { allowBanned: true }));

  app.post("/api/clan/create", player(async (req, res, { uid, u }) => {
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " "), tag = String(req.body?.tag || "").trim().toUpperCase();
    const emoji = C.CLAN.emojis.includes(req.body?.emoji) ? req.body.emoji : C.CLAN.emojis[0];
    if (name.length < 3 || name.length > 20 || /[<>]/.test(name)) return bad(res, "Название: 3–20 символов");
    if (!/^[A-ZА-ЯЁ0-9]{2,4}$/.test(tag)) return bad(res, "Тег: 2–4 буквы или цифры");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if ((await client.query(`SELECT 1 FROM clan_members WHERE telegram_id=$1`, [uid])).rowCount) { await client.query("ROLLBACK"); return bad(res, "Сначала выйди из своего клана"); }
      const pay = await client.query(`UPDATE players SET coins=coins-$1 WHERE telegram_id=$2 AND coins>=$1 RETURNING 1`, [C.CLAN.createCost, uid]);
      if (!pay.rowCount) { await client.query("ROLLBACK"); return bad(res, "Not enough coins"); }
      let c;
      try { c = await client.query(`INSERT INTO clans(name, tag, emoji, owner_id) VALUES($1,$2,$3,$4) RETURNING id`, [name, tag, emoji, uid]); }
      catch (e) { await client.query("ROLLBACK"); return bad(res, "Такое название или тег уже заняты", 409); }
      await client.query(`INSERT INTO clan_members(telegram_id, clan_id) VALUES($1,$2)`, [uid, c.rows[0].id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
    const season = await S.ensureSeason();
    res.json({ ok: true, mine: await myClan(uid, season.id), player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [10, 60000] }));

  app.post("/api/clan/join", player(async (req, res, { uid }) => {
    const id = Number(req.body?.id) || 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const c = await client.query(`SELECT id FROM clans WHERE id=$1 FOR UPDATE`, [id]);
      if (!c.rowCount) { await client.query("ROLLBACK"); return bad(res, "Clan not found", 404); }
      const n = await client.query(`SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id=$1`, [id]);
      if (n.rows[0].n >= C.CLAN.maxMembers) { await client.query("ROLLBACK"); return bad(res, "Клан заполнен"); }
      const ins = await client.query(`INSERT INTO clan_members(telegram_id, clan_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [uid, id]);
      if (!ins.rowCount) { await client.query("ROLLBACK"); return bad(res, "Сначала выйди из своего клана"); }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, mine: await myClan(uid, (await S.ensureSeason()).id) });
  }, { limit: [10, 60000] }));

  // Выйти. Если уходит владелец — клан переходит самому давнему участнику; пустой клан удаляется.
  app.post("/api/clan/leave", player(async (req, res, { uid }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const m = await client.query(`DELETE FROM clan_members WHERE telegram_id=$1 RETURNING clan_id`, [uid]);
      if (m.rowCount) {
        const cid = m.rows[0].clan_id;
        const c = await client.query(`SELECT owner_id FROM clans WHERE id=$1 FOR UPDATE`, [cid]);
        if (c.rows[0]?.owner_id === uid) {
          const heir = await client.query(`SELECT telegram_id FROM clan_members WHERE clan_id=$1 ORDER BY joined_at LIMIT 1`, [cid]);
          if (heir.rowCount) await client.query(`UPDATE clans SET owner_id=$1 WHERE id=$2`, [heir.rows[0].telegram_id, cid]);
          else await client.query(`DELETE FROM clans WHERE id=$1`, [cid]);
        }
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, mine: null });
  }, { limit: [10, 60000] }));

  app.post("/api/clan/kick", player(async (req, res, { uid }) => {
    const target = String(req.body?.telegram_id || "");
    if (target === uid) return bad(res, "Нельзя исключить себя");
    const r = await q(`DELETE FROM clan_members m USING clans c WHERE m.telegram_id=$1 AND m.clan_id=c.id AND c.owner_id=$2 RETURNING 1`, [target, uid]);
    if (!r.rowCount) return bad(res, "Not allowed", 403);
    res.json({ ok: true, mine: await myClan(uid, (await S.ensureSeason()).id) });
  }, { limit: [20, 60000] }));
};

module.exports.CLAN_SCORES = CLAN_SCORES;
