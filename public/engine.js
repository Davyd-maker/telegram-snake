// Правила игры Snake Arena. ОДИН файл для клиента и сервера: клиент играет по нему,
// а сервер переигрывает забег по логу поворотов (src/replay.js) и считает очки сам.
// Всё детерминировано: случайность — только через seed (mulberry32), время — только через число ходов.
// Не добавляй сюда Math.random(), Date.now() и всё, что зависит от экрана.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SnakeEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const N = 24, START_LEN = 4, SAFE_MS = 2000;
  const SPEED_START = 120, SPEED_MIN = 75;      // мс на ход
  const COMBO_WINDOW = 40, COMBO_MAX = 5;
  const PU_LIFE = 9000;
  const GROWTH = { apple: 1, coin: 1, gold: 3 };
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // код направления 0..3: вверх, вправо, вниз, влево
  const OP_RESUME = 4;                              // в логе: «продолжили после паузы»
  const OP_CHOOSE = 5;                              // 5..7 — выбор улучшения 0..2 в «Подземелье» (правила v4)

  // Режимы: mult — множитель награды, rated — идёт в общий рейтинг и сезон
  const MODES = {
    classic: { name: "Классика",       emoji: "🧱", mult: 1,    rated: true,  hint: "Стены смертельны · идёт в рейтинг и сезон" },
    nowalls: { name: "Без стен",       emoji: "🌀", mult: 0.5,  rated: false, hint: "Стены проходимы · награда ×0.5" },
    rocks:   { name: "Камни",          emoji: "🪨", mult: 1.25, rated: false, hint: "Случайные камни на поле · награда ×1.25" },
    maze:    { name: "Лабиринт",       emoji: "🧩", mult: 1.25, rated: false, hint: "Фиксированные стены · награда ×1.25" },
    moving:  { name: "Живые стены",    emoji: "⚡", mult: 1.5,  rated: false, hint: "Камни появляются и исчезают · награда ×1.5" },
    level:   { name: "Уровни",         emoji: "🕳️", mult: 1,    rated: false, hidden: true, hint: "Набери цель и заползи в норку" },
    // правила v4
    dungeon: { name: "Подземелье",     emoji: "🗝️", mult: 1.2,  rated: false, hidden: true, hint: "Этаж за этажом: после каждого выбери улучшение" },
    puzzle:  { name: "Головоломка",    emoji: "🧩", mult: 0.5,  rated: false, hidden: true, hint: "Собери фрукты и доползи до норки за меньшее число ходов" },
    custom:  { name: "Уровень игрока", emoji: "🛠️", mult: 0.5,  rated: false, hidden: true, hint: "Поле, нарисованное другим игроком" }
  };
  // Сложность: speed — множитель длительности хода (меньше — быстрее)
  const DIFFS = {
    easy:   { name: "Лёгкая",  speed: 1.3, mult: 0.7 },
    normal: { name: "Обычная", speed: 1,   mult: 1 },
    hard:   { name: "Сложная", speed: 0.8, mult: 1.5 }
  };
  // Бонусы на поле. Порядок ключей важен: от него зависит выбор типа по seed
  const PU = {
    slow:   { icon: "⏳", color: "#5ad1ff", dur: 8000,  name: "Замедление" },
    x2:     { icon: "💎", color: "#ffd84c", dur: 10000, name: "×2 очки" },
    ghost:  { icon: "👻", color: "#c58bff", dur: 6000,  name: "Призрак" },
    shield: { icon: "🛡️", color: "#6dffb0", dur: 0,     name: "Щит" },
    magnet: { icon: "🧲", color: "#55d6ff", dur: 9000,  name: "Магнит" },
    bomb:   { icon: "💣", color: "#ff8a4c", dur: 0,     name: "Бомба" },
    // с правил v3
    portal: { icon: "🌀", color: "#b07cff", dur: 12000, name: "Портал" },
    freeze: { icon: "🧊", color: "#9ff0ff", dur: 10000, name: "Заморозка комбо" }
  };
  const PU_V2 = ["slow", "x2", "ghost", "shield", "magnet", "bomb"];
  const TIMED = ["slow", "x2", "ghost", "magnet", "portal", "freeze"];
  const MAX_ART_LEVEL = 5;
  // Версия правил. Старые забеги (реплеи, призраки) переигрываются по своей версии, новые — по последней.
  // 2 — новый магнит: тянет еду на клетку перед головой и только спереди.
  // 3 — боссы на уровнях 10/20/30, бонусы «Портал» и «Заморозка комбо», щит разбивает камни.
  // 4 — режимы «Подземелье», «Головоломка дня» и уровни игроков (на старые режимы не влияет).
  const RULES = 4;
  // Улучшения «Подземелья»: после каждого этажа предлагаются три на выбор. once — можно взять только раз
  const UPGRADES = {
    armor:  { icon: "🛡️", name: "Броня",         desc: "+1 спасение от столкновения" },
    magnet: { icon: "🧲", name: "Вечный магнит", desc: "Магнит до конца забега, повтор — +1 к радиусу" },
    slow:   { icon: "🐢", name: "Спокойствие",   desc: "Змейка ползёт на 10% медленнее" },
    greed:  { icon: "💰", name: "Жадность",      desc: "Монеты и звёзды попадаются чаще" },
    points: { icon: "💎", name: "Огранка",       desc: "+30% очков за еду" },
    rhythm: { icon: "⚡", name: "Ритм",          desc: "Комбо держится дольше" },
    luck:   { icon: "🍀", name: "Удача",         desc: "Бонусы на поле появляются чаще" },
    lean:   { icon: "✂️", name: "Стройность",    desc: "Змейка растёт вдвое медленнее", once: true }
  };
  const BONUS_MAGNET_RANGE = 6;
  // Артефакты по уровням прокачки
  const artifactStats = (id, lvl) => {
    lvl = Math.max(1, Math.min(MAX_ART_LEVEL, lvl | 0 || 1));
    return {
      magnetRange: 2 + (lvl >= 3 ? 1 : 0) + (lvl >= 5 ? 1 : 0),
      phantomCharges: 1 + (lvl >= 3 ? 1 : 0) + (lvl >= 5 ? 1 : 0),
      berserkBonus: 1.25 + 0.05 * (lvl - 1)
    };
  };

  function mulberry32(a) {
    a >>>= 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Фиксированный лабиринт: полосы и стойки, коридор по центру (строки 11–13) свободен
  const MAZE = (() => {
    const out = [];
    for (let x = 3; x <= 8; x++) for (const y of [5, 18]) out.push([x, y]);
    for (let x = 15; x <= 20; x++) for (const y of [5, 18]) out.push([x, y]);
    for (let y = 8; y <= 10; y++) for (const x of [5, 18]) out.push([x, y]);
    for (let y = 14; y <= 16; y++) for (const x of [5, 18]) out.push([x, y]);
    return out;
  })();


  // ---------------- Режим «Уровни» ----------------
  // 30 уровней в 3 главах. Раскладки нарисованы заранее (одинаковые у всех). Стартовый коридор (строки 11–13,
  // столбцы 6–18) всегда свободен. Еда и норка появляются только в клетках, куда можно доползти.
  const LEVELS = (() => {
    const H = (y, x1, x2) => { const o = []; for (let x = x1; x <= x2; x++) o.push([x, y]); return o; };
    const V = (x, y1, y2) => { const o = []; for (let y = y1; y <= y2; y++) o.push([x, y]); return o; };
    const box = (x1, y1, x2, y2) => [...H(y1, x1, x2), ...H(y2, x1, x2), ...V(x1, y1 + 1, y2 - 1), ...V(x2, y1 + 1, y2 - 1)];
    const blk = (x, y, w = 2, h = 2) => { const o = []; for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) o.push([x + i, y + j]); return o; };
    const mir = (cells) => cells.flatMap(([x, y]) => [[x, y], [N - 1 - x, y], [x, N - 1 - y], [N - 1 - x, N - 1 - y]]);
    const without = (cells, holes) => cells.filter(([x, y]) => !holes.some(([a, b]) => a === x && b === y));
    const grid = (step, off) => { const o = []; for (let x = off; x < N; x += step) for (let y = off; y < N; y += step) o.push([x, y]); return o; };
    const sideGaps = (x1, y1, x2, y2) => { const mx = Math.floor((x1 + x2) / 2), my = Math.floor((y1 + y2) / 2); return [[mx, y1], [mx + 1, y1], [mx, y2], [mx + 1, y2], [x1, my], [x1, my + 1], [x2, my], [x2, my + 1]]; };
    const ring = (x1, y1, x2, y2) => without(box(x1, y1, x2, y2), sideGaps(x1, y1, x2, y2));
    const gate = (cells, period, phase = 0) => ({ cells, period, phase });
    const diag = () => { const o = []; for (let i = 2; i < N - 2; i += 3) o.push([i, i], [N - 1 - i, i]); return o; };
    const H_ = () => mir([...V(3, 3, 8), ...V(7, 3, 8), ...H(5, 4, 6)]);
    const rooms = () => [...without(V(11, 0, 23), [[11, 5], [11, 6], [11, 17], [11, 18]]), ...without(H(5, 0, 23), [[5, 5], [6, 5], [17, 5], [18, 5]]), ...without(H(18, 0, 23), [[5, 18], [6, 18], [17, 18], [18, 18]])];
    const roomDoors = [[11, 5], [11, 6], [11, 17], [11, 18], [5, 5], [6, 5], [17, 5], [18, 5], [5, 18], [6, 18], [17, 18], [18, 18]];
    const spiral = () => [...without(box(3, 3, 20, 20), [[3, 6], [3, 7]]), ...without(box(7, 7, 16, 16), [[16, 15], [16, 16]])];
    const comb = () => [...[3, 7, 11, 15, 19].flatMap((x) => V(x, 0, 8)), ...[5, 9, 13, 17, 21].flatMap((x) => V(x, 15, 23))];
    const MZ = MAZE.map(([x, y]) => [x, y]);
    // t — цель по очкам, s — скорость (множитель длительности хода: меньше — быстрее), m — «живые» камни
    const raw = [
      // Глава 1 — «Сад»
      { t: 10, s: 1.08, w: [] },
      { t: 12, s: 1.07, w: mir(blk(4, 4)) },
      { t: 14, s: 1.06, w: [...H(5, 6, 17), ...H(18, 6, 17)] },
      { t: 16, s: 1.05, w: mir(V(6, 3, 8)) },
      { t: 18, s: 1.04, w: ring(2, 2, 21, 21) },
      { t: 20, s: 1.03, w: diag() },
      { t: 22, s: 1.02, w: [...V(7, 2, 21), ...V(16, 2, 21)] },
      { t: 24, s: 1.01, w: H_() },
      { t: 26, s: 1.0, w: grid(4, 3) },
      { t: 32, s: 1.0, w: [...ring(5, 5, 18, 18), ...mir(blk(1, 1))], boss: true, rival: true },
      // Глава 2 — «Подземелье»
      { t: 28, s: 0.98, w: [...H(4, 0, 17), ...H(8, 6, 23), ...H(15, 0, 17), ...H(19, 6, 23)] },
      { t: 30, s: 0.97, w: mir(blk(5, 5)), m: true },
      { t: 32, s: 0.96, w: spiral() },
      { t: 34, s: 0.95, w: rooms() },
      { t: 36, s: 0.94, w: without(V(12, 0, 23), [[12, 4], [12, 5], [12, 18], [12, 19]]), g: [gate([[12, 4], [12, 5], [12, 18], [12, 19]], 30)] },
      { t: 38, s: 0.93, w: grid(4, 3), m: true },
      { t: 40, s: 0.92, w: [...H(4, 0, 15), ...H(8, 8, 23), ...H(15, 0, 15), ...H(19, 8, 23)] },
      { t: 42, s: 0.91, w: [...MZ, ...mir(blk(1, 1))] },
      { t: 44, s: 0.9, w: rooms(), g: [gate(roomDoors, 36)] },
      { t: 55, s: 0.9, w: [...without(box(4, 4, 19, 19), sideGaps(4, 4, 19, 19)), ...mir(blk(1, 1))], g: [gate(sideGaps(4, 4, 19, 19), 32, 10)], m: true, boss: true, shrink: true },
      // Глава 3 — «Вулкан»
      { t: 45, s: 0.88, w: grid(3, 1) },
      { t: 48, s: 0.87, w: [...ring(2, 2, 21, 21), ...ring(6, 6, 17, 17)], g: [gate(sideGaps(6, 6, 17, 17), 28)] },
      { t: 50, s: 0.86, w: comb() },
      { t: 52, s: 0.85, w: comb(), m: true },
      { t: 55, s: 0.84, w: [...MZ, ...H(2, 3, 20), ...H(21, 3, 20)] },
      { t: 58, s: 0.83, w: [], g: [gate(V(12, 0, 23), 24), gate(H(6, 0, 23), 24, 12), gate(H(17, 0, 23), 24, 6)] },
      { t: 60, s: 0.82, w: spiral(), m: true },
      { t: 62, s: 0.81, w: [...H(3, 0, 20), ...H(7, 3, 23), ...H(16, 0, 20), ...H(20, 3, 23)] },
      { t: 65, s: 0.8, w: grid(3, 1), g: [gate(H(6, 0, 23).filter(([x]) => x % 3 !== 1), 26), gate(H(17, 0, 23).filter(([x]) => x % 3 !== 1), 26, 13)], m: true },
      { t: 80, s: 0.78, w: [...ring(2, 2, 21, 21), ...comb().filter(([x, y]) => x > 2 && x < 21 && y > 2 && y < 21)], g: [gate(sideGaps(2, 2, 21, 21), 30, 8)], m: true, boss: true, rival: true }
    ];
    const inStart = ([x, y]) => y >= 11 && y <= 13 && x >= 6 && x <= 18;
    const uniq = (cells) => { const seen = new Set(), o = []; for (const [x, y] of cells) { const k = y * N + x; if (x < 0 || y < 0 || x >= N || y >= N || seen.has(k) || inStart([x, y])) continue; seen.add(k); o.push({ x, y }); } return o; };
    return raw.map((l, i) => ({
      n: i + 1, chapter: Math.floor(i / 10) + 1, target: l.t, speed: l.s, moving: !!l.m, boss: !!l.boss, rival: !!l.rival, shrink: !!l.shrink,
      walls: uniq(l.w), gates: (l.g || []).map((g) => ({ cells: uniq(g.cells), period: g.period, phase: g.phase || 0 })),
      par: l.t * 8 + 70 // ходов на 3 звезды (2 звезды — до ×1.6)
    }));
  })();
  // Звёзды за пройденный уровень: быстрее — больше
  const levelStars = (n, ticks) => { const L = LEVELS[n - 1]; if (!L) return 0; return ticks <= L.par ? 3 : ticks <= L.par * 1.6 ? 2 : 1; };
  // звёзды для любой «уровневой» раскладки: par — на 3 звезды, par2 — на 2
  const starsFor = (L, ticks) => (!L ? 0 : ticks <= L.par ? 3 : ticks <= (L.par2 || L.par * 1.6) ? 2 : 1);

  // ---- общие помощники раскладок ----
  const inStartZone = (x, y) => y >= 11 && y <= 13 && x >= 6 && x <= 18;
  // Клетки, достижимые от старта (12,12), при заданных стенах (Uint8Array N*N)
  function reachMap(wall) {
    const seen = new Uint8Array(N * N), st = [12 * N + 12]; seen[st[0]] = 1;
    while (st.length) {
      const k = st.pop(), x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, nk = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[nk] || wall[nk]) continue;
        seen[nk] = 1; st.push(nk);
      }
    }
    return seen;
  }
  // Кратчайшее расстояние между клетками по полю со стенами (для «пара» головоломки)
  function bfsDist(wall, a, b) {
    if (a.x === b.x && a.y === b.y) return 0;
    const dist = new Int16Array(N * N).fill(-1), q = [a.y * N + a.x]; dist[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const k = q[i], x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, nk = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || dist[nk] >= 0 || wall[nk]) continue;
        dist[nk] = dist[k] + 1; if (nx === b.x && ny === b.y) return dist[nk]; q.push(nk);
      }
    }
    return 999;
  }
  // Случайные фигуры-стены: отрезки, блоки и уголки (вне стартового коридора)
  function shapes(r, count, opts = {}) {
    const out = [], add = (x, y) => { if (x >= 0 && y >= 0 && x < N && y < N && !inStartZone(x, y)) out.push({ x, y }); };
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * N), y = Math.floor(r() * N), kind = Math.floor(r() * 4), len = 3 + Math.floor(r() * 4);
      if (kind === 0) for (let k = 0; k < len; k++) add(x + k, y);
      else if (kind === 1) for (let k = 0; k < len; k++) add(x, y + k);
      else if (kind === 2) { add(x, y); add(x + 1, y); add(x, y + 1); add(x + 1, y + 1); }
      else { for (let k = 0; k < 3; k++) add(x + k, y); for (let k = 1; k < 3; k++) add(x, y + k); }
    }
    if (opts.mirror) for (const c of out.slice()) add(N - 1 - c.x, c.y);
    const seen = new Set();
    return out.filter((c) => { const k = c.y * N + c.x; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // Убирает тупики: клетки, из которых меньше двух выходов (и цепочки за ними), — туда не ставим еду и норку,
  // иначе длинная змейка заползёт и не развернётся. ok[k]=1 — клетка годится.
  function peel(wall, reach) {
    const ok = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) ok[i] = reach[i] && !wall[i] ? 1 : 0;
    const deg = (k) => { const x = k % N, y = (k / N) | 0; let d = 0; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N && ok[ny * N + nx]) d++; } return d; };
    const st = []; for (let i = 0; i < N * N; i++) if (ok[i] && deg(i) <= 1) st.push(i);
    while (st.length) {
      const k = st.pop(); if (!ok[k] || deg(k) > 1) continue; ok[k] = 0;
      const x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, nk = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && ok[nk] && deg(nk) <= 1) st.push(nk); }
    }
    return ok;
  }
  const wallMap = (walls) => { const m = new Uint8Array(N * N); for (const c of walls) m[c.y * N + c.x] = 1; return m; };

  // ---- «Подземелье»: этаж f — свои стены, цель по числу фруктов, скорость растёт ----
  function dungeonFloor(seed, f) {
    const r = mulberry32(((seed ^ 0x9E3779B9) >>> 0) + f * 7919);
    let walls = shapes(r, Math.min(3 + f, 16));
    const reach = reachMap(wallMap(walls));
    let free = 0; for (let i = 0; i < N * N; i++) if (reach[i]) free++;
    if (free < 300) walls = walls.slice(0, Math.floor(walls.length / 2)); // слишком тесно — убираем половину
    return { n: 0, floor: f, need: Math.min(14, 4 + f), target: 0, speed: Math.max(0.72, 1.06 - 0.03 * f), moving: f >= 4 && f % 2 === 0,
      boss: false, rival: false, shrink: false, walls, gates: [], par: 1e9 };
  }

  // ---- «Головоломка дня»: фиксированные фрукты по порядку и норка; меньше ходов — больше звёзд ----
  const PUZZLE_FRUITS = 8;
  function makePuzzle(seed) {
    const r = mulberry32((seed ^ 0x2545F491) >>> 0);
    let walls = shapes(r, 5 + Math.floor(r() * 4), { mirror: true });
    const wall = wallMap(walls), good = peel(wall, reachMap(wall));
    const cells = [];
    for (let i = 0; i < N * N; i++) { const x = i % N, y = (i / N) | 0; if (good[i] && !(y === 12 && x >= 8 && x <= 12)) cells.push({ x, y }); }
    const foods = []; let prev = { x: 12, y: 12 };
    for (let k = 0; k < PUZZLE_FRUITS; k++) {
      const pool = cells.filter((c) => { const d = Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y); return d >= 5 && d <= 14 && !foods.some((f) => f.x === c.x && f.y === c.y); });
      const c = (pool.length ? pool : cells)[Math.floor(r() * (pool.length || cells.length))];
      foods.push({ x: c.x, y: c.y }); prev = c;
    }
    const hp = cells.filter((c) => Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y) >= 6 && !foods.some((f) => f.x === c.x && f.y === c.y));
    const hole = (hp.length ? hp : cells)[Math.floor(r() * (hp.length || cells.length))];
    let par = 0, at = { x: 12, y: 12 };
    for (const f of [...foods, hole]) { par += bfsDist(wall, at, f); at = f; }
    par = Math.ceil(par * 1.12) + 4;
    return { n: 0, puzzle: true, need: PUZZLE_FRUITS, target: 0, speed: 1, moving: false, boss: false, rival: false, shrink: false,
      walls, gates: [], foods, holeAt: { x: hole.x, y: hole.y }, par, par2: Math.ceil(par * 1.5) };
  }

  // ---- уровни игроков (редактор): стены — номера клеток y*N+x, t — цель по очкам ----
  const CUSTOM_MAX_WALLS = 220;
  function normCustom(c) {
    const src = Array.isArray(c && c.w) ? c.w : [];
    const seen = new Set(), w = [];
    for (const v of src) {
      const k = Math.floor(Number(v)); if (!(k >= 0 && k < N * N) || seen.has(k)) continue;
      if (inStartZone(k % N, (k / N) | 0)) continue;
      seen.add(k); w.push(k); if (w.length >= CUSTOM_MAX_WALLS) break;
    }
    w.sort((a, b) => a - b);
    return { w, t: Math.max(5, Math.min(80, Math.floor(Number(c && c.t)) || 20)) };
  }
  function customLevel(c) {
    const walls = c.w.map((k) => ({ x: k % N, y: (k / N) | 0 }));
    const par = c.t * 8 + 70;
    return { n: 0, custom: true, target: c.t, speed: 1, moving: false, boss: false, rival: false, shrink: false, walls, gates: [], par, par2: Math.round(par * 1.6) };
  }
  // Можно ли играть на такой раскладке: достаточно свободного места для еды
  function customCheck(c) {
    const n = normCustom(c), reach = reachMap(wallMap(n.w.map((k) => ({ x: k % N, y: (k / N) | 0 }))));
    let free = 0; for (let i = 0; i < N * N; i++) if (reach[i]) free++;
    return { ok: free >= 120, free, walls: n.w.length, norm: n };
  }

  const V4_MODES = ["dungeon", "puzzle", "custom"];
  const normCfg = (cfg) => ({
    seed: (Number(cfg && cfg.seed) >>> 0) || 1,
    // режимы v4 существуют только с правилами v4
    mode: MODES[cfg && cfg.mode] && !(V4_MODES.includes(cfg.mode) && ((cfg.rules | 0) || 1) < 4) ? cfg.mode : "classic",
    diff: DIFFS[cfg && cfg.diff] ? cfg.diff : "normal",
    artifact: ["magnet", "berserk", "phantom"].includes(cfg && cfg.artifact) ? cfg.artifact : "",
    artLevel: Math.max(1, Math.min(MAX_ART_LEVEL, (cfg && cfg.artLevel) | 0 || 1)),
    rules: Math.max(1, Math.min(RULES, (cfg && cfg.rules) | 0 || 1)),
    level: cfg && cfg.mode === "level" ? Math.max(1, Math.min(LEVELS.length, (cfg.level | 0) || 1)) : 0,
    ...(cfg && cfg.mode === "custom" ? { custom: normCustom(cfg.custom) } : {})
  });

  class Game {
    constructor(cfgIn, opts) {
      const cfg = this.cfg = normCfg(cfgIn);
      this.record = !(opts && opts.record === false);
      this.log = [];
      this.rng = mulberry32(cfg.seed);
      this.art = artifactStats(cfg.artifact, cfg.artLevel);
      this.snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }, { x: 9, y: 12 }];
      this.occ = new Uint8Array(N * N);
      for (const s of this.snake) this.occ[s.y * N + s.x]++;
      this.dir = { x: 1, y: 0 }; this.queue = [];
      this.pendingGrowth = 0; this.runCoins = 0; this.score = 0; this.apples = 0;
      this.combo = 0; this.comboTimer = 0; this.bestRun = 0;
      this.gameTime = 0; this.ticks = 0; this.speedMs = SPEED_START;
      this.fx = { slow: 0, x2: 0, ghost: 0, magnet: 0, portal: 0, freeze: 0 };
      this.portals = null;                  // бонус «Портал»: две связанные клетки
      // боссы (правила v3): змей-вор и сужающееся поле
      this.rival = null; this.rivalOcc = new Uint8Array(N * N); this.shrinkWarn = []; this.shrinkStep = 0;
      this.shield = false;
      this.charges = cfg.artifact === "phantom" ? this.art.phantomCharges : 0; // «Фантом»: спасения за забег
      this.pu = null; this.nextPuAt = 10000;
      this.safeUntil = SAFE_MS;             // короткая неуязвимость на старте и после паузы
      this.over = false; this.reason = ""; this.win = false;
      this.rocks = []; this.pending = [];   // pending — камни «живых стен», которые вот-вот станут твёрдыми
      this.rockSet = new Uint8Array(N * N);
      // режим уровней: постоянные стены, ворота, норка, клетки, куда нельзя доползти
      this.lv = cfg.mode === "level" ? LEVELS[cfg.level - 1] : cfg.mode === "dungeon" ? dungeonFloor(cfg.seed, 1)
        : cfg.mode === "puzzle" ? makePuzzle(cfg.seed) : cfg.mode === "custom" ? customLevel(cfg.custom) : null;
      // «Подземелье»: этаж, фрукты на этаже, взятые улучшения, ожидание выбора
      this.floor = 1; this.floorApples = 0; this.choosing = null; this.leanTick = 0;
      this.up = { magnet: 0, slow: 1, greed: 0, points: 0, rhythm: 0, luck: 0, lean: false, taken: [] };
      this.baseRocks = []; this.gates = []; this.gateSet = new Uint8Array(N * N); this.blocked = new Uint8Array(N * N); this.hole = null;
      this.food = null;
      // статистика забега: для заданий и для античита (на правила не влияет)
      this.stats = { gold: 0, coin: 0, pu: 0, saves: 0, pathTicks: 0, pathDist: 0 };
      this._foodAt = null;
      this._initObstacles();
      if (this.lv && cfg.rules >= 3 && this.lv.rival) this._initRival();
      if (this.lv && this.lv.puzzle) this.nextPuAt = Infinity; // в головоломке бонусов нет
      this.placeFood();
    }

    // ---- препятствия ----
    _setRocks(list) {
      this.rocks = this.baseRocks.length ? [...this.baseRocks, ...list] : list; this.rockSet.fill(0);
      for (const r of this.rocks) this.rockSet[r.y * N + r.x] = 1;
    }
    // Уровень: стены, ворота и карта достижимости (поиск в ширину от головы; ворота считаем открытыми)
    _initLevel() {
      const L = this.lv;
      this.baseRocks = L.walls.map((c) => ({ ...c }));
      this.gates = L.gates.flatMap((g) => g.cells.map((c) => ({ x: c.x, y: c.y, period: g.period, phase: g.phase, closed: false, warn: false })));
      for (const g of this.gates) this.gateSet[g.y * N + g.x] = 1;
      this._setRocks([]);
      const seen = new Uint8Array(N * N), st = [this.snake[0]]; seen[st[0].y * N + st[0].x] = 1;
      while (st.length) {
        const c = st.pop();
        for (const [dx, dy] of DIRS) {
          const x = c.x + dx, y = c.y + dy, k = y * N + x;
          if (x < 0 || y < 0 || x >= N || y >= N || seen[k] || this.rockSet[k]) continue;
          seen[k] = 1; st.push({ x, y });
        }
      }
      for (let i = 0; i < N * N; i++) this.blocked[i] = seen[i] ? 0 : 1;
      // новые режимы (v4: подземелье, головоломка, уровни игроков) — без еды в тупиках; старые уровни не трогаем
      if (!L.n) { const ok = peel(this.rockSet, seen); for (let i = 0; i < N * N; i++) if (!ok[i]) this.blocked[i] = 1; }
    }
    // Ворота: закрыты половину периода; за 6 ходов до закрытия — предупреждение. Закрываются, только когда клетка свободна.
    _updateGates(ev) {
      let changed = false;
      for (const g of this.gates) {
        const ph = (this.ticks + g.phase) % (g.period * 2), want = ph >= g.period;
        g.warn = !want && ph >= g.period - 6;
        const k = g.y * N + g.x;
        if (want && !g.closed && !this.occ[k] && !(this.food && this.food.x === g.x && this.food.y === g.y) && !(this.pu && this.pu.x === g.x && this.pu.y === g.y)) { g.closed = true; changed = true; }
        else if (!want && g.closed) { g.closed = false; changed = true; }
      }
      if (changed) ev.push({ t: "gates" });
    }
    gateClosed(x, y) { if (!this.gateSet[y * N + x]) return false; const g = this.gates.find((q) => q.x === x && q.y === y); return !!(g && g.closed); }
    // Норка: появляется, когда набрана цель, подальше от головы
    _spawnHole(ev) {
      const free = this.freeCells(), h = this.snake[0];
      if (!free.length) return;
      if (this.lv.puzzle) { const c = this._nearestFree(this.lv.holeAt, free); this.hole = { x: c.x, y: c.y }; ev.push({ t: "hole", x: c.x, y: c.y }); return; }
      const far = free.filter((c) => Math.abs(c.x - h.x) + Math.abs(c.y - h.y) >= 6);
      const pool = far.length ? far : free;
      const c = pool[Math.floor(this.rng() * pool.length)];
      this.hole = { x: c.x, y: c.y };
      ev.push({ t: "hole", x: c.x, y: c.y });
    }
    _initObstacles() {
      const m = this.cfg.mode;
      if (this.lv) this._initLevel();
      else if (m === "maze") this._setRocks(MAZE.map(([x, y]) => ({ x, y })));
      else if (m === "rocks") {
        const r = mulberry32(this.cfg.seed ^ 0xA5A5A5A5), list = [], seen = new Set();
        while (list.length < 14) {
          const x = Math.floor(r() * N), y = Math.floor(r() * N), k = y * N + x;
          if (seen.has(k) || (y >= 11 && y <= 13 && x >= 7)) continue; // стартовый коридор свободен
          seen.add(k); list.push({ x, y });
        }
        this._setRocks(list);
      }
    }
    // камни «живых стен»: каждые 45 ходов новая раскладка — сначала предупреждение, через 12 ходов твёрдые
    _updateMoving(ev) {
      const t = this.ticks, EPOCH = 45, WARN = 12;
      if (this.pending.length && t >= this.pending[0].solidAt) {
        const head = this.snake[0], list = [];
        for (const c of this.pending) {
          const k = c.y * N + c.x;
          if (this.occ[k] || (this.food && this.food.x === c.x && this.food.y === c.y) || (this.pu && this.pu.x === c.x && this.pu.y === c.y)) continue;
          if (Math.abs(c.x - head.x) + Math.abs(c.y - head.y) < 3) continue;
          list.push({ x: c.x, y: c.y });
        }
        this.pending = []; this._setRocks(list); ev.push({ t: "rocks" });
      }
      if (t > 0 && t % EPOCH === 0) {
        const r = mulberry32((this.cfg.seed ^ 0x51ED270B) + t * 7919), head = this.snake[0], list = [], seen = new Set();
        for (let tries = 0; tries < 200 && list.length < 8; tries++) {
          const x = Math.floor(r() * N), y = Math.floor(r() * N), k = y * N + x;
          if (seen.has(k) || this.occ[k]) continue;
          if (this.lv && (this.rockSet[k] || this.gateSet[k] || this.blocked[k] || (this.hole && this.hole.x === x && this.hole.y === y))) continue;
          if (Math.abs(x - head.x) + Math.abs(y - head.y) < 5) continue;
          if (this.food && this.food.x === x && this.food.y === y) continue;
          seen.add(k); list.push({ x, y, solidAt: t + WARN });
        }
        this._setRocks([]); this.pending = list; ev.push({ t: "rocks" });
      }
    }

    // ---- скорость ----
    stepMs() { return this.speedMs * (this.fx.slow > this.gameTime ? 1.6 : 1) * DIFFS[this.cfg.diff].speed * (this.lv ? this.lv.speed : 1) * this.up.slow; }
    updateSpeed() {
      const len = this.snake.length + this.pendingGrowth;
      this.speedMs = Math.round(SPEED_MIN + (SPEED_START - SPEED_MIN) * Math.exp(-Math.max(0, len - START_LEN) / 40));
    }
    isSafe() { return this.gameTime < this.safeUntil; }
    ghostOn() { return this.fx.ghost > this.gameTime; }

    // ---- ввод ----
    // Возвращает true, если поворот принят (и записан в лог). Правила очереди такие же, как у реальной игры.
    setdir(x, y) {
      if (this.over) return false;
      const base = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if ((x === -base.x && y === -base.y) || (x === base.x && y === base.y)) return false;
      if (this.queue.length >= 2) return false;
      const code = DIRS.findIndex((d) => d[0] === x && d[1] === y);
      if (code < 0) return false;
      this.queue.push({ x, y });
      if (this.record) this.log.push(this.ticks * 8 + code);
      return true;
    }
    resume() { // после паузы — снова короткая неуязвимость
      this.safeUntil = this.gameTime + SAFE_MS;
      if (this.record) this.log.push(this.ticks * 8 + OP_RESUME);
    }

    // ---- еда и бонусы ----
    freeCells() {
      const busy = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) if (this.occ[i] || this.rockSet[i]) busy[i] = 1;
      if (this.food) busy[this.food.y * N + this.food.x] = 1;
      if (this.pu) busy[this.pu.y * N + this.pu.x] = 1;
      for (const c of this.pending) busy[c.y * N + c.x] = 1;
      if (this.lv) {
        for (let i = 0; i < N * N; i++) if (this.gateSet[i] || this.blocked[i] || this.rivalOcc[i]) busy[i] = 1;
        if (this.hole) busy[this.hole.y * N + this.hole.x] = 1;
        for (const c of this.shrinkWarn) busy[c.y * N + c.x] = 1;
      }
      if (this.portals) for (const c of this.portals) busy[c.y * N + c.x] = 1;
      const free = [];
      for (let i = 0; i < N * N; i++) if (!busy[i]) free.push({ x: i % N, y: (i / N) | 0 });
      return free;
    }
    // ближайшая свободная клетка к нужной (поиск в ширину) — для фиксированных мест головоломки
    _nearestFree(t, free) {
      const ok = new Uint8Array(N * N); for (const c of free) ok[c.y * N + c.x] = 1;
      if (ok[t.y * N + t.x]) return t;
      const seen = new Uint8Array(N * N), q = [t.y * N + t.x]; seen[q[0]] = 1;
      for (let i = 0; i < q.length; i++) {
        const k = q[i], x = k % N, y = (k / N) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, nk = ny * N + nx;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[nk]) continue;
          if (ok[nk]) return { x: nx, y: ny };
          seen[nk] = 1; q.push(nk);
        }
      }
      return free[0];
    }
    placeFood() {
      const free = this.freeCells();
      if (!free.length) return false;
      if (this.lv && this.lv.puzzle) {
        if (this.floorApples >= this.lv.foods.length) { this.food = null; return true; }
        const c = this._nearestFree(this.lv.foods[this.floorApples], free);
        this.food = { x: c.x, y: c.y, type: "apple" };
        const h = this.snake[0]; this._foodAt = { t: this.ticks, x: h.x, y: h.y };
        return true;
      }
      const c = free[Math.floor(this.rng() * free.length)];
      this.food = { x: c.x, y: c.y, type: this.rng() < 0.82 - 0.08 * Math.min(4, this.up.greed) ? "apple" : (this.rng() < 0.5 ? "coin" : "gold") };
      const h = this.snake[0];
      this._foodAt = { t: this.ticks, x: h.x, y: h.y };
      return true;
    }
    spawnPu() {
      const free = this.freeCells(); if (!free.length) return;
      const c = free[Math.floor(this.rng() * free.length)], types = this.cfg.rules >= 3 ? Object.keys(PU) : PU_V2;
      let type;
      do { type = types[Math.floor(this.rng() * types.length)]; } while (type === "bomb" && this.snake.length < 8);
      this.pu = { x: c.x, y: c.y, type, expires: this.gameTime + PU_LIFE };
      this.nextPuAt = this.gameTime + (16000 + this.rng() * 8000) / (1 + this.up.luck * 0.5);
    }
    activatePu(type, ev) {
      if (type === "shield") this.shield = true;
      else if (type === "bomb") {
        const keep = Math.max(START_LEN, Math.ceil(this.snake.length / 2)), cells = [];
        while (this.snake.length > keep) { const q = this.snake.pop(); this.occ[q.y * N + q.x]--; cells.push(q); }
        this.updateSpeed();
        ev.push({ t: "bomb", cells });
      } else {
        this.fx[type] = Math.max(this.fx[type], this.gameTime) + PU[type].dur;
        if (type === "portal" && !this.portals) this._placePortals(ev);
      }
      this.stats.pu++;
      ev.push({ t: "pu", type });
    }

    // Магнит (правила v2): еда в радиусе R перед головой подтягивается на одну клетку за ход —
    // сначала на линию движения, потом к голове — и оказывается прямо «во рту». Еда сзади не притягивается.
    _magnet(hx, hy, R, ev) {
      const f = this.food, d = this.dir, wrap = this.cfg.mode === "nowalls" || this.ghostOn();
      let rx = f.x - hx, ry = f.y - hy;
      if (wrap) { if (Math.abs(rx) > N / 2) rx -= Math.sign(rx) * N; if (Math.abs(ry) > N / 2) ry -= Math.sign(ry) * N; }
      const along = rx * d.x + ry * d.y, side = d.x ? ry : rx;
      if (along < 1 || Math.abs(rx) + Math.abs(ry) > R) return;   // сзади, сбоку на уровне головы или далеко
      if (along === 1 && side === 0) return;                       // уже прямо перед головой
      let nx = f.x, ny = f.y;
      if (side !== 0) { if (d.x) ny -= Math.sign(side); else nx -= Math.sign(side); } // на линию движения
      else { nx -= d.x; ny -= d.y; }                                                    // ближе к голове
      if (wrap) { nx = (nx + N) % N; ny = (ny + N) % N; }
      if (!this._free(nx, ny)) return;
      ev.push({ t: "pull", fx: f.x, fy: f.y, x: nx, y: ny });
      f.x = nx; f.y = ny;
    }

    // ---- Портал: две клетки подальше друг от друга; заполз в одну — вылез из другой ----
    _placePortals(ev) {
      const free = this.freeCells(), h = this.snake[0];
      const far = free.filter((c) => Math.abs(c.x - h.x) + Math.abs(c.y - h.y) >= 3 && c.x > 0 && c.y > 0 && c.x < N - 1 && c.y < N - 1);
      if (far.length < 2) return;
      const a = far[Math.floor(this.rng() * far.length)];
      const pool = far.filter((c) => Math.abs(c.x - a.x) + Math.abs(c.y - a.y) >= 10);
      const b = (pool.length ? pool : far.filter((c) => c !== a))[Math.floor(this.rng() * (pool.length || far.length - 1))];
      if (!b) return;
      this.portals = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      ev.push({ t: "portals", a: this.portals[0], b: this.portals[1] });
    }

    // ---- Босс «Змей-вор»: ползёт к еде (каждый второй ход) и крадёт её. Укус оглушает его ----
    _initRival() {
      const r = mulberry32(this.cfg.seed ^ 0xB05511), cand = [];
      for (let i = 0; i < N * N; i++) {
        const x = i % N, y = (i / N) | 0;
        if (this.rockSet[i] || this.gateSet[i] || this.blocked[i] || this.occ[i]) continue;
        if (Math.abs(x - 12) + Math.abs(y - 12) < 10) continue;
        cand.push({ x, y });
      }
      if (!cand.length) return;
      const c = cand[Math.floor(r() * cand.length)];
      this.rival = { body: [], dir: { x: 0, y: 0 }, len: 5, stolen: 0, stun: 0, bites: 0 };
      for (let i = 0; i < 5; i++) { this.rival.body.push({ x: c.x, y: c.y }); this.rivalOcc[c.y * N + c.x]++; }
    }
    _rivalOpen(x, y) {
      if (x < 0 || y < 0 || x >= N || y >= N) return false;
      const k = y * N + x;
      return !this.rockSet[k] && !this.occ[k] && !this.rivalOcc[k] && !this.gateClosed(x, y) && !(this.hole && this.hole.x === x && this.hole.y === y)
        && !this.shrinkWarn.some((c) => c.x === x && c.y === y) && !(this.portals && this.portals.some((c) => c.x === x && c.y === y));
    }
    _moveRival(ev) {
      const R = this.rival; if (!R || !this.food) return;
      const h = R.body[0], f = this.food;
      // поиск в ширину к еде; хвост вора на этом ходу уйдёт — его клетку считаем свободной
      const tail = R.body[R.body.length - 1];
      this.rivalOcc[tail.y * N + tail.x]--;
      const prev = new Int16Array(N * N).fill(-1), q = [];
      for (let d = 0; d < 4; d++) {
        const x = h.x + DIRS[d][0], y = h.y + DIRS[d][1];
        if (!this._rivalOpen(x, y) && !(x === f.x && y === f.y)) continue;
        const k = y * N + x; if (prev[k] !== -1) continue; prev[k] = d; q.push(k);
      }
      let dir = -1;
      for (let i = 0; i < q.length && dir < 0; i++) {
        const k = q[i], x = k % N, y = (k / N) | 0;
        if (x === f.x && y === f.y) { dir = prev[k]; break; }
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (!this._rivalOpen(nx, ny) && !(nx === f.x && ny === f.y)) continue;
          const nk = ny * N + nx; if (prev[nk] !== -1) continue; prev[nk] = prev[k]; q.push(nk);
        }
      }
      if (dir < 0) for (let d = 0; d < 4; d++) if (this._rivalOpen(h.x + DIRS[d][0], h.y + DIRS[d][1])) { dir = d; break; }
      this.rivalOcc[tail.y * N + tail.x]++;
      if (dir < 0) return; // заперт — стоит на месте
      const nx = h.x + DIRS[dir][0], ny = h.y + DIRS[dir][1];
      R.dir = { x: DIRS[dir][0], y: DIRS[dir][1] };
      R.body.unshift({ x: nx, y: ny }); this.rivalOcc[ny * N + nx]++;
      if (nx === f.x && ny === f.y) {
        R.stolen++; if (R.len < 10) R.len++;
        ev.push({ t: "steal", x: nx, y: ny, type: f.type });
        this.food = null; this.placeFood();
      }
      while (R.body.length > R.len) { const q2 = R.body.pop(); this.rivalOcc[q2.y * N + q2.x]--; }
    }

    // ---- Босс «Сужение»: с краёв поля нарастают стены (сначала предупреждение за 12 ходов) ----
    _updateShrink(ev) {
      const STEPS = [150, 300], WARN = 12, t = this.ticks;
      const k = this.shrinkStep; if (k >= STEPS.length) return;
      if (!this.shrinkWarn.length && t === STEPS[k] - WARN) {
        const h = this.snake[0];
        for (let i = 0; i < N * N; i++) {
          const x = i % N, y = (i / N) | 0;
          if (Math.min(x, y, N - 1 - x, N - 1 - y) !== k) continue;
          if (this.rockSet[i] || this.gateSet[i] || this.blocked[i]) continue;
          if (Math.abs(x - h.x) + Math.abs(y - h.y) < 4) continue;
          if ((this.food && this.food.x === x && this.food.y === y) || (this.hole && this.hole.x === x && this.hole.y === y)) continue;
          this.shrinkWarn.push({ x, y });
        }
        ev.push({ t: "shrinkwarn" });
      } else if (t === STEPS[k]) {
        const add = this.shrinkWarn.filter((c) => { const i = c.y * N + c.x; return !this.occ[i] && !this.rivalOcc[i] && !(this.food && this.food.x === c.x && this.food.y === c.y) && !(this.pu && this.pu.x === c.x && this.pu.y === c.y) && !(this.portals && this.portals.some((p) => p.x === c.x && p.y === c.y)); });
        this.shrinkWarn = []; this.shrinkStep++;
        this.baseRocks.push(...add);
        this._setRocks(this.rocks.filter((r) => !this.baseRocks.includes(r) && !add.includes(r)).filter((r) => !this.baseRocks.some((b) => b.x === r.x && b.y === r.y)));
        for (const c of add) this.blocked[c.y * N + c.x] = 1;
        ev.push({ t: "shrink", n: add.length });
      }
    }

    _bodyHit(x, y) {
      let c = this.occ[y * N + x];
      const tail = this.snake[this.snake.length - 1];
      if (this.pendingGrowth <= 0 && tail.x === x && tail.y === y) c--; // хвост на этом ходу уйдёт
      return c > 0;
    }
    _free(x, y) {
      return x >= 0 && x < N && y >= 0 && y < N && !this.occ[y * N + x] && !this.rockSet[y * N + x] && !(this.pu && this.pu.x === x && this.pu.y === y)
        && !(this.lv && (this.gateSet[y * N + x] || this.rivalOcc[y * N + x] || (this.hole && this.hole.x === x && this.hole.y === y)))
        && !(this.portals && this.portals.some((c) => c.x === x && c.y === y));
    }

    // ---- «Подземелье»: выбор улучшения после этажа ----
    _rollUpgrades() {
      const pool = Object.keys(UPGRADES).filter((k) => !(UPGRADES[k].once && this.up.taken.includes(k))), out = [];
      while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
      return out;
    }
    _floorDone(ev) {
      const bonus = 5 * this.floor;
      this.score += bonus;
      this.choosing = { floor: this.floor, options: this._rollUpgrades() };
      ev.push({ t: "floor", floor: this.floor, bonus, options: this.choosing.options });
    }
    // i — номер варианта 0..2. Возвращает true, если выбор принят (и записан в лог)
    choose(i) {
      if (!this.choosing || this.over) return false;
      const id = this.choosing.options[i]; if (!id) return false;
      if (this.record) this.log.push(this.ticks * 8 + OP_CHOOSE + i);
      const u = this.up; u.taken.push(id);
      if (id === "armor") this.charges++;
      else if (id === "magnet") u.magnet = u.magnet ? u.magnet + 1 : 3;
      else if (id === "slow") u.slow = Math.round(u.slow * 1.1 * 1000) / 1000;
      else if (id === "greed") u.greed++;
      else if (id === "points") u.points = Math.round((u.points + 0.3) * 10) / 10;
      else if (id === "rhythm") u.rhythm += 15;
      else if (id === "luck") u.luck++;
      else if (id === "lean") u.lean = true;
      this.choosing = null; this.floor++;
      this._nextFloor();
      return true;
    }
    _nextFloor() {
      this.occ.fill(0); this.rockSet.fill(0); this.gateSet.fill(0); this.blocked.fill(0);
      this.snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }, { x: 9, y: 12 }];
      for (const s of this.snake) this.occ[s.y * N + s.x]++;
      this.dir = { x: 1, y: 0 }; this.queue = []; this.pendingGrowth = 0;
      this.hole = null; this.food = null; this.pu = null; this.pending = []; this.portals = null; this.baseRocks = []; this.gates = [];
      for (const k of Object.keys(this.fx)) this.fx[k] = 0;
      this.combo = 0; this.comboTimer = 0; this.floorApples = 0;
      this.lv = dungeonFloor(this.cfg.seed, this.floor);
      this._initLevel();
      this.updateSpeed();
      this.safeUntil = this.gameTime + SAFE_MS; this.nextPuAt = this.gameTime + 8000;
      this.placeFood();
    }

    // ---- один ход ----
    tick() {
      const ev = [];
      if (this.over || this.choosing) return ev;
      const interval = this.stepMs(), cfg = this.cfg;
      if (this.queue.length) this.dir = this.queue.shift();
      const ghost = this.ghostOn();
      let hx = this.snake[0].x + this.dir.x, hy = this.snake[0].y + this.dir.y;
      if (cfg.mode === "nowalls" || ghost) { hx = (hx + N) % N; hy = (hy + N) % N; }
      // портал: голова выходит из второй клетки
      if (this.portals && hx >= 0 && hy >= 0 && hx < N && hy < N) {
        const pi = this.portals.findIndex((c) => c.x === hx && c.y === hy);
        if (pi >= 0) { const o = this.portals[1 - pi]; ev.push({ t: "teleport", fx: hx, fy: hy, x: o.x, y: o.y }); hx = o.x; hy = o.y; }
      }
      const oob = hx < 0 || hx >= N || hy < 0 || hy >= N;
      const rockHit = !oob && this.rockSet[hy * N + hx] === 1;
      const hit = oob || (!ghost && (this._bodyHit(hx, hy) || rockHit || (this.lv && this.gateClosed(hx, hy))));
      if (hit) {
        let saved = "";
        if (this.isSafe()) saved = "safe";
        else if (this.charges > 0) { this.charges--; saved = "phantom"; }
        else if (this.shield) { this.shield = false; saved = "shield"; }
        if (!saved) { this.over = true; this.reason = oob ? "wall" : "body"; ev.push({ t: "over", reason: this.reason }); return ev; }
        hx = (hx + N) % N; hy = (hy + N) % N;
        if (saved !== "safe") this.stats.saves++;
        ev.push({ t: "save", kind: saved, x: hx, y: hy });
        // v3: щит разбивает камень (кроме стен уровня и лабиринта)
        if (saved === "shield" && rockHit && cfg.rules >= 3 && cfg.mode !== "maze" && !this.baseRocks.some((r) => r.x === hx && r.y === hy)) {
          this.rocks = this.rocks.filter((r) => r.x !== hx || r.y !== hy); this.rockSet[hy * N + hx] = 0;
          ev.push({ t: "smash", x: hx, y: hy });
        }
      }
      this.gameTime += interval; this.ticks++;
      for (const k of TIMED) if (this.fx[k] && this.fx[k] <= this.gameTime) { this.fx[k] = 0; if (k === "portal") this.portals = null; ev.push({ t: "fxend", k }); }
      this.snake.unshift({ x: hx, y: hy }); this.occ[hy * N + hx]++;
      // укусил вора — он оглушён и стоит на месте 16 ходов (сам вор безвреден, опасна только потеря еды)
      if (this.rival && this.rivalOcc[hy * N + hx] > 0 && !(this.rival.stun > this.ticks)) { this.rival.stun = this.ticks + 16; this.rival.bites = (this.rival.bites || 0) + 1; ev.push({ t: "bite", x: hx, y: hy }); }
      // норка: заполз — уровень пройден
      if (this.hole && hx === this.hole.x && hy === this.hole.y) {
        const q = this.snake.pop(); this.occ[q.y * N + q.x]--;
        if (cfg.mode === "dungeon") { this._floorDone(ev); return ev; }
        this.over = true; this.win = true; this.reason = "hole";
        ev.push({ t: "over", reason: "hole", win: true }); return ev;
      }
      const mult = this.fx.x2 > this.gameTime ? 2 : 1;

      const f = this.food, ate = !!f && hx === f.x && hy === f.y;
      if (ate) {
        this.combo++; this.comboTimer = COMBO_WINDOW + this.up.rhythm; this.bestRun = Math.max(this.bestRun, this.combo);
        const cm = Math.min(this.combo, COMBO_MAX);
        const berserk = cfg.artifact === "berserk" && cm >= 3 ? this.art.berserkBonus : 1;
        const pts = Math.floor((f.type === "gold" ? 5 : 1) * cm * mult * berserk * (1 + this.up.points));
        this.score += pts;
        let coins = 0;
        if (f.type === "coin") coins = 10 * mult; else if (f.type === "gold") coins = 50 * mult;
        this.runCoins += coins;
        if (this.up.lean && (this.leanTick++ % 2)) { /* «Стройность»: каждый второй фрукт без роста */ }
        else this.pendingGrowth += GROWTH[f.type] || 1;
        this.apples++; this.floorApples++;
        if (f.type === "gold") this.stats.gold++; else if (f.type === "coin") this.stats.coin++;
        // насколько путь к еде близок к кратчайшему (люди петляют, боты — нет)
        if (this._foodAt) {
          let dx = Math.abs(f.x - this._foodAt.x), dy = Math.abs(f.y - this._foodAt.y);
          if (cfg.mode === "nowalls") { dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); }
          if (dx + dy >= 4) { this.stats.pathDist += dx + dy; this.stats.pathTicks += this.ticks - this._foodAt.t; }
        }
        ev.push({ t: "ate", x: f.x, y: f.y, type: f.type, pts, cm, coins, mult, combo: this.combo });
        this.updateSpeed();
        if (this.lv && !this.hole && (this.lv.need ? this.floorApples >= this.lv.need : this.score >= this.lv.target)) this._spawnHole(ev);
        if (!this.placeFood()) { this.over = true; this.win = true; this.reason = "win"; ev.push({ t: "over", reason: "win", win: true }); return ev; }
      }

      // Магнит
      if (!ate && cfg.rules >= 2 && this.food) {
        const R = Math.max(this.fx.magnet > this.gameTime ? BONUS_MAGNET_RANGE : cfg.artifact === "magnet" ? this.art.magnetRange : 0, this.up.magnet);
        if (R) this._magnet(hx, hy, R, ev);
      }
      // магнит старых правил (версия 1) — только для переигровки старых забегов
      if (!ate && cfg.rules < 2 && this.food) {
        const fd = this.food;
        let dx = fd.x - hx, dy = fd.y - hy, moved = false;
        if (cfg.artifact === "magnet" && ((dx === 0 && Math.abs(dy) >= 2 && Math.abs(dy) <= this.art.magnetRange) || (dy === 0 && Math.abs(dx) >= 2 && Math.abs(dx) <= this.art.magnetRange))) {
          const nx = fd.x - Math.sign(dx), ny = fd.y - Math.sign(dy);
          if (this._free(nx, ny)) { fd.x = nx; fd.y = ny; moved = true; }
        }
        if (!moved && this.fx.magnet > this.gameTime && Math.abs(dx) + Math.abs(dy) <= 5 && Math.abs(dx) + Math.abs(dy) >= 2) {
          dx = fd.x - hx; dy = fd.y - hy;
          const horiz = Math.abs(dx) >= Math.abs(dy);
          const nx = horiz ? fd.x - Math.sign(dx) : fd.x, ny = horiz ? fd.y : fd.y - Math.sign(dy);
          if (this._free(nx, ny)) { fd.x = nx; fd.y = ny; }
        }
      }
      // подобрать бонус / он сгорает по таймеру
      if (this.pu && hx === this.pu.x && hy === this.pu.y) { const t = this.pu.type; this.pu = null; this.activatePu(t, ev); }
      else if (this.pu && this.gameTime > this.pu.expires) this.pu = null;

      // рост: хвост не убираем, пока есть накопленный рост
      if (this.pendingGrowth > 0) this.pendingGrowth--;
      else { const q = this.snake.pop(); this.occ[q.y * N + q.x]--; }

      if (!this.pu && this.apples >= 2 && this.gameTime >= this.nextPuAt) { this.spawnPu(); ev.push({ t: "pu_spawn" }); }
      if (cfg.mode === "moving" || (this.lv && this.lv.moving)) this._updateMoving(ev);
      if (this.lv && this.gates.length) this._updateGates(ev);
      if (this.lv && cfg.rules >= 3) {
        if (this.rival && this.ticks % 2 === 0 && !(this.rival.stun > this.ticks)) this._moveRival(ev);
        if (this.lv.shrink) this._updateShrink(ev);
      }

      if (this.fx.freeze > this.gameTime) { /* заморозка: комбо не сгорает */ }
      else if (this.comboTimer > 0) this.comboTimer--;
      else if (this.combo > 0) this.combo = 0;
      return ev;
    }

    result() {
      const done = this.reason === "hole";
      return { score: this.score, apples: this.apples, runCoins: this.runCoins, bestRun: this.bestRun, ticks: this.ticks, gameTime: this.gameTime, over: this.over, reason: this.reason, win: this.win, stats: { ...this.stats },
        level: this.lv ? this.lv.n : 0, completed: done, stars: done ? (this.lv.n ? levelStars(this.lv.n, this.ticks) : starsFor(this.lv, this.ticks)) : 0,
        floor: this.cfg.mode === "dungeon" ? this.floor : 0, upgrades: this.up.taken.slice() };
    }
  }

  // Награда: (очки×2 + собранные монеты + 100 за рекорд) × множитель режима × множитель сложности
  function reward(res, cfgIn, isRecord) {
    const cfg = normCfg(cfgIn);
    const base = res.score * 2 + res.runCoins + (isRecord ? 100 : 0);
    return Math.max(0, Math.floor(base * MODES[cfg.mode].mult * DIFFS[cfg.diff].mult));
  }
  // Идёт ли забег в общий рейтинг/сезон: только «Классика» не на лёгкой сложности
  const isRated = (cfgIn) => { const c = normCfg(cfgIn); return MODES[c.mode].rated && c.diff !== "easy"; };

  // ---- лог ----
  // Лог — массив чисел tick*8+код (0..3 поворот, 4 — продолжение после паузы). В сети — строка "12,40,41".
  function parseLog(src, maxLen) {
    maxLen = maxLen || 20000;
    const arr = Array.isArray(src) ? src : String(src || "").split(",").filter((s) => s !== "").map(Number);
    if (arr.length > maxLen) return null;
    let prev = 0;
    for (const e of arr) {
      if (!Number.isInteger(e) || e < 0 || e > 8 * 10000000) return null;
      const t = e >> 3;
      if (t < prev) return null;
      prev = t;
    }
    return arr;
  }
  const encodeLog = (log) => log.join(",");

  // Прогоняет забег по логу. ticks — сколько ходов сыграно; прерывается при смерти.
  // Возвращает результат и число принятых поворотов (нужно для проверки по времени).
  function simulate(cfg, log, ticks) {
    const g = new Game(cfg, { record: false });
    let ptr = 0, turns = 0;
    ticks = Math.max(0, Math.floor(ticks) || 0);
    while (!g.over && g.ticks < ticks) {
      while (ptr < log.length && (log[ptr] >> 3) <= g.ticks) {
        const c = log[ptr++] & 7;
        if (c === OP_RESUME) g.resume();
        else if (c >= OP_CHOOSE) g.choose(c - OP_CHOOSE);
        else if (g.setdir(DIRS[c][0], DIRS[c][1])) turns++;
      }
      if (g.choosing) break; // ждали выбора улучшения, а его нет — забег закончился здесь
      g.tick();
    }
    return { ...g.result(), turns };
  }

  // Проигрыватель реплея: next() применяет ввод и делает один ход, возвращает события
  function player(cfg, log, ticks) {
    const g = new Game(cfg, { record: false });
    let ptr = 0;
    ticks = Math.max(0, Math.floor(ticks) || 0);
    return {
      game: g,
      done: () => g.over || g.ticks >= ticks || (!!g.choosing && !(ptr < log.length && (log[ptr] >> 3) <= g.ticks)),
      next() {
        const ev = [];
        while (ptr < log.length && (log[ptr] >> 3) <= g.ticks) {
          const c = log[ptr++] & 7;
          if (c === OP_RESUME) g.resume();
          else if (c >= OP_CHOOSE) { const opt = g.choosing && g.choosing.options[c - OP_CHOOSE]; if (g.choose(c - OP_CHOOSE)) ev.push({ t: "chosen", id: opt, floor: g.floor }); }
          else g.setdir(DIRS[c][0], DIRS[c][1]);
        }
        return ev.concat(g.tick());
      }
    };
  }

  return { N, START_LEN, SAFE_MS, DIRS, RULES, PU_V2, UPGRADES, OP_CHOOSE, PUZZLE_FRUITS, CUSTOM_MAX_WALLS, dungeonFloor, makePuzzle, normCustom, customCheck, starsFor, inStartZone, BONUS_MAGNET_RANGE, LEVELS, levelStars, MODES, DIFFS, PU, TIMED, MAX_ART_LEVEL, PU_LIFE, COMBO_WINDOW, COMBO_MAX,
    artifactStats, mulberry32, normCfg, Game, reward, isRated, parseLog, encodeLog, simulate, player };
});
