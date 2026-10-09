// Задания: 3 дневных из пула (одни и те же для всех в этот день) и 3 недельных.
// Прогресс хранится в players.missions (JSONB): { day, d: {счётчики}, dc: {забрано}, week, w: {счётчики}, wc: {забрано} }
const crypto = require("crypto");
const C = require("./catalog");

const pick = (pool, key, n) => {
  // детерминированная перестановка по хэшу даты
  const scored = pool.map((m) => ({ m, h: crypto.createHash("md5").update(key + ":" + m.id).digest().readUInt32BE(0) }));
  return scored.sort((a, b) => a.h - b.h).slice(0, n).map((x) => x.m);
};
// Неделя — по дате понедельника (YYYY-MM-DD) для дня today
function weekOf(today) {
  const d = new Date(today + "T12:00:00Z"), dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const dailyFor = (day) => pick(C.MISSION_POOL, "d" + day, 3);
const weeklyFor = (week) => pick(C.WEEKLY_POOL, "w" + week, 3);

function state(p) {
  const m = p.missions && typeof p.missions === "object" ? p.missions : {};
  const today = p.today, week = weekOf(today);
  const fresh = m.day === today && m.d;
  const freshW = m.week === week && m.w;
  return {
    day: today, d: fresh ? { ...m.d } : {}, dc: fresh ? { ...(m.dc || {}) } : {},
    week, w: freshW ? { ...m.w } : {}, wc: freshW ? { ...(m.wc || {}) } : {}
  };
}

// Счётчики одного забега
function runStats(sim, cfg, kind) {
  const s = sim.stats || {};
  return {
    score: sim.score, games: sim.score > 0 ? 1 : 0, apples: sim.apples, gold: s.gold || 0, pu: s.pu || 0, coins: sim.runCoins || 0,
    combo: sim.bestRun || 0, daily: kind === "daily" && sim.score > 0 ? 1 : 0,
    hard: cfg.diff === "hard" ? sim.score : 0,
    m_rocks: cfg.mode === "rocks" ? sim.score : 0, m_maze: cfg.mode === "maze" ? sim.score : 0, m_moving: cfg.mode === "moving" ? sim.score : 0,
    special: ["rocks", "maze", "moving"].includes(cfg.mode) && sim.score > 0 ? 1 : 0
  };
}
const MAX_STATS = new Set([...C.MISSION_POOL, ...C.WEEKLY_POOL].filter((m) => m.max).map((m) => m.stat));
function addRun(st, rs) {
  for (const [k, v] of Object.entries(rs)) {
    for (const bucket of [st.d, st.w]) bucket[k] = MAX_STATS.has(k) ? Math.max(bucket[k] || 0, v) : (bucket[k] || 0) + v;
  }
  return st;
}

function list(p) {
  const st = state(p);
  const row = (m, bucket, claimed, weekly) => ({ id: m.id, icon: m.icon, title: m.title, target: m.target, reward: m.reward, weekly,
    progress: Math.min(m.target, bucket[m.stat] || 0), claimed: !!claimed[m.id] });
  return [...dailyFor(st.day).map((m) => row(m, st.d, st.dc, false)), ...weeklyFor(st.week).map((m) => row(m, st.w, st.wc, true))];
}

// Проверка и отметка «забрано»; возвращает награду или null
function claim(p, id) {
  const st = state(p);
  const daily = dailyFor(st.day).find((m) => m.id === id), weekly = weeklyFor(st.week).find((m) => m.id === id);
  const m = daily || weekly; if (!m) return null;
  const bucket = daily ? st.d : st.w, claimed = daily ? st.dc : st.wc;
  if ((bucket[m.stat] || 0) < m.target || claimed[m.id]) return null;
  claimed[m.id] = true;
  return { reward: m.reward, state: st, weekly: !!weekly };
}

module.exports = { state, list, addRun, runStats, claim, weekOf, dailyFor, weeklyFor };
