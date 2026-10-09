// Настройки игрока (звук, громкость, вибрация), звуки на WebAudio и вибрация через Telegram.
// Хранятся в localStorage этого устройства.
(function () {
  "use strict";
  const SA = (window.SA = window.SA || {});
  const tg = window.Telegram?.WebApp;

  const KEY = "snakeSettings";
  const defaults = { sound: true, volume: 70, vibro: true };
  let S = { ...defaults };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") S = { ...defaults, ...raw };
    else if (localStorage.getItem("snakeSound") === "0") S.sound = false; // перенос старой настройки
  } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  // ---------- звук ----------
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }
  function beep(freq, dur, type = "sine", vol = 0.06, slide = 0, delay = 0) {
    if (!S.sound || !audioCtx || S.volume <= 0) return;
    try {
      const v = vol * (S.volume / 70); // 70% — прежняя громкость
      const t = audioCtx.currentTime + delay, o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(Math.max(0.0002, v), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.03);
    } catch (e) {}
  }
  const sfx = {
    eat: () => beep(420, 0.1, "square", 0.04, 380),
    coin: () => { beep(988, 0.08, "triangle", 0.07); beep(1480, 0.14, "triangle", 0.07, 0, 0.07); },
    gold: () => { [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.14, "triangle", 0.07, 0, i * 0.06)); },
    claim: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, "triangle", 0.07, 0, i * 0.08)); },
    power: () => { [440, 660, 880].forEach((f, i) => beep(f, 0.12, "triangle", 0.07, 0, i * 0.05)); },
    save: () => { beep(660, 0.12, "triangle", 0.07); beep(990, 0.18, "triangle", 0.06, 0, 0.08); },
    boom: () => { beep(160, 0.35, "sawtooth", 0.07, -100); beep(90, 0.4, "square", 0.04, -40, 0.05); },
    tick: () => beep(740, 0.07, "square", 0.04),
    go: () => beep(1180, 0.16, "triangle", 0.07),
    over: () => beep(330, 0.45, "sawtooth", 0.06, -240)
  };

  // ---------- вибрация ----------
  // kind: light | medium | heavy | success | warning | error
  function haptic(kind = "light") {
    if (!S.vibro) return;
    try {
      const h = tg?.HapticFeedback;
      if (h) {
        if (["success", "warning", "error"].includes(kind)) h.notificationOccurred(kind);
        else h.impactOccurred(kind);
      } else if (navigator.vibrate) navigator.vibrate(kind === "error" ? 120 : kind === "success" ? 40 : 12);
    } catch (e) {}
  }

  SA.settings = {
    get: () => ({ ...S }),
    set(patch) { S = { ...S, ...patch }; save(); }
  };
  SA.audio = { unlock: unlockAudio, beep, sfx };
  SA.haptic = haptic;
})();
