const crypto = require("crypto");
const config = require("../config");
const { pool } = require("../db");
const { player } = require("../middleware");
const P = require("../players");
const C = require("../catalog");
const S = require("../seasons");
const Engine = require("../../public/engine.js");
const R = require("../replay");
const M = require("../missions");
const Pass = require("../pass");
const Ev = require("../events");
const AC = require("../anticheat");
const N = require("../notify");
const Holiday = require("../seasonal");
// режимы, доступные в обычном забеге: видимые + «Подземелье»
const FREE_MODES = Object.keys(Engine.MODES).filter((m) => !Engine.MODES[m].hidden || m === "dungeon");

const q = (sql, params) => pool.query(sql, params);
const artLevelOf = (p, id) => Math.max(1, Math.min(Engine.MAX_ART_LEVEL, Number((p.artifact_levels || {})[id]) || 1));
const nameOf = (x) => x.first_name || x.username || "Игрок";

// Призрак: забег из game_log, по которому можно проиграть змейку рядом с игроком
async function ghostFromGame(gameId, label) {
  if (!gameId) return null;
  const g = await q(`SELECT g.score, g.ticks, g.run_log, g.cfg, p.first_name, p.username, p.skin FROM game_log g JOIN players p ON p.telegram_id=g.telegram_id
                     WHERE g.id=$1 AND g.verified AND g.run_log IS NOT NULL`, [gameId]);
  const x = g.rows[0];
  return x ? { label: label || nameOf(x), score: x.score, ticks: x.ticks, log: x.run_log, cfg: x.cfg, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin) } : null;
}

// Друзья, чей рекорд только что побили (их рекорд был ≥ прошлого рекорда игрока и < нового)
async function notifyBeatenFriends(uid, name, prevBest, score, gameId, cfg) {
  const { rows } = await q(
    `WITH f AS (
       SELECT telegram_id FROM players WHERE referred_by=$1
       UNION SELECT referred_by FROM players WHERE telegram_id=$1 AND referred_by IS NOT NULL
       UNION SELECT CASE WHEN creator_id=$1 THEN accepted_by ELSE creator_id END FROM challenges WHERE accepted_by IS NOT NULL AND (creator_id=$1 OR accepted_by=$1)
     ) SELECT p.telegram_id, p.best_score FROM f JOIN players p ON p.telegram_id=f.telegram_id
       WHERE p.telegram_id<>$1 AND p.best_score>0 AND p.best_score>=$2 AND p.best_score<$3 LIMIT 20`, [uid, prevBest, score]);
  for (const r of rows) {
    // «Охота за рекордом»: у друга кнопка — сыграть на том же поле против призрака этого забега
    let button = null;
    if (gameId && cfg) {
      const id = crypto.randomBytes(5).toString("hex");
      await q(`INSERT INTO challenges(id,creator_id,creator_score,expires_at,seed,mode,diff,art,art_level,game_id) VALUES($1,$2,$3,NOW()+INTERVAL '48 hours',$4,$5,$6,$7,$8,$9)`,
        [id, uid, score, cfg.seed, cfg.mode, cfg.diff, cfg.artifact || "", cfg.artLevel || 1, gameId]).catch(() => {});
      button = { key: "chase_btn", url: P.challengeLink(id) };
    }
    await N.toPlayer(r.telegram_id, "friend_beat", { name, score, mine: r.best_score }, { capped: true, link: button });
  }
}

module.exports = (app) => {
  // Старт забега. Сервер сам выбирает seed и фиксирует настройки в подписанном токене:
  // free — случайное поле; daily — общее поле дня; tournament — поле турнира выходных; challenge — поле вызова друга.
  app.post("/api/run", player(async (req, res, { p, uid }) => {
    const b = req.body || {};
    const kind = ["daily", "challenge", "tournament", "level", "puzzle", "custom"].includes(b.kind) ? b.kind : "free";
    let cfg = {
      mode: FREE_MODES.includes(b.mode) ? b.mode : "classic",
      diff: Engine.DIFFS[b.diff] ? b.diff : "normal",
      artifact: "", artLevel: 1, seed: R.randomSeed()
    };
    const art = String(b.artifact || "");
    if (C.ARTIFACT_BY_ID[art] && (p.owned_artifacts || []).includes(art)) { cfg.artifact = art; cfg.artLevel = artLevelOf(p, art); }
    let ref = "", ghost = null;
    if (kind === "daily") { // честное сравнение: одинаковое поле, без артефактов, обычная сложность
      ref = R.dayNow();
      cfg = { mode: "classic", diff: "normal", artifact: "", artLevel: 1, seed: R.dailySeed(ref) };
      const mine = await q(`SELECT game_id FROM daily_scores WHERE day=$1 AND telegram_id=$2`, [ref, uid]);
      ghost = await ghostFromGame(mine.rows[0]?.game_id, "Твой лучший");
    } else if (kind === "tournament") {
      const t = Ev.currentTour();
      if (!t) return res.status(409).json({ error: "No tournament now" });
      ref = t.id;
      cfg = { mode: t.mode, diff: t.diff, artifact: "", artLevel: 1, seed: t.seed };
      const mine = await q(`SELECT game_id FROM tournament_scores WHERE tour=$1 AND telegram_id=$2`, [ref, uid]);
      ghost = await ghostFromGame(mine.rows[0]?.game_id, "Твой лучший");
    } else if (kind === "level") {
      // уровень открыт, если это первый или пройден предыдущий
      const n = Math.floor(Number(b.ref)) || 0;
      if (n < 1 || n > Engine.LEVELS.length) return res.status(400).json({ error: "Bad level" });
      if (n > 1) {
        const prev = await q(`SELECT 1 FROM level_progress WHERE telegram_id=$1 AND level=$2`, [uid, n - 1]);
        if (!prev.rowCount) return res.status(403).json({ error: "Level locked" });
      }
      ref = String(n);
      cfg = { mode: "level", level: n, diff: "normal", artifact: cfg.artifact, artLevel: cfg.artLevel, seed: R.randomSeed() };
      const mine = await q(`SELECT game_id FROM level_progress WHERE telegram_id=$1 AND level=$2`, [uid, n]);
      ghost = await ghostFromGame(mine.rows[0]?.game_id, "Твой лучший");
      if (ghost && ghost.cfg) cfg.seed = Number(ghost.cfg.seed) || cfg.seed; // с призраком — на том же поле
    } else if (kind === "puzzle") { // головоломка дня: одно поле и одни фрукты у всех, без артефактов
      ref = R.dayNow();
      cfg = { mode: "puzzle", diff: "normal", artifact: "", artLevel: 1, seed: R.puzzleSeed(ref) };
      const mine = await q(`SELECT game_id FROM puzzle_scores WHERE day=$1 AND telegram_id=$2`, [ref, uid]);
      ghost = await ghostFromGame(mine.rows[0]?.game_id, "Твой лучший");
    } else if (kind === "custom") { // уровень, нарисованный игроком
      const L = (await q(`SELECT id, walls, target FROM custom_levels WHERE id=$1 AND NOT hidden`, [String(b.ref || "")])).rows[0];
      if (!L) return res.status(404).json({ error: "Level not found" });
      ref = L.id;
      cfg = { mode: "custom", diff: "normal", artifact: "", artLevel: 1, seed: R.randomSeed(), custom: { w: Array.isArray(L.walls) ? L.walls : String(L.walls || "").replace(/[{}]/g, "").split(",").filter(Boolean).map(Number), t: L.target } };
    } else if (kind === "challenge") {
      const r = await q(`SELECT * FROM challenges WHERE id=$1 AND expires_at>NOW()`, [String(b.ref || "")]);
      const c = r.rows[0];
      if (!c) return res.status(404).json({ error: "Challenge not found" });
      ref = c.id;
      cfg = { mode: c.mode, diff: c.diff, artifact: c.art || "", artLevel: c.art_level || 1, seed: c.seed ? Number(c.seed) : R.randomSeed() };
      if (c.seed) ghost = await ghostFromGame(c.game_id); // соперник едет рядом призраком — только на том же поле
    }
    cfg.rules = Engine.RULES; // новые забеги — по последней версии правил
    cfg = Engine.normCfg(cfg);
    const token = R.makeRunToken(uid, { seed: cfg.seed, mode: cfg.mode, diff: cfg.diff, art: cfg.artifact, lvl: cfg.artLevel, rl: cfg.rules, lv: cfg.level || 0, kind, ref, ...(cfg.custom ? { cu: cfg.custom } : {}) });
    res.json({ token, cfg, kind, ghost });
  }, { limit: [40, 60000] }));

  // Финиш забега: клиент присылает лог поворотов, сервер переигрывает забег и сам считает очки и награду
  app.post("/api/score", player(async (req, res, { p, u, uid }) => {
    const body = req.body || {};
    if (body.log === undefined) return res.status(400).json({ error: "Outdated client, reload the game", reload: true });
    const v = R.verifyRun(body.token, uid, body.log, body.ticks);
    if (!v.ok) {
      if (v.t) q(`INSERT INTO game_log(telegram_id, score, mode, diff, apples, verified, reject, seed, ticks, kind) VALUES($1,0,$2,$3,0,FALSE,$4,$5,$6,$7)`,
        [uid, v.t.mode || "classic", v.t.diff || "normal", v.reason, v.t.seed || 0, Math.max(0, Math.floor(Number(body.ticks) || 0)), v.t.kind || "free"]).catch(() => {});
      return res.status(400).json({ error: "Run rejected", reason: v.reason });
    }
    // токен одноразовый: засчитываем только забеги новее предыдущего
    const claim = await q(`UPDATE players SET last_run_ts=$1 WHERE telegram_id=$2 AND last_run_ts<$1 RETURNING 1`, [v.t.ts, uid]);
    if (!claim.rowCount) return res.status(409).json({ error: "Run already counted" });

    const { cfg, sim, t } = v, mode = cfg.mode, score = sim.score, apples = sim.apples, kind = t.kind || "free";
    // В общий рейтинг и сезон идут только обычные забеги: поле челленджа, турнира и вызова известно заранее
    const rated = Engine.isRated(cfg) && kind === "free";
    const modeTracked = !Engine.MODES[mode].rated && cfg.diff !== "easy" && kind === "free";
    let prevBest = 0;
    if (rated) prevBest = Number(p.best_score) || 0;
    else if (modeTracked) {
      const m = await q(`SELECT best FROM mode_scores WHERE telegram_id=$1 AND mode=$2`, [uid, mode]);
      prevBest = Math.max(m.rows[0]?.best || 0, mode === "nowalls" ? Number(p.best_nowalls) || 0 : 0);
    }
    const isRecord = (rated || modeTracked) && score > 0 && prevBest > 0 && score > prevBest;
    const ev = await Ev.active();
    let coins = Engine.reward(sim, cfg, isRecord);
    const bonuses = [];
    if (ev.coinMult > 1 && coins > 0) { coins = Math.floor(coins * ev.coinMult); bonuses.push({ kind: "event", mult: ev.coinMult }); }
    if (mode === ev.featured && kind === "free" && coins > 0) { coins = Math.floor(coins * ev.featuredMult); bonuses.push({ kind: "featured", mult: ev.featuredMult }); }
    const pet = P.petInfo(p);
    if (pet && pet.bonus > 0 && coins > 0) { coins = Math.floor(coins * (1 + pet.bonus)); bonuses.push({ kind: "pet", mult: Math.round((1 + pet.bonus) * 100) / 100, emoji: pet.emoji }); }

    // ежедневный челлендж: первый забег дня даёт бонус
    let daily = null;
    if (kind === "daily" && score > 0) {
      const dr = await q(`INSERT INTO daily_scores(day, telegram_id, best, runs) VALUES($1,$2,$3,1)
                          ON CONFLICT(day, telegram_id) DO UPDATE SET best=GREATEST(daily_scores.best, EXCLUDED.best), runs=daily_scores.runs+1
                          RETURNING best, (xmax = 0) AS first`, [t.ref, uid, score]);
      if (dr.rows[0].first) coins += config.DAILY_CHALLENGE_BONUS;
      const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM daily_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.day=$1 AND NOT pl.banned AND d.best>$2`, [t.ref, dr.rows[0].best]);
      daily = { best: dr.rows[0].best, rank: rk.rows[0].rank, first: dr.rows[0].first, bonus: dr.rows[0].first ? config.DAILY_CHALLENGE_BONUS : 0, improved: dr.rows[0].best === score };
    }
    let tournament = null;
    if (kind === "tournament" && score > 0) {
      const tr = await q(`INSERT INTO tournament_scores(tour, telegram_id, best, runs) VALUES($1,$2,$3,1)
                          ON CONFLICT(tour, telegram_id) DO UPDATE SET best=GREATEST(tournament_scores.best, EXCLUDED.best), runs=tournament_scores.runs+1
                          RETURNING best`, [t.ref, uid, score]);
      const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM tournament_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.tour=$1 AND NOT pl.banned AND d.best>$2`, [t.ref, tr.rows[0].best]);
      tournament = { best: tr.rows[0].best, rank: rk.rows[0].rank, improved: tr.rows[0].best === score };
    }

    // уровень: пройден, если змейка заползла в норку
    let level = null;
    if (kind === "level" && sim.completed) {
      const n = Number(t.ref) || cfg.level;
      const prev = (await q(`SELECT stars, best_ticks FROM level_progress WHERE telegram_id=$1 AND level=$2`, [uid, n])).rows[0];
      const stars = sim.stars, prevStars = prev ? prev.stars : 0;
      let bonus = prev ? 0 : C.levelFirstReward(n);
      if (stars > prevStars) bonus += (stars - prevStars) * C.levelStarReward(n);
      let chapterSkin = null;
      if (!prev && n % 10 === 0) chapterSkin = C.CHAPTERS[n / 10 - 1]?.skin || null; // финал главы — скин
      await q(`INSERT INTO level_progress(telegram_id, level, stars, best_ticks, best_score) VALUES($1,$2,$3,$4,$5)
               ON CONFLICT(telegram_id, level) DO UPDATE SET stars=GREATEST(level_progress.stars, EXCLUDED.stars),
                 best_ticks=LEAST(COALESCE(level_progress.best_ticks, EXCLUDED.best_ticks), EXCLUDED.best_ticks), best_score=GREATEST(level_progress.best_score, EXCLUDED.best_score)`,
        [uid, n, stars, sim.ticks, score]);
      if (chapterSkin) await q(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])) WHERE telegram_id=$2`, [chapterSkin, uid]);
      coins += bonus;
      level = { level: n, stars, prev_stars: prevStars, first: !prev, bonus, chapter_skin: chapterSkin, next: n < Engine.LEVELS.length ? n + 1 : null,
                improved: !prev || sim.ticks < (prev.best_ticks || 1e9) };
    } else if (kind === "level") {
      level = { level: Number(t.ref) || cfg.level, stars: 0, failed: true };
    }

    // головоломка дня: лучший результат — меньше ходов; первое решение за день — бонус
    let puzzle = null;
    if (kind === "puzzle") {
      const num = R.puzzleNumber(t.ref);
      if (sim.completed) {
        const prev = (await q(`SELECT ticks, stars FROM puzzle_scores WHERE day=$1 AND telegram_id=$2`, [t.ref, uid])).rows[0];
        await q(`INSERT INTO puzzle_scores(day, telegram_id, ticks, stars) VALUES($1,$2,$3,$4)
                 ON CONFLICT(day, telegram_id) DO UPDATE SET ticks=LEAST(puzzle_scores.ticks, EXCLUDED.ticks), stars=GREATEST(puzzle_scores.stars, EXCLUDED.stars), attempts=puzzle_scores.attempts+1`,
          [t.ref, uid, sim.ticks, sim.stars]);
        const bonus = prev ? 0 : 100 + sim.stars * 50;
        if (!prev) await q(`UPDATE players SET puzzles_solved=puzzles_solved+1 WHERE telegram_id=$1`, [uid]);
        coins += bonus;
        const best = prev ? Math.min(prev.ticks, sim.ticks) : sim.ticks;
        const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM puzzle_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.day=$1 AND NOT pl.banned AND d.ticks<$2`, [t.ref, best]);
        puzzle = { day: t.ref, num, ticks: sim.ticks, stars: sim.stars, best, rank: rk.rows[0].rank, first: !prev, bonus, improved: !prev || sim.ticks < prev.ticks, par: Engine.makePuzzle(cfg.seed).par };
      } else {
        await q(`UPDATE puzzle_scores SET attempts=attempts+1 WHERE day=$1 AND telegram_id=$2`, [t.ref, uid]);
        puzzle = { day: t.ref, num, failed: true, apples: sim.apples };
      }
    }
    // уровень игрока: счётчики, первое прохождение — +10 монет автору
    let custom = null;
    if (kind === "custom") {
      const L = (await q(`UPDATE custom_levels SET plays=plays+1 WHERE id=$1 RETURNING id, author_id, name`, [t.ref])).rows[0];
      if (L && sim.completed) {
        const w = await q(`INSERT INTO custom_wins(level_id, telegram_id, ticks, stars) VALUES($1,$2,$3,$4)
                           ON CONFLICT(level_id, telegram_id) DO UPDATE SET ticks=LEAST(custom_wins.ticks, EXCLUDED.ticks), stars=GREATEST(custom_wins.stars, EXCLUDED.stars)
                           RETURNING (xmax = 0) AS first`, [L.id, uid, sim.ticks, sim.stars]);
        const first = w.rows[0].first;
        if (first) {
          await q(`UPDATE custom_levels SET wins=wins+1 WHERE id=$1`, [L.id]);
          if (L.author_id !== uid) {
            await q(`UPDATE players SET coins=coins+10 WHERE telegram_id=$1`, [L.author_id]);
            N.toPlayer(L.author_id, "custom_played", { level: L.name, name: p.first_name || "Игрок" }, { capped: true }).catch(() => {});
          }
        }
        custom = { id: L.id, name: L.name, completed: true, stars: sim.stars, first };
      } else if (L) custom = { id: L.id, name: L.name, completed: false };
    }
    // «Подземелье»: рекорд этажа
    let dungeon = null;
    if (mode === "dungeon") dungeon = { floor: sim.floor, upgrades: sim.upgrades, best_floor: Math.max(Number(p.best_floor || 0), sim.floor), record: sim.floor > Number(p.best_floor || 0) };
    // праздник: конфеты за фрукты; питомец растёт от забегов
    const hol = Holiday.current();
    const candies = hol && kind !== "custom" ? Math.min(Holiday.CANDY_PER_RUN_MAX, apples) : 0;
    const petXp = pet ? Math.min(40, apples) : 0;

    // задания (дневные и недельные)
    const st = M.addRun(M.state(p), M.runStats(sim, cfg, kind));
    const gainedXp = Math.max(5, Math.floor(score / 2) + apples * 3);
    await q(
      `UPDATE players SET best_score=GREATEST(best_score,$1), best_nowalls=GREATEST(best_nowalls,$5), coins=coins+$2, missions=$4::jsonb,
         xp=xp+$6, games_played=games_played+$7, total_apples=total_apples+$8, best_combo=GREATEST(best_combo,$9), tutorial_done=TRUE,
         best_floor=GREATEST(best_floor,$10), candies=candies+$11, pet_xp=pet_xp+$12, updated_at=NOW() WHERE telegram_id=$3`,
      [rated ? score : 0, coins, uid, JSON.stringify(st), mode === "nowalls" && modeTracked ? score : 0, gainedXp, score > 0 ? 1 : 0, apples, Math.min(500, sim.bestRun),
       dungeon ? sim.floor : 0, candies, petXp]
    );
    if (modeTracked && score > 0) {
      await q(`INSERT INTO mode_scores(telegram_id, mode, best) VALUES($1,$2,$3) ON CONFLICT(telegram_id, mode) DO UPDATE SET best=GREATEST(mode_scores.best, EXCLUDED.best)`, [uid, mode, score]);
    }
    const season = await S.ensureSeason();
    await Pass.addXp(season.id, uid, gainedXp).catch((e) => console.error("pass xp:", e.message));

    // журнал забега + лог (для призраков, реплеев и разборов в админке) + отметки античита
    let gameId = null;
    const ac = AC.analyze(sim);
    if (score > 0) {
      const gl = await q(`INSERT INTO game_log(telegram_id, score, mode, diff, apples, verified, seed, ticks, cfg, kind, run_log, eff, flags)
                          VALUES($1,$2,$3,$4,$5,TRUE,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
        [uid, score, mode, cfg.diff, apples, cfg.seed, sim.ticks, JSON.stringify(cfg), kind, Engine.encodeLog(v.log), ac.eff, ac.flags]).catch((e) => { console.error("game_log:", e.message); return null; });
      gameId = gl?.rows[0]?.id || null;
      if (gameId && daily?.improved) q(`UPDATE daily_scores SET game_id=$1 WHERE day=$2 AND telegram_id=$3`, [gameId, t.ref, uid]).catch(() => {});
      if (gameId && tournament?.improved) q(`UPDATE tournament_scores SET game_id=$1 WHERE tour=$2 AND telegram_id=$3`, [gameId, t.ref, uid]).catch(() => {});
      if (gameId && level?.improved && !level.failed) q(`UPDATE level_progress SET game_id=$1 WHERE level=$2 AND telegram_id=$3`, [gameId, level.level, uid]).catch(() => {});
      if (gameId && puzzle?.improved) q(`UPDATE puzzle_scores SET game_id=$1 WHERE day=$2 AND telegram_id=$3`, [gameId, t.ref, uid]).catch(() => {});
    }
    if (rated && score > 0) {
      // кто был 10-м в сезоне до этого забега (чтобы сообщить ему, если он вылетел из топ-10)
      const before = await q(`SELECT ss.telegram_id, ss.score FROM season_scores ss JOIN players pl ON pl.telegram_id=ss.telegram_id
                              WHERE ss.season_id=$1 AND NOT pl.banned AND ss.score>0 ORDER BY ss.score DESC, ss.telegram_id LIMIT 10`, [season.id]);
      const wasIn = before.rows.some((r) => r.telegram_id === uid);
      await q(`INSERT INTO season_scores(season_id,telegram_id,score) VALUES($1,$2,$3)
               ON CONFLICT(season_id,telegram_id) DO UPDATE SET score=GREATEST(season_scores.score,EXCLUDED.score)`, [season.id, uid, score]);
      const tenth = before.rows[9];
      if (!wasIn && tenth && score > tenth.score) N.toPlayer(tenth.telegram_id, "top10_out", { rank: 11 }, { capped: true }).catch(() => {});
      // реплей лучшего забега сезона — чтобы можно было посмотреть, как играл лидер
      await q(`INSERT INTO season_replays(season_id, telegram_id, score, cfg, ticks, run_log) VALUES($1,$2,$3,$4::jsonb,$5,$6)
               ON CONFLICT(season_id, telegram_id) DO UPDATE SET score=EXCLUDED.score, cfg=EXCLUDED.cfg, ticks=EXCLUDED.ticks, run_log=EXCLUDED.run_log, created_at=NOW()
               WHERE season_replays.score < EXCLUDED.score`,
        [season.id, uid, score, JSON.stringify(cfg), sim.ticks, Engine.encodeLog(v.log)]).catch((e) => console.error("season_replays:", e.message));
      if (isRecord) notifyBeatenFriends(uid, p.first_name || "Друг", prevBest, score, gameId, cfg).catch(() => {});
    }

    // вызов друга: результат засчитывается по проверенному забегу на том же поле
    let challenge_result = null;
    if (kind === "challenge" && score > 0) {
      const cr = await q(
        `UPDATE challenges SET accepted_by=$1, accepted_score=$2
         WHERE id=$3 AND expires_at>NOW() AND accepted_by IS NULL AND creator_id<>$1 RETURNING creator_id, creator_score`, [uid, score, t.ref]);
      if (cr.rowCount) {
        const c = cr.rows[0], win = score > c.creator_score;
        challenge_result = { win, creator_score: c.creator_score, score };
        const lang = (await q(`SELECT lang FROM players WHERE telegram_id=$1`, [c.creator_id])).rows[0]?.lang || "ru";
        N.toPlayer(c.creator_id, "challenge_done", { name: p.first_name || "Друг", score, mine: c.creator_score,
          verdict: require("../i18n").t(lang, win ? "challenge_win" : "challenge_lose") }, { optional: false }).catch(() => {});
      }
    }

    res.json({
      player: P.responsePlayer(await P.getPlayer(u)), bot_username: config.botUsername, challenge_result, daily, tournament, level, puzzle, custom, dungeon,
      result: { score, apples, reward: coins, is_record: isRecord, combo: sim.bestRun, rated, mode, diff: cfg.diff, game_id: gameId, xp: gainedXp, bonuses, candies, pet_xp: petXp }
    });
  }, { limit: [20, 60000] }));

  // ---- Ежедневный челлендж: одно и то же поле для всех, лучший результат дня ----
  app.get("/api/daily-challenge", player(async (req, res, { uid }) => {
    const day = R.dayNow();
    const top = await q(`SELECT d.best AS score, d.telegram_id, pl.first_name, pl.username, pl.skin FROM daily_scores d JOIN players pl ON pl.telegram_id=d.telegram_id
                         WHERE d.day=$1 AND NOT pl.banned AND d.best>0 ORDER BY d.best DESC, d.telegram_id LIMIT 10`, [day]);
    const mine = await q(`SELECT best, runs FROM daily_scores WHERE day=$1 AND telegram_id=$2`, [day, uid]);
    let me = null;
    if (mine.rows[0]) {
      const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM daily_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.day=$1 AND NOT pl.banned AND d.best>$2`, [day, mine.rows[0].best]);
      me = { best: mine.rows[0].best, runs: mine.rows[0].runs, rank: rk.rows[0].rank };
    }
    res.json({
      day, bonus: config.DAILY_CHALLENGE_BONUS, me,
      leaderboard: top.rows.map((x) => ({ name: nameOf(x), score: x.score, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin), is_me: x.telegram_id === uid }))
    });
  }, { allowBanned: true }));

  // ---- Режим «Уровни»: карта прогресса и рейтинг кампании ----
  app.get("/api/levels", player(async (req, res, { uid }) => {
    const mine = await q(`SELECT level, stars, best_ticks FROM level_progress WHERE telegram_id=$1`, [uid]);
    const byN = Object.fromEntries(mine.rows.map((r) => [r.level, r]));
    const levels = Engine.LEVELS.map((L) => ({
      n: L.n, chapter: L.chapter, target: L.target, boss: L.boss, moving: L.moving, gates: L.gates.length > 0, walls: L.walls.length,
      stars: byN[L.n]?.stars || 0, done: !!byN[L.n], unlocked: L.n === 1 || !!byN[L.n - 1], par: L.par,
      first_reward: C.levelFirstReward(L.n), star_reward: C.levelStarReward(L.n)
    }));
    const top = await q(`SELECT lp.telegram_id, pl.first_name, pl.username, pl.skin, SUM(lp.stars)::int AS stars, MAX(lp.level)::int AS max_level
                         FROM level_progress lp JOIN players pl ON pl.telegram_id=lp.telegram_id WHERE NOT pl.banned
                         GROUP BY lp.telegram_id, pl.first_name, pl.username, pl.skin ORDER BY stars DESC, max_level DESC, lp.telegram_id LIMIT 20`);
    res.json({
      levels, chapters: C.CHAPTERS.map((c) => ({ ...c, skin_name: C.SKIN_BY_ID[c.skin]?.name, skin_emoji: C.SKIN_BY_ID[c.skin]?.emoji })),
      total_stars: mine.rows.reduce((a, r) => a + r.stars, 0), max_stars: Engine.LEVELS.length * 3,
      leaderboard: top.rows.map((x) => ({ name: nameOf(x), score: x.stars, max_level: x.max_level, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin), is_me: x.telegram_id === uid }))
    });
  }, { allowBanned: true }));

  // ---- Турнир выходных ----
  app.get("/api/tournament", player(async (req, res, { uid }) => {
    const cur = Ev.currentTour(), last = Ev.lastFinishedTour();
    const board = async (id) => {
      const top = await q(`SELECT d.best AS score, d.telegram_id, pl.first_name, pl.username, pl.skin FROM tournament_scores d JOIN players pl ON pl.telegram_id=d.telegram_id
                           WHERE d.tour=$1 AND NOT pl.banned AND d.best>0 ORDER BY d.best DESC, d.telegram_id LIMIT 20`, [id]);
      const mine = await q(`SELECT best, runs FROM tournament_scores WHERE tour=$1 AND telegram_id=$2`, [id, uid]);
      let me = null;
      if (mine.rows[0]?.best > 0) {
        const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM tournament_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.tour=$1 AND NOT pl.banned AND d.best>$2`, [id, mine.rows[0].best]);
        me = { best: mine.rows[0].best, runs: mine.rows[0].runs, rank: rk.rows[0].rank };
      }
      return { me, leaderboard: top.rows.map((x) => ({ name: nameOf(x), score: x.score, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin), is_me: x.telegram_id === uid })) };
    };
    const lastBoard = await board(last.id);
    const claimed = (await q(`SELECT 1 FROM tournament_claims WHERE tour=$1 AND telegram_id=$2`, [last.id, uid])).rowCount > 0;
    const prize = lastBoard.me ? C.TOUR_PRIZES.find((x) => lastBoard.me.rank <= x.rank) || null : null;
    res.json({
      prizes: C.TOUR_PRIZES,
      current: cur ? { id: cur.id, mode: cur.mode, ends_day: cur.ends_day, ...(await board(cur.id)) } : null,
      next_start: cur ? null : (await Ev.active()).next_tour,
      last: { id: last.id, mode: last.mode, ...lastBoard, prize, claimed }
    });
  }, { allowBanned: true }));

  app.post("/api/tournament/claim", player(async (req, res, { uid, u }) => {
    const last = Ev.lastFinishedTour();
    const mine = await q(`SELECT best FROM tournament_scores WHERE tour=$1 AND telegram_id=$2 AND best>0`, [last.id, uid]);
    if (!mine.rowCount) return res.status(400).json({ error: "Not in tournament" });
    const rk = await q(`SELECT COUNT(*)::int+1 AS rank FROM tournament_scores d JOIN players pl ON pl.telegram_id=d.telegram_id WHERE d.tour=$1 AND NOT pl.banned AND d.best>$2`, [last.id, mine.rows[0].best]);
    const rank = rk.rows[0].rank, prize = C.TOUR_PRIZES.find((x) => rank <= x.rank);
    if (!prize) return res.status(400).json({ error: "No prize" });
    const ins = await q(`INSERT INTO tournament_claims(tour, telegram_id, rank) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`, [last.id, uid, rank]);
    if (!ins.rowCount) return res.status(400).json({ error: "Already claimed" });
    await q(`UPDATE players SET coins=coins+$1 ${prize.skin ? ", owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$3]::TEXT[]))" : ""}, updated_at=NOW() WHERE telegram_id=$2`,
      prize.skin ? [prize.coins, uid, prize.skin] : [prize.coins, uid]);
    res.json({ ok: true, rank, prize, player: P.responsePlayer(await P.getPlayer(u)) });
  }, { limit: [10, 60000] }));

  // ---- Вызовы друзьям ----
  app.get("/api/challenge/:id", async (req, res) => {
    try {
      const r = await q(
        `SELECT c.creator_score, c.expires_at, c.mode, c.diff, c.accepted_by IS NOT NULL AS taken, c.game_id IS NOT NULL AS has_ghost, p.first_name AS creator_name FROM challenges c
         LEFT JOIN players p ON p.telegram_id=c.creator_id WHERE c.id=$1 AND c.expires_at>NOW()`, [String(req.params.id)]);
      if (!r.rowCount) return res.status(404).json({ error: "Challenge not found" });
      res.json({ challenge: r.rows[0] });
    } catch (e) { res.status(500).json({ error: "Database error" }); }
  });

  // Вызов на конкретный забег: соперник играет на том же поле (тот же seed, режим и сложность) и видит призрака
  app.post("/api/challenge", player(async (req, res, { p, uid }) => {
    let score = 0, seed = null, mode = "classic", diff = "normal", art = "", artLevel = 1, gameId = null;
    if (req.body?.game_id) {
      const g = await q(`SELECT id, score, mode, diff, seed, cfg FROM game_log WHERE id=$1 AND telegram_id=$2 AND verified AND seed IS NOT NULL`, [Number(req.body.game_id) || 0, uid]);
      if (!g.rowCount || !g.rows[0].score || ["level", "puzzle", "custom"].includes(g.rows[0].mode)) return res.status(400).json({ error: "Bad game" }); // уровни — без вызовов
      ({ score, mode, diff } = g.rows[0]); seed = g.rows[0].seed; art = g.rows[0].cfg?.artifact || ""; artLevel = g.rows[0].cfg?.artLevel || 1; gameId = g.rows[0].id;
    } else { // старый способ: вызов по рекорду, поле у соперника случайное
      score = Math.max(0, Math.min(3000, Math.floor(Number(req.body?.score) || 0), Number(p.best_score) || 0));
    }
    if (!score) return res.status(400).json({ error: "Bad score" });
    const id = crypto.randomBytes(5).toString("hex");
    await q(`INSERT INTO challenges(id,creator_id,creator_score,expires_at,seed,mode,diff,art,art_level,game_id) VALUES($1,$2,$3,NOW()+INTERVAL '48 hours',$4,$5,$6,$7,$8,$9)`,
      [id, uid, score, seed, mode, diff, art, artLevel, gameId]);
    res.json({ id, score, mode, diff, link: P.challengeLink(id) });
  }, { limit: [10, 60000] }));

  // ---- Реплеи ----
  const replayPayload = (x) => ({ name: nameOf(x), score: x.score, cfg: x.cfg, ticks: x.ticks, log: x.run_log, skin: C.skinDef(x.skin) ? x.skin : "classic", palette: C.skinPalette(x.skin) });

  // Лучший забег сезона (по умолчанию — лидер текущего, ?which=prev — прошлого)
  app.get("/api/replay/season", player(async (req, res) => {
    const season = req.query.which === "prev" ? await S.previousSeason() : await S.ensureSeason();
    if (!season) return res.status(404).json({ error: "No season" });
    const r = await q(
      `SELECT sr.score, sr.cfg, sr.ticks, sr.run_log, pl.first_name, pl.username, pl.skin FROM season_replays sr JOIN players pl ON pl.telegram_id=sr.telegram_id
       WHERE sr.season_id=$1 AND NOT pl.banned ORDER BY sr.score DESC, sr.created_at LIMIT 1`, [season.id]);
    if (!r.rowCount) return res.status(404).json({ error: "No replay yet" });
    res.json({ ...replayPayload(r.rows[0]), season: season.name });
  }, { allowBanned: true, limit: [20, 60000] }));

  // Поделиться своим забегом: короткая ссылка, по которой друг посмотрит реплей
  app.post("/api/replay/share", player(async (req, res, { uid }) => {
    const g = await q(`SELECT id FROM game_log WHERE id=$1 AND telegram_id=$2 AND verified AND run_log IS NOT NULL`, [Number(req.body?.game_id) || 0, uid]);
    if (!g.rowCount) return res.status(404).json({ error: "Replay not available" });
    const ex = await q(`SELECT id FROM replay_shares WHERE game_id=$1`, [g.rows[0].id]);
    const id = ex.rows[0]?.id || crypto.randomBytes(5).toString("hex");
    if (!ex.rowCount) await q(`INSERT INTO replay_shares(id, game_id, telegram_id) VALUES($1,$2,$3)`, [id, g.rows[0].id, uid]);
    res.json({ id, link: P.startLink("rp_" + id) });
  }, { limit: [20, 60000] }));

  app.get("/api/replay/:id", player(async (req, res) => {
    const r = await q(`SELECT g.score, g.cfg, g.ticks, g.run_log, pl.first_name, pl.username, pl.skin FROM replay_shares s JOIN game_log g ON g.id=s.game_id
                       JOIN players pl ON pl.telegram_id=g.telegram_id WHERE s.id=$1 AND g.run_log IS NOT NULL AND NOT pl.banned`, [String(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: "Replay not found" });
    res.json(replayPayload(r.rows[0]));
  }, { allowBanned: true, limit: [30, 60000] }));
};
