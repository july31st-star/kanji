/* ===== Learn-to-write-kanji interaction ===== */
(function () {
  "use strict";

  var SIZE = 300; // px of the writing square (matches CSS)
  var kanji = window.KANJI || [];

  var els = {
    picker: document.getElementById("picker"),
    target: document.getElementById("target"),
    now: document.getElementById("strokeNow"),
    total: document.getElementById("strokeTotal"),
    speed: document.getElementById("speed"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnPlay: document.getElementById("btnPlay"),
    btnQuiz: document.getElementById("btnQuiz"),
    btnReset: document.getElementById("btnReset"),
    memEmoji: document.getElementById("memEmoji"),
    memMeaning: document.getElementById("memMeaning"),
    memOn: document.getElementById("memOn"),
    memKun: document.getElementById("memKun"),
    memChar: document.getElementById("memChar"),
    memStory: document.getElementById("memStory"),
  };

  var writer = null;
  var current = 0; // strokes currently shown
  var total = 0;
  var active = null; // active kanji object
  var speed = 1;
  var token = 0; // cancels in-flight animation chains

  /* ---------- build the picker ---------- */
  function buildPicker() {
    kanji.forEach(function (k, i) {
      var tile = document.createElement("button");
      tile.className = "tile";
      tile.setAttribute("aria-label", k.meaning);
      tile.innerHTML =
        '<span class="tile-char">' + k.char + "</span>" +
        '<span class="tile-meaning">' + k.meaning + "</span>";
      tile.addEventListener("click", function () {
        select(i);
      });
      els.picker.appendChild(tile);
    });
  }

  function select(i) {
    var tiles = els.picker.querySelectorAll(".tile");
    tiles.forEach(function (t, idx) {
      t.classList.toggle("is-active", idx === i);
    });
    active = kanji[i];
    total = active.strokes;
    updateMemory(active);
    loadWriter(active.char);
  }

  function updateMemory(k) {
    els.memEmoji.textContent = k.emoji;
    els.memMeaning.textContent = k.meaning;
    els.memOn.textContent = k.on;
    els.memKun.textContent = k.kun;
    els.memChar.textContent = k.char;
    els.memStory.textContent = k.story;
  }

  /* ---------- Hanzi Writer setup ---------- */
  function loadWriter(char) {
    token++;
    els.target.innerHTML = "";
    current = 0;
    writer = HanziWriter.create(els.target, char, {
      width: SIZE,
      height: SIZE,
      padding: 14,
      showCharacter: false,
      showOutline: true,
      strokeColor: "#181510",
      outlineColor: "#cabfa0",
      drawingColor: "#a23b2d",
      strokeAnimationSpeed: speed,
      delayBetweenStrokes: 360,
      strokeFadeDuration: 0,
    });
    updateCounter();
  }

  function updateCounter() {
    els.now.textContent = current;
    els.total.textContent = total;
    els.btnPrev.disabled = current <= 0;
    els.btnNext.disabled = current >= total;
  }

  /* ---------- stepping ---------- */
  function nextStroke() {
    if (!writer || current >= total) return;
    var idx = current;
    writer.animateStroke(idx);
    current += 1;
    updateCounter();
  }

  // Show the first n strokes, replaying quickly (used for Back).
  function goTo(n) {
    if (!writer) return;
    var my = ++token;
    writer.hideCharacter({ duration: 0 });
    current = 0;
    updateCounter();
    if (n <= 0) return;
    var i = 0;
    (function step() {
      if (my !== token) return;
      if (i >= n) return;
      writer.animateStroke(i, { onComplete: step });
      i += 1;
      current = i;
      updateCounter();
    })();
  }

  function prevStroke() {
    if (!writer || current <= 0) return;
    goTo(current - 1);
  }

  function animateAll() {
    if (!writer) return;
    token++;
    writer.hideCharacter({ duration: 0 });
    current = 0;
    updateCounter();
    writer.animateCharacter({
      onComplete: function () {
        current = total;
        updateCounter();
      },
    });
  }

  function practice() {
    if (!writer) return;
    token++;
    current = 0;
    updateCounter();
    writer.quiz({
      showHintAfterMisses: 2,
      onComplete: function () {
        current = total;
        updateCounter();
      },
    });
  }

  function reset() {
    if (!writer) return;
    token++;
    if (writer.cancelQuiz) writer.cancelQuiz();
    writer.hideCharacter({ duration: 0 });
    current = 0;
    updateCounter();
  }

  /* ---------- speed changes require a rebuild ---------- */
  function changeSpeed(v) {
    speed = v;
    if (!active) return;
    var restore = current;
    loadWriter(active.char);
    if (restore > 0) goTo(restore);
  }

  /* ---------- wire up ---------- */
  els.btnNext.addEventListener("click", nextStroke);
  els.btnPrev.addEventListener("click", prevStroke);
  els.btnPlay.addEventListener("click", animateAll);
  els.btnQuiz.addEventListener("click", practice);
  els.btnReset.addEventListener("click", reset);
  els.speed.addEventListener("input", function () {
    changeSpeed(parseFloat(els.speed.value));
  });

  buildPicker();
  select(0);
})();
