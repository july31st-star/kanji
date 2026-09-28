/* ===== Learn-to-write-kanji interaction ===== */
(function () {
  "use strict";

  var SIZE = 300; // px of the writing square (matches CSS)
  var kanji = window.KANJI || [];

  // romaji for the elegant caption line under each character
  var ROMAJI = {
    "木": "Ki", "日": "Hi", "月": "Tsuki", "山": "Yama", "川": "Kawa",
    "田": "Ta", "口": "Kuchi", "人": "Hito", "火": "Hi", "水": "Mizu",
    "目": "Me", "手": "Te", "雨": "Ame",
    "竹": "Take", "花": "Hana", "鳥": "Tori", "魚": "Sakana", "馬": "Uma",
  };

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
    assocImg: document.getElementById("assocImg"),
    assocEmoji: document.getElementById("assocEmoji"),
    memCaption: document.getElementById("memCaption"),
    flip: document.querySelector(".page-flip"),
    memMeaning: document.getElementById("memMeaning"),
    memOn: document.getElementById("memOn"),
    memKun: document.getElementById("memKun"),
    memChar: document.getElementById("memChar"),
  };

  var writer = null;
  var current = 0; // strokes currently shown
  var total = 0;
  var active = null; // active kanji object
  var currentIndex = 0; // index of the kanji on the spread
  var speed = 1;
  var token = 0; // cancels in-flight animation chains
  var quizzing = false; // true while a tracing quiz is in progress

  /* ---------- build the picker ---------- */
  function buildPicker() {
    kanji.forEach(function (k, i) {
      var tile = document.createElement("button");
      tile.className = "tile";
      tile.setAttribute("aria-label", k.meaning);
      tile.title = k.meaning;
      tile.innerHTML =
        '<span class="tile-char">' + k.char + "</span>" +
        '<span class="tile-meaning">' + k.meaning + "</span>";
      tile.addEventListener("click", function () {
        select(i);
      });
      els.picker.appendChild(tile);
    });
  }

  var flipTimers = [];
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clearFlipTimers() {
    flipTimers.forEach(clearTimeout);
    flipTimers = [];
  }

  // ----- content application for one page-side -----
  function setActiveTile(i) {
    var tiles = els.picker.querySelectorAll(".tile");
    tiles.forEach(function (t, idx) {
      t.classList.toggle("is-active", idx === i);
    });
  }
  // right page: illustration + meaning; left page: the writing grid
  function applyRight(k) { active = k; updateMemory(k); }
  function applyLeft(k) { active = k; total = k.strokes; loadWriter(k.char); }

  // clear any inline styles/classes left on the turning leaf by a manual drag
  function resetLeaf() {
    if (!els.flip) return;
    els.flip.classList.remove("page-flip--back");
    els.flip.style.transition = "";
    els.flip.style.transform = "";
    els.flip.style.opacity = "";
    els.flip.style.boxShadow = "";
  }

  function select(i, skipFlip) {
    setActiveTile(i);
    var k = kanji[i];

    if (skipFlip || reduceMotion || !els.flip) {
      applyRight(k);
      applyLeft(k);
      currentIndex = i;
      return;
    }

    // restart the page-turn animation
    clearFlipTimers();
    resetLeaf();
    els.flip.classList.remove("is-flipping");
    void els.flip.offsetWidth; // force reflow so the animation replays
    els.flip.classList.add("is-flipping");

    // Swap each side while the turning leaf is passing over it:
    // the leaf covers the right half first (~35%), then sweeps to the
    // left half (~78%), so the writing grid changes there — hidden.
    flipTimers.push(setTimeout(function () { applyRight(k); }, 330));
    flipTimers.push(setTimeout(function () { applyLeft(k); }, 720));
    currentIndex = i;

    var done = function () {
      els.flip.classList.remove("is-flipping");
      els.flip.removeEventListener("animationend", done);
    };
    els.flip.addEventListener("animationend", done);
  }

  function updateMemory(k) {
    // association illustration: show the watercolor image if we have one,
    // otherwise fall back to the emoji.
    if (k.image) {
      els.assocImg.src = k.image + "?e=2"; // cache-bust after removing seals
      els.assocImg.alt = "Cute illustration hiding the kanji for " + k.meaning;
      els.assocImg.hidden = false;
      els.assocEmoji.style.display = "none";
    } else {
      els.assocImg.hidden = true;
      els.assocEmoji.textContent = k.emoji;
      els.assocEmoji.style.display = "grid";
    }
    els.memCaption.textContent = (ROMAJI[k.char] || "") + " · " + k.meaning;
    els.memMeaning.textContent = k.meaning;
    els.memOn.textContent = k.on;
    els.memKun.textContent = k.kun;
    els.memChar.textContent = k.char;
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
    quizzing = true;
    writer.quiz({
      showHintAfterMisses: 2,
      onComplete: function () {
        quizzing = false;
        current = total;
        updateCounter();
      },
    });
  }

  function reset() {
    if (!writer) return;
    token++;
    quizzing = false;
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

  /* ---------- drag to flip the page ---------- */
  // Grab the right page and drag left to turn to the next kanji; grab the left
  // page and drag right to turn back. The turning leaf follows the pointer and
  // snaps forward (or back) when you let go past the halfway point.
  function initDragFlip() {
    var spread = document.querySelector(".spread");
    if (!spread || !els.flip || reduceMotion || kanji.length < 2) return;

    var drag = null;

    function leafWidth() {
      var w = els.flip.getBoundingClientRect().width;
      return w || spread.getBoundingClientRect().width / 2;
    }

    // position/orient the leaf for a forward ("next") or backward ("prev") turn
    function configLeaf(dir) {
      els.flip.classList.toggle("page-flip--back", dir === "prev");
      els.flip.style.transition = "none";
      els.flip.style.opacity = "1";
    }

    function paint(dir, p) {
      var angle = (dir === "next" ? -180 : 180) * p;
      els.flip.style.transform = "rotateY(" + angle + "deg)";
      var lift = Math.sin(p * Math.PI); // 0 → 1 → 0 across the turn
      var sign = dir === "next" ? -1 : 1;
      els.flip.style.boxShadow =
        (sign * (10 + lift * 26)).toFixed(0) + "px " +
        (lift * 8).toFixed(0) + "px " +
        (18 + lift * 30).toFixed(0) + "px rgba(70,50,20," +
        (0.14 + lift * 0.24).toFixed(3) + ")";
    }

    // preview the side the leaf lifts off of, so the destination shows through
    function previewApply(dir, idx) {
      if (dir === "next") { applyRight(kanji[idx]); }
      else { applyLeft(kanji[idx]); }
    }

    function onDown(e) {
      if (drag || quizzing) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (els.flip.classList.contains("is-flipping")) return;
      // never hijack the controls, slider, tiles, or links
      if (e.target.closest("button, input, a, label, .controls, .speed, .picker")) return;
      var dir = e.target.closest(".page-right")
        ? "next"
        : e.target.closest(".page-left")
        ? "prev"
        : null;
      if (!dir) return;
      drag = {
        dir: dir,
        startX: e.clientX,
        w: leafWidth(),
        target:
          dir === "next"
            ? (currentIndex + 1) % kanji.length
            : (currentIndex - 1 + kanji.length) % kanji.length,
        p: 0,
        shown: false,
        previewed: false,
        rightChanged: false,
        leftChanged: false,
        pid: e.pointerId,
      };
    }

    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.startX;
      var raw = drag.dir === "next" ? -dx : dx; // positive = turning
      // only reveal the leaf once the drag clearly commits to a direction
      if (!drag.shown) {
        if (raw <= 4) return;
        clearFlipTimers();
        configLeaf(drag.dir);
        document.body.classList.add("flip-dragging");
        drag.shown = true;
      }
      var p = Math.max(0, Math.min(1, raw / drag.w));
      drag.p = p;
      paint(drag.dir, p);
      if (p >= 0.5 && !drag.previewed) {
        previewApply(drag.dir, drag.target);
        drag.previewed = true;
        if (drag.dir === "next") drag.rightChanged = true;
        else drag.leftChanged = true;
      } else if (p < 0.5 && drag.previewed) {
        previewApply(drag.dir, currentIndex);
        drag.previewed = false;
      }
      if (e.cancelable) e.preventDefault();
    }

    function settle(commit) {
      var d = drag;
      drag = null;
      document.body.classList.remove("flip-dragging");

      // a plain click (never revealed the leaf) — nothing to animate
      if (!d.shown) { resetLeaf(); return; }

      var from = d.p;
      var to = commit ? 1 : 0;
      var start = performance.now();
      var dur = 240 * Math.abs(to - from) + 70;
      var swapped = false;

      function frame(now) {
        var t = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        var p = from + (to - from) * eased;
        paint(d.dir, p);

        // swap the hidden content once the leaf is covering the far side
        if (commit && !swapped && p > 0.72) {
          setActiveTile(d.target);
          applyRight(kanji[d.target]);
          applyLeft(kanji[d.target]);
          swapped = true;
        }

        if (t < 1) { requestAnimationFrame(frame); return; }

        if (commit) {
          currentIndex = d.target;
        } else {
          // undo any preview that showed the destination
          if (d.rightChanged) applyRight(kanji[currentIndex]);
          if (d.leftChanged) applyLeft(kanji[currentIndex]);
          setActiveTile(currentIndex);
        }
        // fade the leaf away and clear the manual styles
        els.flip.style.transition = "opacity 0.16s ease";
        els.flip.style.opacity = "0";
        setTimeout(resetLeaf, 170);
      }
      requestAnimationFrame(frame);
    }

    function onUp() {
      if (!drag) return;
      settle(drag.p >= 0.4);
    }

    spread.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
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
  select(0, true);
  initDragFlip();
})();
