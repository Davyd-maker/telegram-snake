// Тесты серверных модулей без базы данных: токен забега, проверка забега, подпись Telegram, лимиты.
process.env.BOT_TOKEN = "123456:TEST";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/unused"; // база этим тестам не нужна
process.env.INITDATA_MAX_AGE = "3600";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const E = require("../public/engine.js");
const R = require("../src/replay");
const { telegramUser } = require("../src/auth");
const { rateLimiter } = require("../src/ratelimit");

function signed(fields) {
  const p = new URLSearchParams(fields);
  const dcs = [...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const sk = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", sk).update(dcs).digest("hex"));
  return p.toString();
}
const req = (init) => ({ get: (h) => (h === "X-Telegram-Init-Data" ? init : "") });
const now = () => Math.floor(Date.now() / 1000);

test("подпись Telegram: верная принимается", () => {
  const u = telegramUser(req(signed({ auth_date: String(now()), user: JSON.stringify({ id: 5, first_name: "A" }) })));
  assert.equal(u.id, 5);
});
test("подпись Telegram: подделка отклоняется", () => {
  const s = signed({ auth_date: String(now()), user: JSON.stringify({ id: 5 }) }).replace("%3A5", "%3A6");
  assert.equal(telegramUser(req(s)), null);
});
test("подпись Telegram: просроченная отклоняется и помечается", () => {
  const r = req(signed({ auth_date: String(now() - 7200), user: JSON.stringify({ id: 5 }) }));
  assert.equal(telegramUser(r), null);
  assert.equal(r.initExpired, true);
});

test("токен забега: чужой игрок и подделка не проходят", () => {
  const t = R.makeRunToken("1", { seed: 5, mode: "classic", diff: "normal", art: "", lvl: 1, kind: "free", ref: "" });
  assert.ok(R.parseRunToken(t, "1"));
  assert.equal(R.parseRunToken(t, "2"), null);
  assert.equal(R.parseRunToken(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"), "1"), null);
});

test("проверка забега: очки считает сервер, слишком быстрый забег отклоняется", () => {
  const cfg = { seed: 77, mode: "classic", diff: "normal", artifact: "", artLevel: 1 };
  const g = new E.Game(cfg);
  g.setdir(0, -1); for (let i = 0; i < 5; i++) g.tick();
  g.setdir(1, 0); for (let i = 0; i < 60 && !g.over; i++) g.tick();
  const t = R.makeRunToken("9", { seed: 77, mode: "classic", diff: "normal", art: "", lvl: 1, kind: "free", ref: "" });
  const v = R.verifyRun(t, "9", E.encodeLog(g.log), g.ticks);
  assert.equal(v.ok, false); assert.equal(v.reason, "too_fast"); // токен выдан только что
  // тот же забег «из прошлого» — проходит, очки совпадают
  const b64 = Buffer.from(JSON.stringify({ seed: 77, mode: "classic", diff: "normal", art: "", lvl: 1, kind: "free", ref: "", ts: Date.now() - 60000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", require("../src/config").RUN_KEY).update(`${b64}.9`).digest("hex").slice(0, 32);
  const v2 = R.verifyRun(`${b64}.${sig}`, "9", E.encodeLog(g.log), g.ticks);
  assert.equal(v2.ok, true);
  assert.equal(v2.sim.score, g.score);
});

test("сид дня одинаков для всех и меняется по дням", () => {
  assert.equal(R.dailySeed("2026-10-09"), R.dailySeed("2026-10-09"));
  assert.notEqual(R.dailySeed("2026-10-09"), R.dailySeed("2026-10-10"));
});

test("ограничитель частоты (память)", async () => {
  const lim = rateLimiter({ windowMs: 1000, max: 3 });
  const r = []; for (const k of ["a", "a", "a", "a", "b"]) r.push(await lim(k));
  assert.deepEqual(r, [true, true, true, false, true]);
});

test("ограничитель частоты (Redis по протоколу RESP)", async () => {
  // крошечный поддельный Redis: INCR и PEXPIRE
  const net = require("net"), store = new Map();
  const srv = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const { parseResp } = require("../src/ratelimit");
      for (;;) {
        const r = parseResp(buf, 0); if (!r) return; buf = buf.subarray(r.end);
        const [cmd, k] = r.value;
        if (cmd === "INCR") { store.set(k, (store.get(k) || 0) + 1); sock.write(`:${store.get(k)}\r\n`); }
        else sock.write("+OK\r\n");
      }
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  process.env.REDIS_URL = `redis://127.0.0.1:${srv.address().port}`;
  delete require.cache[require.resolve("../src/ratelimit")];
  const { rateLimiter: rl, closeRedis } = require("../src/ratelimit");
  const lim = rl({ windowMs: 60000, max: 2 });
  const r = []; for (const k of ["x", "x", "x", "y"]) r.push(await lim(k));
  assert.deepEqual(r, [true, true, false, true]);
  delete process.env.REDIS_URL;
  closeRedis();
  await new Promise((ok) => srv.close(ok));
});

test("календарь событий: турнир по выходным, режим недели меняется", () => {
  const Ev = require("../src/events");
  const fri = new Date("2026-10-09T12:00:00Z"), sat = new Date("2026-10-10T12:00:00Z"), sun = new Date("2026-10-11T20:00:00Z"), mon = new Date("2026-10-12T12:00:00Z");
  assert.equal(Ev.currentTour(fri), null);
  assert.equal(Ev.currentTour(sat).id, "2026-10-10");
  assert.equal(Ev.currentTour(sun).id, "2026-10-10");
  assert.equal(Ev.lastFinishedTour(mon).id, "2026-10-10");
  assert.equal(Ev.lastFinishedTour(sat).id, "2026-10-03");
  assert.equal(Ev.lastFinishedTour(fri).id, "2026-10-03");
  assert.notEqual(Ev.featuredMode(fri), Ev.featuredMode(mon));
  assert.equal(Ev.tourInfo("2026-10-10").seed, Ev.tourInfo("2026-10-10").seed);
});

test("задания: одни и те же для всех в один день, недельные считаются за неделю", () => {
  const M = require("../src/missions");
  assert.deepEqual(M.dailyFor("2026-10-09").map((m) => m.id), M.dailyFor("2026-10-09").map((m) => m.id));
  assert.equal(M.weekOf("2026-10-11"), "2026-10-05");
  const p = { today: "2026-10-09", missions: {} };
  const st = M.addRun(M.state(p), { score: 60, games: 1, apples: 10, gold: 1, pu: 0, coins: 10, combo: 3, daily: 0, hard: 0, m_rocks: 0, m_maze: 0, m_moving: 0, special: 0 });
  M.addRun(st, { score: 20, games: 1, apples: 5, gold: 0, pu: 1, coins: 0, combo: 6, daily: 1, hard: 0, m_rocks: 0, m_maze: 0, m_moving: 0, special: 0 });
  assert.equal(st.d.score, 60); assert.equal(st.d.games, 2); assert.equal(st.d.apples, 15); assert.equal(st.d.combo, 6); assert.equal(st.w.games, 2);
});

test("античит: идеальный путь помечается, человеческий — нет", () => {
  const AC = require("../src/anticheat");
  assert.equal(AC.analyze({ bestRun: 5, stats: { pathTicks: 210, pathDist: 205 } }).flags, "path");
  assert.equal(AC.analyze({ bestRun: 5, stats: { pathTicks: 330, pathDist: 205 } }).flags, "");
  assert.equal(AC.analyze({ bestRun: 5, stats: { pathTicks: 20, pathDist: 19 } }).eff, null); // мало данных
});

test("новость обновления: есть для текущей версии, на двух языках, влезает в сообщение Telegram", () => {
  const CL = require("../src/changelog");
  for (const lang of ["ru", "en"]) {
    const text = CL.newsText(CL.CURRENT, lang);
    assert.ok(text.length > 50 && text.length < 4000, `${lang}: ${text.length} символов`);
    assert.equal(CL.newsFor(lang).items.length, CL.NEWS[CL.CURRENT][lang].length);
  }
  assert.equal(CL.NEWS[CL.CURRENT].ru.length, CL.NEWS[CL.CURRENT].en.length, "одинаковое число пунктов на обоих языках");
});
