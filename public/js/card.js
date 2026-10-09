// Карточка результата 1200×630 для шеринга: рисуется на canvas в браузере и отправляется на сервер как PNG.
(function () {
  "use strict";
  const SA = (window.SA = window.SA || {});
  const W = 1200, H = 630;
  const T = (s) => (SA.i18n ? SA.i18n.t(s) : s);

  // data: { score, apples, name, skin, palette, field, modeName, diffName, isRecord, daily }
  SA.drawResultCard = function (data) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    const F = SA.FIELD_STYLE[data.field] || SA.FIELD_STYLE.classic;
    const cols = (Array.isArray(data.palette) && data.palette) || SA.HEAD_COLORS[data.skin] || SA.SKIN_COLORS.classic;

    // фон в цветах поля игрока
    x.fillStyle = F.bg; x.fillRect(0, 0, W, H);
    x.fillStyle = F.chk.replace(/[\d.]+\)$/, "0.07)");
    for (let i = 0; i < W / 50; i++) for (let j = 0; j < H / 50; j++) if ((i + j) % 2 === 0) x.fillRect(i * 50, j * 50, 50, 50);
    // Свечение и затемнение краёв — ступенчатыми кольцами/рамками, а не градиентом: браузер дизерит
    // градиенты, и PNG с ними весит ~800 КБ; со ступеньками — ~250 КБ (лимит сервера 400 КБ)
    x.fillStyle = F.g0.replace(/[\d.]+\)$/, "0.06)");
    for (let i = 18; i >= 1; i--) { x.beginPath(); x.arc(W * 0.72, H * 0.45, (W * 0.62 * i) / 18, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "rgba(0,0,0,.07)";
    for (let i = 0; i < 8; i++) { const d = i * 14; x.fillRect(0, 0, W, 14 + d); x.fillRect(0, H - 14 - d, W, 14 + d); x.fillRect(0, 0, 14 + d, H); x.fillRect(W - 14 - d, 0, 14 + d, H); }

    // змейка-волна в цветах скина
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push({ x: 620 + t * 540, y: 330 + Math.sin(t * Math.PI * 2.4) * 110 * (1 - t * 0.35) }); }
    const c0 = SA.hex2rgb(cols[0]), c1 = SA.hex2rgb(cols[1]);
    x.lineCap = "round"; x.lineJoin = "round";
    x.save(); x.shadowColor = cols[1]; x.shadowBlur = 40; x.strokeStyle = cols[1]; x.globalAlpha = 0.45; x.lineWidth = 52;
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); x.restore();
    for (let i = pts.length - 1; i > 0; i--) {
      const t = i / (pts.length - 1);
      x.strokeStyle = SA.mix(c0, c1, t); x.lineWidth = 64 * (1 - 0.45 * t);
      x.beginPath(); x.moveTo(pts[i].x, pts[i].y); x.lineTo(pts[i - 1].x, pts[i - 1].y); x.stroke();
    }
    const hx = pts[0].x, hy = pts[0].y, hr = 42;
    x.fillStyle = cols[1]; x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
    x.fillStyle = cols[0]; x.beginPath(); x.arc(hx - 6, hy - 6, hr * 0.78, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(255,255,255,.55)"; x.beginPath(); x.arc(hx - 16, hy - 16, hr * 0.28, 0, Math.PI * 2); x.fill();
    for (const s of [-1, 1]) {
      x.fillStyle = "#fff"; x.beginPath(); x.arc(hx - 12, hy + s * 17, 11, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#08130d"; x.beginPath(); x.arc(hx - 15, hy + s * 17, 5.5, 0, Math.PI * 2); x.fill();
    }
    // яблоко перед головой
    x.save(); x.shadowColor = "#ff244f"; x.shadowBlur = 30; x.fillStyle = "#ff365d"; x.beginPath(); x.arc(hx - 110, hy - 10, 26, 0, Math.PI * 2); x.fill(); x.restore();

    // текст
    x.fillStyle = "#9fffc8"; x.font = "800 30px system-ui,sans-serif"; x.textBaseline = "alphabetic";
    x.fillText("🐍 SNAKE ARENA", 70, 100);
    x.fillStyle = "#f3fff8"; x.font = "900 172px system-ui,sans-serif";
    x.fillText(String(data.score), 64, 300);
    x.fillStyle = "#83a296"; x.font = "700 36px system-ui,sans-serif";
    x.fillText(`${T("очков")} · 🍎 ${data.apples}`, 72, 352);
    const tags = [data.modeName, data.diffName, data.daily ? "📅 " + T("Челлендж дня") : ""].filter(Boolean).join(" · ");
    x.fillStyle = "#cfe9dc"; x.font = "600 30px system-ui,sans-serif"; x.fillText(tags, 72, 410);
    if (data.isRecord) {
      x.fillStyle = "#ffcf4d"; x.beginPath(); x.roundRect ? x.roundRect(68, 440, 330, 58, 29) : x.rect(68, 440, 330, 58); x.fill();
      x.fillStyle = "#2b1a00"; x.font = "900 30px system-ui,sans-serif"; x.fillText("🏆 " + T("Новый рекорд!"), 92, 480);
    }
    x.fillStyle = "#f3fff8"; x.font = "800 38px system-ui,sans-serif";
    x.fillText(String(data.name || "Игрок").slice(0, 24), 72, 568);
    x.fillStyle = "#55ffad"; x.font = "800 32px system-ui,sans-serif";
    const cta = T("Сможешь побить?"); x.fillText(cta, W - 70 - x.measureText(cta).width, 568);
    return c;
  };

  SA.cardBlob = (data) => new Promise((ok) => SA.drawResultCard(data).toBlob((b) => ok(b), "image/png"));
})();
