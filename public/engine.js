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

  // Режимы: mult — множитель награды, rated — идёт в общий рейтинг и сезон
  const MODES = {
    classic: { name: "Классика",       emoji: "🧱", mult: 1,    rated: true,  hint: "Стены смертельны · идёт в рейтинг и сезон" },
    nowalls: { name: "Без стен",       emoji: "🌀", mult: 0.5,  rated: false, hint: "Стены проходимы · награда ×0.5" },
    rocks:   { name: "Камни",          emoji: "🪨", mult: 1.25, rated: false, hint: "Случайные камни на поле · награда ×1.25" },
    maze:    { name: "Лабиринт",       emoji: "🧩", mult: 1.25, rated: false, hint: "Фиксированные стены · награда ×1.25" },
    moving:  { name: "Живые стены",    emoji: "⚡", mult: 1.5,  rated: false, hint: "Камни появляются и исчезают · награда ×1.5" }
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
    bomb:   { icon: "💣", color: "#ff8a4c", dur: 0,     name: "Бомба" }
  };
  const TIMED = ["slow", "x2", "ghost", "magnet"];
  const MAX_ART_LEVEL = 5;
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

  const normCfg = (cfg) => ({
    seed: (Number(cfg && cfg.seed) >>> 0) || 1,
    mode: MODES[cfg && cfg.mode] ? cfg.mode : "classic",
    diff: DIFFS[cfg && cfg.diff] ? cfg.diff : "normal",
    artifact: ["magnet", "berserk", "phantom"].includes(cfg && cfg.artifact) ? cfg.artifact : "",
    artLevel: Math.max(1, Math.min(MAX_ART_LEVEL, (cfg && cfg.artLevel) | 0 || 1))
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
      this.fx = { slow: 0, x2: 0, ghost: 0, magnet: 0 };
      this.shield = false;
      this.charges = cfg.artifact === "phantom" ? this.art.phantomCharges : 0; // «Фантом»: спасения за забег
      this.pu = null; this.nextPuAt = 10000;
      this.safeUntil = SAFE_MS;             // короткая неуязвимость на старте и после паузы
      this.over = false; this.reason = ""; this.win = false;
      this.rocks = []; this.pending = [];   // pending — камни «живых стен», которые вот-вот станут твёрдыми
      this.rockSet = new Uint8Array(N * N);
      this.food = null;
      // статистика забега: для заданий и для античита (на правила не влияет)
      this.stats = { gold: 0, coin: 0, pu: 0, saves: 0, pathTicks: 0, pathDist: 0 };
      this._foodAt = null;
      this._initObstacles();
      this.placeFood();
    }

    // ---- препятствия ----
    _setRocks(list) {
      this.rocks = list; this.rockSet.fill(0);
      for (const r of list) this.rockSet[r.y * N + r.x] = 1;
    }
    _initObstacles() {
      const m = this.cfg.mode;
      if (m === "maze") this._setRocks(MAZE.map(([x, y]) => ({ x, y })));
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
          if (Math.abs(x - head.x) + Math.abs(y - head.y) < 5) continue;
          if (this.food && this.food.x === x && this.food.y === y) continue;
          seen.add(k); list.push({ x, y, solidAt: t + WARN });
        }
        this._setRocks([]); this.pending = list; ev.push({ t: "rocks" });
      }
    }

    // ---- скорость ----
    stepMs() { return this.speedMs * (this.fx.slow > this.gameTime ? 1.6 : 1) * DIFFS[this.cfg.diff].speed; }
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
      const free = [];
      for (let i = 0; i < N * N; i++) if (!busy[i]) free.push({ x: i % N, y: (i / N) | 0 });
      return free;
    }
    placeFood() {
      const free = this.freeCells();
      if (!free.length) return false;
      const c = free[Math.floor(this.rng() * free.length)];
      this.food = { x: c.x, y: c.y, type: this.rng() < 0.82 ? "apple" : (this.rng() < 0.5 ? "coin" : "gold") };
      const h = this.snake[0];
      this._foodAt = { t: this.ticks, x: h.x, y: h.y };
      return true;
    }
    spawnPu() {
      const free = this.freeCells(); if (!free.length) return;
      const c = free[Math.floor(this.rng() * free.length)], types = Object.keys(PU);
      let type;
      do { type = types[Math.floor(this.rng() * types.length)]; } while (type === "bomb" && this.snake.length < 8);
      this.pu = { x: c.x, y: c.y, type, expires: this.gameTime + PU_LIFE };
      this.nextPuAt = this.gameTime + 16000 + this.rng() * 8000;
    }
    activatePu(type, ev) {
      if (type === "shield") this.shield = true;
      else if (type === "bomb") {
        const keep = Math.max(START_LEN, Math.ceil(this.snake.length / 2)), cells = [];
        while (this.snake.length > keep) { const q = this.snake.pop(); this.occ[q.y * N + q.x]--; cells.push(q); }
        this.updateSpeed();
        ev.push({ t: "bomb", cells });
      } else this.fx[type] = Math.max(this.fx[type], this.gameTime) + PU[type].dur;
      this.stats.pu++;
      ev.push({ t: "pu", type });
    }

    _bodyHit(x, y) {
      let c = this.occ[y * N + x];
      const tail = this.snake[this.snake.length - 1];
      if (this.pendingGrowth <= 0 && tail.x === x && tail.y === y) c--; // хвост на этом ходу уйдёт
      return c > 0;
    }
    _free(x, y) {
      return x >= 0 && x < N && y >= 0 && y < N && !this.occ[y * N + x] && !this.rockSet[y * N + x] && !(this.pu && this.pu.x === x && this.pu.y === y);
    }

    // ---- один ход ----
    tick() {
      const ev = [];
      if (this.over) return ev;
      const interval = this.stepMs(), cfg = this.cfg;
      if (this.queue.length) this.dir = this.queue.shift();
      const ghost = this.ghostOn();
      let hx = this.snake[0].x + this.dir.x, hy = this.snake[0].y + this.dir.y;
      if (cfg.mode === "nowalls" || ghost) { hx = (hx + N) % N; hy = (hy + N) % N; }
      const oob = hx < 0 || hx >= N || hy < 0 || hy >= N;
      const hit = oob || (!ghost && (this._bodyHit(hx, hy) || this.rockSet[hy * N + hx] === 1));
      if (hit) {
        let saved = "";
        if (this.isSafe()) saved = "safe";
        else if (this.charges > 0) { this.charges--; saved = "phantom"; }
        else if (this.shield) { this.shield = false; saved = "shield"; }
        if (!saved) { this.over = true; this.reason = oob ? "wall" : "body"; ev.push({ t: "over", reason: this.reason }); return ev; }
        hx = (hx + N) % N; hy = (hy + N) % N;
        if (saved !== "safe") this.stats.saves++;
        ev.push({ t: "save", kind: saved, x: hx, y: hy });
      }
      this.gameTime += interval; this.ticks++;
      for (const k of TIMED) if (this.fx[k] && this.fx[k] <= this.gameTime) { this.fx[k] = 0; ev.push({ t: "fxend", k }); }
      this.snake.unshift({ x: hx, y: hy }); this.occ[hy * N + hx]++;
      const mult = this.fx.x2 > this.gameTime ? 2 : 1;

      const f = this.food, ate = hx === f.x && hy === f.y;
      if (ate) {
        this.combo++; this.comboTimer = COMBO_WINDOW; this.bestRun = Math.max(this.bestRun, this.combo);
        const cm = Math.min(this.combo, COMBO_MAX);
        const berserk = cfg.artifact === "berserk" && cm >= 3 ? this.art.berserkBonus : 1;
        const pts = Math.floor((f.type === "gold" ? 5 : 1) * cm * mult * berserk);
        this.score += pts;
        let coins = 0;
        if (f.type === "coin") coins = 10 * mult; else if (f.type === "gold") coins = 50 * mult;
        this.runCoins += coins;
        this.pendingGrowth += GROWTH[f.type] || 1;
        this.apples++;
        if (f.type === "gold") this.stats.gold++; else if (f.type === "coin") this.stats.coin++;
        // насколько путь к еде близок к кратчайшему (люди петляют, боты — нет)
        if (this._foodAt) {
          let dx = Math.abs(f.x - this._foodAt.x), dy = Math.abs(f.y - this._foodAt.y);
          if (cfg.mode === "nowalls") { dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); }
          if (dx + dy >= 4) { this.stats.pathDist += dx + dy; this.stats.pathTicks += this.ticks - this._foodAt.t; }
        }
        ev.push({ t: "ate", x: f.x, y: f.y, type: f.type, pts, cm, coins, mult, combo: this.combo });
        this.updateSpeed();
        if (!this.placeFood()) { this.over = true; this.win = true; this.reason = "win"; ev.push({ t: "over", reason: "win", win: true }); return ev; }
      }

      // Магнит (артефакт): еда в 2..R клетках по прямой подтягивается на клетку; бонус «магнит» — еда рядом притягивается в любую сторону
      if (!ate) {
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
      if (cfg.mode === "moving") this._updateMoving(ev);

      if (this.comboTimer > 0) this.comboTimer--;
      else if (this.combo > 0) this.combo = 0;
      return ev;
    }

    result() {
      return { score: this.score, apples: this.apples, runCoins: this.runCoins, bestRun: this.bestRun, ticks: this.ticks, gameTime: this.gameTime, over: this.over, reason: this.reason, win: this.win, stats: { ...this.stats } };
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
      if (t < prev || (e & 7) > OP_RESUME) return null;
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
        else if (g.setdir(DIRS[c][0], DIRS[c][1])) turns++;
      }
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
      done: () => g.over || g.ticks >= ticks,
      next() {
        while (ptr < log.length && (log[ptr] >> 3) <= g.ticks) {
          const c = log[ptr++] & 7;
          if (c === OP_RESUME) g.resume(); else g.setdir(DIRS[c][0], DIRS[c][1]);
        }
        return g.tick();
      }
    };
  }

  return { N, START_LEN, SAFE_MS, DIRS, MODES, DIFFS, PU, TIMED, MAX_ART_LEVEL, PU_LIFE, COMBO_WINDOW, COMBO_MAX,
    artifactStats, mulberry32, normCfg, Game, reward, isRated, parseLog, encodeLog, simulate, player };
});
