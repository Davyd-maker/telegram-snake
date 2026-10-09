// Дуэль в реальном времени: две змейки на одном поле, ходы считает сервер (клиенты только присылают повороты).
// Комната по ссылке (позвать друга) или быстрый поиск соперника; если никого нет — бой с ботом.
// Проигрывает тот, кто врезался (в стену, в себя или в соперника); лоб в лоб — ничья.
// Через 90 секунд побеждает более длинная змейка.
const crypto = require("crypto");
const WS = require("./ws");
const { telegramUser } = require("./auth");
const { pool } = require("./db");
const C = require("./catalog");
const P = require("./players");

const N = 24, TICK_MS = 135, GAME_MS = 90000, COUNTDOWN_MS = 3000, FOODS = 3, QUICK_WAIT_MS = 12000;
const REWARD = { win: 100, draw: 30, lose: 10, bot: 20 }, REWARDED_PER_DAY = 15;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const q = (sql, params) => pool.query(sql, params);

const rooms = new Map();   // id → комната
const online = new Map();  // telegram_id → соединение (одно на игрока)
let waiting = null;        // комната быстрого поиска, ждущая соперника

const newId = () => crypto.randomBytes(4).toString("hex");
const pub = (pl) => pl ? { name: pl.name, skin: pl.skin, palette: pl.palette, acc: pl.acc, bot: !!pl.bot } : null;

// ---------- игра ----------
function newGame(room) {
  const g = {
    tick: 0, maxTicks: Math.round(GAME_MS / TICK_MS), foods: [], over: false,
    s: [
      { body: [{ x: 6, y: 12 }, { x: 5, y: 12 }, { x: 4, y: 12 }, { x: 3, y: 12 }], dir: 1, queue: [], grow: 0, alive: true, score: 0 },
      { body: [{ x: 17, y: 11 }, { x: 18, y: 11 }, { x: 19, y: 11 }, { x: 20, y: 11 }], dir: 3, queue: [], grow: 0, alive: true, score: 0 }
    ]
  };
  for (let i = 0; i < FOODS; i++) placeFood(g);
  room.game = g;
  return g;
}
function occupied(g, x, y) {
  return g.s.some((sn) => sn.body.some((c) => c.x === x && c.y === y)) || g.foods.some((f) => f.x === x && f.y === y);
}
function placeFood(g) {
  for (let tries = 0; tries < 400; tries++) {
    const x = crypto.randomInt(N), y = crypto.randomInt(N);
    if (occupied(g, x, y)) continue;
    // золото — редко: +3 очка и +3 к длине
    g.foods.push({ x, y, gold: crypto.randomInt(100) < 8 }); return;
  }
}
function step(g) {
  g.tick++;
  const heads = g.s.map((sn) => {
    if (!sn.alive) return null;
    if (sn.queue.length) sn.dir = sn.queue.shift();
    const h = sn.body[0], d = DIRS[sn.dir];
    return { x: h.x + d[0], y: h.y + d[1] };
  });
  // клетки тел после хода: хвост уходит, если змейка не растёт
  const bodyAt = (x, y) => g.s.some((sn) => sn.alive && sn.body.some((c, i) => c.x === x && c.y === y && !(i === sn.body.length - 1 && sn.grow <= 0)));
  const dead = [false, false];
  heads.forEach((h, i) => { if (h && (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || bodyAt(h.x, h.y))) dead[i] = true; });
  const [a, b] = heads;
  if (a && b && ((a.x === b.x && a.y === b.y) || (a.x === g.s[1].body[0].x && a.y === g.s[1].body[0].y && b.x === g.s[0].body[0].x && b.y === g.s[0].body[0].y))) dead[0] = dead[1] = true;
  const ev = [];
  g.s.forEach((sn, i) => {
    if (!sn.alive) return;
    if (dead[i]) { sn.alive = false; ev.push({ t: "die", p: i }); return; }
    const h = heads[i]; sn.body.unshift(h);
    const fi = g.foods.findIndex((f) => f.x === h.x && f.y === h.y);
    if (fi >= 0) { const f = g.foods.splice(fi, 1)[0]; sn.grow += f.gold ? 3 : 1; sn.score += f.gold ? 3 : 1; ev.push({ t: "eat", p: i, x: h.x, y: h.y, gold: f.gold }); placeFood(g); }
    if (sn.grow > 0) sn.grow--; else sn.body.pop();
  });
  if (dead[0] || dead[1]) g.over = { winner: dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0, reason: "crash" };
  else if (g.tick >= g.maxTicks) { const [x, y] = g.s.map((sn) => sn.body.length); g.over = { winner: x === y ? -1 : x > y ? 0 : 1, reason: "time" }; }
  return ev;
}
const stateMsg = (g, ev) => ({
  t: "s", k: g.tick, left: Math.max(0, g.maxTicks - g.tick), ms: TICK_MS,
  sn: g.s.map((sn) => sn.body.flatMap((c) => [c.x, c.y])), al: g.s.map((sn) => sn.alive), dir: g.s.map((sn) => sn.dir),
  f: g.foods.flatMap((f) => [f.x, f.y, f.gold ? 1 : 0]), sc: g.s.map((sn) => sn.body.length), ev
});

// ---------- бот: поиск в ширину к ближайшей еде, не заезжая в тупики ----------
function botDir(g, i) {
  const me = g.s[i], h = me.body[0], blocked = new Uint8Array(N * N);
  for (const sn of g.s) sn.body.forEach((c, k) => { if (!(k === sn.body.length - 1 && sn.grow <= 0)) blocked[c.y * N + c.x] = 1; });
  // клетки рядом с головой соперника — опасны
  const o = g.s[1 - i]; if (o.alive) for (const d of DIRS) { const x = o.body[0].x + d[0], y = o.body[0].y + d[1]; if (x >= 0 && y >= 0 && x < N && y < N) blocked[y * N + x] = 1; }
  const free = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !blocked[y * N + x];
  const room = (x, y) => { const seen = new Uint8Array(N * N), st = [[x, y]]; seen[y * N + x] = 1; let n = 0; while (st.length && n < 60) { const [cx, cy] = st.pop(); n++; for (const d of DIRS) { const nx = cx + d[0], ny = cy + d[1]; if (free(nx, ny) && !seen[ny * N + nx]) { seen[ny * N + nx] = 1; st.push([nx, ny]); } } } return n; };
  const opts = [0, 1, 2, 3].filter((d) => d !== (me.dir + 2) % 4 && free(h.x + DIRS[d][0], h.y + DIRS[d][1]));
  if (!opts.length) return me.dir;
  // BFS: первый шаг к ближайшей еде
  const prev = new Int8Array(N * N).fill(-1), qq = [];
  for (const d of opts) { const x = h.x + DIRS[d][0], y = h.y + DIRS[d][1]; prev[y * N + x] = d; qq.push(y * N + x); }
  let pick = -1;
  for (let k = 0; k < qq.length; k++) {
    const c = qq[k], x = c % N, y = (c / N) | 0;
    if (g.foods.some((f) => f.x === x && f.y === y)) { pick = prev[c]; break; }
    for (const d of DIRS) { const nx = x + d[0], ny = y + d[1], nk = ny * N + nx; if (free(nx, ny) && prev[nk] < 0) { prev[nk] = prev[c]; qq.push(nk); } }
  }
  const need = Math.min(40, me.body.length + 3);
  if (pick >= 0 && room(h.x + DIRS[pick][0], h.y + DIRS[pick][1]) >= need && crypto.randomInt(100) >= 4) return pick;
  return opts.sort((x, y) => room(h.x + DIRS[y][0], h.y + DIRS[y][1]) - room(h.x + DIRS[x][0], h.y + DIRS[x][1]))[0];
}

// ---------- комнаты ----------
function send(room, msg) { for (const pl of room.players) if (pl && pl.conn) pl.conn.send(msg); }
function startRoom(room) {
  clearTimeout(room.quickTimer);
  room.state = "countdown"; room.rematch = new Set();
  const g = newGame(room);
  room.duelId = newId();
  q(`INSERT INTO duels(id, a_id, b_id) VALUES($1,$2,$3)`, [room.duelId, room.players[0].id, room.players[1].id]).catch((e) => console.error("duel insert:", e.message));
  room.players.forEach((pl, i) => pl.conn && pl.conn.send({ t: "start", you: i, n: N, cd: COUNTDOWN_MS, ms: TICK_MS, players: room.players.map(pub), state: stateMsg(g, []) }));
  room.timer = setTimeout(() => {
    room.state = "play";
    room.timer = setInterval(() => {
      const g2 = room.game; if (!g2 || g2.over) return;
      room.players.forEach((pl, i) => { if (pl.bot && g2.s[i].alive) { const d = botDir(g2, i); if (d !== g2.s[i].dir) g2.s[i].queue = [d]; } });
      const ev = step(g2);
      send(room, stateMsg(g2, ev));
      if (g2.over) finish(room, g2.over.winner, g2.over.reason);
    }, TICK_MS);
  }, COUNTDOWN_MS);
}
async function finish(room, winner, reason) {
  clearInterval(room.timer); clearTimeout(room.timer);
  if (room.state === "end") return;
  room.state = "end";
  const g = room.game, sc = g ? g.s.map((sn) => sn.body.length) : [0, 0];
  const vsBot = room.players.some((pl) => pl && pl.bot);
  const rewards = [0, 0];
  for (let i = 0; i < 2; i++) {
    const pl = room.players[i]; if (!pl || pl.bot) continue;
    try {
      const done = (await q(`SELECT COUNT(*)::int AS n FROM duels WHERE (a_id=$1 OR b_id=$1) AND finished_at > NOW() - INTERVAL '1 day'`, [pl.id])).rows[0].n;
      const r = done >= REWARDED_PER_DAY ? 0 : vsBot ? (winner === i ? REWARD.bot : 0) : winner === -1 ? REWARD.draw : winner === i ? REWARD.win : REWARD.lose;
      rewards[i] = r;
      await q(`UPDATE players SET coins=coins+$1, duel_games=duel_games+1, duel_wins=duel_wins+$2 WHERE telegram_id=$3`, [r, !vsBot && winner === i ? 1 : 0, pl.id]);
    } catch (e) { console.error("duel reward:", e.message); }
  }
  const wid = winner >= 0 ? room.players[winner]?.id || "" : "draw";
  q(`UPDATE duels SET winner=$1, a_score=$2, b_score=$3, reason=$4, finished_at=NOW() WHERE id=$5`, [wid, sc[0], sc[1], reason, room.duelId]).catch(() => {});
  room.players.forEach((pl, i) => pl && pl.conn && pl.conn.send({ t: "end", you: i, winner, reason, sc, reward: rewards[i] }));
  // против бота «реванш» начинается сразу по запросу игрока
}
function leaveRoom(pl, why = "left") {
  const room = pl.room; if (!room) return;
  pl.room = null;
  if (waiting === room) waiting = null;
  const i = room.players.indexOf(pl);
  if (room.state === "countdown" || room.state === "play") finish(room, 1 - i, why);
  const other = room.players[1 - i];
  if (other && other.conn && !other.bot) other.conn.send({ t: "opp_left" });
  if (other) other.room = null;
  clearInterval(room.timer); clearTimeout(room.timer); clearTimeout(room.quickTimer);
  rooms.delete(room.id);
}
function botPlayer() {
  const skins = ["fire", "ocean", "toxic", "sakura", "ice", "sunset"];
  return { id: "bot", name: "🤖 Бот", skin: skins[crypto.randomInt(skins.length)], palette: null, acc: "", bot: true };
}

// ---------- соединения ----------
async function onConn(conn) {
  let pl = null, msgs = 0, msgsAt = Date.now();
  conn.onClose(() => { if (pl) { leaveRoom(pl, "left"); if (online.get(pl.id) === conn) online.delete(pl.id); } });
  conn.onmessage = async (raw) => {
    const now = Date.now(); if (now - msgsAt > 1000) { msgsAt = now; msgs = 0; } if (++msgs > 40) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "auth") {
      if (pl) return;
      const u = telegramUser({ get: (h) => (h === "X-Telegram-Init-Data" ? String(m.init || "") : "") });
      if (!u) { conn.send({ t: "err", e: "auth" }); return conn.close(4001); }
      const row = (await q(`SELECT telegram_id, first_name, username, skin, accessory, owned_accessories, banned FROM players WHERE telegram_id=$1`, [String(u.id)])).rows[0];
      if (!row || row.banned) { conn.send({ t: "err", e: "banned" }); return conn.close(4003); }
      const old = online.get(row.telegram_id); if (old && old !== conn) { old.send({ t: "err", e: "other_tab" }); old.close(4000); }
      online.set(row.telegram_id, conn);
      pl = { id: row.telegram_id, name: row.first_name || row.username || "Игрок", skin: C.skinDef(row.skin) ? row.skin : "classic", palette: C.skinPalette(row.skin),
        acc: C.ACC_BY_ID[row.accessory] && (row.owned_accessories || []).includes(row.accessory) ? row.accessory : "", conn, room: null };
      return conn.send({ t: "hello", name: pl.name });
    }
    if (!pl) return;
    if (m.t === "create") {
      if (pl.room) leaveRoom(pl);
      const room = { id: newId(), players: [pl, null], state: "lobby", invite: true };
      rooms.set(room.id, room); pl.room = room;
      setTimeout(() => { if (rooms.get(room.id) === room && room.state === "lobby") { pl.conn.send({ t: "err", e: "expired" }); leaveRoom(pl); } }, 10 * 60000).unref();
      return conn.send({ t: "room", id: room.id, link: P.startLink("du_" + room.id) });
    }
    if (m.t === "join") {
      const room = rooms.get(String(m.id || ""));
      if (!room || room.state !== "lobby" || room.players[1]) return conn.send({ t: "err", e: "no_room" });
      if (room.players[0].id === pl.id) return conn.send({ t: "err", e: "own_room" });
      if (pl.room) leaveRoom(pl);
      room.players[1] = pl; pl.room = room;
      return startRoom(room);
    }
    if (m.t === "quick") {
      if (pl.room) leaveRoom(pl);
      if (waiting && waiting.players[0].id !== pl.id && waiting.state === "lobby") {
        const room = waiting; waiting = null; room.players[1] = pl; pl.room = room; return startRoom(room);
      }
      const room = { id: newId(), players: [pl, null], state: "lobby", quick: true };
      rooms.set(room.id, room); pl.room = room; waiting = room;
      conn.send({ t: "wait", ms: QUICK_WAIT_MS });
      // никого нет — играем с ботом
      room.quickTimer = setTimeout(() => {
        if (waiting !== room || room.state !== "lobby") return;
        waiting = null; room.players[1] = botPlayer(); startRoom(room);
      }, QUICK_WAIT_MS);
      return;
    }
    if (m.t === "bot") {
      if (pl.room) leaveRoom(pl);
      const room = { id: newId(), players: [pl, botPlayer()], state: "lobby" };
      rooms.set(room.id, room); pl.room = room; return startRoom(room);
    }
    if (m.t === "d") {
      const room = pl.room; if (!room || !room.game || room.state === "end") return;
      const i = room.players.indexOf(pl), sn = room.game.s[i], d = m.d | 0;
      if (!sn || !sn.alive || d < 0 || d > 3) return;
      const base = sn.queue.length ? sn.queue[sn.queue.length - 1] : sn.dir;
      if (d === base || d === (base + 2) % 4 || sn.queue.length >= 2) return;
      sn.queue.push(d); return;
    }
    if (m.t === "rematch") {
      const room = pl.room; if (!room || room.state !== "end") return;
      room.rematch.add(pl.id);
      const other = room.players.find((x) => x !== pl);
      if (other && other.bot) other.id && room.rematch.add(other.id);
      if (room.players.every((x) => x && room.rematch.has(x.id))) return startRoom(room);
      if (other && other.conn) other.conn.send({ t: "rematch_ask" });
      return;
    }
    if (m.t === "leave") { leaveRoom(pl); return conn.send({ t: "left" }); }
  };
}

// Есть ли комната (для экрана «тебя позвали на дуэль»)
function routes(app) {
  app.get("/api/duel/:id", (req, res) => {
    const room = rooms.get(String(req.params.id));
    if (!room || room.state !== "lobby" || room.players[1] || !room.invite) return res.status(404).json({ error: "No room" });
    res.json({ ok: true, host: room.players[0].name });
  });
  app.get("/api/duel-online", (_req, res) => res.json({ online: online.size, waiting: !!waiting }));
}

function attach(server) {
  const ws = WS.attach(server, "/ws/duel", onConn);
  return { online: () => online.size, rooms: () => rooms.size, conns: ws.count };
}

module.exports = { attach, routes, step, newGame, botDir, N };
