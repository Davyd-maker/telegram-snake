// Отрисовка поля и змейки на canvas. Не знает правил игры: получает «вид» (view) — снимок состояния —
// и рисует его. Один и тот же рендерер используется для игры, реплеев и превью скинов в магазине.
(function () {
  "use strict";
  const SA = (window.SA = window.SA || {});
  const { FIELD_STYLE, SKIN_COLORS, EPIC, mix, hex2rgb } = SA;
  const easeBack = (t) => { const c = 1.70158; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

  // Chaikin: срезает углы ломаной — повороты змейки получаются плавными дугами
  function chaikin(pts, iter) {
    let a = pts;
    for (let k = 0; k < iter && a.length > 2; k++) {
      const b = [a[0]];
      for (let i = 0; i < a.length - 1; i++) {
        const p0 = a[i], p1 = a[i + 1];
        b.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 }, { x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
      }
      b.push(a[a.length - 1]); a = b;
    }
    return a;
  }

  SA.createRenderer = function (canvas, opts = {}) {
    const N = opts.N || 24;
    const mainCtx = canvas.getContext("2d", { alpha: false });
    let ctx = mainCtx, layerc = null, layerx = null, bgc = null, dprV = 1;
    let cell = 30, side = 0, fieldName = "", fieldFx = [];
    let particles = [], floaters = [], eaten = [], bulges = [], rings = [], sparks = [];
    let shakeUntil = 0, shakePow = 0, flashUntil = 0, flashColor = "255,60,80", lightSprite = null, rockSprite = null;
    const headDir = { x: 1, y: 0 };
    let v = null; // текущий вид

    const fieldStyle = () => FIELD_STYLE[fieldName] || FIELD_STYLE.classic;

    function resize(px) {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      side = px || Math.max(120, Math.floor(Math.min(rect.width, rect.height)));
      canvas.width = Math.floor(side * dpr); canvas.height = Math.floor(side * dpr);
      cell = side / N; mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0); buildBg(dpr);
    }
    function setField(id) {
      const f = FIELD_STYLE[id] ? id : "classic";
      if (f === fieldName) return;
      fieldName = f;
      const S = fieldStyle(); canvas.style.background = S.bg; canvas.style.borderColor = S.border;
      if (side) buildBg(dprV);
    }

    // Фон рисуется один раз и кэшируется (зависит от выбранного поля)
    function buildBg(dpr) {
      dprV = dpr;
      layerc = document.createElement("canvas"); layerc.width = layerc.height = Math.floor(side * dpr); layerx = layerc.getContext("2d");
      bgc = document.createElement("canvas"); bgc.width = bgc.height = Math.floor(side * dpr);
      const b = bgc.getContext("2d"); b.setTransform(dpr, 0, 0, dpr, 0, 0);
      const S = fieldStyle();
      b.fillStyle = S.bg; b.fillRect(0, 0, side, side);
      b.fillStyle = S.chk;
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if ((x + y) % 2 === 0) b.fillRect(x * cell, y * cell, cell, cell);
      if (S.grid) {
        b.strokeStyle = S.grid; b.lineWidth = 1; b.beginPath();
        for (let i = 0; i <= N; i++) { b.moveTo(i * cell, 0); b.lineTo(i * cell, side); b.moveTo(0, i * cell); b.lineTo(side, i * cell); }
        b.stroke();
      }
      const g = b.createRadialGradient(side * 0.5, side * 0.42, 8, side * 0.5, side * 0.5, side * 0.78);
      g.addColorStop(0, S.g0); g.addColorStop(0.6, S.g1); g.addColorStop(1, "rgba(0,0,0,.35)");
      b.fillStyle = g; b.fillRect(0, 0, side, side);
      // свет вокруг головы — заранее нарисованный спрайт (дёшево для телефонов)
      lightSprite = document.createElement("canvas"); const L = Math.ceil(cell * 7); lightSprite.width = lightSprite.height = L;
      const lx = lightSprite.getContext("2d"), lg = lx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
      lg.addColorStop(0, "rgba(255,255,255,.16)"); lg.addColorStop(0.45, "rgba(255,255,255,.05)"); lg.addColorStop(1, "rgba(255,255,255,0)");
      lx.fillStyle = lg; lx.fillRect(0, 0, L, L);
      rockSprite = makeRock(Math.ceil(cell * dpr));
      fieldFx = [];
      if (S.fx === "stars" || S.fx === "snow") {
        let seed = S.fx === "stars" ? 7 : 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const cnt = S.fx === "stars" ? 46 : 34;
        for (let i = 0; i < cnt; i++) fieldFx.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.1, ph: rnd() * 6.28, sp: 0.03 + rnd() * 0.05 });
      }
    }

    function drawFieldFx(now) {
      const S = fieldStyle(); if (!S.fx) return;
      const t = now / 1000;
      ctx.save();
      if (S.fx === "stars") {
        ctx.fillStyle = "#fff";
        for (const q of fieldFx) {
          ctx.globalAlpha = (0.25 + 0.75 * Math.max(0, Math.sin(t * 1.6 + q.ph))) * 0.9;
          ctx.beginPath(); ctx.arc(q.x * side, q.y * side, q.r * cell * 0.05, 0, Math.PI * 2); ctx.fill();
        }
      } else if (S.fx === "snow") {
        ctx.fillStyle = "#fff";
        for (const q of fieldFx) {
          const y = ((q.y + t * q.sp) % 1) * side, x = (q.x + Math.sin(t * q.sp * 8 + q.ph) * 0.012) * side;
          ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(x, y, q.r * cell * 0.05, 0, Math.PI * 2); ctx.fill();
        }
      } else if (S.fx === "lava") {
        const k = 0.16 + 0.08 * Math.sin(t * 1.8), g = ctx.createLinearGradient(0, side, 0, side * 0.55);
        g.addColorStop(0, `rgba(255,80,20,${k})`); g.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = g; ctx.fillRect(0, side * 0.55, side, side * 0.45);
      } else if (S.fx === "neon") {
        const y = ((t * 0.12) % 1.2 - 0.1) * side, h2 = cell * 3, g = ctx.createLinearGradient(0, y - h2, 0, y + h2);
        g.addColorStop(0, "rgba(0,230,255,0)"); g.addColorStop(0.5, "rgba(0,230,255,.10)"); g.addColorStop(1, "rgba(0,230,255,0)");
        ctx.fillStyle = g; ctx.fillRect(0, y - h2, side, h2 * 2);
      }
      ctx.restore();
    }

    // ---- камни: объёмный спрайт (градиент, блик, трещина), рисуется один раз на размер клетки ----
    function makeRock(px) {
      const c = document.createElement("canvas"); c.width = c.height = px; const g = c.getContext("2d");
      const pad = px * 0.07, r = px * 0.26, w = px - pad * 2;
      const shape = () => { g.beginPath(); g.roundRect ? g.roundRect(pad, pad, w, w, r) : g.rect(pad, pad, w, w); };
      g.fillStyle = "rgba(0,0,0,.45)"; g.save(); g.translate(px * 0.04, px * 0.07); shape(); g.fill(); g.restore();
      const gr = g.createLinearGradient(pad, pad, px - pad, px - pad); gr.addColorStop(0, "#a9b6ba"); gr.addColorStop(0.5, "#6b787d"); gr.addColorStop(1, "#343d41");
      shape(); g.fillStyle = gr; g.fill();
      const hi = g.createRadialGradient(px * 0.35, px * 0.3, 1, px * 0.35, px * 0.3, px * 0.42); hi.addColorStop(0, "rgba(255,255,255,.45)"); hi.addColorStop(1, "rgba(255,255,255,0)");
      shape(); g.fillStyle = hi; g.fill();
      g.strokeStyle = "rgba(20,26,28,.55)"; g.lineWidth = px * 0.035; g.lineCap = "round";
      g.beginPath(); g.moveTo(px * 0.58, px * 0.22); g.lineTo(px * 0.5, px * 0.44); g.lineTo(px * 0.62, px * 0.6); g.stroke();
      shape(); g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = px * 0.03; g.stroke();
      return c;
    }
    function rockAt(x, y, alpha, warn) {
      if (!warn && rockSprite) { ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(rockSprite, x * cell, y * cell, cell, cell); ctx.restore(); return; }
      const px = x * cell, py = y * cell, pad = cell * 0.08, r = cell * 0.22;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px + pad, py + pad, cell - pad * 2, cell - pad * 2, r) : ctx.rect(px + pad, py + pad, cell - pad * 2, cell - pad * 2);
      if (warn) { ctx.strokeStyle = "#ff8a4c"; ctx.lineWidth = cell * 0.08; ctx.setLineDash([cell * 0.18, cell * 0.12]); ctx.stroke(); }
      else {
        const g = ctx.createLinearGradient(px, py, px + cell, py + cell);
        g.addColorStop(0, "#8a9aa0"); g.addColorStop(1, "#3b4549");
        ctx.fillStyle = g; ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = cell * 0.2; ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = cell * 0.04; ctx.stroke();
      }
      ctx.restore();
    }
    function drawRocks(now) {
      for (const r of v.rocks || []) rockAt(r.x, r.y, 1, false);
      const blink = 0.35 + 0.45 * Math.abs(Math.sin(now / 160));
      for (const r of v.pending || []) rockAt(r.x, r.y, blink, true);
    }

    function stepAlpha(now) { return v.paused ? 1 : Math.min(1, Math.max(0, (now - v.lastTick) / v.stepMs)); }

    // Позиции сегментов между прошлым и текущим ходом — движение плавное, а не рывками
    function snakePoints(now, sn) {
      const a = stepAlpha(now), prev = sn.prevSnake || sn.snake, last = prev[prev.length - 1];
      return sn.snake.map((q, i) => {
        const o = prev[i] || last || q; let dx = q.x - o.x, dy = q.y - o.y;
        if (Math.abs(dx) > N / 2) dx -= Math.sign(dx) * N;
        if (Math.abs(dy) > N / 2) dy -= Math.sign(dy) * N;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return { x: q.x, y: q.y };
        return { x: o.x + dx * a, y: o.y + dy * a };
      });
    }

    function drawFood(now) {
      if (!v.snake.length || !v.food) return;
      let food = v.food;
      if (v.foodFrom) { // еда, которую тянет магнит, плавно едет из прошлой клетки в новую
        const k = Math.min(1, (now - v.foodFrom.t) / v.foodFrom.dur), e = 1 - (1 - k) * (1 - k);
        food = { ...v.food, x: v.foodFrom.x + (v.food.x - v.foodFrom.x) * e, y: v.foodFrom.y + (v.food.y - v.foodFrom.y) * e };
      }
      drawFoodItem(food, now, v.foodBorn || 0, 1);
      eaten = eaten.filter((e) => now - e.t < e.dur);
      for (const e of eaten) { const k = (now - e.t) / e.dur; drawFoodItem(e, now, 0, k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3)); }
    }
    function drawFoodItem(food, now, foodBorn, fade) {
      const x = (food.x + 0.5) * cell, y = (food.y + 0.5) * cell, t = now / 1000;
      const r = food.type === "apple" ? cell * 0.34 : cell * 0.3;
      const born = Math.min(1, (now - foodBorn) / 260), sc = (foodBorn ? (born < 1 ? easeBack(born) : 1) : 1) * (1 + Math.sin(t * 5) * 0.05) * fade;
      const px = Math.max(r + cell * 0.06, Math.min(side - r - cell * 0.06, x));
      const py = Math.max(r + cell * 0.06, Math.min(side - r - cell * 0.06, y + Math.sin(t * 3) * cell * 0.02));
      if (fade >= 1) {
        const hr = cell * (0.62 + 0.1 * Math.sin(t * 4)), hc = food.type === "apple" ? "255,70,100" : "255,216,76";
        const hg = ctx.createRadialGradient(px, py, cell * 0.1, px, py, hr);
        hg.addColorStop(0, `rgba(${hc},.38)`); hg.addColorStop(1, `rgba(${hc},0)`);
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(px, py, hr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(px, py); ctx.scale(sc, sc);
      if (food.type === "apple") {
        const r = cell * 0.34;
        ctx.shadowColor = "#ff244f"; ctx.shadowBlur = 16;
        ctx.fillStyle = "rgba(0,0,0,.38)"; ctx.beginPath(); ctx.arc(0, 0, r + cell * 0.055, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(-r * 0.38, -r * 0.42, 1, 0, 0, r * 1.08);
        g.addColorStop(0, "#fff4f5"); g.addColorStop(0.18, "#ff9aa8"); g.addColorStop(0.55, "#ff365d"); g.addColorStop(1, "#a4072e");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = cell * 0.025; ctx.stroke();
        ctx.strokeStyle = "#8a5b32"; ctx.lineWidth = cell * 0.045; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-r * 0.02, -r * 0.82); ctx.quadraticCurveTo(r * 0.02, -r * 1.0, r * 0.2, -r * 1.08); ctx.stroke();
        ctx.fillStyle = "#72ffad"; ctx.beginPath(); ctx.ellipse(r * 0.42, -r * 0.92, r * 0.34, r * 0.16, -0.45, 0, Math.PI * 2); ctx.fill();
      } else {
        const gold = food.type === "gold", r = cell * 0.3, c = gold ? "#ffd84c" : "#f7c531";
        ctx.globalAlpha = 0.22 + 0.1 * Math.sin(t * 4); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.shadowColor = c; ctx.shadowBlur = 24;
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
        g.addColorStop(0, "#fff6b8"); g.addColorStop(1, c);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(120,80,0,.45)"; ctx.lineWidth = cell * 0.03; ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.stroke();
        if (gold) { // вращающаяся звезда
          ctx.save(); ctx.rotate(t * 1.4); ctx.fillStyle = "#8a5a00"; ctx.beginPath();
          for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.28 : r * 0.62, a = (k * Math.PI) / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill(); ctx.restore();
        } else { ctx.fillStyle = "#8a5a00"; ctx.font = `900 ${cell * 0.3}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 1); }
      }
      ctx.restore();
    }

    function drawPowerUp(now) {
      const pu = v.pu; if (!pu || !v.PU) return;
      const d = v.PU[pu.type], left = Math.max(0, (pu.expires - v.gameTime) / v.PU_LIFE);
      if (left < 0.28 && Math.floor(now / 160) % 2) return; // мигает перед исчезновением
      const x = (pu.x + 0.5) * cell, y = (pu.y + 0.5) * cell + Math.sin(now / 300) * cell * 0.03, t = Math.min(1, (now - (pu.born || 0)) / 260), s = t < 1 ? easeBack(t) : 1;
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.shadowColor = d.color; ctx.shadowBlur = 22;
      const r = cell * 0.4, g = ctx.createRadialGradient(0, -r * 0.3, 1, 0, 0, r * 1.2); g.addColorStop(0, "#1a2f25"); g.addColorStop(1, "#07110c");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = d.color; ctx.lineWidth = cell * 0.07; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
      ctx.font = `${cell * 0.5}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.icon, 0, cell * 0.02);
      ctx.restore();
    }

    function epicFx(skin, pts, n, now, baseW) {
      ctx.save();
      if (skin === "galaxy") {
        for (let i = 1; i < n; i++) {
          const tw = Math.sin(now / 170 + i * 2.3); if (tw <= 0.5) continue; const a = (tw - 0.5) * 2;
          ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath();
          ctx.arc(pts[i].x + Math.sin(i * 5.1) * baseW * 0.22, pts[i].y + Math.cos(i * 3.7) * baseW * 0.22, cell * 0.055 * (0.6 + a * 0.6), 0, Math.PI * 2); ctx.fill();
        }
      } else if (skin === "diamond") {
        ctx.lineCap = "round";
        for (let i = 1; i < n; i++) {
          const k = Math.max(0, Math.sin(now / 260 - i * 0.7)); if (k < 0.05) continue;
          ctx.strokeStyle = `rgba(255,255,255,${k * 0.55})`; ctx.lineWidth = baseW * 0.5;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i - 1].x, pts[i - 1].y); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = cell * 0.04;
        for (let k = 0; k < 3; k++) {
          const i = Math.floor(now / 140 + (k * n) / 3) % n, q = pts[i], sz = cell * 0.24 * (0.5 + 0.5 * Math.sin(now / 90 + k * 2));
          ctx.beginPath(); ctx.moveTo(q.x - sz, q.y); ctx.lineTo(q.x + sz, q.y); ctx.moveTo(q.x, q.y - sz); ctx.lineTo(q.x, q.y + sz); ctx.stroke();
        }
      } else if (skin === "inferno") {
        if (Math.random() < 0.75) {
          const q = pts[Math.floor(Math.random() * n)];
          particles.push({ x: q.x + (Math.random() - 0.5) * baseW * 0.4, y: q.y + (Math.random() - 0.5) * baseW * 0.4, vx: (Math.random() - 0.5) * 0.5, vy: -0.3 - Math.random() * 0.6, life: 0.9, size: 1.4 + Math.random() * 2.4, type: "ember" });
        }
      }
      ctx.restore();
    }
    function weeklyFx(palette, pts, n, now, baseW) {
      ctx.save();
      for (let i = 1; i < n; i += 2) {
        const q = pts[i]; ctx.globalAlpha = 0.25 + 0.25 * Math.sin(now / 180 + i); ctx.fillStyle = palette[0];
        ctx.beginPath(); ctx.arc(q.x + Math.sin(i + now / 900) * baseW * 0.22, q.y + Math.cos(i + now / 700) * baseW * 0.22, cell * 0.055, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    const mainSnake = () => ({ snake: v.snake, prevSnake: v.prevSnake, skin: v.skin, palette: v.palette, dir: v.dir, shield: v.shield, hd: headDir, bulges: true });
    // Змейка на отдельном слое, наложенная полупрозрачно (без тёмных пятен на стыках сегментов)
    function drawLayered(now, sn, alpha) {
      if (alpha >= 1 || !layerx) { drawSnakeBody(now, sn); return; }
      ctx = layerx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, layerc.width, layerc.height); ctx.setTransform(dprV, 0, 0, dprV, 0, 0);
      drawSnakeBody(now, sn);
      ctx = mainCtx; ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(layerc, 0, 0, side, side); ctx.restore();
    }
    function drawSnake(now) {
      // призраки (соперник, свой лучший забег) — бледные, под змейкой игрока, с подписью над головой
      for (const gh of v.ghosts || []) {
        if (!gh.snake || !gh.snake.length) continue;
        gh.hd = gh.hd || { x: 1, y: 0 };
        drawLayered(now, { ...gh, bulges: false, shield: false }, gh.dead ? 0.18 : 0.38);
        const h = gh.snake[0];
        ctx.save(); ctx.font = `800 ${cell * 0.42}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.globalAlpha = 0.85; ctx.fillStyle = "#fff"; ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
        ctx.fillText((gh.dead ? "💀 " : "👻 ") + (gh.label || ""), Math.max(cell * 2, Math.min(side - cell * 2, (h.x + 0.5) * cell)), Math.max(cell * 0.6, h.y * cell - cell * 0.15));
        ctx.restore();
      }
      if (!v.snake.length) return;
      // мигание в «безопасные» секунды после старта/паузы, полупрозрачность у бонуса «призрак»
      const alpha = v.ghost ? 0.55 : v.safe ? 0.5 + 0.35 * Math.abs(Math.sin(now / 110)) : 1;
      drawLayered(now, mainSnake(), alpha);
    }

    function drawSnakeBody(now, sn) {
      const skin = sn.skin || "classic", epic = EPIC[skin];
      const palette = Array.isArray(sn.palette) && sn.palette.length === 2 ? sn.palette : null;
      const headDir = sn.hd;
      const cols = palette || SKIN_COLORS[skin] || SKIN_COLORS.classic, c0 = hex2rgb(cols[0]), c1 = hex2rgb(cols[1]);
      const colAt = (t) => (epic ? epic.color(t, now) : mix(c0, c1, t));
      const glow = epic ? epic.glow(now) : cols[1], headCol = epic ? epic.color(0, now) : cols[0];
      const pts = snakePoints(now, sn).map((q) => ({ x: (q.x + 0.5) * cell, y: (q.y + 0.5) * cell })), n = pts.length, a = stepAlpha(now);
      // «разворачиваем» тор: каждая точка — рядом с предыдущей
      for (let i = 1; i < n; i++) {
        pts[i].x -= Math.round((pts[i].x - pts[i - 1].x) / side) * side;
        pts[i].y -= Math.round((pts[i].y - pts[i - 1].y) / side) * side;
      }
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const q of pts) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; }
      // копии со сдвигом на размер поля — часть, ушедшая за край, появляется с противоположной стороны
      const offs = [], pad = cell;
      for (let kx = Math.floor((-pad - maxX) / side); kx <= Math.ceil((side + pad - minX) / side); kx++)
        for (let ky = Math.floor((-pad - maxY) / side); ky <= Math.ceil((side + pad - minY) / side); ky++) {
          if (maxX + kx * side < -pad || minX + kx * side > side + pad || maxY + ky * side < -pad || minY + ky * side > side + pad) continue;
          offs.push([kx * side, ky * side]);
        }
      if (!offs.length) offs.push([0, 0]);
      const sp = chaikin(pts, n > 50 ? 1 : 2), m = sp.length;
      const baseW = cell * 0.86;
      const H0 = sp[0], ref = sp[Math.min(m - 1, 4)]; let tx = H0.x - ref.x, ty = H0.y - ref.y; const tl = Math.hypot(tx, ty);
      if (tl > 0.01) { tx /= tl; ty /= tl; } else { tx = sn.dir ? sn.dir.x : 1; ty = sn.dir ? sn.dir.y : 0; }
      headDir.x += (tx - headDir.x) * 0.35; headDir.y += (ty - headDir.y) * 0.35;
      const hl = Math.hypot(headDir.x, headDir.y) || 1, f = { x: headDir.x / hl, y: headDir.y / hl }, pr = { x: -f.y, y: f.x };
      for (const [ox, oy] of offs) {
        ctx.save(); if (ox || oy) ctx.translate(ox, oy);
        const path = (ox = 0, oy = 0) => { ctx.beginPath(); ctx.moveTo(sp[0].x + ox, sp[0].y + oy); for (let i = 1; i < m; i++) ctx.lineTo(sp[i].x + ox, sp[i].y + oy); };
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        // тень под змейкой — придаёт объём
        ctx.save(); ctx.strokeStyle = "rgba(0,0,0,.28)"; ctx.lineWidth = baseW * 0.92; path(cell * 0.07, cell * 0.13); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.globalAlpha *= 0.5; ctx.shadowColor = glow; ctx.shadowBlur = cell * (epic ? 1.2 : 0.9); ctx.strokeStyle = glow; ctx.lineWidth = baseW * 0.7; path(); ctx.stroke(); ctx.restore();
        for (let j = m - 1; j >= 1; j--) {
          const t = j / Math.max(1, m - 1), idx = t * (n - 1);
          let bump = 0; if (sn.bulges) for (const b of bulges) bump = Math.max(bump, 1 - Math.abs(idx - (b + a)) / 1.8);
          const w = baseW * (1 - 0.4 * Math.pow(t, 1.2)) * (1 + Math.max(0, bump) * 0.32);
          ctx.strokeStyle = colAt(t); ctx.lineWidth = w;
          ctx.beginPath(); ctx.moveTo(sp[j].x, sp[j].y); ctx.lineTo(sp[j - 1].x, sp[j - 1].y); ctx.stroke();
        }
        if (epic) epicFx(skin, pts, n, now, baseW);
        if (palette) weeklyFx(palette, pts, n, now, baseW);
        ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = baseW * 0.2; path(-cell * 0.1, -cell * 0.12); ctx.stroke(); ctx.restore();
        const H = sp[0], r = baseW * 0.62;
        // щит: кольцо вокруг головы
        if (sn.shield) {
          ctx.save(); ctx.strokeStyle = "rgba(109,255,176,.85)"; ctx.lineWidth = cell * 0.07; ctx.shadowColor = "#6dffb0"; ctx.shadowBlur = cell * 0.5;
          ctx.beginPath(); ctx.arc(H.x, H.y, r * (1.45 + 0.06 * Math.sin(now / 150)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        if (now % 1600 < 280) { // язычок
          ctx.strokeStyle = "#ff4d6d"; ctx.lineWidth = cell * 0.06; const tx0 = H.x + f.x * r * 0.9, ty0 = H.y + f.y * r * 0.9, tx1 = H.x + f.x * r * 1.55, ty1 = H.y + f.y * r * 1.55;
          ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1); ctx.moveTo(tx1, ty1); ctx.lineTo(tx1 + f.x * r * 0.25 + pr.x * r * 0.25, ty1 + f.y * r * 0.25 + pr.y * r * 0.25);
          ctx.moveTo(tx1, ty1); ctx.lineTo(tx1 + f.x * r * 0.25 - pr.x * r * 0.25, ty1 + f.y * r * 0.25 - pr.y * r * 0.25); ctx.stroke();
        }
        ctx.save(); ctx.shadowColor = headCol; ctx.shadowBlur = cell * 0.5;
        const g = ctx.createRadialGradient(H.x - r * 0.3, H.y - r * 0.3, 1, H.x, H.y, r * 1.1); g.addColorStop(0, "#fff"); g.addColorStop(0.25, headCol); g.addColorStop(1, colAt(0.3));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(H.x, H.y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        for (const sd of [-1, 1]) {
          const ex = H.x + f.x * r * 0.3 + pr.x * r * 0.5 * sd, ey = H.y + f.y * r * 0.3 + pr.y * r * 0.5 * sd;
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, r * 0.27, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#08130d"; ctx.beginPath(); ctx.arc(ex + f.x * r * 0.08, ey + f.y * r * 0.08, r * 0.13, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    function drawParticles() {
      particles = particles.filter((q) => q.life > 0);
      for (const q of particles) {
        q.x += q.vx; q.y += q.vy; q.vy += q.type === "ember" ? -0.015 : 0.04; q.life -= 0.035;
        ctx.globalAlpha = Math.max(0, q.life);
        ctx.fillStyle = q.type === "ember" ? "#ff9a3c" : q.type === "gold" ? "#ffe56b" : q.type === "coin" ? "#ffd34d" : q.type === "bomb" ? "#ff8a4c" : q.type === "save" ? "#c58bff" : q.type === "die" ? "#ff6b81" : "#7dffbd";
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0, q.size * q.life), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawFloaters() {
      floaters = floaters.filter((f) => f.life > 0);
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${cell * 0.55}px system-ui`;
      for (const f of floaters) {
        f.life -= 0.022; const k = 1 - f.life;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6)); ctx.fillStyle = "#fff7c2"; ctx.shadowColor = "rgba(255,190,50,.9)"; ctx.shadowBlur = 10;
        ctx.fillText(f.text, Math.max(cell * 2, Math.min(side - cell * 2, f.x * cell)), (f.y - k * 1.4) * cell);
      }
      ctx.restore();
    }

    // Поле магнита: у бонуса — пульсирующие кольца вокруг головы; при каждом притяжении — искры от еды к голове
    function drawMagnet(now) {
      if (!v.snake.length || (!v.magnetR && !v.magnetArt)) return;
      const h = snakePoints(now, mainSnake())[0], cx = (h.x + 0.5) * cell, cy = (h.y + 0.5) * cell;
      ctx.save();
      if (v.magnetR) {
        for (let i = 0; i < 2; i++) {
          const k = ((now / 900 + i / 2) % 1), r = cell * (0.8 + k * (v.magnetR - 0.3));
          ctx.globalAlpha = 0.28 * (1 - k); ctx.strokeStyle = "#55d6ff"; ctx.lineWidth = cell * 0.06;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
      for (const s of sparks) { // искры от еды к голове
        const k = (now - s.t) / 380; if (k >= 1 || k < 0) continue;
        const x = (s.x + (s.tx - s.x) * k + 0.5) * cell, y = (s.y + (s.ty - s.y) * k + 0.5) * cell;
        ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = "#8be9ff";
        ctx.beginPath(); ctx.arc(x, y, cell * 0.08 * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      sparks = sparks.filter((s) => now - s.t < 380);
      ctx.restore();
    }
    function drawLight(now) {
      if (!lightSprite || !v.snake.length) return;
      const pts = snakePoints(now, mainSnake()), h = pts[0], L = cell * 7;
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.9;
      ctx.drawImage(lightSprite, (h.x + 0.5) * cell - L / 2, (h.y + 0.5) * cell - L / 2, L, L); ctx.restore();
    }
    function drawRings(now) {
      rings = rings.filter((r) => now - r.t < 450);
      for (const r of rings) {
        const k = (now - r.t) / 450;
        ctx.save(); ctx.globalAlpha = (1 - k) * 0.7; ctx.strokeStyle = r.color; ctx.lineWidth = cell * 0.12 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc((r.x + 0.5) * cell, (r.y + 0.5) * cell, cell * (0.4 + k * 1.6), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    }
    // золотое свечение краёв поля при большом комбо
    function drawComboGlow(now) {
      const c = v.combo || 0; if (c < 3) return;
      const k = Math.min(1, (c - 2) / 4) * (0.75 + 0.25 * Math.sin(now / 140)), w = cell * 1.6;
      ctx.save(); ctx.globalAlpha = 0.5 * k;
      for (const [x, y, ww, hh, gx0, gy0, gx1, gy1] of [[0, 0, side, w, 0, 0, 0, w], [0, side - w, side, w, 0, side, 0, side - w], [0, 0, w, side, 0, 0, w, 0], [side - w, 0, w, side, side, 0, side - w, 0]]) {
        const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1); g.addColorStop(0, "rgba(255,200,60,.9)"); g.addColorStop(1, "rgba(255,200,60,0)");
        ctx.fillStyle = g; ctx.fillRect(x, y, ww, hh);
      }
      ctx.restore();
    }

    function draw(view, now = performance.now()) {
      v = view;
      if (!side) return;
      ctx.save();
      if (now < shakeUntil) { const k = (shakeUntil - now) / 400 * shakePow; ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k); }
      if (bgc) ctx.drawImage(bgc, 0, 0, side, side); else { ctx.fillStyle = "#04100a"; ctx.fillRect(0, 0, side, side); }
      drawFieldFx(now); drawLight(now); drawRocks(now); drawMagnet(now); drawFood(now); drawPowerUp(now); drawRings(now); drawSnake(now); drawParticles(); drawFloaters(); drawComboGlow(now);
      ctx.restore();
      if (now < flashUntil) { ctx.save(); ctx.globalAlpha = ((flashUntil - now) / 350) * 0.45; ctx.fillStyle = `rgb(${flashColor})`; ctx.fillRect(0, 0, side, side); ctx.restore(); }
      if (v.countdown) { // обратный отсчёт после паузы
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, 0, side, side);
        const k = 1 - ((now - v.countdownAt) % 1000) / 1000;
        ctx.save(); ctx.fillStyle = "#f4fff9"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.max(0.2, k); ctx.font = `900 ${side * (0.18 + 0.06 * k)}px system-ui`;
        ctx.shadowColor = "rgba(85,255,173,.8)"; ctx.shadowBlur = 30; ctx.fillText(String(v.countdown), side / 2, side / 2);
        ctx.restore();
      } else if (v.paused) {
        ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, 0, side, side);
        ctx.fillStyle = "#f4fff9"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "900 30px system-ui"; ctx.fillText(SA.i18n ? SA.i18n.t("ПАУЗА") : "ПАУЗА", side / 2, side / 2 - 10);
      }
    }

    return {
      resize, setField, draw,
      get cell() { return cell; }, get side() { return side; },
      reset() { particles = []; floaters = []; eaten = []; bulges = []; headDir.x = 1; headDir.y = 0; },
      burst(x, y, type, count) {
        count = count || (type === "coin" ? 14 : 20);
        if (particles.length > 240) particles.splice(0, particles.length - 240);
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
          particles.push({ x: (x + 0.5) * cell, y: (y + 0.5) * cell, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, size: 2 + Math.random() * 4, type });
        }
      },
      floater(x, y, text) { floaters.push({ x, y, life: 1, text }); },
      magnetSpark(fx, fy, x, y) { for (let i = 0; i < 3; i++) sparks.push({ x: fx, y: fy, tx: x + (x - fx) * 0.6, ty: y + (y - fy) * 0.6, t: performance.now() + i * 60 }); },
      ring(x, y, color = "#7dffbd") { rings.push({ x, y, color, t: performance.now() }); },
      shake(pow = 10, ms = 400) { shakeUntil = performance.now() + ms; shakePow = pow; },
      flash(color = "255,60,80") { flashUntil = performance.now() + 350; flashColor = color; },
      // смерть: змейка рассыпается искрами от головы к хвосту
      die(snake) {
        snake.forEach((q, i) => setTimeout(() => this.burst(q.x, q.y, i === 0 ? "bomb" : "die", i === 0 ? 24 : 5), Math.min(600, i * 18)));
        this.shake(12, 450); this.flash();
      },
      // съеденная еда дорисовывается, пока голова доезжает до клетки; «комок» ползёт к хвосту
      eat(food, dur) { eaten.push({ x: food.x, y: food.y, type: food.type, t: performance.now(), dur }); bulges.push(-1); },
      step(len) { bulges = bulges.map((b) => b + 1).filter((b) => b < len + 1); }
    };
  };
})();
