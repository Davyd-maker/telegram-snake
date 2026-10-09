// Бот для проверки уровней: ищет кратчайший путь (поиск в ширину) к еде, а когда открыта норка — к норке.
// Избегает стен, закрытых ворот и тела; если пути нет — едет туда, где больше свободного места.
const E = require("../public/engine.js");
const N = E.N;
function blockedAt(g, x, y, tailFree) {
  if (x < 0 || y < 0 || x >= N || y >= N) return true;
  const k = y * N + x;
  if (g.rockSet[k] || (g.lv && g.gateClosed(x, y))) return true;
  if (g.pending.some((c) => c.x === x && c.y === y && c.solidAt - g.ticks <= 2)) return true;
  if (g.gateSet && g.gateSet[k]) { const gt = g.gates.find((q) => q.x === x && q.y === y); if (gt && (gt.warn || gt.closed)) return true; }
  if (g.occ[k]) { const t = g.snake[g.snake.length - 1]; if (!(tailFree && t.x === x && t.y === y)) return true; }
  return false;
}
function bfsDir(g, tx, ty) {
  const h = g.snake[0], prev = new Int32Array(N * N).fill(-1), q = [];
  for (const [dx, dy] of E.DIRS) {
    if (dx === -g.dir.x && dy === -g.dir.y) continue;
    const x = h.x + dx, y = h.y + dy;
    if (blockedAt(g, x, y, g.pendingGrowth <= 0)) continue;
    const k = y * N + x; if (prev[k] !== -1) continue; prev[k] = (dx + 1) * 3 + (dy + 1); q.push([x, y]);
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === tx && y === ty) return prev[y * N + x];
    for (const [dx, dy] of E.DIRS) {
      const nx = x + dx, ny = y + dy; if (blockedAt(g, nx, ny, false)) continue;
      const k = ny * N + nx; if (prev[k] !== -1) continue; prev[k] = prev[y * N + x]; q.push([nx, ny]);
    }
  }
  return -1;
}
function space(g, x, y) { // сколько клеток доступно из (x,y)
  const seen = new Uint8Array(N * N), st = [[x, y]]; seen[y * N + x] = 1; let n = 0;
  while (st.length && n < 200) { const [cx, cy] = st.pop(); n++; for (const [dx, dy] of E.DIRS) { const nx = cx + dx, ny = cy + dy; if (blockedAt(g, nx, ny, true)) continue; const k = ny * N + nx; if (seen[k]) continue; seen[k] = 1; st.push([nx, ny]); } }
  return n;
}
function step(g) {
  const t = g.hole || g.food;
  let code = bfsDir(g, t.x, t.y), d = null;
  if (code >= 0) { d = { x: Math.floor(code / 3) - 1, y: (code % 3) - 1 }; const h = g.snake[0]; if (space(g, h.x + d.x, h.y + d.y) < Math.min(40, g.snake.length + 4)) d = null; }
  if (!d) { // выживание: куда больше места
    let best = -1; const h = g.snake[0];
    for (const [dx, dy] of E.DIRS) { if (dx === -g.dir.x && dy === -g.dir.y) continue; if (blockedAt(g, h.x + dx, h.y + dy, g.pendingGrowth <= 0)) continue; const sp = space(g, h.x + dx, h.y + dy); if (sp > best) { best = sp; d = { x: dx, y: dy }; } }
  }
  if (d && (d.x !== g.dir.x || d.y !== g.dir.y)) g.setdir(d.x, d.y);
}
function playLevel(level, seed, maxTicks = 6000) {
  const g = new E.Game({ mode: "level", level, seed, rules: E.RULES });
  while (!g.over && g.ticks < maxTicks) { step(g); g.tick(); }
  return g;
}
module.exports = { playLevel, step };
