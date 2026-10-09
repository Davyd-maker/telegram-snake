// Тексты бота на русском и английском. Язык игрока — players.lang ("ru" | "en"), берётся из Telegram.
const T = {
  ru: {
    start: "🐍 Snake Arena — собирай яблоки, копи серию, бей рекорды!",
    start_challenge: "⚔️ Тебя вызвали на дуэль в Snake Arena! Жми «Играть» и побей результат друга — на том же поле.",
    start_replay: "▶ Тебе прислали забег в Snake Arena. Жми «Играть», чтобы посмотреть.",
    invited_bonus: "🎉 Тебя пригласил {name} — тебе уже начислено +{bonus} 🪙!",
    ref_joined: "🎉 {name} присоединился по твоей ссылке!\nТебе +{reward} 🪙, а другу +{bonus} 🪙",
    play: "🎮 Играть",
    claim: "🎁 Забрать награду",
    paid_field: "{emoji} Поле «{name}» твоё! Оно уже включено — запускай игру 🐍",
    paid_skin: "{emoji} Скин «{name}» твой! Он уже надет — запускай игру 🐍",
    paid_pass: "🎟️ Сезонный пропуск активирован! Забирай премиум-награды в разделе «Пропуск».",
    paid_starter: "🎁 Набор новичка получен: +5 000 🪙, скин «Кибер» и магнит 2-го уровня. Удачи!",
    reminder: "🔥 Твоя серия — {streak} дн.! Загляни в Snake Arena сегодня, иначе она сбросится.",
    season_win: "🏆 Сезон #{num} завершён! Ты на месте #{rank} с результатом {score}.\nТвоя награда: {icon} {title} и +{coins} 🪙 — забери её в игре.",
    friend_beat: "😱 {name} побил твой рекорд: {score} против твоих {mine}. Отыграешься?",
    top10_out: "⚠️ Тебя вытеснили из топ-10 сезона! Сейчас ты #{rank}. Ещё есть время вернуться.",
    challenge_done: "⚔️ {name} принял твой вызов: {score} против {mine}.\n{verdict}",
    challenge_win: "Он победил — отыграйся! 🐍",
    challenge_lose: "Ты победил! 🏆",
    tour_win: "🏁 Турнир выходных завершён! Ты на месте #{rank} с результатом {score}. Награда ждёт в игре.",
    clan_win: "🛡️ Твой клан {clan} занял #{rank} место за неделю! Каждому участнику +{coins} 🪙.",
    notify_off: "🔕 Уведомления выключены. Включить снова: /notify_on (или в настройках игры).",
    notify_on: "🔔 Уведомления включены."
  },
  en: {
    start: "🐍 Snake Arena — eat apples, keep your streak, beat records!",
    start_challenge: "⚔️ You've been challenged in Snake Arena! Tap Play and beat your friend's score — on the same field.",
    start_replay: "▶ Someone sent you a Snake Arena run. Tap Play to watch it.",
    invited_bonus: "🎉 You were invited by {name} — +{bonus} 🪙 already credited!",
    ref_joined: "🎉 {name} joined via your link!\nYou get +{reward} 🪙, your friend +{bonus} 🪙",
    play: "🎮 Play",
    claim: "🎁 Claim reward",
    paid_field: "{emoji} The “{name}” field is yours! It's already on — go play 🐍",
    paid_skin: "{emoji} The “{name}” skin is yours! It's already equipped — go play 🐍",
    paid_pass: "🎟️ Season pass activated! Claim premium rewards in the Pass section.",
    paid_starter: "🎁 Starter pack received: +5,000 🪙, the Cyber skin and a level-2 magnet. Good luck!",
    reminder: "🔥 Your streak is {streak} days! Drop by Snake Arena today or it will reset.",
    season_win: "🏆 Season #{num} is over! You placed #{rank} with {score}.\nYour reward: {icon} {title} and +{coins} 🪙 — claim it in the game.",
    friend_beat: "😱 {name} beat your record: {score} vs your {mine}. Want revenge?",
    top10_out: "⚠️ You've been pushed out of the season top 10! You're #{rank} now. There's still time.",
    challenge_done: "⚔️ {name} took your challenge: {score} vs {mine}.\n{verdict}",
    challenge_win: "They won — get your revenge! 🐍",
    challenge_lose: "You won! 🏆",
    tour_win: "🏁 The weekend tournament is over! You placed #{rank} with {score}. Your prize is waiting in the game.",
    clan_win: "🛡️ Your clan {clan} placed #{rank} this week! Every member gets +{coins} 🪙.",
    notify_off: "🔕 Notifications are off. Turn them back on: /notify_on (or in game settings).",
    notify_on: "🔔 Notifications are on."
  }
};

// Язык Telegram → язык игры: русский для русскоязычных стран, иначе английский
const langFromCode = (code) => (/^(ru|uk|be|kk|uz|ky|tg|hy|az|ka)/i.test(String(code || "")) ? "ru" : "en");

function t(lang, key, params = {}) {
  const dict = T[lang] || T.ru;
  const s = dict[key] ?? T.ru[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ""));
}

module.exports = { t, langFromCode, TEXTS: T };
