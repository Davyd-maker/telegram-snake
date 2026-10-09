// Тесты правил игры (public/engine.js). Запуск: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/engine.js");

// Жадный бот: идёт к еде и не врезается на ход вперёд
function bot(g) {
  const h = g.snake[0], f = g.food, N = E.N;
  const opts = E.DIRS.map(([x, y]) => ({ x, y })).filter((d) => !(d.x === -g.dir.x && d.y === -g.dir.y));
  const safe = (d) => {
    let nx = h.x + d.x, ny = h.y + d.y;
    if (g.cfg.mode !== "nowalls" && (nx < 0 || ny < 0 || nx >= N || ny >= N)) return false;
    nx = (nx + N) % N; ny = (ny + N) % N;
    if (g.rockSet[ny * N + nx]) return false;
    const t = g.snake[g.snake.length - 1];
    return !(g.occ[ny * N + nx] && !(t.x === nx && t.y === ny && g.pendingGrowth <= 0));
  };
  const s = opts.filter(safe);
  s.sort((a, b) => (Math.abs(h.x + a.x - f.x) + Math.abs(h.y + a.y - f.y)) - (Math.abs(h.x + b.x - f.x) + Math.abs(h.y + b.y - f.y)));
  return s[0] || null;
}
function play(cfg, maxTicks = 600, extra) {
  const g = new E.Game(cfg);
  while (!g.over && g.ticks < maxTicks) {
    const d = bot(g);
    if (d && (d.x !== g.dir.x || d.y !== g.dir.y)) g.setdir(d.x, d.y);
    if (extra) extra(g);
    g.tick();
  }
  return g;
}

test("одинаковый seed — одинаковое поле", () => {
  const foods = (seed) => { const g = new E.Game({ seed, mode: "rocks" }); const out = [g.food]; for (let i = 0; i < 4; i++) { g.placeFood(); out.push(g.food); } return { out, rocks: g.rocks }; };
  assert.deepEqual(foods(42), foods(42));
  assert.notDeepEqual(foods(42), foods(43));
});

for (const rules of [1, E.RULES]) for (const mode of Object.keys(E.MODES)) {
  for (const diff of Object.keys(E.DIFFS)) {
    test(`переигровка по логу даёт тот же результат: правила v${rules}, ${mode}/${diff}`, () => {
      const cfg = { seed: 1000 + mode.length * 7 + diff.length, mode, diff, artifact: "magnet", artLevel: 3, rules };
      const g = play(cfg, 500);
      const res = g.result();
      const sim = E.simulate(cfg, E.parseLog(E.encodeLog(g.log)), res.ticks);
      assert.equal(sim.score, res.score);
      assert.equal(sim.apples, res.apples);
      assert.equal(sim.runCoins, res.runCoins);
      assert.equal(sim.gameTime, res.gameTime);
    });
  }
}

test("пауза (resume) записывается в лог и переигрывается", () => {
  const cfg = { seed: 7, mode: "classic", artifact: "phantom", artLevel: 5 };
  const g = play(cfg, 400, (g) => { if (g.ticks === 50 || g.ticks === 120) g.resume(); });
  const sim = E.simulate(cfg, E.parseLog(E.encodeLog(g.log)), g.ticks);
  assert.equal(sim.score, g.score);
  assert.ok(g.log.some((e) => (e & 7) === 4));
});

test("безопасный старт: удар о стену в первые 2 секунды не убивает", () => {
  const g = new E.Game({ seed: 5 });
  g.setdir(0, -1);
  for (let i = 0; i < 14; i++) g.tick(); // 12 клеток до верхней стены
  assert.equal(g.over, false);
  for (let i = 0; i < 40 && !g.over; i++) g.tick();
  assert.equal(g.over, true, "после окончания неуязвимости стена смертельна");
});

test("щит спасает один раз", () => {
  const g = new E.Game({ seed: 9 });
  g.safeUntil = 0; g.shield = true;
  g.setdir(0, -1);
  let saved = 0;
  for (let i = 0; i < 40 && !g.over; i++) for (const e of g.tick()) if (e.t === "save" && e.kind === "shield") saved++;
  assert.equal(saved, 1);
  assert.equal(g.shield, false);
});

test("бомба укорачивает змейку вдвое (не короче стартовой)", () => {
  const g = new E.Game({ seed: 11 });
  for (let i = 0; i < 12; i++) { const t = g.snake[g.snake.length - 1]; g.snake.push({ x: t.x, y: t.y }); g.occ[t.y * E.N + t.x]++; }
  const len = g.snake.length, ev = [];
  g.activatePu("bomb", ev);
  assert.equal(g.snake.length, Math.max(E.START_LEN, Math.ceil(len / 2)));
  assert.ok(ev.some((e) => e.t === "bomb"));
});

test("артефакты сильнее с уровнем", () => {
  const a1 = E.artifactStats("magnet", 1), a5 = E.artifactStats("magnet", 5);
  assert.ok(a5.magnetRange > a1.magnetRange);
  assert.ok(a5.phantomCharges > a1.phantomCharges);
  assert.ok(a5.berserkBonus > a1.berserkBonus);
});

test("награда учитывает режим и сложность", () => {
  const res = { score: 100, runCoins: 50 };
  assert.equal(E.reward(res, { mode: "classic", diff: "normal" }, false), 250);
  assert.equal(E.reward(res, { mode: "classic", diff: "normal" }, true), 350);
  assert.equal(E.reward(res, { mode: "nowalls", diff: "normal" }, false), 125);
  assert.equal(E.reward(res, { mode: "moving", diff: "hard" }, false), Math.floor(250 * 1.5 * 1.5));
  assert.equal(E.isRated({ mode: "classic", diff: "easy" }), false);
  assert.equal(E.isRated({ mode: "classic", diff: "hard" }), true);
  assert.equal(E.isRated({ mode: "rocks", diff: "normal" }), false);
});

test("лабиринт и камни не перекрывают стартовую позицию", () => {
  for (const mode of ["maze", "rocks"]) for (let seed = 1; seed < 40; seed++) {
    const g = new E.Game({ seed, mode });
    for (const s of g.snake) assert.equal(g.rockSet[s.y * E.N + s.x], 0, `${mode} seed ${seed}`);
    for (let x = 13; x < 18; x++) assert.equal(g.rockSet[12 * E.N + x], 0, `${mode} seed ${seed}: путь вперёд`);
  }
});

test("испорченный лог отклоняется", () => {
  assert.equal(E.parseLog("16,8"), null);        // время идёт назад
  assert.equal(E.parseLog("13"), null);          // неизвестная операция
  assert.equal(E.parseLog("1.5"), null);
  assert.equal(E.parseLog("-8"), null);
  assert.deepEqual(E.parseLog(""), []);
  assert.deepEqual(E.parseLog("8,17,20"), [8, 17, 20]);
});


// ---- магнит (правила v2) ----
function magnetGame(food, opts = {}) {
  const g = new E.Game({ seed: 3, artifact: opts.artifact ?? "magnet", artLevel: opts.level || 1, rules: opts.rules || E.RULES });
  g.food = { ...food, type: "apple" };
  if (opts.bonus) g.fx.magnet = 1e9;
  return g;
}
test("магнит: еда спереди по диагонали подтягивается на линию движения и съедается", () => {
  // голова (12,12) едет вправо; после хода голова (13,12), еда (14,13) — спереди и на клетку в сторону
  const g = magnetGame({ x: 14, y: 13 });
  const ev = g.tick();
  assert.ok(ev.some((e) => e.t === "pull"));
  assert.deepEqual([g.food.x, g.food.y], [14, 12], "еда встала прямо перед головой");
  g.tick();
  assert.equal(g.apples, 1, "и съедена следующим ходом");
});
test("магнит: еда сзади и сбоку на уровне головы не притягивается", () => {
  for (const f of [{ x: 11, y: 10 }, { x: 13, y: 10 }]) { // после хода голова (13,12): (11,10) — сзади, (13,10) — сбоку
    const g = magnetGame(f);
    const ev = g.tick();
    assert.ok(!ev.some((e) => e.t === "pull"), JSON.stringify(f));
    assert.deepEqual([g.food.x, g.food.y], [f.x, f.y]);
  }
});
test("магнит: радиус артефакта растёт с уровнем, бонус тянет издалека", () => {
  const far = { x: 15, y: 14 }; // после хода голова (13,12): 2 вперёд + 2 вбок = 4
  assert.ok(!magnetGame(far, { level: 1 }).tick().some((e) => e.t === "pull"), "ур. 1 (радиус 2) — не достаёт");
  assert.ok(magnetGame(far, { level: 5 }).tick().some((e) => e.t === "pull"), "ур. 5 (радиус 4) — тянет");
  assert.ok(magnetGame({ x: 17, y: 14 }, { artifact: "", bonus: true }).tick().some((e) => e.t === "pull"), "бонус — радиус 6");
  assert.ok(!magnetGame(far, { artifact: "" }).tick().some((e) => e.t === "pull"), "без магнита — ничего");
});
test("старые забеги (правила v1) переигрываются по старому магниту", () => {
  const g = magnetGame({ x: 14, y: 13 }, { rules: 1 });
  g.tick();
  assert.deepEqual([g.food.x, g.food.y], [14, 13], "старый магнит не тянет по диагонали");
  assert.equal(E.normCfg({}).rules, 1);
  assert.equal(E.normCfg({ rules: 2 }).rules, 2);
});

// ---- режим «Уровни» ----
const { playLevel } = require("./levelbot");
test("уровни: 30 штук, старт свободен, места для еды хватает", () => {
  assert.equal(E.LEVELS.length, 30);
  for (const L of E.LEVELS) {
    const g = new E.Game({ mode: "level", level: L.n, seed: 1, rules: E.RULES });
    for (let x = 6; x <= 18; x++) assert.equal(g.rockSet[12 * E.N + x] | g.gateSet[12 * E.N + x], 0, `уровень ${L.n}: стартовый коридор`);
    const reachable = g.blocked.reduce((a, b) => a + (b ? 0 : 1), 0);
    assert.ok(reachable >= 250, `уровень ${L.n}: доступно ${reachable} клеток`);
    assert.ok(L.target > 0 && L.par > L.target);
  }
});
test("уровни: каждый проходим (бот с поиском пути) и переигровка по логу совпадает", () => {
  for (const L of E.LEVELS) {
    let done = null;
    for (const seed of [11, 22, 33, 44, 55]) { const g = playLevel(L.n, seed); if (g.result().completed) { done = g; break; } }
    assert.ok(done, `уровень ${L.n} не пройден ботом ни на одном поле`);
    const r = done.result();
    const sim = E.simulate(done.cfg, E.parseLog(E.encodeLog(done.log)), r.ticks + 1);
    assert.equal(sim.completed, true, `уровень ${L.n}: переигровка`);
    assert.equal(sim.score, r.score); assert.equal(sim.stars, r.stars);
  }
});
test("уровни: норка появляется только после цели, звёзды за скорость", () => {
  const g = playLevel(1, 11);
  assert.ok(g.result().completed && g.score >= E.LEVELS[0].target);
  assert.equal(E.levelStars(1, 1), 3);
  assert.equal(E.levelStars(1, E.LEVELS[0].par + 1), 2);
  assert.equal(E.levelStars(1, Math.ceil(E.LEVELS[0].par * 1.6) + 1), 1);
  const fresh = new E.Game({ mode: "level", level: 1, seed: 11, rules: E.RULES });
  assert.equal(fresh.hole, null);
});

// ---- правила v3 ----
test("v3: портал переносит голову во вторую клетку", () => {
  const g = new E.Game({ seed: 5, mode: "classic", rules: 3 });
  g.safeUntil = 0; g.food = { x: 0, y: 0, type: "apple" };
  g.portals = [{ x: 13, y: 12 }, { x: 3, y: 20 }]; g.fx.portal = 99999;
  const ev = g.tick();
  assert.ok(ev.some((e) => e.t === "teleport"));
  assert.deepEqual(g.snake[0], { x: 3, y: 20 });
});
test("v3: щит разбивает камень, а v2 — нет", () => {
  for (const rules of [2, 3]) {
    const g = new E.Game({ seed: 5, mode: "rocks", rules });
    g.safeUntil = 0; g.shield = true; g._setRocks([{ x: 13, y: 12 }]); g.food = { x: 0, y: 0, type: "apple" };
    const ev = g.tick();
    assert.equal(ev.some((e) => e.t === "smash"), rules === 3);
    assert.equal(g.rockSet[12 * 24 + 13], rules === 3 ? 0 : 1);
  }
});
test("v3: заморозка не даёт комбо сгореть", () => {
  const g = new E.Game({ seed: 5, mode: "nowalls", rules: 3 });
  g.combo = 3; g.comboTimer = 1; g.fx.freeze = 1e9; g.food = { x: 0, y: 0, type: "apple" };
  for (let i = 0; i < 10; i++) g.tick();
  assert.equal(g.combo, 3);
});
test("v2: бонусы только старые шесть (реплеи не меняются)", () => {
  const seen = new Set();
  for (let s = 1; s < 200; s++) { const g = new E.Game({ seed: s, rules: 2 }); g.snake.length = 10; g.spawnPu(); seen.add(g.pu.type); }
  assert.ok(!seen.has("portal") && !seen.has("freeze"));
  const seen3 = new Set();
  for (let s = 1; s < 200; s++) { const g = new E.Game({ seed: s, rules: 3 }); g.snake.length = 10; g.spawnPu(); seen3.add(g.pu.type); }
  assert.ok(seen3.has("portal") && seen3.has("freeze"));
});
test("v3: на 10-м уровне есть вор, на 20-м поле сужается", () => {
  const g10 = new E.Game({ mode: "level", level: 10, seed: 3, rules: 3 });
  assert.ok(g10.rival && g10.rival.body.length === 5);
  const g10old = new E.Game({ mode: "level", level: 10, seed: 3, rules: 2 });
  assert.equal(g10old.rival, null);
  const g20 = new E.Game({ mode: "level", level: 20, seed: 3, rules: 3 });
  const before = g20.rocks.length; g20.safeUntil = 1e9;
  for (let i = 0; i < 150 && !g20.over; i++) { g20.fx.ghost = 0; g20.tick(); }
  assert.ok(g20.shrinkStep === 1 && g20.baseRocks.length > E.LEVELS[19].walls.length, "первое сужение случилось " + before);
});
