const path = require("path");
const config = require("../config");
const { pool } = require("../db");
const C = require("../catalog");
const { telegramUser, isAdminId } = require("../auth");
const { admin, logAdmin } = require("../middleware");
const S = require("../seasons");
const Pay = require("../payments");
const Bot = require("../bot");
const Ev = require("../events");

const q = (sql, params) => pool.query(sql, params);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isId = (s) => /^\d{1,20}$/.test(String(s || ""));
const PLAYER_COLS = `telegram_id,username,first_name,coins,xp,best_score,best_nowalls,games_played,skin,field_skin,banned,ban_reason,bot_blocked,created_at,updated_at`;

// Человекочитаемое название покупки по записи payments.skin ("rainbow" или "field:neon")
function itemName(key) {
  const prod = /^product:([a-z]+):(\d+)$/.exec(String(key));
  if (prod) { const d = C.PRODUCTS[prod[1]]; return d ? `${d.emoji} ${d.name}${prod[1] === "pass" ? ` (сезон ${prod[2]})` : ""}` : key; }
  const isField = String(key).startsWith("field:");
  const id = isField ? key.slice(6) : key;
  const def = isField ? C.FIELD_BY_ID[id] : C.skinDef(id);
  return def ? `${def.emoji} ${def.name}${isField ? " (поле)" : ""}` : key;
}

// Ряды по дням за последние N дней (по часовому поясу DAILY_TZ). DAU и «игры» копятся с момента обновления до v26.
async function dailySeries(days) {
  const tz = config.DAILY_TZ;
  const from = `(NOW() AT TIME ZONE $1)::date - ($2::int - 1)`;
  const day = (col) => `to_char(${col} AT TIME ZONE $1,'YYYY-MM-DD')`;
  const [list, np, dau, games, pay] = await Promise.all([
    q(`SELECT to_char(d,'YYYY-MM-DD') AS day FROM generate_series(${from}, (NOW() AT TIME ZONE $1)::date, interval '1 day') d`, [tz, days]),
    q(`SELECT ${day("created_at")} AS d, COUNT(*)::int AS n FROM players WHERE (created_at AT TIME ZONE $1)::date >= ${from} GROUP BY 1`, [tz, days]),
    q(`SELECT day AS d, COUNT(*)::int AS n FROM activity WHERE day >= to_char(${from},'YYYY-MM-DD') GROUP BY 1`, [tz, days]),
    q(`SELECT ${day("created_at")} AS d, COUNT(*)::int AS n FROM game_log WHERE verified AND (created_at AT TIME ZONE $1)::date >= ${from} GROUP BY 1`, [tz, days]),
    q(`SELECT ${day("created_at")} AS d, COALESCE(SUM(stars) FILTER (WHERE refunded_at IS NULL),0)::int AS stars,
              COALESCE(SUM(stars) FILTER (WHERE refunded_at IS NOT NULL),0)::int AS refunded, COUNT(*)::int AS n
       FROM payments WHERE (created_at AT TIME ZONE $1)::date >= ${from} GROUP BY 1`, [tz, days])
  ]);
  const m = (r) => Object.fromEntries(r.rows.map((x) => [x.d, x]));
  const [NP, DAU, G, PAY] = [m(np), m(dau), m(games), m(pay)];
  return list.rows.map(({ day: d }) => ({
    day: d, new_players: NP[d]?.n || 0, dau: DAU[d]?.n || 0, games: G[d]?.n || 0,
    stars: PAY[d]?.stars || 0, refunded: PAY[d]?.refunded || 0, payments: PAY[d]?.n || 0
  }));
}

module.exports = (app) => {
  app.get("/api/admin/me", (req, res) => {
    const u = telegramUser(req);
    res.json({ admin: !!(u && isAdminId(u.id)), user_id: u?.id || null });
  });
  app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "..", "public", "admin", "index.html")));

  // Справочник скинов и полей для выпадающих списков
  app.get("/api/admin/catalog", admin(async (req, res) => {
    const now = C.weeklySkinFor({ starts_at: C.currentSeasonBounds().starts });
    res.json({
      skins: [...C.SKIN_CATALOG, now].filter((x) => x.id !== "classic").map(({ id, name, emoji, price, currency }) => ({ id, name, emoji, price, currency })),
      fields: C.FIELD_CATALOG.filter((x) => x.id !== "classic").map(({ id, name, emoji, price, currency }) => ({ id, name, emoji, price, currency })),
      audiences: Object.entries(Bot.AUDIENCES).map(([id, a]) => ({ id, label: a.label })),
      bot: !!config.BOT_TOKEN, tz: config.DAILY_TZ
    });
  }));

  // ---------- Обзор ----------
  app.get("/api/admin/stats", admin(async (req, res) => {
    const days = Math.min(90, Math.max(7, Math.floor(Number(req.query.days) || 30)));
    const tz = config.DAILY_TZ;
    const today = `to_char(NOW() AT TIME ZONE $1,'YYYY-MM-DD')`;
    const [players, payments, seasons, tot, series] = await Promise.all([
      q(`SELECT COUNT(*)::int AS count, COALESCE(SUM(coins),0)::bigint AS coins, COUNT(*) FILTER (WHERE banned)::int AS banned,
                COUNT(*) FILTER (WHERE bot_blocked)::int AS bot_blocked FROM players`),
      q(`SELECT COUNT(*) FILTER (WHERE refunded_at IS NULL)::int AS count, COALESCE(SUM(stars) FILTER (WHERE refunded_at IS NULL),0)::bigint AS stars,
                COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)::int AS refunded_count, COALESCE(SUM(stars) FILTER (WHERE refunded_at IS NOT NULL),0)::bigint AS refunded_stars FROM payments`),
      q(`SELECT COUNT(*)::int AS count FROM seasons`),
      q(`SELECT
           (SELECT COUNT(*)::int FROM activity WHERE day=${today}) AS dau_today,
           (SELECT COUNT(DISTINCT telegram_id)::int FROM activity WHERE day >= to_char((NOW() AT TIME ZONE $1)::date - 6,'YYYY-MM-DD')) AS wau,
           (SELECT COUNT(*)::int FROM players WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date) AS new_today,
           (SELECT COUNT(*)::int FROM game_log WHERE verified AND (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date) AS games_today,
           (SELECT COUNT(*)::int FROM game_log WHERE NOT verified AND (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date) AS rejected_today,
           (SELECT COUNT(*)::int FROM game_log WHERE flags<>'' AND created_at > NOW() - INTERVAL '7 days') AS flagged_week,
           (SELECT COUNT(*)::int FROM payment_errors WHERE NOT resolved) AS open_errors`, [tz]),
      dailySeries(days)
    ]);
    res.json({
      players: players.rows[0], payments: payments.rows[0], seasons: seasons.rows[0], today: tot.rows[0], series, days,
      catalog: { skins: C.SKIN_CATALOG.filter((x) => x.currency === "stars").length, fields: C.FIELD_CATALOG.filter((x) => x.currency === "stars").length }
    });
  }));

  // ---------- Игроки ----------
  app.get("/api/admin/players", admin(async (req, res) => {
    const term = String(req.query.q || "").trim(), lim = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const only = req.query.banned === "1" ? "AND banned" : "";
    const r = term
      ? await q(`SELECT ${PLAYER_COLS} FROM players WHERE (telegram_id=$1 OR username ILIKE $2 OR first_name ILIKE $2) ${only} ORDER BY updated_at DESC LIMIT $3`, [term, `%${term}%`, lim])
      : await q(`SELECT ${PLAYER_COLS} FROM players WHERE TRUE ${only} ORDER BY updated_at DESC LIMIT $1`, [lim]);
    res.json({ players: r.rows });
  }));

  app.get("/api/admin/player/:id", admin(async (req, res) => {
    const id = String(req.params.id);
    if (!isId(id)) return bad(res, "Bad telegram_id");
    const pl = await q(`SELECT ${PLAYER_COLS}, referrals, referred_by, owned_skins, owned_fields, total_apples, best_combo, daily_streak, banned_at FROM players WHERE telegram_id=$1`, [id]);
    if (!pl.rowCount) return bad(res, "Player not found", 404);
    const [games, pays, ss] = await Promise.all([
      q(`SELECT id, score, mode, diff, kind, apples, verified, reject, eff, flags, run_log IS NOT NULL AS has_log, created_at FROM game_log WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 15`, [id]),
      q(`SELECT charge_id, skin, stars, created_at, refunded_at FROM payments WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      q(`SELECT s.name, ss.score FROM season_scores ss JOIN seasons s ON s.id=ss.season_id WHERE ss.telegram_id=$1 ORDER BY s.starts_at DESC LIMIT 5`, [id])
    ]);
    res.json({ player: pl.rows[0], games: games.rows, payments: pays.rows.map((x) => ({ ...x, item: itemName(x.skin) })), seasons: ss.rows });
  }));

  app.post("/api/admin/player/grant", admin(async (req, res, { adminId }) => {
    const id = String(req.body?.telegram_id || "").trim();
    if (!isId(id)) return bad(res, "Bad telegram_id");
    const coins = Math.trunc(Number(req.body?.coins) || 0), xp = Math.trunc(Number(req.body?.xp) || 0);
    if (Math.abs(coins) > 10_000_000 || Math.abs(xp) > 10_000_000) return bad(res, "Слишком большое значение");
    const skin = String(req.body?.skin || ""), field = String(req.body?.field || "");
    if (skin && !C.skinDef(skin)) return bad(res, "Bad skin");
    if (field && !C.FIELD_BY_ID[field]) return bad(res, "Bad field");
    await q(`INSERT INTO players(telegram_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]);
    await q(`UPDATE players SET coins=GREATEST(0,coins+$1),xp=GREATEST(0,xp+$2),updated_at=NOW() WHERE telegram_id=$3`, [coins, xp, id]);
    if (skin) await q(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::text[])),skin=$1 WHERE telegram_id=$2`, [skin, id]);
    if (field) await q(`UPDATE players SET owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$1]::text[])),field_skin=$1 WHERE telegram_id=$2`, [field, id]);
    await logAdmin(adminId, "grant", id, { coins, xp, skin, field });
    const r = await q(`SELECT ${PLAYER_COLS} FROM players WHERE telegram_id=$1`, [id]);
    res.json({ ok: true, player: r.rows[0] });
  }));

  // Забрать скин или поле (например, у читера, получившего сезонную награду)
  app.post("/api/admin/player/revoke", admin(async (req, res, { adminId }) => {
    const id = String(req.body?.telegram_id || "").trim();
    if (!isId(id)) return bad(res, "Bad telegram_id");
    const skin = String(req.body?.skin || ""), field = String(req.body?.field || "");
    if (!skin && !field) return bad(res, "Нечего забирать");
    if (skin === "classic" || field === "classic") return bad(res, "Классику забрать нельзя");
    if (skin) await q(`UPDATE players SET owned_skins=array_remove(owned_skins,$1), skin=CASE WHEN skin=$1 THEN 'classic' ELSE skin END WHERE telegram_id=$2`, [skin, id]);
    if (field) await q(`UPDATE players SET owned_fields=array_remove(owned_fields,$1), field_skin=CASE WHEN field_skin=$1 THEN 'classic' ELSE field_skin END WHERE telegram_id=$2`, [field, id]);
    await logAdmin(adminId, "revoke", id, { skin, field });
    res.json({ ok: true });
  }));

  app.post("/api/admin/player/ban", admin(async (req, res, { adminId }) => {
    const id = String(req.body?.telegram_id || "").trim();
    if (!isId(id)) return bad(res, "Bad telegram_id");
    if (isAdminId(id)) return bad(res, "Администратора банить нельзя");
    const ban = req.body?.banned !== false, reason = String(req.body?.reason || "").slice(0, 200);
    const r = await q(`UPDATE players SET banned=$2, ban_reason=$3, banned_at=CASE WHEN $2::boolean THEN NOW() ELSE NULL END, updated_at=NOW() WHERE telegram_id=$1 RETURNING ${PLAYER_COLS}`,
      [id, ban, ban ? reason : ""]);
    if (!r.rowCount) return bad(res, "Player not found", 404);
    await logAdmin(adminId, ban ? "ban" : "unban", id, { reason });
    res.json({ ok: true, player: r.rows[0] });
  }));

  // Обнуление: scores — рекорды и очки сезонов; full — ещё и монеты, XP, достижения, задания (покупки за Stars остаются)
  app.post("/api/admin/player/reset", admin(async (req, res, { adminId }) => {
    const id = String(req.body?.telegram_id || "").trim();
    if (!isId(id)) return bad(res, "Bad telegram_id");
    const scope = req.body?.scope === "full" ? "full" : "scores";
    const ex = await q(`SELECT 1 FROM players WHERE telegram_id=$1`, [id]);
    if (!ex.rowCount) return bad(res, "Player not found", 404);
    await q(`UPDATE players SET best_score=0, best_nowalls=0, best_combo=0, updated_at=NOW() WHERE telegram_id=$1`, [id]);
    await q(`DELETE FROM season_scores WHERE telegram_id=$1`, [id]);
    if (scope === "full") {
      await q(`UPDATE players SET coins=0, xp=0, games_played=0, total_apples=0, daily_streak=0, achievements='{}'::jsonb, missions='{}'::jsonb,
               owned_artifacts=ARRAY['magnet']::text[], equipped_artifact='magnet' WHERE telegram_id=$1`, [id]);
    }
    await logAdmin(adminId, "reset_" + scope, id);
    const r = await q(`SELECT ${PLAYER_COLS} FROM players WHERE telegram_id=$1`, [id]);
    res.json({ ok: true, player: r.rows[0] });
  }));

  // ---------- Сезон ----------
  app.get("/api/admin/season", admin(async (req, res) => {
    const cur = await S.ensureSeason();
    const [top, stat, hist] = await Promise.all([
      q(`SELECT ss.telegram_id, ss.score, p.first_name, p.username, p.banned FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
         WHERE ss.season_id=$1 AND ss.score>0 ORDER BY ss.score DESC, ss.telegram_id LIMIT 10`, [cur.id]),
      q(`SELECT COUNT(*)::int AS players FROM season_scores WHERE season_id=$1 AND score>0`, [cur.id]),
      q(`SELECT s.id, s.name, s.starts_at, s.ends_at, s.notified,
                (SELECT COUNT(*)::int FROM season_scores x WHERE x.season_id=s.id AND x.score>0) AS players,
                (SELECT p.first_name || '|' || ss.score FROM season_scores ss JOIN players p ON p.telegram_id=ss.telegram_id
                  WHERE ss.season_id=s.id AND NOT p.banned ORDER BY ss.score DESC LIMIT 1) AS winner
         FROM seasons s WHERE s.ends_at<=NOW() ORDER BY s.starts_at DESC LIMIT 10`)
    ]);
    res.json({
      season: { ...cur, number: await S.seasonNumber(cur.starts_at), players: stat.rows[0].players },
      top: top.rows, rewards: S.seasonRewards(cur),
      history: hist.rows.map((h) => { const [name, score] = String(h.winner || "|").split("|"); return { ...h, winner: h.winner ? { name, score: Number(score) } : null }; })
    });
  }));

  app.post("/api/admin/season/close", admin(async (req, res, { adminId }) => {
    if (req.body?.confirm !== true) return bad(res, "Нужно подтверждение");
    const { closed, next } = await S.closeCurrentSeason();
    await logAdmin(adminId, "season_close", String(closed.id), { name: closed.name });
    S.notifySeasonWinners().catch((e) => console.error("season notify:", e.message)); // победителям уйдёт сообщение от бота
    res.json({ ok: true, closed, next });
  }));

  // ---------- Платежи ----------
  app.get("/api/admin/payments", admin(async (req, res) => {
    const lim = Math.min(100, Math.max(1, Number(req.query.limit) || 50)), off = Math.max(0, Number(req.query.offset) || 0);
    const where = req.query.status === "refunded" ? "WHERE pay.refunded_at IS NOT NULL" : req.query.status === "paid" ? "WHERE pay.refunded_at IS NULL" : "";
    const r = await q(
      `SELECT pay.charge_id, pay.telegram_id, pay.skin, pay.stars, pay.created_at, pay.refunded_at, p.first_name, p.username
       FROM payments pay LEFT JOIN players p ON p.telegram_id=pay.telegram_id ${where} ORDER BY pay.created_at DESC LIMIT $1 OFFSET $2`, [lim, off]);
    res.json({ payments: r.rows.map((x) => ({ ...x, item: itemName(x.skin) })), refunds_enabled: !!config.BOT_TOKEN });
  }));

  app.post("/api/admin/payments/refund", admin(async (req, res, { adminId }) => {
    const chargeId = String(req.body?.charge_id || "");
    if (!chargeId) return bad(res, "Bad charge_id");
    if (!config.BOT_TOKEN) return bad(res, "BOT_TOKEN не задан");
    try {
      const pay = await Pay.refundPayment(chargeId, adminId);
      await logAdmin(adminId, "refund", pay.telegram_id, { charge_id: chargeId, stars: pay.stars, item: pay.skin });
      res.json({ ok: true });
    } catch (e) {
      if (e.status) return bad(res, e.message, e.status);
      throw e;
    }
  }));

  app.get("/api/admin/payment-errors", admin(async (req, res) => {
    const all = req.query.all === "1";
    const r = await q(`SELECT e.*, p.first_name, p.username FROM payment_errors e LEFT JOIN players p ON p.telegram_id=e.telegram_id
                       ${all ? "" : "WHERE NOT e.resolved"} ORDER BY e.created_at DESC LIMIT 100`);
    res.json({
      errors: r.rows.map((e) => {
        const it = Pay.parseItemPayload(e.payload, e.telegram_id);
        return { ...e, raw: undefined, item: it ? `${it.def.emoji} ${it.def.name}${it.kind === "field" ? " (поле)" : ""}` : "", can_grant: !!(it && e.charge_id) };
      })
    });
  }));

  // Выдать покупку вручную по записи об ошибке (деньги списаны, а предмет не выдан)
  app.post("/api/admin/payment-errors/:id/grant", admin(async (req, res, { adminId }) => {
    const r = await q(`SELECT * FROM payment_errors WHERE id=$1`, [Number(req.params.id) || 0]);
    const e = r.rows[0];
    if (!e) return bad(res, "Not found", 404);
    const it = Pay.parseItemPayload(e.payload, e.telegram_id);
    if (!it || !e.charge_id) return bad(res, "Эту запись нельзя выдать автоматически — используй «Выдать предмет» в игроках");
    const fresh = await Pay.grantPaidItem(e.telegram_id, it.kind, it.def, e.charge_id, e.stars || it.def.price, it.ref || 0);
    await q(`UPDATE payment_errors SET resolved=TRUE WHERE id=$1`, [e.id]);
    await logAdmin(adminId, "payment_manual_grant", e.telegram_id, { error_id: e.id, charge_id: e.charge_id, item: it.def.id, fresh });
    res.json({ ok: true, fresh });
  }));
  app.post("/api/admin/payment-errors/:id/resolve", admin(async (req, res, { adminId }) => {
    const r = await q(`UPDATE payment_errors SET resolved=TRUE WHERE id=$1 RETURNING id`, [Number(req.params.id) || 0]);
    if (!r.rowCount) return bad(res, "Not found", 404);
    await logAdmin(adminId, "payment_error_resolve", String(r.rows[0].id));
    res.json({ ok: true });
  }));

  // ---------- Рассылка ----------
  app.get("/api/admin/broadcast/count", admin(async (req, res) => {
    const a = String(req.query.audience || "all");
    if (!Bot.AUDIENCES[a]) return bad(res, "Bad audience");
    res.json({ count: await Bot.countAudience(a) });
  }));
  app.get("/api/admin/broadcasts", admin(async (_req, res) => {
    const r = await q(`SELECT * FROM broadcasts ORDER BY id DESC LIMIT 20`);
    res.json({ broadcasts: r.rows, running: Bot.broadcastRunning() });
  }));
  app.post("/api/admin/broadcast", admin(async (req, res, { adminId }) => {
    if (!config.BOT_TOKEN) return bad(res, "BOT_TOKEN не задан");
    const text = String(req.body?.text || "").trim(), audience = String(req.body?.audience || "all"), withButton = req.body?.with_button !== false;
    if (!text || text.length > 3500) return bad(res, "Текст: от 1 до 3500 символов");
    if (!Bot.AUDIENCES[audience]) return bad(res, "Bad audience");
    if (req.body?.test) { // тест — только самому админу
      const r = await Bot.sendTest(adminId, text, withButton);
      return res.json({ ok: r === "sent", result: r });
    }
    if (req.body?.confirm !== true) return bad(res, "Нужно подтверждение");
    try {
      const b = await Bot.startBroadcast({ text, audience, withButton, adminId });
      await logAdmin(adminId, "broadcast", String(b.id), { audience, total: b.total, text: text.slice(0, 120) });
      res.json({ ok: true, ...b });
    } catch (e) {
      if (e.status) return bad(res, e.message, e.status);
      throw e;
    }
  }));
  // Новость обновления: статус и ручная отправка (если автоматическая выключена или нужно повторить)
  app.get("/api/admin/news", admin(async (_req, res) => res.json(await require("../jobs").announceStatus())));
  app.post("/api/admin/news/send", admin(async (req, res, { adminId }) => {
    if (req.body?.confirm !== true) return bad(res, "Нужно подтверждение");
    try {
      const r = await require("../jobs").announceUpdate({ force: true, adminId });
      if (r.skipped) return bad(res, r.skipped === "busy" ? "Другая рассылка ещё идёт" : "Нечего отправлять");
      await logAdmin(adminId, "news_send", String(r.id), { total: r.total });
      res.json(r);
    } catch (e) { if (e.status) return bad(res, e.message, e.status); throw e; }
  }));
  app.post("/api/admin/broadcast/cancel", admin(async (_req, res, { adminId }) => {
    const ok = Bot.cancelBroadcast();
    if (ok) await logAdmin(adminId, "broadcast_cancel");
    res.json({ ok });
  }));

  // ---------- Удержание и воронка ----------
  // Когорты по дню регистрации: сколько вернулось на следующий день (D1), через 3 и 7 дней (по таблице activity)
  app.get("/api/admin/retention", admin(async (req, res) => {
    const tz = config.DAILY_TZ, days = Math.min(30, Math.max(7, Number(req.query.days) || 21));
    const cohorts = await q(
      `WITH c AS (
         SELECT telegram_id, (created_at AT TIME ZONE $1)::date AS d FROM players
         WHERE (created_at AT TIME ZONE $1)::date >= (NOW() AT TIME ZONE $1)::date - $2::int
       )
       SELECT to_char(c.d,'YYYY-MM-DD') AS day, COUNT(*)::int AS size,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity a WHERE a.telegram_id=c.telegram_id AND a.day=to_char(c.d+1,'YYYY-MM-DD')))::int AS d1,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity a WHERE a.telegram_id=c.telegram_id AND a.day=to_char(c.d+3,'YYYY-MM-DD')))::int AS d3,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity a WHERE a.telegram_id=c.telegram_id AND a.day=to_char(c.d+7,'YYYY-MM-DD')))::int AS d7,
         (c.d + 1 <= (NOW() AT TIME ZONE $1)::date) AS d1_ready, (c.d + 3 <= (NOW() AT TIME ZONE $1)::date) AS d3_ready, (c.d + 7 <= (NOW() AT TIME ZONE $1)::date) AS d7_ready
       FROM c GROUP BY c.d ORDER BY c.d DESC`, [tz, days]);
    // Воронка за тот же период: зарегистрировались → сыграли → 5+ игр → вернулись на другой день → платили
    const f = await q(
      `WITH c AS (SELECT telegram_id, games_played, (created_at AT TIME ZONE $1)::date AS d FROM players
                  WHERE (created_at AT TIME ZONE $1)::date >= (NOW() AT TIME ZONE $1)::date - $2::int)
       SELECT COUNT(*)::int AS registered,
              COUNT(*) FILTER (WHERE games_played>0)::int AS played,
              COUNT(*) FILTER (WHERE games_played>=5)::int AS played5,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activity a WHERE a.telegram_id=c.telegram_id AND a.day>to_char(c.d,'YYYY-MM-DD')))::int AS returned,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM payments p WHERE p.telegram_id=c.telegram_id AND p.refunded_at IS NULL))::int AS paid
       FROM c`, [tz, days]);
    res.json({ days, cohorts: cohorts.rows, funnel: f.rows[0] });
  }));

  // ---------- Античит: подозрительные забеги ----------
  app.get("/api/admin/suspicious", admin(async (req, res) => {
    const r = await q(
      `SELECT g.id, g.telegram_id, g.score, g.mode, g.diff, g.kind, g.apples, g.eff, g.flags, g.created_at, g.run_log IS NOT NULL AS has_log, p.first_name, p.username, p.banned
       FROM game_log g JOIN players p ON p.telegram_id=g.telegram_id WHERE g.flags<>'' ORDER BY g.created_at DESC LIMIT 100`);
    res.json({ runs: r.rows, threshold: require("../anticheat").EFF_FLAG });
  }));
  // Реплей любого забега — для разбора в админке (открывается в игре по ссылке /?areplay=<id>)
  app.get("/api/admin/game/:id/replay", admin(async (req, res) => {
    const r = await q(`SELECT g.score, g.cfg, g.ticks, g.run_log, p.first_name, p.username, p.skin FROM game_log g JOIN players p ON p.telegram_id=g.telegram_id
                       WHERE g.id=$1 AND g.run_log IS NOT NULL`, [Number(req.params.id) || 0]);
    if (!r.rowCount) return bad(res, "Replay not found", 404);
    const x = r.rows[0];
    res.json({ name: x.first_name || x.username || "Игрок", score: x.score, cfg: x.cfg, ticks: x.ticks, log: x.run_log, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin) });
  }));

  // ---------- События ----------
  app.get("/api/admin/events", admin(async (_req, res) => {
    const r = await q(`SELECT * FROM events WHERE ends_at > NOW() - INTERVAL '7 days' ORDER BY starts_at DESC LIMIT 30`);
    res.json({ events: r.rows, auto: await Ev.active() });
  }));
  app.post("/api/admin/events", admin(async (req, res, { adminId }) => {
    const title = String(req.body?.title || "").trim().slice(0, 60), mult = Number(req.body?.coin_mult), hours = Number(req.body?.hours);
    if (!title) return bad(res, "Нужно название");
    if (!(mult >= 1.1 && mult <= 5)) return bad(res, "Множитель: от 1.1 до 5");
    if (!(hours >= 0.5 && hours <= 24 * 14)) return bad(res, "Длительность: от 0.5 часа до 14 дней");
    const r = await q(`INSERT INTO events(title, coin_mult, starts_at, ends_at, created_by) VALUES($1,$2,NOW(),NOW()+($3::text||' hours')::interval,$4) RETURNING *`, [title, mult, String(hours), adminId]);
    Ev.resetCache();
    await logAdmin(adminId, "event_create", String(r.rows[0].id), { title, mult, hours });
    res.json({ ok: true, event: r.rows[0] });
  }));
  app.post("/api/admin/events/:id/stop", admin(async (req, res, { adminId }) => {
    const r = await q(`UPDATE events SET ends_at=NOW() WHERE id=$1 AND ends_at>NOW() RETURNING id`, [Number(req.params.id) || 0]);
    if (!r.rowCount) return bad(res, "Not found", 404);
    Ev.resetCache();
    await logAdmin(adminId, "event_stop", String(r.rows[0].id));
    res.json({ ok: true });
  }));

  // ---------- Журнал ----------
  app.get("/api/admin/log", admin(async (_req, res) => {
    const r = await q(`SELECT l.*, a.first_name AS admin_name FROM admin_log l LEFT JOIN players a ON a.telegram_id=l.admin_id ORDER BY l.id DESC LIMIT 100`);
    res.json({ log: r.rows });
  }));
};
