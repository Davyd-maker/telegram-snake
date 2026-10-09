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

  SA.drawAccessoryOn = function (ctx, id, H, f, pr, r, now) {
    ctx.save();
    const ang = Math.atan2(f.y, f.x);
    if (id === "glasses" || id === "shades" || id === "mustache") {
      ctx.translate(H.x, H.y); ctx.rotate(ang + Math.PI / 2); // вперёд = вверх (−y), бока = ±x
      if (id === "mustache") {
        ctx.fillStyle = "#3b2414"; const y = -r * 0.9; ctx.scale(0.8, 0.8);
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(sd * r * 0.45, y - r * 0.3, sd * r * 0.75, y + r * 0.05); ctx.quadraticCurveTo(sd * r * 0.4, y + r * 0.02, 0, y + r * 0.12); ctx.fill(); }
      } else {
        const y = -r * 0.3, ex = r * 0.5, er = r * 0.33;
        ctx.lineWidth = r * 0.1; ctx.strokeStyle = id === "shades" ? "#111" : "#2b2b2b";
        for (const sd of [-1, 1]) {
          ctx.beginPath(); ctx.arc(sd * ex, y, er, 0, Math.PI * 2);
          if (id === "shades") { ctx.fillStyle = "rgba(10,10,20,.92)"; ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(sd * ex - er * 0.5, y - er * 0.5, er * 0.4, er * 0.2); }
          else { ctx.fillStyle = "rgba(200,230,255,.18)"; ctx.fill(); }
          ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(-ex + er, y); ctx.lineTo(ex - er, y); ctx.stroke();
      }
      ctx.restore(); return;
    }
    // шапки стоят вертикально, но при движении вбок сдвигаются к затылку и чуть наклоняются назад,
    // чтобы не наезжать на верхний глаз (глаза при движении вбок — сверху и снизу головы)
    const w = r * 1.2, side = f.x;
    ctx.translate(H.x - side * r * 0.5, H.y - r * (0.55 - Math.abs(side) * 0.12)); ctx.rotate(-side * 0.32);
    if (side < -0.3) ctx.scale(-1, 1); // ползёт влево — козырёк и украшения смотрят влево
    if (id === "crown") {
      const g = ctx.createLinearGradient(0, -w * 0.8, 0, 0); g.addColorStop(0, "#fff3a0"); g.addColorStop(1, "#e0a000");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w * 0.55, 0); ctx.lineTo(-w * 0.6, -w * 0.55); ctx.lineTo(-w * 0.3, -w * 0.3); ctx.lineTo(0, -w * 0.75); ctx.lineTo(w * 0.3, -w * 0.3); ctx.lineTo(w * 0.6, -w * 0.55); ctx.lineTo(w * 0.55, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9a6a00"; ctx.lineWidth = r * 0.06; ctx.stroke();
      for (const [cx2, c] of [[-w * 0.3, "#ff3b6b"], [0, "#3bd1ff"], [w * 0.3, "#5dff8a"]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx2, -w * 0.14, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
    } else if (id === "tophat") {
      ctx.fillStyle = "#15151c"; ctx.fillRect(-w * 0.62, -w * 0.12, w * 1.24, w * 0.14); ctx.fillRect(-w * 0.38, -w * 0.9, w * 0.76, w * 0.8);
      ctx.fillStyle = "#d4204a"; ctx.fillRect(-w * 0.38, -w * 0.3, w * 0.76, w * 0.14);
      ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(-w * 0.3, -w * 0.85, w * 0.12, w * 0.5);
    } else if (id === "cap") {
      ctx.fillStyle = "#2f7bff"; ctx.beginPath(); ctx.arc(0, 0, w * 0.5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#1d55c4"; ctx.beginPath(); ctx.ellipse(w * 0.45, -w * 0.02, w * 0.38, w * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -w * 0.5, w * 0.07, 0, Math.PI * 2); ctx.fill();
    } else if (id === "party") {
      ctx.save(); ctx.rotate(-0.2);
      ctx.fillStyle = "#ff4fa3"; ctx.beginPath(); ctx.moveTo(-w * 0.38, 0); ctx.lineTo(0, -w * 1.05); ctx.lineTo(w * 0.38, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(-w * 0.25, -w * 0.3); ctx.lineTo(w * 0.15, -w * 0.45); ctx.moveTo(-w * 0.12, -w * 0.65); ctx.lineTo(w * 0.1, -w * 0.72); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -w * 1.05, w * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else if (id === "bow") {
      ctx.fillStyle = "#ff3d7f";
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, -w * 0.2); ctx.quadraticCurveTo(sd * w * 0.6, -w * 0.75, sd * w * 0.55, -w * 0.05); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#c41a55"; ctx.beginPath(); ctx.arc(0, -w * 0.2, w * 0.13, 0, Math.PI * 2); ctx.fill();
    } else if (id === "halo") {
      ctx.save(); ctx.shadowColor = "#fff6a0"; ctx.shadowBlur = r * 0.8; ctx.strokeStyle = "#ffe97a"; ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.ellipse(0, -w * 0.45 + Math.sin(now / 300) * r * 0.06, w * 0.5, w * 0.16, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else if (id === "horns") {
      ctx.fillStyle = "#e23a2a";
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * w * 0.2, 0); ctx.quadraticCurveTo(sd * w * 0.55, -w * 0.25, sd * w * 0.5, -w * 0.75); ctx.quadraticCurveTo(sd * w * 0.32, -w * 0.3, sd * w * 0.48, 0); ctx.closePath(); ctx.fill(); }
    } else if (id === "headphones") {
      ctx.strokeStyle = "#2a2a35"; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.arc(0, w * 0.15, w * 0.62, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      for (const sd of [-1, 1]) { ctx.fillStyle = "#ff4f6b"; ctx.beginPath(); ctx.ellipse(sd * w * 0.62, w * 0.1, w * 0.16, w * 0.24, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (id === "witch") { // шляпа ведьмы: широкие поля и загнутый конус
      ctx.fillStyle = "#2b1840"; ctx.beginPath(); ctx.ellipse(0, -w * 0.02, w * 0.72, w * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w * 0.38, -w * 0.08); ctx.quadraticCurveTo(-w * 0.1, -w * 0.7, w * 0.3, -w * 1.1); ctx.quadraticCurveTo(w * 0.12, -w * 0.62, w * 0.38, -w * 0.08); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ff8a1a"; ctx.fillRect(-w * 0.36, -w * 0.24, w * 0.72, w * 0.12);
      ctx.fillStyle = "#ffd84c"; ctx.fillRect(-w * 0.06, -w * 0.25, w * 0.12, w * 0.14);
    } else if (id === "flower") {
      ctx.translate(w * 0.35, -w * 0.15); ctx.rotate(now / 1500);
      ctx.fillStyle = "#fff"; for (let k = 0; k < 5; k++) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.ellipse(0, -w * 0.2, w * 0.12, w * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#ffcc33"; ctx.beginPath(); ctx.arc(0, 0, w * 0.12, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  SA.createRenderer = function (canvas, opts = {}) {
    const N = opts.N || 24;
    const mainCtx = canvas.getContext("2d", { alpha: false });
    let ctx = mainCtx, layerc = null, layerx = null, bgc = null, dprV = 1;
    let cell = 30, side = 0, fieldName = "", fieldFx = [];
    let particles = [], floaters = [], eaten = [], bulges = [], rings = [], sparks = [];
    let shakeUntil = 0, shakePow = 0, flashUntil = 0, flashColor = "255,60,80", lightSprite = null, rockSprite = null;
    let lastEat = -1e9, iris = null, trailAt = 0, darkc = null;
    const headDir = { x: 1, y: 0 }, rivalDir = { x: 1, y: 0 };
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
      if (S.fx === "stars" || S.fx === "snow" || S.fx === "rain" || S.fx === "leaves" || S.fx === "night" || S.fx === "spooky") {
        let seed = { stars: 7, snow: 13, rain: 21, leaves: 33, night: 41, spooky: 57 }[S.fx]; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const cnt = { stars: 46, snow: 34, rain: 60, leaves: 16, night: 30, spooky: 9 }[S.fx];
        for (let i = 0; i < cnt; i++) fieldFx.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.1, ph: rnd() * 6.28, sp: 0.03 + rnd() * 0.05, c: Math.floor(rnd() * 3) });
      }
      // «Ночь Хэллоуина»: луна и силуэты надгробий — в кэш фона
      if (S.fx === "spooky") {
        const mx = side * 0.8, my = side * 0.17, mr = cell * 2.1;
        const mg = b.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 2.6); mg.addColorStop(0, "rgba(255,230,160,.35)"); mg.addColorStop(1, "rgba(255,230,160,0)");
        b.fillStyle = mg; b.beginPath(); b.arc(mx, my, mr * 2.6, 0, Math.PI * 2); b.fill();
        b.fillStyle = "rgba(255,236,170,.55)"; b.beginPath(); b.arc(mx, my, mr, 0, Math.PI * 2); b.fill();
        b.fillStyle = S.bg; b.beginPath(); b.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.9, 0, Math.PI * 2); b.fill();
        b.fillStyle = "rgba(10,4,20,.55)";
        for (const [gx, gw] of [[0.08, 1.1], [0.28, 0.9], [0.62, 1.2], [0.9, 0.8]]) {
          const x = side * gx, y = side - cell * 0.1, w = cell * gw;
          b.beginPath(); b.moveTo(x - w / 2, y); b.lineTo(x - w / 2, y - w * 0.9); b.arc(x, y - w * 0.9, w / 2, Math.PI, 0); b.lineTo(x + w / 2, y); b.fill();
        }
      }
      // лужи на «Дожде» и мох на «Осени» — в кэш фона
      if (S.fx === "rain" || S.fx === "leaves") {
        let seed = 77; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 9; i++) {
          const x = rnd() * side, y = rnd() * side, rw = cell * (1 + rnd() * 1.6);
          b.fillStyle = S.fx === "rain" ? "rgba(120,170,220,.07)" : "rgba(255,150,40,.06)";
          b.beginPath(); b.ellipse(x, y, rw, rw * 0.55, rnd() * 3, 0, Math.PI * 2); b.fill();
        }
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
      } else if (S.fx === "rain") { // косые капли и круги на «лужах»
        ctx.strokeStyle = "rgba(170,210,255,.35)"; ctx.lineWidth = Math.max(1, cell * 0.04); ctx.lineCap = "round"; ctx.beginPath();
        for (const q of fieldFx) {
          const y = ((q.y + t * (0.9 + q.sp * 6)) % 1.1 - 0.05) * side, x = ((q.x + t * 0.12) % 1) * side, l = cell * (0.5 + q.r * 0.3);
          ctx.moveTo(x, y); ctx.lineTo(x - l * 0.25, y - l);
        }
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const q = fieldFx[i], k = (t * 0.9 + q.ph) % 1;
          ctx.globalAlpha = 0.4 * (1 - k); ctx.beginPath(); ctx.ellipse(q.y * side, q.x * side, cell * 0.7 * k, cell * 0.35 * k, 0, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (S.fx === "leaves") { // кружащиеся листья
        const cols = ["#ffb347", "#e8642c", "#c9a227"];
        for (const q of fieldFx) {
          const y = ((q.y + t * q.sp * 1.4) % 1.1 - 0.05) * side, x = (q.x + Math.sin(t * 0.9 + q.ph) * 0.04) * side, a = t * 1.5 + q.ph;
          ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(1, Math.abs(Math.cos(a * 0.7)) * 0.7 + 0.3);
          ctx.globalAlpha = 0.75; ctx.fillStyle = cols[q.c];
          ctx.beginPath(); ctx.ellipse(0, 0, cell * 0.22 * q.r, cell * 0.11 * q.r, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(90,40,0,.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-cell * 0.2 * q.r, 0); ctx.lineTo(cell * 0.2 * q.r, 0); ctx.stroke();
          ctx.restore();
        }
      } else if (S.fx === "night") { // светлячки
        for (const q of fieldFx) {
          const x = (q.x + Math.sin(t * q.sp * 9 + q.ph) * 0.03) * side, y = (q.y + Math.cos(t * q.sp * 7 + q.ph) * 0.03) * side;
          ctx.globalAlpha = Math.max(0, Math.sin(t * 2 + q.ph)) * 0.9; ctx.fillStyle = "#e9ff8a";
          ctx.beginPath(); ctx.arc(x, y, cell * 0.06, 0, Math.PI * 2); ctx.fill();
        }
      } else if (S.fx === "spooky") { // туман и летучие мыши
        for (let i = 0; i < 3; i++) {
          const x = ((t * (0.02 + i * 0.01) + i * 0.37) % 1.4 - 0.2) * side, y = side * (0.55 + i * 0.15);
          const g = ctx.createRadialGradient(x, y, 1, x, y, cell * 6); g.addColorStop(0, "rgba(190,170,255,.10)"); g.addColorStop(1, "rgba(190,170,255,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, cell * 7, cell * 2.6, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "rgba(20,8,30,.85)";
        for (const q of fieldFx) {
          const x = ((q.x + t * q.sp * 1.3) % 1.2 - 0.1) * side, y = (q.y * 0.6 + 0.05 + Math.sin(t * 1.7 + q.ph) * 0.03) * side, f = Math.sin(t * 14 + q.ph), w = cell * 0.45 * q.r;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - w * 0.5, y - w * 0.6 * f, x - w, y - w * 0.15 * f); ctx.quadraticCurveTo(x - w * 0.5, y + w * 0.1, x, y + w * 0.15);
          ctx.quadraticCurveTo(x + w * 0.5, y + w * 0.1, x + w, y - w * 0.15 * f); ctx.quadraticCurveTo(x + w * 0.5, y - w * 0.6 * f, x, y); ctx.fill();
        }
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

    // ---- уровни: ворота и норка ----
    function drawGates(now) {
      for (const g of v.gates || []) {
        const px = g.x * cell, py = g.y * cell;
        ctx.save();
        if (g.closed) { // закрытые ворота — металлические прутья
          ctx.fillStyle = "#2a3238"; ctx.fillRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88);
          ctx.strokeStyle = "#9fb3bd"; ctx.lineWidth = cell * 0.1;
          for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(px + (cell * i) / 4, py + cell * 0.1); ctx.lineTo(px + (cell * i) / 4, py + cell * 0.9); ctx.stroke(); }
          ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = cell * 0.04; ctx.strokeRect(px + cell * 0.08, py + cell * 0.08, cell * 0.84, cell * 0.84);
        } else { // открытые — пунктир; перед закрытием мигают оранжевым
          const warn = g.warn && Math.floor(now / 150) % 2 === 0;
          ctx.strokeStyle = warn ? "rgba(255,150,60,.95)" : "rgba(159,179,189,.35)"; ctx.lineWidth = cell * (warn ? 0.09 : 0.05);
          ctx.setLineDash([cell * 0.16, cell * 0.12]); ctx.strokeRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76);
        }
        ctx.restore();
      }
    }
    function drawHole(now) {
      const h = v.hole; if (!h) return;
      const cx = (h.x + 0.5) * cell, cy = (h.y + 0.5) * cell, t = now / 1000;
      ctx.save();
      // свечение-приглашение
      const r = cell * (1.1 + 0.15 * Math.sin(t * 4));
      const gl = ctx.createRadialGradient(cx, cy, cell * 0.2, cx, cy, r);
      gl.addColorStop(0, "rgba(255,216,76,.45)"); gl.addColorStop(1, "rgba(255,216,76,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // сама норка — тёмная яма с земляным краем
      ctx.fillStyle = "#5a3a1c"; ctx.beginPath(); ctx.ellipse(cx, cy, cell * 0.46, cell * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      const pit = ctx.createRadialGradient(cx, cy + cell * 0.04, 1, cx, cy, cell * 0.36);
      pit.addColorStop(0, "#000"); pit.addColorStop(0.7, "#0b0603"); pit.addColorStop(1, "#2b1a0b");
      ctx.fillStyle = pit; ctx.beginPath(); ctx.ellipse(cx, cy + cell * 0.03, cell * 0.36, cell * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      // вращающийся вихрь
      ctx.strokeStyle = "rgba(255,216,76,.55)"; ctx.lineWidth = cell * 0.04;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, cell * (0.12 + i * 0.08), t * 3 + i * 2, t * 3 + i * 2 + Math.PI * 0.9); ctx.stroke(); }
      ctx.restore();
    }

    // бонус «Портал»: два фиолетовых вихря
    function drawPortals(now) {
      if (!v.portals) return;
      const t = now / 1000;
      v.portals.forEach((c, i) => {
        const cx = (c.x + 0.5) * cell, cy = (c.y + 0.5) * cell;
        ctx.save(); ctx.translate(cx, cy);
        const gl = ctx.createRadialGradient(0, 0, 1, 0, 0, cell * 0.9);
        gl.addColorStop(0, "rgba(40,0,80,.95)"); gl.addColorStop(0.55, "rgba(176,124,255,.55)"); gl.addColorStop(1, "rgba(176,124,255,0)");
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, cell * 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.rotate((i ? -1 : 1) * t * 4); ctx.strokeStyle = "rgba(230,200,255,.85)"; ctx.lineWidth = cell * 0.05; ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, cell * (0.16 + k * 0.1), k * 2.1, k * 2.1 + Math.PI * 1.1); ctx.stroke(); }
        ctx.restore();
      });
    }
    function drawShrinkWarn(now) {
      const list = v.shrinkWarn; if (!list || !list.length) return;
      const blink = 0.35 + 0.45 * Math.abs(Math.sin(now / 130));
      for (const c of list) rockAt(c.x, c.y, blink, true);
    }
    // босс «Змей-вор»: тёмная змейка в полосатой маске; оглушённый — со звёздочками над головой
    function drawRival(now) {
      const r = v.rival; if (!r || !r.snake.length) return;
      drawLayered(now, { snake: r.snake, prevSnake: r.prevSnake, skin: "thief", dir: r.dir, hd: rivalDir, mask: true, stun: r.stun }, r.stun ? 0.65 : 1);
      if (r.stun) {
        const h = r.snake[0], cx = (h.x + 0.5) * cell, cy = (h.y + 0.5) * cell, t = now / 300;
        ctx.save(); ctx.font = `${cell * 0.38}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (let k = 0; k < 3; k++) { const a = t + (k * Math.PI * 2) / 3; ctx.fillText("⭐", cx + Math.cos(a) * cell * 0.55, cy - cell * 0.55 + Math.sin(a) * cell * 0.18); }
        ctx.restore();
      }
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
      if (food.type === "apple" && food.fruit) drawFruit(food.fruit, t);
      else if (food.type === "apple") {
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

    // разные фрукты вместо одинаковых яблок (на очки не влияет — только внешний вид)
    function drawFruit(kind, t) {
      const r = cell * 0.32;
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(cell * 0.04, r * 0.95, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      const ball = (x, y, rr, c0, c1, c2) => { const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.4, 1, x, y, rr * 1.05); g.addColorStop(0, c0); g.addColorStop(0.35, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); };
      const stem = (x0, y0, x1, y1) => { ctx.strokeStyle = "#6b4a22"; ctx.lineWidth = cell * 0.045; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + r * 0.2, Math.min(y0, y1) - r * 0.2, x1, y1); ctx.stroke(); };
      const leaf = (x, y, a, s = 1) => { ctx.fillStyle = "#5fe08a"; ctx.beginPath(); ctx.ellipse(x, y, r * 0.34 * s, r * 0.15 * s, a, 0, Math.PI * 2); ctx.fill(); };
      ctx.shadowColor = "rgba(255,80,120,.8)"; ctx.shadowBlur = 12;
      if (kind === 6) { // тыква (Хэллоуин)
        ctx.shadowColor = "rgba(255,140,30,.9)";
        for (const [ox, rw] of [[-0.42, 0.55], [0.42, 0.55], [0, 0.62]]) { const g = ctx.createRadialGradient(ox * r - r * 0.2, -r * 0.3, 1, ox * r, r * 0.05, r * 1.0); g.addColorStop(0, "#ffd08a"); g.addColorStop(0.45, "#ff8a1a"); g.addColorStop(1, "#a83e00"); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ox * r, r * 0.08, r * rw, r * 0.82, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.shadowBlur = 0; ctx.fillStyle = "#3b6b1f"; ctx.fillRect(-r * 0.09, -r * 0.95, r * 0.18, r * 0.3);
        ctx.fillStyle = "#2a0d00"; // рожица
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * r * 0.42, -r * 0.12); ctx.lineTo(sd * r * 0.18, -r * 0.12); ctx.lineTo(sd * r * 0.3, -r * 0.34); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(-r * 0.45, r * 0.22); ctx.quadraticCurveTo(0, r * 0.62, r * 0.45, r * 0.22); ctx.lineTo(r * 0.2, r * 0.3); ctx.lineTo(0, r * 0.2); ctx.lineTo(-r * 0.2, r * 0.3); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; return;
      }
      if (kind === 7) { // конфета в фантике
        ctx.save(); ctx.rotate(-0.4 + Math.sin(t * 3) * 0.08);
        ctx.fillStyle = "#c13cff"; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * r * 0.5, 0); ctx.lineTo(sd * r * 1.05, -r * 0.42); ctx.lineTo(sd * r * 1.05, r * 0.42); ctx.closePath(); ctx.fill(); }
        const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r * 0.6); g.addColorStop(0, "#ffe0ff"); g.addColorStop(1, "#ff3db8");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.3); ctx.lineTo(r * 0.1, r * 0.35); ctx.moveTo(r * 0.05, -r * 0.4); ctx.lineTo(r * 0.38, r * 0.15); ctx.stroke();
        ctx.restore(); ctx.shadowBlur = 0; return;
      }
      if (kind === 1) { // вишня
        stem(-r * 0.45, r * 0.15, r * 0.1, -r * 0.95); stem(r * 0.45, r * 0.25, r * 0.1, -r * 0.95); leaf(r * 0.35, -r * 0.95, -0.4);
        ball(-r * 0.45, r * 0.3, r * 0.52, "#ffd6dc", "#ff2d55", "#7a0018"); ball(r * 0.45, r * 0.4, r * 0.52, "#ffd6dc", "#ff2d55", "#7a0018");
      } else if (kind === 2) { // клубника
        ctx.save(); ctx.translate(0, r * 0.1);
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r * 1.1); g.addColorStop(0, "#ffb3b8"); g.addColorStop(0.4, "#ff3348"); g.addColorStop(1, "#99001a");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, r * 1.0); ctx.bezierCurveTo(-r * 1.25, r * 0.2, -r * 0.9, -r * 0.85, 0, -r * 0.7); ctx.bezierCurveTo(r * 0.9, -r * 0.85, r * 1.25, r * 0.2, 0, r * 1.0); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = "#ffe98a";
        for (const [sx, sy] of [[-0.4, -0.2], [0.1, -0.35], [0.45, -0.1], [-0.2, 0.2], [0.25, 0.3], [-0.45, 0.35], [0, 0.6]]) { ctx.beginPath(); ctx.ellipse(sx * r, sy * r, r * 0.05, r * 0.08, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "#3ccf6e"; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(Math.cos(k * 1.26 - 1.57) * r * 0.25, -r * 0.72 + Math.sin(k * 1.26 - 1.57) * r * 0.12, r * 0.28, r * 0.09, k * 1.26 - 1.57, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else if (kind === 3) { // виноград
        stem(0, -r * 0.6, r * 0.2, -r * 1.05); leaf(-r * 0.3, -r * 0.85, 0.5);
        for (const [gx, gy] of [[-0.42, -0.35], [0, -0.38], [0.42, -0.35], [-0.22, 0.05], [0.22, 0.05], [0, 0.45]]) ball(gx * r, gy * r + r * 0.15, r * 0.32, "#f0d8ff", "#a64dff", "#3d0a73");
      } else if (kind === 4) { // долька арбуза
        ctx.save(); ctx.translate(0, -r * 0.25);
        ctx.fillStyle = "#1f8a3a"; ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0.05, Math.PI - 0.05); ctx.fill();
        ctx.fillStyle = "#e8ffd8"; ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0.05, Math.PI - 0.05); ctx.fill();
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 0.85); g.addColorStop(0, "#ff8a9a"); g.addColorStop(1, "#ff2d4f");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0.05, Math.PI - 0.05); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = "#2a1208";
        for (const [sx, sy] of [[-0.4, 0.25], [0, 0.45], [0.4, 0.25], [-0.15, 0.2], [0.2, 0.6]]) { ctx.beginPath(); ctx.ellipse(sx * r, sy * r, r * 0.05, r * 0.09, sx, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else { // банан
        ctx.save(); ctx.rotate(-0.5 + Math.sin(t * 2) * 0.05);
        const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, "#fff6a8"); g.addColorStop(1, "#f2b800");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-r * 1.0, -r * 0.3); ctx.quadraticCurveTo(0, r * 1.3, r * 1.0, -r * 0.4); ctx.quadraticCurveTo(0, r * 0.5, -r * 1.0, -r * 0.3); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = "#5a3a10"; ctx.beginPath(); ctx.arc(-r * 1.0, -r * 0.3, r * 0.08, 0, Math.PI * 2); ctx.arc(r * 1.0, -r * 0.4, r * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
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

    const mainSnake = () => ({ snake: v.snake, prevSnake: v.prevSnake, skin: v.skin, palette: v.palette, dir: v.dir, shield: v.shield, hd: headDir, bulges: true, face: true, acc: v.acc, trail: !v.noTrail });
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
        drawLayered(now, { ...gh, bulges: false, shield: false, face: false, trail: false }, gh.dead ? 0.18 : 0.38);
        const h = gh.snake[0];
        ctx.save(); ctx.font = `800 ${cell * 0.42}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.globalAlpha = 0.85; ctx.fillStyle = "#fff"; ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
        ctx.fillText((gh.dead ? "💀 " : "👻 ") + (gh.label || ""), Math.max(cell * 2, Math.min(side - cell * 2, (h.x + 0.5) * cell)), Math.max(cell * 0.6, h.y * cell - cell * 0.15));
        ctx.restore();
      }
      // соперник в дуэли — полноценная змейка с подписью
      for (const o of v.others || []) {
        if (!o.snake || !o.snake.length) continue;
        o.hd = o.hd || { x: -1, y: 0 };
        drawLayered(now, { ...o, bulges: false, shield: false, face: true, trail: false }, o.dead ? 0.3 : 1);
        if (o.label) {
          const h = o.snake[0];
          ctx.save(); ctx.font = `800 ${cell * 0.5}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillStyle = o.color || "#ff9a9a"; ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
          ctx.fillText(o.label, Math.max(cell * 2, Math.min(side - cell * 2, (h.x + 0.5) * cell)), Math.max(cell * 0.7, h.y * cell - cell * 0.3));
          ctx.restore();
        }
      }
      if (!v.snake.length) return;
      // мигание в «безопасные» секунды после старта/паузы, полупрозрачность у бонуса «призрак»
      const alpha = v.ghost ? 0.55 : v.safe ? 0.5 + 0.35 * Math.abs(Math.sin(now / 110)) : 1;
      drawLayered(now, mainSnake(), alpha);
      drawPet(now);
    }
    // Питомец: летит за хвостом змейки, плавно догоняя его; покачивается
    let petPos = null;
    function drawPet(now) {
      if (!v.pet || !v.pet.emoji || !v.snake.length) { petPos = null; return; }
      const pts = snakePoints(now, mainSnake()), tail = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 2)];
      let dx = tail.x - prev.x, dy = tail.y - prev.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const tx = (tail.x + dx * 0.9 + 0.5) * cell, ty = (tail.y + dy * 0.9 + 0.5) * cell - cell * 0.35;
      if (!petPos || Math.hypot(petPos.x - tx, petPos.y - ty) > cell * 6) petPos = { x: tx, y: ty };
      petPos.x += (tx - petPos.x) * 0.12; petPos.y += (ty - petPos.y) * 0.12;
      const bob = Math.sin(now / 220) * cell * 0.12, sz = cell * (0.8 + Math.min(0.35, (v.pet.level || 1) * 0.02));
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(petPos.x, petPos.y + sz * 0.55, sz * 0.32, sz * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.font = `${sz}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(255,240,180,.6)"; ctx.shadowBlur = cell * 0.4;
      if (dx > 0.3) { ctx.translate(petPos.x, petPos.y + bob); ctx.scale(-1, 1); ctx.fillText(v.pet.emoji, 0, 0); } else ctx.fillText(v.pet.emoji, petPos.x, petPos.y + bob);
      ctx.restore();
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
        // чешуя: тонкие тёмные поперечные полосы и светлый ряд «ромбиков» по спине
        ctx.save(); ctx.globalAlpha *= 0.16; ctx.strokeStyle = "#000"; ctx.lineCap = "butt"; ctx.lineWidth = baseW * 0.62;
        ctx.setLineDash([cell * 0.07, cell * 0.2]); ctx.lineDashOffset = -a * cell; path(); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.globalAlpha *= 0.22; ctx.strokeStyle = "#fff"; ctx.lineCap = "round"; ctx.lineWidth = baseW * 0.12;
        ctx.setLineDash([cell * 0.02, cell * 0.25]); ctx.lineDashOffset = -a * cell + cell * 0.13; path(); ctx.stroke(); ctx.restore();
        if (epic) epicFx(skin, pts, n, now, baseW);
        if (palette) weeklyFx(palette, pts, n, now, baseW);
        ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = baseW * 0.2; path(-cell * 0.1, -cell * 0.12); ctx.stroke(); ctx.restore();
        const H = sp[0], r = baseW * 0.62;
        // щит: кольцо вокруг головы
        if (sn.shield) {
          ctx.save(); ctx.strokeStyle = "rgba(109,255,176,.85)"; ctx.lineWidth = cell * 0.07; ctx.shadowColor = "#6dffb0"; ctx.shadowBlur = cell * 0.5;
          ctx.beginPath(); ctx.arc(H.x, H.y, r * (1.45 + 0.06 * Math.sin(now / 150)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        const face = sn.face ? faceState(now, H, f) : null;
        if (now % 1600 < 280 && !(face && (face.mouth > 0.1))) { // язычок
          ctx.strokeStyle = "#ff4d6d"; ctx.lineWidth = cell * 0.06; const tx0 = H.x + f.x * r * 0.9, ty0 = H.y + f.y * r * 0.9, tx1 = H.x + f.x * r * 1.55, ty1 = H.y + f.y * r * 1.55;
          ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1); ctx.moveTo(tx1, ty1); ctx.lineTo(tx1 + f.x * r * 0.25 + pr.x * r * 0.25, ty1 + f.y * r * 0.25 + pr.y * r * 0.25);
          ctx.moveTo(tx1, ty1); ctx.lineTo(tx1 + f.x * r * 0.25 - pr.x * r * 0.25, ty1 + f.y * r * 0.25 - pr.y * r * 0.25); ctx.stroke();
        }
        ctx.save(); ctx.shadowColor = headCol; ctx.shadowBlur = cell * 0.5;
        const g = ctx.createRadialGradient(H.x - r * 0.3, H.y - r * 0.3, 1, H.x, H.y, r * 1.1); g.addColorStop(0, "#fff"); g.addColorStop(0.25, headCol); g.addColorStop(1, colAt(0.3));
        // голова чуть вытянута вперёд
        const ang = Math.atan2(f.y, f.x);
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(H.x + f.x * r * 0.08, H.y + f.y * r * 0.08, r * 1.08, r, ang, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        // рот: открывается перед едой, жуёт после неё
        if (face && face.mouth > 0.05) {
          const mx = H.x + f.x * r * 0.78, my = H.y + f.y * r * 0.78;
          ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
          ctx.fillStyle = "#3a0710"; ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.38 * face.mouth + r * 0.05, r * 0.66 * face.mouth, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
          ctx.fillStyle = "#ff6b8b"; ctx.beginPath(); ctx.ellipse(0, r * 0.08, r * 0.2 * face.mouth, r * 0.3 * face.mouth, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
          ctx.fillStyle = "#fff"; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-r * 0.05, sd * r * 0.5 * face.mouth); ctx.lineTo(r * 0.12 * face.mouth, sd * r * 0.42 * face.mouth); ctx.lineTo(-r * 0.05, sd * r * 0.3 * face.mouth); ctx.fill(); }
          ctx.restore();
        }
        // маска вора
        if (sn.mask) {
          ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(ang);
          ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(r * 0.28, 0, r * 0.32, r * 0.92, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        drawEyes(H, f, pr, r, face, sn, now);
        if (sn.acc) drawAccessory(sn.acc, H, f, pr, r, now);
        if (sn.trail) emitTrail(skin, pts[n - 1], baseW, now, cols);
        ctx.restore();
      }
    }

    // ---- мимика ----
    // mouth 0..1 — открытость рта; look — куда смотрят зрачки; blink, happy (прищур на комбо), scared (опасность впереди)
    function faceState(now, H, f) {
      const st = { mouth: 0, look: { x: f.x, y: f.y }, blink: false, happy: false, scared: false };
      const food = v.food;
      if (food) {
        const fx = (food.x + 0.5) * cell, fy = (food.y + 0.5) * cell, dx = fx - H.x, dy = fy - H.y, d = Math.hypot(dx, dy) || 1;
        if (d < cell * 7) st.look = { x: dx / d, y: dy / d };
        const ahead = (dx * f.x + dy * f.y) / cell;
        if (d < cell * 3.4 && ahead > 0.2) st.mouth = Math.min(1, 0.35 + (3.4 - d / cell) / 2);
      }
      const since = now - lastEat;
      if (since < 420) st.mouth = Math.max(st.mouth, 0.25 + 0.35 * Math.abs(Math.sin(since / 55)));
      st.blink = now % 3400 < 130 || (now + 900) % 9100 < 110;
      st.happy = (v.combo || 0) >= 3;
      st.scared = !!v.danger;
      return st;
    }
    function drawEyes(H, f, pr, r, face, sn, now) {
      const wide = face && face.scared ? 1.25 : 1;
      for (const sd of [-1, 1]) {
        const ex = H.x + f.x * r * 0.3 + pr.x * r * 0.5 * sd, ey = H.y + f.y * r * 0.3 + pr.y * r * 0.5 * sd, er = r * 0.27 * wide;
        if (face && face.happy && !face.scared) { // довольный прищур «^ ^»
          ctx.save(); ctx.strokeStyle = "#08130d"; ctx.lineWidth = r * 0.12; ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(ex, ey + r * 0.06, er * 0.75, Math.atan2(-f.y, -f.x) - 1.1 + Math.PI, Math.atan2(-f.y, -f.x) + 1.1 + Math.PI); ctx.stroke(); ctx.restore();
          continue;
        }
        if (face && face.blink) {
          ctx.save(); ctx.strokeStyle = "#08130d"; ctx.lineWidth = r * 0.1; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(ex - f.x * er, ey - f.y * er); ctx.lineTo(ex + f.x * er, ey + f.y * er); ctx.stroke(); ctx.restore();
          continue;
        }
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
        const lk = face ? face.look : f, pr2 = r * (face && face.scared ? 0.08 : 0.13), off = r * 0.11;
        ctx.fillStyle = sn.stun ? "#7a3bd1" : "#08130d"; ctx.beginPath(); ctx.arc(ex + lk.x * off, ey + lk.y * off, pr2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(ex + lk.x * off - pr2 * 0.35, ey + lk.y * off - pr2 * 0.4, pr2 * 0.35, 0, Math.PI * 2); ctx.fill();
      }
      if (face && face.scared) { // капля пота
        const sx = H.x - f.x * r * 0.2 + pr.x * r * 0.95, sy = H.y - f.y * r * 0.2 + pr.y * r * 0.95 - r * 0.2;
        ctx.save(); ctx.fillStyle = "rgba(140,210,255,.9)"; ctx.beginPath(); ctx.moveTo(sx, sy - r * 0.32); ctx.quadraticCurveTo(sx + r * 0.2, sy, sx, sy + r * 0.12); ctx.quadraticCurveTo(sx - r * 0.2, sy, sx, sy - r * 0.32); ctx.fill(); ctx.restore();
      }
      if (face && face.happy && !face.scared) { // румянец
        ctx.save(); ctx.fillStyle = "rgba(255,110,150,.45)";
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(H.x - f.x * r * 0.1 + pr.x * r * 0.72 * sd, H.y - f.y * r * 0.1 + pr.y * r * 0.72 * sd, r * 0.16, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    }

    // ---- аксессуары ----
    // шапки рисуются «наклейкой» над головой (всегда вертикально), очки и усы — поворачиваются с головой
    const drawAccessory = (...a) => SA.drawAccessoryOn(ctx, ...a);

    // ---- след за хвостом (свой у скинов) ----
    const TRAILS = {
      fire: "ember", inferno: "ember", samurai: "ember", lv_volcano: "ember", sakura: "petal", ocean: "bubble", ice: "flake", toxic: "drip",
      cyber: "pixel", prism: "pixel", gold: "spark", diamond: "spark", galaxy: "star", void: "star", aurora: "star", rainbow: "spark", sunset: "petal", hw_pumpkin: "ember", hw_skeleton: "spark", hw_ghost: "star"
    };
    function emitTrail(skin, tail, baseW, now, cols) {
      const type = TRAILS[skin] || (String(skin).startsWith("weekly_") || String(skin).startsWith("season_") ? "spark" : "");
      if (!type || now - trailAt < 70 || particles.length > 200) return;
      trailAt = now;
      const c = (Math.random() - 0.5) * baseW * 0.5;
      const q = { x: tail.x + c, y: tail.y + (Math.random() - 0.5) * baseW * 0.5, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, life: 0.9, size: 1.6 + Math.random() * 2.2, type, rot: Math.random() * 6, color: cols ? cols[1] : "#fff" };
      if (type === "bubble") { q.vy = -0.35 - Math.random() * 0.3; }
      if (type === "drip") { q.vy = 0.2; }
      if (type === "ember") { q.vy = -0.3 - Math.random() * 0.4; }
      particles.push(q);
    }

    function drawParticles() {
      particles = particles.filter((q) => q.life > 0);
      const SOFT = { petal: 1, bubble: 1, flake: 1, pixel: 1, spark: 1, star: 1, drip: 1 };
      for (const q of particles) {
        q.x += q.vx; q.y += q.vy;
        q.vy += q.type === "ember" ? -0.015 : q.type === "bubble" ? -0.004 : q.type === "petal" || q.type === "flake" ? 0.006 : SOFT[q.type] ? 0 : q.type === "rock" ? 0.12 : 0.04;
        q.life -= SOFT[q.type] ? 0.022 : q.type === "rock" ? 0.025 : 0.035;
        const sz = Math.max(0, q.size * (SOFT[q.type] ? 0.6 + q.life * 0.4 : q.life));
        ctx.globalAlpha = Math.max(0, Math.min(1, q.life)) * (SOFT[q.type] ? 0.8 : 1);
        if (q.type === "petal") { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot += 0.05); ctx.fillStyle = "#ffb3d6"; ctx.beginPath(); ctx.ellipse(0, 0, sz * 1.2, sz * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); continue; }
        if (q.type === "bubble") { ctx.strokeStyle = "rgba(190,240,255,.9)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, sz * 1.1, 0, Math.PI * 2); ctx.stroke(); continue; }
        if (q.type === "pixel") { ctx.fillStyle = q.color; ctx.fillRect(q.x - sz * 0.6, q.y - sz * 0.6, sz * 1.2, sz * 1.2); continue; }
        if (q.type === "rock") { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot += 0.15); ctx.fillStyle = q.color; ctx.fillRect(-sz, -sz * 0.7, sz * 2, sz * 1.4); ctx.restore(); continue; }
        if (q.type === "flake" || q.type === "star" || q.type === "spark") {
          ctx.strokeStyle = q.type === "flake" ? "#e6f9ff" : q.type === "star" ? "#ffffff" : "#fff3a0"; ctx.lineWidth = 1.2; ctx.beginPath();
          for (let k = 0; k < (q.type === "flake" ? 3 : 2); k++) { const a = q.rot + (k * Math.PI) / (q.type === "flake" ? 3 : 2); ctx.moveTo(q.x - Math.cos(a) * sz * 1.4, q.y - Math.sin(a) * sz * 1.4); ctx.lineTo(q.x + Math.cos(a) * sz * 1.4, q.y + Math.sin(a) * sz * 1.4); }
          ctx.stroke(); continue;
        }
        ctx.fillStyle = q.type === "ember" ? "#ff9a3c" : q.type === "drip" ? "#b6ff3c" : q.type === "gold" ? "#ffe56b" : q.type === "coin" ? "#ffd34d" : q.type === "bomb" ? "#ff8a4c" : q.type === "save" ? "#c58bff" : q.type === "die" ? "#ff6b81" : "#7dffbd";
        ctx.beginPath(); ctx.arc(q.x, q.y, sz, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawFloaters() {
      floaters = floaters.filter((f) => f.life > 0);
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${Math.max(17, cell * 0.95)}px system-ui`;
      for (const f of floaters) {
        f.life -= 0.018; const k = 1 - f.life;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6)); ctx.fillStyle = f.color || "#fff7c2"; ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 6;
        const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15)); // «выпрыгивает» и чуть уменьшается
        ctx.save(); ctx.translate(Math.max(cell * 1.2, Math.min(side - cell * 1.2, (f.x + 0.5) * cell)), Math.max(cell * 0.5, (f.y - 0.35 - k * 1.3) * cell)); ctx.scale(sc, sc); ctx.fillText(f.text, 0, 0); ctx.restore();
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
    // «Ночь»: темнота с пятном света вокруг головы; еда слегка светится сквозь тьму
    function drawNight(now) {
      if (fieldStyle().fx !== "night" || !v.snake.length) return;
      if (!darkc || darkc.width !== layerc.width) { darkc = document.createElement("canvas"); darkc.width = darkc.height = layerc.width; }
      const d = darkc.getContext("2d"); d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = "source-over";
      d.fillStyle = "rgba(2,4,14,.82)"; d.fillRect(0, 0, darkc.width, darkc.height); d.setTransform(dprV, 0, 0, dprV, 0, 0);
      d.globalCompositeOperation = "destination-out";
      const hole = (x, y, rr, a) => { const g = d.createRadialGradient(x, y, rr * 0.25, x, y, rr); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)"); d.fillStyle = g; d.beginPath(); d.arc(x, y, rr, 0, Math.PI * 2); d.fill(); };
      const h = snakePoints(now, mainSnake())[0];
      hole((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * (5.2 + 0.2 * Math.sin(now / 400)), 1);
      if (v.food) hole((v.food.x + 0.5) * cell, (v.food.y + 0.5) * cell, cell * 1.3, 0.75);
      if (v.pu) hole((v.pu.x + 0.5) * cell, (v.pu.y + 0.5) * cell, cell * 1.2, 0.7);
      if (v.hole) hole((v.hole.x + 0.5) * cell, (v.hole.y + 0.5) * cell, cell * 1.6, 0.85);
      ctx.drawImage(darkc, 0, 0, side, side);
    }
    // «Диафрагма» — переход между уровнями: круг закрывается к норке / открывается из центра
    function drawIris(now) {
      if (!iris) return;
      let k = Math.min(1, (now - iris.t0) / iris.dur); if (iris.open) k = 1 - k;
      if (iris.open && k <= 0) { iris = null; return; }
      const R = Math.hypot(side, side) * (1 - k * k * (3 - 2 * k));
      ctx.save(); ctx.fillStyle = "#020805"; ctx.beginPath(); ctx.rect(0, 0, side, side); ctx.arc(iris.x, iris.y, Math.max(0, R), 0, Math.PI * 2, true); ctx.fill("evenodd");
      if (R > 2) { ctx.strokeStyle = "rgba(255,216,76,.6)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(iris.x, iris.y, R, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
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
      drawFieldFx(now); drawLight(now); drawRocks(now); drawShrinkWarn(now); drawGates(now); drawHole(now); drawPortals(now); drawMagnet(now); drawFood(now); drawPowerUp(now); drawRings(now);
      drawRival(now); drawSnake(now); drawParticles(); drawNight(now); drawComboGlow(now); drawFloaters();
      ctx.restore();
      drawIris(now);
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
      reset() { particles = []; floaters = []; eaten = []; bulges = []; headDir.x = 1; headDir.y = 0; lastEat = -1e9; if (iris && !iris.open) iris = null; },
      burst(x, y, type, count) {
        count = count || (type === "coin" ? 14 : 20);
        if (particles.length > 240) particles.splice(0, particles.length - 240);
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
          particles.push({ x: (x + 0.5) * cell, y: (y + 0.5) * cell, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, size: 2 + Math.random() * 4, type });
        }
      },
      floater(x, y, text, color) { floaters.push({ x, y, life: 1, text, color }); },
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
      eat(food, dur) { eaten.push({ x: food.x, y: food.y, type: food.type, fruit: food.fruit, t: performance.now(), dur }); bulges.push(-1); lastEat = performance.now(); },
      // осколки разбитого камня
      shatter(x, y) {
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5;
          particles.push({ x: (x + 0.5) * cell, y: (y + 0.5) * cell, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 1, size: 1.5 + Math.random() * 3, type: "rock", rot: a, color: ["#a9b6ba", "#6b787d", "#4a5459"][i % 3] });
        }
      },
      // переход: open=false — закрыть к клетке (x,y); open=true — открыть из неё
      iris(x, y, open, dur = 600) { iris = { x: (x + 0.5) * cell, y: (y + 0.5) * cell, open, dur, t0: performance.now() }; },
      get irisOn() { return !!iris; },
      step(len) { bulges = bulges.map((b) => b + 1).filter((b) => b < len + 1); }
    };
  };
})();
