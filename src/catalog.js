// Каталоги: скины, поля, артефакты, задания, достижения, недельные скины. Цены и награды меняй здесь.
const MISSIONS = [
  { id: "score",  icon: "🎯", title: "Набери 50 очков за раунд", target: 50, reward: 300 },
  { id: "games",  icon: "🐍", title: "Сыграй 3 раунда",          target: 3,  reward: 500 },
  { id: "apples", icon: "🍎", title: "Съешь 30 яблок",           target: 30, reward: 700 }
];

// currency: coins — за монеты, stars — за Telegram Stars (XTR), season — награда сезона
const SKIN_CATALOG = [
  { id: "classic", name: "Классика",  emoji: "🐍", price: 0,     currency: "coins" },
  { id: "fire",    name: "Огненная",  emoji: "🔥", price: 2000,  currency: "coins" },
  { id: "sakura",  name: "Сакура",    emoji: "🌸", price: 3000,  currency: "coins" },
  { id: "ocean",   name: "Океан",     emoji: "🌊", price: 4500,  currency: "coins" },
  { id: "ice",     name: "Ледяная",   emoji: "❄️", price: 5000,  currency: "coins" },
  { id: "toxic",   name: "Токсик",    emoji: "☣️", price: 7000,  currency: "coins" },
  { id: "sunset",  name: "Закат",     emoji: "🌅", price: 9000,  currency: "coins" },
  { id: "gold",    name: "Золотая",   emoji: "👑", price: 10000, currency: "coins" },
  { id: "cyber",   name: "Кибер",     emoji: "🤖", price: 20000, currency: "coins" },
  { id: "rainbow", name: "Радуга",    emoji: "🌈", price: 50,    currency: "stars", epic: true, desc: "Переливается всеми цветами" },
  { id: "galaxy",  name: "Галактика", emoji: "🌌", price: 100,   currency: "stars", epic: true, desc: "Мерцающие звёзды по телу" },
  { id: "inferno", name: "Дракон",    emoji: "🐲", price: 150,   currency: "stars", epic: true, desc: "Огонь и искры за хвостом" },
  { id: "diamond", name: "Алмаз",     emoji: "💎", price: 250,   currency: "stars", epic: true, desc: "Сверкающие грани и блики" },
  { id: "aurora",  name: "Аврора",    emoji: "🌠", price: 120,   currency: "stars", epic: true, desc: "Северное сияние переливается по телу" },
  { id: "samurai", name: "Самурай",   emoji: "⚔️", price: 180,   currency: "stars", epic: true, desc: "Алый клинок и искры за хвостом" },
  { id: "void",    name: "Пустота",   emoji: "🕳️", price: 220,   currency: "stars", epic: true, desc: "Тёмная энергия и фиолетовое свечение" },
  { id: "prism",   name: "Призма",    emoji: "🔷", price: 300,   currency: "stars", epic: true, desc: "Радужные грани и кристальные вспышки" },
  { id: "season_champion", name: "Корона сезона",   emoji: "👑", price: null, currency: "season", epic: true, seasonRank: 1,  desc: "Эксклюзив за 1-е место сезона" },
  { id: "season_elite",    name: "Фантом сезона",   emoji: "👻", price: null, currency: "season", epic: true, seasonRank: 3,  desc: "Эксклюзив за топ-3 сезона" },
  { id: "season_master",   name: "Неоновый мастер", emoji: "⚡", price: null, currency: "season", epic: true, seasonRank: 10, desc: "Эксклюзив за топ-10 сезона" },
  { id: "pass_phoenix",    name: "Феникс",          emoji: "🪶", price: null, currency: "pass",       epic: true, desc: "Награда премиум-пропуска сезона" },
  { id: "tour_gold",       name: "Золотой кубок",   emoji: "🏆", price: null, currency: "tournament", epic: true, desc: "Победителю турнира выходных" },
  { id: "tour_silver",     name: "Серебряный кубок", emoji: "🥈", price: null, currency: "tournament", epic: true, desc: "За топ-3 турнира выходных" },
  { id: "lv_garden",       name: "Садовник",        emoji: "🌿", price: null, currency: "levels",     epic: true, desc: "За прохождение главы «Сад»" },
  { id: "lv_dungeon",      name: "Страж подземелья", emoji: "🗝️", price: null, currency: "levels",    epic: true, desc: "За прохождение главы «Подземелье»" },
  { id: "lv_volcano",      name: "Повелитель лавы", emoji: "🌋", price: null, currency: "levels",     epic: true, desc: "За прохождение главы «Вулкан»" }
];
const SKIN_BY_ID = Object.fromEntries(SKIN_CATALOG.map((s) => [s.id, s]));

const ARTIFACT_CATALOG = [
  { id: "magnet",  name: "Магнит",  emoji: "🧲", rarity: "rare",      desc: "Тянет еду перед змейкой прямо в рот (радиус 2 → 4 клетки с уровнем).", color: "#55d6ff" },
  { id: "berserk", name: "Берсерк", emoji: "🔥", rarity: "epic",      desc: "После 3+ комбо каждый предмет даёт +25% очков и больше с уровнем.", color: "#ff7a32" },
  { id: "phantom", name: "Фантом",  emoji: "👻", rarity: "legendary", desc: "Спасает от столкновения (раз за забег, больше с уровнем).", color: "#b48cff" }
];
// Стоимость прокачки: ключ — текущий уровень (1→2, 2→3, …)
const ARTIFACT_UPGRADE_COST = [3000, 8000, 20000, 50000];
const ARTIFACT_BY_ID = Object.fromEntries(ARTIFACT_CATALOG.map((a) => [a.id, a]));

// Каталог игровых полей. Красивые поля — за Telegram Stars, простое («Графит») — за монеты.
const FIELD_CATALOG = [
  { id: "classic",  name: "Классика", emoji: "🟩", price: 0,     currency: "coins", desc: "Стандартное зелёное поле" },
  { id: "graphite", name: "Графит",   emoji: "⬛", price: 25000, currency: "coins", desc: "Простое тёмное поле" },
  { id: "neon",     name: "Неон",     emoji: "🌃", price: 50,    currency: "stars", epic: true, desc: "Светящаяся сетка и сканер" },
  { id: "frost",    name: "Мороз",    emoji: "❄️", price: 75,    currency: "stars", epic: true, desc: "Ледяное поле, идёт снег" },
  { id: "desert",   name: "Пустыня",  emoji: "🏜️", price: 75,    currency: "stars", epic: true, desc: "Тёплый песок и закат" },
  { id: "lava",     name: "Лава",     emoji: "🌋", price: 100,   currency: "stars", epic: true, desc: "Жар поднимается снизу" },
  { id: "space",    name: "Космос",   emoji: "🌌", price: 150,   currency: "stars", epic: true, desc: "Мерцающие звёзды" },
  { id: "aurora_field",  name: "Аврора",    emoji: "🎇", price: 110, currency: "stars", epic: true, desc: "Сияющие волны северного света" },
  { id: "cyber_field",   name: "Киберпанк", emoji: "🏙️", price: 130, currency: "stars", epic: true, desc: "Неоновый мегаполис и сканирующая сетка" },
  { id: "volcano_field", name: "Вулкан",    emoji: "🔥", price: 175, currency: "stars", epic: true, desc: "Лава, пепел и раскалённые трещины" },
  { id: "crystal_field", name: "Кристалл",  emoji: "💠", price: 220, currency: "stars", epic: true, desc: "Кристаллическая арена с сиянием" },
  { id: "rain_field",    name: "Дождь",     emoji: "🌧️", price: 30000, currency: "coins", desc: "Косой дождь и круги на лужах" },
  { id: "autumn_field",  name: "Осень",     emoji: "🍂", price: 90,  currency: "stars", epic: true, desc: "Кружатся жёлтые листья" },
  { id: "night_field",   name: "Ночь",      emoji: "🌙", price: 120, currency: "stars", epic: true, desc: "Темнота и светлячки — видно только вокруг головы" }
];
const FIELD_BY_ID = Object.fromEntries(FIELD_CATALOG.map((f) => [f.id, f]));

// Достижения. Полученные показываются значками в профиле. group — для сортировки по разделам.
const ACH = (id, icon, title, stat, target, reward, group) => ({ id, icon, title, need: (p) => (p[stat] || 0) >= target, stat, target, reward, group });
const ACHIEVEMENTS = [
  { id: "first",     icon: "🐣", title: "Первый забег", need: (p) => p.games >= 1,        stat: "games", target: 1, reward: 250, group: "play" },
  ACH("games50", "🎮", "Сыграй 50 забегов", "games", 50, 1000, "play"),
  ACH("games300", "🕹️", "Сыграй 300 забегов", "games", 300, 3000, "play"),
  { id: "apples100", icon: "🍎", title: "100 яблок",    need: (p) => p.total_apples >= 100, stat: "total_apples", target: 100, reward: 500, group: "food" },
  ACH("apples1000", "🧺", "Съешь 1000 фруктов", "total_apples", 1000, 2000, "food"),
  ACH("apples5000", "🍉", "Съешь 5000 фруктов", "total_apples", 5000, 5000, "food"),
  ACH("score100", "🎯", "100 очков за забег", "best_score", 100, 400, "score"),
  ACH("score250", "🏹", "250 очков за забег", "best_score", 250, 600, "score"),
  { id: "score500",  icon: "🔥", title: "500 очков",    need: (p) => p.best_score >= 500,  stat: "best_score", target: 500, reward: 750, group: "score" },
  ACH("score1000", "☄️", "1000 очков за забег", "best_score", 1000, 3000, "score"),
  { id: "combo5",    icon: "⚡", title: "Комбо ×5",     need: (p) => p.best_combo >= 5,    stat: "best_combo", target: 5, reward: 1000, group: "score" },
  ACH("combo10", "🌩️", "Серия из 10 фруктов подряд", "best_combo", 10, 2000, "score"),
  ACH("lv10", "🌿", "Пройди главу «Сад»", "levels", 10, 1500, "levels"),
  ACH("lv20", "🏰", "Пройди главу «Подземелье»", "levels", 20, 3000, "levels"),
  ACH("lv30", "🌋", "Пройди все 30 уровней", "levels", 30, 6000, "levels"),
  ACH("stars45", "⭐", "Собери 45 звёзд на уровнях", "level_stars", 45, 2500, "levels"),
  ACH("stars90", "🌟", "Все 90 звёзд на уровнях", "level_stars", 90, 8000, "levels"),
  ACH("streak7", "📅", "Заходи 7 дней подряд", "streak", 7, 1000, "loyal"),
  ACH("streak30", "🗓️", "Заходи 30 дней подряд", "streak", 30, 5000, "loyal"),
  ACH("skins5", "🎨", "Собери 5 скинов", "skins", 5, 1500, "collect"),
  ACH("acc3", "🎩", "Собери 3 аксессуара", "accs", 3, 1000, "collect"),
  ACH("fields3", "🗺️", "Собери 3 поля", "fields", 3, 1500, "collect"),
  ACH("friends1", "🤝", "Пригласи друга", "referrals", 1, 500, "friends"),
  { id: "friends5",  icon: "👥", title: "5 друзей",     need: (p) => p.referrals >= 5,     stat: "referrals", target: 5, reward: 1500, group: "friends" },
  ACH("friends20", "🎉", "20 друзей", "referrals", 20, 6000, "friends")
];

// Аксессуары: надеваются поверх любого скина. Один надет одновременно.
const ACCESSORY_CATALOG = [
  { id: "cap",        name: "Кепка",        emoji: "🧢", price: 3000,  currency: "coins" },
  { id: "bow",        name: "Бантик",       emoji: "🎀", price: 3000,  currency: "coins" },
  { id: "glasses",    name: "Очки",         emoji: "👓", price: 4000,  currency: "coins" },
  { id: "flower",     name: "Цветок",       emoji: "🌼", price: 4000,  currency: "coins" },
  { id: "mustache",   name: "Усы",          emoji: "🥸", price: 5000,  currency: "coins" },
  { id: "party",      name: "Колпак",       emoji: "🥳", price: 6000,  currency: "coins" },
  { id: "headphones", name: "Наушники",     emoji: "🎧", price: 8000,  currency: "coins" },
  { id: "shades",     name: "Тёмные очки",  emoji: "🕶️", price: 40,    currency: "stars", epic: true },
  { id: "tophat",     name: "Цилиндр",      emoji: "🎩", price: 60,    currency: "stars", epic: true },
  { id: "horns",      name: "Рожки",        emoji: "😈", price: 75,    currency: "stars", epic: true },
  { id: "halo",       name: "Нимб",         emoji: "😇", price: 90,    currency: "stars", epic: true },
  { id: "crown",      name: "Корона",       emoji: "👑", price: 150,   currency: "stars", epic: true }
];
const ACC_BY_ID = Object.fromEntries(ACCESSORY_CATALOG.map((a) => [a.id, a]));

// ---- Сезон = неделя (понедельник 00:00 UTC). Скин недели зависит только от даты понедельника,
// поэтому id и цвета восстанавливаются без БД — прошлые недельные скины остаются у тех, кто их получил.
function currentSeasonBounds(now = new Date()) {
  const d = new Date(now); const day = d.getUTCDay();
  const starts = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)));
  const ends = new Date(starts); ends.setUTCDate(ends.getUTCDate() + 7);
  return { starts, ends };
}
const WEEKLY_PALETTES = [
  ["#9affd0", "#00a878", "🌿", "Нефритовый дух"], ["#ffd1ef", "#ff4f9a", "🌸", "Розовый комет"],
  ["#c8f5ff", "#247cff", "🌊", "Лазурный шторм"], ["#fff0a8", "#ff7a00", "☀️", "Солнечный рейдер"],
  ["#e2c7ff", "#713cff", "🔮", "Астральный кристалл"], ["#d8ff8b", "#39a900", "☣️", "Токсичный спектр"],
  ["#ffffff", "#9ca8ff", "🌙", "Лунный призрак"], ["#ffb4a8", "#d71920", "🌹", "Алый феникс"]
];
function weeklySkinForDate(ymd) { // ymd = "YYYYMMDD"
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  const q = WEEKLY_PALETTES[((Math.floor(t / 604800000) % 8) + 8) % 8];
  return { id: `weekly_${ymd}`, name: `${q[3]} · ${ymd.slice(6, 8)}.${ymd.slice(4, 6)}`, emoji: q[2], price: null, currency: "season", epic: true, weekly: true,
           desc: "Уникальный скин недели. После окончания сезона получить его нельзя.", palette: q.slice(0, 2) };
}
// Скин сезона — по понедельнику той недели, в которой сезон начался (сезон, закрытый досрочно и
// начатый заново в ту же неделю, остаётся с тем же скином недели)
function weeklySkinFor(season) {
  const d = currentSeasonBounds(new Date(season?.starts_at || Date.now())).starts;
  return weeklySkinForDate(d.toISOString().slice(0, 10).replaceAll("-", ""));
}
function weeklySkinById(id) {
  const m = /^weekly_(\d{8})$/.exec(String(id || ""));
  return m ? weeklySkinForDate(m[1]) : null;
}
const skinDef = (id) => SKIN_BY_ID[id] || weeklySkinById(id) || null;
// палитра головы для рейтинга: у недельных скинов цвета из палитры, у остальных клиент берёт свои
const skinPalette = (id) => { const w = weeklySkinById(id); return w ? w.palette : null; };

// Каталог скинов игрока: общий + скин текущей недели + прошлые недельные, которые он уже получил
function catalogFor(p) {
  const now = weeklySkinFor({ starts_at: currentSeasonBounds().starts });
  const extra = (Array.isArray(p.owned_skins) ? p.owned_skins : [])
    .filter((id) => id !== now.id).map(weeklySkinById).filter(Boolean);
  return [...SKIN_CATALOG, now, ...extra];
}

// ---- Задания: каждый день 3 случайных из пула (одинаковые для всех в этот день), каждую неделю — 3 недельных.
// stat — какой счётчик забега считаем; max: true — лучший результат за забег, иначе сумма
const MISSION_POOL = [
  { id: "score50",  icon: "🎯", title: "Набери 50 очков за раунд",     stat: "score", max: true, target: 50,  reward: 300 },
  { id: "score100", icon: "🏹", title: "Набери 100 очков за раунд",    stat: "score", max: true, target: 100, reward: 600 },
  { id: "games3",   icon: "🐍", title: "Сыграй 3 раунда",              stat: "games",  target: 3,   reward: 400 },
  { id: "games6",   icon: "🎮", title: "Сыграй 6 раундов",             stat: "games",  target: 6,   reward: 700 },
  { id: "apples30", icon: "🍎", title: "Съешь 30 яблок",               stat: "apples", target: 30,  reward: 500 },
  { id: "apples80", icon: "🧺", title: "Съешь 80 яблок",               stat: "apples", target: 80,  reward: 900 },
  { id: "gold3",    icon: "⭐", title: "Съешь 3 золотые звезды",       stat: "gold",   target: 3,   reward: 500 },
  { id: "combo5",   icon: "⚡", title: "Сделай комбо ×5",              stat: "combo", max: true, target: 5, reward: 500 },
  { id: "pu3",      icon: "🎁", title: "Подбери 3 бонуса на поле",     stat: "pu",     target: 3,   reward: 400 },
  { id: "coins150", icon: "🪙", title: "Собери 150 монет на поле",     stat: "coins",  target: 150, reward: 400 },
  { id: "rocks1",   icon: "🪨", title: "Набери 20 очков в «Камнях»",   stat: "m_rocks",  max: true, target: 20, reward: 450 },
  { id: "maze1",    icon: "🧩", title: "Набери 20 очков в «Лабиринте»", stat: "m_maze",  max: true, target: 20, reward: 450 },
  { id: "moving1",  icon: "⚡", title: "Набери 20 очков в «Живых стенах»", stat: "m_moving", max: true, target: 20, reward: 500 },
  { id: "daily1",   icon: "📅", title: "Сыграй челлендж дня",          stat: "daily",  target: 1,   reward: 300 },
  { id: "hard30",   icon: "💀", title: "Набери 30 очков на сложной",   stat: "hard", max: true, target: 30, reward: 600 }
];
const WEEKLY_POOL = [
  { id: "w_games25",  icon: "🗓️", title: "Сыграй 25 раундов за неделю",   stat: "games",  target: 25,  reward: 2500 },
  { id: "w_apples300", icon: "🍏", title: "Съешь 300 яблок за неделю",     stat: "apples", target: 300, reward: 3000 },
  { id: "w_score200", icon: "🏆", title: "Набери 200 очков за раунд",       stat: "score", max: true, target: 200, reward: 3000 },
  { id: "w_gold20",   icon: "🌟", title: "Съешь 20 золотых звёзд",          stat: "gold",   target: 20,  reward: 2500 },
  { id: "w_pu20",     icon: "🎁", title: "Подбери 20 бонусов",              stat: "pu",     target: 20,  reward: 2000 },
  { id: "w_combo8",   icon: "🔥", title: "Сделай комбо ×8",                 stat: "combo", max: true, target: 8, reward: 3000 },
  { id: "w_daily4",   icon: "📅", title: "Сыграй челлендж дня 4 раза",      stat: "daily",  target: 4,   reward: 2000 },
  { id: "w_modes",    icon: "🧭", title: "Сыграй 6 раундов в особых режимах", stat: "special", target: 6, reward: 2000 }
];
const MISSION_BY_ID = Object.fromEntries([...MISSION_POOL, ...WEEKLY_POOL].map((m) => [m.id, m]));

// ---- Покупки за Stars, кроме скинов и полей
const PRODUCTS = {
  pass:    { id: "pass",    name: "Премиум-пропуск сезона", emoji: "🎟️", price: 99, currency: "stars", desc: "Вторая дорожка наград сезона и скин «Феникс»" },
  starter: { id: "starter", name: "Набор новичка",          emoji: "🎁", price: 49, currency: "stars", desc: "5 000 🪙, скин «Кибер» и магнит 2-го уровня" }
};
const STARTER = { coins: 5000, skin: "cyber", artifact: "magnet", level: 2, days: 7 }; // предлагается первые 7 дней

// ---- Сезонный пропуск: 15 ступеней, опыт пропуска копится за забеги и задания в течение сезона
const PASS_TIER_XP = 150;
const PASS_TIERS = Array.from({ length: 15 }, (_, i) => {
  const n = i + 1;
  return {
    tier: n, xp: n * PASS_TIER_XP,
    free: n % 5 === 0 ? { coins: 600 + n * 40 } : { coins: 100 + n * 20 },
    prem: n === 15 ? { coins: 3000, skin: "pass_phoenix" } : n % 5 === 0 ? { coins: 1500 + n * 60 } : { coins: 300 + n * 50 }
  };
});

// ---- Турнир выходных: призы по местам
const TOUR_PRIZES = [
  { rank: 1,  coins: 5000, skin: "tour_gold",   label: "1 место" },
  { rank: 3,  coins: 2500, skin: "tour_silver", label: "Топ-3" },
  { rank: 10, coins: 1000, skin: null,          label: "Топ-10" },
  { rank: 50, coins: 300,  skin: null,          label: "Топ-50" }
];
// ---- Кланы
const CLAN = { createCost: 3000, maxMembers: 30, topCount: 20, rewards: [1500, 1000, 600], emojis: ["🐍", "🐉", "🦂", "🦊", "🐺", "🦅", "🔥", "⚡", "💎", "🌙", "☠️", "👑"] };

// ---- Режим «Уровни»: главы и награды
const CHAPTERS = [
  { n: 1, name: "Сад",        emoji: "🌿", skin: "lv_garden" },
  { n: 2, name: "Подземелье", emoji: "🗝️", skin: "lv_dungeon" },
  { n: 3, name: "Вулкан",     emoji: "🌋", skin: "lv_volcano" }
];
const levelFirstReward = (n) => 100 + n * 20;           // монет за первое прохождение уровня
const levelStarReward = (n) => 40 + Math.ceil(n / 10) * 30; // монет за каждую новую звезду

module.exports = {
  CHAPTERS, levelFirstReward, levelStarReward,
  MISSION_POOL, WEEKLY_POOL, MISSION_BY_ID, PRODUCTS, STARTER, PASS_TIERS, PASS_TIER_XP, TOUR_PRIZES, CLAN,
  ARTIFACT_UPGRADE_COST, MISSIONS, SKIN_CATALOG, SKIN_BY_ID, ARTIFACT_CATALOG, ARTIFACT_BY_ID, FIELD_CATALOG, FIELD_BY_ID, ACHIEVEMENTS, ACCESSORY_CATALOG, ACC_BY_ID,
  currentSeasonBounds, weeklySkinFor, weeklySkinById, skinDef, skinPalette, catalogFor
};
