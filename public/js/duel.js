// Дуэль в реальном времени (клиент): WebSocket /ws/duel, сервер считает ходы и присылает состояние,
// клиент рисует обе змейки (плавно между ходами) и отправляет повороты.
(() => {
  "use strict";
  const SA = window.SA;
  const $ = (id) => document.getElementById(id);
  const A = () => SA.app;
  const t = (s, params) => SA.i18n.t(s, params);
  const esc = SA.esc;
  const tg = window.Telegram?.WebApp;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  let ws = null, wsReady = false, queue = [], status = "idle"; // idle | connecting | room | wait | play | end
  let room = null, you = 0, players = [], st = null, prev = null, lastAt = 0, stepMs = 135, startAt = 0, cdUntil = 0, endMsg = null;
  let renderer = null, raf = 0, joinTried = false, lastDir = -1;

  // ---------- соединение ----------
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    wsReady = false; status = status === "idle" ? "connecting" : status;
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/duel");
    ws.onopen = () => { ws.send(JSON.stringify({ t: "auth", init: tg?.initData || "" })); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
    ws.onclose = () => {
      wsReady = false; ws = null;
      if (status === "play") { status = "idle"; showEnd({ winner: 1 - you, reason: "conn", sc: st ? st.sc : [0, 0], reward: 0 }); }
      else if (status !== "end") { status = "idle"; render(); }
    };
  }
  function send(o) { if (ws && wsReady) ws.send(JSON.stringify(o)); else { queue.push(o); connect(); } }

  function onMsg(m) {
    if (m.t === "hello") { wsReady = true; const q = queue; queue = []; q.forEach((o) => ws.send(JSON.stringify(o))); return; }
    if (m.t === "err") {
      const map = { auth: "Открой игру через Telegram, чтобы играть дуэли", banned: "Аккаунт заблокирован", no_room: "Комната не найдена или бой уже начался", own_room: "Это твоя комната — отправь ссылку другу", expired: "Приглашение устарело", other_tab: "Дуэль открыта в другом окне" };
      A().toast(map[m.e] || "Ошибка дуэли"); status = "idle"; room = null; render(); return;
    }
    if (m.t === "room") { status = "room"; room = { id: m.id, link: m.link }; render(); return; }
    if (m.t === "wait") { status = "wait"; startAt = Date.now(); render(); tickWait(); return; }
    if (m.t === "start") return start(m);
    if (m.t === "s") { prev = st; st = unpack(m); lastAt = performance.now(); stepMs = m.ms || stepMs; for (const e of m.ev || []) event(e); hud(); return; }
    if (m.t === "end") return showEnd(m);
    if (m.t === "opp_left") { if (status === "end") { $("doRematch").disabled = true; $("doSub").textContent = t("Соперник вышел"); } else if (status !== "play") { A().toast("Соперник вышел"); status = "idle"; render(); } return; }
    if (m.t === "rematch_ask") { $("doSub").textContent = t("Соперник хочет реванш!"); A().haptic("light"); return; }
    if (m.t === "left") { status = "idle"; room = null; render(); }
  }
  const unpack = (m) => ({
    k: m.k, left: m.left, alive: m.al, dir: m.dir, sc: m.sc,
    snakes: m.sn.map((a) => { const out = []; for (let i = 0; i < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] }); return out; }),
    foods: (() => { const o = []; for (let i = 0; i < m.f.length; i += 3) o.push({ x: m.f[i], y: m.f[i + 1], gold: !!m.f[i + 2] }); return o; })()
  });

  // ---------- экран дуэлей (меню) ----------
  function render() {
    const box = $("duelBox"); if (!box) return;
    const p = A().p;
    let html = `<p class="muted">${t("Две змейки на одном поле в реальном времени. Врезался в стену, в себя или в соперника — проиграл. Лоб в лоб — ничья. Через 90 секунд побеждает более длинная змейка.")}</p>
      <div class="invby">⚔️ ${t("Побед")}: <b>${p.duel_wins || 0}</b> · ${t("боёв")}: <b>${p.duel_games || 0}</b> · 🪙 ${t("победа")} +100, ${t("ничья")} +30</div>`;
    if (status === "room" && room) {
      html += `<div class="duelwait"><div class="spin">⏳</div><b>${t("Ждём друга…")}</b><small>${t("Отправь ему ссылку — бой начнётся, как только он откроет её")}</small>
        <div class="refbtns"><button class="primary" id="dlShare">📤 ${t("Отправить ссылку")}</button><button class="alt" id="dlCancel">✕ ${t("Отмена")}</button></div></div>`;
    } else if (status === "wait") {
      html += `<div class="duelwait"><div class="spin">🔎</div><b>${t("Ищем соперника…")}</b><small id="dlWaitT">${t("Если никого не найдём — сыграешь с ботом")}</small>
        <button class="alt" id="dlCancel" style="margin-top:10px">✕ ${t("Отмена")}</button></div>`;
    } else if (status === "connecting") {
      html += `<div class="duelwait"><div class="spin">📡</div><b>${t("Подключаемся…")}</b></div>`;
    } else {
      html += `<div class="duelbtns">
        <button class="primary big2" id="dlQuick">🎲 ${t("Случайный соперник")}</button>
        <button class="alt big2" id="dlInvite">👥 ${t("Позвать друга")}</button>
        <button class="alt big2" id="dlBot">🤖 ${t("Тренировка с ботом")}</button></div>`;
    }
    box.innerHTML = html;
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    on("dlQuick", () => { status = "connecting"; render(); send({ t: "quick" }); });
    on("dlInvite", () => { status = "connecting"; render(); send({ t: "create" }); });
    on("dlBot", () => { status = "connecting"; render(); send({ t: "bot" }); });
    on("dlCancel", () => { send({ t: "leave" }); status = "idle"; room = null; render(); });
    on("dlShare", () => room && A().shareLink(room.link || A().refLink(), `⚔️ ${t("Вызываю тебя на дуэль в Snake Arena! Жми — бой начнётся сразу")}`));
  }
  function tickWait() {
    if (status !== "wait") return;
    const el = $("dlWaitT"); if (el) el.textContent = `${t("Если никого не найдём — сыграешь с ботом")} · ${Math.max(0, 12 - Math.floor((Date.now() - startAt) / 1000))} ${t("с")}`;
    setTimeout(tickWait, 500);
  }

  // ---------- бой ----------
  function start(m) {
    status = "play"; you = m.you; players = m.players; stepMs = m.ms || 135; endMsg = null;
    st = unpack(m.state); prev = st; lastAt = performance.now(); cdUntil = performance.now() + (m.cd || 3000); lastDir = -1;
    $("duelOver").classList.remove("show");
    document.querySelectorAll(".app .screen").forEach((x) => x.classList.remove("active"));
    $("duelGame").classList.add("active");
    $("dMeName").textContent = players[you].name; $("dOppName").textContent = players[1 - you].name;
    if (!renderer) renderer = SA.createRenderer($("dcv"), { N: m.n || 24 });
    renderer.setField(A().fieldId());
    requestAnimationFrame(() => { renderer.resize(); renderer.reset(); });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    A().sfx.tick(); A().haptic("medium"); hud();
  }
  function event(e) {
    if (!renderer) return;
    if (e.t === "eat") { renderer.burst(e.x, e.y, e.gold ? "gold" : "apple"); renderer.ring(e.x, e.y, e.gold ? "#ffd84c" : "#ff6b81"); if (e.p === you) { renderer.eat({ x: e.x, y: e.y, type: e.gold ? "gold" : "apple" }, stepMs); renderer.floater(e.x, e.y, e.gold ? "+3" : "+1"); A().sfx.eat(); A().haptic("light"); } }
    if (e.t === "die") { const sn = st.snakes[e.p]; if (sn) renderer.die(sn); A().haptic(e.p === you ? "error" : "success"); }
  }
  const dirOf = (a, b) => (b && a ? { x: Math.sign(a.x - b.x) || 0, y: Math.sign(a.y - b.y) || 0 } : { x: 1, y: 0 });
  function view() {
    const me = st.snakes[you], op = st.snakes[1 - you], pm = prev.snakes[you], po = prev.snakes[1 - you];
    const P = players, now = performance.now();
    return {
      snake: st.alive[you] ? me : [], prevSnake: pm, dir: dirOf(me[0], me[1]),
      food: st.foods[0] ? { ...st.foods[0], type: st.foods[0].gold ? "gold" : "apple", fruit: A().p.holiday ? 6 : (st.foods[0].x * 7 + st.foods[0].y * 3) % 6 } : null, foodBorn: 0,
      foods: st.foods, stepMs, lastTick: lastAt, paused: false, rocks: [], pending: [], skin: P[you].skin, palette: P[you].palette, acc: P[you].acc,
      countdown: now < cdUntil ? Math.ceil((cdUntil - now) / 1000) : 0, countdownAt: cdUntil - Math.ceil((cdUntil - now) / 1000) * 1000,
      others: [{ snake: op, prevSnake: po, dir: dirOf(op[0], op[1]), skin: P[1 - you].skin, palette: P[1 - you].palette, acc: P[1 - you].acc, label: P[1 - you].name, dead: !st.alive[1 - you], color: "#ff9a9a" }],
      combo: 0
    };
  }
  function loop(now) {
    if (status !== "play" && !endMsg) return;
    if (st && renderer) {
      const v = view();
      renderer.draw(v, now);
      drawExtraFood(v);
    }
    raf = requestAnimationFrame(loop);
  }
  // на поле дуэли еды несколько: первую рисует рендерер, остальные — простые кружки поверх
  function drawExtraFood(v) {
    if (!v.foods || v.foods.length < 2) return;
    const cv = $("dcv"), x = cv.getContext("2d"), c = renderer.cell, d = Math.min(window.devicePixelRatio || 1, 2), tt = performance.now() / 1000;
    x.save(); x.setTransform(d, 0, 0, d, 0, 0);
    for (const f of v.foods.slice(1)) {
      const cx = (f.x + 0.5) * c, cy = (f.y + 0.5) * c, r = c * 0.36 * (1 + Math.sin(tt * 5) * 0.05);
      const hg = x.createRadialGradient(cx, cy, c * 0.1, cx, cy, c * 0.7); hg.addColorStop(0, f.gold ? "rgba(255,216,76,.4)" : "rgba(255,70,100,.38)"); hg.addColorStop(1, "rgba(255,70,100,0)");
      x.fillStyle = hg; x.beginPath(); x.arc(cx, cy, c * 0.7, 0, Math.PI * 2); x.fill();
      const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 1, cx, cy, r * 1.1);
      if (f.gold) { g.addColorStop(0, "#fff6b8"); g.addColorStop(1, "#ffd84c"); } else { g.addColorStop(0, "#fff4f5"); g.addColorStop(0.3, "#ff7a90"); g.addColorStop(1, "#b0103a"); }
      x.shadowColor = f.gold ? "#ffd84c" : "#ff244f"; x.shadowBlur = 12; x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      x.shadowBlur = 0; x.fillStyle = "#72ffad"; x.beginPath(); x.ellipse(cx + r * 0.4, cy - r * 0.95, r * 0.32, r * 0.14, -0.45, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }
  function hud() {
    if (!st) return;
    $("dMeScore").textContent = st.sc[you]; $("dOppScore").textContent = st.sc[1 - you];
    const sec = Math.ceil((st.left * stepMs) / 1000);
    $("dTimer").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    $("dStatus").textContent = !st.alive[you] ? "💥" : st.sc[you] > st.sc[1 - you] ? t("ты длиннее") : st.sc[you] < st.sc[1 - you] ? t("соперник длиннее") : t("поровну");
  }
  function turn(d) {
    if (status !== "play" || !st || !st.alive[you]) return;
    if (d === lastDir) return;
    lastDir = d; send({ t: "d", d }); A().haptic("light");
  }
  function showEnd(m) {
    endMsg = m; status = "end";
    const win = m.winner === you, draw = m.winner === -1;
    $("doEmoji").textContent = draw ? "🤝" : win ? "🏆" : "💥";
    $("doTitle").textContent = t(draw ? "Ничья!" : win ? "Победа!" : "Поражение");
    $("doSub").textContent = m.reason === "time" ? t("Время вышло — побеждает более длинная змейка") : m.reason === "left" || m.reason === "conn" ? (win ? t("Соперник вышел из боя") : t("Связь потеряна")) : "";
    $("doMe").textContent = m.sc[you]; $("doOpp").textContent = m.sc[1 - you]; $("doOppName").textContent = players[1 - you]?.name || t("Соперник"); $("doReward").textContent = m.reward || 0;
    $("doRematch").disabled = m.reason === "left" || m.reason === "conn"; $("doRematch").textContent = "🔄 " + t("Реванш");
    setTimeout(() => $("duelOver").classList.add("show"), 900);
    if (win) A().sfx.claim(); else A().sfx.over();
    A().api("/api/me").then((d) => { if (d?.player) A().merge(d.player); });
  }
  function exitGame() {
    cancelAnimationFrame(raf); endMsg = null;
    $("duelOver").classList.remove("show"); $("duelGame").classList.remove("active");
    if (status === "play" || status === "end") send({ t: "leave" });
    status = "idle"; room = null; A().show("duel");
  }
  $("doMenu").addEventListener("click", exitGame);
  $("dLeave").addEventListener("click", async () => { if (status !== "play" || (await A().confirmBox(t("Выйти из боя? Это поражение."), t("Выйти"), t("Играть дальше")))) exitGame(); });
  $("doRematch").addEventListener("click", () => { $("doRematch").disabled = true; $("doRematch").textContent = "⏳ " + t("Ждём соперника…"); send({ t: "rematch" }); });

  // управление: свайп, стрелки, кнопки
  const game = $("duelGame");
  let tracking = false, tx = 0, ty = 0;
  game.addEventListener("touchstart", (e) => { if (e.target.closest("button")) return; const p = e.changedTouches[0]; tx = p.clientX; ty = p.clientY; tracking = true; }, { passive: true });
  game.addEventListener("touchmove", (e) => {
    if (!tracking) return; e.preventDefault();
    const p = e.changedTouches[0], dx = p.clientX - tx, dy = p.clientY - ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0)); tx = p.clientX; ty = p.clientY;
  }, { passive: false });
  game.addEventListener("touchend", () => { tracking = false; }, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (!game.classList.contains("active")) return;
    const k = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 }[e.key.toLowerCase()];
    if (k !== undefined) { e.preventDefault(); e.stopPropagation(); turn(k); }
  }, true);
  document.querySelectorAll("#ddpad button").forEach((b) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); turn(Number(b.dataset.d)); }));
  $("dPadBtn").addEventListener("click", () => { game.classList.toggle("dpad-on"); requestAnimationFrame(() => renderer && renderer.resize()); });
  window.addEventListener("resize", () => { if (game.classList.contains("active") && renderer) renderer.resize(); });

  SA.duel = { render };
  // ссылка-приглашение на дуэль: сразу подключаемся к комнате
  if (SA.startLinks.duel && !joinTried) {
    joinTried = true;
    setTimeout(async () => {
      const r = await A().api("/api/duel/" + SA.startLinks.duel);
      A().show("duel");
      if (!r?.ok) return A().toast("Дуэль уже недоступна");
      A().toast(`⚔️ ${r.host} ${t("зовёт тебя на дуэль!")}`);
      status = "connecting"; render(); send({ t: "join", id: SA.startLinks.duel });
    }, 600);
  }
})();
