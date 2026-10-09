// Snake Arena — интерфейс и игровой цикл. Правила игры — в engine.js (общий с сервером),
// отрисовка — в render.js, звук/вибрация/настройки — в settings.js, справочники — в catalog.js.
(() => {
  "use strict";
  const SA = window.SA, E = window.SnakeEngine;
  const { esc, sfx } = { esc: SA.esc, sfx: SA.audio.sfx };
  const haptic = SA.haptic;
  const t = (s, params) => SA.i18n.t(s, params), locale = () => SA.i18n.locale();
  const tg = window.Telegram?.WebApp;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

  const $ = (id) => document.getElementById(id);
  const el = { game: $("game"), over: $("over"), cv: $("cv"), toast: $("toast"), pauseBtn: $("pauseBtn"), score: $("score"), gc: $("gc") };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  };

  let p = { first_name: "Игрок", coins: 0, best_score: 0, referrals: 0, skin: "classic", owned_skins: ["classic"], owned_artifacts: ["magnet"], equipped_artifact: "magnet" };
  // выбор на экране старта (запоминается на устройстве)
  const sel = {
    mode: E.MODES[LS.get("snakeMode", "classic")] ? LS.get("snakeMode", "classic") : "classic",
    diff: E.DIFFS[LS.get("snakeDiff", "normal")] ? LS.get("snakeDiff", "normal") : "normal",
    artifact: "magnet"
  };

  // ---------- сеть ----------
  const rawStart = (() => {
    try {
      return tg?.initDataUnsafe?.start_param
        || new URLSearchParams(location.search).get("tgWebAppStartParam")
        || new URLSearchParams(location.hash.slice(1)).get("tgWebAppStartParam") || "";
    } catch (e) { return ""; }
  })();
  const startParam = /^ref_\d{1,20}$/.test(rawStart) ? rawStart : "";
  let challengeId = (() => {
    const c = new URLSearchParams(location.search).get("challenge") || ((/^ch_([0-9a-f]{10})$/.exec(rawStart) || [])[1]) || "";
    return /^[0-9a-f]{10}$/.test(c) ? c : "";
  })();
  const headers = () => {
    const h = { "Content-Type": "application/json" };
    if (tg?.initData) h["X-Telegram-Init-Data"] = tg.initData;
    if (startParam) h["X-Start-Param"] = startParam;
    return h;
  };
  let expiredShown = false;
  async function api(url, options = {}) {
    try {
      const r = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const j = await r.json().catch(() => null);
      if (j?.expired && !expiredShown) { expiredShown = true; toast("Сессия устарела — закрой и открой игру заново", 4000); }
      if (r.status === 429) toast("Слишком часто — подожди немного");
      return j ? { ...j, _status: r.status } : null;
    } catch (e) { return null; }
  }

  function toast(msg, ms = 1900) {
    el.toast.textContent = t(msg); el.toast.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.toast.classList.remove("show"), ms);
  }
  // своё окно подтверждения (одинаково выглядит и в Telegram, и в браузере)
  function confirmBox(text, okText = "Да", cancelText = "Отмена") {
    return new Promise((done) => {
      $("cfText").textContent = t(text); $("cfOk").textContent = t(okText); $("cfCancel").textContent = t(cancelText);
      $("confirm").classList.add("show");
      const close = (v) => { $("confirm").classList.remove("show"); $("cfOk").onclick = $("cfCancel").onclick = null; done(v); };
      $("cfOk").onclick = () => close(true); $("cfCancel").onclick = () => close(false);
    });
  }
  const fmtN = (n) => Number(n || 0).toLocaleString(locale());
  const fmtDay = (d) => { try { return new Date(d).toLocaleDateString(locale(), { day: "numeric", month: "short" }); } catch (e) { return ""; } };

  // ---------- главный экран ----------
  function ui() {
    $("coins").textContent = fmtN(p.coins); $("best").textContent = p.best_score || 0; $("pbest").textContent = p.best_score || 0;
    $("pcoins").textContent = fmtN(p.coins); $("pbestnw").textContent = p.best_nowalls || 0; $("refs").textContent = p.referrals || 0; $("pref").textContent = p.referrals || 0;
    $("name").textContent = p.first_name || "Игрок"; el.gc.textContent = fmtN(p.coins); $("streak").textContent = p.daily?.streak || 0;
    $("pseason").textContent = p.season?.number ? `🏅 Сезон #${p.season.number} — ${p.season_rank ? "место " + p.season_rank : "ты ещё не играл"}` : "";
    renderDaily(); renderMissions(); renderProfile(); renderer.setField(fieldId());
    const dot = (scr, on) => { const b = document.querySelector(`.nav [data-screen="${scr}"]`); if (b) b.classList.toggle("has-dot", !!on); };
    dot("missions", p.daily?.can_claim || (p.missions || []).some((m) => m.progress >= m.target && !m.claimed));
    dot("achievements", (p.achievements_list || []).some((a) => !a.claimed && a.ready));
    if (p.banned) { $("bannedBox").hidden = false; $("playBtn").disabled = true; }
  }

  function renderDaily() {
    const box = $("dailyBox"), d = p.daily;
    if (!d) { box.innerHTML = ""; return; }
    const tiles = d.rewards.map((r, i) => {
      const done = i < d.cycle_claimed, today = d.can_claim && i === d.cycle_claimed;
      const last = i === d.rewards.length - 1;
      return `<div class="day${done ? " done" : ""}${today ? " today" : ""}${last ? " last" : ""}">Д${i + 1}<b>${done ? "✅" : r}</b>${last && !done ? '<span class="chest">🎁</span>' : ""}</div>`;
    }).join("");
    const note = (d.broken ? "Серия прервалась — начинаем с 1-го дня 😢" : d.can_claim ? "Заходи каждый день — награда растёт. Пропустишь день — серия сбросится." : "Награда получена! Возвращайся завтра за следующей.") + " " + t("На 7-й день — сундук с аксессуаром 🎁");
    box.innerHTML = `<h3>📅 Ежедневная награда · 🔥 серия ${d.streak}</h3><small>${note}</small><div class="days">${tiles}</div>
      <button class="primary" id="dailyBtn" style="width:100%" ${d.can_claim ? "" : "disabled"}>${d.can_claim ? `🎁 Забрать +${d.reward} 🪙` : "Приходи завтра ⏳"}</button>`;
  }
  async function claimDaily() {
    const b = $("dailyBtn"); if (!b || b.disabled) return; b.disabled = true;
    const r = await api("/api/daily", { method: "POST" });
    if (r?.player) {
      p = { ...p, ...r.player }; ui(); renderShop(); if (r.reward) { sfx.claim(); haptic("success"); }
      if (r.chest) openChest(r.chest, r.reward);
      else toast(r.reward ? `+${r.reward} 🪙 Награда получена!` : "Уже получено сегодня");
    }
    else { toast("Не удалось получить награду"); renderDaily(); }
  }

  // сундук 7-го дня: короткая анимация открытия в окне подтверждения
  function openChest(ch, reward) {
    const a = ch.accessory;
    const text = a ? `🎁 ${t("Сундук открыт!")}\n${a.emoji} ${t(a.name)} — ${t("новый аксессуар!")}\n+${reward} 🪙` : `🎁 ${t("Сундук открыт!")}\n+${fmtN(ch.coins + reward)} 🪙`;
    confirmBox(text, a ? "Надеть" : "Круто!", "Закрыть").then((ok) => { if (ok && a) buyAcc(a.id); });
    $("cfText").classList.add("chestopen"); setTimeout(() => $("cfText").classList.remove("chestopen"), 900);
  }

  async function load() {
    const adm = await api("/api/admin/me"); $("adminBtn").hidden = !adm?.admin;
    const d = await api("/api/me");
    if (d?.player) p = { ...p, ...d.player, bot_username: d.bot_username || p.bot_username };
    if (d?.events) events = d.events;
    // язык выбирает устройство (или настройка игрока); сервер запоминает его для сообщений бота
    if (d?.player && d.player.lang !== SA.i18n.lang()) api("/api/settings", { method: "POST", body: JSON.stringify({ lang: SA.i18n.lang() }) });
    const passBtn = document.querySelector('.nav [data-screen="pass"]'); if (passBtn) passBtn.classList.toggle("has-dot", !!d?.pass?.claimable);
    renderEvents(); renderStarter();
    // «Что нового» — один раз на версию; новичкам не показываем (у них обучение), просто запоминаем версию
    if (d?.news && LS.get("snakeNews", "") !== d.news.version) {
      LS.set("snakeNews", d.news.version);
      if (Number(p.games_played || 0) > 0 && !urlReplay && !challengeId) {
        $("newsTitle").textContent = d.news.title;
        $("newsList").innerHTML = d.news.items.map((x) => `<li>${esc(x)}</li>`).join("");
        $("news").classList.add("show");
      }
    }
    if (urlReplay && !load.replayed) { load.replayed = true; startReplay(urlReplay.url); }
    else if (tg?.initDataUnsafe?.user) p.first_name = tg.initDataUnsafe.user.first_name || "Игрок";
    if (p.equipped_artifact && (p.owned_artifacts || []).includes(p.equipped_artifact)) sel.artifact = p.equipped_artifact;
    ui(); renderShop(); renderAchievements(); renderArtifacts(); renderChallengeBox();
    $("ref").textContent = refLink();
    const ib = $("invitedBy"); ib.hidden = !p.invited_by; if (p.invited_by) ib.textContent = "🎁 Тебя пригласил: " + p.invited_by;
    try {
      const seen = localStorage.getItem("snakeRefSeen"), now = Number(p.referrals || 0);
      if (seen !== null && now > Number(seen)) { toast(`👥 Новых друзей: +${now - Number(seen)} · +${(now - Number(seen)) * (p.ref_reward || 0)} 🪙`); sfx.claim(); }
      localStorage.setItem("snakeRefSeen", String(now));
    } catch (e) {}
    if (p.ref_reward) $("refInfo").textContent = `За каждого друга: +${p.ref_reward} 🪙 вам и +${p.ref_bonus} 🪙 другу.`;
  }

  // Вызов друга, пришедший по ссылке
  async function renderChallengeBox() {
    const box = $("challengeBox");
    if (!challengeId) { box.hidden = true; return; }
    const c = await api(`/api/challenge/${encodeURIComponent(challengeId)}`);
    if (!c?.challenge || c.challenge.taken) {
      box.hidden = true;
      if (c && !c.challenge) toast("Вызов уже недоступен");
      if (c?.challenge?.taken) toast("Этот вызов уже принят");
      challengeId = ""; return;
    }
    const ch = c.challenge, m = E.MODES[ch.mode] || E.MODES.classic, df = E.DIFFS[ch.diff] || E.DIFFS.normal;
    box.hidden = false;
    box.innerHTML = `<div class="chl"><div class="chl-ico">⚔️</div><div><b>${esc(ch.creator_name || "Друг")} вызывает тебя!</b>
      <small>Побей ${ch.creator_score} очков · ${m.emoji} ${m.name} · ${df.name} · то же поле</small></div></div>
      <button class="primary" id="acceptChallenge" style="width:100%;margin-top:10px">⚔️ Принять вызов</button>`;
    $("acceptChallenge").onclick = () => startRun({ kind: "challenge", ref: challengeId });
  }

  async function loadFriends() {
    const d = await api("/api/referrals"), a = d?.friends;
    if (!a) { $("friends").innerHTML = ""; return; }
    const reward = d.reward || p.ref_reward || 0;
    $("friendsSum").textContent = a.length ? `· ${a.length} · заработано ${a.length * reward} 🪙` : "";
    $("friends").innerHTML = a.length ? a.map((f) => `<div class="fr"><span class="lbav">${esc([...String(f.name || "?")][0].toUpperCase())}</span><div class="frn"><b>${esc(f.name)}</b><small>${f.username ? "@" + esc(f.username) + " · " : ""}${fmtDay(f.joined)}</small></div><span class="frc">+${reward} 🪙</span></div>`).join("")
      : '<div class="lbempty">Пока никого. Отправь ссылку другу — и он появится здесь 🐍</div>';
  }
  function refLink() {
    if (p.ref_link) return p.ref_link;
    const id = p.telegram_id || tg?.initDataUnsafe?.user?.id;
    return id ? location.origin + location.pathname + "?startapp=ref_" + id : location.origin + location.pathname;
  }

  async function renderAchievements() {
    const lv = p.level || { level: 1, xp: 0, progress: 0, next: 100 };
    $("xpBox").innerHTML = `<h3>🐍 Уровень ${lv.level}</h3><small>XP ${lv.xp} · до следующего ${lv.next}</small><div class="bar" style="margin-top:9px"><i style="width:${lv.progress}%"></i></div>`;
    const a = p.achievements_list || [];
    const GROUPS = { play: "🎮 Игра", food: "🍎 Еда", score: "🎯 Очки и комбо", levels: "🕳️ Уровни", loyal: "📅 Верность", collect: "🎨 Коллекция", friends: "👥 Друзья" };
    // сначала готовые к получению, потом по разделам
    const ready = a.filter((x) => x.ready && !x.claimed);
    const row = (x) => {
      const can = !x.claimed && x.ready, pct = x.target ? Math.round(((x.progress ?? 0) / x.target) * 100) : 0;
      const sub = x.claimed ? "Награда получена" : x.ready ? "Готово — забери награду!" : x.target ? `${fmtN(x.progress || 0)} / ${fmtN(x.target)}` : "Пока не выполнено";
      return `<div class="achievement${x.claimed ? " done" : ""}${can ? " can" : ""}"><div class="ai">${x.icon}</div><div class="ab"><b>${esc(t(x.title))}</b><small>${t(sub)}</small>${!x.claimed && !x.ready && x.target ? `<div class="bar thin"><i style="width:${pct}%"></i></div>` : ""}</div><button class="${can ? "ready" : ""}" data-ach="${x.id}" ${can ? "" : "disabled"}>${x.claimed ? "✅" : `+${x.reward} 🪙`}</button></div>`;
    };
    const done = a.filter((x) => x.claimed).length;
    let html = `<div class="achsum">🏅 ${done} / ${a.length}</div>`;
    if (ready.length) html += `<h3 class="sect">🎁 ${t("Можно забрать")}</h3>` + ready.map(row).join("");
    for (const [g, title] of Object.entries(GROUPS)) {
      const list = a.filter((x) => (x.group || "play") === g && !(x.ready && !x.claimed)); if (!list.length) continue;
      html += `<h3 class="sect">${t(title)}</h3>` + list.map(row).join("");
    }
    $("achievementList").innerHTML = html;
  }
  async function claimAchievement(b) {
    b.disabled = true;
    const r = await api("/api/achievement", { method: "POST", body: JSON.stringify({ id: b.dataset.ach }) });
    if (r?.player) { p = { ...p, ...r.player }; ui(); renderAchievements(); sfx.claim(); toast(`+${r.reward} 🪙 Достижение!`); }
    else { toast("Не удалось забрать награду"); renderAchievements(); }
  }

  // Поделиться ссылкой (Telegram → системное меню → буфер обмена)
  async function shareLink(link, text) {
    try { if (tg?.openTelegramLink) { tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`); return; } } catch (e) {}
    if (navigator.share) { try { await navigator.share({ title: "Snake Arena", text, url: link }); return; } catch (e) {} }
    copyText(link);
  }
  async function copyText(u) {
    try { await navigator.clipboard.writeText(u); toast("Ссылка скопирована 📋"); }
    catch (e) {
      try { const t = document.createElement("textarea"); t.value = u; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); toast("Ссылка скопирована 📋"); }
      catch (_) { toast("Скопируй ссылку вручную"); }
    }
  }
  // Вызов: по конкретному забегу (то же поле) или, по старинке, по рекорду
  async function createChallenge(gameId) {
    const body = gameId ? { game_id: gameId } : { score: Math.max(p.best_score || 0, 0) };
    if (!gameId && !body.score) { toast("Сначала сыграй хотя бы один раунд"); return; }
    const r = await api("/api/challenge", { method: "POST", body: JSON.stringify(body) });
    if (!r?.id) { toast("Не удалось создать вызов"); return; }
    const link = r.link || `${location.origin}/?challenge=${r.id}`;
    const m = E.MODES[r.mode] || E.MODES.classic;
    shareLink(link, `⚔️ Побей мой результат в Snake Arena: ${r.score} очков (${m.emoji} ${m.name}) — на том же поле!`);
  }

  // ---------- навигация ----------
  function show(id) {
    document.querySelectorAll(".app .screen").forEach((x) => x.classList.remove("active"));
    $(id).classList.add("active");
    if (id === "rating") renderRating();
    if (id === "season") renderSeason();
    if (id === "daily") renderDailyChallenge();
    if (id === "achievements") renderAchievements();
    if (id === "profile") loadFriends();
    if (id === "shop") { renderShop(); renderArtifacts(); }
    if (id === "pass") renderPass();
    if (id === "levels") renderLevels();
    if (id === "tournament") renderTournament();
    if (id === "clans") renderClans();
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  // Голова змейки в рейтинге: цвета из скина игрока; у недельных скинов палитру присылает сервер
  const HEX = /^#[0-9a-f]{6}$/i;
  function headHtml(skin, palette) {
    const pal = Array.isArray(palette) && palette.length === 2 && palette.every((c) => HEX.test(c)) ? palette : null;
    const c = pal || SA.HEAD_COLORS[skin] || SA.HEAD_COLORS.classic;
    const epic = !!pal || !!SA.EPIC[skin];
    const cls = ["lbhd", epic ? "epic" : "", skin === "rainbow" || skin === "prism" ? "hue" : epic ? "pulse" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}" style="--c0:${c[0]};--c1:${c[1]}" title="${esc(skin)}"></span>`;
  }
  const medal = ["🥇", "🥈", "🥉"];
  const lbRow = (x, i, val) => `<div class="lbrow${i < 3 ? " top" + (i + 1) : ""}${x.is_me ? " me" : ""}"><span class="lbpos">${i < 3 ? medal[i] : i + 1}</span>${headHtml(x.skin, x.palette)}<span class="lbname">${esc(x.name || "Игрок")}${x.is_me ? " <em>(ты)</em>" : ""}</span><b>${val} 🏆</b></div>`;
  const tabsHtml = (items, on) => items.map(([id, name]) => `<button data-tab="${id}" class="${id === on ? "on" : ""}">${name}</button>`).join("");

  // ---------- рейтинг: все / друзья / по режимам ----------
  let ratingTab = "all", ratingMode = "nowalls";
  async function renderRating() {
    $("ratingTabs").innerHTML = tabsHtml([["all", "Все"], ["friends", "Друзья"], ["modes", "Режимы"]], ratingTab);
    const modes = Object.entries(E.MODES).filter(([, m]) => !m.rated && !m.hidden);
    $("modeTabs").hidden = ratingTab !== "modes";
    $("modeTabs").innerHTML = modes.map(([id, m]) => `<button data-rmode="${id}" class="${id === ratingMode ? "on" : ""}">${m.emoji} ${m.name}</button>`).join("");
    const table = $("table"); table.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const url = ratingTab === "friends" ? "/api/leaderboard/friends" : ratingTab === "modes" ? `/api/leaderboard/mode?mode=${ratingMode}` : "/api/leaderboard";
    const d = await api(url);
    if (!d || !d.leaderboard) { table.innerHTML = '<div class="lbempty">Не удалось загрузить рейтинг. Проверь соединение.</div>'; return; }
    const key = ratingTab === "modes" ? "score" : "best_score", a = d.leaderboard;
    let head = "";
    if (ratingTab === "all") $("ratingSub").textContent = "Лучшие рекорды за всё время · «Классика»";
    if (ratingTab === "friends") $("ratingSub").textContent = d.friends_count ? `Ты и твои друзья (${d.friends_count}): приглашённые и соперники по вызовам` : "Пригласи друзей или брось вызов — и они появятся здесь";
    if (ratingTab === "modes") $("ratingSub").textContent = `Отдельный рейтинг режима ${E.MODES[ratingMode].emoji} ${E.MODES[ratingMode].name} (без лёгкой сложности)`;
    if (d.me) head = `<div class="lbme"><span>Твоё место</span><span>#${d.me.rank} · ${d.me[key] ?? d.me.best ?? d.me.score ?? ""}</span></div>`;
    table.innerHTML = head + (a.length ? a.map((x, i) => lbRow(x, i, x[key])).join("") : `<div class="lbempty">${ratingTab === "friends" ? "Пока пусто — позови друзей 🐍" : "Пока пусто — стань первым! 🐍"}</div>`);
  }

  // ---------- сезон ----------
  let seasonEnd = 0, seasonTab = "all";
  function tickSeason() {
    const t = $("seasonTimer"); if (!t || !seasonEnd) return;
    const ms = seasonEnd - Date.now();
    if (ms <= 0) { t.textContent = "сезон завершён"; return; }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1e3) % 60;
    t.textContent = (d ? d + " д " : "") + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }
  setInterval(() => { if ($("season").classList.contains("active")) tickSeason(); }, 1000);
  async function loadSeasonHistory() {
    const d = await api("/api/season/history"), a = d?.history || [], box = $("seasonHistory");
    box.innerHTML = a.length ? a.map((x) => `<div class="lbrow${x.rank <= 3 ? " top" + x.rank : ""}"><span class="lbpos">${medal[x.rank - 1] || "#" + x.rank}</span><span class="lbname">Сезон #${x.number}<small style="display:block">${fmtDay(x.starts_at)} – ${fmtDay(x.ends_at)} · ${x.players} игр.</small></span><b>${x.score} 🏆</b></div>`).join("") : '<div class="lbempty">Пока нет завершённых сезонов с твоим участием</div>';
  }
  async function renderSeason() {
    $("seasonTabs").innerHTML = tabsHtml([["all", "Все"], ["friends", "Друзья"]], seasonTab);
    const table = $("seasonTable");
    const d = await api("/api/season");
    if (!d) { table.innerHTML = '<div class="lbempty">Не удалось загрузить рейтинг. Проверь соединение.</div>'; return; }
    const end = d.season?.ends_at ? new Date(d.season.ends_at).toLocaleDateString(locale(), { day: "numeric", month: "long" }) : "";
    seasonEnd = d.season?.ends_at ? new Date(d.season.ends_at).getTime() : 0;
    $("seasonInfo").innerHTML = `🔥 <b>Сезон #${d.season?.number || "?"}</b> · до ${end}<br>⏱️ До конца: <b id="seasonTimer"></b><br>Твоё место: <b>${d.me ? "#" + d.me.rank : "—"}</b>`;
    tickSeason(); loadSeasonHistory();
    const myRank = d.me?.rank || 999999, claim = d.claim;
    $("seasonRewards").innerHTML = `<h3 style="margin:0 0 8px">🎁 Награды сезона</h3>` + (d.rewards || []).map((r) => `<div class="srw"><span class="srwi">${r.icon}</span><div><b>${esc(r.title)}</b><small>${esc(r.label)} · +${r.coins} 🪙</small></div><span>${myRank <= r.rank ? "✅" : "🔒"}</span></div>`).join("")
      + (claim && !claim.claimed ? `<button class="primary" id="claimSeasonBtn" style="width:100%;margin-top:8px">🎁 Забрать награду · ${esc(claim.reward.title)} (#${claim.rank})</button>` : "")
      + (claim && claim.claimed ? `<small style="display:block;margin-top:8px">✅ Награда за прошлый сезон получена (${esc(claim.reward.title)})</small>` : "");
    const cb = $("claimSeasonBtn");
    if (cb) cb.onclick = async () => {
      cb.disabled = true;
      const r = await api("/api/season/claim", { method: "POST", body: "{}" });
      if (r?.player) { p = { ...p, ...r.player }; ui(); renderShop(); sfx.claim(); haptic("success"); toast(`🏆 ${r.reward.title} получен!`); }
      else toast(r?.error === "Already claimed" ? "Награда уже получена" : "Не удалось забрать награду");
      renderSeason();
    };
    $("replayBtn").hidden = !(d.leaderboard || []).length;
    let a = d.leaderboard || [];
    if (seasonTab === "friends") {
      const f = await api("/api/leaderboard/friends?scope=season");
      a = f?.leaderboard || [];
    }
    table.innerHTML = a.length ? a.map((x, i) => lbRow(x, i, x.score)).join("") : `<div class="lbempty">${seasonTab === "friends" ? "Друзья ещё не играли в этом сезоне" : "Сезон только начался — стань первым!"}</div>`;
  }

  // ---------- челлендж дня ----------
  async function renderDailyChallenge() {
    const box = $("dailyTable"); box.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const d = await api("/api/daily-challenge");
    if (!d) { box.innerHTML = '<div class="lbempty">Не удалось загрузить. Проверь соединение.</div>'; return; }
    $("dailyInfo").innerHTML = `📅 <b>${new Date(d.day + "T12:00:00").toLocaleDateString(locale(), { day: "numeric", month: "long" })}</b> · одно поле для всех<br>`
      + (d.me ? `Твой лучший результат: <b>${d.me.best}</b> · место <b>#${d.me.rank}</b> · попыток ${d.me.runs}` : `Первый забег дня: <b>+${d.bonus} 🪙</b> бонусом`);
    box.innerHTML = d.leaderboard.length ? d.leaderboard.map((x, i) => lbRow(x, i, x.score)).join("") : '<div class="lbempty">Сегодня ещё никто не играл — будь первым!</div>';
  }

  function renderMissions() {
    const row = (m) => {
      const pct = Math.min(100, Math.round((m.progress / m.target) * 100)), ready = m.progress >= m.target && !m.claimed;
      const right = m.claimed ? '<span class="msn-ok">✅</span>' : `<button class="claim${ready ? " ready" : ""}" data-m="${m.id}" ${ready ? "" : "disabled"}>${ready ? "Забрать " : ""}+${m.reward} 🪙</button>`;
      return `<div class="msn${m.claimed ? " done" : ""}${m.weekly ? " weekly" : ""}"><div class="msn-ico">${m.icon}</div><div class="msn-body"><b>${esc(m.title)}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${m.progress} / ${m.target}</small></div>${right}</div>`;
    };
    const all = p.missions || [];
    $("missionList").innerHTML = all.filter((m) => !m.weekly).map(row).join("");
    $("weeklyList").innerHTML = all.filter((m) => m.weekly).map(row).join("");
  }
  async function claimMission(id) {
    const r = await api("/api/mission", { method: "POST", body: JSON.stringify({ id }) });
    if (r?.player) { p = { ...p, ...r.player }; ui(); if (r.reward) { sfx.claim(); haptic("success"); toast(`+${r.reward} 🪙 · +${r.pass_xp} XP пропуска`); } }
    else toast("Не удалось получить награду");
  }

  // ---------- артефакты: выбор и прокачка ----------
  const UNLOCK = { magnet: 1, berserk: 3, phantom: 7 };
  function renderArtifacts() {
    const list = p.artifacts || [], owned = p.owned_artifacts || ["magnet"];
    const card = (a, withUp) => {
      const has = owned.includes(a.id), on = sel.artifact === a.id, lvl = a.level || 1, max = a.max_level || E.MAX_ART_LEVEL;
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("");
      const up = withUp && has ? (a.next_cost ? `<button class="up" data-up="${a.id}" ${(p.coins || 0) < a.next_cost ? "disabled" : ""}>⬆ ${fmtN(a.next_cost)} 🪙</button>` : `<span class="maxlvl">MAX</span>`) : "";
      return `<div class="artifact${has ? "" : " lock"}${on ? " sel" : ""}" data-artifact="${a.id}"><div class="aicon">${a.emoji}</div><b>${esc(a.name)}</b>
        ${has ? `<div class="pips" title="Уровень ${lvl}">${pips}</div>` : ""}<small>${has ? esc(a.desc) : `Откроется на уровне ${UNLOCK[a.id] || "?"}`}</small>${up}</div>`;
    };
    $("artifactGrid").innerHTML = list.map((a) => card(a, true)).join("");
    $("artifactPicker").innerHTML = list.map((a) => card(a, false)).join("");
  }
  async function pickArtifact(id) {
    const owned = p.owned_artifacts || ["magnet"];
    if (!owned.includes(id)) return toast("🔒 Артефакт ещё не открыт");
    sel.artifact = id; renderArtifacts();
    const r = await api("/api/artifact/equip", { method: "POST", body: JSON.stringify({ id }) });
    if (r?.player) p = { ...p, ...r.player };
  }
  async function upgradeArtifact(id) {
    const a = (p.artifacts || []).find((x) => x.id === id); if (!a?.next_cost) return;
    if ((p.coins || 0) < a.next_cost) return toast("Не хватает монет");
    if (!(await confirmBox(`Улучшить «${a.name}» до уровня ${a.level + 1} за ${fmtN(a.next_cost)} 🪙?`, "Улучшить"))) return;
    const r = await api("/api/artifact/upgrade", { method: "POST", body: JSON.stringify({ id }) });
    if (r?.player) { p = { ...p, ...r.player }; ui(); renderArtifacts(); sfx.claim(); haptic("success"); toast(`${a.emoji} ${a.name}: уровень ${r.level}!`); }
    else toast(r?.error === "Not enough coins" ? "Не хватает монет" : "Не удалось улучшить");
  }

  // ---------- магазин ----------
  const fieldId = () => (SA.FIELD_STYLE[p.field_skin] ? p.field_skin : "classic");
  const skinCat = () => p.skins || SA.DEFAULT_SKINS;
  const fieldCat = () => p.fields || SA.DEFAULT_FIELDS;
  const skinPalette = (id) => skinCat().find((z) => z.id === id && z.weekly)?.palette || null;
  // ---------- профиль: аватар с рамкой по уровню, значки, статистика, «как я выгляжу» ----------
  const FRAMES = [[1, "bronze", "🥉"], [10, "silver", "🥈"], [20, "gold", "🥇"], [35, "diamond", "💎"]];
  function renderProfile() {
    const lv = p.level || { level: 1, progress: 0 };
    const fr = FRAMES.filter(([l]) => lv.level >= l).pop();
    const ava = $("pava"); if (!ava) return;
    ava.className = "pava fr-" + fr[1];
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    if (photo && /^https:\/\//.test(photo)) $("pavaTxt").innerHTML = `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`;
    else $("pavaTxt").textContent = [...String(p.first_name || "🐍")][0].toUpperCase();
    $("pname").textContent = p.first_name || t("Игрок");
    $("plevel").textContent = `${fr[2]} ${t("Уровень")} ${lv.level}`;
    $("pxp").style.width = (lv.progress || 0) + "%";
    const a = (p.achievements_list || []), got = a.filter((x) => x.claimed);
    $("badgeSum").textContent = `${got.length} / ${a.length}`;
    $("badges").innerHTML = a.map((x) => `<span class="bdg${x.claimed ? " on" : ""}" title="${esc(t(x.title))}">${x.icon}</span>`).join("");
    const st = [["🎮", p.games_played, "забегов"], ["🍎", p.total_apples, "фруктов"], ["🏆", p.best_score, "рекорд"], ["⚡", p.best_combo, "лучшее комбо"],
      ["🕳️", `${p.levels_done || 0}/30`, "уровней"], ["⭐", `${p.level_stars || 0}/90`, "звёзд"], ["🎨", (p.owned_skins || []).length, "скинов"], ["🎩", (p.owned_accessories || []).length, "аксессуаров"]];
    $("pstats").innerHTML = st.map(([i, v, l]) => `<div><b>${i} ${typeof v === "number" ? fmtN(v) : esc(v)}</b><small>${t(l)}</small></div>`).join("");
    drawLook();
  }
  // маленький портрет змейки игрока: голова со скином и аксессуаром
  function drawLook() {
    const cv = $("plook"); if (!cv) return;
    const x = cv.getContext("2d"), S = 96; x.clearRect(0, 0, S, S);
    const skin = p.skin || "classic", epic = SA.EPIC[skin], cols = skinPalette(skin) || SA.SKIN_COLORS[skin] || SA.SKIN_COLORS.classic, now = performance.now();
    const c0 = SA.hex2rgb(cols[0]), c1 = SA.hex2rgb(cols[1]);
    x.lineCap = "round";
    const pts = Array.from({ length: 14 }, (_, k) => ({ x: 70 - k * 4.2, y: 58 + Math.sin(k * 0.7) * 9 }));
    for (let k = pts.length - 1; k > 0; k--) { const tt = k / pts.length; x.strokeStyle = epic ? epic.color(tt, now) : SA.mix(c0, c1, tt); x.lineWidth = 22 * (1 - 0.45 * tt); x.beginPath(); x.moveTo(pts[k].x, pts[k].y); x.lineTo(pts[k - 1].x, pts[k - 1].y); x.stroke(); }
    const H = { x: 70, y: 56 }, r = 15, f = { x: 1, y: 0 }, pr = { x: 0, y: 1 };
    x.fillStyle = epic ? epic.color(0, now) : cols[0]; x.beginPath(); x.ellipse(H.x, H.y, r * 1.08, r, 0, 0, Math.PI * 2); x.fill();
    for (const sd of [-1, 1]) { x.fillStyle = "#fff"; x.beginPath(); x.arc(H.x + 4, H.y + sd * 7, 4.5, 0, Math.PI * 2); x.fill(); x.fillStyle = "#08130d"; x.beginPath(); x.arc(H.x + 5.5, H.y + sd * 7, 2.2, 0, Math.PI * 2); x.fill(); }
    if (p.accessory && SA.drawAccessoryOn) SA.drawAccessoryOn(x, p.accessory, H, f, pr, r, now);
  }

  const REWARD_CUR = ["season", "levels", "tournament", "pass"];
  const REWARD_LABEL = { season: "🏆 Награда сезона", levels: "🕳️ За уровни", tournament: "🏁 За турнир", pass: "🎟️ В пропуске" };
  function renderShop() {
    const owned = p.owned_skins || ["classic"], cat = skinCat();
    const card = (sk) => {
      const isOwned = owned.includes(sk.id), on = p.skin === sk.id, stars = sk.currency === "stars";
      const reward = REWARD_CUR.includes(sk.currency);
      const sub = isOwned ? "✅ Открыт" : reward ? esc(sk.desc || "Эксклюзив сезона") : stars ? esc(sk.desc || "") : sk.price ? "🪙 " + fmtN(sk.price) : "Бесплатно";
      const label = on ? "✅ Выбрано" : isOwned ? "Выбрать" : reward ? REWARD_LABEL[sk.currency] : stars ? `Купить · <span class="stp">⭐ ${sk.price}</span>` : sk.price ? "Купить" : "Выбрать";
      return `<div class="skin${sk.epic ? " epic" : ""}${on ? " sel" : ""}">${sk.epic ? '<span class="badge">EPIC</span>' : ""}<button class="pvbtn" data-pskin="${sk.id}" aria-label="Посмотреть на поле"><div class="pv ${sk.weekly ? "pv-weekly" : "pv-" + sk.id}"${sk.weekly && sk.palette ? ` style="--c0:${esc(sk.palette[0])};--c1:${esc(sk.palette[1])}"` : ""}></div><span>👁 на поле</span></button><b>${sk.emoji} ${esc(sk.name)}</b><small>${sub}</small><button data-skin="${sk.id}" class="${stars && !isOwned ? "star" : ""}">${label}</button></div>`;
    };
    const fowned = p.owned_fields || ["classic"];
    const fcard = (f) => {
      const isOwned = fowned.includes(f.id), on = fieldId() === f.id, stars = f.currency === "stars";
      const sub = isOwned ? "✅ Открыто" : stars ? esc(f.desc || "") : f.price ? "🪙 " + fmtN(f.price) : "Бесплатно";
      const label = on ? "✅ Включено" : isOwned ? "Включить" : stars ? `Купить · <span class="stp">⭐ ${f.price}</span>` : f.price ? `Купить · 🪙 ${fmtN(f.price)}` : "Включить";
      return `<div class="skin${f.epic ? " epic" : ""}${on ? " sel" : ""}">${f.epic ? '<span class="badge">EPIC</span>' : ""}<button class="pvbtn" data-pfield="${f.id}" aria-label="Посмотреть поле"><div class="fv fv-${f.id}"></div><span>👁 посмотреть</span></button><b>${f.emoji} ${esc(f.name)}</b><small>${sub}</small><button data-field="${f.id}" class="${stars && !isOwned ? "star" : ""}">${label}</button></div>`;
    };
    const fcat = fieldCat();
    const aowned = p.owned_accessories || [];
    const acard = (a) => {
      const isOwned = aowned.includes(a.id), on = p.accessory === a.id, stars = a.currency === "stars";
      const sub = isOwned ? "✅ Есть" : stars ? "⭐ " + a.price : "🪙 " + fmtN(a.price);
      const label = on ? "Снять" : isOwned ? "Надеть" : stars ? `Купить · <span class="stp">⭐ ${a.price}</span>` : "Купить";
      return `<div class="skin acc${a.epic ? " epic" : ""}${on ? " sel" : ""}">${a.epic ? '<span class="badge">EPIC</span>' : ""}<button class="pvbtn" data-pacc="${a.id}" aria-label="Примерить"><div class="accv">${a.emoji}</div><span>👁 примерить</span></button><b>${esc(a.name)}</b><small>${sub}</small><button data-acc="${a.id}" class="${stars && !isOwned ? "star" : ""}">${label}</button></div>`;
    };
    const acat = p.accessories || [];
    $("shopGrid").innerHTML =
      (acat.length ? `<h3 class="sect span2">🎩 Аксессуары<small>носятся с любым скином · 🎁 сундук на 7-й день серии</small></h3>` + acat.map(acard).join("") : "") +
      `<h3 class="sect span2">🏆 Награды<small>сезон, уровни, турниры и пропуск</small></h3>` + cat.filter((x) => REWARD_CUR.includes(x.currency)).sort((a, b) => owned.includes(b.id) - owned.includes(a.id) || b.weekly - a.weekly).map(card).join("") +
      `<h3 class="sect span2">⭐ Эпические скины<small>за Telegram Stars</small></h3>` + cat.filter((x) => x.epic && x.currency === "stars").map(card).join("") +
      `<h3 class="sect span2">🪙 Обычные скины<small>за монеты</small></h3>` + cat.filter((x) => x.currency === "coins").map(card).join("") +
      `<h3 class="sect span2">🗺 Игровые поля<small>за Telegram Stars</small></h3>` + fcat.filter((x) => x.currency === "stars").map(fcard).join("") +
      `<h3 class="sect span2">⬛ Простые поля<small>за монеты</small></h3>` + fcat.filter((x) => x.currency !== "stars").map(fcard).join("");
  }
  async function buy(id) {
    const sk = skinCat().find((x) => x.id === id); if (!sk || p.skin === id) return;
    const has = (p.owned_skins || ["classic"]).includes(id);
    if (!has && sk.currency === "stars") return buyStars(sk);
    if (!has && REWARD_CUR.includes(sk.currency)) return toast(sk.desc || "🏆 Этот скин можно получить только как награду");
    if (!has && (p.coins || 0) < sk.price) return toast("Не хватает монет");
    if (!has && !(await confirmBox(`Купить скин «${sk.name}» за ${fmtN(sk.price)} 🪙?`, "Купить"))) return;
    const d = await api("/api/profile", { method: "POST", body: JSON.stringify({ skin: id }) });
    if (d?.player) { p = { ...p, ...d.player }; ui(); renderShop(); closePreview(); toast(has ? "Скин выбран!" : "Скин куплен! 🎉"); if (!has) sfx.claim(); }
    else toast("Не получилось, попробуй ещё раз");
  }
  async function buyAcc(id) {
    const a = (p.accessories || []).find((x) => x.id === id); if (!a) return;
    const has = (p.owned_accessories || []).includes(id);
    if (has && p.accessory === id) { // снять
      const d = await api("/api/accessory", { method: "POST", body: JSON.stringify({ accessory: "" }) });
      if (d?.player) { p = { ...p, ...d.player }; ui(); renderShop(); closePreview(); toast("Аксессуар снят"); }
      return;
    }
    if (!has && a.currency === "stars") return buyStars(a, "acc");
    if (!has && (p.coins || 0) < a.price) return toast("Не хватает монет");
    if (!has && !(await confirmBox(`Купить «${a.name}» за ${fmtN(a.price)} 🪙?`, "Купить"))) return;
    const d = await api("/api/accessory", { method: "POST", body: JSON.stringify({ accessory: id }) });
    if (d?.player) { p = { ...p, ...d.player }; ui(); renderShop(); closePreview(); toast(has ? `${a.emoji} ${t("Надето!")}` : `${a.emoji} ${t("Куплено и надето!")} 🎉`); if (!has) sfx.claim(); }
    else toast("Не получилось, попробуй ещё раз");
  }
  // Покупки за Telegram Stars: сервер создаёт счёт, предмет выдаёт вебхук бота после оплаты
  async function buyStars(item, kind = "skin") {
    if (!tg?.openInvoice) return toast("Оплата Stars работает только внутри Telegram");
    if (p.stars_enabled === false) return toast("Оплата пока недоступна");
    const r = await api("/api/invoice", { method: "POST", body: JSON.stringify(kind === "field" ? { field: item.id } : kind === "acc" ? { accessory: item.id } : { skin: item.id }) });
    if (!r?.url) return toast("Не удалось создать счёт");
    const ownedKey = kind === "field" ? "owned_fields" : kind === "acc" ? "owned_accessories" : "owned_skins";
    tg.openInvoice(r.url, async (status) => {
      if (status === "paid") {
        toast(kind === "field" ? "Оплата прошла! Включаем поле…" : "Оплата прошла! Активируем скин…");
        for (let i = 0; i < 15; i++) {
          await new Promise((o) => setTimeout(o, 1000));
          const d = await api("/api/me");
          if (d?.player && (d.player[ownedKey] || []).includes(item.id)) { p = { ...p, ...d.player }; ui(); renderShop(); closePreview(); sfx.claim(); toast(kind === "field" ? `${item.emoji} Поле «${item.name}» твоё!` : kind === "acc" ? `${item.emoji} «${item.name}» твой!` : `${item.emoji} Скин «${item.name}» твой!`); return; }
        }
        toast("Платёж обрабатывается — покупка появится через минуту");
      } else if (status === "failed") toast("Оплата не удалась");
    });
  }
  async function buyField(id) {
    const f = fieldCat().find((x) => x.id === id); if (!f || fieldId() === id) return;
    const has = (p.owned_fields || ["classic"]).includes(id);
    if (!has && f.currency === "stars") return buyStars(f, "field");
    if (!has && (p.coins || 0) < f.price) return toast("Не хватает монет");
    if (!has && !(await confirmBox(`Купить поле «${f.name}» за ${fmtN(f.price)} 🪙?`, "Купить"))) return;
    const d = await api("/api/field", { method: "POST", body: JSON.stringify({ field: id }) });
    if (d?.player) { p = { ...p, ...d.player }; ui(); renderShop(); closePreview(); toast(has ? "Поле включено!" : "Поле куплено! 🎉"); if (!has) sfx.claim(); }
    else toast("Не получилось, попробуй ещё раз");
  }

  // ---------- превью скина/поля на настоящем поле ----------
  const PV_N = 12;
  const previewR = SA.createRenderer($("pvCanvas"), { N: PV_N });
  let pv = null;
  function openPreview(kind, id) {
    const item = kind === "skin" ? skinCat().find((x) => x.id === id) : kind === "acc" ? (p.accessories || []).find((x) => x.id === id) : fieldCat().find((x) => x.id === id);
    if (!item) return;
    const ownedList = kind === "skin" ? p.owned_skins || ["classic"] : kind === "acc" ? p.owned_accessories || [] : p.owned_fields || ["classic"];
    const has = ownedList.includes(id), on = kind === "skin" ? p.skin === id : kind === "acc" ? p.accessory === id : fieldId() === id;
    $("pvTitle").textContent = `${item.emoji} ${item.name}`;
    $("pvDesc").textContent = item.desc || (kind === "skin" ? "Скин змейки" : kind === "acc" ? "Аксессуар — носится с любым скином" : "Игровое поле");
    const btn = $("pvBuy");
    btn.className = !has && item.currency === "stars" ? "primary star" : "primary";
    btn.innerHTML = on ? (kind === "acc" ? "Снять" : "✅ Уже выбрано") : has ? (kind === "skin" ? "Выбрать" : kind === "acc" ? "Надеть" : "Включить")
      : item.currency === "stars" ? `Купить · <span class="stp">⭐ ${item.price}</span>` : item.currency === "season" ? "🏆 Только за сезон" : `Купить · 🪙 ${fmtN(item.price)}`;
    btn.disabled = (on && kind !== "acc") || item.currency === "season" && !has;
    btn.onclick = () => (kind === "skin" ? buy(id) : kind === "acc" ? buyAcc(id) : buyField(id));
    $("preview").classList.add("show");
    // змейка бегает по кругу по полю 12×12; еда стоит на пути
    const loop = [];
    for (let x = 2; x <= 9; x++) loop.push({ x, y: 2 });
    for (let y = 3; y <= 9; y++) loop.push({ x: 9, y });
    for (let x = 8; x >= 2; x--) loop.push({ x, y: 9 });
    for (let y = 8; y >= 3; y--) loop.push({ x: 2, y });
    pv = { kind, id, loop, i: 9, last: performance.now(), raf: 0, timer: 0 };
    previewR.setField(kind === "field" ? id : fieldId());
    requestAnimationFrame(() => {
      previewR.resize(); previewR.reset();
      const stepMs = 170;
      const cells = (i) => Array.from({ length: 9 }, (_, k) => loop[(i - k + loop.length * 4) % loop.length]);
      const view = () => ({
        snake: cells(pv.i), prevSnake: cells(pv.i - 1), food: { ...loop[(pv.i + 6) % loop.length], type: "apple" }, foodBorn: 0,
        dir: { x: 1, y: 0 }, stepMs, lastTick: pv.last, paused: false, rocks: [], pending: [],
        skin: kind === "skin" ? id : p.skin, palette: kind === "skin" ? skinPalette(id) : skinPalette(p.skin), acc: kind === "acc" ? id : p.accessory || ""
      });
      pv.timer = setInterval(() => { pv.i++; pv.last = performance.now(); }, stepMs);
      const frame = (now) => { if (!pv) return; previewR.draw(view(), now); pv.raf = requestAnimationFrame(frame); };
      pv.raf = requestAnimationFrame(frame);
    });
  }
  function closePreview() {
    if (pv) { clearInterval(pv.timer); cancelAnimationFrame(pv.raf); pv = null; }
    $("preview").classList.remove("show");
  }

  // ---------- настройки ----------
  function renderSettings() {
    const s = SA.settings.get();
    $("setSound").checked = s.sound; $("setVolume").value = s.volume; $("setVolume").disabled = !s.sound; $("setVolVal").textContent = s.volume + "%";
    $("setVibro").checked = s.vibro; $("sndBtn").textContent = s.sound && s.volume > 0 ? "🔊" : "🔇";
    $("setNotify").checked = p.notify !== false; $("setLang").value = SA.i18n.lang(); $("setTheme").value = LS.get("snakeTheme", "auto");
  }
  function openSettings() { renderSettings(); $("settings").classList.add("show"); }

  // ---------- события на главной ----------
  let events = null;
  function renderEvents() {
    const box = $("eventsBox"), ev = events;
    if (!ev) { box.hidden = true; return; }
    const items = [];
    for (const e of ev.list || []) items.push(`<div class="evt"><span>🎉</span><div><b>${esc(t(e.title))}</b><small>${t("Монеты за забеги")} ×${e.coin_mult}${e.ends_at ? " · " + t("до") + " " + new Date(e.ends_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : ""}</small></div></div>`);
    if (ev.tour) items.push(`<div class="evt tour" data-screen="tournament"><span>🏁</span><div><b>${t("Турнир выходных идёт!")}</b><small>${E.MODES[ev.tour.mode]?.emoji || ""} ${t(E.MODES[ev.tour.mode]?.name || "")} · ${t("призы — эксклюзивные кубки")}</small></div><i>›</i></div>`);
    const fm = E.MODES[ev.featured];
    if (fm) items.push(`<div class="evt feat"><span>${fm.emoji}</span><div><b>${t("Режим недели")}: ${t(fm.name)}</b><small>${t("награда")} ×${ev.featuredMult}</small></div></div>`);
    box.hidden = !items.length; box.innerHTML = items.join("");
  }
  // ---------- набор новичка ----------
  function renderStarter() {
    const box = $("starterBox"), o = p.starter_offer;
    if (!o || LS.get("snakeStarterHide", "") === "1") { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<button class="xbtn small" id="starterHide" aria-label="Скрыть">✕</button><div class="chl"><div class="chl-ico">🎁</div><div><b>${esc(t(o.name))}</b><small>${esc(t(o.desc))}</small></div></div>
      <button class="primary star" id="starterBuy" style="width:100%;margin-top:10px">${t("Забрать за")} <span class="stp">⭐ ${o.price}</span></button>`;
    $("starterBuy").onclick = () => buyProduct("starter");
    $("starterHide").onclick = () => { LS.set("snakeStarterHide", "1"); box.hidden = true; };
  }
  async function buyProduct(id) {
    if (!tg?.openInvoice) return toast("Оплата Stars работает только внутри Telegram");
    const r = await api("/api/invoice", { method: "POST", body: JSON.stringify({ product: id }) });
    if (!r?.url) return toast(r?.error === "Already owned" ? "Уже куплено" : "Не удалось создать счёт");
    tg.openInvoice(r.url, async (status) => {
      if (status !== "paid") { if (status === "failed") toast("Оплата не удалась"); return; }
      toast("Оплата прошла! Активируем…");
      for (let i = 0; i < 15; i++) {
        await new Promise((o) => setTimeout(o, 1000));
        if (id === "pass") { const d = await api("/api/pass"); if (d?.pass?.premium) { sfx.claim(); toast("🎟️ Премиум-пропуск активирован!"); renderPass(); return; } }
        else { const d = await api("/api/me"); if (d?.player && !d.player.starter_offer) { p = { ...p, ...d.player }; ui(); renderShop(); sfx.claim(); toast("🎁 Набор новичка получен!"); return; } }
      }
      toast("Платёж обрабатывается — покупка появится через минуту");
    });
  }

  // ---------- сезонный пропуск ----------
  const rewardText = (r) => [r.coins ? `${fmtN(r.coins)} 🪙` : "", r.skin ? `${(skinCat().find((x) => x.id === r.skin) || {}).emoji || "🎨"} ${t("скин")}` : ""].filter(Boolean).join(" + ");
  async function renderPass() {
    const box = $("passBox"); box.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const d = await api("/api/pass");
    if (!d?.pass) { box.innerHTML = '<div class="lbempty">Не удалось загрузить. Проверь соединение.</div>'; return; }
    const ps = d.pass, next = ps.next_xp, prevXp = ps.level * ps.tier_xp, pct = next ? Math.round(((ps.xp - prevXp) / (next - prevXp)) * 100) : 100;
    const tiers = ps.tiers.map((tr) => {
      const cell = (track, rw, claimed) => {
        const can = tr.reached && !claimed && (track === "free" || ps.premium);
        const lock = track === "prem" && !ps.premium;
        return `<button class="ptr ${track}${claimed ? " done" : ""}${can ? " ready" : ""}${lock ? " lock" : ""}" ${can ? `data-ptier="${tr.tier}" data-ptrack="${track}"` : "disabled"}>${claimed ? "✅" : lock ? "🔒" : ""} ${rewardText(rw)}</button>`;
      };
      return `<div class="prow${tr.reached ? " reached" : ""}"><span class="pnum">${tr.tier}</span>${cell("free", tr.free, tr.claimed_free)}${cell("prem", tr.prem, tr.claimed_prem)}</div>`;
    }).join("");
    box.innerHTML = `<div class="daily"><h3>🎟️ ${t("Сезон")} #${d.season.number} · ${t("ступень")} ${ps.level}/15</h3>
        <small>${t("Опыт пропуска")}: ${ps.xp}${next ? ` / ${next}` : ""} · ${t("за забеги и задания")}</small><div class="bar" style="margin-top:9px"><i style="width:${pct}%"></i></div></div>
      ${ps.premium ? `<div class="invby">⭐ ${t("Премиум активен — забирай награды второй дорожки")}</div>` : `<button class="primary star" id="passBuy" style="width:100%;margin:6px 0 10px">${t("Премиум-пропуск")} <span class="stp">⭐ ${d.product.price}</span><small style="display:block;font-weight:700">${esc(t(d.product.desc))}</small></button>`}
      <div class="phead"><span></span><b>${t("Бесплатно")}</b><b>⭐ ${t("Премиум")}</b></div>${tiers}`;
    const b = $("passBuy"); if (b) b.onclick = () => buyProduct("pass");
  }
  async function claimPass(tier, track) {
    const r = await api("/api/pass/claim", { method: "POST", body: JSON.stringify({ tier, track }) });
    if (r?.ok) { p = { ...p, ...r.player }; ui(); renderShop(); sfx.claim(); haptic("success"); toast(r.skin ? `🎉 ${t("Новый скин!")} +${r.coins} 🪙` : `+${r.coins} 🪙`); renderPass(); }
    else toast("Не удалось забрать награду");
  }

  // ---------- турнир выходных ----------
  async function renderTournament() {
    const box = $("tourBox"); box.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const d = await api("/api/tournament");
    if (!d) { box.innerHTML = '<div class="lbempty">Не удалось загрузить. Проверь соединение.</div>'; return; }
    const prizes = d.prizes.map((x) => `<div class="srw"><span class="srwi">${x.skin ? (skinCat().find((s) => s.id === x.skin) || {}).emoji || "🏆" : "🪙"}</span><div><b>${esc(t(x.label))}</b><small>+${fmtN(x.coins)} 🪙${x.skin ? " + " + esc(t((skinCat().find((s) => s.id === x.skin) || {}).name || "")) : ""}</small></div></div>`).join("");
    const cur = d.current, last = d.last, m = (id) => E.MODES[id] || E.MODES.classic;
    let html = "";
    if (cur) html += `<div class="invby">🏁 ${t("Турнир идёт до конца воскресенья")} · ${m(cur.mode).emoji} ${t(m(cur.mode).name)}<br>${cur.me ? `${t("Твой лучший")}: <b>${cur.me.best}</b> · ${t("место")} <b>#${cur.me.rank}</b> · ${t("попыток")} ${cur.me.runs}` : t("Ты ещё не играл — у всех одно поле, сыграй сколько угодно раз")}</div>
      <button class="primary" id="tourPlay" style="width:100%;margin:10px 0">▶ ${t("Играть турнир")}</button>
      <div class="lb">${cur.leaderboard.length ? cur.leaderboard.map((x, i) => lbRow(x, i, x.score)).join("") : `<div class="lbempty">${t("Пока никто не играл — стань первым!")}</div>`}</div>`;
    else html += `<div class="invby">⏳ ${t("Следующий турнир — в субботу")}${d.next_start ? " " + new Date(d.next_start + "T12:00:00").toLocaleDateString(locale(), { day: "numeric", month: "long" }) : ""}. ${t("Одно поле для всех, без артефактов, лучший результат за выходные.")}</div>`;
    html += `<h3 class="sect">🎁 ${t("Призы")}</h3>${prizes}`;
    if (last && (last.me || last.leaderboard.length)) {
      html += `<h3 class="sect">📜 ${t("Прошлый турнир")} · ${fmtDay(last.id + "T12:00:00")}</h3>`;
      if (last.prize && !last.claimed) html += `<button class="primary" id="tourClaim" style="width:100%;margin:6px 0">🎁 ${t("Забрать приз за")} #${last.me.rank}</button>`;
      else if (last.me) html += `<small class="muted">${t("Твоё место")}: #${last.me.rank}${last.claimed ? " · ✅ " + t("приз получен") : ""}</small>`;
      html += `<div class="lb" style="margin-top:6px">${last.leaderboard.slice(0, 5).map((x, i) => lbRow(x, i, x.score)).join("")}</div>`;
    }
    box.innerHTML = html;
    const pl = $("tourPlay"); if (pl) pl.onclick = () => { returnTo = "tournament"; startRun({ kind: "tournament" }); };
    const cl = $("tourClaim"); if (cl) cl.onclick = async () => {
      cl.disabled = true; const r = await api("/api/tournament/claim", { method: "POST", body: "{}" });
      if (r?.ok) { p = { ...p, ...r.player }; ui(); renderShop(); sfx.claim(); haptic("success"); toast(`🏆 +${fmtN(r.prize.coins)} 🪙`); } else toast("Не удалось забрать приз");
      renderTournament();
    };
  }

  // ---------- кланы ----------
  let clanCfg = null;
  async function renderClans(term = "") {
    const box = $("clanBox"); if (!term) box.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const d = await api("/api/clans" + (term ? "?q=" + encodeURIComponent(term) : ""));
    if (!d) { box.innerHTML = '<div class="lbempty">Не удалось загрузить. Проверь соединение.</div>'; return; }
    clanCfg = d.cfg;
    const mine = d.mine;
    const clanRow = (c, i) => `<div class="lbrow${i < 3 ? " top" + (i + 1) : ""}${mine && mine.id === c.id ? " me" : ""}"><span class="lbpos">${i < 3 ? medal[i] : i + 1}</span><span class="clanav">${esc(c.emoji)}</span>
      <span class="lbname">${esc(c.name)} <small class="muted">[${esc(c.tag)}] · ${c.members}/${d.cfg.max}</small></span><b>${fmtN(c.score)}</b>${!mine && c.members < d.cfg.max ? `<button class="sm" data-cjoin="${c.id}">${t("Вступить")}</button>` : ""}</div>`;
    let html = "";
    if (mine) {
      html += `<div class="daily"><h3>${esc(mine.emoji)} ${esc(mine.name)} <small class="muted">[${esc(mine.tag)}]</small></h3>
        <small>${t("Место за неделю")}: <b>${mine.rank ? "#" + mine.rank : "—"}</b> · ${t("очки")}: <b>${fmtN(mine.score)}</b> · ${mine.members}/${d.cfg.max}</small>
        <div class="lb" style="margin-top:8px">${mine.members.map((x, i) => `<div class="lbrow${x.is_me ? " me" : ""}"><span class="lbpos">${i + 1}</span>${headHtml(x.skin, x.palette)}<span class="lbname">${esc(x.name)}${x.owner ? " 👑" : ""}${x.is_me ? ` <em>(${t("ты")})</em>` : ""}</span><b>${x.score}</b>${mine.is_owner && !x.is_me ? `<button class="sm" data-ckick="${esc(x.id)}">✕</button>` : ""}</div>`).join("")}</div>
        <div class="refbtns"><button class="alt" id="clanInvite">📤 ${t("Позвать в клан")}</button><button class="alt" id="clanLeave">🚪 ${t("Выйти")}</button></div></div>`;
    }
    html += `<small class="muted">${t("Очки клана — сумма лучших результатов сезона у топ-{n} участников. Топ-3 клана недели: каждому участнику", { n: d.cfg.top })} ${d.cfg.rewards.map(fmtN).join(" / ")} 🪙</small>`;
    html += `<div class="row" style="margin:10px 0"><input id="clanSearch" placeholder="${t("Поиск по названию или тегу")}" value="${esc(term)}"><button class="alt" id="clanFind">🔎</button></div>`;
    html += `<div class="lb">${d.clans.length ? d.clans.map(clanRow).join("") : `<div class="lbempty">${t("Кланов пока нет — создай первый!")}</div>`}</div>`;
    if (!mine) html += `<h3 class="sect">➕ ${t("Создать клан")} · ${fmtN(d.cfg.cost)} 🪙</h3>
      <div class="clanform"><input id="clanName" maxlength="20" placeholder="${t("Название (3–20 символов)")}"><input id="clanTag" maxlength="4" placeholder="${t("Тег (2–4)")}">
      <div class="emojis">${d.cfg.emojis.map((e, i) => `<button class="${i === 0 ? "on" : ""}" data-cemoji="${e}">${e}</button>`).join("")}</div>
      <button class="primary" id="clanCreate" style="width:100%">${t("Создать")}</button></div>`;
    box.innerHTML = html;
    const f = () => renderClans($("clanSearch").value.trim());
    $("clanFind").onclick = f; $("clanSearch").onkeydown = (e) => { if (e.key === "Enter") f(); };
    const cr = $("clanCreate"); if (cr) cr.onclick = async () => {
      const emoji = box.querySelector("[data-cemoji].on")?.dataset.cemoji;
      if ((p.coins || 0) < d.cfg.cost) return toast("Не хватает монет");
      if (!(await confirmBox(t("Создать клан за {n} 🪙?", { n: fmtN(d.cfg.cost) }), t("Создать")))) return;
      const r = await api("/api/clan/create", { method: "POST", body: JSON.stringify({ name: $("clanName").value, tag: $("clanTag").value, emoji }) });
      if (r?.ok) { p = { ...p, ...r.player }; ui(); sfx.claim(); toast("🛡️ Клан создан!"); renderClans(); } else toast(r?.error === "Not enough coins" ? "Не хватает монет" : r?.error || "Не удалось создать клан");
    };
    const lv = $("clanLeave"); if (lv) lv.onclick = async () => { if (await confirmBox(t("Выйти из клана?"), t("Выйти"))) { await api("/api/clan/leave", { method: "POST", body: "{}" }); renderClans(); } };
    const inv = $("clanInvite"); if (inv) inv.onclick = () => shareLink(refLink(), t("🛡️ Вступай в мой клан {clan} в Snake Arena!", { clan: `${mine.emoji} ${mine.name} [${mine.tag}]` }));
  }

  // ---------- обучение в первом забеге ----------
  function showTutorial() {
    const steps = [
      ["👆", t("Свайпай в любом месте экрана — змейка повернёт. Можно вести пальцем серию поворотов.")],
      ["🍎", t("Ешь яблоки подряд — растёт комбо и множитель очков. Монеты и звёзды дают больше.")],
      ["🎁", t("Подбирай бонусы: ⏳ замедление, 💎 ×2, 👻 призрак, 🛡️ щит, 🧲 магнит, 💣 бомба.")],
      ["✨", t("Первые 2 секунды змейка неуязвима. Не врезайся в стены и в себя — удачи!")]
    ];
    let i = 0;
    paused = true; clearTimeout(timer);
    const box = $("tutorial");
    const render = () => {
      box.querySelector(".tut-ico").textContent = steps[i][0];
      box.querySelector(".tut-text").textContent = steps[i][1];
      box.querySelector(".tut-dots").innerHTML = steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
      $("tutNext").textContent = i < steps.length - 1 ? t("Дальше") : t("Играть!");
    };
    $("tutNext").onclick = () => {
      if (++i < steps.length) return render();
      box.classList.remove("show"); LS.set("snakeTutorial", "1");
      api("/api/settings", { method: "POST", body: JSON.stringify({ tutorial_done: true }) });
      p.tutorial_done = true; paused = false; game.resume(); lastTick = performance.now(); schedule();
    };
    render(); box.classList.add("show");
  }

  // ---------- реплеи по ссылке ----------
  async function shareReplay() {
    if (!lastResult?.game_id) return;
    const r = await api("/api/replay/share", { method: "POST", body: JSON.stringify({ game_id: lastResult.game_id }) });
    if (!r?.link) return toast("Не удалось создать ссылку");
    shareLink(r.link, t("▶ Посмотри мой забег в Snake Arena: {n} очков!", { n: lastResult.score }));
  }
  const urlReplay = (() => {
    const qs = new URLSearchParams(location.search);
    const a = qs.get("areplay"); if (/^\d{1,15}$/.test(a || "")) return { url: `/api/admin/game/${a}/replay` };
    const r = qs.get("replay") || ((/^rp_([0-9a-f]{10})$/.exec(rawStart) || [])[1]) || "";
    return /^[0-9a-f]{10}$/.test(r) ? { url: `/api/replay/${r}` } : null;
  })();

  // ---------- живая змейка на главном экране (в цветах скина игрока) ----------
  (function heroSnake() {
    const cv = $("heroCv"); if (!cv) return;
    const x = cv.getContext("2d");
    let w = 0, h = 0, last = 0;
    const fit = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); w = r.width; h = r.height; cv.width = w * d; cv.height = h * d; x.setTransform(d, 0, 0, d, 0, 0); };
    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden || !$("home").classList.contains("active") || now - last < 33) return;
      last = now; if (!w) fit(); if (!w) return;
      x.clearRect(0, 0, w, h);
      const skin = p.skin || "classic", epic = SA.EPIC[skin], pal = skinPalette(skin), cols = pal || SA.SKIN_COLORS[skin] || SA.SKIN_COLORS.classic;
      const c0 = SA.hex2rgb(cols[0]), c1 = SA.hex2rgb(cols[1]), t0 = now / 1000, n = 34, seg = Math.max(10, w / 26);
      const pt = (k) => { const tt = t0 * 0.55 - k * 0.055; return { x: w * (0.5 + 0.42 * Math.sin(tt * 1.3)), y: h * (0.5 + 0.36 * Math.sin(tt * 2.1 + 1)) }; };
      x.lineCap = "round";
      for (let k = n; k > 0; k--) {
        const a = pt(k), b = pt(k - 1), tt = k / n;
        x.strokeStyle = epic ? epic.color(tt, now) : SA.mix(c0, c1, tt); x.lineWidth = seg * (1 - 0.45 * tt);
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
      }
      const hd = pt(0), nx = pt(1), fl = Math.hypot(hd.x - nx.x, hd.y - nx.y) || 1, f = { x: (hd.x - nx.x) / fl, y: (hd.y - nx.y) / fl }, pr = { x: -f.y, y: f.x }, r = seg * 0.62;
      x.fillStyle = epic ? epic.color(0, now) : cols[0]; x.beginPath(); x.arc(hd.x, hd.y, r, 0, Math.PI * 2); x.fill();
      const blink = now % 3600 < 140;
      for (const sd of [-1, 1]) {
        const ex = hd.x + f.x * r * 0.3 + pr.x * r * 0.5 * sd, ey = hd.y + f.y * r * 0.3 + pr.y * r * 0.5 * sd;
        if (blink) { x.strokeStyle = "#08130d"; x.lineWidth = 2; x.beginPath(); x.moveTo(ex - f.x * 3, ey - f.y * 3); x.lineTo(ex + f.x * 3, ey + f.y * 3); x.stroke(); continue; }
        x.fillStyle = "#fff"; x.beginPath(); x.arc(ex, ey, r * 0.28, 0, Math.PI * 2); x.fill();
        x.fillStyle = "#08130d"; x.beginPath(); x.arc(ex + f.x * r * 0.1, ey + f.y * r * 0.1, r * 0.13, 0, Math.PI * 2); x.fill();
      }
      if (p.accessory && SA.drawAccessoryOn) SA.drawAccessoryOn(x, p.accessory, hd, f, pr, r, now);
    }
    window.addEventListener("resize", () => { w = 0; });
    requestAnimationFrame(frame);
  })();

  // ---------- Режим «Уровни» ----------
  let levelsData = null;
  const starsHtml = (n, max = 3) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}">⭐</i>`).join("");
  async function renderLevels() {
    const box = $("levelBox"); if (!levelsData) box.innerHTML = '<div class="lbempty">Загрузка…</div>';
    const d = await api("/api/levels");
    if (!d?.levels) { box.innerHTML = '<div class="lbempty">Не удалось загрузить. Проверь соединение.</div>'; return; }
    levelsData = d;
    const next = d.levels.find((l) => l.unlocked && !l.done);
    let html = `<div class="lvhead"><b>⭐ ${d.total_stars} / ${d.max_stars}</b><small class="muted">${t("Звёзды — за скорость прохождения")}</small></div>`;
    for (const ch of d.chapters) {
      const lv = d.levels.filter((l) => l.chapter === ch.n), stars = lv.reduce((a, l) => a + l.stars, 0);
      html += `<div class="lvchapter ch${ch.n}"><h3>${ch.emoji} ${t("Глава")} ${ch.n}: ${esc(t(ch.name))}</h3><small class="muted">⭐ ${stars}/${lv.length * 3} · ${t("награда за главу")}: ${esc(ch.skin_emoji || "")} ${esc(t(ch.skin_name || ""))}</small>
        <div class="lvgrid">${lv.map((l) => `<button class="lvnode${l.done ? " done" : ""}${next && next.n === l.n ? " next" : ""}${l.unlocked ? "" : " lock"}${l.boss ? " boss" : ""}" data-level="${l.n}">${l.unlocked ? l.n : "🔒"}<small>${l.done ? "⭐".repeat(l.stars) : ""}</small></button>`).join("")}</div></div>`;
    }
    html += `<h3 class="sect">🏆 ${t("Лучшие по звёздам")}</h3><div class="lb" style="margin-top:8px">${d.leaderboard.length ? d.leaderboard.map((x, i) => lbRow(x, i, `${x.score} ⭐ · ${t("ур.")} ${x.max_level}`)).join("") : `<div class="lbempty">${t("Пока никто не прошёл ни одного уровня")}</div>`}</div>`;
    box.innerHTML = html;
  }
  function openLevel(n) {
    const l = levelsData?.levels.find((x) => x.n === n); if (!l) return;
    if (!l.unlocked) return toast("Сначала пройди предыдущий уровень");
    const feats = [l.walls ? `🧱 ${t("Стены и коридоры")}` : `🟩 ${t("Открытое поле")}`];
    if (l.moving) feats.push(`⚡ ${t("Живые камни: появляются и исчезают")}`);
    if (l.rival) feats.push(`🦹 ${t("Босс: змей-вор крадёт еду. Укуси его — он оглушён")}`);
    if (l.shrink) feats.push(`⚠️ ${t("Босс: поле сужается с краёв")}`);
    if (l.gates) feats.push(`🚪 ${t("Ворота закрываются по таймеру — мигают перед закрытием")}`);
    $("liEmoji").textContent = l.boss ? "👑" : "🕳️";
    $("liTitle").textContent = `${t("Уровень")} ${n}${l.boss ? " · " + t("финал главы") : ""}`;
    $("liBody").innerHTML = `<div class="lvstars">${starsHtml(l.stars)}</div><div class="liinfo">
      <div>🎯 ${t("Цель")}: <b>${l.target}</b> ${t("очков, затем заползи в норку")} 🕳️</div>
      ${feats.map((f) => `<div>${f}</div>`).join("")}
      <div>⭐⭐⭐ — ${t("быстрее {n} ходов", { n: l.par })} · ⭐⭐ — ${t("быстрее {n}", { n: Math.round(l.par * 1.6) })}</div>
      <div>🪙 ${l.done ? t("За новую звезду") + ": +" + l.star_reward : t("За прохождение") + ": +" + l.first_reward + " · " + t("за звезду") + " +" + l.star_reward}</div></div>`;
    $("liPlay").onclick = () => { $("levelInfo").classList.remove("show"); returnTo = "levels"; startRun({ kind: "level", ref: n }); };
    $("levelInfo").classList.add("show");
  }

  // ======================= ИГРА =======================
  const renderer = SA.createRenderer(el.cv, { N: E.N });
  let game = null, run = null, lastKind = { kind: "free" };
  let running = false, paused = false, countdown = 0, countdownAt = 0, cdTimer = 0, timer = 0, raf = 0, starting = false;
  let prevSnake = [], lastTick = 0, foodBorn = 0, fxSig = "";
  let replay = null; // { rp, name, score, skin, palette, speed }
  let pullAnim = null; // анимация еды, которую тянет магнит
  let holeAnim = null; // змейка заползает в норку: { t0 }
  let ghost = null;  // призрак: { rp, prev, label, skin, palette, dead, hd } — соперник или свой лучший забег на том же поле
  function makeGhost(gd, cfg) {
    if (!gd?.log && gd?.log !== "") return null;
    const log = E.parseLog(gd.log); if (!log) return null;
    const rp = E.player(gd.cfg ? E.normCfg(gd.cfg) : cfg, log, gd.ticks); // призрак — по правилам своего забега
    return { rp, prev: rp.game.snake.map((q) => ({ ...q })), label: gd.label === "Твой лучший" ? t("Твой лучший") : `${gd.label} · ${gd.score}`, skin: gd.skin, palette: gd.palette, dead: false, hd: { x: 1, y: 0 } };
  }
  function stepGhost() {
    if (!ghost || ghost.dead) return;
    ghost.prev = ghost.rp.game.snake.map((q) => ({ x: q.x, y: q.y }));
    if (ghost.rp.done()) { ghost.dead = true; return; }
    ghost.rp.next();
    if (ghost.rp.game.over) ghost.dead = true;
  }

  // какой фрукт сейчас на поле (только внешний вид): 0 — яблоко, 1–5 — вишня, клубника, виноград, арбуз, банан
  const fruitOf = (g, n) => ((n * 7 + (g.cfg.seed % 13)) % 9) % 6;
  // опасность прямо по курсу (для испуганной мордочки): стена, камень, тело или закрытые ворота в 1–2 клетках
  function dangerAhead(g) {
    if (g.isSafe() || g.ghostOn()) return false;
    const h = g.snake[0], d = g.queue.length ? g.queue[0] : g.dir, wrap = g.cfg.mode === "nowalls";
    for (let i = 1; i <= 2; i++) {
      let x = h.x + d.x * i, y = h.y + d.y * i;
      if (x < 0 || y < 0 || x >= E.N || y >= E.N) { if (!wrap) return true; x = (x + E.N) % E.N; y = (y + E.N) % E.N; }
      const k = y * E.N + x;
      if (g.rockSet[k] || (g.lv && g.gateClosed(x, y))) return true;
      if (g.occ[k] && !(i === 1 && g.snake[g.snake.length - 1].x === x && g.snake[g.snake.length - 1].y === y)) return true;
    }
    return false;
  }
  const curSkin = () => (replay ? replay.skin : p.skin) || "classic";
  const curPalette = () => (replay ? replay.palette : skinPalette(p.skin));
  function view() {
    const g = game;
    // заползание в норку: змейка исчезает с головы, сегмент за сегментом
    let snake = g.snake, prev = prevSnake;
    if (holeAnim) { const k = Math.min(snake.length, Math.floor((performance.now() - holeAnim.t0) / 45)); snake = snake.slice(k); prev = snake; }
    return {
      snake, prevSnake: prev, dir: g.dir, food: g.food && g.food.type === "apple" ? { ...g.food, fruit: fruitOf(g, g.apples) } : g.food, foodBorn,
      acc: replay ? replay.acc : p.accessory || "", danger: !g.over && dangerAhead(g), pu: g.pu, PU: E.PU, PU_LIFE: E.PU_LIFE, gameTime: g.gameTime,
      rocks: g.rocks, pending: g.pending, stepMs: g.stepMs() / (replay ? replay.speed : 1), lastTick, paused: paused || !!countdown,
      ghost: g.ghostOn(), safe: g.isSafe() && !g.over, shield: g.shield, skin: curSkin(), palette: curPalette(), countdown, countdownAt,
      combo: g.combo >= 2 ? Math.min(g.combo, 8) : 0,
      gates: g.gates || [], hole: g.hole, holeAnim, portals: g.portals, shrinkWarn: g.shrinkWarn || [],
      rival: g.rival ? { snake: g.rival.body, prevSnake: rivalPrev || g.rival.body, dir: g.rival.dir, stun: g.rival.stun > g.ticks } : null,
      ticks: g.ticks,
      foodFrom: pullAnim && pullAnim.food === g.food ? pullAnim : null,
      magnetR: g.fx.magnet > g.gameTime ? E.BONUS_MAGNET_RANGE : 0, magnetArt: g.cfg.artifact === "magnet" && g.cfg.rules >= 2,
      ghosts: ghost ? [{ snake: ghost.rp.game.snake, prevSnake: ghost.prev, dir: ghost.rp.game.dir, skin: ghost.skin, palette: ghost.palette, label: ghost.label, dead: ghost.dead, hd: ghost.hd }] : []
    };
  }
  function resizeCanvas() { renderer.resize(); if (game) renderer.draw(view()); }
  const stepAlpha = (now) => Math.min(1, Math.max(0, (now - lastTick) / game.stepMs()));

  function schedule() {
    clearTimeout(timer);
    if (!running || paused || countdown) return;
    timer = setTimeout(() => { doTick(); schedule(); }, game.stepMs() / (replay ? replay.speed : 1));
  }
  let rivalPrev = null;
  let dying = false; // после смерти ещё ~0.7 с рисуем, как змейка рассыпается (игровой цикл уже остановлен)
  function renderLoop(now) {
    if (!running && !dying) return;
    renderer.draw(view(), now);
    raf = requestAnimationFrame(renderLoop);
  }

  // Надписи событий — в строке над полем (а не на самом поле); «+очки» прыгают рядом со счётом
  function hudMsg(text, color = "#fff7c2") {
    const m = $("hudMsg"); m.textContent = text; m.style.color = color;
    m.classList.remove("on"); void m.offsetWidth; m.classList.add("on");
  }
  function scoreBump(text) {
    const b = $("scoreBump"); b.textContent = text;
    b.classList.remove("on"); void b.offsetWidth; b.classList.add("on");
  }
  function updateHud() {
    const g = game;
    el.score.textContent = g.score;
    el.gc.textContent = fmtN((replay ? 0 : p.coins || 0) + g.runCoins);
    // значки над полем: [ключ, иконка, название, значение, цвет]
    const chips = E.TIMED.filter((k) => g.fx[k] > g.gameTime).map((k) => [k, E.PU[k].icon, t(E.PU[k].name), Math.ceil((g.fx[k] - g.gameTime) / 1000) + "с", E.PU[k].color]);
    if (g.shield) chips.push(["shield", "🛡️", t("Щит"), "", E.PU.shield.color]);
    if (g.cfg.artifact === "phantom" && g.charges > 0) chips.push(["phantom", "👻", t("Фантом"), "×" + g.charges, "#b48cff"]);
    if (g.isSafe()) chips.push(["safe", "✨", t("Неуязвимость"), Math.ceil((g.safeUntil - g.gameTime) / 1000) + "с", "#9fffc8"]);
    if (g.lv) chips.unshift(g.hole ? ["goal", "🕳️", t("в норку!"), "", "#ffd84c"] : ["goal", "🎯", "", `${g.score}/${g.lv.target}`, "#9fffc8"]);
    const sig = chips.map((c) => c.join()).join("|");
    if (sig !== fxSig) {
      fxSig = sig;
      // обновляем по ключу: новый эффект появляется с анимацией, у старых меняются только цифры
      const box = $("fx"), keep = new Set(chips.map((c) => c[0]));
      box.classList.add("compact"); // эффекты — только значок и время, без названий
      for (const elx of [...box.children]) if (!keep.has(elx.dataset.k)) elx.remove();
      chips.forEach(([k, icon, name, val, color], i) => {
        let elx = box.querySelector(`[data-k="${k}"]`);
        if (!elx) { elx = document.createElement("span"); elx.className = "fxchip"; elx.dataset.k = k; elx.innerHTML = '<i class="ic"></i><b class="nm"></b><em class="vl"></em>'; }
        if (box.children[i] !== elx) box.insertBefore(elx, box.children[i] || null);
        elx.style.borderColor = color; elx.style.color = color;
        elx.querySelector(".ic").textContent = icon; elx.querySelector(".nm").textContent = name; elx.querySelector(".vl").textContent = val;
      });
    }
    const showCombo = g.combo >= 2;
    $("combo").classList.toggle("show", showCombo);
    if (showCombo) {
      const cm = Math.min(g.combo, E.COMBO_MAX);
      $("comboTxt").textContent = `COMBO ×${cm}` + (g.combo > E.COMBO_MAX ? " MAX" : "");
      $("comboBar").style.width = Math.round((g.comboTimer / E.COMBO_WINDOW) * 100) + "%";
    }
  }

  const SAVE_TEXT = { phantom: "👻 Фантом!", shield: "🛡️ Щит!", safe: "" };
  function handleEvent(e, interval) {
    const g = game;
    if (e.t === "ate") {
      renderer.eat(e.type === "apple" ? { ...e, fruit: fruitOf(g, g.apples - 1) } : e, interval); renderer.burst(e.x, e.y, e.type); renderer.ring(e.x, e.y, e.type === "apple" ? "#ff6b81" : "#ffd84c"); foodBorn = performance.now();
      if (e.cm >= 3) renderer.shake(2 + e.cm, 160);
      scoreBump(`+${e.pts}`);
      // над головой: очки за еду, у монет — сколько монет
      renderer.floater(e.x, e.y, e.coins ? `+${e.coins} 🪙` : `+${e.pts}`, e.coins ? "#ffd84c" : "#fff7c2");
      (e.type === "gold" ? sfx.gold : e.type === "coin" ? sfx.coin : sfx.eat)();
      haptic(e.type === "gold" ? "success" : "light");
    } else if (e.t === "pu") {
      const d = E.PU[e.type], h = g.snake[0];
      hudMsg(d.icon + " " + t(d.name), d.color); renderer.ring(h.x, h.y, d.color); sfx.power(); haptic("success");
    } else if (e.t === "bomb") {
      for (const c of e.cells) renderer.burst(c.x, c.y, "bomb", 6);
      sfx.boom(); haptic("heavy"); renderer.shake(9, 350); renderer.flash("255,140,60");
    } else if (e.t === "hole") { // цель набрана — открылась норка
      renderer.ring(e.x, e.y, "#ffd84c"); renderer.ring(e.x, e.y, "#ffffff"); sfx.claim(); haptic("success");
      hudMsg("🕳️ " + t("Норка открыта!"), "#ffd84c");
      toast("🕳️ Норка открыта — заползай!");
    } else if (e.t === "pull") { // магнит: еда плавно едет к голове
      pullAnim = { food: g.food, x: e.fx, y: e.fy, t: performance.now(), dur: interval };
      renderer.magnetSpark(e.fx, e.fy, e.x, e.y);
    } else if (e.t === "pu_spawn") {
      if (g.pu) g.pu.born = performance.now();
    } else if (e.t === "save") {
      if (SAVE_TEXT[e.kind]) { hudMsg(t(SAVE_TEXT[e.kind]), e.kind === "shield" ? "#6dffb0" : "#c58bff"); renderer.burst(e.x, e.y, "save", 16); renderer.flash("180,140,255"); sfx.save(); haptic("warning"); }
    } else if (e.t === "rocks") {
      if (g.pending.length) haptic("light");
    } else if (e.t === "teleport") { // портал
      renderer.ring(e.fx, e.fy, "#b07cff"); renderer.ring(e.x, e.y, "#b07cff"); renderer.burst(e.x, e.y, "save", 10); sfx.power(); haptic("medium");
    } else if (e.t === "portals") {
      renderer.ring(e.a.x, e.a.y, "#b07cff"); renderer.ring(e.b.x, e.b.y, "#b07cff");
    } else if (e.t === "smash") { // щит разбил камень
      renderer.shatter(e.x, e.y); renderer.shake(8, 300); sfx.boom(); haptic("heavy"); hudMsg("💥 " + t("Камень разбит!"), "#d6e2e6");
    } else if (e.t === "steal") { // вор утащил еду
      renderer.burst(e.x, e.y, "die", 12); hudMsg("🦹 " + t("Вор утащил еду!"), "#ff8a8a"); haptic("warning"); foodBorn = performance.now();
    } else if (e.t === "bite") {
      renderer.ring(e.x, e.y, "#ffd84c"); renderer.burst(e.x, e.y, "gold", 10); hudMsg("😵 " + t("Вор оглушён!"), "#ffd84c"); sfx.coin(); haptic("success");
    } else if (e.t === "shrinkwarn") {
      hudMsg("⚠️ " + t("Поле сужается!"), "#ff9a5c"); haptic("warning");
    } else if (e.t === "shrink") {
      renderer.shake(6, 300); sfx.boom(); haptic("heavy");
    }
  }

  function doTick() {
    if (!running || paused || countdown || !game) return;
    const g = game, interval = g.stepMs();
    prevSnake = g.snake.map((q) => ({ x: q.x, y: q.y }));
    rivalPrev = g.rival ? g.rival.body.map((q) => ({ x: q.x, y: q.y })) : null;
    const ev = replay ? replay.rp.next() : g.tick();
    if (!g.over) stepGhost();
    lastTick = performance.now();
    for (const e of ev) handleEvent(e, interval / (replay ? replay.speed : 1));
    if (g.over || (replay && replay.rp.done())) { finish(); return; }
    renderer.step(g.snake.length);
    updateHud();
  }

  function setdir(x, y) {
    if (!running || paused || countdown || replay || !game) return;
    if (!game.setdir(x, y)) return;
    // низкая задержка: если до следующего хода осталась большая часть шага, делаем ход сразу
    if (game.queue.length === 1 && stepAlpha(performance.now()) > 0.5) { doTick(); schedule(); }
    haptic("light");
  }

  function beginLoop() {
    dying = false; holeAnim = null; running = true; paused = false; countdown = 0; fxSig = "";
    prevSnake = game.snake.map((q) => ({ x: q.x, y: q.y })); lastTick = performance.now(); foodBorn = performance.now();
    renderer.reset(); if (run?.kind === "level") renderer.iris(12, 12, true, 750);
    $("fx").innerHTML = ""; $("combo").classList.remove("show"); $("hudMsg").classList.remove("on"); $("scoreBump").classList.remove("on");
    el.pauseBtn.textContent = "Ⅱ";
    requestAnimationFrame(() => { resizeCanvas(); updateHud(); });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(renderLoop);
    schedule();
  }

  // kindOpt: { kind: "free" } | { kind: "daily" } | { kind: "challenge", ref }
  async function startRun(kindOpt = { kind: "free" }) {
    if (starting) return; starting = true; closeRecord();
    stopReplay(true);
    SA.audio.unlock();
    el.over.classList.remove("show"); $("pauseMenu").classList.remove("show");
    el.game.classList.add("active"); $("startSplash").style.display = "none"; el.game.classList.remove("replay");
    $("gameTitle").textContent = kindOpt.kind === "level" ? `🕳️ ${t("Уровень")} ${kindOpt.ref}` : t(kindOpt.kind === "daily" ? "📅 Челлендж дня" : kindOpt.kind === "challenge" ? "⚔️ Вызов" : kindOpt.kind === "tournament" ? "🏁 Турнир" : "🐍 Snake Arena");
    const art = (p.artifacts || []).find((a) => a.id === sel.artifact);
    const d = await api("/api/run", { method: "POST", body: JSON.stringify({ mode: sel.mode, diff: sel.diff, artifact: sel.artifact, kind: kindOpt.kind, ref: kindOpt.ref }) });
    starting = false;
    let cfg, token = null;
    if (d?.token) { cfg = d.cfg; token = d.token; }
    else if (d?._status === 403 && d.banned) { el.game.classList.remove("active"); show("home"); return toast("Аккаунт заблокирован"); }
    else if (d?._status === 404 && kindOpt.kind === "challenge") { challengeId = ""; renderChallengeBox(); el.game.classList.remove("active"); show("home"); return toast("Вызов уже недоступен"); }
    else if (d?._status === 403 && kindOpt.kind === "level") { el.game.classList.remove("active"); show("levels"); return toast("Сначала пройди предыдущий уровень"); }
    else if (d?._status === 409 && kindOpt.kind === "tournament") { el.game.classList.remove("active"); show("tournament"); return toast("Турнир сейчас не идёт"); }
    else {
      cfg = { seed: (Math.random() * 2 ** 31) >>> 0, mode: sel.mode, diff: sel.diff, artifact: sel.artifact, artLevel: art?.level || 1, rules: E.RULES };
      toast("Нет связи с сервером — этот забег не будет засчитан", 3000);
    }
    run = { token, cfg, kind: d?.kind || kindOpt.kind, ref: kindOpt.ref };
    lastKind = run.kind === "challenge" ? { kind: "free" } : { kind: run.kind, ref: kindOpt.ref };
    if (run.kind === "challenge") { challengeId = ""; $("challengeBox").hidden = true; }
    game = new E.Game(cfg);
    ghost = makeGhost(d?.ghost, cfg);
    const m = E.MODES[game.cfg.mode], df = E.DIFFS[game.cfg.diff];
    $("gameSub").textContent = (game.lv ? `🎯 ${t("цель")} ${game.lv.target} · ${t("потом в норку")} 🕳️` : `${m.emoji} ${t(m.name)} · ${t(df.name)}`) + (ghost ? ` · 👻 ${ghost.label}` : "");
    beginLoop();
    if (!p.tutorial_done && run.kind === "free" && !LS.get("snakeTutorial", "")) showTutorial();
  }

  // ---------- пауза и отсчёт ----------
  function pause() {
    if (!running || countdown) return;
    if (!paused) {
      paused = true; clearTimeout(timer);
      el.pauseBtn.textContent = "▶"; $("pScore").textContent = game.score;
      if (!replay) $("pauseMenu").classList.add("show");
    } else if (replay) { paused = false; lastTick = performance.now(); el.pauseBtn.textContent = "Ⅱ"; schedule(); }
    else resumeWithCountdown();
  }
  // после паузы — отсчёт 3-2-1, затем 2 секунды неуязвимости (её даёт движок)
  function resumeWithCountdown() {
    $("pauseMenu").classList.remove("show");
    countdown = 3; countdownAt = performance.now(); sfx.tick(); haptic("light");
    clearInterval(cdTimer);
    cdTimer = setInterval(() => {
      countdown--; countdownAt = performance.now();
      if (countdown > 0) { sfx.tick(); haptic("light"); return; }
      clearInterval(cdTimer); sfx.go(); haptic("medium");
      paused = false; el.pauseBtn.textContent = "Ⅱ";
      game.resume(); lastTick = performance.now(); updateHud(); schedule();
    }, 1000);
  }
  async function quitRun() {
    $("pauseMenu").classList.remove("show");
    const ok = await confirmBox(game.score > 0 ? `Завершить забег? ${game.score} очк. будут засчитаны.` : "Завершить забег и выйти в меню?", "Завершить", "Играть дальше");
    if (ok) finish(true); else if (paused) $("pauseMenu").classList.add("show");
  }

  // ---------- конец забега ----------
  const readBest = (k) => Number(LS.get("snakeBest_" + k, 0)) || 0;
  let lastResult = null;
  function finish(quit = false) {
    if (!running) return;
    running = false; paused = false; countdown = 0;
    clearTimeout(timer); clearInterval(cdTimer); cancelAnimationFrame(raf);
    $("combo").classList.remove("show"); $("pauseMenu").classList.remove("show"); el.pauseBtn.textContent = "Ⅱ";
    renderer.draw(view());
    if (replay) { finishReplay(); return; }
    const g = game, res = g.result(), cfg = g.cfg, bestKey = cfg.mode + "_" + cfg.diff;
    const prevBest = Math.max(readBest(bestKey), cfg.mode === "classic" && cfg.diff !== "easy" ? Number(p.best_score || 0) : 0);
    const localRecord = res.score > 0 && prevBest > 0 && res.score > prevBest;
    if (res.score > readBest(bestKey)) LS.set("snakeBest_" + bestKey, res.score);
    lastResult = { ...res, cfg, kind: run.kind, reward: E.reward(res, cfg, localRecord), isRecord: localRecord, game_id: null, rated: E.isRated(cfg) };
    const send = run.token ? sendScore(g, res) : Promise.resolve(null);
    if (quit) {
      el.game.classList.remove("active"); el.over.classList.remove("show"); show("home");
      send.then((d) => { if (d?.result) toast(`Игра завершена · +${d.result.reward} 🪙`); load(); });
      return;
    }
    sfx.over(); haptic(res.win ? "success" : "error");
    const isLevel = run.kind === "level", viaHole = res.reason === "hole";
    if (!res.win) renderer.die(g.snake);
    // даём досмотреть, как змейка рассыпается (или заползает в норку), и только потом показываем итоги
    const animMs = viaHole ? Math.min(1100, 120 + g.snake.length * 45) : res.win ? 0 : 750;
    if (viaHole) { holeAnim = { t0: performance.now(), len: g.snake.length + 1 }; renderer.ring(g.hole.x, g.hole.y, "#ffd84c"); }
    // норка: после того как змейка заползла — «диафрагма» закрывается к норке
    const irisMs = viaHole ? 600 : 0;
    if (viaHole) setTimeout(() => { if (game === g) renderer.iris(g.hole.x, g.hole.y, false, irisMs); }, animMs);
    if (animMs) { dying = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(renderLoop); setTimeout(() => { if (game === g) { dying = false; cancelAnimationFrame(raf); } }, animMs + irisMs + 50); }
    $("overEmoji").textContent = viaHole ? "🕳️" : res.win ? "🏆" : "💥";
    $("overTitle").textContent = isLevel ? (viaHole ? `${t("Уровень")} ${run.ref} ${t("пройден!")}` : `${t("Уровень")} ${run.ref} ${t("не пройден")}`) : res.win ? "Поле заполнено!" : "Игра окончена";
    $("levelStars").hidden = !isLevel; $("levelStars").innerHTML = isLevel ? starsHtml(res.stars || 0) : "";
    $("nextLevelBtn").hidden = !(isLevel && viaHole && Number(run.ref) < E.LEVELS.length);
    $("levelsMapBtn").hidden = !isLevel;
    $("againBtn").textContent = isLevel ? (viaHole ? "🔄 " + t("Пройти быстрее") : "🔄 " + t("Ещё раз")) : "🔄 " + t("Играть ещё");
    $("final").textContent = res.score; $("oapples").textContent = res.apples; $("reward").textContent = lastResult.reward;
    $("recBadge").hidden = !localRecord;
    const m = E.MODES[cfg.mode], df = E.DIFFS[cfg.diff];
    $("overMode").textContent = run.kind === "level"
      ? `🎯 ${t("цель")} ${g.lv.target} · ⏱ ${res.ticks} ${t("ходов")} · ⭐⭐⭐ ≤ ${g.lv.par}`
      : `${m.emoji} ${m.name} · ${df.name}` + (run.kind === "daily" ? " · 📅 челлендж дня" : "") + (lastResult.rated ? "" : " · вне общего рейтинга");
    $("overInfo").textContent = run.token ? "Проверяем забег…" : "Забег не засчитан: нет связи с сервером";
    $("overInfo").className = "overinfo" + (run.token ? "" : " warn");
    $("duelBtn").hidden = true; $("shareResBtn").hidden = res.score <= 0; $("replayShareBtn").hidden = true; $("overExtra").innerHTML = "";
    setTimeout(() => { el.over.classList.add("show"); if (localRecord && !isLevel) showRecord(g, res, prevBest); }, animMs + irisMs);
    send.then((d) => {
      if (!d) return;
      if (d.result) {
        Object.assign(lastResult, { reward: d.result.reward, isRecord: d.result.is_record, game_id: d.result.game_id });
        $("reward").textContent = d.result.reward; $("recBadge").hidden = !d.result.is_record;
        if (d.result.is_record && !localRecord && !isLevel && res.score > 0) setTimeout(() => showRecord(g, res, prevBest), Math.max(0, animMs + irisMs - 200));
        const extra = [];
        if (d.daily) extra.push(`📅 Твоё место сегодня: #${d.daily.rank}` + (d.daily.bonus ? ` · бонус +${d.daily.bonus} 🪙` : ""));
        if (d.challenge_result) extra.push(d.challenge_result.win ? `🏆 Вызов выигран: ${d.challenge_result.score} > ${d.challenge_result.creator_score}` : `⚔️ Вызов проигран: ${d.challenge_result.score} против ${d.challenge_result.creator_score}`);
        if (d.tournament) extra.push(`🏁 Место в турнире: #${d.tournament.rank}`);
        if (d.level && !d.level.failed) {
          if (d.level.first) extra.push(`🎉 ${t("Уровень пройден впервые")}`);
          else if (d.level.stars > d.level.prev_stars) extra.push(`⭐ ${t("Новый рекорд звёзд")}`);
          if (d.level.chapter_skin) { const sk = skinCat().find((x) => x.id === d.level.chapter_skin); extra.push(`🎁 ${t("Глава пройдена! Скин")} ${sk ? sk.emoji + " " + t(sk.name) : ""}`); }
          levelsData = null;
        }
        $("overInfo").textContent = extra.join(" · ") || "✅ Забег засчитан";
        $("overInfo").className = "overinfo ok";
        const chips = [];
        for (const b of d.result.bonuses || []) chips.push(b.kind === "event" ? `🎉 ×${b.mult} событие` : `⭐ ×${b.mult} режим недели`);
        if (d.level?.bonus) chips.push(`🕳️ +${d.level.bonus} 🪙 ${t("за уровень")}`);
        if (d.result.xp) chips.push(`🎟️ +${d.result.xp} XP пропуска`);
        $("overExtra").innerHTML = chips.map((c) => `<span class="ochip">${esc(c)}</span>`).join("");
        $("duelBtn").hidden = !d.result.game_id || run.kind === "level"; $("replayShareBtn").hidden = !d.result.game_id;
        if ($("season").classList.contains("active")) renderSeason();
      } else if (d.reason || d.error) {
        $("overInfo").textContent = d.reload ? "Игра обновилась — перезапусти её" : d.expired ? "Сессия устарела — перезапусти игру" : d._status === 409 ? "Этот забег уже засчитан" : "⚠️ Забег не прошёл проверку и не засчитан";
        $("overInfo").className = "overinfo warn";
      }
    });
  }
  // ---------- новый рекорд: конфетти и замедленный повтор последних ~3 секунд ----------
  let recR = null, rec = null;
  function showRecord(g, res, prevBest) {
    if (rec || !g.log) return;
    $("recScore").textContent = res.score; $("recPrev").textContent = prevBest ? `${t("Прошлый рекорд")}: ${prevBest}` : "";
    $("record").classList.add("show"); sfx.claim(); haptic("success");
    if (!recR) recR = SA.createRenderer($("recCanvas"), { N: E.N });
    recR.setField(fieldId());
    const cfg = g.cfg, log = g.log.slice(), ticks = res.ticks, SLOW = 0.35, BACK = 30;
    rec = { raf: 0, timer: 0, conf: [], confRaf: 0 };
    const start = () => {
      const rp = E.player(cfg, log, ticks);
      while (!rp.done() && rp.game.ticks < ticks - BACK) rp.next();
      rec.rp = rp; rec.prev = rp.game.snake.map((q) => ({ ...q })); rec.last = performance.now(); rec.ended = false;
      recR.reset();
    };
    const vw = () => {
      const q = rec.rp.game;
      return { snake: q.snake, prevSnake: rec.prev, dir: q.dir, food: q.food && q.food.type === "apple" ? { ...q.food, fruit: fruitOf(q, q.apples) } : q.food, foodBorn: 0, pu: q.pu, PU: E.PU, PU_LIFE: E.PU_LIFE,
        gameTime: q.gameTime, rocks: q.rocks, pending: q.pending, stepMs: q.stepMs() / SLOW, lastTick: rec.last, paused: false, gates: q.gates || [], hole: q.hole, portals: q.portals,
        shrinkWarn: q.shrinkWarn || [], skin: p.skin, palette: skinPalette(p.skin), acc: p.accessory || "", combo: q.combo >= 2 ? Math.min(q.combo, 8) : 0, shield: q.shield, ghost: q.ghostOn(),
        rival: q.rival ? { snake: q.rival.body, prevSnake: q.rival.body, dir: q.rival.dir, stun: q.rival.stun > q.ticks } : null };
    };
    const step = () => {
      if (!rec) return;
      const q = rec.rp.game;
      if (rec.rp.done() || q.over) { // конец: змейка рассыпается, через паузу — сначала
        if (!rec.ended) { rec.ended = true; if (!q.win) recR.die(q.snake); }
        rec.timer = setTimeout(() => { if (rec) { start(); step(); } }, 1500); return;
      }
      rec.prev = q.snake.map((c) => ({ ...c }));
      const ev = rec.rp.next(); rec.last = performance.now();
      for (const e of ev) if (e.t === "ate") { recR.eat(e.type === "apple" ? { ...e, fruit: fruitOf(q, q.apples - 1) } : e, q.stepMs() / SLOW); recR.burst(e.x, e.y, e.type); recR.ring(e.x, e.y, "#ffd84c"); }
      recR.step(q.snake.length);
      rec.timer = setTimeout(step, q.stepMs() / SLOW);
    };
    requestAnimationFrame(() => {
      if (!rec) return;
      recR.resize(); start();
      const frame = (now) => { if (!rec) return; recR.draw(vw(), now); rec.raf = requestAnimationFrame(frame); };
      rec.raf = requestAnimationFrame(frame); step();
    });
    confetti();
  }
  function confetti() {
    const cv = $("confetti"), x = cv.getContext("2d"), d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * d; cv.height = innerHeight * d; x.setTransform(d, 0, 0, d, 0, 0);
    const cols = ["#ffd84c", "#55ffad", "#ff5f8f", "#5fd3ff", "#c58bff", "#ffffff"];
    const parts = Array.from({ length: 140 }, (_, i) => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 60, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 10, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], w: 5 + Math.random() * 6 }));
    const t0 = performance.now();
    const frame = (now) => {
      if (!rec) return x.clearRect(0, 0, cv.width, cv.height);
      x.clearRect(0, 0, innerWidth, innerHeight);
      for (const q of parts) { q.vy += 0.28; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.r += q.vr; x.save(); x.translate(q.x, q.y); x.rotate(q.r); x.fillStyle = q.c; x.fillRect(-q.w / 2, -q.w / 4, q.w, q.w / 2); x.restore(); }
      if (now - t0 < 4000) rec.confRaf = requestAnimationFrame(frame); else x.clearRect(0, 0, innerWidth, innerHeight);
    };
    rec.confRaf = requestAnimationFrame(frame);
  }
  function closeRecord() {
    if (rec) { clearTimeout(rec.timer); cancelAnimationFrame(rec.raf); cancelAnimationFrame(rec.confRaf); rec = null; }
    const cv = $("confetti"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    $("record").classList.remove("show");
  }
  async function sendScore(g, res) {
    const d = await api("/api/score", { method: "POST", body: JSON.stringify({ token: run.token, log: E.encodeLog(g.log), ticks: res.ticks }) });
    if (d?.player) { p = { ...p, ...d.player, ...(d.bot_username ? { bot_username: d.bot_username } : {}) }; ui(); renderArtifacts(); }
    return d;
  }
  function closeGame() {
    closeRecord();
    running = false; paused = false; countdown = 0; clearTimeout(timer); clearInterval(cdTimer); cancelAnimationFrame(raf);
    stopReplay(true);
    $("pauseMenu").classList.remove("show"); el.over.classList.remove("show"); el.game.classList.remove("active");
    show(returnTo); returnTo = "home"; load();
  }
  let returnTo = "home";

  // Поделиться результатом картинкой
  async function shareResult() {
    if (!lastResult || lastResult.score <= 0) return;
    const b = $("shareResBtn"); b.disabled = true; const old = b.textContent; b.textContent = "Готовим карточку…";
    try {
      const m = E.MODES[lastResult.cfg.mode], df = E.DIFFS[lastResult.cfg.diff];
      const blob = await SA.cardBlob({ score: lastResult.score, apples: lastResult.apples, name: p.first_name, skin: p.skin, palette: skinPalette(p.skin), field: fieldId(),
        modeName: `${m.emoji} ${t(m.name)}`, diffName: t(df.name), isRecord: lastResult.isRecord, daily: lastResult.kind === "daily" });
      const r = await fetch(`/api/share?score=${lastResult.score}&mode=${encodeURIComponent(lastResult.cfg.mode)}`, { method: "POST", headers: { ...headers(), "Content-Type": "image/png" }, body: blob });
      const j = await r.json().catch(() => null);
      if (!j?.url) throw new Error(j?.error || "upload");
      if (tg?.openTelegramLink) tg.openTelegramLink(j.share_url);
      else if (navigator.share) await navigator.share({ title: "Snake Arena", text: j.text, url: j.url }).catch(() => {});
      else copyText(j.url);
    } catch (e) { toast(String(e.message).includes("Too many") ? "Слишком много карточек, попробуй позже" : "Не удалось создать карточку"); }
    b.disabled = false; b.textContent = old;
  }

  // ---------- реплей лидера сезона ----------
  async function startReplay(url = "/api/replay/season") {
    const d = await api(url);
    if (!d?.log && d?.log !== "") return toast(d?.error === "No replay yet" ? "Реплея пока нет" : "Не удалось загрузить реплей");
    const log = E.parseLog(d.log);
    if (!log) return toast("Реплей повреждён");
    stopReplay(true);
    const rp = E.player(d.cfg, log, d.ticks);
    replay = { rp, name: d.name, score: d.score, skin: d.skin, palette: d.palette, speed: 1 };
    game = rp.game; run = null; ghost = null; returnTo = url.includes("season") ? "season" : "home";
    el.over.classList.remove("show"); el.game.classList.add("active", "replay"); $("startSplash").style.display = "none";
    const m = E.MODES[game.cfg.mode], df = E.DIFFS[game.cfg.diff];
    $("gameTitle").textContent = t("▶ Реплей"); $("gameSub").textContent = `${d.name} · ${d.score} ${t("очк.")} · ${t(m.name)} · ${t(df.name)}`;
    $("replaySpeed").textContent = "×1";
    beginLoop();
  }
  function finishReplay() {
    toast(`Реплей окончен · ${replay.name}: ${game.score} очков`, 2600);
    setTimeout(() => { if (replay && !running) closeGame(); }, 1800);
  }
  function stopReplay(silent) {
    if (!replay) return;
    replay = null; el.game.classList.remove("replay");
    if (!silent) closeGame();
  }

  // ---------- экран старта ----------
  function renderSplash() {
    $("modeGrid").innerHTML = Object.entries(E.MODES).filter(([, m]) => !m.hidden).map(([id, m]) => `<button data-mode="${id}" class="${id === sel.mode ? "on" : ""}">${m.emoji} ${m.name}</button>`).join("");
    $("diffTabs").innerHTML = Object.entries(E.DIFFS).map(([id, d]) => `<button data-diff="${id}" class="${id === sel.diff ? "on" : ""}">${d.name}<small>×${d.mult}</small></button>`).join("");
    const m = E.MODES[sel.mode], d = E.DIFFS[sel.diff], mult = Math.round(m.mult * d.mult * 100) / 100;
    const rated = E.isRated({ mode: sel.mode, diff: sel.diff });
    $("modeHint").textContent = `${m.hint} · итоговая награда ×${mult}` + (sel.mode === "classic" && !rated ? " · на лёгкой — вне рейтинга" : "");
    renderArtifacts();
  }
  function openSplash() {
    el.game.classList.add("active"); el.game.classList.remove("replay"); $("startSplash").style.display = "block";
    $("gameTitle").textContent = "🐍 Snake Arena"; $("gameSub").textContent = "";
    renderSplash(); requestAnimationFrame(() => resizeCanvas());
    if (!game) game = new E.Game({ seed: 1, mode: sel.mode }, { record: false });
  }

  // ---------- обработчики ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button,[data-artifact]"); if (!t) return;
    if (t.dataset.screen && t.dataset.screen !== "game") return show(t.dataset.screen);
    if (t.dataset.ach && !t.disabled) return claimAchievement(t);
    if (t.dataset.m && !t.disabled) return claimMission(t.dataset.m);
    if (t.dataset.skin) return buy(t.dataset.skin);
    if (t.dataset.field) return buyField(t.dataset.field);
    if (t.dataset.pskin) return openPreview("skin", t.dataset.pskin);
    if (t.dataset.pfield) return openPreview("field", t.dataset.pfield);
    if (t.dataset.acc) return buyAcc(t.dataset.acc);
    if (t.dataset.pacc) return openPreview("acc", t.dataset.pacc);
    if (t.dataset.up) { e.stopPropagation(); return upgradeArtifact(t.dataset.up); }
    if (t.dataset.artifact) return pickArtifact(t.dataset.artifact);
    if (t.dataset.mode) { sel.mode = t.dataset.mode; LS.set("snakeMode", sel.mode); haptic("light"); return renderSplash(); }
    if (t.dataset.diff) { sel.diff = t.dataset.diff; LS.set("snakeDiff", sel.diff); haptic("light"); return renderSplash(); }
    if (t.dataset.rmode) { ratingMode = t.dataset.rmode; return renderRating(); }
    if (t.dataset.tab && t.parentElement.id === "ratingTabs") { ratingTab = t.dataset.tab; return renderRating(); }
    if (t.dataset.tab && t.parentElement.id === "seasonTabs") { seasonTab = t.dataset.tab; return renderSeason(); }
    if (t.dataset.level) return openLevel(Number(t.dataset.level));
    if (t.dataset.ptier) { t.disabled = true; return claimPass(Number(t.dataset.ptier), t.dataset.ptrack); }
    if (t.dataset.cjoin) return (async () => { const r = await api("/api/clan/join", { method: "POST", body: JSON.stringify({ id: Number(t.dataset.cjoin) }) }); if (r?.ok) { sfx.claim(); toast("🛡️ Ты в клане!"); } else toast(r?.error || "Не удалось вступить"); renderClans(); })();
    if (t.dataset.ckick) return (async () => { if (await confirmBox(SA.i18n.t("Исключить игрока из клана?"), SA.i18n.t("Исключить"))) { await api("/api/clan/kick", { method: "POST", body: JSON.stringify({ telegram_id: t.dataset.ckick }) }); renderClans(); } })();
    if (t.dataset.cemoji) { t.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === t)); return; }
  });
  $("playBtn").addEventListener("click", openSplash);
  $("startNow").addEventListener("click", () => startRun({ kind: "free" }));
  $("splashClose").addEventListener("click", closeGame);
  $("dailyPlay").addEventListener("click", () => { returnTo = "daily"; startRun({ kind: "daily" }); });
  $("againBtn").addEventListener("click", () => startRun(lastKind));
  $("nextLevelBtn").addEventListener("click", () => { const n = Number(run?.ref || lastKind.ref) + 1; lastKind = { kind: "level", ref: n }; startRun(lastKind); });
  $("levelsMapBtn").addEventListener("click", () => { returnTo = "levels"; closeGame(); });
  $("liClose").addEventListener("click", () => $("levelInfo").classList.remove("show"));
  $("menuBtn").addEventListener("click", closeGame);
  $("shareResBtn").addEventListener("click", shareResult);
  $("duelBtn").addEventListener("click", () => lastResult?.game_id && createChallenge(lastResult.game_id));
  $("pauseBtn").addEventListener("click", pause);
  $("resumeBtn").addEventListener("click", () => { if (paused) pause(); });
  $("quitBtn").addEventListener("click", quitRun);
  $("pauseSettings").addEventListener("click", openSettings);
  $("replayBtn").addEventListener("click", () => startReplay());
  $("replayShareBtn").addEventListener("click", shareReplay);
  $("replayExit").addEventListener("click", () => { running = false; clearTimeout(timer); cancelAnimationFrame(raf); stopReplay(false); });
  $("replaySpeed").addEventListener("click", () => {
    if (!replay) return; replay.speed = replay.speed >= 4 ? 1 : replay.speed * 2;
    $("replaySpeed").textContent = "×" + replay.speed; lastTick = performance.now(); schedule();
  });
  $("shareBtn").addEventListener("click", () => shareLink(refLink(), "🐍 Играй со мной в Snake Arena! Заходи по ссылке — получишь бонусные монеты 🪙"));
  $("challengeBtn").addEventListener("click", () => createChallenge());
  $("copyBtn").addEventListener("click", () => copyText(refLink()));
  $("dailyBox").addEventListener("click", (e) => { if (e.target.closest("#dailyBtn")) claimDaily(); });
  $("adminBtn").addEventListener("click", () => { location.href = "/admin"; });
  $("settingsBtn").addEventListener("click", openSettings);
  $("sndBtn").addEventListener("click", () => { const s = SA.settings.get(); SA.settings.set({ sound: !s.sound, volume: s.volume || 70 }); renderSettings(); if (!s.sound) { SA.audio.unlock(); sfx.coin(); } });
  $("setSound").addEventListener("change", (e) => { SA.settings.set({ sound: e.target.checked }); renderSettings(); if (e.target.checked) { SA.audio.unlock(); sfx.coin(); } });
  $("setVolume").addEventListener("input", (e) => { SA.settings.set({ volume: Number(e.target.value) }); $("setVolVal").textContent = e.target.value + "%"; $("sndBtn").textContent = Number(e.target.value) > 0 ? "🔊" : "🔇"; });
  $("setVolume").addEventListener("change", () => { SA.audio.unlock(); sfx.coin(); });
  $("setVibro").addEventListener("change", (e) => { SA.settings.set({ vibro: e.target.checked }); if (e.target.checked) haptic("medium"); });
  $("settingsClose").addEventListener("click", () => $("settings").classList.remove("show"));
  $("setNotify").addEventListener("change", async (e) => { const r = await api("/api/settings", { method: "POST", body: JSON.stringify({ notify: e.target.checked }) }); if (r?.player) p = { ...p, ...r.player }; });
  // смена языка: сохраняем на сервере (для сообщений бота) и перезагружаем страницу
  // тема: как в Telegram / тёмная / светлая (игровое поле всегда тёмное)
  function applyTheme() {
    const mode = LS.get("snakeTheme", "auto");
    const light = mode === "light" || (mode === "auto" && tg?.colorScheme === "light");
    document.body.classList.toggle("light", light);
    try { tg?.setHeaderColor?.(light ? "#eef5f0" : "#030907"); tg?.setBackgroundColor?.(light ? "#eef5f0" : "#030907"); } catch (e) {}
  }
  applyTheme(); tg?.onEvent?.("themeChanged", applyTheme);
  $("setTheme").addEventListener("change", (e) => { LS.set("snakeTheme", e.target.value); applyTheme(); });
  $("recOk").addEventListener("click", closeRecord);
  $("setLang").addEventListener("change", async (e) => { await api("/api/settings", { method: "POST", body: JSON.stringify({ lang: e.target.value }) }); SA.i18n.set(e.target.value, true); });
  $("pvClose").addEventListener("click", closePreview);
  $("newsOk").addEventListener("click", () => $("news").classList.remove("show"));
  $("preview").addEventListener("click", (e) => { if (e.target.id === "preview") closePreview(); });
  $("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").classList.remove("show"); });
  renderSettings();

  document.addEventListener("visibilitychange", () => { if (document.hidden && running && !paused && !countdown) pause(); });
  window.addEventListener("resize", () => { if (el.game.classList.contains("active")) resizeCanvas(); });
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
    if (map[k] && el.game.classList.contains("active")) { e.preventDefault(); setdir(...map[k]); return; }
    if (k === " " || k === "enter") {
      if ($("confirm").classList.contains("show")) return;
      if (el.over.classList.contains("show")) { e.preventDefault(); startRun(lastKind); return; }
      if (running) { e.preventDefault(); pause(); }
    }
    if (k === "escape" && running && !paused) pause();
  }, { passive: false });

  // Свайп в любом месте экрана игры: поворот срабатывает сразу во время движения пальца;
  // после поворота точка отсчёта сдвигается — можно делать серию поворотов, не отрывая палец
  const SWIPE_MIN = 16;
  let tracking = false, tx = 0, ty = 0;
  el.game.addEventListener("touchstart", (e) => {
    if (e.target.closest("button") || e.target.closest("#startSplash")) return;
    const t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; tracking = true;
  }, { passive: true });
  el.game.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    e.preventDefault();
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) setdir(dx > 0 ? 1 : -1, 0); else setdir(0, dy > 0 ? 1 : -1);
    tx = t.clientX; ty = t.clientY;
  }, { passive: false });
  el.game.addEventListener("touchend", () => { tracking = false; }, { passive: true });
  el.game.addEventListener("touchcancel", () => { tracking = false; }, { passive: true });
  document.querySelectorAll("#dpad button").forEach((b) => {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); const [x, y] = b.dataset.d.split(",").map(Number); setdir(x, y); });
  });
  function setPad(on) {
    el.game.classList.toggle("dpad-on", on);
    $("padBtn").textContent = on ? "🎮 Скрыть" : "🎮 Кнопки";
    LS.set("snakePad", on ? "1" : "0");
    requestAnimationFrame(() => resizeCanvas());
  }
  $("padBtn").addEventListener("click", () => setPad(!el.game.classList.contains("dpad-on")));
  if (LS.get("snakePad", "0") === "1") { el.game.classList.add("dpad-on"); $("padBtn").textContent = "🎮 Скрыть"; }
  try { tg?.disableVerticalSwipes?.(); } catch (e) {}

  renderer.setField(fieldId());
  load();
})();
