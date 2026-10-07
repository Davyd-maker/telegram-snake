# 🐍 Telegram Snake Mini App

Готовая стартовая игра для Telegram Mini Apps.

## Что внутри

- Snake на Canvas
- Управление кнопками, клавиатурой и свайпами
- Telegram WebApp API
- Авторизация через Telegram `initData`
- SQLite база
- Личный рекорд
- Монеты за съеденную еду
- Топ-20 игроков

## 1. Установка

Нужен Node.js 20+.

```bash
npm install
```

## 2. Настройка

Скопируй `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполни:

```env
BOT_TOKEN=токен_от_BotFather
PORT=3000
WEBAPP_URL=https://твой-домен.example
```

## 3. Запуск

```bash
npm start
```

Для разработки:

```bash
npm run dev
```

Игра будет доступна на:

```text
http://localhost:3000
```

## 4. Подключение к Telegram

Для Telegram Mini App нужен публичный HTTPS-адрес.

В @BotFather:

1. Создай бота командой `/newbot`.
2. Получи BOT TOKEN.
3. Открой настройки бота.
4. Настрой Menu Button / Web App.
5. Укажи HTTPS-адрес своего приложения.

Например:

```text
https://snake.example.com
```

После этого открой бота и нажми кнопку игры.

## Важно про безопасность

Сейчас сервер проверяет подпись Telegram `initData`, поэтому игрок должен быть настоящим пользователем Telegram.

Но отправляемые клиентом `score` и `coins` нельзя считать полностью защищёнными от читов: клиентскую игру можно модифицировать.

Для полноценной коммерческой игры следующий этап — сделать серверную валидацию игрового раунда, rate limit и защиту от накрутки.
