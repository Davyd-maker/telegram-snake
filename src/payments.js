const { pool } = require("./db");
const { tgApi } = require("./telegram");
const C = require("./catalog");

function parseItemPayload(payload, userId) {
  // product:<id>:<ref>:<uid> — пропуск (ref = id сезона) и набор новичка (ref = 0)
  const pm = /^product:([a-z]+):(\d+):(\d+)$/.exec(String(payload || ""));
  if (pm) {
    if (pm[3] !== String(userId) || !C.PRODUCTS[pm[1]]) return null;
    return { kind: "product", def: C.PRODUCTS[pm[1]], ref: Number(pm[2]) };
  }
  const m = /^(skin|field|acc):([a-z_]+):(\d+)$/.exec(String(payload || ""));
  if (!m || m[3] !== String(userId)) return null;
  const def = (m[1] === "field" ? C.FIELD_BY_ID : m[1] === "acc" ? C.ACC_BY_ID : C.SKIN_BY_ID)[m[2]];
  return def && def.currency === "stars" ? { kind: m[1], def } : null;
}

// Всё, что пошло не так с деньгами, попадает в админку: «Платежи → Проблемы». Оттуда покупку можно выдать вручную.
async function logPaymentError({ telegramId = "", kind, reason = "", payload = "", chargeId = "", stars = 0, raw = {} }) {
  try {
    await pool.query(
      `INSERT INTO payment_errors(telegram_id, kind, reason, payload, charge_id, stars, raw) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [String(telegramId), kind, String(reason).slice(0, 500), String(payload).slice(0, 200), String(chargeId), Number(stars) || 0, JSON.stringify(raw)]
    );
  } catch (e) { console.error("payment_errors insert failed:", e.message); }
  require("./notify").alertAdmins(`💳 Проблема с платежом: ${kind}\nИгрок ${telegramId}, ${stars} ⭐\n${String(reason).slice(0, 200)}\nПодробности — в админке, раздел «Платежи».`, "pay:" + chargeId + kind).catch(() => {});
}

async function grantPaidItem(userId, kind, def, chargeId, stars, ref = 0) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO players (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING`, [String(userId)]);
    // charge_id уникален — повторная доставка вебхука не выдаст покупку дважды
    const ins = await client.query(
      `INSERT INTO payments (charge_id, telegram_id, skin, stars) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1`,
      [chargeId, String(userId), kind === "product" ? `product:${def.id}:${ref}` : kind === "field" || kind === "acc" ? kind + ":" + def.id : def.id, stars]
    );
    if (ins.rowCount) {
      if (kind === "product" && def.id === "pass") {
        await client.query(`INSERT INTO season_pass(season_id, telegram_id, premium) VALUES($1,$2,TRUE)
                            ON CONFLICT(season_id, telegram_id) DO UPDATE SET premium=TRUE`, [ref, String(userId)]);
      } else if (kind === "product" && def.id === "starter") {
        const S = C.STARTER;
        await client.query(
          `UPDATE players SET starter_bought=TRUE, coins=coins+$1, owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$2]::TEXT[])),
             artifact_levels=jsonb_set(COALESCE(artifact_levels,'{}'::jsonb), ARRAY[$3::text], to_jsonb(GREATEST($4::int, COALESCE((artifact_levels->>$3)::int,1))), true), updated_at=NOW()
           WHERE telegram_id=$5`, [S.coins, S.skin, S.artifact, S.level, String(userId)]);
      } else if (kind === "acc") {
        await client.query(
          `UPDATE players SET accessory=$1, owned_accessories=ARRAY(SELECT DISTINCT unnest(owned_accessories || ARRAY[$1]::TEXT[])), updated_at=NOW()
           WHERE telegram_id=$2`, [def.id, String(userId)]);
      } else if (kind === "field") {
        await client.query(
          `UPDATE players SET field_skin=$1, owned_fields=ARRAY(SELECT DISTINCT unnest(owned_fields || ARRAY[$1]::TEXT[])), updated_at=NOW()
           WHERE telegram_id=$2`, [def.id, String(userId)]);
      } else {
        await client.query(
          `UPDATE players SET skin=$1, owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])), updated_at=NOW()
           WHERE telegram_id=$2`, [def.id, String(userId)]);
      }
    }
    await client.query("COMMIT");
    return !!ins.rowCount;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Возврат Stars: Telegram возвращает деньги, а мы забираем купленный предмет.
async function refundPayment(chargeId, adminId) {
  // «занимаем» платёж, чтобы двойной клик не вернул деньги дважды
  const claim = await pool.query(
    `UPDATE payments SET refunded_at=NOW(), refunded_by=$2 WHERE charge_id=$1 AND refunded_at IS NULL RETURNING *`, [chargeId, String(adminId)]);
  if (!claim.rowCount) {
    const ex = await pool.query(`SELECT 1 FROM payments WHERE charge_id=$1`, [chargeId]);
    const err = new Error(ex.rowCount ? "Already refunded" : "Payment not found");
    err.status = ex.rowCount ? 409 : 404;
    throw err;
  }
  const pay = claim.rows[0];
  try {
    await tgApi("refundStarPayment", { user_id: Number(pay.telegram_id), telegram_payment_charge_id: chargeId });
  } catch (e) {
    await pool.query(`UPDATE payments SET refunded_at=NULL, refunded_by=NULL WHERE charge_id=$1`, [chargeId]);
    const err = new Error("Telegram: " + e.message);
    err.status = 502;
    throw err;
  }
  const isField = pay.skin.startsWith("field:");
  const id = isField ? pay.skin.slice(6) : pay.skin;
  const prod = /^product:([a-z]+):(\d+)$/.exec(pay.skin);
  if (prod) {
    // возврат за товар: выключаем премиум-пропуск / забираем набор новичка (монеты — сколько осталось)
    if (prod[1] === "pass") await pool.query(`UPDATE season_pass SET premium=FALSE WHERE season_id=$1 AND telegram_id=$2`, [Number(prod[2]), pay.telegram_id]);
    if (prod[1] === "starter") await pool.query(
      `UPDATE players SET coins=GREATEST(0, coins-$1), owned_skins=array_remove(owned_skins,$2), skin=CASE WHEN skin=$2 THEN 'classic' ELSE skin END, updated_at=NOW()
       WHERE telegram_id=$3`, [C.STARTER.coins, C.STARTER.skin, pay.telegram_id]);
    return pay;
  }
  if (pay.skin.startsWith("acc:")) {
    await pool.query(
      `UPDATE players SET owned_accessories=array_remove(owned_accessories,$1), accessory=CASE WHEN accessory=$1 THEN '' ELSE accessory END, updated_at=NOW()
       WHERE telegram_id=$2`, [pay.skin.slice(4), pay.telegram_id]);
  } else if (isField) {
    await pool.query(
      `UPDATE players SET owned_fields=array_remove(owned_fields,$1), field_skin=CASE WHEN field_skin=$1 THEN 'classic' ELSE field_skin END, updated_at=NOW()
       WHERE telegram_id=$2`, [id, pay.telegram_id]);
  } else {
    await pool.query(
      `UPDATE players SET owned_skins=array_remove(owned_skins,$1), skin=CASE WHEN skin=$1 THEN 'classic' ELSE skin END, updated_at=NOW()
       WHERE telegram_id=$2`, [id, pay.telegram_id]);
  }
  return pay;
}

module.exports = { parseItemPayload, logPaymentError, grantPaidItem, refundPayment };
