// Сквозная проверка новых функций на живом сервере с ТЕСТОВОЙ базой (игроки 4001–4004, админ — первый из ADMIN_TELEGRAM_ID).
// Запуск: API_URL=http://127.0.0.1:3000 BOT_TOKEN=<тот же, что у сервера> ADMIN_ID=<id админа> node tests/features.e2e.js
const crypto = require("crypto");
const E = require("../public/engine.js");
const BASE = process.env.API_URL || "http://127.0.0.1:3000", TOKEN = process.env.BOT_TOKEN, ADMIN = Number(process.env.ADMIN_ID || 1001);
const TG_LOG = process.env.TG_LOG || ""; // адрес журнала вызовов Telegram у тестовой заглушки (необязательно)
let fails = 0;
const ok = (c, m, x) => { if (!c) { fails++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } else console.log("  ✓", m); };
function initData(user, start) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user), ...(start ? { start_param: start } : {}) });
  const dcs = [...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const sk = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", sk).update(dcs).digest("hex"));
  return p.toString();
}
const U = (id, name, start, lang = "ru") => ({ id, init: initData({ id, first_name: name, language_code: lang }, start) });
async function call(u, m, path, body, extra = {}) {
  const r = await fetch(BASE + path, { method: m, headers: { "Content-Type": "application/json", ...(u ? { "X-Telegram-Init-Data": u.init } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bot(g) {
  const h = g.snake[0], f = g.food, N = E.N;
  const safe = (d) => { let nx = h.x + d.x, ny = h.y + d.y; if (g.cfg.mode !== "nowalls" && (nx < 0 || ny < 0 || nx >= N || ny >= N)) return false; nx = (nx + N) % N; ny = (ny + N) % N; if (g.rockSet[ny * N + nx]) return false; const t = g.snake[g.snake.length - 1]; return !(g.occ[ny * N + nx] && !(t.x === nx && t.y === ny && g.pendingGrowth <= 0)); };
  const s = E.DIRS.map(([x, y]) => ({ x, y })).filter((d) => !(d.x === -g.dir.x && d.y === -g.dir.y) && safe(d));
  s.sort((a, b) => (Math.abs(h.x + a.x - f.x) + Math.abs(h.y + a.y - f.y)) - (Math.abs(h.x + b.x - f.x) + Math.abs(h.y + b.y - f.y)));
  return s[0] || null;
}
async function play(u, body, maxTicks = 300, maxScore = 1e9) {
  const r = await call(u, "POST", "/api/run", body); if (!r.data?.token) return { r };
  const g = new E.Game(r.data.cfg);
  while (!g.over && g.ticks < maxTicks && g.score < maxScore) { const d = bot(g); if (d && (d.x !== g.dir.x || d.y !== g.dir.y)) g.setdir(d.x, d.y); g.tick(); }
  const res = g.result();
  await sleep(Math.max(0, res.gameTime - 130 * g.log.length - 2000) + 200);
  const s = await call(u, "POST", "/api/score", { token: r.data.token, log: E.encodeLog(g.log), ticks: res.ticks });
  return { r, g, res, s };
}
const whSecret = crypto.createHash("sha256").update("wh:" + TOKEN).digest("hex").slice(0, 48);
const webhook = (upd) => fetch(BASE + "/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": whSecret }, body: JSON.stringify(upd) });
const tgLog = async () => (TG_LOG ? (await fetch(TG_LOG)).json() : []);

(async () => {
  const admin = U(ADMIN, "Boss"), A = U(4001, "Anna"), B = U(4002, "Boris", "ref_4001"), Cc = U(4003, "Cid", null, "en"), D = U(4004, "Dina");
  for (const x of [admin, A, B, Cc, D]) await call(x, "GET", "/api/me");

  console.log("• язык и настройки");
  let r = await call(Cc, "GET", "/api/me"); ok(r.data.player.lang === "en", "язык из Telegram (en)");
  r = await call(D, "POST", "/api/settings", { notify: false, lang: "en" }); ok(r.data.player.notify === false && r.data.player.lang === "en", "настройки сохраняются");
  await call(D, "POST", "/api/settings", { notify: true, lang: "ru" });

  console.log("• события и задания");
  r = await call(A, "GET", "/api/me");
  ok(r.data.events && typeof r.data.events.coinMult === "number" && E.MODES[r.data.events.featured], "события в /api/me", r.data.events);
  ok(r.data.player.missions.length === 6 && r.data.player.missions.filter((m) => m.weekly).length === 3, "3 дневных + 3 недельных задания");
  const a1 = await play(A, { mode: "classic" }, 300);
  ok(a1.s.status === 200 && a1.s.data.result.score === a1.res.score, `забег засчитан: ${a1.res.score}`);
  const a2 = await play(A, { mode: "rocks" }, 250);
  const ms = a2.s.data.player.missions;
  ok(ms.some((m) => m.progress > 0), "прогресс заданий растёт", ms.map((m) => `${m.id}:${m.progress}/${m.target}`));
  const ready = ms.find((m) => m.progress >= m.target && !m.claimed);
  if (ready) { r = await call(A, "POST", "/api/mission", { id: ready.id }); ok(r.data.reward === ready.reward && r.data.pass_xp > 0, `задание «${ready.id}» забрано`, r.data); }

  console.log("• события: ×2 от админа");
  r = await call(admin, "POST", "/api/admin/events", { title: "Тест ×2", coin_mult: 2, hours: 1 }); ok(r.data.ok, "событие создано");
  r = await call(A, "GET", "/api/me"); ok(r.data.events.coinMult >= 2, "множитель монет активен");
  const a3 = await play(A, { mode: "classic", diff: "normal" }, 120);
  ok(a3.s.data.result.bonuses.some((b) => b.kind === "event") && a3.s.data.result.reward >= E.reward(a3.res, a3.r.data.cfg, false) * 2 - 1, "награда удвоена", a3.s.data.result);
  await call(admin, "POST", `/api/admin/events/${(await call(admin, "GET", "/api/admin/events")).data.events[0].id}/stop`, {});

  console.log("• сезонный пропуск");
  r = await call(A, "GET", "/api/pass"); const pass = r.data.pass;
  ok(pass.xp > 0 && pass.tiers.length === 15, `опыт пропуска ${pass.xp}`);
  if (pass.level > 0) { r = await call(A, "POST", "/api/pass/claim", { tier: 1, track: "free" }); ok(r.data.ok && r.data.coins > 0, "бесплатная ступень 1"); }
  r = await call(A, "POST", "/api/pass/claim", { tier: 1, track: "prem" }); ok(r.status === 400, "премиум без покупки — нельзя");
  r = await call(A, "POST", "/api/invoice", { product: "pass" }); ok(!!r.data.url, "счёт на пропуск");
  const season = (await call(A, "GET", "/api/pass")).data.season.id;
  const pay = (payload, amount, charge) => webhook({ message: { chat: { id: 4001 }, from: { id: 4001, language_code: "ru" }, successful_payment: { currency: "XTR", total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: charge } } });
  await pay(`product:pass:${season}:4001`, 99, "ch-pass-1"); await sleep(400);
  r = await call(A, "GET", "/api/pass"); ok(r.data.pass.premium, "премиум включён после оплаты");
  if (r.data.pass.level > 0) { r = await call(A, "POST", "/api/pass/claim", { tier: 1, track: "prem" }); ok(r.data.ok, "премиум-ступень 1"); }
  r = await call(A, "POST", "/api/invoice", { product: "pass" }); ok(r.status === 400, "второй раз купить нельзя");

  console.log("• набор новичка");
  r = await call(D, "GET", "/api/me"); ok(!!r.data.player.starter_offer, "предложение новичку есть"); const coins0 = r.data.player.coins;
  await webhook({ message: { chat: { id: 4004 }, from: { id: 4004 }, successful_payment: { currency: "XTR", total_amount: 49, invoice_payload: "product:starter:0:4004", telegram_payment_charge_id: "ch-starter-1" } } }); await sleep(400);
  r = await call(D, "GET", "/api/me"); const pl = r.data.player;
  ok(pl.coins === coins0 + 5000 && pl.owned_skins.includes("cyber") && pl.artifact_levels.magnet >= 2 && !pl.starter_offer, "набор выдан", { c: pl.coins, s: pl.owned_skins, l: pl.artifact_levels });
  r = await call(admin, "POST", "/api/admin/payments/refund", { charge_id: "ch-starter-1" });
  if (r.status === 502) console.log("  – возврат пропущен: нет связи с Telegram (тестовый токен)");
  else { ok(r.data.ok, "возврат набора"); r = await call(D, "GET", "/api/me"); ok(!r.data.player.owned_skins.includes("cyber"), "после возврата скин забран"); }

  console.log("• призраки и реплеи");
  const ch = await call(A, "POST", "/api/challenge", { game_id: a1.s.data.result.game_id });
  r = await call(B, "POST", "/api/run", { kind: "challenge", ref: ch.data.id });
  ok(r.data.ghost && r.data.ghost.score === a1.res.score && r.data.ghost.log, "в вызове есть призрак соперника");
  if (r.data.ghost) { const sim = E.simulate(r.data.cfg, E.parseLog(r.data.ghost.log), r.data.ghost.ticks); ok(sim.score === a1.res.score, "призрак проигрывается на том же поле"); }
  const d1 = await play(B, { kind: "daily" }, 150);
  r = await call(B, "POST", "/api/run", { kind: "daily" }); ok(r.data.ghost?.label === "Твой лучший" && r.data.ghost.score === d1.res.score, "в челлендже — призрак своего лучшего");
  r = await call(B, "GET", "/api/me"); ok(r.data.player.best_score === 0, "челлендж дня не идёт в общий рейтинг");
  const sh = await call(A, "POST", "/api/replay/share", { game_id: a1.s.data.result.game_id });
  ok(/rp_[0-9a-f]{10}/.test(sh.data.link), "ссылка на реплей", sh.data);
  r = await call(Cc, "GET", `/api/replay/${sh.data.id}`); ok(r.data.score === a1.res.score && r.data.log, "реплей по ссылке открывается у другого игрока");

  console.log("• кланы");
  await call(admin, "POST", "/api/admin/player/grant", { telegram_id: "4002", coins: 5000 });
  r = await call(B, "POST", "/api/clan/create", { name: "Змеи", tag: "zm", emoji: "🐉" }); ok(r.data.ok && r.data.mine.tag === "ZM", "клан создан", r.data);
  r = await call(Cc, "POST", "/api/clan/create", { name: "змеи", tag: "ZX" }); ok(r.status === 409 || r.status === 400, "имя занято / нет монет");
  const clanId = (await call(B, "GET", "/api/clans")).data.mine.id;
  r = await call(A, "POST", "/api/clan/join", { id: clanId }); ok(r.data.ok && r.data.mine.members.length === 2, "вступление");
  r = await call(A, "GET", "/api/clans"); ok(r.data.clans[0].score > 0, `очки клана: ${r.data.clans[0]?.score}`);
  r = await call(A, "POST", "/api/clan/kick", { telegram_id: "4002" }); ok(r.status === 403, "не владелец не может исключать");
  r = await call(B, "POST", "/api/clan/kick", { telegram_id: "4001" }); ok(r.data.ok && r.data.mine.members.length === 1, "владелец исключил");
  r = await call(B, "POST", "/api/clan/leave", {}); ok(r.data.ok, "владелец вышел");
  r = await call(B, "GET", "/api/clans"); ok(!r.data.clans.some((c) => c.id === clanId), "пустой клан удалён");

  console.log("• турнир");
  r = await call(A, "GET", "/api/tournament"); ok(r.data.prizes.length === 4 && r.data.last, "турнир: призы и прошлый турнир");
  const tr = await call(A, "POST", "/api/run", { kind: "tournament" });
  ok(r.data.current ? tr.status === 200 : tr.status === 409, `турнир ${r.data.current ? "идёт" : "не идёт (будни)"} — старт ${tr.status}`);

  console.log("• уведомления");
  // Борис приглашён Анной → они друзья. Обнуляем Борису рекорд, даём маленький, потом большой — больше рекорда Анны.
  await call(admin, "POST", "/api/admin/player/reset", { telegram_id: "4002", scope: "scores" });
  await play(B, { mode: "classic" }, 80, 4);
  const annaBest = (await call(A, "GET", "/api/me")).data.player.best_score;
  const before = (await tgLog()).length;
  let b2 = null;
  for (let i = 0; i < 3; i++) { b2 = await play(B, { mode: "classic" }, 600); if (b2.res.score > annaBest) break; }
  if (TG_LOG && b2.res.score > annaBest) {
    await sleep(600);
    const msgs = (await tgLog()).slice(before).filter((x) => x.method === "sendMessage" && String(x.body.chat_id) === "4001");
    ok(msgs.some((m) => /побил/.test(m.body.text) && m.body.text.includes(String(b2.res.score))), `Анне пришло «Борис побил твой рекорд» (${b2.res.score} > ${annaBest})`, msgs.map((m) => m.body.text));
  } else console.log("  – пропущено: рекорд Анны не побит или нет журнала Telegram");

  console.log("• режим «Уровни»");
  const LB = require("./levelbot");
  async function playLevelApi(u, n) {
    const r = await call(u, "POST", "/api/run", { kind: "level", ref: n });
    if (!r.data?.token) return { r };
    const g = new E.Game(r.data.cfg);
    while (!g.over && g.ticks < 6000) { LB.step(g); g.tick(); }
    const res = g.result();
    await sleep(Math.max(0, res.gameTime - 130 * g.log.length - 2000) + 200);
    const s = await call(u, "POST", "/api/score", { token: r.data.token, log: E.encodeLog(g.log), ticks: res.ticks });
    return { r, g, res, s };
  }
  r = await call(Cc, "GET", "/api/levels");
  ok(r.data.levels.length === 30 && r.data.levels[0].unlocked && !r.data.levels[1].unlocked, "карта уровней: открыт только 1-й");
  r = await call(Cc, "POST", "/api/run", { kind: "level", ref: 2 }); ok(r.status === 403, "2-й уровень закрыт до прохождения 1-го");
  const coinsBefore = (await call(Cc, "GET", "/api/me")).data.player.coins;
  let l1 = null; for (let i = 0; i < 3; i++) { l1 = await playLevelApi(Cc, 1); if (l1.res.completed) break; }
  ok(l1.s.status === 200 && l1.s.data.level?.first && l1.s.data.level.stars === l1.res.stars, `1-й уровень пройден: ${l1.res.stars}★ за ${l1.res.ticks} ходов`, l1.s.data.level);
  ok(l1.s.data.player.coins >= coinsBefore + l1.s.data.level.bonus && l1.s.data.level.bonus >= 120, `награда за уровень +${l1.s.data.level?.bonus}`);
  ok(l1.s.data.result.rated === false, "уровни не идут в общий рейтинг");
  r = await call(Cc, "GET", "/api/levels"); ok(r.data.levels[1].unlocked && r.data.levels[0].done && r.data.total_stars === l1.res.stars, "2-й уровень открылся, звёзды сохранены");
  ok(r.data.leaderboard.some((x) => x.is_me), "рейтинг по звёздам");
  r = await call(Cc, "POST", "/api/run", { kind: "level", ref: 1 }); ok(r.data.ghost && r.data.ghost.label === "Твой лучший" && r.data.cfg.seed === Number(r.data.ghost.cfg.seed), "повтор уровня — с призраком своего лучшего на том же поле");
  const l1b = await playLevelApi(Cc, 1); ok(l1b.s.data.level && !l1b.s.data.level.first, "повторное прохождение — без награды за первое");
  // проваленный уровень
  const rr = await call(Cc, "POST", "/api/run", { kind: "level", ref: 2 }); const gg = new E.Game(rr.data.cfg); gg.safeUntil = 0; gg.setdir(0, -1); while (!gg.over) gg.tick();
  await sleep(Math.max(0, gg.gameTime - 2000) + 200);
  r = await call(Cc, "POST", "/api/score", { token: rr.data.token, log: E.encodeLog(gg.log), ticks: gg.ticks }); ok(r.data.level?.failed, "смерть на уровне — уровень не засчитан", r.data.level);
  // подделка: прислать «прохождение» другого уровня тем же логом нельзя — сервер переигрывает по своему токену
  r = await call(Cc, "GET", "/api/levels"); ok(!r.data.levels[1].done, "2-й уровень не отмечен пройденным");

  console.log("• аксессуары, достижения, правила v3");
  await call(admin, "POST", "/api/admin/player/grant", { telegram_id: "4002", coins: 10000 });
  r = await call(B, "POST", "/api/accessory", { accessory: "cap" }); ok(r.status === 200 && r.data.player.accessory === "cap" && r.data.player.owned_accessories.includes("cap"), "кепка куплена за монеты и надета");
  r = await call(B, "POST", "/api/accessory", { accessory: "crown" }); ok(r.status === 402, "корона — только за Stars");
  r = await call(B, "POST", "/api/accessory", { accessory: "" }); ok(r.data.player.accessory === "", "аксессуар снят");
  r = await call(B, "POST", "/api/accessory", { accessory: "nope" }); ok(r.status === 400, "несуществующий аксессуар — отказ");
  r = await call(B, "POST", "/api/invoice", { accessory: "crown" }); ok(r.status === 200 && r.data.url, "счёт на корону");
  await webhook({ message: { chat: { id: 4002 }, from: { id: 4002 }, successful_payment: { currency: "XTR", total_amount: 150, invoice_payload: "acc:crown:4002", telegram_payment_charge_id: "ch-acc-crown" } } }); await sleep(400);
  r = await call(B, "GET", "/api/me"); ok(r.data.player.owned_accessories.includes("crown") && r.data.player.accessory === "crown", "корона выдана после оплаты Stars");
  r = await call(admin, "POST", "/api/admin/payments/refund", { charge_id: "ch-acc-crown" });
  r = await call(B, "GET", "/api/me"); ok(!r.data.player.owned_accessories.includes("crown") && r.data.player.accessory === "", "возврат Stars забирает корону");
  const al = r.data.player.achievements_list; ok(al.length >= 25 && al.every((x) => x.group && x.target), `достижений: ${al.length}, у всех есть прогресс`);
  r = await call(Cc, "GET", "/api/me"); ok(r.data.player.levels_done >= 1 && r.data.player.level_stars >= 1, "в профиле — пройденные уровни и звёзды", { l: r.data.player.levels_done, s: r.data.player.level_stars });
  r = await call(A, "POST", "/api/run", { mode: "rocks" }); ok(r.data.cfg.rules === E.RULES && E.RULES >= 3, "новые забеги идут по правилам v3");

  console.log("• v4: подземелье, головоломка, мастерская, питомец, колесо, подарки, праздник, дуэль");
  async function playV4(u, body, pick = 0, stopFloor = 2) {
    const rr = await call(u, "POST", "/api/run", body); if (!rr.data?.token) return { rr };
    const g = new E.Game(rr.data.cfg);
    while (!g.over && g.ticks < 4000) { if (g.choosing) { if (g.floor >= stopFloor) break; g.choose(pick); continue; } LB.step(g); g.tick(); }
    await sleep(Math.max(0, g.gameTime - 130 * g.log.length - 2000) + 200);
    const sc = await call(u, "POST", "/api/score", { token: rr.data.token, log: E.encodeLog(g.log), ticks: g.ticks });
    return { rr, g, sc };
  }
  let v = await playV4(A, { mode: "dungeon" }, 1, 3);
  ok(v.rr.data.cfg.mode === "dungeon" && v.sc.data.dungeon?.floor === v.g.floor && v.g.floor >= 2, "подземелье: этаж засчитан сервером", v.sc.data.dungeon);
  r = await call(A, "GET", "/api/dungeon"); ok(r.data.leaderboard.some((x) => x.is_me) && r.data.upgrades.armor, "рейтинг подземелья");
  r = await call(A, "POST", "/api/run", { mode: "custom" }); ok(r.data.cfg.mode === "classic", "скрытый режим без разрешения — классика");
  v = await playV4(B, { kind: "puzzle" });
  ok(v.sc.data.puzzle && !v.sc.data.puzzle.failed && v.sc.data.puzzle.first && v.sc.data.puzzle.bonus > 0, "головоломка решена, бонус за первое решение", v.sc.data.puzzle);
  const v2 = await playV4(B, { kind: "puzzle" }); ok(v2.sc.data.puzzle && !v2.sc.data.puzzle.first && !v2.sc.data.puzzle.bonus, "повторное решение — без бонуса");
  r = await call(A, "GET", "/api/puzzle"); ok(r.data.leaderboard.length >= 1 && r.data.walls && r.data.par > 0, "рейтинг головоломки и схема поля");
  r = await call(A, "POST", "/api/custom/save", { name: "Тест-уровень", walls: [30, 31, 32, 33, 34, 35], target: 6 }); ok(r.data.id, "уровень сохранён", r.data);
  const lvId = r.data.id;
  r = await call(A, "POST", "/api/custom/save", { name: "Коробка", walls: [...Array.from({ length: 15 }, (_, i) => 10 * 24 + 5 + i), ...Array.from({ length: 15 }, (_, i) => 14 * 24 + 5 + i), 11 * 24 + 5, 12 * 24 + 5, 13 * 24 + 5, 11 * 24 + 19, 12 * 24 + 19, 13 * 24 + 19], target: 10 });
  ok(r.status === 400, "запертый старт — уровень не сохраняется");
  const coinsA0 = (await call(A, "GET", "/api/me")).data.player.coins;
  v = await playV4(Cc, { kind: "custom", ref: lvId });
  ok(v.sc.data.custom?.completed && v.sc.data.custom.first, "чужой уровень пройден", v.sc.data.custom);
  ok((await call(A, "GET", "/api/me")).data.player.coins === coinsA0 + 10, "автору +10 монет за первое прохождение");
  r = await call(Cc, "POST", "/api/custom/like", { id: lvId }); ok(r.data.liked && r.data.likes === 1, "лайк");
  r = await call(A, "POST", "/api/custom/like", { id: lvId }); ok(r.status === 400, "свой уровень лайкать нельзя");
  r = await call(Cc, "GET", "/api/custom?tab=week"); ok(r.data.levels.some((x) => x.id === lvId && x.liked && x.won), "уровень в подборке недели");
  r = await call(B, "POST", "/api/run", { kind: "custom", ref: "deadbeef" }); ok(r.status === 404, "несуществующий уровень — 404");
  r = await call(B, "POST", "/api/pet/adopt", { pet: "cat" }); ok(r.data.player?.pet?.id === "cat" && r.data.player.pet.hungry, "питомец взят");
  r = await call(B, "POST", "/api/pet/feed", {}); ok(r.data.player?.pet?.fed_today && r.data.player.pet.bonus > 0, "питомец накормлен — бонус активен");
  r = await call(B, "POST", "/api/pet/feed", {}); ok(r.status === 400, "второй раз за день — нельзя");
  r = await call(B, "POST", "/api/wheel", {}); ok(r.data.ok && r.data.index >= 0 && r.data.prize, "колесо удачи", r.data.prize);
  r = await call(B, "POST", "/api/wheel", {}); ok(r.status === 400, "колесо — раз в день");
  r = await call(B, "GET", "/api/friends"); const fr = r.data.friends[0];
  ok(fr && r.data.gift.left_today === 1000, "список друзей для подарков", r.data.friends.map((x) => x.name));
  if (fr) {
    const before = (await call(B, "GET", "/api/me")).data.player.coins;
    r = await call(B, "POST", "/api/gift", { to: fr.id, coins: 100 }); ok(r.data.ok && r.data.player.coins === before - 100, "подарок 100 монет");
    r = await call(B, "POST", "/api/gift", { to: fr.id, coins: 1000 }); ok(r.status === 400 && r.data.error === "Daily gift limit", "дневной лимит подарков");
  }
  r = await call(B, "POST", "/api/gift", { to: "999999", coins: 100 }); ok(r.status === 403, "подарок не другу — нельзя");
  r = await call(admin, "POST", "/api/admin/holiday", { value: "halloween" }); ok(r.data.current?.id === "halloween", "админ включил Хэллоуин");
  v = await playV4(B, { mode: "classic" });
  ok(v.sc.data.result?.candies > 0, "конфеты за фрукты в праздник", v.sc.data.result?.candies);
  r = await call(B, "POST", "/api/profile", { skin: "hw_pumpkin" }); ok(r.status === 200 || r.data?.error === "Not enough candies", "покупка за конфеты", r.data?.error);
  await call(admin, "POST", "/api/admin/holiday", { value: "" });
  r = await call(B, "POST", "/api/profile", { skin: "hw_skeleton" }); ok(r.status === 403 || r.status === 400, "после праздника за конфеты не купить");
  // дуэль через WebSocket: комната по ссылке, бой до конца
  if (typeof WebSocket === "function") {
    const wsUrl = BASE.replace(/^http/, "ws") + "/ws/duel";
    const conn = (u) => new Promise((res) => { const w = new WebSocket(wsUrl), c = { w, msgs: [] }; w.onmessage = (e) => c.msgs.push(JSON.parse(e.data)); w.onopen = () => { w.send(JSON.stringify({ t: "auth", init: u.init })); res(c); }; });
    const wa = await conn(A), wb = await conn(B); await sleep(300);
    wa.w.send(JSON.stringify({ t: "create" })); await sleep(300);
    const room = wa.msgs.find((m) => m.t === "room"); ok(room && /^[0-9a-f]{8}$/.test(room.id), "дуэль: комната создана");
    wb.w.send(JSON.stringify({ t: "join", id: room?.id })); await sleep(400);
    wa.w.send(JSON.stringify({ t: "d", d: 0 })); // A ещё во время отсчёта поворачивает вверх — в стену; B едет прямо
    await sleep(3200);
    for (let i = 0; i < 40 && !wa.msgs.some((m) => m.t === "end"); i++) await sleep(250);
    const ea = wa.msgs.find((m) => m.t === "end"), eb = wb.msgs.find((m) => m.t === "end");
    ok(ea && eb && ea.winner === 1 && eb.reward === 100, "дуэль: A врезался, B победил и получил награду", { ea, eb });
    r = await call(B, "GET", "/api/me"); ok(r.data.player.duel_wins >= 1, "победа в дуэли записана");
    wa.w.close(); wb.w.close();
  } else console.log("  (WebSocket нет в этой версии Node — дуэль не проверяем)");

  console.log("• админка: удержание, античит, реплей");
  r = await call(admin, "GET", "/api/admin/retention"); ok(r.data.cohorts.length >= 1 && r.data.funnel.registered >= 5 && r.data.funnel.paid >= 1, "когорты и воронка", r.data.funnel);
  r = await call(admin, "GET", "/api/admin/suspicious"); ok(Array.isArray(r.data.runs), `подозрительных забегов: ${r.data.runs.length} (бот играет почти идеально — должен попадаться)`);
  ok(r.data.runs.length > 0, "бот помечен античитом");
  r = await call(admin, "GET", `/api/admin/game/${a1.s.data.result.game_id}/replay`); ok(r.data.log && r.data.score === a1.res.score, "реплей забега для админа");
  r = await call(A, "GET", `/api/admin/game/${a1.s.data.result.game_id}/replay`); ok(r.status === 403, "обычному игроку — нельзя");

  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВСЕ ПРОВЕРКИ ПРОШЛИ");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
