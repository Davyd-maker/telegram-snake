// События и турнир выходных. Всё считается по календарю в часовом поясе DAILY_TZ:
// - «режим недели»: один из особых режимов, награда в нём ×1.5;
// - выходные (сб и вс): двойные монеты (выключить: WEEKEND_X2=off) и турнир на одном поле для всех;
// - разовые события из админки (таблица events), например «×2 монет до 22:00».
const crypto = require("crypto");
const config = require("./config");
const { pool } = require("./db");

const FEATURED = ["rocks", "maze", "moving", "nowalls"];
const FEATURED_MULT = 1.5;

// Дата и день недели в DAILY_TZ
function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: config.DAILY_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const dow = (new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = понедельник
  return { ymd, dow };
}
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (ymd) => addDays(ymd, -((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7));
const weekIndex = (monday) => Math.floor(Date.parse(monday + "T00:00:00Z") / 604800000);

function featuredMode(d = new Date()) {
  const mon = mondayOf(localParts(d).ymd);
  return FEATURED[((weekIndex(mon) % FEATURED.length) + FEATURED.length) % FEATURED.length];
}

// ---- турнир: id = дата субботы; идёт сб 00:00 – вс 23:59 по DAILY_TZ
function tourInfo(id) {
  const mon = mondayOf(id);
  const mode = FEATURED[((weekIndex(mon) % FEATURED.length) + FEATURED.length) % FEATURED.length];
  const seed = (crypto.createHash("sha256").update("tour:" + id).digest().readUInt32BE(0) >>> 0) || 1;
  return { id, mode: mode === "nowalls" ? "rocks" : mode, diff: "normal", seed, ends_day: addDays(id, 1) };
}
function currentTour(d = new Date()) {
  const { ymd, dow } = localParts(d);
  if (dow === 5) return { ...tourInfo(ymd), active: true };
  if (dow === 6) return { ...tourInfo(addDays(ymd, -1)), active: true };
  return null;
}
function lastFinishedTour(d = new Date()) {
  const { ymd, dow } = localParts(d);
  const sat = dow === 6 ? addDays(ymd, -8) : dow === 5 ? addDays(ymd, -7) : addDays(ymd, -(dow + 2));
  return tourInfo(sat);
}
function nextTourStart(d = new Date()) {
  const { ymd, dow } = localParts(d);
  return dow >= 5 ? null : addDays(ymd, 5 - dow);
}

// ---- активные события
let cache = { at: 0, rows: [] };
async function manualEvents() {
  if (Date.now() - cache.at < 30000) return cache.rows;
  const r = await pool.query(`SELECT id, title, coin_mult, starts_at, ends_at FROM events WHERE starts_at<=NOW() AND ends_at>NOW() ORDER BY ends_at`).catch(() => ({ rows: [] }));
  cache = { at: Date.now(), rows: r.rows };
  return cache.rows;
}
const resetCache = () => { cache.at = 0; };

async function active(d = new Date()) {
  const { dow } = localParts(d);
  const list = [];
  let coinMult = 1;
  if (dow >= 5 && process.env.WEEKEND_X2 !== "off") { coinMult = 2; list.push({ kind: "weekend", title: "Двойные монеты выходных", coin_mult: 2 }); }
  for (const e of await manualEvents()) { coinMult = Math.max(coinMult, Number(e.coin_mult) || 1); list.push({ kind: "manual", title: e.title, coin_mult: Number(e.coin_mult), ends_at: e.ends_at }); }
  const featured = featuredMode(d);
  const tour = currentTour(d);
  return { coinMult, featured, featuredMult: FEATURED_MULT, list, tour: tour ? { id: tour.id, mode: tour.mode } : null, next_tour: tour ? null : nextTourStart(d) };
}

module.exports = { active, featuredMode, currentTour, lastFinishedTour, tourInfo, localParts, addDays, mondayOf, resetCache, FEATURED_MULT };
