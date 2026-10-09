// Точка входа: подключает модули из src/ и запускает сервер.
const config = require("./src/config");
const express = require("express");
const path = require("path");
const { pool, initDb } = require("./src/db");
const { tgApi } = require("./src/telegram");
const Bot = require("./src/bot");
const { ipLimit } = require("./src/middleware");

const app = express();
app.set("trust proxy", 1); // за прокси Render реальный IP клиента берётся из X-Forwarded-For
app.use(["/api", "/s"], ipLimit);
app.use(express.json({ limit: "400kb" })); // лог забега может быть до ~100 КБ
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));
require("./src/routes")(app);

async function start() {
  try {
    await initDb();
    app.listen(config.PORT, "0.0.0.0", () => console.log(`Snake Arena running on ${config.PORT} with PostgreSQL`));
    if (!config.botUsername && config.BOT_TOKEN) {
      try { config.botUsername = (await tgApi("getMe")).username || ""; console.log("BOT_USERNAME определён автоматически:", config.botUsername); }
      catch (e) { console.warn("getMe failed:", e.message); }
    }
    Bot.setupWebhook();
    Bot.startBackgroundJobs();
  } catch (e) {
    console.error("Database initialization failed:", e);
    process.exit(1);
  }
}

const shutdown = async () => { await pool.end().catch(() => {}); process.exit(0); };
// Падение процесса: сообщаем администраторам и выходим (Render перезапустит сервис)
const crash = (kind) => (e) => {
  console.error(kind, e);
  require("./src/notify").alertAdmins(`💥 Сервер упал (${kind}): ${String(e?.stack || e).slice(0, 600)}`, "crash")
    .finally(() => setTimeout(() => process.exit(1), 500));
  setTimeout(() => process.exit(1), 4000).unref();
};
process.on("uncaughtException", crash("uncaughtException"));
process.on("unhandledRejection", crash("unhandledRejection"));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
