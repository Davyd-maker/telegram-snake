// Головоломка дня, «Подземелье», уровни игроков (редактор), питомцы, колесо удачи, подарки друзьям, праздники.
const crypto = require("crypto");
const config = require("../config");
const { pool } = require("../db");
const { player, admin, logAdmin } = require("../middleware");
const P = require("../players");
const C = require("../catalog");
const R = require("../replay");
const N = require("../notify");
const Holiday = require("../seasonal");
const Engine = require("../../public/engine.js");
const { FRIENDS_CTE } = require("../friends");

const q = (sql, params) => pool.query(sql, params);
const nameOf = (x) => x.first_name || x.username || "Игрок";
const lbItem = (x, uid, extra = {}) => ({ name: nameOf(x), skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin), is_me: x.telegram_id === uid, ...extra });
const MAX_LEVELS_PER_AUTHOR = 15;
// название уровня: буквы, цифры, пробелы и простая пунктуация, 3–24 символа
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);

module.exports = (app) => {
  // ---------- Головоломка дня ----------
  app.get("/api/puzzle", player(async (req, res, { uid }) => {
    const day = R.dayNow(), seed = R.puzzleSeed(day), L = Engine.makePuzzle(seed);
    const top = await q(`SELECT d.ticks, d.stars, d.telegram_id, pl.first_name, pl.username, pl.skin FROM puzzle_scores d JOIN players pl ON pl.telegram_id=d.telegram_id
                         WHERE d.day=$1 AND NOT pl.banned ORDER BY d.ticks, d.created_at LIMIT 20`, [day]);
    const mine = (await q(`SELECT ticks, stars, attempts FROM puzzle_scores WHERE day=$1 AND telegram_id=$2`, [day, uid])).rows[0];
    let me = null;
    if (mine) {
      const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM puzzle_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.day=$1 AND NOT pl.banned AND d.ticks<$2`, [day, mine.ticks]);
      me = { ...mine, rank: rk.rows[0].rank };
    }
    const solvers = (await q(`SELECT COUNT(*)::int AS n FROM puzzle_scores WHERE day=$1`, [day])).rows[0].n;
    res.json({ day, num: R.puzzleNumber(day), fruits: L.foods.length, par: L.par, par2: L.par2, solvers, me,
      walls: L.walls.map((c) => c.y * Engine.N + c.x), hole: L.holeAt, first: L.foods[0],
      leaderboard: top.rows.map((x) => lbItem(x, uid, { score: x.ticks, stars: x.stars })) });
  }, { allowBanned: true }));

  // ---------- Подземелье: рейтинг по этажам ----------
  app.get("/api/dungeon", player(async (req, res, { uid, p }) => {
    const top = await q(`SELECT pl.telegram_id, pl.first_name, pl.username, pl.skin, pl.best_floor, COALESCE(m.best,0) AS best FROM players pl
                         LEFT JOIN mode_scores m ON m.telegram_id=pl.telegram_id AND m.mode='dungeon'
                         WHERE pl.best_floor>0 AND NOT pl.banned ORDER BY pl.best_floor DESC, best DESC, pl.telegram_id LIMIT 20`);
    let me = null;
    if (Number(p.best_floor) > 0) {
      const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM players WHERE NOT banned AND best_floor>$1`, [p.best_floor]);
      me = { rank: rk.rows[0].rank, floor: Number(p.best_floor) };
    }
    res.json({ upgrades: Engine.UPGRADES, me, leaderboard: top.rows.map((x) => lbItem(x, uid, { score: x.best_floor, best: x.best })) });
  }, { allowBanned: true }));

  // ---------- Уровни игроков ----------
  // массив стен из БД (на всякий случай — и из текстового вида "{1,2,3}")
  const wallsOf = (w) => (Array.isArray(w) ? w.map(Number) : String(w || "").replace(/[{}]/g, "").split(",").filter(Boolean).map(Number));
  const levelRow = (x, uid) => ({ id: x.id, name: x.name, author: nameOf(x), target: x.target, walls: wallsOf(x.walls), plays: x.plays, wins: x.wins, likes: x.likes,
    liked: !!x.liked, mine: x.author_id === uid, won: !!x.won, created_at: x.created_at, link: P.startLink("lv_" + x.id) });
  const LEVEL_SELECT = `SELECT c.*, pl.first_name, pl.username,
      EXISTS(SELECT 1 FROM custom_likes l WHERE l.level_id=c.id AND l.telegram_id=$1) AS liked,
      EXISTS(SELECT 1 FROM custom_wins w WHERE w.level_id=c.id AND w.telegram_id=$1) AS won
    FROM custom_levels c JOIN players pl ON pl.telegram_id=c.author_id`;
  // tab: week — подборка недели (лайки за 7 дней), top — по лайкам за всё время, new — новые, mine — мои
  app.get("/api/custom", player(async (req, res, { uid }) => {
    const tab = ["week", "top", "new", "mine"].includes(req.query.tab) ? req.query.tab : "week";
    const where = tab === "mine" ? "c.author_id=$1" : "NOT c.hidden AND NOT pl.banned" + (tab === "week" ? " AND c.created_at > NOW() - INTERVAL '7 days'" : "");
    const order = tab === "new" || tab === "mine" ? "c.created_at DESC" : tab === "week" ? "c.likes DESC, c.wins DESC, c.created_at DESC" : "c.likes DESC, c.plays DESC";
    const r = await q(`${LEVEL_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 30`, [uid]);
    res.json({ tab, levels: r.rows.map((x) => levelRow(x, uid)), max_walls: Engine.CUSTOM_MAX_WALLS, max_levels: MAX_LEVELS_PER_AUTHOR });
  }, { allowBanned: true }));
  app.get("/api/custom/:id", player(async (req, res, { uid }) => {
    const r = await q(`${LEVEL_SELECT} WHERE c.id=$2 AND (NOT c.hidden OR c.author_id=$1)`, [uid, String(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: "Level not found" });
    res.json({ level: levelRow(r.rows[0], uid) });
  }, { allowBanned: true }));
  app.post("/api/custom/save", player(async (req, res, { uid }) => {
    const name = cleanName(req.body?.name);
    if (name.length < 3) return res.status(400).json({ error: "Name: 3–24 characters" });
    const chk = Engine.customCheck({ w: req.body?.walls, t: req.body?.target });
    if (!chk.ok) return res.status(400).json({ error: "Too little free space" });
    if (chk.walls < 4) return res.status(400).json({ error: "Draw at least 4 walls" });
    const cnt = (await q(`SELECT COUNT(*)::int AS n FROM custom_levels WHERE author_id=$1 AND NOT hidden`, [uid])).rows[0].n;
    if (cnt >= MAX_LEVELS_PER_AUTHOR) return res.status(400).json({ error: "Too many levels" });
    const id = crypto.randomBytes(4).toString("hex");
    await q(`INSERT INTO custom_levels(id, author_id, name, walls, target) VALUES($1,$2,$3,$4::int[],$5)`, [id, uid, name, chk.norm.w, chk.norm.t]);
    res.json({ ok: true, id, link: P.startLink("lv_" + id) });
  }, { limit: [10, 60000] }));
  app.post("/api/custom/like", player(async (req, res, { uid }) => {
    const id = String(req.body?.id || "");
    const L = (await q(`SELECT author_id FROM custom_levels WHERE id=$1 AND NOT hidden`, [id])).rows[0];
    if (!L) return res.status(404).json({ error: "Level not found" });
    if (L.author_id === uid) return res.status(400).json({ error: "Own level" });
    const ins = await q(`INSERT INTO custom_likes(level_id, telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [id, uid]);
    if (ins.rowCount) await q(`UPDATE custom_levels SET likes=likes+1 WHERE id=$1`, [id]);
    else { await q(`DELETE FROM custom_likes WHERE level_id=$1 AND telegram_id=$2`, [id, uid]); await q(`UPDATE custom_levels SET likes=GREATEST(0,likes-1) WHERE id=$1`, [id]); }
    const r = (await q(`SELECT likes FROM custom_levels WHERE id=$1`, [id])).rows[0];
    res.json({ ok: true, liked: !!ins.rowCount, likes: r.likes });
  }, { limit: [60, 60000] }));
  app.post("/api/custom/delete", player(async (req, res, { uid }) => {
    const r = await q(`UPDATE custom_levels SET hidden=TRUE WHERE id=$1 AND author_id=$2 RETURNING 1`, [String(req.body?.id || ""), uid]);
    if (!r.rowCount) return res.status(404).json({ error: "Level not found" });
    res.json({ ok: true });
  }, { limit: [20, 60000] }));

  // ---------- Питомец ----------
  app.post("/api/pet/adopt", player(async (req, res, { p, uid, u }) => {
    const id = String(req.body?.pet || "");
    if (!C.PET_BY_ID[id]) return res.status(400).json({ error: "Bad pet" });
    // первый питомец — бесплатно; сменить — 2000 монет (опыт сохраняется)
    if (p.pet && p.pet !== id) {
      const r = await q(`UPDATE players SET pet=$1, coins=coins-2000 WHERE telegram_id=$2 AND coins>=2000 RETURNING 1`, [id, uid]);
      if (!r.rowCount) return res.status(400).json({ error: "Not enough coins" });
    } else await q(`UPDATE players SET pet=$1 WHERE telegram_id=$2`, [id, uid]);
    res.json({ ok: true, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [10, 60000] }));
  app.post("/api/pet/feed", player(async (req, res, { p, uid, u }) => {
    if (!p.pet) return res.status(400).json({ error: "No pet" });
    const r = await q(`UPDATE players SET pet_fed_day=$1, pet_xp=pet_xp+$2 WHERE telegram_id=$3 AND pet_fed_day<>$1 RETURNING 1`, [p.today, C.PET_FEED_XP, uid]);
    if (!r.rowCount) return res.status(400).json({ error: "Already fed today" });
    res.json({ ok: true, xp: C.PET_FEED_XP, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [10, 60000] }));

  // ---------- Колесо удачи: раз в день ----------
  app.post("/api/wheel", player(async (req, res, { p, uid, u }) => {
    const claim = await q(`UPDATE players SET wheel_day=$1 WHERE telegram_id=$2 AND wheel_day<>$1 RETURNING 1`, [p.today, uid]);
    if (!claim.rowCount) return res.status(400).json({ error: "Already spun today" });
    const total = C.WHEEL.reduce((a, x) => a + x.w, 0);
    let roll = crypto.randomInt(total), idx = 0;
    while (roll >= C.WHEEL[idx].w) { roll -= C.WHEEL[idx].w; idx++; }
    const seg = C.WHEEL[idx], hol = Holiday.current(p.today);
    let prize = { kind: seg.kind, n: seg.n };
    if (seg.kind === "coins") await q(`UPDATE players SET coins=coins+$1 WHERE telegram_id=$2`, [seg.n, uid]);
    else if (seg.kind === "petxp") {
      if (p.pet) await q(`UPDATE players SET pet_xp=pet_xp+$1 WHERE telegram_id=$2`, [seg.n, uid]);
      else { prize = { kind: "coins", n: 300, was: "petxp" }; await q(`UPDATE players SET coins=coins+300 WHERE telegram_id=$1`, [uid]); }
    } else if (seg.kind === "candy") {
      if (hol) await q(`UPDATE players SET candies=candies+$1 WHERE telegram_id=$2`, [seg.n, uid]);
      else { prize = { kind: "coins", n: 300, was: "candy" }; await q(`UPDATE players SET coins=coins+300 WHERE telegram_id=$1`, [uid]); }
    } else if (seg.kind === "chest") { // аксессуар, которого ещё нет; если есть все — 2000 монет
      const have = p.owned_accessories || [], pool2 = C.ACCESSORY_CATALOG.filter((a) => a.currency === "coins" && !have.includes(a.id));
      if (pool2.length) {
        const a = pool2[crypto.randomInt(pool2.length)];
        await q(`UPDATE players SET owned_accessories=ARRAY(SELECT DISTINCT unnest(owned_accessories || ARRAY[$1]::TEXT[])), chests=chests+1 WHERE telegram_id=$2`, [a.id, uid]);
        prize = { kind: "chest", accessory: a };
      } else { prize = { kind: "coins", n: 2000, was: "chest" }; await q(`UPDATE players SET coins=coins+2000 WHERE telegram_id=$1`, [uid]); }
    }
    res.json({ ok: true, index: idx, prize, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [10, 60000] }));

  // ---------- Друзья и подарки ----------
  app.get("/api/friends", player(async (req, res, { uid }) => {
    const r = await q(`WITH ${FRIENDS_CTE} SELECT p.telegram_id, p.first_name, p.username, p.skin, p.best_score, p.owned_skins FROM friends f JOIN players p ON p.telegram_id=f.telegram_id
                       WHERE p.telegram_id<>$1 AND NOT p.banned ORDER BY p.best_score DESC LIMIT 50`, [uid]);
    const sent = (await q(`SELECT COALESCE(SUM(coins),0)::int AS n FROM gifts WHERE from_id=$1 AND kind='coins' AND created_at > NOW() - INTERVAL '1 day'`, [uid])).rows[0].n;
    res.json({ friends: r.rows.map((x) => ({ id: x.telegram_id, ...lbItem(x, uid), best: x.best_score, owned_skins: x.owned_skins || [] })),
      gift: { ...C.GIFT, sent_today: sent, left_today: Math.max(0, C.GIFT.sendPerDay - sent) } });
  }, { allowBanned: true }));
  app.post("/api/gift", player(async (req, res, { p, uid, u }) => {
    const to = String(req.body?.to || "");
    if (!to || to === uid) return res.status(400).json({ error: "Bad friend" });
    const fr = await q(`WITH ${FRIENDS_CTE} SELECT p.telegram_id, p.first_name, p.owned_skins FROM friends f JOIN players p ON p.telegram_id=f.telegram_id WHERE p.telegram_id=$2 AND NOT p.banned`, [uid, to]);
    if (!fr.rowCount) return res.status(403).json({ error: "Not a friend" });
    const friend = fr.rows[0], from = p.first_name || p.username || "Друг";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('gift:' || $1))`, [uid]);
      if (req.body?.skin) { // подарить скин за монеты, которого у друга нет
        const sk = C.SKIN_BY_ID[String(req.body.skin)];
        if (!sk || sk.currency !== "coins" || !sk.price) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Bad skin" }); }
        if ((friend.owned_skins || []).includes(sk.id)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Friend already has it" }); }
        const pay = await client.query(`UPDATE players SET coins=coins-$1 WHERE telegram_id=$2 AND coins>=$1 RETURNING 1`, [sk.price, uid]);
        if (!pay.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Not enough coins" }); }
        await client.query(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])) WHERE telegram_id=$2`, [sk.id, to]);
        await client.query(`INSERT INTO gifts(from_id, to_id, kind, item, coins) VALUES($1,$2,'skin',$3,$4)`, [uid, to, sk.id, sk.price]);
        await client.query("COMMIT");
        N.toPlayer(to, "gift_skin", { name: from, emoji: sk.emoji, skin: sk.name }, { optional: false }).catch(() => {});
        return res.json({ ok: true, kind: "skin", skin: sk.id, player: P.responsePlayer(await P.getPlayer(u)) });
      }
      const coins = Math.floor(Number(req.body?.coins) || 0);
      if (coins < C.GIFT.min || coins > C.GIFT.max) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Bad amount" }); }
      const sent = (await client.query(`SELECT COALESCE(SUM(coins),0)::int AS n FROM gifts WHERE from_id=$1 AND kind='coins' AND created_at > NOW() - INTERVAL '1 day'`, [uid])).rows[0].n;
      if (sent + coins > C.GIFT.sendPerDay) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Daily gift limit" }); }
      const got = (await client.query(`SELECT COALESCE(SUM(coins),0)::int AS n FROM gifts WHERE to_id=$1 AND kind='coins' AND created_at > NOW() - INTERVAL '1 day'`, [to])).rows[0].n;
      if (got + coins > C.GIFT.receivePerDay) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Friend got enough gifts today" }); }
      const pay = await client.query(`UPDATE players SET coins=coins-$1 WHERE telegram_id=$2 AND coins>=$1 RETURNING 1`, [coins, uid]);
      if (!pay.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Not enough coins" }); }
      await client.query(`UPDATE players SET coins=coins+$1 WHERE telegram_id=$2`, [coins, to]);
      await client.query(`INSERT INTO gifts(from_id, to_id, kind, coins) VALUES($1,$2,'coins',$3)`, [uid, to, coins]);
      await client.query("COMMIT");
      N.toPlayer(to, "gift_coins", { name: from, coins }, { optional: false }).catch(() => {});
      res.json({ ok: true, kind: "coins", coins, player: P.responsePlayer(await P.getPlayer(u)) });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  }, { limit: [20, 60000] }));

  // ---------- Праздник: админ может включить досрочно / выключить ----------
  app.get("/api/admin/holiday", admin(async (_req, res) => {
    await Holiday.refresh();
    res.json({ current: Holiday.current(), forced: Holiday.forcedValue(), holidays: Holiday.HOLIDAYS, next: Holiday.next() });
  }));
  app.post("/api/admin/holiday", admin(async (req, res, { adminId }) => {
    const v = String(req.body?.value || "");
    const cur = await Holiday.setForced(v);
    await logAdmin(adminId, "holiday", v || "auto");
    res.json({ ok: true, current: cur, forced: Holiday.forcedValue() });
  }));
};
