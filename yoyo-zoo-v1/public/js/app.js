/* ============================================================
   尤尤的動物樂園 · app.js（v1）
   引擎移植自「太空中文基地」v6.5，遊戲層全新：
   動物園沙盒建設＋探索遭遇＋圖鑑＋求助事件
   ============================================================ */
(function () {
"use strict";

var DATA = window.APP_DATA;
var SC = DATA.scoring;

/* ---------------- 小工具 ---------------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function toast(msg, ms) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(function () { t.classList.remove("show"); }, ms || 2200);
}
function animalById(id) {
  return DATA.animals.filter(function (a) { return a.id === id; })[0];
}
function zoneById(id) {
  return DATA.zones.filter(function (z) { return z.id === id; })[0];
}
function itemById(id) {
  return DATA.buildItems.filter(function (b) { return b.id === id; })[0];
}

/* ---------------- 狀態 ---------------- */
var famCode = localStorage.getItem("famCode") || "";
var myRole = localStorage.getItem("famRole") || "main";
function localKey() { return myRole === "preview" ? "localSave_preview" : "localSave"; }
function isPreview() { return myRole === "preview"; }
var state = null;
var parentAuthed = false;
var imgCache = {};
var offline = false;

function freshState() {
  return {
    version: 1,
    points: 0,
    earnedTotal: 0,
    chapters: {},
    rewards: { claimed: [], custom: null },
    photos: {},
    parentPin: "6688",
    unlockAll: false,
    charSet: [],
    friendship: {},   // animalId -> 0..5
    quizDone: {},     // animalId -> true（答對過圖鑑問答）
    eventDone: {},    // animalId -> true（完成求助事件）
    encCount: 0,      // 探索次數
    zoo: { tiles: {} }, // "x,y" -> itemId
    residents: [],    // 已入住動物 id
    practice: { day: "", earned: 0 },
    savedAt: 0
  };
}
function chState(id) {
  if (!state.chapters[id]) {
    state.chapters[id] = {
      read: false,
      quiz: { answered: [], correct: 0, done: false },
      matching: false,
      traced: [],
      dictated: [],
      sentAnswered: [],
      freeWriting: [],
      freeDone: false,
      completed: false
    };
  }
  return state.chapters[id];
}
function migrate(s) {
  if (s.earnedTotal === undefined) s.earnedTotal = s.points || 0;
  var f = freshState();
  for (var k in f) if (s[k] === undefined) s[k] = f[k];
  if (!s.zoo || !s.zoo.tiles) s.zoo = { tiles: {} };
  return s;
}
function friendCount() {
  var n = 0;
  for (var k in state.friendship) if (state.friendship[k] > 0) n++;
  return n;
}
function rewardsList() {
  return (state.rewards.custom && state.rewards.custom.length) ? state.rewards.custom : DATA.defaultRewards;
}

/* ---------------- 雲端 API ---------------- */
function api(path, method, body) {
  return fetch(path, {
    method: method || "GET",
    headers: { "Content-Type": "application/json", "x-family-code": famCode },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    return res.json().catch(function () { return { ok: false, error: "BAD_RESPONSE" }; })
      .then(function (data) {
        if (!res.ok) { data._status = res.status; throw data; }
        return data;
      });
  });
}
function setSync(mode) {
  var d = $("syncDot");
  if (!d) return;
  d.className = mode === "ok" ? "" : mode;
  d.id = "syncDot";
}
var saveTimer = null;
function markDirty() {
  updateChips();
  localStorage.setItem(localKey(), JSON.stringify(state));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doCloudSave, 1500);
}
function doCloudSave() {
  if (!famCode) return;
  setSync("busy");
  api("/api/save", "POST", state).then(function (r) {
    state.savedAt = r.savedAt;
    offline = false;
    setSync("ok");
  }).catch(function () {
    offline = true;
    setSync("err");
  });
}

/* ---------------- 積分 ---------------- */
function earn(n) {
  state.points += n;
  state.earnedTotal = (state.earnedTotal || 0) + n;
}
function addPoints(n) {
  if (!n) return;
  earn(n);
  toast("⭐ +" + n + " 分");
  checkRewardReach();
}
function spendPoints(n) {
  state.points = Math.max(0, state.points - n);
}
function checkRewardReach() {
  var list = rewardsList();
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (state.points >= r.points && state.rewards.claimed.indexOf(r.id) < 0 && !r._notified) {
      r._notified = true;
      setTimeout(function () { toast("🎉 達到獎勵里程碑！去「獎勵」看看"); }, 900);
      break;
    }
  }
}
function updateChips() {
  $("chipPoints").textContent = state.points;
  $("chipChars").textContent = state.charSet.length;
  $("chipFriends").textContent = friendCount();
}

/* ---------------- 粵語朗讀 ---------------- */
var speech = { voice: null, ready: false, playing: false, stopFlag: false };
function initVoices() {
  function pickV() {
    var vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (!vs.length) return;
    var v = null, i;
    for (i = 0; i < vs.length; i++) if (/zh[-_]HK/i.test(vs[i].lang)) { v = vs[i]; break; }
    if (!v) for (i = 0; i < vs.length; i++) if (/Sin-?ji/i.test(vs[i].name)) { v = vs[i]; break; }
    if (!v) for (i = 0; i < vs.length; i++) if (/zh[-_]TW/i.test(vs[i].lang)) { v = vs[i]; break; }
    if (!v) for (i = 0; i < vs.length; i++) if (/^zh/i.test(vs[i].lang)) { v = vs[i]; break; }
    speech.voice = v;
    speech.ready = true;
  }
  if (!window.speechSynthesis) return;
  pickV();
  speechSynthesis.onvoiceschanged = pickV;
}
function speak(text, onend) {
  if (!window.speechSynthesis) { if (onend) onend(); return; }
  var u = new SpeechSynthesisUtterance(String(text).replace(/[「」『』（）()]/g, ""));
  if (speech.voice) u.voice = speech.voice;
  u.lang = speech.voice ? speech.voice.lang : "zh-HK";
  u.rate = 0.85;
  u.onend = function () { if (onend) onend(); };
  u.onerror = function () { if (onend) onend(); };
  speechSynthesis.speak(u);
}
function stopSpeech() {
  speech.stopFlag = true;
  speech.playing = false;
  if (window.speechSynthesis) speechSynthesis.cancel();
  var playing = document.querySelectorAll(".sen.playing");
  for (var i = 0; i < playing.length; i++) playing[i].classList.remove("playing");
  var b = $("playAllBtn");
  if (b) b.textContent = "▶️ 全文朗讀";
}
function voiceLabel() {
  if (!window.speechSynthesis) return "此裝置不支援朗讀";
  if (!speech.voice) return "";
  if (/zh[-_]HK/i.test(speech.voice.lang) || /Sin-?ji/i.test(speech.voice.name)) return "🔊 粵語發音";
  return "🔊 此裝置沒有粵語聲音，暫用其他中文發音";
}

/* ---------------- 導航 ---------------- */
var currentView = "chapters";
function showView(name) {
  stopSpeech();
  stopWander();
  currentView = name;
  var views = document.querySelectorAll(".mainView");
  for (var i = 0; i < views.length; i++) views[i].classList.add("hidden");
  var navBtns = document.querySelectorAll("#nav button");
  for (var j = 0; j < navBtns.length; j++) {
    navBtns[j].classList.toggle("active", navBtns[j].getAttribute("data-view") === name);
  }
  if (name === "chapters") { renderChapters(); $("viewChapters").classList.remove("hidden"); }
  else if (name === "chapterDetail") { $("viewChapterDetail").classList.remove("hidden"); }
  else if (name === "zoo") { renderZoo(); $("viewZoo").classList.remove("hidden"); }
  else if (name === "dex") { renderDex(); $("viewDex").classList.remove("hidden"); }
  else if (name === "rewards") { renderRewards(); $("viewRewards").classList.remove("hidden"); }
  else if (name === "parent") { renderParent(); $("viewParent").classList.remove("hidden"); }
  window.scrollTo(0, 0);
}
document.querySelectorAll("#nav button").forEach(function (b) {
  b.addEventListener("click", function () { showView(b.getAttribute("data-view")); });
});

/* ---------------- 登入 ---------------- */
function enterApp() {
  if (isPreview()) {
    var lg = document.querySelector("#topbar .logo");
    if (lg) lg.innerHTML = '🔭 預覽模式 <span class="tag" style="vertical-align:middle">全功能開放</span>';
    document.title = "預覽模式 · 尤尤的動物樂園";
  }
  try {
    var mchars = [];
    DATA.chapters.forEach(function (c) { c.words.forEach(function (w) { w.w.split("").forEach(function (ch) {
      if (!(window.STROKES && window.STROKES[ch]) && mchars.indexOf(ch) < 0) mchars.push(ch);
    }); }); });
    if (mchars.length) setTimeout(function () {
      toast("⚠️ 有 " + mchars.length + " 個字缺筆順數據，請更新 strokes.js（見自我檢查頁）");
    }, 1500);
  } catch (e) {}
  $("loginView").classList.add("hidden");
  $("topbar").classList.remove("hidden");
  $("nav").classList.remove("hidden");
  updateChips();
  showView("chapters");
}
function tryLogin(code) {
  $("loginMsg").textContent = "";
  famCode = code;
  return fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code })
  }).then(function (res) { return res.json().then(function (d) { d._status = res.status; return d; }); });
}
$("loginBtn").addEventListener("click", function () {
  var code = $("codeInput").value.trim();
  if (!code) { $("loginMsg").textContent = "請輸入家庭代碼"; return; }
  $("loginBtn").disabled = true;
  tryLogin(code).then(function (d) {
    $("loginBtn").disabled = false;
    if (d.ok) {
      localStorage.setItem("famCode", code);
      famCode = code;
      myRole = d.role || "main";
      localStorage.setItem("famRole", myRole);
      loadStateThenEnter();
    } else if (d.error === "SERVER_NOT_CONFIGURED") {
      $("loginMsg").textContent = d.message || "伺服器尚未設定家庭代碼。";
    } else {
      $("loginMsg").textContent = "代碼不正確，請再試一次。";
    }
  }).catch(function () {
    $("loginBtn").disabled = false;
    $("loginMsg").textContent = "無法連接伺服器，請檢查網絡。";
  });
});
function loadStateThenEnter() {
  setSync("busy");
  api("/api/save").then(function (r) {
    if (r.role) { myRole = r.role; localStorage.setItem("famRole", myRole); }
    var local = null;
    try { local = JSON.parse(localStorage.getItem(localKey()) || "null"); } catch (e) {}
    if (r.save) {
      if (local && local.savedAt && local.savedAt > (r.save.savedAt || 0)) state = migrate(local);
      else state = migrate(r.save);
    } else if (local) {
      state = migrate(local);
    } else {
      state = freshState();
    }
    if (isPreview()) state.unlockAll = true;
    setSync("ok");
    markDirty();
    enterApp();
  }).catch(function (err) {
    if (err && err._status === 401) {
      localStorage.removeItem("famCode");
      localStorage.removeItem("famRole");
      famCode = "";
      $("loginMsg").textContent = "代碼已失效，請重新輸入。";
      return;
    }
    var local = null;
    try { local = JSON.parse(localStorage.getItem(localKey()) || "null"); } catch (e) {}
    state = local ? migrate(local) : freshState();
    if (isPreview()) state.unlockAll = true;
    offline = true;
    setSync("err");
    enterApp();
    toast("⚠️ 離線模式：進度暫存本機");
  });
}
if (famCode) { loadStateThenEnter(); }

/* ---------------- 章節列表 ---------------- */
var STEPS_CHI = [
  { key: "read", label: "① 課文" },
  { key: "quiz", label: "② 理解" },
  { key: "words", label: "③ 詞語" },
  { key: "write", label: "④ 寫字" },
  { key: "sent", label: "⑤ 句式" }
];
var STEPS_GS = [
  { key: "read", label: "① 閱讀" },
  { key: "quiz", label: "② 問答" }
];
function stepsOf(c) { return c.type === "gs" ? STEPS_GS : STEPS_CHI; }
function allChars(c) {
  var arr = [];
  c.words.forEach(function (w) { w.w.split("").forEach(function (ch) { if (arr.indexOf(ch) < 0) arr.push(ch); }); });
  return arr;
}
function stepDoneKey(c, key) {
  var s = chState(c.id);
  if (key === "read") return s.read;
  if (key === "quiz") return s.quiz.done;
  if (key === "words") return s.matching;
  if (key === "write") return s.dictated.length >= allChars(c).length;
  if (key === "sent") return s.sentAnswered.length >= c.sentence.objective.length && s.freeDone;
  return false;
}
function chapterProgress(c) {
  if (!state.chapters[c.id]) return 0;
  var steps = stepsOf(c), done = 0;
  steps.forEach(function (st) { if (stepDoneKey(c, st.key)) done++; });
  return done / steps.length;
}
function chapterList(type) {
  return DATA.chapters.filter(function (c) { return c.type === type; });
}
function chapterUnlocked(c) {
  if (isPreview() || state.unlockAll) return true;
  var list = chapterList(c.type);
  var idx = list.indexOf(c);
  if (idx <= 0) return true;
  var prev = list[idx - 1];
  return !!(state.chapters[prev.id] && state.chapters[prev.id].completed);
}
function renderChapters() {
  var v = $("viewChapters");
  var html = '<h2>📚 學習章節</h2><p class="dim small" style="margin-bottom:6px">完成章節賺 ⭐，就可以去動物園探索建設！</p>';
  function cardHtml(c) {
    var unlocked = chapterUnlocked(c);
    var s = state.chapters[c.id];
    var prog = Math.round(chapterProgress(c) * 100);
    var done = s && s.completed;
    return '<div class="card chapCard ' + (unlocked ? "" : "locked") + '" data-id="' + c.id + '">' +
      '<div class="emoji">' + (unlocked ? c.emoji : "🔒") + '</div>' +
      '<div class="meta">' +
      '<div><span class="tag">' + c.grade + '</span><span class="tag">' + esc(c.genre) + '</span>' + (done ? ' <span class="doneMark">✓ 完成</span>' : '') + '</div>' +
      '<h3 style="margin-top:4px">' + esc(c.title) + '</h3>' +
      '<div class="small dim">' + esc(c.intro) + '</div>' +
      '<div class="progressBar"><div style="width:' + prog + '%"></div></div>' +
      '</div></div>';
  }
  html += '<div class="groupTitle">🖍️ 中文</div>';
  chapterList("chi").forEach(function (c) { html += cardHtml(c); });
  html += '<div class="groupTitle">🔬 常識</div>';
  chapterList("gs").forEach(function (c) { html += cardHtml(c); });
  v.innerHTML = html;
  v.querySelectorAll(".chapCard").forEach(function (card) {
    card.addEventListener("click", function () {
      var c = DATA.chapters.filter(function (x) { return x.id === card.getAttribute("data-id"); })[0];
      if (!chapterUnlocked(c)) { toast("先完成上一章，就可以解鎖這一章！"); return; }
      openChapter(c.id);
    });
  });
}

/* ---------------- 章節詳情 ---------------- */
var cur = { chapter: null, step: 0, writers: [], wi: 0, ci: 0, writeMode: "trace", modeChosen: false };

function openChapter(id) {
  cur.chapter = DATA.chapters.filter(function (c) { return c.id === id; })[0];
  cur.step = firstIncompleteStep(cur.chapter);
  cur.modeChosen = false;
  showView("chapterDetail");
  renderStep();
}
function firstIncompleteStep(c) {
  var steps = stepsOf(c);
  for (var i = 0; i < steps.length; i++) if (!stepDoneKey(c, steps[i].key)) return i;
  return steps.length - 1;
}
function renderStep() {
  stopSpeech();
  destroyWriters();
  var c = cur.chapter;
  var steps = stepsOf(c);
  var v = $("viewChapterDetail");
  var dots = steps.map(function (st, i) {
    var done = stepDoneKey(c, st.key);
    var cls = "stepDot" + (i === cur.step ? " now" : "") + (done ? " done" : "");
    return '<button class="' + cls + '" data-step="' + i + '">' + st.label + (done ? " ✓" : "") + '</button>';
  }).join("");
  var last = cur.step === steps.length - 1;
  v.innerHTML = '<div class="spread" style="margin-bottom:6px">' +
    '<button class="btn secondary small" id="backChapters">← 章節</button>' +
    '<div class="small dim">' + c.grade + '・' + esc(c.genre) + '</div></div>' +
    '<h2 style="text-align:center">' + c.emoji + ' ' + esc(c.title) + '</h2>' +
    '<div id="stepDots">' + dots + '</div>' +
    '<div id="stepBody"></div>' +
    '<div class="row" style="justify-content:space-between;margin-top:10px">' +
    '<button class="btn secondary" id="prevStep"' + (cur.step === 0 ? " disabled" : "") + '>上一步</button>' +
    '<button class="btn" id="nextStep">' + (last ? "完成本章 🎉" : "下一步 →") + '</button>' +
    '</div>';
  $("backChapters").addEventListener("click", function () { showView("chapters"); });
  $("prevStep").addEventListener("click", function () { if (cur.step > 0) { cur.step--; renderStep(); } });
  $("nextStep").addEventListener("click", nextStepClick);
  v.querySelectorAll(".stepDot").forEach(function (d) {
    d.addEventListener("click", function () {
      var idx = parseInt(d.getAttribute("data-step"), 10);
      var okPrev = idx > 0 ? stepDoneKey(c, steps[idx - 1].key) : true;
      if (isPreview() || idx <= cur.step || stepDoneKey(c, steps[idx].key) || okPrev) { cur.step = idx; renderStep(); }
      else toast("一步一步來，先完成目前步驟吧！");
    });
  });
  var body = $("stepBody");
  var key = steps[cur.step].key;
  if (key === "read") renderReadStep(body);
  else if (key === "quiz") renderQuizStep(body);
  else if (key === "words") renderWordsStep(body);
  else if (key === "write") renderWriteStep(body);
  else renderSentenceStep(body);
}
function nextStepClick() {
  var c = cur.chapter;
  var steps = stepsOf(c);
  var key = steps[cur.step].key;
  if (!stepDoneKey(c, key) && !isPreview()) {
    var tips = { read: "按「我讀完了」才可以繼續。", quiz: "答完所有問題才可以繼續。", words: "完成詞語配對才可以繼續。", write: "完成所有字的默寫才可以繼續。", sent: "完成句式題和自由寫作才可以繼續。" };
    toast(tips[key]);
    return;
  }
  if (cur.step < steps.length - 1) { cur.step++; renderStep(); return; }
  var s = chState(c.id);
  if (!s.completed) {
    s.completed = true;
    earn(c.type === "gs" ? SC.gsBonus : SC.chapterBonus);
    markDirty();
    showDoneOverlay(c);
  } else {
    showView("chapters");
  }
}

/* ----- 第①步：課文朗讀 ----- */
function renderReadStep(body) {
  var c = cur.chapter;
  var s = chState(c.id);
  var flat = [];
  var artHtml = c.article.map(function (para) {
    return "<p>" + para.map(function (sen) {
      var idx = flat.length;
      flat.push(sen);
      return '<span class="sen" data-idx="' + idx + '">' + esc(sen) + "</span>";
    }).join("") + "</p>";
  }).join("");
  body.innerHTML =
    '<div class="card"><div class="row" style="justify-content:space-between">' +
    '<button class="btn amber" id="playAllBtn">▶️ 全文朗讀</button>' +
    '<span class="small dim">' + voiceLabel() + '</span></div>' +
    '<p class="small dim" style="margin-top:6px">💡 點一句，聽一句；跟着一起讀出聲吧！</p></div>' +
    '<div class="card article">' + artHtml + '</div>' +
    (c.type === "gs" ? '' : '<div class="card techBox"><b>✍️ 本章寫作手法：</b>' + c.techniques.map(esc).join("、") + '</div>') +
    '<div class="card funFact">🦊 <b>橙橙小知識：</b>' + esc(c.funFact) + '</div>' +
    '<button class="btn green block" id="readDoneBtn">' + (s.read ? "✓ 已完成閱讀" : "我讀完了！") + '</button>';
  cur.flatSentences = flat;
  $("playAllBtn").addEventListener("click", function () {
    if (speech.playing) { stopSpeech(); return; }
    playSequence(0);
  });
  body.querySelectorAll(".sen").forEach(function (span) {
    span.addEventListener("click", function () {
      stopSpeech();
      span.classList.add("playing");
      speech.playing = false;
      speak(flat[parseInt(span.getAttribute("data-idx"), 10)], function () {
        span.classList.remove("playing");
      });
    });
  });
  $("readDoneBtn").addEventListener("click", function () {
    stopSpeech();
    if (!s.read) {
      s.read = true;
      addPoints(SC.read);
      markDirty();
    }
    cur.step = 1;
    renderStep();
  });
}
function playSequence(i) {
  var flat = cur.flatSentences;
  if (!flat || i >= flat.length) { stopSpeech(); return; }
  speech.playing = true;
  speech.stopFlag = false;
  var b = $("playAllBtn");
  if (b) b.textContent = "⏸ 停止朗讀";
  var spans = document.querySelectorAll(".sen");
  for (var k = 0; k < spans.length; k++) spans[k].classList.remove("playing");
  var span = document.querySelector('.sen[data-idx="' + i + '"]');
  if (span) {
    span.classList.add("playing");
    if (span.scrollIntoView) span.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  speak(flat[i], function () {
    if (span) span.classList.remove("playing");
    if (speech.stopFlag) return;
    playSequence(i + 1);
  });
}

/* ----- 第②步：閱讀理解 ----- */
function renderQuizStep(body) {
  var c = cur.chapter;
  var s = chState(c.id);
  var html = '<div class="card"><h3>📖 閱讀理解</h3><p class="small dim">選出正確答案，每題 ' + SC.perQuestion + ' 分（首次作答計分）</p></div>';
  c.questions.forEach(function (q, qi) {
    html += '<div class="card" data-q="' + qi + '"><b>' + (qi + 1) + '. ' + esc(q.q) + '</b><div style="margin-top:10px">';
    q.options.forEach(function (op, oi) {
      html += '<button class="qOption" data-q="' + qi + '" data-o="' + oi + '">' + "ABCD"[oi] + '. ' + esc(op) + '</button>';
    });
    html += '</div><div class="explain hidden" id="exp' + qi + '">💡 ' + esc(q.explain) + '</div></div>';
  });
  body.innerHTML = html;
  s.quiz.answered.forEach(function (rec) { paintAnswer(rec.q, rec.o, c.questions[rec.q].answer); });
  body.querySelectorAll(".qOption").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var qi = parseInt(btn.getAttribute("data-q"), 10);
      var oi = parseInt(btn.getAttribute("data-o"), 10);
      if (s.quiz.answered.some(function (r) { return r.q === qi; })) return;
      var correct = c.questions[qi].answer === oi;
      s.quiz.answered.push({ q: qi, o: oi, ok: correct });
      if (correct && !s.quiz.done) addPoints(SC.perQuestion);
      paintAnswer(qi, oi, c.questions[qi].answer);
      if (s.quiz.answered.length >= c.questions.length && !s.quiz.done) {
        s.quiz.done = true;
        s.quiz.correct = s.quiz.answered.filter(function (r) { return r.ok; }).length;
        toast("理解完成：" + s.quiz.correct + "/" + c.questions.length + " 題正確！");
      }
      markDirty();
    });
  });
  function paintAnswer(qi, oi, ans) {
    var btns = body.querySelectorAll('.qOption[data-q="' + qi + '"]');
    for (var i = 0; i < btns.length; i++) {
      var o = parseInt(btns[i].getAttribute("data-o"), 10);
      if (o === ans) btns[i].classList.add("correct");
      else if (o === oi) btns[i].classList.add("wrong");
      btns[i].disabled = true;
    }
    var ex = $("exp" + qi);
    if (ex) ex.classList.remove("hidden");
  }
}

/* ----- 第③步：詞語（認讀卡＋相片＋配對） ----- */
function renderWordsStep(body) {
  var c = cur.chapter;
  var s = chState(c.id);
  var html = '<div class="card"><h3>🃏 核心詞語（' + c.words.length + ' 個）</h3>' +
    '<p class="small dim">點 🔊 聽讀音；可以加一張幫你記住詞語的相片！</p></div>';
  c.words.forEach(function (w, wi) {
    var photoKey = state.photos[w.w];
    html += '<div class="card wordCard" data-w="' + wi + '">' +
      '<div class="big">' + esc(w.w) + ' <button class="btn secondary small speakW" data-w="' + wi + '">🔊</button></div>' +
      '<div>' + esc(w.def) + '</div>' +
      '<div class="dim small" style="margin-top:4px">例：' + esc(w.eg) + '</div>' +
      '<div class="photoZone" data-word="' + esc(w.w) + '">' +
      (photoKey
        ? '<img class="wordPhoto" data-key="' + esc(photoKey) + '" alt="記憶圖片"><div class="row" style="justify-content:center"><button class="btn ghost small delPhoto" data-word="' + esc(w.w) + '">🗑 刪除相片</button></div>'
        : '<div class="photoSlot" data-word="' + esc(w.w) + '">📷 加一張記憶圖片（可即場影相）</div>') +
      '</div></div>';
  });
  html += '<div class="card"><h3>🎯 詞語配對</h3><p class="small dim">左邊詞語，右邊意思，逐對點選配對！</p>' +
    '<div id="matchGrid"></div><div class="center" style="margin-top:10px"><span id="matchMsg" class="dim small"></span></div></div>';
  body.innerHTML = html;
  body.querySelectorAll(".speakW").forEach(function (b) {
    b.addEventListener("click", function () {
      var w = c.words[parseInt(b.getAttribute("data-w"), 10)];
      stopSpeech();
      speak(w.w + "。" + w.eg);
    });
  });
  body.querySelectorAll(".photoSlot").forEach(function (slot) {
    slot.addEventListener("click", function () { pickPhoto(slot.getAttribute("data-word")); });
  });
  body.querySelectorAll(".delPhoto").forEach(function (b) {
    b.addEventListener("click", function () { deletePhoto(b.getAttribute("data-word")); });
  });
  body.querySelectorAll(".wordPhoto").forEach(loadPhotoInto);
  renderMatching(s, c);
}
function renderMatching(s, c) {
  var grid = $("matchGrid");
  if (s.matching) {
    grid.innerHTML = "";
    $("matchMsg").textContent = "✓ 已完成配對！可以去下一步。";
    return;
  }
  var words = shuffle(c.words.map(function (w) { return w.w; }));
  var defs = shuffle(c.words.map(function (w) { return { w: w.w, d: w.defShort }; }));
  var col1 = '<div style="display:flex;flex-direction:column;gap:10px">' +
    words.map(function (w) { return '<button class="matchItem word" data-w="' + esc(w) + '">' + esc(w) + '</button>'; }).join("") + "</div>";
  var col2 = '<div style="display:flex;flex-direction:column;gap:10px">' +
    defs.map(function (d) { return '<button class="matchItem def" data-w="' + esc(d.w) + '">' + esc(d.d) + '</button>'; }).join("") + "</div>";
  grid.innerHTML = col1 + col2;
  var selWord = null, selDef = null, matched = 0;
  grid.querySelectorAll(".matchItem").forEach(function (item) {
    item.addEventListener("click", function () {
      var isWord = item.classList.contains("word");
      grid.querySelectorAll(isWord ? ".word.sel" : ".def.sel").forEach(function (x) { x.classList.remove("sel"); });
      item.classList.add("sel");
      if (isWord) selWord = item; else selDef = item;
      if (selWord && selDef) {
        if (selWord.getAttribute("data-w") === selDef.getAttribute("data-w")) {
          selWord.classList.remove("sel"); selDef.classList.remove("sel");
          selWord.classList.add("ok"); selDef.classList.add("ok");
          matched++;
          if (matched >= c.words.length) {
            s.matching = true;
            addPoints(SC.matching);
            markDirty();
            $("matchMsg").textContent = "🎉 全部配對正確！";
          }
        } else {
          selWord.classList.add("no"); selDef.classList.add("no");
          var a = selWord, b = selDef;
          setTimeout(function () {
            a.classList.remove("no", "sel");
            b.classList.remove("no", "sel");
          }, 350);
        }
        selWord = null; selDef = null;
      }
    });
  });
}

/* ----- 相片：拍攝→壓縮→上載 Blobs ----- */
var photoInput = null;
function pickPhoto(word) {
  if (!photoInput) {
    photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoInput.style.display = "none";
    document.body.appendChild(photoInput);
  }
  photoInput.onchange = function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = "";
    if (!file) return;
    toast("📤 相片處理中…");
    compressImage(file, 900, 0.72, function (dataUrl) {
      if (!dataUrl) { toast("相片讀取失敗"); return; }
      var key = "img_" + word;
      api("/api/image", "POST", { key: key, dataUrl: dataUrl }).then(function () {
        state.photos[word] = key;
        imgCache[key] = dataUrl;
        markDirty();
        toast("✓ 相片已存到雲端");
        renderStep();
      }).catch(function () { toast("上載失敗，請檢查網絡"); });
    });
  };
  photoInput.click();
}
function compressImage(file, maxSide, quality, cb) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      var scale = Math.min(1, maxSide / Math.max(w, h));
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      cb(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = function () { cb(null); };
    img.src = reader.result;
  };
  reader.onerror = function () { cb(null); };
  reader.readAsDataURL(file);
}
function loadPhotoInto(imgEl) {
  var key = imgEl.getAttribute("data-key");
  if (imgCache[key]) { imgEl.src = imgCache[key]; return; }
  api("/api/image?key=" + encodeURIComponent(key)).then(function (r) {
    imgCache[key] = r.dataUrl;
    imgEl.src = r.dataUrl;
  }).catch(function () { imgEl.alt = "（相片載入失敗）"; });
}
function deletePhoto(word) {
  var key = state.photos[word];
  if (!key) return;
  api("/api/image?key=" + encodeURIComponent(key), "DELETE").catch(function () {});
  delete state.photos[word];
  delete imgCache[key];
  markDirty();
  renderStep();
}

/* ----- 第④步：寫字（跟寫→默寫，按詞語逐格） ----- */
function writeUnits(c) {
  return c.words.map(function (w) { return { word: w, chars: w.w.split("") }; });
}
function phaseList(s) { return cur.writeMode === "quiz" ? s.dictated : s.traced; }
function wordDone(unit, list) {
  return unit.chars.every(function (ch) { return list.indexOf(ch) >= 0; });
}
function firstIncompletePos(units, list) {
  for (var wi = 0; wi < units.length; wi++)
    for (var ci = 0; ci < units[wi].chars.length; ci++)
      if (list.indexOf(units[wi].chars[ci]) < 0) return { wi: wi, ci: ci };
  return { wi: 0, ci: 0 };
}
function blankedEg(w) {
  if (w.eg.indexOf(w.w) < 0) return w.eg;
  return w.eg.split(w.w).join(new Array(w.w.length + 1).join("＿"));
}
function practiceGain(isQuiz) {
  var today = new Date().toDateString();
  if (state.practice.day !== today) { state.practice.day = today; state.practice.earned = 0; }
  var g = isQuiz ? SC.perDictation : SC.perTrace;
  state.practice.earned += g;
  return g;
}
function renderWriteStep(body) {
  var c = cur.chapter;
  var s = chState(c.id);
  var units = writeUnits(c);
  var uniq = allChars(c);
  if (!cur.modeChosen) {
    cur.writeMode = (s.traced.length >= uniq.length && s.dictated.length < uniq.length) ? "quiz" : "trace";
  }
  var pos = firstIncompletePos(units, phaseList(s));
  cur.wi = pos.wi; cur.ci = pos.ci;
  body.innerHTML =
    '<div class="card center">' +
    '<div class="row" style="justify-content:center;margin-bottom:10px">' +
    '<button class="btn small ' + (cur.writeMode === "trace" ? "" : "secondary") + '" id="modeTrace">👆 跟寫</button>' +
    '<button class="btn small ' + (cur.writeMode === "quiz" ? "" : "secondary") + '" id="modeQuiz">✏️ 無提示默寫</button>' +
    '</div>' +
    '<div class="row" style="justify-content:center;margin-bottom:10px">' +
    '<button class="btn secondary small" id="hearChar">🔊 讀音</button>' +
    '<button class="btn secondary small" id="showDemo">👀 看示範</button>' +
    '</div>' +
    '<div class="charTabs" id="wordNav"></div>' +
    '<div id="writeCue" style="margin:2px 0 10px"></div>' +
    '<div class="charTabs" id="slotRow"></div>' +
    '<div id="writerWrap"><div id="writerBox">' +
    '<svg class="gridlines" viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<line x1="50" y1="0" x2="50" y2="100" stroke="#e8d9b8" stroke-width="0.6" stroke-dasharray="3 2"/>' +
    '<line x1="0" y1="50" x2="100" y2="50" stroke="#e8d9b8" stroke-width="0.6" stroke-dasharray="3 2"/>' +
    '<line x1="0" y1="0" x2="100" y2="100" stroke="#f0e5c9" stroke-width="0.5" stroke-dasharray="3 3"/>' +
    '<line x1="100" y1="0" x2="0" y2="100" stroke="#f0e5c9" stroke-width="0.5" stroke-dasharray="3 3"/>' +
    '</svg><div id="writerTarget" style="position:absolute;inset:0"></div>' +
    '</div><div id="writerMsg"></div></div>' +
    '<p class="small dim" style="margin-top:12px">跟寫：跟着淺色筆畫寫。默寫：整個詞語逐格默，錯三筆會出提示。完成了的字隨時可以重寫賺分：跟寫 +' + SC.perTrace + '⭐、默寫 +' + SC.perDictation + '⭐，不設上限，練多少賺多少。<br>筆順以常用標準為準，個別字或與香港課本略有差異。</p>' +
    '</div>';
  $("modeTrace").addEventListener("click", function () {
    cur.writeMode = "trace"; cur.modeChosen = true; renderStep();
  });
  $("modeQuiz").addEventListener("click", function () {
    if (s.traced.length < uniq.length && !isPreview()) { toast("先完成所有字的跟寫，再挑戰默寫！"); return; }
    cur.writeMode = "quiz"; cur.modeChosen = true; renderStep();
  });
  $("hearChar").addEventListener("click", function () {
    var w = units[cur.wi].word;
    stopSpeech();
    speak(w.w + "。" + w.eg);
  });
  $("showDemo").addEventListener("click", function () {
    demoChar(units[cur.wi].chars[cur.ci]);
  });
  renderWordNav(units, s);
  renderWriteUI(units, s);
}
function renderWordNav(units, s) {
  var nav = $("wordNav");
  if (!nav) return;
  var list = phaseList(s);
  nav.innerHTML = units.map(function (u, i) {
    var done = wordDone(u, list);
    var cls = "charTab" + (i === cur.wi ? " now" : "") + (done ? " done" : "");
    var label = done ? "✓" : (i + 1);
    return '<button class="' + cls + '" style="width:auto;min-width:44px;padding:0 10px;font-size:.95rem" data-i="' + i + '" title="第' + (i + 1) + '個詞語">' + label + '</button>';
  }).join("");
  nav.querySelectorAll(".charTab").forEach(function (b) {
    b.addEventListener("click", function () {
      cur.wi = parseInt(b.getAttribute("data-i"), 10);
      var u = units[cur.wi], list = phaseList(s);
      cur.ci = 0;
      for (var k = 0; k < u.chars.length; k++) if (list.indexOf(u.chars[k]) < 0) { cur.ci = k; break; }
      renderWordNav(units, s);
      renderWriteUI(units, s);
    });
  });
}
function renderWriteUI(units, s) {
  var unit = units[cur.wi];
  var w = unit.word;
  var isQuiz = cur.writeMode === "quiz";
  var list = phaseList(s);
  var cue = $("writeCue");
  if (cue) {
    if (isQuiz) {
      cue.innerHTML = '<div style="font-size:1.05rem"><b>' + esc(w.defShort) + '</b></div>' +
        '<div class="small dim" style="margin-top:2px">例句：' + esc(blankedEg(w)) + '</div>';
    } else {
      cue.innerHTML = '<div style="font-size:2rem;font-weight:800;letter-spacing:6px">' + esc(w.w) + '</div>' +
        '<div class="small dim">' + esc(w.defShort) + '</div>';
    }
  }
  var row = $("slotRow");
  if (row) {
    row.innerHTML = unit.chars.map(function (ch, i) {
      var done = list.indexOf(ch) >= 0;
      var cls = "charTab" + (i === cur.ci ? " now" : "") + (done ? " done" : "");
      var label = isQuiz ? (done ? ch : "？") : ch;
      return '<button class="' + cls + '" data-i="' + i + '">' + label + '</button>';
    }).join("");
    row.querySelectorAll(".charTab").forEach(function (b) {
      b.addEventListener("click", function () {
        cur.ci = parseInt(b.getAttribute("data-i"), 10);
        renderWriteUI(units, s);
      });
    });
  }
  mountWriter(units, s);
}
function destroyWriters() {
  cur.writers.forEach(function (w) { try { w.target && (w.target.innerHTML = ""); } catch (e) {} });
  cur.writers = [];
  var t = $("writerTarget");
  if (t) t.innerHTML = "";
}
function charLoader(char, onLoad) {
  var d = window.STROKES && window.STROKES[char];
  if (d) { setTimeout(function () { onLoad(d); }, 0); return; }
  var m = $("writerMsg");
  if (m) m.innerHTML = '<span style="color:var(--red)">此字暫無筆順數據，請直接在紙上練習 ✍️</span>';
}
function mountWriter(units, s) {
  destroyWriters();
  var target = $("writerTarget");
  if (!target) return;
  var box = $("writerBox");
  var size = Math.min(box.clientWidth || 320, 340);
  var unit = units[cur.wi];
  var ch = unit.chars[cur.ci];
  var isQuiz = cur.writeMode === "quiz";
  var msg = $("writerMsg");
  msg.textContent = isQuiz
    ? "默寫第 " + (cur.ci + 1) + " 個字（共 " + unit.chars.length + " 格）"
    : "跟着筆畫寫「" + ch + "」";
  var writer = HanziWriter.create(target, ch, {
    width: size, height: size, padding: 18,
    showCharacter: false,
    showOutline: !isQuiz,
    strokeColor: "#7a4a20",
    outlineColor: "#e3cfa5",
    drawingColor: "#ff7b3d",
    drawingWidth: 20,
    leniency: 1.35,
    showHintAfterMisses: 3,
    highlightOnComplete: true,
    charDataLoader: charLoader
  });
  cur.writers.push({ writer: writer, target: target });
  writer.quiz({
    onComplete: function () {
      var list = phaseList(s);
      var first = list.indexOf(ch) < 0;
      if (first) {
        list.push(ch);
        if (isQuiz) {
          addPoints(SC.perDictation);
          if (state.charSet.indexOf(ch) < 0) state.charSet.push(ch);
        } else {
          addPoints(SC.perTrace);
        }
        markDirty();
        updateChips();
        msg.innerHTML = '<span style="color:var(--green)">✓ 「' + ch + '」寫得好！</span>';
      } else {
        var g = practiceGain(isQuiz);
        if (g) addPoints(g);
        markDirty();
        updateChips();
        msg.innerHTML = '<span style="color:#c88a1e">💪 重練獎勵 +' + g + '⭐（今日已賺 ' + state.practice.earned + '⭐）</span>';
      }
      setTimeout(function () {
        var uniq = allChars(cur.chapter);
        var listNow = phaseList(s);
        if (wordDone(unit, listNow)) {
          if (listNow.length >= uniq.length) {
            if (!isQuiz) {
              toast("👏 跟寫全部完成！現在挑戰無提示默寫！");
              cur.writeMode = "quiz";
              cur.modeChosen = true;
              renderStep();
            } else {
              toast("🎉 全部詞語默寫成功！");
              renderStep();
            }
          } else {
            toast("✓ 「" + unit.word.w + "」完成！下一個詞語");
            var pos = firstIncompletePos(units, listNow);
            cur.wi = pos.wi; cur.ci = pos.ci;
            renderWordNav(units, s);
            renderWriteUI(units, s);
          }
        } else {
          for (var k = 0; k < unit.chars.length; k++) {
            if (listNow.indexOf(unit.chars[k]) < 0) { cur.ci = k; break; }
          }
          renderWriteUI(units, s);
        }
      }, 850);
    }
  });
}
function demoChar(ch) {
  var target = $("writerTarget");
  if (!target) return;
  destroyWriters();
  var box = $("writerBox");
  var size = Math.min(box.clientWidth || 320, 340);
  var msg = $("writerMsg");
  if (msg) msg.textContent = "示範：「" + ch + "」";
  var writer = HanziWriter.create(target, ch, {
    width: size, height: size, padding: 18,
    showCharacter: false,
    strokeColor: "#7a4a20",
    strokeAnimationSpeed: 1,
    delayBetweenStrokes: 260,
    charDataLoader: charLoader
  });
  cur.writers.push({ writer: writer, target: target });
  writer.animateCharacter({
    onComplete: function () {
      setTimeout(function () {
        var c = cur.chapter;
        renderWriteUI(writeUnits(c), chState(c.id));
      }, 800);
    }
  });
}

/* ----- 第⑤步：句式練習 ----- */
function renderSentenceStep(body) {
  var c = cur.chapter;
  var s = chState(c.id);
  var html = '<div class="card"><h3>🧩 句式・寫作手法練習</h3></div>';
  c.sentence.objective.forEach(function (q, qi) {
    html += '<div class="card"><b>' + (qi + 1) + '. ' + esc(q.q) + '</b><div style="margin-top:10px">';
    q.options.forEach(function (op, oi) {
      html += '<button class="qOption sOpt" data-q="' + qi + '" data-o="' + oi + '">' + "ABCD"[oi] + '. ' + esc(op) + '</button>';
    });
    html += '</div><div class="explain hidden" id="sexp' + qi + '">💡 ' + esc(q.explain) + '</div></div>';
  });
  html += '<div class="card"><h3>✍️ 自由寫作</h3>' +
    '<p>' + esc(c.sentence.free.prompt) + '</p>' +
    '<p class="small dim" style="white-space:pre-wrap">' + esc(c.sentence.free.example) + '</p>' +
    '<textarea id="freeText" placeholder="在這裏寫你的句子…"></textarea>' +
    '<button class="btn amber block" id="freeSubmit" style="margin-top:10px">送交批改（+' + SC.freeSubmit + '分）</button>' +
    '<div id="freeList" style="margin-top:12px"></div></div>';
  body.innerHTML = html;
  s.sentAnswered.forEach(function (rec) { paintS(rec.q, rec.o, c.sentence.objective[rec.q].answer); });
  body.querySelectorAll(".sOpt").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var qi = parseInt(btn.getAttribute("data-q"), 10);
      var oi = parseInt(btn.getAttribute("data-o"), 10);
      if (s.sentAnswered.some(function (r) { return r.q === qi; })) return;
      var ok = c.sentence.objective[qi].answer === oi;
      s.sentAnswered.push({ q: qi, o: oi, ok: ok });
      if (ok) addPoints(SC.perSentence);
      paintS(qi, oi, c.sentence.objective[qi].answer);
      markDirty();
    });
  });
  function paintS(qi, oi, ans) {
    var btns = body.querySelectorAll('.sOpt[data-q="' + qi + '"]');
    for (var i = 0; i < btns.length; i++) {
      var o = parseInt(btns[i].getAttribute("data-o"), 10);
      if (o === ans) btns[i].classList.add("correct");
      else if (o === oi) btns[i].classList.add("wrong");
      btns[i].disabled = true;
    }
    var ex = $("sexp" + qi);
    if (ex) ex.classList.remove("hidden");
  }
  renderFreeList();
  $("freeSubmit").addEventListener("click", function () {
    var txt = $("freeText").value.trim();
    if (!txt) { toast("先寫一句吧！"); return; }
    s.freeWriting.push({ text: txt, ts: Date.now(), stars: null, comment: "" });
    if (!s.freeDone) { s.freeDone = true; addPoints(SC.freeSubmit); }
    $("freeText").value = "";
    markDirty();
    renderFreeList();
    toast("📨 已送交批改！");
  });
  function renderFreeList() {
    var list = $("freeList");
    if (!s.freeWriting.length) { list.innerHTML = ""; return; }
    list.innerHTML = "<b class='small dim'>已提交：</b>" + s.freeWriting.map(function (f) {
      var status = f.stars == null ? '<span class="dim">（等待批改）</span>' : "⭐".repeat(f.stars) + (f.comment ? '<div class="small dim">評語：' + esc(f.comment) + '</div>' : "");
      return '<div style="border-bottom:1px dashed var(--line);padding:8px 0;white-space:pre-wrap">' + esc(f.text) + '<div class="small">' + status + '</div></div>';
    }).join("");
  }
}

/* ----- 完成本章 ----- */
function unlockText(c) {
  if (!c.unlock) return "";
  if (c.unlock.zone) {
    var z = zoneById(c.unlock.zone);
    return '<div class="statLine"><span>🔓 新地區解鎖</span><span class="v">' + z.emoji + ' ' + esc(z.name) + '</span></div>';
  }
  if (c.unlock.item) {
    var it = itemById(c.unlock.item);
    return '<div class="statLine"><span>🔓 新建設解鎖</span><span class="v">' + it.emoji + ' ' + esc(it.name) + '</span></div>';
  }
  return "";
}
function showDoneOverlay(c) {
  var ov = $("doneOverlay");
  ov.classList.remove("hidden");
  var bonus = c.type === "gs" ? SC.gsBonus : SC.chapterBonus;
  ov.innerHTML = '<div class="inner card">' +
    '<img src="img/fox.png" alt="橙橙" style="width:110px">' +
    '<h2 style="margin:8px 0">完成《' + esc(c.title) + '》！</h2>' +
    '<p class="dim small">橙橙：「尤尤，你真棒！」</p>' +
    (c.type === "gs" ? '' : '<div class="statLine"><span>📖 習得常用字</span><span class="v">累計 ' + state.charSet.length + ' 個</span></div>' +
      '<div class="statLine"><span>🃏 本章核心詞語</span><span class="v">' + c.words.length + ' 個</span></div>') +
    '<div class="statLine"><span>🎁 完成獎勵</span><span class="v">+' + bonus + ' 分</span></div>' +
    unlockText(c) +
    '<div class="row" style="margin-top:16px;justify-content:center">' +
    '<button class="btn secondary" id="ovChapters">返回章節</button>' +
    '<button class="btn pink" id="ovZoo">去動物園 🦊</button>' +
    '</div></div>';
  $("ovChapters").addEventListener("click", function () { ov.classList.add("hidden"); showView("chapters"); });
  $("ovZoo").addEventListener("click", function () { ov.classList.add("hidden"); showView("zoo"); });
}

/* ================= 🦊 動物園 ================= */
var ZOO_W = 12, ZOO_H = 8;
var zooTab = "explore";   // explore | build
var selItem = null;       // 建設模式已選物品
var wanderTimer = null;
var wanderPos = {};       // animalId -> {x,y}

var FOX_TIPS = [
  "完成章節可以解鎖新地區，快去看看！",
  "每次探索用 10⭐，答對動物問題會回贈 2⭐！",
  "和同一位朋友多見幾次面，友誼滿 5 顆心，牠就會搬進你的動物園！",
  "朋友遇到困難時，用你學過的知識幫幫牠吧！",
  "在「建設」放置花草樹木，動物朋友住得更開心！",
  "拆走物品會全數退回 ⭐，放心試着佈置吧！",
  "圖鑑裏收藏了每位朋友的小檔案，記得翻翻看！"
];

function zoneUnlocked(z) {
  if (isPreview() || state.unlockAll) return true;
  if (!z.need) return true;
  return !!(state.chapters[z.need] && state.chapters[z.need].completed);
}
function itemUnlocked(it) {
  if (isPreview() || state.unlockAll) return true;
  if (!it.need) return true;
  return !!(state.chapters[it.need] && state.chapters[it.need].completed);
}
function chapterTitle(id) {
  var c = DATA.chapters.filter(function (x) { return x.id === id; })[0];
  return c ? c.title : id;
}

function renderZoo() {
  var v = $("viewZoo");
  var html =
    '<div class="zooFox"><img src="img/fox.png" alt="橙橙">' +
    '<div class="bubble"><b>橙橙：</b>' + esc(pick(FOX_TIPS)) + '</div></div>' +
    '<div class="zooTabs">' +
    '<button class="btn small ' + (zooTab === "explore" ? "" : "secondary") + '" data-t="explore">🧭 探索（' + SC.exploreCost + '⭐/次）</button>' +
    '<button class="btn small ' + (zooTab === "build" ? "" : "secondary") + '" data-t="build">🏗️ 建設</button>' +
    '</div>' +
    '<div id="zooPanel"></div>' +
    '<div class="card"><h3>🏡 我的動物園</h3>' +
    '<p class="small dim" id="zooHint"></p>' +
    '<div id="zooMapWrap"><div id="zooMap"></div></div>' +
    '<p class="small dim center" style="margin-top:8px">🐾 已入住朋友：<b id="resCount">' + state.residents.length + '</b> 位</p>' +
    '</div>';
  v.innerHTML = html;
  v.querySelectorAll(".zooTabs [data-t]").forEach(function (b) {
    b.addEventListener("click", function () { zooTab = b.getAttribute("data-t"); renderZoo(); });
  });
  if (zooTab === "explore") renderExplorePanel($("zooPanel"));
  else renderBuildPanel($("zooPanel"));
  renderZooMap();
  startWander();
  updateZooHint();
}

/* ---- 探索面板 ---- */
function renderExplorePanel(panel) {
  var html = '<p class="small dim" style="margin:2px 0 8px">選一個地區出發，會遇到哪位朋友呢？</p>';
  DATA.zones.forEach(function (z) {
    var un = zoneUnlocked(z);
    var met = DATA.animals.filter(function (a) { return a.zone === z.id && (state.friendship[a.id] || 0) > 0; }).length;
    var total = DATA.animals.filter(function (a) { return a.zone === z.id; }).length;
    html += '<div class="card zoneCard ' + (un ? "" : "locked") + '" data-z="' + z.id + '">' +
      '<div class="emoji">' + (un ? z.emoji : "🔒") + '</div>' +
      '<div style="flex:1"><b>' + esc(z.name) + '</b>' +
      '<div class="small dim">' + (un ? esc(z.desc) + '　🐾 ' + met + '/' + total : '完成《' + esc(chapterTitle(z.need)) + '》即可解鎖') + '</div></div>' +
      (un ? '<button class="btn pink small goZone" data-z="' + z.id + '">出發</button>' : '') +
      '</div>';
  });
  panel.innerHTML = html;
  panel.querySelectorAll(".goZone").forEach(function (b) {
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      exploreZone(b.getAttribute("data-z"));
    });
  });
}
function exploreZone(zoneId) {
  var cost = isPreview() ? 0 : SC.exploreCost;
  if (state.points < cost) {
    toast("⭐ 不夠了！去完成章節或練字賺分吧");
    return;
  }
  if (cost) { spendPoints(cost); updateChips(); }
  state.encCount = (state.encCount || 0) + 1;
  markDirty();
  runEncounter(zoneId);
}

/* ---- 建設面板 ---- */
function renderBuildPanel(panel) {
  var html = '<p class="small dim" style="margin:2px 0 6px">先選物品，再點地圖空格放置；點已放置的物品可拆走（全數退回⭐）。</p>' +
    '<div class="paletteRow">';
  DATA.buildItems.forEach(function (it) {
    var un = itemUnlocked(it);
    html += '<button class="palItem ' + (selItem === it.id ? "sel" : "") + '" data-i="' + it.id + '" ' + (un ? "" : "disabled") + '>' +
      '<span class="em">' + (un ? it.emoji : "🔒") + '</span>' + esc(it.name) +
      '<div class="small" style="color:#d9701e;font-weight:700">' + (un ? it.cost + "⭐" : "未解鎖") + '</div></button>';
  });
  html += '</div>';
  panel.innerHTML = '<div class="card">' + html + '</div>';
  panel.querySelectorAll(".palItem").forEach(function (b) {
    if (b.disabled) return;
    b.addEventListener("click", function () {
      selItem = (selItem === b.getAttribute("data-i")) ? null : b.getAttribute("data-i");
      renderBuildPanel(panel);
      updateZooHint();
    });
  });
  updateZooHint();
}
function updateZooHint() {
  var h = $("zooHint");
  if (!h) return;
  if (zooTab !== "build") { h.textContent = "動物朋友會在園裏散步。去「建設」佈置牠們的家！"; return; }
  var it = selItem ? itemById(selItem) : null;
  h.textContent = it ? ("已選 " + it.emoji + " " + it.name + "（" + it.cost + "⭐）— 點空格放置") : "先在上面選一件物品。";
}

/* ---- 地圖 ---- */
function renderZooMap() {
  var map = $("zooMap");
  if (!map) return;
  map.style.gridTemplateColumns = "repeat(" + ZOO_W + ", auto)";
  var html = "";
  for (var y = 0; y < ZOO_H; y++) {
    for (var x = 0; x < ZOO_W; x++) {
      var key = x + "," + y;
      var itId = state.zoo.tiles[key];
      var it = itId ? itemById(itId) : null;
      html += '<div class="tile' + (zooTab === "build" && !it ? " buildable" : "") + '" data-k="' + key + '">' + (it ? it.emoji : "") + '</div>';
    }
  }
  map.innerHTML = html;
  map.querySelectorAll(".tile").forEach(function (t) {
    t.addEventListener("click", function () { tileTap(t.getAttribute("data-k")); });
  });
  drawResidents(true);
}
function tileTap(key) {
  var itId = state.zoo.tiles[key];
  if (itId) {
    var it = itemById(itId);
    if (!confirm("拆走 " + it.emoji + " " + it.name + "？會退回 " + it.cost + "⭐")) return;
    delete state.zoo.tiles[key];
    state.points += it.cost; // 退款：唔計入累計賺取
    toast("♻️ 已拆走，退回 " + it.cost + "⭐");
    markDirty();
    renderZooMap();
    return;
  }
  if (zooTab !== "build" || !selItem) return;
  var item = itemById(selItem);
  if (state.points < item.cost) { toast("⭐ 不夠買 " + item.name + "！"); return; }
  spendPoints(item.cost);
  state.zoo.tiles[key] = item.id;
  markDirty();
  updateChips();
  renderZooMap();
}

/* ---- 居民漫步 ---- */
function tileMetrics() {
  var map = $("zooMap");
  var first = map ? map.querySelector(".tile") : null;
  if (!first) return null;
  return { size: first.offsetWidth, gap: 3, pad: 8 };
}
function drawResidents(reset) {
  var map = $("zooMap");
  if (!map) return;
  var m = tileMetrics();
  if (!m) return;
  map.querySelectorAll(".resident").forEach(function (r) { r.remove(); });
  state.residents.forEach(function (id) {
    if (reset || !wanderPos[id]) {
      wanderPos[id] = { x: Math.floor(Math.random() * ZOO_W), y: Math.floor(Math.random() * ZOO_H) };
    }
    var a = animalById(id);
    if (!a) return;
    var el = document.createElement("div");
    el.className = "resident";
    el.id = "res_" + id;
    el.textContent = a.emoji;
    el.style.left = (m.pad + wanderPos[id].x * (m.size + m.gap)) + "px";
    el.style.top = (m.pad + wanderPos[id].y * (m.size + m.gap) - 6) + "px";
    map.appendChild(el);
  });
}
function startWander() {
  stopWander();
  wanderTimer = setInterval(function () {
    if (currentView !== "zoo") return;
    var m = tileMetrics();
    if (!m) return;
    state.residents.forEach(function (id) {
      var p = wanderPos[id];
      if (!p) return;
      var dx = Math.floor(Math.random() * 3) - 1;
      var dy = Math.floor(Math.random() * 3) - 1;
      p.x = Math.max(0, Math.min(ZOO_W - 1, p.x + dx));
      p.y = Math.max(0, Math.min(ZOO_H - 1, p.y + dy));
      var el = $("res_" + id);
      if (el) {
        el.style.left = (m.pad + p.x * (m.size + m.gap)) + "px";
        el.style.top = (m.pad + p.y * (m.size + m.gap) - 6) + "px";
      }
    });
  }, 2200);
}
function stopWander() {
  if (wanderTimer) { clearInterval(wanderTimer); wanderTimer = null; }
}

/* ================= 🧭 探索遭遇 ================= */
function hearts(n) {
  var s = "";
  for (var i = 0; i < 5; i++) s += i < n ? "❤️" : "🤍";
  return s;
}
function runEncounter(zoneId) {
  var pool = DATA.animals.filter(function (a) { return a.zone === zoneId; });
  var unseen = pool.filter(function (a) { return !(state.friendship[a.id] > 0); });
  var a = (unseen.length && Math.random() < 0.65) ? pick(unseen) : pick(pool);
  var firstMeet = !(state.friendship[a.id] > 0);
  state.friendship[a.id] = Math.min(5, (state.friendship[a.id] || 0) + 1);
  var becameResident = false;
  var enc = { a: a, zone: zoneById(zoneId), scenes: [], i: 0, firstMeet: firstMeet };

  enc.scenes.push(function (box) { sceneGreet(box, enc); });
  if (firstMeet) {
    enc.scenes.push(function (box) { sceneDexCard(box, enc); });
    enc.scenes.push(function (box) { sceneQuiz(box, enc); });
  } else if (!state.quizDone[a.id]) {
    enc.scenes.push(function (box) { sceneQuiz(box, enc); });
  } else if (a.event && !state.eventDone[a.id] && state.friendship[a.id] >= 2) {
    enc.scenes.push(function (box) { sceneEventStory(box, enc); });
    enc.scenes.push(function (box) { sceneEventQ(box, enc, "q1"); });
    enc.scenes.push(function (box) { sceneEventQ(box, enc, "q2"); });
    enc.scenes.push(function (box) { sceneEventCare(box, enc); });
  } else {
    enc.scenes.push(function (box) { sceneChat(box, enc); });
  }
  enc.finish = function () {
    if (state.friendship[a.id] >= 5 && state.residents.indexOf(a.id) < 0) {
      state.residents.push(a.id);
      becameResident = true;
    }
    markDirty();
    sceneSummary($("encOverlay").querySelector(".inner"), enc, becameResident);
  };
  markDirty();
  var ov = $("encOverlay");
  ov.classList.remove("hidden");
  ov.innerHTML = '<div class="inner card"></div>';
  encNext(enc);
}
function encNext(enc) {
  var box = $("encOverlay").querySelector(".inner");
  if (enc.i >= enc.scenes.length) { enc.finish(); return; }
  var fn = enc.scenes[enc.i];
  enc.i++;
  fn(box);
}
function encCloseBtn() {
  return '';
}
function encHead(enc, sub) {
  return '<div class="small dim">' + enc.zone.emoji + ' ' + esc(enc.zone.name) + '</div>' +
    '<div class="bigEmoji">' + enc.a.emoji + '</div>' +
    '<h2 style="margin:4px 0">' + esc(enc.a.name) + '</h2>' +
    (sub ? '<p class="dim small">' + sub + '</p>' : '');
}
function sceneGreet(box, enc) {
  var line = pick(enc.a.greet);
  box.innerHTML = encHead(enc, enc.firstMeet ? "✨ 初次見面！" : hearts(state.friendship[enc.a.id])) +
    '<div class="encText">' + esc(line) + ' <button class="btn secondary small" id="encSpk">🔊</button></div>' +
    '<button class="btn block" id="encNextBtn">' + (enc.firstMeet ? "認識新朋友 →" : "繼續 →") + '</button>';
  $("encSpk").addEventListener("click", function () { stopSpeech(); speak(line); });
  $("encNextBtn").addEventListener("click", function () { stopSpeech(); encNext(enc); });
}
function sceneDexCard(box, enc) {
  var d = enc.a.dex;
  box.innerHTML = encHead(enc, "📖 新朋友資料已加入圖鑑！") +
    '<div class="encText">' +
    '<div>🏠 <b>住處：</b>' + esc(d.home) + '</div>' +
    '<div>🍽️ <b>食物：</b>' + esc(d.food) + '</div>' +
    '<div>💪 <b>身體：</b>' + esc(d.body) + '</div>' +
    '<div>✨ <b>冷知識：</b>' + esc(d.fun) + '</div>' +
    '</div>' +
    '<button class="btn block" id="encNextBtn">小測驗時間 →</button>';
  $("encNextBtn").addEventListener("click", function () { encNext(enc); });
}
function encMCQ(box, enc, q, title, onDone, rebateOk) {
  var html = encHead(enc, title) +
    '<div class="encText"><b>' + esc(q.q) + '</b><div style="margin-top:8px" id="encOpts">';
  q.options.forEach(function (op, oi) {
    html += '<button class="qOption" data-o="' + oi + '">' + "ABCD"[oi] + '. ' + esc(op) + '</button>';
  });
  html += '</div><div class="explain hidden" id="encExp">💡 ' + esc(q.explain) + '</div></div>' +
    '<button class="btn block hidden" id="encNextBtn">繼續 →</button>';
  box.innerHTML = html;
  box.querySelectorAll("#encOpts .qOption").forEach(function (b) {
    b.addEventListener("click", function () {
      var oi = parseInt(b.getAttribute("data-o"), 10);
      var ok = oi === q.answer;
      box.querySelectorAll("#encOpts .qOption").forEach(function (x) {
        var o = parseInt(x.getAttribute("data-o"), 10);
        if (o === q.answer) x.classList.add("correct");
        else if (o === oi) x.classList.add("wrong");
        x.disabled = true;
      });
      $("encExp").classList.remove("hidden");
      if (ok && rebateOk()) addPoints(SC.encounterReward);
      $("encNextBtn").classList.remove("hidden");
      onDone(ok);
      markDirty();
    });
  });
  $("encNextBtn").addEventListener("click", function () { encNext(enc); });
}
function sceneQuiz(box, enc) {
  var a = enc.a;
  encMCQ(box, enc, a.quiz, "🧠 動物小測驗（首次答對 +" + SC.encounterReward + "⭐）", function (ok) {
    if (ok) state.quizDone[a.id] = true;
  }, function () { return !state.quizDone[a.id]; });
}
function sceneEventStory(box, enc) {
  var ev = enc.a.event;
  box.innerHTML = encHead(enc, "🆘 " + esc(ev.title)) +
    '<div class="encText">' + ev.story.map(function (l) { return "<div>" + esc(l) + "</div>"; }).join("") + '</div>' +
    '<p class="small dim">小獸醫尤尤，出動的時候到了！</p>' +
    '<button class="btn pink block" id="encNextBtn">我來幫忙！→</button>';
  $("encNextBtn").addEventListener("click", function () { encNext(enc); });
}
function sceneEventQ(box, enc, which) {
  var q = enc.a.event[which];
  encMCQ(box, enc, q, "🩺 觀察與判斷（答對 +" + SC.encounterReward + "⭐）", function () {}, function () { return true; });
}
function sceneEventCare(box, enc) {
  var a = enc.a;
  var care = a.event.care;
  state.eventDone[a.id] = true;
  state.friendship[a.id] = Math.min(5, state.friendship[a.id] + 1);
  box.innerHTML = encHead(enc, "🎉 事件解決！友誼加深了 " + hearts(state.friendship[a.id])) +
    '<div class="encText"><b>📋 ' + esc(care.title) + '</b>' +
    care.points.map(function (p) { return "<div>・" + esc(p) + "</div>"; }).join("") +
    '<div class="small dim" style="margin-top:6px">已收藏到圖鑑，隨時重溫。</div></div>' +
    '<button class="btn block" id="encNextBtn">繼續 →</button>';
  markDirty();
  $("encNextBtn").addEventListener("click", function () { encNext(enc); });
}
function sceneChat(box, enc) {
  var line = pick(enc.a.greet);
  box.innerHTML = encHead(enc, "☀️ 日常時光") +
    '<div class="encText">' + esc(line) + ' <button class="btn secondary small" id="encSpk">🔊</button></div>' +
    '<p class="small dim">你們一起度過了愉快的時光。</p>' +
    '<button class="btn block" id="encNextBtn">繼續 →</button>';
  $("encSpk").addEventListener("click", function () { stopSpeech(); speak(line); });
  $("encNextBtn").addEventListener("click", function () { stopSpeech(); encNext(enc); });
}
function sceneSummary(box, enc, becameResident) {
  var a = enc.a;
  var h = state.friendship[a.id];
  box.innerHTML = encHead(enc, hearts(h)) +
    (becameResident
      ? '<div class="encText" style="text-align:center">🏡 <b>' + esc(a.name) + ' 搬進你的動物園了！</b><br><span class="small dim">牠會在園裏散步，記得去看牠！</span></div>'
      : (h >= 5 ? '' : '<p class="small dim">再多見幾次面，' + esc(a.name) + '就會搬進你的動物園（滿 5 顆心）。</p>')) +
    '<div class="row" style="justify-content:center;margin-top:10px">' +
    '<button class="btn secondary" id="encClose">返回動物園</button>' +
    '<button class="btn pink" id="encAgain">再探索一次（' + (isPreview() ? "免費" : SC.exploreCost + "⭐") + '）</button>' +
    '</div>';
  $("encClose").addEventListener("click", function () {
    $("encOverlay").classList.add("hidden");
    renderZoo();
  });
  $("encAgain").addEventListener("click", function () {
    var cost = isPreview() ? 0 : SC.exploreCost;
    if (state.points < cost) { toast("⭐ 不夠了！去完成章節或練字賺分吧"); return; }
    if (cost) { spendPoints(cost); updateChips(); }
    state.encCount = (state.encCount || 0) + 1;
    markDirty();
    runEncounter(enc.zone.id);
  });
}

/* ================= 📖 圖鑑 ================= */
function renderDex(detailId) {
  var v = $("viewDex");
  var seen = DATA.animals.filter(function (a) { return (state.friendship[a.id] || 0) > 0; }).length;
  var html = '<h2>📖 動物圖鑑</h2>' +
    '<p class="dim small">已認識 <b style="color:#d97a2a">' + seen + '</b> / ' + DATA.animals.length + ' 位朋友。去探索認識更多吧！</p>';
  DATA.zones.forEach(function (z) {
    html += '<div class="groupTitle">' + z.emoji + ' ' + esc(z.name) + '</div><div class="dexZone" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px">';
    DATA.animals.filter(function (a) { return a.zone === z.id; }).forEach(function (a) {
      var f = state.friendship[a.id] || 0;
      html += '<div class="dexCard ' + (f > 0 ? "" : "unseen") + '" data-a="' + a.id + '">' +
        '<span class="em">' + a.emoji + '</span>' +
        '<div class="nm">' + (f > 0 ? esc(a.name) : "？？？") + '</div>' +
        '<div class="hearts">' + (f > 0 ? hearts(f) : "") + '</div>' +
        '</div>';
    });
    html += '</div>';
  });
  v.innerHTML = html;
  v.querySelectorAll(".dexCard").forEach(function (card) {
    card.addEventListener("click", function () {
      var a = animalById(card.getAttribute("data-a"));
      if (!(state.friendship[a.id] > 0)) { toast("還沒遇見這位朋友，去探索吧！"); return; }
      showDexDetail(a);
    });
  });
}
function showDexDetail(a) {
  var ov = $("doneOverlay");
  var f = state.friendship[a.id] || 0;
  var isRes = state.residents.indexOf(a.id) >= 0;
  var html = '<div class="inner card">' +
    '<div class="bigEmoji">' + a.emoji + '</div>' +
    '<h2 style="margin:4px 0">' + esc(a.name) + (isRes ? ' <span class="tag">🏡 已入住</span>' : '') + '</h2>' +
    '<div class="heartsBig">' + hearts(f) + '</div>' +
    '<div class="encText">' +
    '<div>🏠 <b>住處：</b>' + esc(a.dex.home) + '</div>' +
    '<div>🍽️ <b>食物：</b>' + esc(a.dex.food) + '</div>' +
    '<div>💪 <b>身體：</b>' + esc(a.dex.body) + '</div>' +
    '<div>✨ <b>冷知識：</b>' + esc(a.dex.fun) + '</div>' +
    '</div>';
  html += '<div class="small" style="margin:6px 0">' +
    (state.quizDone[a.id] ? '🧠 小測驗 ✓ 已答對' : '🧠 小測驗：探索時挑戰') + '</div>';
  if (a.event) {
    if (state.eventDone[a.id]) {
      html += '<div class="encText"><b>📋 ' + esc(a.event.care.title) + '</b>' +
        a.event.care.points.map(function (p) { return "<div>・" + esc(p) + "</div>"; }).join("") + '</div>';
    } else {
      html += '<div class="small dim">🆘 這位朋友將來可能需要你幫忙（友誼 2 顆心後留意）</div>';
    }
  }
  html += '<button class="btn block" id="dexClose" style="margin-top:12px">關閉</button></div>';
  ov.innerHTML = html;
  ov.classList.remove("hidden");
  $("dexClose").addEventListener("click", function () { ov.classList.add("hidden"); });
}

/* ================= 🎁 獎勵 ================= */
function renderRewards() {
  var v = $("viewRewards");
  var list = rewardsList().slice().sort(function (a, b) { return a.points - b.points; });
  var maxP = list.length ? list[list.length - 1].points : 100;
  var pct = Math.min(100, Math.round(state.points / maxP * 100));
  var html = '<h2>🎁 獎勵進度</h2>' +
    '<p class="dim small">目前積分：<b style="color:#d97a2a">' + state.points + '</b> 分</p>' +
    '<div id="rewardTrack"><div id="rewardLine"><div style="width:' + pct + '%"></div></div></div>';
  list.forEach(function (r) {
    var reached = isPreview() || state.points >= r.points;
    var claimed = state.rewards.claimed.indexOf(r.id) >= 0;
    html += '<div class="card milestone ' + (reached ? "reached" : "") + (claimed ? " claimed" : "") + (r.real ? " realGift" : "") + '">' +
      '<span class="emoji">' + r.emoji + '</span>' +
      '<div style="flex:1"><b>' + esc(r.name) + '</b>' + (r.real ? ' <span class="tag">真實禮物</span>' : ' <span class="tag">榮譽獎章</span>') +
      '<div class="small dim">' + r.points + ' 分解鎖</div></div>' +
      (claimed ? '<span class="doneMark">✓ 已兌換</span>'
        : (reached ? '<button class="btn amber small claimBtn" data-id="' + r.id + '">兌換</button>'
          : '<span class="dim small">還差 ' + (r.points - state.points) + ' 分</span>')) +
      '</div>';
  });
  html += '<p class="small dim center">🎁 兌換後記得領獎！</p>';
  v.innerHTML = html;
  v.querySelectorAll(".claimBtn").forEach(function (b) {
    b.addEventListener("click", function () {
      state.rewards.claimed.push(b.getAttribute("data-id"));
      markDirty();
      toast("🎉 恭喜！快去領獎！");
      renderRewards();
    });
  });
}

/* ================= 📊 批改模式 ================= */
var parentTab = "review";
function renderParent() {
  var v = $("viewParent");
  if (isPreview()) parentAuthed = true;
  if (!parentAuthed) {
    v.innerHTML = '<h2>📊 批改模式</h2>' +
      '<div class="card" style="max-width:420px">' +
      '<p class="small dim">輸入密碼（預設 6688，入面可以改）</p>' +
      '<input type="password" id="pinInput" placeholder="密碼" style="margin:8px 0">' +
      '<button class="btn block" id="pinBtn">進入</button>' +
      '<p id="pinMsg" class="small" style="color:var(--red);margin-top:8px"></p></div>';
    $("pinBtn").addEventListener("click", function () {
      if ($("pinInput").value === state.parentPin) { parentAuthed = true; renderParent(); }
      else $("pinMsg").textContent = "密碼不正確";
    });
    return;
  }
  var tabs = [["review", "📝 批改"], ["gifts", "🎁 禮物"], ["report", "📊 報告"], ["settings", "⚙️ 設定"]];
  var html = '<h2>📊 批改模式</h2><div class="row" style="margin-bottom:12px">' +
    tabs.map(function (t) {
      return '<button class="btn small ' + (parentTab === t[0] ? "" : "secondary") + '" data-t="' + t[0] + '">' + t[1] + '</button>';
    }).join("") + '</div><div id="parentBody"></div>';
  v.innerHTML = html;
  v.querySelectorAll("[data-t]").forEach(function (b) {
    b.addEventListener("click", function () { parentTab = b.getAttribute("data-t"); renderParent(); });
  });
  var body = $("parentBody");
  if (parentTab === "review") renderReview(body);
  else if (parentTab === "gifts") renderGifts(body);
  else if (parentTab === "report") renderReport(body);
  else renderSettings(body);
}
function renderReview(body) {
  var pending = [], graded = [];
  DATA.chapters.forEach(function (c) {
    var s = state.chapters[c.id];
    if (!s) return;
    s.freeWriting.forEach(function (f, fi) {
      var item = { c: c, f: f, fi: fi };
      (f.stars == null ? pending : graded).push(item);
    });
  });
  var html = "<h3>等待批改（" + pending.length + "）</h3>";
  if (!pending.length) html += '<p class="dim small">暫時沒有新提交。</p>';
  pending.forEach(function (it, idx) {
    html += '<div class="card reviewItem">' +
      '<div class="small dim">《' + esc(it.c.title) + '》・' + esc(it.c.sentence.free.prompt) + '</div>' +
      '<div style="font-size:1.05rem;margin:6px 0;white-space:pre-wrap">「' + esc(it.f.text) + '」</div>' +
      '<div class="stars" data-i="' + idx + '">' +
      [1, 2, 3].map(function (n) { return '<button data-star="' + n + '">⭐</button>'; }).join("") +
      '</div>' +
      '<input type="text" class="cmtInput" data-i="' + idx + '" placeholder="評語（可留空）" style="margin:8px 0">' +
      '<button class="btn green small gradeBtn" data-i="' + idx + '" disabled>儲存批改（每星+' + SC.perStar + '分）</button>' +
      '</div>';
  });
  if (graded.length) {
    html += '<h3 style="margin-top:16px">已批改</h3>' + graded.slice(-8).reverse().map(function (it) {
      return '<div class="card"><div class="small dim">《' + esc(it.c.title) + '》</div><span style="white-space:pre-wrap">「' + esc(it.f.text) + '」</span><div>' + "⭐".repeat(it.f.stars) + (it.f.comment ? ' <span class="small dim">' + esc(it.f.comment) + '</span>' : "") + '</div></div>';
    }).join("");
  }
  body.innerHTML = html;
  var chosen = {};
  body.querySelectorAll(".stars").forEach(function (starBox) {
    var i = starBox.getAttribute("data-i");
    starBox.querySelectorAll("button").forEach(function (sb) {
      sb.addEventListener("click", function () {
        chosen[i] = parseInt(sb.getAttribute("data-star"), 10);
        starBox.querySelectorAll("button").forEach(function (x) {
          x.classList.toggle("on", parseInt(x.getAttribute("data-star"), 10) <= chosen[i]);
        });
        body.querySelector('.gradeBtn[data-i="' + i + '"]').disabled = false;
      });
    });
  });
  body.querySelectorAll(".gradeBtn").forEach(function (gb) {
    gb.addEventListener("click", function () {
      var i = gb.getAttribute("data-i");
      var it = pending[parseInt(i, 10)];
      var stars = chosen[i] || 1;
      it.f.stars = stars;
      it.f.comment = body.querySelector('.cmtInput[data-i="' + i + '"]').value.trim();
      earn(stars * SC.perStar);
      checkRewardReach();
      markDirty();
      toast("已批改：+" + stars * SC.perStar + " 分");
      renderParent();
    });
  });
}
function renderGifts(body) {
  var list = state.rewards.custom ? state.rewards.custom : JSON.parse(JSON.stringify(DATA.defaultRewards));
  var html = '<p class="small dim">改名、改分數門檻、剔選「真實禮物」。儲存後即時生效。</p>';
  list.forEach(function (r, i) {
    html += '<div class="card"><div class="row">' +
      '<input type="text" class="gName" data-i="' + i + '" value="' + esc(r.name) + '" style="flex:2;min-width:140px">' +
      '<input type="number" class="gPts" data-i="' + i + '" value="' + r.points + '" style="flex:1;min-width:90px">' +
      '<label class="small"><input type="checkbox" class="gReal" data-i="' + i + '"' + (r.real ? " checked" : "") + '> 真實禮物</label>' +
      '<button class="btn ghost small gDel" data-i="' + i + '">🗑</button>' +
      '</div></div>';
  });
  html += '<div class="row"><button class="btn secondary small" id="gAdd">➕ 加一個獎勵</button>' +
    '<button class="btn green" id="gSave">💾 儲存獎勵設定</button></div>';
  body.innerHTML = html;
  $("gAdd").addEventListener("click", function () {
    list.push({ id: "r" + Date.now(), points: 1000, name: "新獎勵", emoji: "🎁", real: true });
    state.rewards.custom = list;
    renderParent();
  });
  body.querySelectorAll(".gDel").forEach(function (b) {
    b.addEventListener("click", function () {
      list.splice(parseInt(b.getAttribute("data-i"), 10), 1);
      state.rewards.custom = list;
      renderParent();
    });
  });
  $("gSave").addEventListener("click", function () {
    body.querySelectorAll(".gName").forEach(function (inp) { list[parseInt(inp.getAttribute("data-i"), 10)].name = inp.value.trim() || "獎勵"; });
    body.querySelectorAll(".gPts").forEach(function (inp) { list[parseInt(inp.getAttribute("data-i"), 10)].points = Math.max(1, parseInt(inp.value, 10) || 100); });
    body.querySelectorAll(".gReal").forEach(function (inp) { list[parseInt(inp.getAttribute("data-i"), 10)].real = inp.checked; });
    state.rewards.custom = list;
    markDirty();
    toast("✓ 獎勵已更新");
    renderParent();
  });
}
function renderReport(body) {
  var totalWords = 0, rows = "";
  DATA.chapters.forEach(function (c) {
    var s = state.chapters[c.id];
    var prog = Math.round(chapterProgress(c) * 100);
    var dict = c.type === "gs" ? "—" : ((s ? s.dictated.length : 0) + "/" + allChars(c).length);
    var quiz = (s && s.quiz.done) ? (s.quiz.correct + "/" + c.questions.length) : "－";
    if (s && s.completed) totalWords += c.words.length;
    rows += "<tr><td>" + c.num + ". " + esc(c.title) + "</td><td>" + prog + "%</td><td>" + dict + "</td><td>" + quiz + "</td></tr>";
  });
  var quizOk = 0; for (var k in state.quizDone) if (state.quizDone[k]) quizOk++;
  var evOk = 0; for (var k2 in state.eventDone) if (state.eventDone[k2]) evOk++;
  body.innerHTML =
    '<div class="card"><div class="statLine"><span>⭐ 現有積分（可使用）</span><span class="v">' + state.points + '</span></div>' +
    '<div class="statLine"><span>🌟 累計賺取積分</span><span class="v">' + (state.earnedTotal || state.points) + '</span></div>' +
    '<div class="statLine"><span>📖 習得常用字（默寫通過）</span><span class="v">' + state.charSet.length + ' 個</span></div>' +
    '<div class="statLine"><span>🃏 已完成章節詞語</span><span class="v">' + totalWords + ' 個</span></div></div>' +
    '<div class="card"><div class="statLine"><span>🐾 已認識動物朋友</span><span class="v">' + friendCount() + ' / ' + DATA.animals.length + '</span></div>' +
    '<div class="statLine"><span>🏡 已入住動物園</span><span class="v">' + state.residents.length + ' 位</span></div>' +
    '<div class="statLine"><span>🧠 圖鑑問答答對</span><span class="v">' + quizOk + ' 題</span></div>' +
    '<div class="statLine"><span>🩺 求助事件完成</span><span class="v">' + evOk + ' / ' + DATA.animals.filter(function (a) { return a.event; }).length + '</span></div>' +
    '<div class="statLine"><span>🧭 探索次數</span><span class="v">' + (state.encCount || 0) + '</span></div></div>' +
    '<div class="card" style="overflow-x:auto"><table class="report"><tr><th>章節</th><th>進度</th><th>默寫</th><th>理解</th></tr>' + rows + '</table></div>' +
    '<p class="small dim">「習得常用字」以無提示默寫通過的字數累計；詞語取自小三詞彙表。</p>';
}
function renderSettings(body) {
  body.innerHTML =
    '<div class="card"><h3>解鎖設定</h3>' +
    '<label><input type="checkbox" id="unlockAll"' + (state.unlockAll ? " checked" : "") + '> 解鎖全部章節與地區（自由溫習）</label></div>' +
    '<div class="card"><h3>更改密碼</h3>' +
    '<input type="password" id="newPin" placeholder="新密碼（4位或以上）" style="margin:8px 0">' +
    '<button class="btn small" id="pinSave">更改密碼</button></div>' +
    '<div class="card"><h3>資料備份</h3><div class="row">' +
    '<button class="btn secondary small" id="expBtn">⬇️ 匯出進度檔</button>' +
    '<button class="btn secondary small" id="impBtn">⬆️ 匯入進度檔</button></div>' +
    '<p class="small dim" style="margin-top:6px">進度會自動存雲端；匯出檔案是後備多一重保障。</p></div>' +
    '<div class="card"><h3>其他</h3><div class="row">' +
    '<button class="btn ghost small" id="logoutBtn">登出（換家庭代碼）</button>' +
    '<button class="btn ghost small" id="resetBtn" style="color:var(--red)">⚠️ 重設全部進度</button></div></div>';
  $("unlockAll").addEventListener("change", function () {
    state.unlockAll = $("unlockAll").checked;
    markDirty();
    toast(state.unlockAll ? "已解鎖全部章節與地區" : "已恢復順序解鎖");
  });
  $("pinSave").addEventListener("click", function () {
    var p = $("newPin").value.trim();
    if (p.length < 4) { toast("密碼至少 4 位"); return; }
    state.parentPin = p;
    markDirty();
    $("newPin").value = "";
    toast("✓ 密碼已更改");
  });
  $("expBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    var d = new Date();
    a.download = "尤尤動物樂園存檔_" + d.getFullYear() + (d.getMonth() + 101 + "").slice(1) + (d.getDate() + 100 + "").slice(1) + ".json";
    a.click();
  });
  $("impBtn").addEventListener("click", function () {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var s = JSON.parse(r.result);
          if (typeof s.points !== "number") throw new Error("bad");
          state = migrate(s);
          parentAuthed = false;
          markDirty();
          toast("✓ 進度已匯入");
          showView("chapters");
        } catch (e) { toast("檔案格式不正確"); }
      };
      r.readAsText(f);
    };
    inp.click();
  });
  $("logoutBtn").addEventListener("click", function () {
    localStorage.removeItem("famCode");
    localStorage.removeItem("famRole");
    location.reload();
  });
  $("resetBtn").addEventListener("click", function () {
    if (!confirm("確定要清除所有學習進度嗎？此動作不能還原。")) return;
    if (!confirm("再確認一次：真的要全部重設？")) return;
    var pin = state.parentPin;
    state = freshState();
    state.parentPin = pin;
    markDirty();
    toast("已重設進度");
    showView("chapters");
  });
}

/* ---------------- 啟動 ---------------- */
initVoices();
window.addEventListener("pagehide", function () {
  if (state) localStorage.setItem(localKey(), JSON.stringify(state));
});

})();
