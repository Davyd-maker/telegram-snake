// Новости обновлений. После выкладки новой версии бот один раз рассылает новость CURRENT всем, кто не отключил
// сообщения (ANNOUNCE_UPDATES=off — не рассылать), а в игре при первом входе показывается окно «Что нового».
// Новая версия: добавь запись в NEWS и поменяй CURRENT. Лимит Telegram — 4096 символов; лучше коротко.
const CURRENT = "29";

const NEWS = {
  29: {
    title: { ru: "Новый режим — «Уровни»!", en: "New mode — Levels!" },
    ru: [
      "🕳️ 30 уровней в трёх главах: Сад, Подземелье и Вулкан",
      "🎯 Набери цель по очкам — откроется норка, заползай в неё и переходи дальше",
      "🧱 Чем дальше, тем сложнее: стены, лабиринты, живые камни и ворота по таймеру",
      "⭐ До трёх звёзд за быстрое прохождение и рейтинг по звёздам",
      "🎁 Монеты за каждый уровень и эксклюзивный скин за каждую главу",
      "🧲 Магнит переделан: теперь тянет еду прямо в рот"
    ],
    en: [
      "🕳️ 30 levels in three chapters: Garden, Dungeon and Volcano",
      "🎯 Reach the target score — a hole opens, crawl into it and move on",
      "🧱 It gets harder: walls, mazes, living rocks and timed gates",
      "⭐ Up to three stars for fast runs and a star leaderboard",
      "🎁 Coins for every level and an exclusive skin for each chapter",
      "🧲 Magnet reworked: it now pulls food right into your mouth"
    ]
  },
  28: {
    title: { ru: "Большое обновление Snake Arena!", en: "Big Snake Arena update!" },
    ru: [
      "👻 Призрак соперника: в вызове рядом едет змейка друга — его настоящий забег на том же поле",
      "🏁 Турнир выходных: одно поле для всех, призы — эксклюзивные скины-кубки",
      "🎟️ Сезонный пропуск: 15 ступеней наград за забеги и задания",
      "🛡️ Кланы: собирай команду и забирай недельные награды",
      "🎯 Новые задания каждый день и крупные — на неделю",
      "🎉 По выходным — двойные монеты, каждую неделю — режим недели с наградой ×1.5",
      "✨ Новая графика: свет, тени, волны и эффектный финал забега",
      "🌐 Игра теперь и на английском"
    ],
    en: [
      "👻 Rival ghost: in a challenge your friend's snake rides next to you — their real run on the same field",
      "🏁 Weekend tournament: one field for everyone, exclusive trophy skins as prizes",
      "🎟️ Season pass: 15 reward tiers for runs and missions",
      "🛡️ Clans: build a team and earn weekly rewards",
      "🎯 New daily missions plus big weekly ones",
      "🎉 Double coins on weekends and a mode of the week with ×1.5 rewards",
      "✨ New graphics: light, shadows, ripples and a dramatic game over",
      "🌐 The game is now available in English"
    ]
  }
};

// Текст новости для бота
function newsText(version, lang) {
  const n = NEWS[version]; if (!n) return "";
  const l = lang === "en" ? "en" : "ru";
  const tail = l === "en" ? "Tap Play and try it all! 🐍" : "Жми «Играть» и пробуй! 🐍";
  return `🆕 ${n.title[l]}\n\n${n[l].map((x) => "• " + x).join("\n")}\n\n${tail}`;
}
// Для окна «Что нового» в игре
const newsFor = (lang) => {
  const n = NEWS[CURRENT]; if (!n) return null;
  const l = lang === "en" ? "en" : "ru";
  return { version: CURRENT, title: n.title[l], items: n[l] };
};

module.exports = { CURRENT, NEWS, newsText, newsFor };
