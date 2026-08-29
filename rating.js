(function () {
  "use strict";

  var IMAGE_HOSTS = ["lain.bgm.tv", "bgmimg.anibt.net", "lain.bangumi.lol"];
  var SOURCE = Array.isArray(window.RATING_ANIME_DATA) ? window.RATING_ANIME_DATA : [];
  var data = [];
  var byId = Object.create(null);
  SOURCE.forEach(function (item) {
    var id = Number(item && item.id);
    var score = Number(item && item.score);
    if (!id || !Number.isFinite(score) || score <= 0 || byId[id]) return;
    var copy = Object.assign({}, item, { id: id, score: Math.round(score * 10) / 10 });
    byId[id] = copy;
    data.push(copy);
  });

  var state = {
    mode: "classic",
    phase: "idle",
    pool: [],
    ranked: [],
    slots: { a: null, b: null },
    seen: new Set(),
    pendingNext: null,
    lives: 5,
    total: 0,
    correct: 0,
    streak: 0,
    maxStreak: 0,
    timerId: null,
    timerEndsAt: 0,
    timerRemaining: 90000,
    countdownId: null,
    advanceId: null,
    firstRound: true,
    poolExhausted: false,
    diffBuckets: [0, 0, 0, 0],
    closeGapWrongs: 0
  };

  function el(id) { return document.getElementById(id); }
  function imageUrlAt(url, index) {
    if (!url) return "";
    var match = String(url).match(/^https?:\/\/[^/]+(\/.*)$/);
    return match ? "https://" + IMAGE_HOSTS[index] + match[1] : String(url);
  }
  function titleOf(item) { return item.name_cn || item.name || "未知动画"; }
  function formatDate(value) {
    var text = String(value || "");
    if (!text) return "";
    var parts = text.split("-");
    if (!parts[0]) return "";
    return parts.length > 1 && Number(parts[1]) ? parts[0] + "年" + Number(parts[1]) + "月" : parts[0] + "年";
  }
  function randomNormal() {
    var u = 1 - Math.random();
    var v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function speedFactor() {
    if (state.mode !== "timed") return 0.9;
    if (state.streak >= 8) return 0.4;
    if (state.streak >= 5) return 0.55;
    if (state.streak >= 2) return 0.75;
    return 0.9;
  }
  function readFilters() {
    return {
      votes: Math.max(0, Number(el("rating-votes-label").value) || 0),
      yearMin: Number(el("rating-year-min").value),
      yearMax: Number(el("rating-year-max").value),
      rankMin: Number(el("rating-rank-min").value),
      rankMax: Number(el("rating-rank-max").value),
      excludeCn: el("rating-exclude-cn").checked,
      excludeMovie: el("rating-exclude-movie").checked,
      excludeOva: el("rating-exclude-ova").checked,
      excludeShort: el("rating-exclude-short").checked
    };
  }
  function updateFilterLabels() {
    var min = Number(el("rating-year-min").value);
    var max = Number(el("rating-year-max").value);
    var rankMin = Number(el("rating-rank-min").value);
    var rankMax = Number(el("rating-rank-max").value);
    el("rating-votes-label").value = el("rating-votes").value;
    el("rating-year-min-label").textContent = min <= 1996 ? "不限" : String(min);
    el("rating-year-max-label").textContent = String(max);
    el("rating-rank-min-label").textContent = String(rankMin);
    el("rating-rank-max-label").textContent = String(rankMax);
    el("rating-preset-label").textContent = min === 2016 && max === 2026 ? "近10年" : "自定义";
  }
  function filteredPool() {
    var filter = readFilters();
    var base = data.filter(function (item) {
      var tags = Array.isArray(item.tags) ? item.tags : [];
      if (item.vote_count < filter.votes) return false;
      if (item.air_date) {
        var date = String(item.air_date);
        if (filter.yearMin > 1996 && date < filter.yearMin + "-01") return false;
        if (date > filter.yearMax + "-12") return false;
      }
      if (filter.excludeCn && tags.indexOf("国产") >= 0) return false;
      if (filter.excludeMovie && tags.indexOf("剧场版") >= 0) return false;
      if (filter.excludeOva && tags.indexOf("OVA") >= 0) return false;
      if (filter.excludeShort && tags.indexOf("短片") >= 0) return false;
      return true;
    });
    if (filter.rankMin === 0 && filter.rankMax === 100) return base;
    var sorted = base.slice().sort(function (a, b) { return b.score - a.score; });
    var from = Math.floor(sorted.length * filter.rankMin / 100);
    var to = Math.ceil(sorted.length * filter.rankMax / 100);
    var allowed = new Set(sorted.slice(from, to).map(function (item) { return item.id; }));
    return base.filter(function (item) { return allowed.has(item.id); });
  }
  function buildPool() {
    state.pool = filteredPool();
    state.ranked = state.pool.slice().sort(function (a, b) { return b.score - a.score; });
    el("rating-pool-size").textContent = state.pool.length + " 部";
  }
  function sampleNearRank(base, excludeId, jump) {
    var candidates = state.ranked.filter(function (item) { return item.id !== excludeId && !state.seen.has(item.id); });
    if (!candidates.length) return null;
    if (jump) {
      var totalWeight = candidates.reduce(function (sum, item) { return sum + (item.score >= 7.5 ? 3 : 1); }, 0);
      var pick = Math.random() * totalWeight;
      for (var i = 0; i < candidates.length; i += 1) {
        pick -= candidates[i].score >= 7.5 ? 3 : 1;
        if (pick <= 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    }
    var position = state.ranked.findIndex(function (item) { return item.id === base.id; });
    if (position < 0) position = Math.floor(state.ranked.length / 2);
    var target = Math.max(0, Math.min(state.ranked.length - 1, Math.round(position + randomNormal() * state.ranked.length * 0.3)));
    for (var offset = 0; offset < state.ranked.length; offset += 1) {
      var indexes = [target - offset, target + offset];
      for (var j = 0; j < indexes.length; j += 1) {
        var item = state.ranked[indexes[j]];
        if (item && item.id !== excludeId && !state.seen.has(item.id)) return item;
      }
    }
    return candidates[0];
  }
  function sampleNext(base) {
    var jump = Math.random() < (state.mode === "timed" ? 0.33 : 0.3);
    var item = sampleNearRank(base, base.id, jump);
    if (!item) return null;
    var diff = Math.round(Math.abs(item.score - base.score) * 10);
    var reroll = diff === 1 ? (state.mode === "timed" ? 1 : 0.9) : diff === 2 ? (state.mode === "timed" ? 0.6 : 0.5) : 0;
    if (reroll && Math.random() < reroll) item = sampleNearRank(base, base.id, jump) || item;
    for (var tries = 0; tries < 10 && Math.round(Math.abs(item.score - base.score) * 10) === 0; tries += 1) {
      item = sampleNearRank(base, base.id, jump) || item;
    }
    return item;
  }
  function setPrompt(text, className) {
    var prompt = el("rating-prompt");
    prompt.textContent = text;
    prompt.className = "rating-prompt" + (className ? " " + className : "");
  }
  function updateStats() {
    var timed = state.mode === "timed";
    el("rating-streak").textContent = state.streak;
    el("rating-total").textContent = timed ? state.correct : state.total;
    el("rating-total-label").textContent = timed ? "答对" : "已答";
    if (timed) {
      var seconds = Math.ceil(Math.max(0, state.timerRemaining) / 1000);
      el("rating-lives").textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      el("rating-lives-label").textContent = "时间";
    } else {
      el("rating-lives").textContent = "♥".repeat(state.lives) + "♡".repeat(5 - state.lives);
      el("rating-lives-label").textContent = "机会";
    }
  }
  function clearCardState(side) {
    var card = el("rating-card-" + side);
    card.classList.remove("locked", "state-correct", "state-wrong", "state-winner", "flash");
    card.setAttribute("aria-disabled", "false");
    el("rating-badge-" + side).textContent = "";
    el("rating-badge-" + side).classList.remove("show");
  }
  function renderCard(side, item) {
    var image = el("rating-img-" + side);
    var title = titleOf(item);
    image.classList.remove("loaded");
    loadImageWithFallback(image, IMAGE_HOSTS.map(function (_, index) {
      return imageUrlAt(item.image_url, index);
    }), function () { image.classList.add("loaded"); });
    el("rating-name-" + side).textContent = title;
    el("rating-date-" + side).textContent = formatDate(item.air_date) + (item.vote_count ? " · " + item.vote_count + " 人评分" : "");
    var score = el("rating-score-" + side);
    score.textContent = item.score.toFixed(1);
    score.classList.toggle("show", !state.firstRound && side === "a");
    score.classList.toggle("question", !state.firstRound && side === "b");
    if (state.firstRound) score.classList.remove("question");
    clearCardState(side);
  }
  function renderCards() {
    if (!state.slots.a || !state.slots.b) return;
    renderCard("a", state.slots.a);
    renderCard("b", state.slots.b);
    if (!state.firstRound) el("rating-score-b").textContent = "?";
  }
  function lockCards(locked) {
    ["a", "b"].forEach(function (side) {
      var card = el("rating-card-" + side);
      card.classList.toggle("locked", locked);
      card.setAttribute("aria-disabled", locked ? "true" : "false");
    });
  }
  function revealScores() {
    ["a", "b"].forEach(function (side) {
      var score = el("rating-score-" + side);
      score.textContent = state.slots[side].score.toFixed(1);
      score.classList.add("show");
      score.classList.remove("question");
    });
  }
  function stopTimers() {
    if (state.timerId !== null) clearInterval(state.timerId);
    if (state.countdownId !== null) clearTimeout(state.countdownId);
    if (state.advanceId !== null) clearTimeout(state.advanceId);
    state.timerId = null;
    state.countdownId = null;
    state.advanceId = null;
  }
  function updateTimer() {
    state.timerRemaining = Math.max(0, state.timerEndsAt - performance.now());
    updateStats();
    if (state.timerRemaining <= 0) gameOver();
  }
  function startTimer() {
    if (state.mode !== "timed") return;
    if (state.timerId !== null) clearInterval(state.timerId);
    state.timerRemaining = 90000;
    state.timerEndsAt = performance.now() + state.timerRemaining;
    state.timerId = setInterval(updateTimer, 200);
    updateStats();
  }
  function runCountdown(done) {
    stopTimers();
    var sequence = ["3", "2", "1", "开始！"];
    var index = 0;
    state.phase = "countdown";
    lockCards(true);
    function step() {
      setPrompt(sequence[index], "countdown");
      index += 1;
      if (index < sequence.length) state.countdownId = setTimeout(step, 700);
      else state.countdownId = setTimeout(done, 700);
    }
    step();
  }
  function advance() {
    if (state.phase === "gameover") return;
    var next = state.pendingNext;
    state.pendingNext = null;
    if (!next) next = sampleNext(state.slots.b);
    if (!next) {
      state.poolExhausted = true;
      gameOver();
      return;
    }
    state.slots.a = state.slots.b;
    state.slots.b = next;
    state.seen.add(next.id);
    state.phase = "playing";
    lockCards(false);
    renderCards();
    setPrompt("哪部动画的评分更高？");
  }
  function selectCard(side) {
    if (state.phase !== "playing" || !state.slots[side]) return;
    state.phase = "reveal";
    lockCards(true);
    var a = state.slots.a;
    var b = state.slots.b;
    var tie = a.score === b.score;
    var right = tie || state.slots[side].score > state.slots[side === "a" ? "b" : "a"].score;
    var winner = tie ? side : (a.score > b.score ? "a" : "b");
    state.firstRound = false;
    revealScores();
    el("rating-badge-" + side).textContent = right ? "✅" : "❌";
    el("rating-badge-" + side).classList.add("show");
    if (!tie && side !== winner) {
      el("rating-badge-" + winner).textContent = "👑";
      el("rating-badge-" + winner).classList.add("show");
    }
    el("rating-card-" + side).classList.add(right ? "state-correct" : "state-wrong");
    el("rating-card-" + winner).classList.add("state-winner");
    state.total += 1;
    if (right) {
      state.correct += 1;
      state.streak += 1;
      state.maxStreak = Math.max(state.maxStreak, state.streak);
    } else {
      state.streak = 0;
      if (state.mode === "classic") state.lives -= 1;
    }
    var difference = Math.abs(a.score - b.score);
    if (!tie) {
      var tenths = Math.round(difference * 10);
      var bucket = tenths <= 2 ? 0 : tenths <= 5 ? 1 : tenths <= 10 ? 2 : 3;
      state.diffBuckets[bucket] += 1;
      if (!right && tenths <= 2) state.closeGapWrongs += 1;
    }
    updateStats();
    setPrompt(tie ? "平局！两部都是 " + a.score.toFixed(1) + " 分" : (right ? "✓ 答对了！分差 " : "✗ 答错了，分差 ") + difference.toFixed(1) + " 分" + (!right && state.mode === "classic" ? "（剩余机会 " + state.lives + "）" : ""), right ? "correct" : "wrong");
    if (state.mode === "timed") state.pendingNext = sampleNext(b);
    var factor = speedFactor();
    state.advanceId = setTimeout(function () {
      state.advanceId = null;
      if (state.mode === "classic" && state.lives <= 0) gameOver();
      else if (state.mode === "timed" && state.timerRemaining <= 0) gameOver();
      else advance();
    }, Math.round(1900 * factor));
  }
  function diffRows() {
    var labels = ["≤ 0.2", "0.2 – 0.5", "0.5 – 1.0", "> 1.0"];
    var total = state.diffBuckets.reduce(function (sum, count) { return sum + count; }, 0) || 1;
    return state.diffBuckets.map(function (count, index) {
      return '<div class="rating-diff-row"><span>' + labels[index] + '</span><span class="rating-diff-track"><span class="rating-diff-fill" style="width:' + Math.round(count / total * 100) + '%"></span></span><span class="rating-diff-count">' + count + '</span></div>';
    }).join("");
  }
  function gameOver() {
    if (state.phase === "gameover") return;
    state.phase = "gameover";
    stopTimers();
    var timed = state.mode === "timed";
    var accuracy = state.total ? Math.round(state.correct / state.total * 100) : 0;
    var master = timed ? state.correct >= 30 : state.total >= 50;
    var god = timed ? state.correct >= 40 : state.total >= 100;
    var totalKey = timed ? "rating_best_timed_correct" : "rating_best_total";
    var streakKey = timed ? "rating_best_timed_streak" : "rating_best_streak";
    var oldTotal = Number(localStorage.getItem(totalKey) || 0);
    var oldStreak = Number(localStorage.getItem(streakKey) || 0);
    var newTotal = (timed ? state.correct : state.total) > oldTotal;
    var newStreak = state.maxStreak > oldStreak;
    if (newTotal) localStorage.setItem(totalKey, String(timed ? state.correct : state.total));
    if (newStreak) localStorage.setItem(streakKey, String(state.maxStreak));
    el("rating-gameover-icon").textContent = god ? "⚡" : master ? "🏆" : timed ? "⏱" : "🎬";
    var heading = god ? "你是古希腊掌管 Bangumi 的神！" : master ? "你是 Bangumi 大师！" : timed ? "时间到！" : "游戏结束";
    el("rating-gameover-title").textContent = heading;
    el("rating-gameover-title").classList.toggle("master", master || god);
    el("rating-gameover-stats").innerHTML = (state.poolExhausted ? "<span>已用完所有符合条件的动画</span><br>" : "") + "本局已结束" + (newTotal ? '<span class="rating-record">新纪录！</span>' : "") + "<br>最高连击 <strong>" + state.maxStreak + "</strong> 连" + (newStreak ? '<span class="rating-record">新纪录！</span>' : "") + "<br>正确率 <strong>" + accuracy + "%</strong>";
    var tip = !timed && state.closeGapWrongs >= 3 ? "分差太小，不算你的错" : "";
    el("rating-tip").textContent = tip;
    el("rating-tip").classList.toggle("show", !!tip);
    el("rating-diff").classList.toggle("show", state.total > 0);
    el("rating-diff-rows").innerHTML = diffRows();
    el("rating-gameover-modal").classList.add("show");
  }
  function restart() {
    stopTimers();
    el("rating-gameover-modal").classList.remove("show");
    state.phase = "idle";
    state.lives = 5;
    state.total = 0;
    state.correct = 0;
    state.streak = 0;
    state.maxStreak = 0;
    state.timerRemaining = 90000;
    state.firstRound = true;
    state.pendingNext = null;
    state.poolExhausted = false;
    state.diffBuckets = [0, 0, 0, 0];
    state.closeGapWrongs = 0;
    state.seen = new Set();
    buildPool();
    updateFilterLabels();
    updateStats();
    if (state.pool.length < 2) {
      state.phase = "empty";
      state.slots = { a: null, b: null };
      el("rating-pool-size").textContent = state.pool.length + " 部";
      setPrompt("当前筛选下的动画不足两部，请放宽过滤设置", "wrong");
      lockCards(true);
      return;
    }
    state.slots.a = state.pool[Math.floor(Math.random() * state.pool.length)];
    state.seen.add(state.slots.a.id);
    state.slots.b = sampleNext(state.slots.a);
    if (!state.slots.b) { state.phase = "empty"; setPrompt("符合条件的动画太少，请放宽过滤设置", "wrong"); return; }
    state.seen.add(state.slots.b.id);
    renderCards();
    if (state.mode === "timed") {
      runCountdown(function () {
        state.countdownId = null;
        state.phase = "playing";
        lockCards(false);
        setPrompt("哪部动画的评分更高？");
        startTimer();
      });
    } else {
      state.phase = "playing";
      lockCards(false);
      setPrompt("哪部动画的评分更高？");
    }
  }
  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    el("rating-mode").setAttribute("aria-pressed", mode === "timed" ? "true" : "false");
    el("rating-mode").textContent = mode === "timed" ? "⏱ 限时模式 · 开" : "⏱ 限时模式";
    restart();
  }
  function downloadResult() {
    var canvas = document.createElement("canvas");
    canvas.width = 720; canvas.height = 1000;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e07282"; ctx.fillRect(0, 0, canvas.width, 8);
    ctx.fillStyle = "#1c1c2e"; ctx.textAlign = "center"; ctx.font = "bold 34px sans-serif";
    ctx.fillText(el("rating-gameover-title").textContent, 360, 190);
    ctx.font = "24px sans-serif"; ctx.fillStyle = "#8e8ea0";
    ctx.fillText("本局已结束", 360, 280);
    ctx.fillText("最高连击 " + state.maxStreak + " · 正确率 " + (state.total ? Math.round(state.correct / state.total * 100) : 0) + "%", 360, 330);
    ctx.font = "18px sans-serif"; ctx.fillText("AnimeQuiz · 评分对决", 360, 930);
    var link = document.createElement("a");
    link.download = "anime-rating-result.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
  function wire() {
    ["a", "b"].forEach(function (side) {
      el("rating-card-" + side).addEventListener("click", function () { selectCard(side); });
      el("rating-card-" + side).addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCard(side); } });
    });
    el("rating-help").addEventListener("click", function () { el("rating-help-modal").classList.add("show"); });
    el("rating-help-close").addEventListener("click", function () { el("rating-help-modal").classList.remove("show"); });
    el("rating-mode").addEventListener("click", function () {
      if (state.mode === "timed") setMode("classic");
      else el("rating-mode-modal").classList.add("show");
    });
    el("rating-mode-confirm").addEventListener("click", function () { el("rating-mode-modal").classList.remove("show"); setMode("timed"); });
    el("rating-mode-cancel").addEventListener("click", function () { el("rating-mode-modal").classList.remove("show"); });
    el("rating-restart").addEventListener("click", restart);
    el("rating-gameover-restart").addEventListener("click", restart);
    el("rating-save").addEventListener("click", downloadResult);
    el("rating-mute").addEventListener("click", function () { var muted = localStorage.getItem("rating_muted") === "1"; localStorage.setItem("rating_muted", muted ? "0" : "1"); el("rating-mute").textContent = muted ? "🔊" : "🔇"; });
    el("rating-votes").addEventListener("input", updateFilterLabels);
    el("rating-votes-label").addEventListener("input", function () { var value = Number(this.value); if (Number.isFinite(value)) el("rating-votes").value = Math.max(100, Math.min(1000, value)); });
    ["rating-year-min", "rating-year-max", "rating-rank-min", "rating-rank-max"].forEach(function (id) {
      el(id).addEventListener("input", function () {
        if (id === "rating-year-min" && Number(this.value) > Number(el("rating-year-max").value)) el("rating-year-max").value = this.value;
        if (id === "rating-year-max" && Number(this.value) < Number(el("rating-year-min").value)) el("rating-year-min").value = this.value;
        if (id === "rating-rank-min" && Number(this.value) > Number(el("rating-rank-max").value) - 5) el("rating-rank-max").value = Math.min(100, Number(this.value) + 5);
        if (id === "rating-rank-max" && Number(this.value) < Number(el("rating-rank-min").value) + 5) el("rating-rank-min").value = Math.max(0, Number(this.value) - 5);
        updateFilterLabels();
      });
    });
    el("rating-settings").addEventListener("change", function () { updateFilterLabels(); });
    el("rating-settings").querySelectorAll("input[type=checkbox]").forEach(function (input) { input.addEventListener("change", updateFilterLabels); });
    if (localStorage.getItem("rating_muted") === "1") el("rating-mute").textContent = "🔇";
    updateFilterLabels();
    restart();
  }
  window.ratingStopTimers = function () {
    stopTimers();
    if (state.phase !== "gameover") state.phase = "idle";
  };
  window.ratingEnsureStarted = function () {
    if (state.phase === "idle" || state.phase === "empty") restart();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}());
