// Новые разделы: «Подземелье», головоломка дня, мастерская уровней (редактор), питомец, колесо удачи,
// подарки друзьям, праздничные баннеры. Пользуется общим API из app.js (SA.app).
(() => {
  "use strict";
  const SA = window.SA, E = window.SnakeEngine, N = E.N;
  const $ = (id) => document.getElementById(id);
  const A = () => SA.app;
  const t = (s, params) => SA.i18n.t(s, params);
  const esc = SA.esc;
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} } };

  // ---------- маленькая схема поля: стены, норка, старт ----------
  function drawLayout(cv, walls, opts = {}) {
    const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || cv.width;
    cv.width = w * d; cv.height = w * d;
    const x = cv.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0);
    const c = w / N;
    x.fillStyle = "#06140d"; x.fillRect(0, 0, w, w);
    x.fillStyle = "rgba(110,255,180,.04)"; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i + j) % 2 === 0) x.fillRect(i * c, j * c, c, c);
    x.fillStyle = "rgba(85,255,173,.10)"; x.fillRect(6 * c, 11 * c, 13 * c, 3 * c); // стартовый коридор
    x.fillStyle = "#7d8c92";
    for (const k of walls) x.fillRect((k % N) * c + 0.5, ((k / N) | 0) * c + 0.5, c - 1, c - 1);
    if (opts.hole) { x.fillStyle = "#ffd84c"; x.beginPath(); x.arc((opts.hole.x + 0.5) * c, (opts.hole.y + 0.5) * c, c * 0.42, 0, Math.PI * 2); x.fill(); }
    if (opts.first) { x.fillStyle = "#ff4d6d"; x.beginPath(); x.arc((opts.first.x + 0.5) * c, (opts.first.y + 0.5) * c, c * 0.36, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "#55ffad"; for (let i = 0; i < 4; i++) x.fillRect((12 - i) * c + 1, 12 * c + 1, c - 2, c - 2);
  }
  // строка рейтинга без кубка: значение — свой текст
  const row = (x, i, val) => { const medal = ["🥇", "🥈", "🥉"]; return `<div class="lbrow${i < 3 ? " top" + (i + 1) : ""}${x.is_me ? " me" : ""}"><span class="lbpos">${i < 3 ? medal[i] : i + 1}</span>${A().headHtml(x.skin, x.palette)}<span class="lbname">${esc(x.name || t("Игрок"))}${x.is_me ? ` <em>(${t("ты")})</em>` : ""}</span><b>${val}</b></div>`; };
  const loading = (box) => { box.innerHTML = `<div class="lbempty">${t("Загрузка…")}</div>`; };
  const failed = (box) => { box.innerHTML = `<div class="lbempty">${t("Не удалось загрузить. Проверь соединение.")}</div>`; };

  // ---------- главный экран: праздник, колесо, голодный питомец ----------
  let linkHandled = false;
  SA.onUi = (p) => {
    const items = [];
    if (p.holiday) items.push(`<button class="hx hol" data-screen="shop"><i>${p.holiday.emoji}</i><span><b>${esc(t(p.holiday.title))}!</b><small>${t("Тыквы вместо фруктов, конфеты за каждый фрукт")} · 🍬 ${A().fmtN(p.candies || 0)}</small></span></button>`);
    if (p.wheel_ready) items.push(`<button class="hx wheelb" id="wheelOpen"><i>🎡</i><span><b>${t("Колесо удачи")}</b><small>${t("Бесплатный поворот сегодня!")}</small></span></button>`);
    if (p.pet && !p.pet.fed_today) items.push(`<button class="hx petb" data-screen="pet"><i>${p.pet.emoji}</i><span><b>${t(p.pet.name)} ${t("проголодался")}</b><small>${t("Покорми — и бонус к монетам сохранится")}</small></span></button>`);
    const box = $("homeExtras"); box.innerHTML = items.join(""); box.hidden = !items.length;
    const wo = $("wheelOpen"); if (wo) wo.onclick = openWheel;
    $("petNavIco").textContent = p.pet ? p.pet.emoji : "🐾";
    $("petNavSub").textContent = p.pet ? `${t(p.pet.name)} · ${t("ур.")} ${p.pet.level}` : t("Ползёт за змейкой");
    const pb = document.querySelector('.nav [data-screen="pet"]'); if (pb) pb.classList.toggle("has-dot", !!p.pet && !p.pet.fed_today);
    // ссылка на уровень игрока — открываем один раз после загрузки
    if (!linkHandled && SA.startLinks.level && p.telegram_id) { linkHandled = true; openCustomLevel(SA.startLinks.level); }
  };

  SA.onShow = (id) => {
    if (id === "dungeon") renderDungeon();
    if (id === "puzzle") renderPuzzle();
    if (id === "workshop") renderWorkshop();
    if (id === "editor") openEditor();
    if (id === "pet") renderPet();
    if (id === "profile") renderGiftFriends();
    if (id === "duel" && SA.duel) SA.duel.render();
  };

  // ---------- «Подземелье» ----------
  async function renderDungeon() {
    const box = $("dungeonBox"); loading(box);
    const d = await A().api("/api/dungeon");
    if (!d?.leaderboard) return failed(box);
    const p = A().p;
    const ups = Object.values(d.upgrades).map((u) => `<div class="upmini"><i>${u.icon}</i><b>${esc(t(u.name))}</b><small>${esc(t(u.desc))}</small></div>`).join("");
    box.innerHTML = `<p class="muted">${t("Спускайся всё глубже: на каждом этаже свои стены. Собери нужное число фруктов — откроется норка на следующий этаж. После каждого этажа выбери одно из трёх улучшений. Чем глубже — тем быстрее змейка.")}</p>
      <div class="invby">🗝️ ${t("Твой рекорд")}: <b>${p.best_floor ? t("этаж") + " " + p.best_floor : "—"}</b>${d.me ? ` · ${t("место")} <b>#${d.me.rank}</b>` : ""}</div>
      <button class="primary" id="dgPlay" style="width:100%;margin:10px 0">▶ ${t("Спуститься в подземелье")}</button>
      <h3 class="sect">✨ ${t("Улучшения")}</h3><div class="upgrid">${ups}</div>
      <h3 class="sect">🏆 ${t("Глубже всех")}</h3><div class="lb" style="margin-top:8px">${d.leaderboard.length ? d.leaderboard.map((x, i) => row(x, i, `🗝️ ${x.score}`)).join("") : `<div class="lbempty">${t("Пока никто не спускался — будь первым!")}</div>`}</div>`;
    $("dgPlay").onclick = () => { A().setReturn("dungeon"); A().startRun({ kind: "free", mode: "dungeon" }); };
  }

  // ---------- Головоломка дня ----------
  async function renderPuzzle() {
    const box = $("puzzleBox"); loading(box);
    const d = await A().api("/api/puzzle");
    if (!d?.leaderboard) return failed(box);
    const me = d.me;
    box.innerHTML = `<div class="pzhead"><b>#${d.num}</b><small>${new Date(d.day + "T12:00:00").toLocaleDateString(SA.i18n.locale(), { day: "numeric", month: "long" })} · ${t("решили")}: ${d.solvers}</small></div>
      <div class="pzwrap"><canvas id="pzCv" class="pzcv" aria-label="${t("Схема головоломки")}"></canvas></div>
      <p class="muted small">${t("Фрукты появляются по одному — у всех в одних и тех же местах. Собери")} ${d.fruits} ${t("и доползи до норки")} 🕳️ ${t("за как можно меньшее число ходов.")} ⭐⭐⭐ — ≤ ${d.par} ${t("ходов")}, ⭐⭐ — ≤ ${d.par2}.</p>
      ${me ? `<div class="invby">✅ ${t("Решено")}: <b>${me.ticks}</b> ${t("ходов")} ${"⭐".repeat(me.stars)} · ${t("место")} <b>#${me.rank}</b> · ${t("попыток")}: ${me.attempts}</div>` : ""}
      <div class="refbtns"><button class="primary" id="pzPlay">▶ ${me ? t("Решить быстрее") : t("Решать")}</button>${me ? `<button class="alt" id="pzShare">📤 ${t("Поделиться")}</button>` : ""}</div>
      <h3 class="sect">🏆 ${t("Быстрее всех сегодня")}</h3><div class="lb" style="margin-top:8px">${d.leaderboard.length ? d.leaderboard.map((x, i) => row(x, i, `${x.score} 👣 ${"⭐".repeat(x.stars)}`)).join("") : `<div class="lbempty">${t("Сегодня ещё никто не решил — будь первым!")}</div>`}</div>`;
    requestAnimationFrame(() => drawLayout($("pzCv"), d.walls || [], { hole: d.hole, first: d.first }));
    $("pzPlay").onclick = () => { A().setReturn("puzzle"); A().startRun({ kind: "puzzle" }); };
    const sh = $("pzShare"); if (sh) sh.onclick = () => A().shareLink(A().refLink(), `🧩 Snake Arena · ${t("Головоломка дня")} #${d.num}\n🍎×${d.fruits} → 🕳️ ${t("за")} ${me.ticks} ${t("ходов")} ${"⭐".repeat(me.stars)}\n${t("Сможешь быстрее?")}`);
  }

  // ---------- Мастерская: уровни игроков ----------
  let wsTab = "week";
  async function renderWorkshop() {
    const box = $("workshopBox"); loading(box);
    const d = await A().api("/api/custom?tab=" + wsTab);
    if (!d?.levels) return failed(box);
    const tabs = [["week", "🔥 " + t("Неделя")], ["top", "❤️ " + t("Лучшие")], ["new", "🆕 " + t("Новые")], ["mine", "👤 " + t("Мои")]];
    const card = (L) => `<div class="cl" data-cl="${L.id}">
        <canvas class="clcv" data-walls="${L.walls.join(",")}"></canvas>
        <div class="clb"><b>${esc(L.name)}</b><small>${t("автор")}: ${esc(L.author)}${L.won ? " · ✅" : ""}</small>
          <small>🎯 ${L.target} · ▶ ${L.plays} · 🏁 ${L.wins}</small>
          <div class="clbtn"><button class="primary sm" data-clplay="${L.id}" data-clname="${esc(L.name)}">▶</button>${L.mine ? `<button class="sm" data-cldel="${L.id}">🗑️</button>` : `<button class="sm${L.liked ? " on" : ""}" data-cllike="${L.id}">${L.liked ? "❤️" : "🤍"} ${L.likes}</button>`}<button class="sm" data-clshare="${L.id}" data-cllink="${esc(L.link)}" data-clname="${esc(L.name)}">📤</button></div></div></div>`;
    box.innerHTML = `<p class="muted">${t("Рисуй свои уровни и проходи чужие. Лучшие за неделю попадают в подборку. За каждое первое прохождение твоего уровня другим игроком — +10 🪙.")}</p>
      <button class="primary" id="wsNew" style="width:100%;margin:6px 0 10px">✏️ ${t("Нарисовать уровень")}</button>
      <div class="tabs four" id="wsTabs">${tabs.map(([id, n]) => `<button data-wstab="${id}" class="${id === wsTab ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="cllist">${d.levels.length ? d.levels.map(card).join("") : `<div class="lbempty">${wsTab === "mine" ? t("У тебя пока нет уровней — нарисуй первый!") : t("Пока пусто — нарисуй первый уровень!")}</div>`}</div>`;
    requestAnimationFrame(() => box.querySelectorAll(".clcv").forEach((cv) => drawLayout(cv, cv.dataset.walls ? cv.dataset.walls.split(",").map(Number) : [])));
    $("wsNew").onclick = () => A().show("editor");
  }
  $("workshopBox").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.wstab) { wsTab = b.dataset.wstab; return renderWorkshop(); }
    if (b.dataset.clplay) { A().setReturn("workshop"); return A().startRun({ kind: "custom", ref: b.dataset.clplay, name: b.dataset.clname }); }
    if (b.dataset.cllike) {
      const r = await A().api("/api/custom/like", { method: "POST", body: JSON.stringify({ id: b.dataset.cllike }) });
      if (r?.ok) { b.textContent = (r.liked ? "❤️ " : "🤍 ") + r.likes; b.classList.toggle("on", r.liked); A().haptic("light"); }
      return;
    }
    if (b.dataset.cldel) {
      if (!(await A().confirmBox(t("Удалить уровень?"), t("Удалить")))) return;
      await A().api("/api/custom/delete", { method: "POST", body: JSON.stringify({ id: b.dataset.cldel }) }); return renderWorkshop();
    }
    if (b.dataset.clshare) return A().shareLink(b.dataset.cllink || A().refLink(), `🛠️ ${t("Пройди мой уровень")} «${b.dataset.clname}» ${t("в Snake Arena!")}`);
  });
  async function openCustomLevel(id) {
    const d = await A().api("/api/custom/" + encodeURIComponent(id));
    if (!d?.level) return A().toast("Уровень не найден");
    const L = d.level;
    if (await A().confirmBox(`🛠️ «${L.name}»\n${t("автор")}: ${L.author}\n🎯 ${t("цель")} ${L.target} · ▶ ${L.plays} · ❤️ ${L.likes}`, t("Играть"), t("Позже"))) {
      A().setReturn("workshop"); A().startRun({ kind: "custom", ref: L.id, name: L.name });
    }
  }

  // ---------- Редактор уровня ----------
  const ed = { walls: new Set(), tool: "wall", sym: false, drawing: false, inited: false };
  function edLoad() { try { const d = JSON.parse(LS.get("snakeEditor", "{}")); ed.walls = new Set((d.w || []).filter((k) => k >= 0 && k < N * N)); $("edTarget").value = d.t || 20; $("edName").value = d.n || ""; } catch (e) {} }
  function edSaveDraft() { LS.set("snakeEditor", JSON.stringify({ w: [...ed.walls], t: Number($("edTarget").value), n: $("edName").value })); }
  function openEditor() {
    if (!ed.inited) { ed.inited = true; edLoad(); bindEditor(); }
    requestAnimationFrame(edDraw);
  }
  function edDraw() {
    const cv = $("edCanvas"); drawLayout(cv, [...ed.walls]);
    const x = cv.getContext("2d"), w = cv.clientWidth, c = w / N;
    x.strokeStyle = "rgba(120,255,190,.08)"; x.lineWidth = 1; x.beginPath();
    for (let i = 0; i <= N; i++) { x.moveTo(i * c, 0); x.lineTo(i * c, w); x.moveTo(0, i * c); x.lineTo(w, i * c); } x.stroke();
    if (ed.sym) { x.strokeStyle = "rgba(255,216,76,.45)"; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, w); x.stroke(); x.setLineDash([]); }
    const chk = E.customCheck({ w: [...ed.walls], t: Number($("edTarget").value) });
    $("edInfo").innerHTML = `🧱 ${chk.walls}/${E.CUSTOM_MAX_WALLS} · ${t("свободно")}: ${chk.free} ${chk.ok ? "✅" : "⚠️ " + t("мало места")}`;
    $("edTargetVal").textContent = $("edTarget").value;
    $("edSave").disabled = !chk.ok || chk.walls < 4;
  }
  function cellAt(e) {
    const cv = $("edCanvas"), r = cv.getBoundingClientRect(), c = r.width / N;
    const x = Math.floor((e.clientX - r.left) / c), y = Math.floor((e.clientY - r.top) / c);
    return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
  }
  function paint(e) {
    const p = cellAt(e); if (!p) return;
    const apply = (x, y) => { if (E.inStartZone(x, y)) return; const k = y * N + x; if (ed.tool === "wall") { if (ed.walls.size < E.CUSTOM_MAX_WALLS) ed.walls.add(k); } else ed.walls.delete(k); };
    apply(p.x, p.y); if (ed.sym) apply(N - 1 - p.x, p.y);
    edDraw();
  }
  function bindEditor() {
    const cv = $("edCanvas");
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); ed.drawing = true; cv.setPointerCapture(e.pointerId); paint(e); });
    cv.addEventListener("pointermove", (e) => { if (ed.drawing) paint(e); });
    const stop = () => { if (ed.drawing) { ed.drawing = false; edSaveDraft(); } };
    cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);
    document.querySelectorAll("[data-edtool]").forEach((b) => b.addEventListener("click", async () => {
      const tool = b.dataset.edtool;
      if (tool === "sym") { ed.sym = !ed.sym; b.classList.toggle("on", ed.sym); return edDraw(); }
      if (tool === "clear") { if (await A().confirmBox(t("Стереть все стены?"), t("Стереть"))) { ed.walls.clear(); edSaveDraft(); edDraw(); } return; }
      ed.tool = tool; document.querySelectorAll('[data-edtool="wall"],[data-edtool="erase"]').forEach((x) => x.classList.toggle("on", x === b));
    }));
    $("edTarget").addEventListener("input", () => { edDraw(); edSaveDraft(); });
    $("edName").addEventListener("change", edSaveDraft);
    $("edSave").addEventListener("click", async () => {
      const name = $("edName").value.trim();
      if (name.length < 3) return A().toast("Дай уровню название (3–24 символа)");
      $("edSave").disabled = true;
      const r = await A().api("/api/custom/save", { method: "POST", body: JSON.stringify({ name, walls: [...ed.walls], target: Number($("edTarget").value) }) });
      $("edSave").disabled = false;
      if (!r?.id) return A().toast(r?.error === "Too many levels" ? "Слишком много уровней — удали старые" : r?.error === "Too little free space" ? "Мало свободного места" : "Не удалось сохранить");
      ed.walls.clear(); $("edName").value = ""; edSaveDraft();
      A().sfx.claim(); A().toast("💾 Уровень сохранён! Пройди его первым");
      wsTab = "mine"; A().setReturn("workshop"); A().startRun({ kind: "custom", ref: r.id, name });
    });
    window.addEventListener("resize", () => { if ($("editor").classList.contains("active")) edDraw(); });
  }

  // ---------- Питомец ----------
  function renderPet() {
    const box = $("petBox"), p = A().p, pet = p.pet, pets = p.pets || [];
    if (!pet) {
      box.innerHTML = `<p class="muted">${t("Питомец ползёт за змейкой в каждом забеге, растёт от фруктов и даёт бонус к монетам, если его кормить каждый день. Первый питомец — бесплатно!")}</p>
        <div class="petgrid">${pets.map((x) => `<button class="petpick" data-pet="${x.id}"><i>${x.stages.join(" → ")}</i><b>${esc(t(x.name))}</b><span class="primary sm">${t("Выбрать")}</span></button>`).join("")}</div>`;
      return;
    }
    box.innerHTML = `<div class="petcard"><div class="petbig${pet.hungry ? " hungry" : ""}">${pet.emoji}</div>
        <b>${esc(t(pet.name))}</b><small>${t("Уровень")} ${pet.level}${pet.next_xp ? ` · ${pet.xp}/${pet.next_xp} XP` : " · MAX"}</small>
        <div class="bar"><i style="width:${pet.progress}%"></i></div>
        <div class="petbonus">${pet.hungry ? "😢 " + t("Голоден — бонус к монетам не действует") : `🪙 ${t("Бонус к монетам")}: <b>+${Math.round(pet.bonus * 1000) / 10}%</b>`}</div></div>
      <button class="primary" id="petFeed" style="width:100%;margin-top:10px" ${pet.fed_today ? "disabled" : ""}>${pet.fed_today ? "✅ " + t("Сегодня уже накормлен") : "🍖 " + t("Покормить")} </button>
      <p class="muted small">${t("Кормить можно раз в день: +опыт и бонус на сегодня и завтра. Ещё питомец растёт от фруктов в забегах. Внешний вид меняется на 5-м и 12-м уровне.")}</p>
      <h3 class="sect">🔄 ${t("Сменить питомца")} · 2 000 🪙</h3><small class="muted">${t("Опыт сохраняется")}</small>
      <div class="petgrid">${pets.filter((x) => x.id !== pet.id).map((x) => `<button class="petpick" data-pet="${x.id}"><i>${x.stages[pet.stage]}</i><b>${esc(t(x.name))}</b></button>`).join("")}</div>`;
    $("petFeed").onclick = async () => {
      $("petFeed").disabled = true;
      const r = await A().api("/api/pet/feed", { method: "POST", body: "{}" });
      if (r?.player) { A().merge(r.player); A().sfx.claim(); A().haptic("success"); A().toast(`${r.player.pet.emoji} ${t("Ням!")} +${r.xp} XP`); renderPet(); } else A().toast("Не получилось");
    };
  }
  $("petBox").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pet]"); if (!b) return;
    const p = A().p;
    if (p.pet && !(await A().confirmBox(t("Сменить питомца за 2 000 🪙? Опыт сохранится."), t("Сменить")))) return;
    const r = await A().api("/api/pet/adopt", { method: "POST", body: JSON.stringify({ pet: b.dataset.pet }) });
    if (r?.player) { A().merge(r.player); A().sfx.claim(); A().toast(`${r.player.pet.emoji} ${t("Теперь у тебя есть питомец!")}`); renderPet(); }
    else A().toast(r?.error === "Not enough coins" ? "Не хватает монет" : "Не получилось");
  });

  // ---------- Колесо удачи ----------
  const WHEEL_COLORS = ["#1fb86a", "#14824b", "#7a4dd8", "#1fb86a", "#e0661e", "#d4a417", "#d93a6a", "#14824b"];
  const segLabel = (s) => (s.kind === "coins" ? `${s.n}🪙` : s.kind === "petxp" ? `🐾+${s.n}` : s.kind === "candy" ? `🍬${s.n}` : "🎁");
  let wheelAng = 0, spinning = false;
  function drawWheel() {
    const cv = $("wheelCv"), d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 260;
    cv.width = w * d; cv.height = w * d;
    const x = cv.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0);
    const segs = A().p.wheel || [], n = segs.length || 8, R = w / 2 - 4;
    x.save(); x.translate(w / 2, w / 2); x.rotate(wheelAng);
    segs.forEach((s, i) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n, a1 = a0 + (Math.PI * 2) / n;
      x.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length]; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, a0, a1); x.closePath(); x.fill();
      x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 2; x.stroke();
      x.save(); x.rotate((a0 + a1) / 2); x.fillStyle = "#fff"; x.font = `900 ${Math.round(w / 19)}px system-ui`; x.textAlign = "right"; x.textBaseline = "middle";
      x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = 3; x.fillText(segLabel(s), R - 10, 0); x.restore();
    });
    x.fillStyle = "#0b1912"; x.beginPath(); x.arc(0, 0, R * 0.18, 0, Math.PI * 2); x.fill(); x.strokeStyle = "#ffd84c"; x.lineWidth = 3; x.stroke();
    x.restore();
  }
  function openWheel() {
    $("wheel").classList.add("show"); $("wheelRes").textContent = "";
    $("wheelSpin").disabled = !A().p.wheel_ready;
    $("wheelSpin").textContent = A().p.wheel_ready ? "🎡 " + t("Крутить!") : "⏳ " + t("Приходи завтра");
    requestAnimationFrame(drawWheel);
  }
  $("wheelClose").addEventListener("click", () => { if (!spinning) $("wheel").classList.remove("show"); });
  $("wheelSpin").addEventListener("click", async () => {
    if (spinning) return; spinning = true; $("wheelSpin").disabled = true;
    const r = await A().api("/api/wheel", { method: "POST", body: "{}" });
    if (!r?.ok) { spinning = false; A().toast(r?.error === "Already spun today" ? "Сегодня колесо уже крутили" : "Не получилось"); return; }
    const n = (A().p.wheel || []).length || 8;
    // сектор i стоит под стрелкой (вверху), когда угол = -i * 2π/n
    const target = -r.index * ((Math.PI * 2) / n), from = wheelAng, turns = Math.PI * 2 * 5;
    const to = target + turns + Math.ceil((from - target) / (Math.PI * 2)) * Math.PI * 2, t0 = performance.now(), dur = 3600;
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      wheelAng = from + (to - from) * e; drawWheel();
      if (k < 1) return requestAnimationFrame(frame);
      spinning = false; A().merge(r.player);
      const pz = r.prize;
      const txt = pz.kind === "coins" ? `+${A().fmtN(pz.n)} 🪙` : pz.kind === "petxp" ? `🐾 +${pz.n} XP ${t("питомцу")}` : pz.kind === "candy" ? `+${pz.n} 🍬` : pz.accessory ? `🎁 ${pz.accessory.emoji} ${t(pz.accessory.name)}!` : "🎁";
      $("wheelRes").textContent = txt; $("wheelSpin").textContent = "⏳ " + t("Приходи завтра");
      A().sfx.claim(); A().haptic("success");
    };
    requestAnimationFrame(frame);
  });

  // ---------- Подарки друзьям ----------
  let giftData = null;
  async function renderGiftFriends() {
    const box = $("giftFriends");
    const d = await A().api("/api/friends");
    if (!d?.friends) { box.innerHTML = ""; return; }
    giftData = d;
    $("giftSum").textContent = `· ${t("сегодня можно ещё")} ${A().fmtN(d.gift.left_today)} 🪙`;
    box.innerHTML = d.friends.length ? d.friends.map((f) => `<div class="fr">${A().headHtml(f.skin, f.palette)}<div class="frn"><b>${esc(f.name)}</b><small>🏆 ${f.best || 0}</small></div><button class="sm" data-giftto="${esc(f.id)}">🎁 ${t("Подарить")}</button></div>`).join("")
      : `<div class="lbempty">${t("Подарки можно дарить друзьям: приглашённым и соперникам по вызовам и дуэлям")}</div>`;
  }
  $("giftFriends").addEventListener("click", (e) => { const b = e.target.closest("[data-giftto]"); if (b) openGift(b.dataset.giftto); });
  function openGift(id) {
    const f = giftData?.friends.find((x) => x.id === id); if (!f) return;
    const p = A().p, left = giftData.gift.left_today;
    $("giftTitle").textContent = `${t("Подарок для")} ${f.name}`;
    $("giftSub").textContent = `${t("Сегодня можно подарить ещё")} ${A().fmtN(left)} 🪙 · ${t("у тебя")} ${A().fmtN(p.coins)} 🪙`;
    $("giftAmts").innerHTML = [50, 100, 250, 500, 1000].map((n) => `<button class="${n <= left && n <= (p.coins || 0) ? "" : "dis"}" data-giftc="${n}" ${n <= left && n <= (p.coins || 0) ? "" : "disabled"}>${n} 🪙</button>`).join("");
    const skins = (p.skins || []).filter((s) => s.currency === "coins" && s.price > 0 && !(f.owned_skins || []).includes(s.id));
    $("giftSkins").innerHTML = skins.length ? skins.map((s) => `<button data-gifts="${s.id}" ${(p.coins || 0) < s.price ? "disabled" : ""}><span>${s.emoji}</span><b>${esc(t(s.name))}</b><small>🪙 ${A().fmtN(s.price)}</small></button>`).join("") : `<small class="muted">${t("У друга уже есть все скины за монеты")}</small>`;
    $("gift").dataset.to = id; $("gift").classList.add("show");
  }
  $("giftClose").addEventListener("click", () => $("gift").classList.remove("show"));
  $("gift").addEventListener("click", async (e) => {
    if (e.target.id === "gift") return $("gift").classList.remove("show");
    const b = e.target.closest("[data-giftc],[data-gifts]"); if (!b || b.disabled) return;
    const to = $("gift").dataset.to, f = giftData.friends.find((x) => x.id === to);
    const body = b.dataset.giftc ? { to, coins: Number(b.dataset.giftc) } : { to, skin: b.dataset.gifts };
    const what = b.dataset.giftc ? `${b.dataset.giftc} 🪙` : `${t("скин")} «${t((A().p.skins || []).find((s) => s.id === b.dataset.gifts)?.name || "")}»`;
    if (!(await A().confirmBox(`${t("Подарить")} ${what} ${t("игроку")} ${f?.name || ""}?`, t("Подарить")))) return;
    const r = await A().api("/api/gift", { method: "POST", body: JSON.stringify(body) });
    if (r?.ok) { A().merge(r.player); A().sfx.claim(); A().haptic("success"); A().toast(`🎁 ${t("Подарок отправлен!")}`); $("gift").classList.remove("show"); renderGiftFriends(); }
    else A().toast({ "Daily gift limit": "Лимит подарков на сегодня исчерпан", "Friend got enough gifts today": "Другу сегодня уже много подарили", "Not enough coins": "Не хватает монет", "Friend already has it": "У друга уже есть этот скин" }[r?.error] || "Не получилось");
  });
})();
