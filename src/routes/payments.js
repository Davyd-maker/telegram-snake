const config = require("../config");
const C = require("../catalog");
const { tgApi } = require("../telegram");
const { player } = require("../middleware");
const { handleUpdate } = require("../bot");
const { pool } = require("../db");
const { ensureSeason } = require("../seasons");

module.exports = (app) => {
  // Создаёт ссылку на счёт в Stars. Клиент открывает её через Telegram.WebApp.openInvoice
  // Создаёт ссылку на счёт в Stars. Клиент открывает её через Telegram.WebApp.openInvoice
  app.post("/api/invoice", player(async (req, res, { p, u, uid }) => {
    const b = req.body || {};
    let title, description, payload, def;
    if (b.product) {
      def = C.PRODUCTS[String(b.product)];
      if (!def) return res.status(400).json({ error: "Bad product" });
      let ref = 0;
      if (def.id === "pass") {
        const season = await ensureSeason();
        ref = season.id;
        const pr = await pool.query(`SELECT premium FROM season_pass WHERE season_id=$1 AND telegram_id=$2`, [ref, uid]);
        if (pr.rows[0]?.premium) return res.status(400).json({ error: "Already owned" });
      }
      if (def.id === "starter" && p.starter_bought) return res.status(400).json({ error: "Already owned" });
      title = def.name; description = `${def.emoji} ${def.desc}`; payload = `product:${def.id}:${ref}:${u.id}`;
    } else {
      const kind = b.field ? "field" : b.accessory ? "acc" : "skin";
      def = kind === "field" ? C.FIELD_BY_ID[String(b.field || "")] : kind === "acc" ? C.ACC_BY_ID[String(b.accessory || "")] : C.SKIN_BY_ID[String(b.skin || "")];
      if (!def || def.currency !== "stars") return res.status(400).json({ error: kind === "field" ? "Bad field" : kind === "acc" ? "Bad accessory" : "Bad skin" });
      const have = kind === "field" ? p.owned_fields : kind === "acc" ? p.owned_accessories : p.owned_skins;
      if ((have || []).includes(def.id)) return res.status(400).json({ error: "Already owned" });
      title = kind === "field" ? `Поле «${def.name}»` : kind === "acc" ? `Аксессуар «${def.name}»` : `Скин «${def.name}»`;
      description = `${def.emoji} ${def.desc || (kind === "field" ? "Игровое поле" : kind === "acc" ? "Аксессуар для змейки — носится с любым скином" : "Эпический скин змейки")} — навсегда в Snake Arena`;
      payload = `${kind}:${def.id}:${u.id}`;
    }
    try {
      const url = await tgApi("createInvoiceLink", {
        title, description, payload,
        currency: "XTR", // Telegram Stars; provider_token для Stars не нужен
        prices: [{ label: def.name, amount: def.price }]
      });
      res.json({ url });
    } catch (e) {
      console.error("invoice error", e.message);
      res.status(500).json({ error: "Invoice error" });
    }
  }, { limit: [8, 60000] }));

  app.post("/telegram/webhook", (req, res) => {
    if (!config.WEBHOOK_SECRET || req.get("X-Telegram-Bot-Api-Secret-Token") !== config.WEBHOOK_SECRET) return res.sendStatus(403);
    res.sendStatus(200);
    handleUpdate(req.body || {}).catch((e) => console.error("webhook error", e.message));
  });
};
