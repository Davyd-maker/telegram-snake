// Ограничитель частоты запросов. По умолчанию счётчики в памяти процесса (хватает для одного сервера).
// Если задан REDIS_URL (redis://[:пароль@]host:port[/db] или rediss:// для TLS) — счётчики общие в Redis,
// и лимиты работают, даже когда запущено несколько экземпляров сервера.
// rateLimiter(...) возвращает async (key) => true, если вызов разрешён.
const net = require("net");
const tls = require("tls");

// ---------- память ----------
function memoryLimiter({ windowMs, max }) {
  const hits = new Map();
  return async (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

// ---------- минимальный клиент Redis (протокол RESP), без внешних зависимостей ----------
class MiniRedis {
  constructor(url) {
    this.url = new URL(url);
    this.queue = []; this.buf = Buffer.alloc(0); this.sock = null; this.ready = null;
  }
  connect() {
    if (this.ready) return this.ready;
    const u = this.url, port = Number(u.port || 6379), host = u.hostname;
    this.ready = new Promise((ok, fail) => {
      const s = u.protocol === "rediss:" ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      this.sock = s;
      s.setTimeout(5000, () => s.destroy(new Error("redis timeout")));
      s.once(u.protocol === "rediss:" ? "secureConnect" : "connect", async () => {
        s.setTimeout(0);
        try {
          if (u.password) await this.cmd(u.username ? ["AUTH", decodeURIComponent(u.username), decodeURIComponent(u.password)] : ["AUTH", decodeURIComponent(u.password)]);
          const db = u.pathname.replace("/", ""); if (db) await this.cmd(["SELECT", db]);
          ok();
        } catch (e) { fail(e); }
      });
      s.on("data", (d) => this._onData(d));
      const reset = (e) => { for (const q of this.queue.splice(0)) q.fail(e || new Error("redis closed")); this.ready = null; this.buf = Buffer.alloc(0); };
      s.on("error", (e) => { reset(e); fail(e); });
      s.on("close", () => reset());
    });
    return this.ready;
  }
  cmd(args) {
    return new Promise((ok, fail) => {
      this.queue.push({ ok, fail });
      this.sock.write(`*${args.length}\r\n` + args.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join(""));
    });
  }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const r = parseResp(this.buf, 0);
      if (!r) return;
      this.buf = this.buf.subarray(r.end);
      const q = this.queue.shift();
      if (q) (r.err ? q.fail(new Error(r.err)) : q.ok(r.value));
    }
  }
  async run(args) { await this.connect(); return this.cmd(args); }
}
// Разбор одного ответа RESP; null — если данных пока не хватает
function parseResp(buf, i) {
  const nl = buf.indexOf("\r\n", i); if (nl < 0) return null;
  const type = String.fromCharCode(buf[i]), line = buf.toString("utf8", i + 1, nl);
  if (type === "+") return { value: line, end: nl + 2 };
  if (type === "-") return { err: line, end: nl + 2 };
  if (type === ":") return { value: Number(line), end: nl + 2 };
  if (type === "$") {
    const len = Number(line); if (len < 0) return { value: null, end: nl + 2 };
    if (buf.length < nl + 2 + len + 2) return null;
    return { value: buf.toString("utf8", nl + 2, nl + 2 + len), end: nl + 2 + len + 2 };
  }
  if (type === "*") {
    const n = Number(line), out = []; let pos = nl + 2;
    for (let k = 0; k < n; k++) { const r = parseResp(buf, pos); if (!r) return null; out.push(r.value); pos = r.end; }
    return { value: out, end: pos };
  }
  return { err: "bad reply", end: buf.length };
}

let redis = null;
const redisUrl = () => process.env.REDIS_URL || "";
function getRedis() { if (!redis && redisUrl()) redis = new MiniRedis(redisUrl()); return redis; }
let seq = 0;

// Фиксированное окно в Redis: INCR + PEXPIRE. Если Redis недоступен — запасной лимит в памяти (не блокируем игроков).
function redisLimiter({ windowMs, max }) {
  const name = "rl" + ++seq, fallback = memoryLimiter({ windowMs, max });
  return async (key) => {
    const r = getRedis();
    try {
      const k = `sa:${name}:${Math.floor(Date.now() / windowMs)}:${key}`;
      const n = await r.run(["INCR", k]);
      if (n === 1) await r.run(["PEXPIRE", k, String(windowMs + 1000)]);
      return n <= max;
    } catch (e) {
      return fallback(key);
    }
  };
}

const rateLimiter = (opts) => (redisUrl() ? redisLimiter(opts) : memoryLimiter(opts));
const closeRedis = () => { if (redis?.sock) redis.sock.destroy(); redis = null; };
module.exports = { rateLimiter, closeRedis, MiniRedis, parseResp };
