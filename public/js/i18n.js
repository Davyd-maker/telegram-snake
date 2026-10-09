// Английская версия интерфейса. Исходные тексты в коде — русские; здесь словарь RU → EN.
// Как работает: при языке "en" наблюдатель (MutationObserver) переводит текст на странице: целые фразы — по словарю,
// фразы с числами — по шаблонам, составные строки «a · b» — по частям. Тексты на canvas переводятся через SA.i18n.t().
// Добавляешь новую русскую строку в интерфейс — добавь её сюда (без эмодзи по краям, они сохраняются сами).
(function () {
  "use strict";
  const SA = (window.SA = window.SA || {});
  const tg = window.Telegram?.WebApp;

  const D = {
    // главный экран и навигация
    "Аккаунт заблокирован за нарушение правил. Если это ошибка — напиши боту.": "Account banned for breaking the rules. If this is a mistake, message the bot.",
    "Игрок": "Player", "Готов к новому рекорду?": "Ready for a new record?", "ИГРАТЬ": "PLAY", "Рекорд": "Best", "Серия": "Streak", "Друзей": "Friends",
    "Челлендж дня": "Daily challenge", "Одно поле для всех": "Same field for everyone", "бонус за первый забег": "bonus for the first run",
    "Турнир": "Tournament", "По выходным": "Weekends", "кубки": "trophies", "Пропуск": "Pass", "Награды сезона": "Season rewards",
    "Рейтинг": "Leaderboard", "Все, друзья, режимы": "All, friends, modes", "Сезон": "Season", "Недельный топ": "Weekly top", "Кланы": "Clans",
    "Команды и награды": "Teams and rewards", "Скины": "Skins", "Оформление и артефакты": "Looks and artifacts", "Задания": "Missions", "Награды дня": "Daily rewards",
    "Достижения": "Achievements", "XP и награды": "XP and rewards", "Профиль": "Profile", "Друзья и бонусы": "Friends and bonuses", "← Назад": "← Back", "Назад": "Back",
    "Загрузка…": "Loading…", "Загрузка сезона…": "Loading season…",
    "Сегодня у всех одинаковое поле: еда и бонусы появляются в тех же местах. Режим «Классика», обычная сложность, без артефактов — побеждает мастерство.":
      "Today everyone plays the same field: food and power-ups appear in the same places. Classic mode, normal difficulty, no artifacts — skill wins.",
    "Играть челлендж": "Play the challenge", "Лучшие сегодня": "Today's best", "Турнир выходных": "Weekend tournament", "Сезонный пропуск": "Season pass",
    "Сезонный рейтинг": "Season leaderboard", "Смотреть забег лидера": "Watch the leader's run", "История сезонов": "Season history",
    "Скины и игровые поля. Эпические — за ⭐ Telegram Stars, обычные — за монеты. Нажми на превью, чтобы посмотреть на поле.":
      "Skins and fields. Epic ones cost ⭐ Telegram Stars, regular ones cost coins. Tap a preview to see it on the field.",
    "Артефакты": "Artifacts",
    "🧲 с начала · 🔥 с 3 уровня · 👻 с 7 уровня. Прокачка до 5 уровня за монеты усиливает эффект.": "🧲 from start · 🔥 from level 3 · 👻 from level 7. Upgrading up to level 5 with coins makes the effect stronger.", "с начала": "from start", "с 3 уровня": "from level 3", "с 7 уровня": "from level 7",
    "Прокачка до 5 уровня за монеты усиливает эффект.": "Upgrading up to level 5 with coins makes the effect stronger.",
    "Задания дня": "Daily missions", "Обновляются каждый день": "Refresh every day", "Задания недели": "Weekly missions", "Крупные награды, обновляются в понедельник": "Big rewards, refresh on Monday",
    "Вызвать друга на рекорд": "Challenge a friend to beat your best", "Рекорд:": "Best:", "без стен:": "no walls:", "Монеты:": "Coins:", "Пригласи друга": "Invite a friend",
    "Поделись ссылкой — когда друг зайдёт, вы оба получите монеты.": "Share your link — when a friend joins, you both get coins.",
    "Приглашено друзей:": "Friends invited:", "Пригласить": "Invite", "Копировать": "Copy", "Мои друзья": "My friends",
    // экран старта и игра
    "Готов?": "Ready?", "Режим": "Mode", "Сложность": "Difficulty", "замедление": "slow-mo", "призрак": "ghost", "щит": "shield", "магнит": "magnet", "бомба": "bomb",
    "Артефакт на забег": "Artifact for this run", "НАЧАТЬ": "START", "Первые 2 секунды после старта и паузы змейка неуязвима": "For the first 2 seconds after start and pause the snake is invulnerable",
    "Свайп по экрану": "Swipe anywhere", "Стрелки/WASD": "Arrows/WASD", "Стрелки": "Arrows", "пропуска": "pass", "Кнопки": "Buttons", "Скрыть": "Hide", "Выйти": "Exit",
    "Игра окончена": "Game over", "Новый рекорд!": "New record!", "Очки": "Score", "Съедено": "Eaten", "Награда": "Reward", "Играть ещё": "Play again",
    "Поделиться": "Share", "Вызвать на это поле": "Challenge on this field", "Реплей забега": "Share replay", "В меню": "Menu",
    "Пауза": "Paused", "ПАУЗА": "PAUSED", "Очки:": "Score:", "после продолжения — отсчёт 3-2-1": "3-2-1 countdown after resuming", "Продолжить": "Resume", "Настройки": "Settings",
    "Завершить и выйти в меню": "End run and go to menu",
    "Звук": "Sound", "Громкость": "Volume", "Вибрация": "Vibration", "Сообщения от бота": "Bot messages", "друг побил рекорд, вызовы, рейтинг": "friend beat your record, challenges, rankings",
    "Язык": "Language", "ходов": "moves", "Награды": "Rewards", "сезон, уровни, турниры и пропуск": "season, levels, tournaments and pass", "За уровни": "For levels", "За турнир": "For tournament",
    "В пропуске": "In the pass", "🏆 Этот скин можно получить только как награду": "🏆 This skin is only available as a reward", "Уровни": "Levels", "30 уровней": "30 levels", "набери цель и заползи в норку": "reach the target and crawl into the hole",
    "Звёзды — за скорость прохождения": "Stars are for speed", "Глава": "Chapter", "награда за главу": "chapter reward", "Сад": "Garden", "Подземелье": "Dungeon", "Вулкан": "Volcano",
    "Лучшие по звёздам": "Top by stars", "ур.": "lvl", "Пока никто не прошёл ни одного уровня": "No one has completed a level yet", "Сначала пройди предыдущий уровень": "Complete the previous level first",
    "Стены и коридоры": "Walls and corridors", "Открытое поле": "Open field", "Живые камни: появляются и исчезают": "Living rocks: they appear and vanish",
    "Ворота закрываются по таймеру — мигают перед закрытием": "Gates close on a timer — they blink before closing", "финал главы": "chapter finale", "Цель": "Target",
    "очков, затем заползи в норку": "points, then crawl into the hole", "быстрее {n} ходов": "under {n} moves", "быстрее {n}": "under {n}", "За новую звезду": "Per new star",
    "За прохождение": "For completing", "за звезду": "per star", "цель": "target", "потом в норку": "then into the hole", "Норка открыта!": "Hole open!",
    "🕳️ Норка открыта — заползай!": "🕳️ The hole is open — crawl in!", "в норку!": "into the hole!", "пройден!": "complete!", "не пройден": "failed",
    "Пройти быстрее": "Beat it faster", "Ещё раз": "Try again", "Уровень пройден впервые": "Level completed for the first time", "Новый рекорд звёзд": "New star record",
    "Глава пройдена! Скин": "Chapter complete! Skin", "за уровень": "for the level", "Следующий уровень": "Next level", "Карта уровней": "Level map", "Играть": "Play",
    "Садовник": "Gardener", "Страж подземелья": "Dungeon keeper", "Повелитель лавы": "Lava lord", "За прохождение главы «Сад»": "For completing the Garden chapter",
    "За прохождение главы «Подземелье»": "For completing the Dungeon chapter", "За прохождение главы «Вулкан»": "For completing the Volcano chapter",
    "Набери цель и заползи в норку": "Reach the target and crawl into the hole", "Что нового": "What's new", "Круто, играть!": "Cool, let's play!",
    "новости игры, друг побил рекорд, вызовы, рейтинг": "game news, friend beat your record, challenges, rankings", "Настройки сохраняются на этом устройстве.": "Settings are saved on this device.", "Готово": "Done", "Превью": "Preview", "Купить": "Buy",
    "Дальше": "Next", "Отмена": "Cancel", "Да": "Yes", "Админка": "Admin", "Закрыть": "Close", "Игровое поле Snake": "Snake game field", "Вверх": "Up", "Влево": "Left", "Вниз": "Down", "Вправо": "Right",
    "Превью на поле": "Field preview", "Посмотреть на поле": "See on the field", "Посмотреть поле": "See the field", "на поле": "on field", "посмотреть": "preview",
    // сообщения
    "Сессия устарела — закрой и открой игру заново": "Session expired — close and reopen the game", "Слишком часто — подожди немного": "Too fast — wait a moment",
    "ты ещё не играл": "you haven't played yet", "Серия прервалась — начинаем с 1-го дня 😢": "Streak broken — starting from day 1 😢",
    "Заходи каждый день — награда растёт. Пропустишь день — серия сбросится.": "Come back every day — the reward grows. Miss a day and the streak resets.",
    "Награда получена! Возвращайся завтра за следующей.": "Reward claimed! Come back tomorrow for the next one.", "Ежедневная награда": "Daily reward",
    "Приходи завтра": "Come back tomorrow", "Забрать": "Claim", "Награда получена!": "Reward claimed!", "Не удалось получить награду": "Couldn't claim the reward",
    "Тебя пригласил:": "Invited by:", "Новых друзей:": "New friends:", "Вызов уже недоступен": "This challenge is no longer available", "Этот вызов уже принят": "This challenge was already taken",
    "Друг": "Friend", "заработано": "earned", "Пока никого. Отправь ссылку другу — и он появится здесь 🐍": "No one yet. Send your link to a friend and they'll show up here 🐍",
    "Уровень": "Level", "до следующего": "to next", "Награда получена": "Reward claimed", "Готово — забери награду!": "Done — claim your reward!", "Пока не выполнено": "Not done yet",
    "Достижение!": "Achievement!", "Не удалось забрать награду": "Couldn't claim the reward", "Ссылка скопирована 📋": "Link copied 📋", "Скопируй ссылку вручную": "Copy the link manually",
    "Сначала сыграй хотя бы один раунд": "Play at least one round first", "Не удалось создать вызов": "Couldn't create the challenge",
    "Все": "All", "Друзья": "Friends", "Режимы": "Modes", "Не удалось загрузить рейтинг. Проверь соединение.": "Couldn't load the leaderboard. Check your connection.",
    "Лучшие рекорды за всё время": "All-time best scores", "«Классика»": "Classic", "Ты и твои друзья": "You and your friends", "приглашённые и соперники по вызовам": "invited friends and challenge rivals",
    "Пригласи друзей или брось вызов — и они появятся здесь": "Invite friends or challenge someone — they'll show up here", "Отдельный рейтинг режима": "Separate leaderboard for",
    "без лёгкой сложности": "easy difficulty excluded", "Твоё место": "Your place", "ты": "you", "Пока пусто — позови друзей 🐍": "Empty for now — invite friends 🐍", "Пока пусто — стань первым! 🐍": "Empty for now — be the first! 🐍",
    "сезон завершён": "season over", "игр.": "players", "Пока нет завершённых сезонов с твоим участием": "No finished seasons with you yet", "до": "until", "До конца:": "Time left:",
    "Забрать награду": "Claim reward", "Награда за прошлый сезон получена": "Last season's reward claimed", "получен!": "received!", "Награда уже получена": "Reward already claimed",
    "Друзья ещё не играли в этом сезоне": "Your friends haven't played this season yet", "Сезон только начался — стань первым!": "The season just started — be the first!",
    "Не удалось загрузить. Проверь соединение.": "Couldn't load. Check your connection.", "одно поле для всех": "same field for everyone", "Твой лучший результат:": "Your best:",
    "место": "place", "попыток": "attempts", "Первый забег дня:": "First run of the day:", "бонусом": "bonus", "Сегодня ещё никто не играл — будь первым!": "No one has played today — be the first!",
    "XP пропуска": "pass XP", "Откроется на уровне": "Unlocks at level", "Артефакт ещё не открыт": "Artifact not unlocked yet", "Не хватает монет": "Not enough coins",
    "Улучшить": "Upgrade", "уровень": "level", "Не удалось улучшить": "Couldn't upgrade", "Открыт": "Unlocked", "Эксклюзив сезона": "Season exclusive", "Бесплатно": "Free",
    "Выбрано": "Selected", "Выбрать": "Select", "Награда сезона": "Season reward", "Открыто": "Unlocked", "Включено": "On", "Включить": "Use",
    "скин недели и эксклюзивы за топ рейтинга": "skin of the week and top-ranking exclusives", "Эпические скины": "Epic skins", "за Telegram Stars": "for Telegram Stars",
    "Обычные скины": "Regular skins", "за монеты": "for coins", "Игровые поля": "Game fields", "Простые поля": "Simple fields",
    "Этот скин можно получить только за сезонную награду": "This skin is only available as a season reward", "Скин выбран!": "Skin selected!", "Скин куплен! 🎉": "Skin purchased! 🎉",
    "Не получилось, попробуй ещё раз": "Something went wrong, try again", "Оплата Stars работает только внутри Telegram": "Stars payments only work inside Telegram",
    "Оплата пока недоступна": "Payments are not available yet", "Не удалось создать счёт": "Couldn't create the invoice", "Оплата прошла! Включаем поле…": "Payment done! Turning on the field…",
    "Оплата прошла! Активируем скин…": "Payment done! Activating the skin…", "Платёж обрабатывается — покупка появится через минуту": "Payment is processing — your purchase will appear in a minute",
    "Оплата не удалась": "Payment failed", "Поле включено!": "Field on!", "Поле куплено! 🎉": "Field purchased! 🎉", "Скин змейки": "Snake skin", "Игровое поле": "Game field",
    "Уже выбрано": "Already selected", "Только за сезон": "Season reward only", "Монеты за забеги": "Coins per run", "Турнир выходных идёт!": "Weekend tournament is live!",
    "призы — эксклюзивные кубки": "prizes: exclusive trophies", "Режим недели": "Mode of the week", "награда": "reward", "итоговая награда": "total reward", "Забрать за": "Get it for",
    "Уже куплено": "Already purchased", "Оплата прошла! Активируем…": "Payment done! Activating…", "Премиум-пропуск активирован!": "Premium pass activated!", "Набор новичка получен!": "Starter pack received!",
    "скин": "skin", "ступень": "tier", "Опыт пропуска": "Pass XP", "за забеги и задания": "from runs and missions", "Премиум активен — забирай награды второй дорожки": "Premium is active — claim the second track rewards",
    "Премиум-пропуск": "Premium pass", "Премиум": "Premium", "Новый скин!": "New skin!", "Турнир идёт до конца воскресенья": "The tournament runs until the end of Sunday",
    "Твой лучший": "Your best", "Ты ещё не играл — у всех одно поле, сыграй сколько угодно раз": "You haven't played yet — same field for all, play as many times as you like",
    "Играть турнир": "Play the tournament", "Пока никто не играл — стань первым!": "No one has played yet — be the first!", "Следующий турнир — в субботу": "Next tournament: Saturday",
    "Одно поле для всех, без артефактов, лучший результат за выходные.": "Same field for everyone, no artifacts, best score over the weekend.", "Призы": "Prizes",
    "Прошлый турнир": "Last tournament", "Забрать приз за": "Claim prize for", "приз получен": "prize claimed", "Не удалось забрать приз": "Couldn't claim the prize", "Вступить": "Join",
    "Место за неделю": "Weekly place", "очки": "points", "Позвать в клан": "Invite to clan",
    "Очки клана — сумма лучших результатов сезона у топ-{n} участников. Топ-3 клана недели: каждому участнику": "Clan score = sum of season bests of the top {n} members. Top-3 clans of the week: every member gets",
    "Поиск по названию или тегу": "Search by name or tag", "Кланов пока нет — создай первый!": "No clans yet — create the first one!", "Создать клан": "Create a clan",
    "Название (3–20 символов)": "Name (3–20 characters)", "Тег (2–4)": "Tag (2–4)", "Создать": "Create", "Создать клан за {n} 🪙?": "Create a clan for {n} 🪙?",
    "Клан создан!": "Clan created!", "Не удалось создать клан": "Couldn't create the clan", "Выйти из клана?": "Leave the clan?", "🛡️ Вступай в мой клан {clan} в Snake Arena!": "🛡️ Join my clan {clan} in Snake Arena!",
    "Свайпай в любом месте экрана — змейка повернёт. Можно вести пальцем серию поворотов.": "Swipe anywhere on the screen to turn. You can chain turns without lifting your finger.",
    "Ешь яблоки подряд — растёт комбо и множитель очков. Монеты и звёзды дают больше.": "Eat apples in a row to build a combo and a score multiplier. Coins and stars give more.",
    "Подбирай бонусы: ⏳ замедление, 💎 ×2, 👻 призрак, 🛡️ щит, 🧲 магнит, 💣 бомба.": "Grab power-ups: ⏳ slow-mo, 💎 ×2, 👻 ghost, 🛡️ shield, 🧲 magnet, 💣 bomb.",
    "Первые 2 секунды змейка неуязвима. Не врезайся в стены и в себя — удачи!": "The snake is invulnerable for the first 2 seconds. Don't hit walls or yourself — good luck!",
    "Играть!": "Play!", "Не удалось создать ссылку": "Couldn't create the link", "▶ Посмотри мой забег в Snake Arena: {n} очков!": "▶ Watch my Snake Arena run: {n} points!",
    "Фантом!": "Phantom!", "Щит!": "Shield!", "Вызов": "Challenge", "Аккаунт заблокирован": "Account banned", "Турнир сейчас не идёт": "No tournament right now",
    "Нет связи с сервером — этот забег не будет засчитан": "No connection to the server — this run won't count", "Завершить забег и выйти в меню?": "End the run and go to the menu?",
    "Завершить": "End", "Играть дальше": "Keep playing", "Игра завершена": "Run ended", "Поле заполнено!": "Field complete!", "челлендж дня": "daily challenge",
    "вне общего рейтинга": "not ranked", "Проверяем забег…": "Verifying the run…", "Забег не засчитан: нет связи с сервером": "Run not counted: no connection to the server",
    "Твоё место сегодня:": "Your place today:", "бонус": "bonus", "Вызов выигран:": "Challenge won:", "Вызов проигран:": "Challenge lost:", "против": "vs", "Место в турнире:": "Tournament place:",
    "Забег засчитан": "Run counted", "событие": "event", "режим недели": "mode of the week", "Игра обновилась — перезапусти её": "The game was updated — please restart it",
    "Сессия устарела — перезапусти игру": "Session expired — restart the game", "Этот забег уже засчитан": "This run was already counted",
    "Забег не прошёл проверку и не засчитан": "The run failed verification and wasn't counted", "Готовим карточку…": "Preparing the card…",
    "Слишком много карточек, попробуй позже": "Too many cards, try later", "Не удалось создать карточку": "Couldn't create the card", "Реплея пока нет": "No replay yet",
    "Не удалось загрузить реплей": "Couldn't load the replay", "Реплей повреждён": "Replay is corrupted", "Реплей": "Replay", "очк.": "pts", "очк": "pts", "Реплей окончен": "Replay finished", "очков": "points",
    "на лёгкой — вне рейтинга": "unranked on easy", "Ты в клане!": "You're in the clan!", "Не удалось вступить": "Couldn't join", "Исключить игрока из клана?": "Remove this player from the clan?",
    "Исключить": "Remove", "🐍 Играй со мной в Snake Arena! Заходи по ссылке — получишь бонусные монеты 🪙": "🐍 Play Snake Arena with me! Join via my link and get bonus coins 🪙",
    "Язык: русский": "Язык: русский", "Сможешь побить?": "Can you beat it?", "Вызвать друга": "Challenge a friend",
    // режимы, сложность, бонусы
    "Классика": "Classic", "Стены смертельны": "Walls are deadly", "идёт в рейтинг и сезон": "counts for leaderboard and season", "Без стен": "No walls", "Стены проходимы": "Walls wrap around",
    "Камни": "Rocks", "Случайные камни на поле": "Random rocks on the field", "Лабиринт": "Maze", "Фиксированные стены": "Fixed walls", "Живые стены": "Living walls",
    "Камни появляются и исчезают": "Rocks appear and vanish", "Лёгкая": "Easy", "Обычная": "Normal", "Сложная": "Hard",
    "Замедление": "Slow-mo", "×2 очки": "×2 points", "Призрак": "Ghost", "Щит": "Shield", "Магнит": "Magnet", "Бомба": "Bomb",
    // задания и достижения
    "Набери 50 очков за раунд": "Score 50 in one round", "Набери 100 очков за раунд": "Score 100 in one round", "Набери 200 очков за раунд": "Score 200 in one round",
    "Сыграй 3 раунда": "Play 3 rounds", "Сыграй 6 раундов": "Play 6 rounds", "Съешь 30 яблок": "Eat 30 apples", "Съешь 80 яблок": "Eat 80 apples",
    "Съешь 3 золотые звезды": "Eat 3 golden stars", "Сделай комбо ×5": "Make a ×5 combo", "Сделай комбо ×8": "Make a ×8 combo", "Подбери 3 бонуса на поле": "Pick up 3 power-ups",
    "Собери 150 монет на поле": "Collect 150 coins on the field", "Набери 20 очков в «Камнях»": "Score 20 in Rocks", "Набери 20 очков в «Лабиринте»": "Score 20 in Maze",
    "Набери 20 очков в «Живых стенах»": "Score 20 in Living walls", "Сыграй челлендж дня": "Play the daily challenge", "Набери 30 очков на сложной": "Score 30 on Hard",
    "Сыграй 25 раундов за неделю": "Play 25 rounds this week", "Съешь 300 яблок за неделю": "Eat 300 apples this week", "Съешь 20 золотых звёзд": "Eat 20 golden stars",
    "Подбери 20 бонусов": "Pick up 20 power-ups", "Сыграй челлендж дня 4 раза": "Play the daily challenge 4 times", "Сыграй 6 раундов в особых режимах": "Play 6 rounds in special modes",
    "Съешь 30 яблок ": "Eat 30 apples", "Первый забег": "First run", "100 яблок": "100 apples", "500 очков": "500 points", "Комбо ×5": "Combo ×5", "5 друзей": "5 friends",
    // скины и поля
    "Огненная": "Fire", "Сакура": "Sakura", "Океан": "Ocean", "Ледяная": "Ice", "Токсик": "Toxic", "Закат": "Sunset", "Золотая": "Gold", "Кибер": "Cyber",
    "Радуга": "Rainbow", "Переливается всеми цветами": "Shimmers with every color", "Галактика": "Galaxy", "Мерцающие звёзды по телу": "Twinkling stars along the body",
    "Дракон": "Dragon", "Огонь и искры за хвостом": "Fire and sparks behind the tail", "Алмаз": "Diamond", "Сверкающие грани и блики": "Sparkling facets and glints",
    "Аврора": "Aurora", "Северное сияние переливается по телу": "Northern lights shimmer along the body", "Самурай": "Samurai", "Алый клинок и искры за хвостом": "Crimson blade and sparks",
    "Пустота": "Void", "Тёмная энергия и фиолетовое свечение": "Dark energy and violet glow", "Призма": "Prism", "Радужные грани и кристальные вспышки": "Rainbow facets and crystal flashes",
    "Корона сезона": "Season crown", "Эксклюзив за 1-е место сезона": "Exclusive for 1st place in a season", "Фантом сезона": "Season phantom", "Эксклюзив за топ-3 сезона": "Exclusive for a season top 3",
    "Неоновый мастер": "Neon master", "Эксклюзив за топ-10 сезона": "Exclusive for a season top 10", "Феникс": "Phoenix", "Награда премиум-пропуска сезона": "Premium season pass reward",
    "Золотой кубок": "Gold trophy", "Победителю турнира выходных": "For the weekend tournament winner", "Серебряный кубок": "Silver trophy", "За топ-3 турнира выходных": "For a weekend tournament top 3",
    "Подтягивает еду по прямой (радиус растёт с уровнем).": "Pulls food in a straight line (range grows with level).",
    "Тянет еду перед змейкой прямо в рот (радиус 2 → 4 клетки с уровнем).": "Pulls food in front of the snake right into its mouth (range 2 → 4 cells with level).", "Берсерк": "Berserk",
    "После 3+ комбо каждый предмет даёт +25% очков и больше с уровнем.": "After a 3+ combo each item gives +25% points, more with level.", "Фантом": "Phantom",
    "Спасает от столкновения (раз за забег, больше с уровнем).": "Saves you from a crash (once per run, more with level).",
    "Стандартное зелёное поле": "Standard green field", "Графит": "Graphite", "Простое тёмное поле": "Simple dark field", "Неон": "Neon", "Светящаяся сетка и сканер": "Glowing grid and scanner",
    "Мороз": "Frost", "Ледяное поле, идёт снег": "Icy field with falling snow", "Пустыня": "Desert", "Тёплый песок и закат": "Warm sand and sunset", "Лава": "Lava", "Жар поднимается снизу": "Heat rising from below",
    "Космос": "Space", "Мерцающие звёзды": "Twinkling stars", "Сияющие волны северного света": "Shining waves of northern light", "Киберпанк": "Cyberpunk",
    "Неоновый мегаполис и сканирующая сетка": "Neon megacity and scanning grid", "Вулкан": "Volcano", "Лава, пепел и раскалённые трещины": "Lava, ash and glowing cracks",
    "Кристалл": "Crystal", "Кристаллическая арена с сиянием": "Glowing crystal arena", "Нефритовый дух": "Jade spirit", "Розовый комет": "Pink comet", "Лазурный шторм": "Azure storm",
    "Солнечный рейдер": "Solar raider", "Астральный кристалл": "Astral crystal", "Токсичный спектр": "Toxic spectrum", "Лунный призрак": "Moon ghost", "Алый феникс": "Scarlet phoenix",
    "Уникальный скин недели. После окончания сезона получить его нельзя.": "Unique skin of the week. Can't be obtained after the season ends.",
    "Премиум-пропуск сезона": "Premium season pass", "Вторая дорожка наград сезона и скин «Феникс»": "Second reward track and the Phoenix skin", "Набор новичка": "Starter pack",
    "5 000 🪙, скин «Кибер» и магнит 2-го уровня": "5,000 🪙, the Cyber skin and a level-2 magnet",
    "1 место": "1st place", "Топ-3": "Top 3", "Топ-10": "Top 10", "Топ-50": "Top 50", "Топ-1": "Top 1", "скин недели + Корона сезона": "skin of the week + Season crown",
    "Двойные монеты выходных": "Weekend double coins", "Неделя": "Week",
    // ошибки сервера
    "Название: 3–20 символов": "Name: 3–20 characters", "Тег: 2–4 буквы или цифры": "Tag: 2–4 letters or digits", "Сначала выйди из своего клана": "Leave your current clan first",
    "Такое название или тег уже заняты": "That name or tag is taken", "Клан заполнен": "The clan is full", "Нельзя исключить себя": "You can't remove yourself"
  };

  // Фразы с числами и названиями: [регулярка, перевод ($1, $2…)]
  const P = [
    [/^Сезон #(\d+) — место (\d+)$/, "Season #$1 — place $2"], [/^Сезон #(\d+) — ты ещё не играл$/, "Season #$1 — you haven't played yet"],
    [/^Ежедневная награда · 🔥 серия (\d+)$/, "Daily reward · 🔥 streak $1"], [/^Д(\d+)$/, "D$1"],
    [/^Забрать \+(\d+) 🪙$/, "Claim +$1 🪙"], [/^\+(\d+) 🪙 Награда получена!$/, "+$1 🪙 Reward claimed!"],
    [/^За каждого друга: \+(\d+) 🪙 вам и \+(\d+) 🪙 другу\.$/, "For each friend: +$1 🪙 for you and +$2 🪙 for them."],
    [/^(.+) вызывает тебя!$/, "$1 challenges you!"], [/^Побей (\d+) очков$/, "Beat $1 points"], [/^то же поле$/, "same field"], [/^Принять вызов$/, "Accept the challenge"],
    [/^Уровень (\d+)$/, "Level $1"], [/^до следующего (\d+)$/, "to next $1"],
    [/^Побей мой результат в Snake Arena: (\d+) очков \((.+)\) — на том же поле!$/, "Beat my Snake Arena score: $1 points ($2) — on the same field!"],
    [/^Ты и твои друзья \((\d+)\): приглашённые и соперники по вызовам$/, "You and your friends ($1): invited friends and challenge rivals"],
    [/^Отдельный рейтинг режима (.+) \(без лёгкой сложности\)$/, "Separate leaderboard for $1 (easy excluded)"],
    [/^Сезон #(\d+)$/, "Season #$1"], [/^(\d+) д$/, "$1 d"], [/^(\d+) игр\.$/, "$1 players"],
    [/^Забрать награду · (.+) \(#(\d+)\)$/, "Claim reward · $1 (#$2)"], [/^Награда за прошлый сезон получена \((.+)\)$/, "Last season's reward claimed ($1)"],
    [/^(.+) получен!$/, "$1 received!"], [/^Первый забег дня: \+(\d+) 🪙 бонусом$/, "First run of the day: +$1 🪙 bonus"],
    [/^\+(\d+) 🪙 · \+(\d+) XP пропуска$/, "+$1 🪙 · +$2 pass XP"], [/^Откроется на уровне (\d+)$/, "Unlocks at level $1"], [/^Уровень (\d+)$/, "Level $1"],
    [/^Улучшить «(.+)» до уровня (\d+) за (.+) 🪙\?$/, "Upgrade “$1” to level $2 for $3 🪙?"], [/^(.+): уровень (\d+)!$/, "$1: level $2!"],
    [/^Купить · ⭐ (\d+)$/, "Buy · ⭐ $1"], [/^Купить · 🪙 (.+)$/, "Buy · 🪙 $1"], [/^Купить скин «(.+)» за (.+) 🪙\?$/, "Buy the “$1” skin for $2 🪙?"],
    [/^Купить поле «(.+)» за (.+) 🪙\?$/, "Buy the “$1” field for $2 🪙?"], [/^Поле «(.+)» твоё!$/, "The “$1” field is yours!"], [/^Скин «(.+)» твой!$/, "The “$1” skin is yours!"],
    [/^Завершить забег\? (\d+) очк\. будут засчитаны\.$/, "End the run? $1 points will be counted."], [/^Игра завершена · \+(\d+) 🪙$/, "Run ended · +$1 🪙"],
    [/^Твоё место сегодня: #(\d+)$/, "Your place today: #$1"], [/^бонус \+(\d+) 🪙$/, "bonus +$1 🪙"], [/^Вызов выигран: (.+)$/, "Challenge won: $1"],
    [/^Вызов проигран: (\d+) против (\d+)$/, "Challenge lost: $1 vs $2"], [/^Место в турнире: #(\d+)$/, "Tournament place: #$1"],
    [/^×([\d.]+) событие$/, "×$1 event"], [/^×([\d.]+) режим недели$/, "×$1 mode of the week"], [/^\+(\d+) XP пропуска$/, "+$1 pass XP"],
    [/^Реплей окончен · (.+): (\d+) очков$/, "Replay finished · $1: $2 points"], [/^итоговая награда ×([\d.]+)$/, "total reward ×$1"], [/^награда ×([\d.]+)$/, "reward ×$1"],
    [/^Твой лучший результат: (\d+)$/, "Your best: $1"], [/^место #(\d+)$/, "place #$1"], [/^попыток (\d+)$/, "attempts $1"], [/^Твоё место: #(\d+)$/, "Your place: #$1"],
    [/^(\d+) октября$/, "October $1"], [/^Неделя (\d{4}-\d\d-\d\d)$/, "Week $1"], [/^до (\d+)$/, "until $1"]
  ];

  const CYR = /[А-Яа-яЁё]/;
  let lang = "ru";
  try {
    const saved = localStorage.getItem("snakeLang");
    const code = tg?.initDataUnsafe?.user?.language_code || navigator.language || "ru";
    lang = saved === "en" || saved === "ru" ? saved : /^(ru|uk|be|kk|uz|ky|tg|hy|az|ka)/i.test(code) ? "ru" : "en";
  } catch (e) {}

  const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? "")) : s);
  // Перевод одной строки: целиком → по шаблону → «эмодзи + ядро + хвост» → по частям через « · »
  function tr(s) {
    if (!s || !CYR.test(s)) return s;
    if (D[s] !== undefined) return D[s];
    for (const [re, rep] of P) if (re.test(s)) return s.replace(re, rep);
    // эмодзи в начале строки — переводим остаток
    const em = /^([\p{Extended_Pictographic}\uFE0F\u200D\s]+)(.+)$/u.exec(s);
    if (em) { const r = tr(em[2]); if (r !== em[2]) return em[1] + r; }
    const m = /^([^А-Яа-яЁё«]*)(.*?)([^А-Яа-яЁё»]*)$/.exec(s);
    if (m && (m[1] || m[3]) && m[2]) {
      const core = m[2];
      if (D[core] !== undefined) return m[1] + D[core] + m[3];
      for (const [re, rep] of P) if (re.test(core)) return m[1] + core.replace(re, rep) + m[3];
    }
    for (const sep of [" · ", ": ", " — "]) {
      if (s.includes(sep)) { const parts = s.split(sep), out = parts.map(tr); if (out.some((x, i) => x !== parts[i])) return out.join(sep); }
    }
    return s;
  }
  function t(s, params) {
    if (lang !== "en") return fill(s, params);
    const key = String(s);
    return fill(D[key] !== undefined ? D[key] : tr(key), params);
  }

  // ---------- перевод страницы ----------
  function translateNode(n) {
    if (n.nodeType === 3) {
      const v = n.nodeValue; if (!CYR.test(v)) return;
      const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0], core = v.trim();
      const out = tr(core); if (out !== core) n.nodeValue = lead + out + trail;
    } else if (n.nodeType === 1) {
      if (n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
      for (const a of ["placeholder", "aria-label", "title"]) { const v = n.getAttribute(a); if (v && CYR.test(v)) n.setAttribute(a, tr(v)); }
      for (const c of n.childNodes) translateNode(c);
    }
  }
  function start() {
    document.documentElement.lang = lang;
    if (lang !== "en") return;
    translateNode(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") translateNode(m.target);
        else if (m.type === "attributes") translateNode(m.target);
        else for (const n of m.addedNodes) translateNode(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
  }

  SA.i18n = {
    t, lang: () => lang, locale: () => (lang === "en" ? "en-US" : "ru-RU"),
    set(l, persist) {
      if (!["ru", "en"].includes(l) || l === lang) return;
      if (persist) { try { localStorage.setItem("snakeLang", l); } catch (e) {} location.reload(); return; }
      lang = l; start();
    }
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
