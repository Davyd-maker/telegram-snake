// Справочники клиента: запасные каталоги (если сервер недоступен), оформление полей и цвета скинов.
// Подключается первым; всё складывается в общий объект window.SA.
(function () {
  "use strict";
  const SA = (window.SA = window.SA || {});

  SA.DEFAULT_SKINS = [
    { id: "classic", name: "Классика", emoji: "🐍", price: 0, currency: "coins" }, { id: "fire", name: "Огненная", emoji: "🔥", price: 2000, currency: "coins" },
    { id: "sakura", name: "Сакура", emoji: "🌸", price: 3000, currency: "coins" }, { id: "ocean", name: "Океан", emoji: "🌊", price: 4500, currency: "coins" },
    { id: "ice", name: "Ледяная", emoji: "❄️", price: 5000, currency: "coins" }, { id: "toxic", name: "Токсик", emoji: "☣️", price: 7000, currency: "coins" },
    { id: "sunset", name: "Закат", emoji: "🌅", price: 9000, currency: "coins" }, { id: "gold", name: "Золотая", emoji: "👑", price: 10000, currency: "coins" },
    { id: "cyber", name: "Кибер", emoji: "🤖", price: 20000, currency: "coins" },
    { id: "rainbow", name: "Радуга", emoji: "🌈", price: 50, currency: "stars", epic: true, desc: "Переливается всеми цветами" },
    { id: "galaxy", name: "Галактика", emoji: "🌌", price: 100, currency: "stars", epic: true, desc: "Мерцающие звёзды по телу" },
    { id: "inferno", name: "Дракон", emoji: "🐲", price: 150, currency: "stars", epic: true, desc: "Огонь и искры за хвостом" },
    { id: "diamond", name: "Алмаз", emoji: "💎", price: 250, currency: "stars", epic: true, desc: "Сверкающие грани и блики" },
    { id: "aurora", name: "Аврора", emoji: "🌠", price: 120, currency: "stars", epic: true, desc: "Северное сияние переливается по телу" },
    { id: "samurai", name: "Самурай", emoji: "⚔️", price: 180, currency: "stars", epic: true, desc: "Алый клинок и искры за хвостом" },
    { id: "void", name: "Пустота", emoji: "🕳️", price: 220, currency: "stars", epic: true, desc: "Тёмная энергия и фиолетовое свечение" },
    { id: "prism", name: "Призма", emoji: "🔷", price: 300, currency: "stars", epic: true, desc: "Радужные грани и кристальные вспышки" }
  ];

  SA.DEFAULT_FIELDS = [
    { id: "classic", name: "Классика", emoji: "🟩", price: 0, currency: "coins", desc: "Стандартное зелёное поле" },
    { id: "graphite", name: "Графит", emoji: "⬛", price: 25000, currency: "coins", desc: "Простое тёмное поле" },
    { id: "neon", name: "Неон", emoji: "🌃", price: 50, currency: "stars", epic: true, desc: "Светящаяся сетка и сканер" },
    { id: "frost", name: "Мороз", emoji: "❄️", price: 75, currency: "stars", epic: true, desc: "Ледяное поле, идёт снег" },
    { id: "desert", name: "Пустыня", emoji: "🏜️", price: 75, currency: "stars", epic: true, desc: "Тёплый песок и закат" },
    { id: "lava", name: "Лава", emoji: "🌋", price: 100, currency: "stars", epic: true, desc: "Жар поднимается снизу" },
    { id: "space", name: "Космос", emoji: "🌌", price: 150, currency: "stars", epic: true, desc: "Мерцающие звёзды" },
    { id: "aurora_field", name: "Аврора", emoji: "🎇", price: 110, currency: "stars", epic: true, desc: "Сияющие волны северного света" },
    { id: "cyber_field", name: "Киберпанк", emoji: "🏙️", price: 130, currency: "stars", epic: true, desc: "Неоновый мегаполис и сканирующая сетка" },
    { id: "volcano_field", name: "Вулкан", emoji: "🔥", price: 175, currency: "stars", epic: true, desc: "Лава, пепел и раскалённые трещины" },
    { id: "crystal_field", name: "Кристалл", emoji: "💠", price: 220, currency: "stars", epic: true, desc: "Кристаллическая арена с сиянием" }
  ];

  // Оформление полей: цвета фона, шахматка, сетка, свечение и анимированный эффект (fx)
  SA.FIELD_STYLE = {
    classic: { bg: "#04100a", chk: "rgba(110,255,180,.032)", g0: "rgba(31,135,79,.22)", g1: "rgba(6,39,24,.08)", border: "rgba(91,255,170,.3)" },
    graphite: { bg: "#0d0f12", chk: "rgba(255,255,255,.035)", g0: "rgba(120,130,145,.16)", g1: "rgba(30,34,40,.06)", border: "rgba(190,200,215,.3)" },
    neon: { bg: "#07030f", chk: "rgba(255,60,220,.04)", grid: "rgba(0,230,255,.14)", g0: "rgba(160,40,255,.28)", g1: "rgba(60,10,110,.1)", border: "rgba(255,80,230,.6)", fx: "neon" },
    frost: { bg: "#06141c", chk: "rgba(180,235,255,.05)", g0: "rgba(60,170,230,.26)", g1: "rgba(10,50,80,.1)", border: "rgba(150,225,255,.55)", fx: "snow" },
    desert: { bg: "#1c1307", chk: "rgba(255,200,110,.05)", g0: "rgba(210,140,50,.24)", g1: "rgba(80,45,10,.1)", border: "rgba(255,200,110,.5)" },
    lava: { bg: "#140503", chk: "rgba(255,90,30,.06)", g0: "rgba(255,70,20,.22)", g1: "rgba(90,15,0,.12)", border: "rgba(255,110,40,.6)", fx: "lava" },
    space: { bg: "#030414", chk: "rgba(140,150,255,.025)", g0: "rgba(70,60,200,.26)", g1: "rgba(15,10,70,.1)", border: "rgba(150,140,255,.55)", fx: "stars" },
    aurora_field: { bg: "#041412", chk: "rgba(80,255,200,.04)", g0: "rgba(0,210,150,.28)", g1: "rgba(20,60,80,.1)", border: "rgba(100,255,210,.6)", fx: "neon" },
    cyber_field: { bg: "#080313", chk: "rgba(255,50,220,.04)", grid: "rgba(0,220,255,.18)", g0: "rgba(100,30,180,.28)", g1: "rgba(30,10,60,.1)", border: "rgba(0,240,255,.6)", fx: "neon" },
    volcano_field: { bg: "#130402", chk: "rgba(255,90,30,.06)", g0: "rgba(255,60,10,.25)", g1: "rgba(70,8,0,.12)", border: "rgba(255,100,40,.65)", fx: "lava" },
    crystal_field: { bg: "#09051a", chk: "rgba(200,180,255,.04)", g0: "rgba(150,90,255,.28)", g1: "rgba(35,15,80,.1)", border: "rgba(210,180,255,.65)", fx: "stars" }
  };

  // Цвета обычных скинов: [голова, хвост]
  SA.SKIN_COLORS = {
    classic: ["#7dffc4", "#12c96d"], fire: ["#ffe083", "#ff4f32"], ice: ["#d2fbff", "#35bfff"], gold: ["#fff2a5", "#d99b18"], cyber: ["#f0c7ff", "#8c52ff"],
    sakura: ["#ffd1e8", "#ff5fa8"], ocean: ["#b8f3ff", "#0a7ad9"], toxic: ["#e8ff7a", "#4fc400"], sunset: ["#ffd27a", "#ff4f7b"], aurora: ["#b8ffe8", "#00a878"],
    samurai: ["#ffd0d0", "#b3122f"], void: ["#d8b5ff", "#4314a3"], prism: ["#ffffff", "#3bdcff"]
  };
  // скины за главы уровней
  Object.assign(SA.SKIN_COLORS, { lv_garden: ["#c8ffb0", "#2e9e3a"], lv_dungeon: ["#e6d5ff", "#5b4a8a"], lv_volcano: ["#ffe08a", "#d13b0a"] });

  const hsl = (h, l = 60) => `hsl(${((h % 360) + 360) % 360},95%,${l}%)`;
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  SA.hsl = hsl; SA.mix = mix; SA.hex2rgb = hex2rgb;

  // Эпические скины: цвет зависит от позиции на теле (t: 0 — голова, 1 — хвост) и времени
  SA.EPIC = {
    rainbow: { color: (t, now) => hsl(now / 6 - t * 300), glow: (now) => hsl(now / 6, 60) },
    galaxy: { color: (t) => mix([176, 120, 255], [28, 12, 104], t), glow: () => "#8a4dff" },
    inferno: { color: (t) => (t < 0.45 ? mix([255, 243, 160], [255, 122, 26], t / 0.45) : mix([255, 122, 26], [96, 10, 0], (t - 0.45) / 0.55)), glow: () => "#ff6a1a" },
    diamond: { color: (t) => mix([255, 255, 255], [95, 227, 255], Math.min(1, t * 1.5)), glow: () => "#7fe9ff" },
    aurora: { color: (t) => mix([190, 255, 235], [0, 170, 125], t), glow: () => "#55ffd0" },
    samurai: { color: (t) => mix([255, 225, 225], [160, 20, 45], t), glow: () => "#ff405f" },
    void: { color: (t) => mix([230, 190, 255], [45, 5, 100], t), glow: () => "#a75cff" },
    prism: { color: (t, now) => hsl(now / 5 - t * 240), glow: (now) => hsl(now / 5, 65) },
    season_champion: { color: (t) => mix([255, 245, 160], [255, 150, 20], t), glow: () => "#ffd34d" },
    season_elite: { color: (t) => mix([220, 240, 255], [100, 70, 255], t), glow: () => "#8c6cff" },
    season_master: { color: (t) => mix([160, 255, 255], [0, 190, 255], t), glow: () => "#32e8ff" },
    lv_volcano: { color: (t, now) => mix([255, 224, 138], [209, 59, 10], Math.min(1, t + 0.15 * Math.sin(now / 200 + t * 8))), glow: () => "#ff6a1a" }
  };

  // Голова змейки в рейтинге (CSS-градиент)
  SA.HEAD_COLORS = {
    ...SA.SKIN_COLORS, rainbow: ["#ffe14d", "#ff3b3b"], galaxy: ["#b078ff", "#1c0b66"], inferno: ["#fff3a0", "#ff4a00"], diamond: ["#ffffff", "#5fe3ff"],
    prism: ["#ffffff", "#3bdcff"], lv_volcano: ["#ffe08a", "#d13b0a"], season_champion: ["#fff5a0", "#ff9614"], season_elite: ["#dcf0ff", "#6446ff"], season_master: ["#a0ffff", "#00beff"]
  };

  SA.esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
})();
