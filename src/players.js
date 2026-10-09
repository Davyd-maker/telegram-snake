const config = require("./config");
const { pool } = require("./db");
const { tgApi } = require("./telegram");
const C = require("./catalog");
const { t: tr, langFromCode } = require("./i18n");

// ---------- ссылки ----------
function refLink(id) {
  const { botUsername: bot, APP_SHORT_NAME, REF_MODE } = config;
  if (!bot) return "";
  if (APP_SHORT_NAME) return `https://t.me/${bot}/${APP_SHORT_NAME}?startapp=ref_${id}`;
  if (REF_MODE === "startapp") return `https://t.me/${bot}?startapp=ref_${id}`;
  return `https://t.me/${bot}?start=ref_${id}`;
}
// Ссылка, открывающая игру с параметром (ch_ID — вызов, rp_ID — реплей)
function startLink(param) {
  const { botUsername: bot, APP_SHORT_NAME, REF_MODE, PUBLIC_URL } = config;
  const [kind, id] = param.split("_");
  if (!bot) return PUBLIC_URL ? `${PUBLIC_URL}/?${kind === "ch" ? "challenge" : "replay"}=${id}` : "";
  if (APP_SHORT_NAME) return `https://t.me/${bot}/${APP_SHORT_NAME}?startapp=${param}`;
  if (REF_MODE === "startapp") return `https://t.me/${bot}?startapp=${param}`;
  return `https://t.me/${bot}?start=${param}`;
}
const challengeLink = (id) => startLink("ch_" + id);

// ---------- уровень, достижения ----------
function levelInfo(xp = 0) {
  const x = Math.max(0, Number(xp) || 0);
  const level = Math.floor(Math.sqrt(x / 100)) + 1;
  const cur = (level - 1) * (level - 1) * 100, next = level * level * 100;
  return { level, xp: x, current: cur, next, progress: Math.min(100, Math.round((x - cur) / (next - cur) * 100)) };
}
const achStats = (p) => ({
  games: Number(p.games_played || 0), total_apples: Number(p.total_apples || 0), best_score: Number(p.best_score || 0),
  best_combo: Number(p.best_combo || 0), referrals: Number(p.referrals || 0),
  levels: Number(p.levels_done || 0), level_stars: Number(p.level_stars || 0), streak: Number(p.daily_streak || 0),
  skins: (p.owned_skins || []).length, accs: (p.owned_accessories || []).length, fields: (p.owned_fields || []).length
});
function achievementList(p) {
  const a = p.achievements || {}, st = achStats(p);
  return C.ACHIEVEMENTS.map(({ need, ...x }) => ({ ...x, claimed: !!a[x.id], ready: !!need(st), progress: x.stat ? Math.min(st[x.stat] || 0, x.target) : null }));
}

// ---------- задания: см. src/missions.js ----------
const Missions = require("./missions");
const missionList = (p) => Missions.list(p);

// ---------- ежедневная награда: серия растёт, если заходить каждый день; пропуск дня сбрасывает на 1-й день ----------
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); // b - a в днях, YYYY-MM-DD
function dailyInfo(p) {
  const R = config.DAILY_REWARDS;
  const streak = Number(p.daily_streak) || 0;
  const diff = p.last_day ? dayDiff(p.last_day, p.today) : null;
  const claimedToday = diff === 0;
  const canClaim = !claimedToday;
  const broken = canClaim && streak > 0 && diff !== 1;
  const nextStreak = canClaim ? (diff === 1 ? streak + 1 : 1) : streak;
  const idx = (nextStreak - 1) % R.length;
  return {
    streak: broken ? 0 : streak, can_claim: canClaim, broken, next_streak: nextStreak,
    reward: canClaim ? R[idx] : 0,
    cycle_claimed: canClaim ? idx : ((streak - 1) % R.length) + 1,
    rewards: R
  };
}

// ---------- активность по дням (для DAU в админке): один INSERT на игрока в сутки на процесс ----------
const seenToday = new Set();
function trackActivity(id, day) {
  const key = day + ":" + id;
  if (seenToday.has(key)) return;
  if (seenToday.size > 200000) seenToday.clear();
  seenToday.add(key);
  pool.query(`INSERT INTO activity(day, telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [day, id]).catch(() => seenToday.delete(key));
}

// ---------- игрок ----------
// Возвращает id пригласившего, если реферал засчитан (иначе null).
async function applyReferral(newId, startParam, newName) {
  const m = /^ref_(\d{1,20})$/.exec(String(startParam || ""));
  if (!m || m[1] === newId) return null;
  const refId = m[1];
  const client = await pool.connect();
  let ok = false;
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE players SET referrals=referrals+1, coins=coins+$1, updated_at=NOW() WHERE telegram_id=$2 RETURNING 1`,
      [config.REF_REWARD, refId]
    );
    if (r.rowCount) {
      await client.query(
        `UPDATE players SET referred_by=$1, coins=coins+$2 WHERE telegram_id=$3 AND referred_by IS NULL`,
        [refId, config.REF_BONUS, newId]
      );
      ok = true;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("referral error", e);
    return null;
  } finally {
    client.release();
  }
  if (!ok) return null;
  if (config.BOT_TOKEN) {
    pool.query(`SELECT lang FROM players WHERE telegram_id=$1`, [refId]).then((r) =>
      tgApi("sendMessage", { chat_id: refId, text: tr(r.rows[0]?.lang || "ru", "ref_joined", { name: newName, reward: config.REF_REWARD, bonus: config.REF_BONUS }) })
    ).catch(() => {});
  }
  return refId;
}

async function getPlayer(u) {
  const id = String(u.id);
  const ins = await pool.query(
    `INSERT INTO players (telegram_id, username, first_name, lang)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username=EXCLUDED.username,
       first_name=EXCLUDED.first_name,
       updated_at=NOW()
     RETURNING (xmax = 0) AS inserted`,
    [id, u.username || "", u.first_name || "", langFromCode(u.language_code)]
  );
  // Реферал засчитывается один раз — только когда игрок впервые зашёл по ссылке друга
  let refApplied = null;
  if (ins.rows[0]?.inserted) refApplied = await applyReferral(id, u.start_param, u.first_name || u.username || "Друг");
  const { rows } = await pool.query(
    `SELECT *,
            to_char(daily_bonus_claimed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS last_day,
            to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD') AS today,
            (SELECT first_name FROM players r WHERE r.telegram_id=players.referred_by) AS invited_by,
            (SELECT COUNT(*)::int FROM level_progress lp WHERE lp.telegram_id=players.telegram_id) AS levels_done,
            (SELECT COALESCE(SUM(stars),0)::int FROM level_progress lp WHERE lp.telegram_id=players.telegram_id) AS level_stars
     FROM players WHERE telegram_id=$1`,
    [id, config.DAILY_TZ]
  );
  const row = rows[0];
  if (row) {
    row.ref_applied = refApplied; // не колонка: кто пригласил, если реферал засчитан сейчас
    trackActivity(id, row.today);
    // артефакты открываются по уровню: 🔥 с 3-го, 👻 с 7-го
    const lvl = levelInfo(row.xp || 0).level;
    const auto = ["magnet", ...(lvl >= 3 ? ["berserk"] : []), ...(lvl >= 7 ? ["phantom"] : [])];
    const have = Array.isArray(row.owned_artifacts) ? row.owned_artifacts : [];
    const merged = Array.from(new Set([...have, ...auto]));
    if (merged.length !== have.length) {
      await pool.query(`UPDATE players SET owned_artifacts=$1::text[] WHERE telegram_id=$2`, [merged, id]);
      row.owned_artifacts = merged;
    }
  }
  return row;
}

function responsePlayer(p) {
  if (!p) return p;
  const { ban_reason, ...rest } = p; // причина бана — только для админки
  return {
    ...rest,
    ref_link: refLink(p.telegram_id),
    invited_by: p.invited_by || null,
    daily: dailyInfo(p),
    skins: C.catalogFor(p),
    artifact_levels: p.artifact_levels || {},
    artifacts: C.ARTIFACT_CATALOG.map((a) => {
      const level = Math.max(1, Math.min(5, Number((p.artifact_levels || {})[a.id]) || 1));
      return { ...a, level, max_level: 5, next_cost: level >= 5 ? null : C.ARTIFACT_UPGRADE_COST[level - 1] };
    }),
    owned_artifacts: Array.isArray(p.owned_artifacts) && p.owned_artifacts.length ? p.owned_artifacts : ["magnet"],
    equipped_artifact: C.ARTIFACT_BY_ID[p.equipped_artifact] ? p.equipped_artifact : "magnet",
    fields: C.FIELD_CATALOG,
    field_skin: C.FIELD_BY_ID[p.field_skin] ? p.field_skin : "classic",
    accessories: C.ACCESSORY_CATALOG,
    owned_accessories: Array.isArray(p.owned_accessories) ? p.owned_accessories : [],
    accessory: C.ACC_BY_ID[p.accessory] && (p.owned_accessories || []).includes(p.accessory) ? p.accessory : "",
    levels_done: Number(p.levels_done || 0), level_stars: Number(p.level_stars || 0),
    stars_enabled: !!config.BOT_TOKEN,
    missions: missionList(p),
    ref_reward: config.REF_REWARD,
    ref_bonus: config.REF_BONUS,
    owned_skins: Array.isArray(p.owned_skins) && p.owned_skins.length ? p.owned_skins : ["classic"],
    owned_fields: Array.isArray(p.owned_fields) && p.owned_fields.length ? p.owned_fields : ["classic"],
    level: levelInfo(p.xp || 0), achievements_list: achievementList(p), xp: Number(p.xp || 0),
    games_played: Number(p.games_played || 0), total_apples: Number(p.total_apples || 0), best_combo: Number(p.best_combo || 0),
    season_score: Number(p.season_score || 0), season: p.season || null,
    banned: !!p.banned,
    notify: p.notify !== false, lang: p.lang || "ru", tutorial_done: !!p.tutorial_done || Number(p.games_played || 0) > 0,
    // набор новичка — первые дни после регистрации, один раз
    starter_offer: !p.starter_bought && !!p.created_at && Date.now() - new Date(p.created_at).getTime() < C.STARTER.days * 864e5 && config.BOT_TOKEN ? { ...C.PRODUCTS.starter } : null
  };
}

module.exports = {
  refLink, challengeLink, startLink, levelInfo, achStats, achievementList, missionList, dailyInfo,
  applyReferral, getPlayer, responsePlayer
};
