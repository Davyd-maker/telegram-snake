// Новости обновлений. После выкладки новой версии бот один раз рассылает новость CURRENT всем, кто не отключил
// сообщения (ANNOUNCE_UPDATES=off — не рассылать), а в игре при первом входе показывается окно «Что нового».
// Новая версия: добавь запись в NEWS и поменяй CURRENT. Лимит Telegram — 4096 символов; лучше коротко.
const CURRENT = "28";

const NEWS = {
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
