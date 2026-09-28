/* ===== Learn-to-write-kanji interaction ===== */
(function () {
  "use strict";

  var SIZE = 300; // desktop writing-square size (matches CSS)
  var stackedMq =
    window.matchMedia && window.matchMedia("(max-width: 820px)");
  function isStacked() {
    return !!(stackedMq && stackedMq.matches);
  }
  function writerSize() {
    if (els.grid && els.grid.clientWidth) return els.grid.clientWidth;
    return isStacked() ? 260 : SIZE;
  }
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
    grid: document.getElementById("grid"),
    brushTip: document.getElementById("brushTip"),
    now: document.getElementById("strokeNow"),
    total: document.getElementById("strokeTotal"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnPlay: document.getElementById("btnPlay"),
    btnQuiz: document.getElementById("btnQuiz"),
    btnReset: document.getElementById("btnReset"),
    assocImg: document.getElementById("assocImg"),
    assocEmoji: document.getElementById("assocEmoji"),
    flip: document.querySelector(".page-flip"),
    memMeaning: document.getElementById("memMeaning"),
    memRomaji: document.getElementById("memRomaji"),
    btnSpeak: document.getElementById("btnSpeak"),
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
  var STROKE_GAP = 360; // ms between strokes while animating a whole character
  var token = 0; // cancels in-flight animation chains
  var quizzing = false; // true while a tracing quiz is in progress

  /* ---------- brush-on-paper sound ---------- */
  var audioCtx = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (err) {}
  }

  // A short, quiet friction grain — dry ink brush on washi, varied per stroke.
  function playBrushStroke() {
    unlockAudio();
    if (!audioCtx) return;
    var ctx = audioCtx;
    var now = ctx.currentTime;
    var dur = 0.22 + Math.random() * 0.14;
    var n = Math.floor(ctx.sampleRate * dur);
    var buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var brown = 0;
    for (var i = 0; i < n; i++) {
      brown += (Math.random() * 2 - 1) * 0.02;
      brown *= 0.98;
      var t = i / n;
      // soft press, then a taper as the brush lifts
      var env = Math.pow(t, 0.28) * Math.pow(1 - t, 1.55) * 5.2;
      data[i] = brown * env;
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.85;
    var startF = 1800 + Math.random() * 900;
    var endF = 650 + Math.random() * 280;
    filter.frequency.setValueAtTime(startF, now);
    filter.frequency.exponentialRampToValueAtTime(endF, now + dur);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

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
  var flipDone = null;
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clearFlipTimers() {
    flipTimers.forEach(clearTimeout);
    flipTimers = [];
    if (flipDone && els.flip) {
      els.flip.removeEventListener("animationend", flipDone);
      flipDone = null;
    }
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
  function applyLeft(k, shouldAnimate) {
    active = k;
    total = k.strokes;
    loadWriter(k.char, shouldAnimate);
  }

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

    if (skipFlip || reduceMotion || !els.flip || isStacked()) {
      applyRight(k);
      applyLeft(k, true);
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

    flipDone = function (e) {
      if (e && e.animationName && e.animationName !== "page-turn") return;
      els.flip.classList.remove("is-flipping");
      els.flip.removeEventListener("animationend", flipDone);
      flipDone = null;
      animateAll();
    };
    els.flip.addEventListener("animationend", flipDone);
  }

  function updateMemory(k) {
    // association illustration: show the watercolor image if we have one,
    // otherwise fall back to the emoji.
    if (k.image) {
      els.assocImg.src = k.image + "?e=5";
      els.assocImg.draggable = false;
      els.assocImg.alt = "Cute illustration hiding the kanji for " + k.meaning;
      els.assocImg.hidden = false;
      els.assocEmoji.style.display = "none";
    } else {
      els.assocImg.hidden = true;
      els.assocEmoji.textContent = k.emoji;
      els.assocEmoji.style.display = "grid";
    }
    els.memMeaning.textContent = k.meaning;
    els.memRomaji.textContent = ROMAJI[k.char] || "";
    els.memOn.textContent = k.on;
    els.memKun.textContent = k.kun;
    els.memChar.textContent = k.char;
  }

  function spokenReading(k) {
    if (!k) return "";
    if (k.kun) return k.kun.split("・")[0].trim();
    if (k.on) return k.on.split("・")[0].trim();
    return k.char;
  }

  function speakKanji() {
    if (!active || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(spokenReading(active));
    u.lang = "ja-JP";
    u.rate = 0.88;
    var voices = window.speechSynthesis.getVoices();
    var ja = null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang && voices[i].lang.toLowerCase().indexOf("ja") === 0) {
        ja = voices[i];
        if (voices[i].localService) break;
      }
    }
    if (ja) u.voice = ja;
    window.speechSynthesis.speak(u);
  }

  /* ---------- Hanzi Writer setup ---------- */
  function loadWriter(char, shouldAnimate) {
    token++;
    if (writer && writer.cancelQuiz) {
      try { writer.cancelQuiz(); } catch (err) {}
    }
    setPracticing(false);
    els.target.innerHTML = "";
    current = 0;
    writer = HanziWriter.create(els.target, char, {
      width: writerSize(),
      height: writerSize(),
      padding: 14,
      showCharacter: false,
      showOutline: true,
      strokeColor: "#000000",
      outlineColor: "#cabfa0",
      drawingColor: "#a23b2d",
      strokeAnimationSpeed: speed,
      delayBetweenStrokes: STROKE_GAP,
      strokeFadeDuration: 0,
    });
    updateCounter();
    if (shouldAnimate) animateAll();
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
    playBrushStroke();
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
    var my = ++token;
    writer.hideCharacter({ duration: 0 });
    current = 0;
    updateCounter();
    var i = 0;
    (function step() {
      if (my !== token || !writer) return;
      if (i >= total) {
        current = total;
        updateCounter();
        return;
      }
      playBrushStroke();
      writer.animateStroke(i, {
        onComplete: function () {
          if (my !== token) return;
          i += 1;
          current = i;
          updateCounter();
          if (i < total) setTimeout(step, STROKE_GAP);
        },
      });
    })();
  }

  function setPracticing(on) {
    quizzing = !!on;
    if (els.grid) els.grid.classList.toggle("is-practicing", quizzing);
    if (!quizzing && els.brushTip) {
      els.brushTip.hidden = true;
    }
    if (quizzing) {
      requestAnimationFrame(sizeBrushTip);
    }
  }

  // Match the on-screen thickness of a Hanzi Writer stroke (stroke-width 200
  // in the 1024-unit character space, scaled by the SVG's CTM).
  function sizeBrushTip() {
    if (!els.brushTip || !els.grid) return;
    var path = els.target.querySelector("svg path[stroke-width]");
    var px = 22;
    if (path) {
      var ctm = path.getScreenCTM();
      var sw = parseFloat(path.getAttribute("stroke-width")) || 200;
      if (ctm) px = Math.round(sw * Math.abs(ctm.a) * 0.4);
    }
    px = Math.max(12, Math.min(px, 28));
    els.grid.style.setProperty("--brush", px + "px");
  }

  function moveBrushTip(e) {
    if (!quizzing || !els.brushTip || !els.grid) return;
    var rect = els.grid.getBoundingClientRect();
    els.brushTip.hidden = false;
    els.brushTip.style.left = e.clientX - rect.left + "px";
    els.brushTip.style.top = e.clientY - rect.top + "px";
  }

  function practice() {
    if (!writer) return;
    token++;
    current = 0;
    updateCounter();
    writer.quiz({
      showHintAfterMisses: 2,
      onComplete: function () {
        setPracticing(false);
        current = total;
        updateCounter();
      },
    });
    setPracticing(true);
  }

  function reset() {
    if (!writer) return;
    token++;
    setPracticing(false);
    if (writer.cancelQuiz) writer.cancelQuiz();
    writer.hideCharacter({ duration: 0 });
    current = 0;
    updateCounter();
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
      if (drag || isStacked()) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (els.flip.classList.contains("is-flipping")) return;
      // never hijack the controls, slider, tiles, or links
      if (e.target.closest("button, input, a, label, .controls, .stroke-nav, .picker")) return;
      // keep the writing square for tracing while practicing
      if (quizzing && e.target.closest(".genko-grid")) return;
      var dir = e.target.closest(".page-right")
        ? "next"
        : e.target.closest(".page-left")
        ? "prev"
        : null;
      if (!dir) return;
      // the watercolor is an <img>, so block the browser's native image-drag
      if (e.target.closest("img, .assoc") && e.cancelable) e.preventDefault();
      if (spread.setPointerCapture) {
        try { spread.setPointerCapture(e.pointerId); } catch (err) {}
      }
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
          animateAll();
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
    spread.addEventListener("dragstart", function (e) { e.preventDefault(); });
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
  if (els.btnSpeak) els.btnSpeak.addEventListener("click", speakKanji);
  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("keydown", unlockAudio);
  if (els.grid) {
    els.grid.addEventListener("pointerenter", moveBrushTip);
    els.grid.addEventListener("pointermove", moveBrushTip);
    els.grid.addEventListener("pointerleave", function () {
      if (els.brushTip) els.brushTip.hidden = true;
    });
  }

  buildPicker();
  select(0, true);
  initDragFlip();

  function onStackChange() {
    resetLeaf();
    clearFlipTimers();
    if (els.flip) els.flip.classList.remove("is-flipping");
    document.body.classList.remove("flip-dragging");
    if (!active) return;
    var restore = current;
    loadWriter(active.char);
    if (restore > 0) goTo(restore);
  }
  if (stackedMq) {
    if (stackedMq.addEventListener) stackedMq.addEventListener("change", onStackChange);
    else stackedMq.addListener(onStackChange);
  }
})();
