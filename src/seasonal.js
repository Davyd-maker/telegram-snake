// Сезонные праздники (Хэллоуин и т. п.): идут по календарю каждый год. Во время праздника за фрукты
// дают праздничную валюту (🍬), на поле — праздничная еда, в магазине — праздничные предметы.
// Админ может включить праздник досрочно или выключить (kv: seasonal_force = id | "off" | "").
const { pool } = require("./db");
const { dayNow } = require("./replay");

const HOLIDAYS = [
  { id: "halloween", emoji: "🎃", title: "Хэллоуин", from: "10-24", to: "11-03", currency: "candy", icon: "🍬",
    desc: "Тыквы вместо фруктов, конфеты за каждый фрукт и жуткие предметы в магазине" }
];
const BY_ID = Object.fromEntries(HOLIDAYS.map((h) => [h.id, h]));
const CANDY_PER_RUN_MAX = 60;

let forced = "", loadedAt = 0;
async function refresh() {
  try { const r = await pool.query(`SELECT v FROM kv WHERE k='seasonal_force'`); forced = r.rows[0]?.v || ""; loadedAt = Date.now(); } catch (e) { /* таблицы ещё нет */ }
}
// Текущий праздник (синхронно, по кэшу; кэш обновляется раз в 30 секунд)
function current(day = dayNow()) {
  if (Date.now() - loadedAt > 30000) { loadedAt = Date.now(); refresh(); }
  if (forced === "off") return null;
  if (BY_ID[forced]) return { ...BY_ID[forced], forced: true, ends: null };
  const md = day.slice(5), y = day.slice(0, 4);
  for (const h of HOLIDAYS) {
    const inside = h.from <= h.to ? md >= h.from && md <= h.to : md >= h.from || md <= h.to;
    if (inside) return { ...h, ends: `${h.from <= h.to || md <= h.to ? y : Number(y) + 1}-${h.to}` };
  }
  return null;
}
async function setForced(v) {
  const val = v === "off" || BY_ID[v] ? v : "";
  await pool.query(`INSERT INTO kv(k, v) VALUES('seasonal_force',$1) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v, updated_at=NOW()`, [val]);
  forced = val; loadedAt = Date.now();
  return current();
}
// Когда ближайший праздник (для админки)
function next(day = dayNow()) {
  const md = day.slice(5), y = Number(day.slice(0, 4));
  return HOLIDAYS.map((h) => ({ ...h, starts: `${md <= h.from ? y : y + 1}-${h.from}` })).sort((a, b) => a.starts.localeCompare(b.starts))[0] || null;
}

module.exports = { HOLIDAYS, current, setForced, refresh, next, CANDY_PER_RUN_MAX, forcedValue: () => forced };
