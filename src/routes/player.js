const config = require("../config");
const { pool } = require("../db");
const C = require("../catalog");
const { player } = require("../middleware");
const P = require("../players");
const { ensureSeason, seasonNumber, seasonRank } = require("../seasons");
const Engine = require("../../public/engine.js");
const M = require("../missions");
const Pass = require("../pass");
const Ev = require("../events");
const Holiday = require("../seasonal");
// Покупка праздничного предмета за конфеты (только пока идёт праздник). col — колонка-список, setCol — что надеть
async function buyForCandy(res, uid, def, col, setCol) {
  if (!Holiday.current()) { res.status(403).json({ error: "Holiday is over" }); return false; }
  const r = await pool.query(
    `UPDATE players SET candies=candies-$1, ${setCol}=$2, ${col}=ARRAY(SELECT DISTINCT unnest(${col} || ARRAY[$2]::TEXT[])), updated_at=NOW()
     WHERE telegram_id=$3 AND candies>=$1 RETURNING 1`, [def.price, def.id, uid]);
  if (!r.rowCount) { res.status(400).json({ error: "Not enough candies" }); return false; }
  return true;
}

module.exports = (app) => {
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, database: "postgres" });
    } catch {
      res.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  app.get("/api/me", player(async (req, res, { p, uid }) => {
    const season = await ensureSeason();
    const sr = await pool.query(`SELECT score FROM season_scores WHERE season_id=$1 AND telegram_id=$2`, [season.id, uid]);
    p.season_score = sr.rows[0]?.score || 0;
    p.season = { ...season, number: await seasonNumber(season.starts_at) };
    p.season_rank = (await seasonRank(season.id, uid))?.rank || null;
    const pass = Pass.view(await Pass.get(season.id, uid));
    res.json({ player: P.responsePlayer(p), bot_username: config.botUsername, events: await Ev.active(), news: require("../changelog").newsFor(p.lang),
      pass: { level: pass.level, claimable: pass.claimable, premium: pass.premium, xp: pass.xp, next_xp: pass.next_xp } });
  }, { allowBanned: true }));

  // Выбор / покупка скина. За монеты — обычные; эпические — через /api/invoice + вебхук
  app.post("/api/profile", player(async (req, res, { p, uid, u }) => {
    const skin = String(req.body?.skin || "");
    const def = C.skinDef(skin);
    if (!def) return res.status(400).json({ error: "Bad skin" });
    if (def.currency === "season" && !((p.owned_skins || []).includes(skin))) return res.status(403).json({ error: "Season reward only" });
    const owned = Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"];

    if (!owned.includes(skin)) {
      if (def.currency === "stars") return res.status(402).json({ error: "Buy with Telegram Stars" });
      if (def.currency === "candy") { if (!(await buyForCandy(res, uid, def, "owned_skins", "skin"))) return; return res.json({ player: P.responsePlayer(await P.getPlayer(u)), bot_username: config.botUsername }); }
      const r = await pool.query(
        `UPDATE players SET coins=coins-$1, skin=$2,
             owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$2]::TEXT[])), updated_at=NOW()
         WHERE telegram_id=$3 AND coins>=$1 RETURNING 1`,
        [def.price, skin, uid]
      );
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    } else {
      await pool.query(`UPDATE players SET skin=$1, updated_at=NOW() WHERE telegram_id=$2`, [skin, uid]);
    }
    res.json({ player: P.responsePlayer(await P.getPlayer(u)), bot_username: config.botUsername });
  }, { limit: [30, 60000] }));

  // Выбор / покупка игрового поля. За монеты — только currency: "coins"; за Stars — через /api/invoice + вебхук
  app.post("/api/field", player(async (req, res, { p, uid, u }) => {
    const id = String(req.body?.field || "");
    const def = C.FIELD_BY_ID[id];
    if (!def) return res.status(400).json({ error: "Bad field" });
    const owned = Array.isArray(p.owned_fields) && p.owned_fields.length ? p.owned_fields : ["classic"];

    if (!owned.includes(id)) {
      if (def.currency === "stars") return res.status(402).json({ error: "Buy with Telegram Stars" });
      if (def.currency === "candy") { if (!(await buyForCandy(res, uid, def, "owned_fields", "field_skin"))) return; return res.json({ player: P.responsePlayer(await P.getPlayer(u)), bot_username: config.botUsername }); }
      const r = await pool.query(
        `UPDATE players SET coins=coins-$1, field_skin=$2,
             owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$2]::TEXT[])), updated_at=NOW()
         WHERE telegram_id=$3 AND coins>=$1 RETURNING 1`,
        [def.price, id, uid]
      );
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    } else {
      await pool.query(`UPDATE players SET field_skin=$1, updated_at=NOW() WHERE telegram_id=$2`, [id, uid]);
    }
    res.json({ player: P.responsePlayer(await P.getPlayer(u)), bot_username: config.botUsername });
  }, { limit: [30, 60000] }));

  // Аксессуар: надеть / снять (id="") / купить за монеты. За Stars — через /api/invoice + вебхук
  app.post("/api/accessory", player(async (req, res, { p, uid, u }) => {
    const id = String(req.body?.accessory ?? "");
    if (id === "") { await pool.query(`UPDATE players SET accessory='', updated_at=NOW() WHERE telegram_id=$1`, [uid]); return res.json({ player: P.responsePlayer(await P.getPlayer(u)) }); }
    const def = C.ACC_BY_ID[id];
    if (!def) return res.status(400).json({ error: "Bad accessory" });
    if (!(p.owned_accessories || []).includes(id)) {
      if (def.currency === "stars") return res.status(402).json({ error: "Buy with Telegram Stars" });
      if (def.currency === "candy") { if (!(await buyForCandy(res, uid, def, "owned_accessories", "accessory"))) return; return res.json({ player: P.responsePlayer(await P.getPlayer(u)) }); }
      const r = await pool.query(
        `UPDATE players SET coins=coins-$1, accessory=$2, owned_accessories=ARRAY(SELECT DISTINCT unnest(owned_accessories || ARRAY[$2]::TEXT[])), updated_at=NOW()
         WHERE telegram_id=$3 AND coins>=$1 RETURNING 1`, [def.price, id, uid]);
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    } else await pool.query(`UPDATE players SET accessory=$1, updated_at=NOW() WHERE telegram_id=$2`, [id, uid]);
    res.json({ player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [30, 60000] }));

  app.post("/api/daily", player(async (req, res, { uid, u }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // блокировка строки — двойной тап не даст забрать награду дважды
      const { rows } = await client.query(
        `SELECT *, to_char(daily_bonus_claimed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS last_day,
                to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today
         FROM players WHERE telegram_id=$1 FOR UPDATE`, [uid, config.DAILY_TZ]);
      const info = P.dailyInfo(rows[0]);
      if (!info.can_claim) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Already claimed today", player: P.responsePlayer(await P.getPlayer(u)) });
      }
      await client.query(
        `UPDATE players SET coins=coins+$1, daily_streak=$2, daily_bonus_claimed_at=NOW(), updated_at=NOW() WHERE telegram_id=$3`,
        [info.reward, info.next_streak, uid]);
      // каждый 7-й день серии — сундук: аксессуар, которого ещё нет (за монеты), а если все есть — монеты
      let chest = null;
      if (info.next_streak % config.DAILY_REWARDS.length === 0) {
        const have = rows[0].owned_accessories || [];
        const pool2 = C.ACCESSORY_CATALOG.filter((a) => a.currency === "coins" && !have.includes(a.id));
        if (pool2.length) {
          const a = pool2[Math.floor(Math.random() * pool2.length)];
          await client.query(`UPDATE players SET owned_accessories=ARRAY(SELECT DISTINCT unnest(owned_accessories || ARRAY[$1]::TEXT[])), chests=chests+1 WHERE telegram_id=$2`, [a.id, uid]);
          chest = { accessory: a };
        } else {
          const coins = 1500 + Math.floor(Math.random() * 7) * 250;
          await client.query(`UPDATE players SET coins=coins+$1, chests=chests+1 WHERE telegram_id=$2`, [coins, uid]);
          chest = { coins };
        }
      }
      await client.query("COMMIT");
      res.json({ reward: info.reward, chest, player: P.responsePlayer(await P.getPlayer(u)) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { client.release(); }
  }, { limit: [30, 60000] }));

  // Забрать награду за задание (дневное или недельное). Задания дают ещё и опыт сезонного пропуска.
  app.post("/api/mission", player(async (req, res, { uid, u }) => {
    const id = String(req.body?.id || "");
    const client = await pool.connect();
    let got = null;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT *, to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today FROM players WHERE telegram_id=$1 FOR UPDATE`, [uid, config.DAILY_TZ]);
      got = M.claim(rows[0], id);
      if (!got) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Not available", player: P.responsePlayer(await P.getPlayer(u)) });
      }
      await client.query(`UPDATE players SET coins=coins+$1, missions=$2::jsonb, updated_at=NOW() WHERE telegram_id=$3`, [got.reward, JSON.stringify(got.state), uid]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { client.release(); }
    const season = await ensureSeason();
    await Pass.addXp(season.id, uid, got.weekly ? 150 : 50).catch(() => {});
    res.json({ reward: got.reward, pass_xp: got.weekly ? 150 : 50, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [30, 60000] }));

  // Настройки игрока на сервере: сообщения от бота и язык
  app.post("/api/settings", player(async (req, res, { uid, u }) => {
    const b = req.body || {};
    if (typeof b.notify === "boolean") await pool.query(`UPDATE players SET notify=$1 WHERE telegram_id=$2`, [b.notify, uid]);
    if (["ru", "en"].includes(b.lang)) await pool.query(`UPDATE players SET lang=$1 WHERE telegram_id=$2`, [b.lang, uid]);
    if (b.tutorial_done === true) await pool.query(`UPDATE players SET tutorial_done=TRUE WHERE telegram_id=$1`, [uid]);
    res.json({ ok: true, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { allowBanned: true, limit: [30, 60000] }));

  // ---- Сезонный пропуск ----
  app.get("/api/pass", player(async (req, res, { uid }) => {
    const season = await ensureSeason();
    res.json({ season: { id: season.id, ends_at: season.ends_at, number: await seasonNumber(season.starts_at) }, pass: Pass.view(await Pass.get(season.id, uid)),
      product: C.PRODUCTS.pass, stars_enabled: !!config.BOT_TOKEN });
  }, { allowBanned: true }));
  app.post("/api/pass/claim", player(async (req, res, { uid, u }) => {
    const season = await ensureSeason();
    const r = await Pass.claim(season.id, uid, Number(req.body?.tier) || 0, String(req.body?.track || ""));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ...r, pass: Pass.view(await Pass.get(season.id, uid)), player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [60, 60000] }));

  app.get("/api/achievements", player(async (req, res, { p }) => {
    res.json({ achievements: P.achievementList(p) });
  }, { allowBanned: true }));

  app.post("/api/achievement", player(async (req, res, { p, uid, u }) => {
    const def = C.ACHIEVEMENTS.find((x) => x.id === String(req.body?.id));
    if (!def) return res.status(400).json({ error: "Bad achievement" });
    const a = p.achievements || {};
    if (a[def.id]) return res.status(400).json({ error: "Already claimed", player: P.responsePlayer(p) });
    if (!def.need(P.achStats(p))) return res.status(400).json({ error: "Not ready", player: P.responsePlayer(p) });
    a[def.id] = true;
    await pool.query(`UPDATE players SET achievements=$1::jsonb, coins=coins+$2, xp=xp+$2 WHERE telegram_id=$3`, [JSON.stringify(a), def.reward, uid]);
    res.json({ reward: def.reward, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [30, 60000] }));

  app.get("/api/artifacts", player(async (req, res, { p }) => {
    res.json({ artifacts: C.ARTIFACT_CATALOG, owned: p.owned_artifacts || ["magnet"], equipped: p.equipped_artifact || "magnet" });
  }, { allowBanned: true }));

  app.post("/api/artifact/equip", player(async (req, res, { p, uid, u }) => {
    const id = String(req.body?.id || "");
    if (!C.ARTIFACT_BY_ID[id]) return res.status(400).json({ error: "Bad artifact" });
    if (!(p.owned_artifacts || ["magnet"]).includes(id)) return res.status(403).json({ error: "Artifact not owned" });
    await pool.query(`UPDATE players SET equipped_artifact=$1, updated_at=NOW() WHERE telegram_id=$2`, [id, uid]);
    res.json({ ok: true, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [30, 60000] }));

  // Прокачка артефакта за монеты: уровни 1→5, каждый уровень усиливает эффект (см. Engine.artifactStats)
  app.post("/api/artifact/upgrade", player(async (req, res, { p, uid, u }) => {
    const id = String(req.body?.id || "");
    if (!C.ARTIFACT_BY_ID[id]) return res.status(400).json({ error: "Bad artifact" });
    if (!(p.owned_artifacts || ["magnet"]).includes(id)) return res.status(403).json({ error: "Artifact not owned" });
    const lvl = Math.max(1, Number((p.artifact_levels || {})[id]) || 1);
    if (lvl >= Engine.MAX_ART_LEVEL) return res.status(400).json({ error: "Max level" });
    const cost = C.ARTIFACT_UPGRADE_COST[lvl - 1];
    const r = await pool.query(
      `UPDATE players SET coins=coins-$1, artifact_levels=jsonb_set(COALESCE(artifact_levels,'{}'::jsonb), ARRAY[$2::text], to_jsonb($3::int), true), updated_at=NOW()
       WHERE telegram_id=$4 AND coins>=$1 AND COALESCE((artifact_levels->>$2)::int,1)=$5 RETURNING 1`, [cost, id, lvl + 1, uid, lvl]);
    if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    res.json({ ok: true, level: lvl + 1, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [20, 60000] }));
};
