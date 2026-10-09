// «Друзья» игрока — те, кого он пригласил; тот, кто пригласил его; другие приглашённые тем же человеком;
// и соперники по принятым вызовам. Самого игрока тоже включаем — он тоже в таблице. $1 = telegram_id
const FRIENDS_CTE = `
  friends AS (
    SELECT telegram_id FROM players WHERE referred_by=$1
    UNION SELECT referred_by FROM players WHERE telegram_id=$1 AND referred_by IS NOT NULL
    UNION SELECT s.telegram_id FROM players s WHERE s.referred_by IS NOT NULL AND s.referred_by=(SELECT referred_by FROM players WHERE telegram_id=$1)
    UNION SELECT CASE WHEN creator_id=$1 THEN accepted_by ELSE creator_id END FROM challenges
          WHERE accepted_by IS NOT NULL AND (creator_id=$1 OR accepted_by=$1)
    UNION SELECT CASE WHEN a_id=$1 THEN b_id ELSE a_id END FROM duels WHERE b_id IS NOT NULL AND (a_id=$1 OR b_id=$1)
    UNION SELECT $1::text
  )`;
module.exports = { FRIENDS_CTE };
