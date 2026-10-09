// Токен забега и проверка забега по логу. Сервер сам задаёт seed и настройки (режим, сложность, артефакт),
// подписывает их в токен, а при финише переигрывает игру по логу поворотов — очки считает только сервер.
const crypto = require("crypto");
const config = require("./config");
const Engine = require("../public/engine.js");

const MAX_TICKS = 100000, MAX_LOG = 20000, TOKEN_TTL_MS = 6 * 3600 * 1000;
const sign = (b64, uid) => crypto.createHmac("sha256", config.RUN_KEY).update(`${b64}.${uid}`).digest("hex").slice(0, 32);

// payload: { ts, seed, mode, diff, art, lvl, kind: "free"|"daily"|"challenge", ref }
function makeRunToken(uid, payload) {
  const b64 = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  return `${b64}.${sign(b64, uid)}`;
}
function parseRunToken(token, uid) {
  const [b64, sig] = String(token || "").split(".");
  if (!b64 || !sig || sig.length !== 32) return null;
  const want = sign(b64, uid);
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  let d;
  try { d = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")); } catch { return null; }
  const age = Date.now() - d.ts;
  if (!d || !Number.isFinite(d.ts) || age < 0 || age > TOKEN_TTL_MS) return null;
  return { ...d, age };
}

// Общий seed для всех в один день (ежедневный челлендж). day — "YYYY-MM-DD" по DAILY_TZ
const dailySeed = (day) => (crypto.createHash("sha256").update("daily:" + day).digest().readUInt32BE(0) >>> 0) || 1;
const randomSeed = () => crypto.randomInt(1, 2 ** 31);
const dayNow = () => new Intl.DateTimeFormat("sv-SE", { timeZone: config.DAILY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Переигрывает забег. Возвращает { ok, reason, cfg, sim }.
function verifyRun(token, uid, logSrc, ticksIn) {
  const t = parseRunToken(token, uid);
  if (!t) return { ok: false, reason: "bad_token" };
  const log = Engine.parseLog(logSrc, MAX_LOG);
  if (!log) return { ok: false, reason: "bad_log", t };
  const ticks = Math.floor(Number(ticksIn));
  if (!Number.isFinite(ticks) || ticks < 0 || ticks > MAX_TICKS) return { ok: false, reason: "bad_ticks", t };
  // rl — версия правил игры (старые токены без неё — правила v1)
  const cfg = Engine.normCfg({ seed: t.seed, mode: t.mode, diff: t.diff, artifact: t.art, artLevel: t.lvl, rules: t.rl || 1 });
  const sim = Engine.simulate(cfg, log, ticks);
  // игра не может идти быстрее реального времени: каждый поворот может «сэкономить» до ~половины хода
  const allowed = t.age + 130 * sim.turns + 2500;
  if (sim.gameTime > allowed) return { ok: false, reason: "too_fast", t, cfg, sim };
  return { ok: true, t, cfg, sim, log };
}

module.exports = { makeRunToken, parseRunToken, verifyRun, dailySeed, randomSeed, dayNow, MAX_TICKS, MAX_LOG };
