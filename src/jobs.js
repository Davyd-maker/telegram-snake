// Фоновые задачи: награды кланам за неделю, сообщения призёрам турнира, сводка админу, очистка старых логов.
// Каждое разовое действие «застолбляется» в таблице kv, поэтому при нескольких экземплярах сервера оно выполнится один раз.
const config = require("./config");
const { pool } = require("./db");
const C = require("./catalog");
const Ev = require("./events");
const N = require("./notify");
const { CLAN_SCORES } = require("./routes/clans");

const q = (sql, p) => pool.query(sql, p);
const once = async (key) => (await q(`INSERT INTO kv(k) VALUES($1) ON CONFLICT DO NOTHING RETURNING 1`, [key])).rowCount > 0;
const pause = () => new Promise((ok) => setTimeout(ok, config.BROADCAST_DELAY_MS));

// Топ-3 клана завершённого сезона: каждому участнику монеты
async function clanRewards() {
  const { rows: seasons } = await q(`SELECT s.id FROM seasons s WHERE s.ends_at<=NOW() AND s.ends_at>NOW()-INTERVAL '3 days'
                                      AND NOT EXISTS (SELECT 1 FROM clan_rewards r WHERE r.season_id=s.id)`);
  let paid = 0;
  for (const s of seasons) {
    const claim = await q(`INSERT INTO clan_rewards(season_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING 1`, [s.id]);
    if (!claim.rowCount) continue;
    const top = await q(`SELECT * FROM (${CLAN_SCORES}) t WHERE t.score>0 ORDER BY t.score DESC, t.id LIMIT 3`, [s.id]);
    for (let i = 0; i < top.rows.length; i++) {
      const c = top.rows[i], coins = C.CLAN.rewards[i];
      const m = await q(`UPDATE players SET coins=coins+$1 WHERE telegram_id IN (SELECT telegram_id FROM clan_members WHERE clan_id=$2) AND NOT banned RETURNING telegram_id`, [coins, c.id]);
      for (const r of m.rows) { paid++; await N.toPlayer(r.telegram_id, "clan_win", { clan: `${c.emoji} ${c.name}`, rank: i + 1, coins }); await pause(); }
    }
  }
  return paid;
}

// Призёрам прошедшего турнира — сообщение (награду они забирают в игре)
async function tourNotify() {
  const t = Ev.lastFinishedTour();
  const endedDaysAgo = (Date.now() - Date.parse(Ev.addDays(t.id, 2) + "T00:00:00Z")) / 864e5;
  if (endedDaysAgo > 2 || endedDaysAgo < -0.5) return 0;
  if (!(await once("tour_notified:" + t.id))) return 0;
  const top = await q(`SELECT ts.telegram_id, ts.best FROM tournament_scores ts JOIN players p ON p.telegram_id=ts.telegram_id
                       WHERE ts.tour=$1 AND ts.best>0 AND NOT p.banned ORDER BY ts.best DESC, ts.telegram_id LIMIT 10`, [t.id]);
  let sent = 0;
  for (let i = 0; i < top.rows.length; i++) { if ((await N.toPlayer(top.rows[i].telegram_id, "tour_win", { rank: i + 1, score: top.rows[i].best }, { optional: false })) === "sent") sent++; await pause(); }
  return sent;
}

// Вечерняя сводка администраторам (раз в день, после SUMMARY_HOUR, по умолчанию 21:00)
async function dailySummary() {
  if (!config.ADMIN_IDS.size || process.env.ADMIN_SUMMARY === "off") return;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: config.DAILY_TZ, hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < Number(process.env.SUMMARY_HOUR || 21)) return;
  const day = N.today();
  if (!(await once("summary:" + day))) return;
  const tz = config.DAILY_TZ, isToday = `(created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`;
  const r = await q(`SELECT
      (SELECT COUNT(*)::int FROM players WHERE ${isToday}) AS new_players,
      (SELECT COUNT(*)::int FROM activity WHERE day=$2) AS dau,
      (SELECT COUNT(*)::int FROM game_log WHERE verified AND ${isToday}) AS games,
      (SELECT COUNT(*)::int FROM game_log WHERE NOT verified AND ${isToday}) AS rejected,
      (SELECT COUNT(*)::int FROM game_log WHERE flags<>'' AND ${isToday}) AS flagged,
      (SELECT COALESCE(SUM(stars),0)::int FROM payments WHERE refunded_at IS NULL AND ${isToday}) AS stars,
      (SELECT COUNT(*)::int FROM payment_errors WHERE NOT resolved) AS pay_errors`, [tz, day]);
  const s = r.rows[0];
  await N.alertAdmins(`📊 Итоги дня ${day}\n👥 Новых: ${s.new_players} · активных: ${s.dau}\n🎮 Игр: ${s.games} · отклонено: ${s.rejected} · подозрительных: ${s.flagged}\n⭐ Выручка: ${s.stars}${s.pay_errors ? `\n⚠️ Открытых ошибок платежей: ${s.pay_errors}` : ""}`, "summary:" + day);
}

// Логи забегов нужны для призраков и реплеев; старые удаляем, кроме тех, на которые есть ссылки
async function pruneLogs() {
  await q(`UPDATE game_log g SET run_log=NULL WHERE run_log IS NOT NULL AND created_at < NOW() - INTERVAL '14 days'
           AND NOT (flags<>'' AND created_at > NOW() - INTERVAL '45 days')
           AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.game_id=g.id AND c.expires_at>NOW())
           AND NOT EXISTS (SELECT 1 FROM replay_shares r WHERE r.game_id=g.id AND r.created_at > NOW() - INTERVAL '60 days')`);
  await q(`DELETE FROM kv WHERE k LIKE 'summary:%' AND updated_at < NOW() - INTERVAL '30 days'`);
  await q(`DELETE FROM notify_log WHERE day < to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD')`);
}

// Новость обновления: после выкладки новой версии — одна рассылка на версию (на языке каждого игрока)
async function announceUpdate({ force = false, adminId = "system" } = {}) {
  const CL = require("./changelog"), Bot = require("./bot");
  if (!config.BOT_TOKEN || !CL.NEWS[CL.CURRENT]) return { skipped: "no news" };
  if (!force && process.env.ANNOUNCE_UPDATES === "off") return { skipped: "off" };
  if (Bot.broadcastRunning()) return { skipped: "busy" }; // идёт другая рассылка — попробуем позже
  const key = "announce:" + CL.CURRENT;
  if (!force && !(await once(key))) return { skipped: "already" };
  if (force) await q(`INSERT INTO kv(k) VALUES($1) ON CONFLICT DO NOTHING`, [key]);
  try {
    const b = await Bot.startBroadcast({ text: { ru: CL.newsText(CL.CURRENT, "ru"), en: CL.newsText(CL.CURRENT, "en") }, audience: "news", withButton: true, adminId });
    await q(`UPDATE kv SET v=$2, updated_at=NOW() WHERE k=$1`, [key, String(b.id)]);
    N.alertAdmins(`📰 Новость о версии v${CL.CURRENT} разослана: ${b.total} получателей.\nОстановить — админка → «Рассылка».`, key).catch(() => {});
    return { ok: true, ...b };
  } catch (e) {
    if (!force) await q(`DELETE FROM kv WHERE k=$1`, [key]).catch(() => {}); // не получилось — повторим позже
    throw e;
  }
}
async function announceStatus() {
  const CL = require("./changelog");
  const r = await q(`SELECT k, v, updated_at FROM kv WHERE k=$1`, ["announce:" + CL.CURRENT]);
  const b = r.rows[0]?.v ? (await q(`SELECT id, total, sent, status, created_at FROM broadcasts WHERE id=$1`, [Number(r.rows[0].v)])).rows[0] : null;
  return { version: CL.CURRENT, sent: !!r.rowCount, broadcast: b || null, auto: process.env.ANNOUNCE_UPDATES !== "off", preview: CL.newsText(CL.CURRENT, "ru") };
}

const safe = (name, fn) => () => fn().catch((e) => console.error(`job ${name}:`, e.message));
function start() {
  if (config.BOT_TOKEN) {
    setInterval(safe("clans", clanRewards), 10 * 60 * 1000).unref();
    setInterval(safe("tour", tourNotify), 15 * 60 * 1000).unref();
    setInterval(safe("summary", dailySummary), 15 * 60 * 1000).unref();
    // через минуту после запуска (чтобы сервер успел подняться) и потом каждые 10 минут, пока не разошлётся
    const ann = safe("announce", () => announceUpdate());
    setTimeout(ann, Number(process.env.ANNOUNCE_DELAY_SEC || 60) * 1000).unref();
    setInterval(ann, 10 * 60 * 1000).unref();
  }
  setInterval(safe("prune", pruneLogs), 6 * 3600 * 1000).unref();
}

module.exports = { start, clanRewards, tourNotify, dailySummary, pruneLogs, announceUpdate, announceStatus };
