// Минимальный WebSocket-сервер (RFC 6455) без зависимостей: текстовые сообщения, ping/pong, закрытие.
// Нужен для дуэлей в реальном времени. Сообщения клиента — JSON до 4 КБ.
const crypto = require("crypto");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 4096;

class Conn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null; this.closed = false; this.alive = true;
    this.onmessage = null; this._closeFns = [];
    socket.setNoDelay(true);
    socket.on("data", (d) => this._data(d));
    socket.on("close", () => this._closed());
    socket.on("error", () => this._closed());
  }
  onClose(fn) { this._closeFns.push(fn); }
  _closed() { if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e) {} for (const fn of this._closeFns) try { fn(); } catch (e) { console.error("ws close:", e); } }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1], fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const hi = this.buf.readUInt32BE(2); len = this.buf.readUInt32BE(6); off = 10; if (hi) return this.close(1009); }
      if (len > MAX_PAYLOAD || !masked) return this.close(len > MAX_PAYLOAD ? 1009 : 1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4), data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this._frame(0xA, data); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2) this.frag = data; else if (op === 0x0 && this.frag) this.frag = Buffer.concat([this.frag, data]); else continue;
      if (this.frag.length > MAX_PAYLOAD) return this.close(1009);
      if (fin) { const msg = this.frag.toString("utf8"); this.frag = null; this.alive = true; if (this.onmessage) try { this.onmessage(msg); } catch (e) { console.error("ws message:", e); } }
    }
  }
  _frame(op, payload) {
    if (this.closed) return;
    const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
    let h = head;
    if (!h) { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(n, 6); }
    try { this.socket.write(Buffer.concat([h, payload])); } catch (e) { this._closed(); }
  }
  send(obj) { this._frame(0x1, Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8")); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (this.closed) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code, 0); this._frame(0x8, b);
    setTimeout(() => this._closed(), 50);
  }
}

// Подключает обработчик к http-серверу: path — адрес (например "/ws/duel"), onConn(conn, req)
function attach(server, path, onConn) {
  const all = new Set();
  server.on("upgrade", (req, socket) => {
    const url = String(req.url || "").split("?")[0];
    if (url !== path) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (String(req.headers.upgrade || "").toLowerCase() !== "websocket" || !key) { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const c = new Conn(socket); all.add(c);
    c.onClose(() => all.delete(c));
    onConn(c, req);
  });
  // проверка живых соединений: ping каждые 20 с, кто не ответил — отключаем
  const t = setInterval(() => { for (const c of all) { if (!c.alive) { c.close(1001); continue; } c.alive = false; c.ping(); } }, 20000);
  t.unref();
  return { count: () => all.size };
}

module.exports = { attach, Conn };
