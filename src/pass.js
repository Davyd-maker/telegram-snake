// Сезонный пропуск: опыт копится в течение сезона (недели). Бесплатная дорожка — всем,
// премиум — после покупки за Stars (можно купить в любой момент сезона и забрать прошлые ступени).
const { pool } = require("./db");
const C = require("./catalog");

const q = (sql, p) => pool.query(sql, p);

async function get(seasonId, uid) {
  const r = await q(`SELECT * FROM season_pass WHERE season_id=$1 AND telegram_id=$2`, [seasonId, uid]);
  return r.rows[0] || { season_id: seasonId, telegram_id: uid, xp: 0, premium: false, claimed_free: [], claimed_prem: [] };
}
async function addXp(seasonId, uid, xp) {
  if (!(xp > 0)) return;
  await q(`INSERT INTO season_pass(season_id, telegram_id, xp) VALUES($1,$2,$3)
           ON CONFLICT(season_id, telegram_id) DO UPDATE SET xp=season_pass.xp+EXCLUDED.xp`, [seasonId, uid, Math.floor(xp)]);
}
async function setPremium(seasonId, uid, on = true) {
  await q(`INSERT INTO season_pass(season_id, telegram_id, premium) VALUES($1,$2,$3)
           ON CONFLICT(season_id, telegram_id) DO UPDATE SET premium=$3`, [seasonId, uid, on]);
}

function view(row) {
  const tiers = C.PASS_TIERS.map((t) => ({
    tier: t.tier, xp: t.xp, free: t.free, prem: t.prem, reached: row.xp >= t.xp,
    claimed_free: (row.claimed_free || []).includes(t.tier), claimed_prem: (row.claimed_prem || []).includes(t.tier)
  }));
  const level = tiers.filter((t) => t.reached).length;
  const next = tiers.find((t) => !t.reached);
  return { xp: row.xp, premium: !!row.premium, level, next_xp: next ? next.xp : null, tier_xp: C.PASS_TIER_XP, tiers,
    claimable: tiers.filter((t) => t.reached && (!t.claimed_free || (row.premium && !t.claimed_prem))).length };
}

// Забрать награду ступени. track: "free" | "prem". Атомарно: двойной тап не выдаст дважды.
async function claim(seasonId, uid, tier, track) {
  const t = C.PASS_TIERS.find((x) => x.tier === tier);
  if (!t || !["free", "prem"].includes(track)) return { error: "Bad tier" };
  const col = track === "free" ? "claimed_free" : "claimed_prem";
  const r = await q(
    `UPDATE season_pass SET ${col}=array_append(${col}, $3)
     WHERE season_id=$1 AND telegram_id=$2 AND xp>=$4 AND NOT ($3 = ANY(${col})) ${track === "prem" ? "AND premium" : ""} RETURNING 1`,
    [seasonId, uid, tier, t.xp]);
  if (!r.rowCount) return { error: "Not available" };
  const rw = t[track];
  let coins = rw.coins || 0;
  if (rw.skin) {
    const has = await q(`SELECT $1 = ANY(owned_skins) AS has FROM players WHERE telegram_id=$2`, [rw.skin, uid]);
    if (has.rows[0]?.has) coins += 2000; // скин уже есть — вместо него монеты
    else await q(`UPDATE players SET owned_skins=ARRAY(SELECT DISTINCT unnest(owned_skins || ARRAY[$1]::TEXT[])) WHERE telegram_id=$2`, [rw.skin, uid]);
  }
  if (coins) await q(`UPDATE players SET coins=coins+$1, updated_at=NOW() WHERE telegram_id=$2`, [coins, uid]);
  return { ok: true, coins, skin: rw.skin || null };
}

module.exports = { get, addXp, setPremium, view, claim };
