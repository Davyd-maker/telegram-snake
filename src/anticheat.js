// Античит по статистике забега. Проверка по логу ловит подделку очков, но не бота, который честно играет
// в реальном времени. Боты почти всегда идут к еде кратчайшим путём, люди — петляют.
// eff = (ходов до еды) / (расстояние до еды): у людей обычно 1.3–2.5, у жадного бота ~1.0–1.1.
// Забег только помечается для админки — автоматически никого не баним.
const MIN_DIST = Number(process.env.AC_MIN_DIST || 200);   // минимум «пути» для вывода (≈ 25–30 яблок)
const EFF_FLAG = Number(process.env.AC_EFF_FLAG || 1.1);

function analyze(sim) {
  const s = sim.stats || {};
  const eff = s.pathDist >= MIN_DIST ? s.pathTicks / s.pathDist : null;
  const flags = [];
  if (eff !== null && eff < EFF_FLAG) flags.push("path");
  if (sim.bestRun >= 60) flags.push("combo");
  return { eff: eff === null ? null : Math.round(eff * 1000) / 1000, flags: flags.join(",") };
}

module.exports = { analyze, EFF_FLAG, MIN_DIST };
