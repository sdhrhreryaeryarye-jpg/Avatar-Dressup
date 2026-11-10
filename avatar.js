/* Аватар: слои, идл, речь, капс, прыжок, эмоции.
   Зависит от window.CATALOG (catalog.js) и window.EMOTIONS (emotions.js).

   const av = AvatarKit.create(контейнер, { smooth: false });
   av.setProfile({ base:"base_female", eyes:"eyes_blue", hair:"", outfit:"", hat:"", acc:"" });
   av.react("ПРИВЕТ ВСЕМ!", { emotes: ["Kappa"] });   // запустить реакцию на сообщение
   AvatarKit.analyze(текст, эмоуты)                   // только разбор текста, без анимации
*/
(function (global) {
  "use strict";
  var C = null, E = null, live = [], rafId = 0;
  var FACE_KINDS = ["eyex", "brow", "mouth"];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm(s) { return String(s).toLowerCase().replace(/ё/g, "е"); }
  var HAS_ALNUM = /[\p{L}\p{N}]/u;

  /* ---------- разбор сообщения ---------- */
  var prepared = null;
  function prepare() {
    prepared = {};
    Object.keys(E.words).forEach(function (emo) { prepared[emo] = E.words[emo].map(parseWord); });
    prepared._love = (E.love || []).map(parseWord);
  }
  function parseWord(w) {
    var prefix = w.charAt(w.length - 1) === "*";
    var n = norm(prefix ? w.slice(0, -1) : w);
    var kind = !HAS_ALNUM.test(n) ? "sym" : (n.indexOf(" ") >= 0 ? "phrase" : "word");
    return { n: n, prefix: prefix, kind: kind, weight: (kind === "sym" && n.indexOf("?") >= 0 && n.indexOf("!") >= 0) ? 2 : 1 };
  }
  function countMatches(list, raw, tokens, padded) {
    var score = 0;
    list.forEach(function (w) {
      if (w.kind === "sym") { if (raw.indexOf(w.n) >= 0) score += w.weight; }
      else if (w.kind === "phrase") { if (padded.indexOf(" " + w.n + " ") >= 0) score += 1; }
      else {
        var hits = 0;
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          if (t === w.n || (w.prefix && t.indexOf(w.n) === 0)) hits++;
        }
        score += Math.min(hits, 2);
      }
    });
    return score;
  }

  function analyze(text, emotes) {
    if (!prepared) prepare();
    var t = String(text || "");
    t = t.replace(/https?:\/\/\S+/gi, " ").replace(/\bwww\.\S+/gi, " ")
         .replace(/@[\p{L}\p{N}_]+/gu, " ").replace(/\p{Extended_Pictographic}️?/gu, " ");
    var ex = emotes || [];
    var clean = t.split(/\s+/).filter(function (x) { return x && ex.indexOf(x) < 0; }).join(" ");
    var len = clean.replace(/\s/g, "").length;
    if (!len) return { skip: true, len: 0 };

    var letters = (clean.match(/\p{L}/gu) || []).length;
    var upper = (clean.match(/\p{Lu}/gu) || []).length;
    var caps = letters >= E.caps.minLetters && upper / letters >= E.caps.ratio;
    var bangs = (clean.match(/!/g) || []).length;

    var raw = norm(clean);
    var tokens = raw.match(/[\p{L}\p{N}]+/gu) || [];
    var padded = " " + tokens.join(" ") + " ";

    var scores = {}, best = "neutral", bestScore = 0;
    E.priority.forEach(function (emo) {
      var s = countMatches(prepared[emo] || [], raw, tokens, padded);
      scores[emo] = s;
      if (s > bestScore) { bestScore = s; best = emo; }
    });
    var love = countMatches(prepared._love, raw, tokens, padded) > 0;
    var T = E.timing;
    var intensity = Math.min(2, 0.8 + 0.3 * bestScore + (caps ? 0.4 : 0) + Math.min(0.3, 0.1 * Math.max(0, bangs - 1)));
    return {
      skip: false, len: len, caps: caps, bang: bangs > 0, bangs: bangs,
      emotion: best, score: bestScore, scores: scores, love: love, intensity: intensity,
      duration: clamp(T.baseDur + T.perChar * len, T.minDur, T.maxDur)
    };
  }

  /* ---------- аватар ---------- */
  function mk(tag, css) { var e = document.createElement(tag); e.style.cssText = css || ""; return e; }
  var FILL = "position:absolute;left:0;top:0;width:100%;height:100%;";

  function Avatar(container, opts) {
    this.opts = opts || {};
    this.items = {};
    var self = this;
    C.slots.forEach(function (s) { (C.items[s.id] || []).forEach(function (it) { self.items[it.id] = it; }); });
    this.userSlots = C.slots.map(function (s) { return s.id; });
    this.eyeY = ((C.face && C.face.params && C.face.params.eyeY) || 0.42) * 100;

    this.root = mk("div", "position:relative;width:100%;height:100%;overflow:visible;");
    this.body = mk("div", FILL + "transform-origin:50% 100%;");
    this.root.appendChild(this.body);
    container.appendChild(this.root);

    this.layers = {};
    this.profile = {}; this.baseKey = ""; this.hid = {};
    this.reaction = null; this.mouthOpen = false; this.nextTalk = 0;
    this.nextBlink = performance.now() / 1000 + rand(1.5, 4); this.blinkStart = -9;
    this.gazeNow = 0; this.gazeTarget = 0; this.nextGaze = 0;
    this.last = performance.now() / 1000; this.frames = 0; this.size = 256;
    this.lastFilter = ""; this.lastBody = "";

    C.order.forEach(function (name) { self.buildLayer(name); });
    live.push(this);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  var proto = Avatar.prototype;

  proto.imgStyle = function () {
    return "position:absolute;left:0;top:0;width:100%;height:100%;user-select:none;-webkit-user-drag:none;pointer-events:none;" +
           (this.opts.smooth ? "" : "image-rendering:pixelated;");
  };

  proto.faceKeys = function (prefix) {
    var a = (C.face && C.face.assets) || {};
    return Object.keys(a).filter(function (k) { return k.indexOf(prefix + "_") === 0; });
  };

  proto.buildLayer = function (name) {
    var self = this;
    var L = { name: name, div: mk("div", FILL), variants: {}, cur: null };
    this.layers[name] = L;
    this.body.appendChild(L.div);
    if (this.userSlots.indexOf(name) >= 0) {
      L.user = true;
      L.img = mk("img", this.imgStyle()); L.img.alt = ""; L.img.style.visibility = "hidden";
      L.img.onload = function () { L.ok = true; }; L.img.onerror = function () { L.ok = false; };
      L.div.appendChild(L.img);
    } else if (name === "fx") {
      L.fx = true;
      this.faceKeys("fx").forEach(function (key) {
        var d = mk("div", FILL + "visibility:hidden;transform-origin:" + ((E.fxOrigin && E.fxOrigin[key.slice(3)]) || "50% 50%") + ";");
        var img = mk("img", self.imgStyle()); img.alt = "";
        d.appendChild(img); L.div.appendChild(d);
        L.variants[key.slice(3)] = { key: key, div: d, img: img, shown: false };
      });
    } else if (FACE_KINDS.indexOf(name) >= 0) {
      this.faceKeys(name).forEach(function (key) {
        var img = mk("img", self.imgStyle()); img.alt = ""; img.style.visibility = "hidden";
        L.div.appendChild(img);
        L.variants[key.slice(name.length + 1)] = { key: key, img: img };
      });
    }
    L.div.style.transformOrigin = "50% " + this.eyeY + "%";
  };

  proto.faceFile = function (key) {
    var a = C.face.assets[key]; if (!a) return null;
    return (a.per && a.per[this.baseKey]) || a.file || null;
  };

  proto.setProfile = function (p) {
    var self = this, v = "?v=" + C.version;
    this.profile = p || {};
    this.baseKey = String(this.profile.base || "").replace(/^base_/, "");
    this.hid = {};
    this.userSlots.forEach(function (s) {
      ((C.hides || {})[self.profile[s]] || []).forEach(function (h) { self.hid[h] = 1; });
    });
    Object.keys(this.layers).forEach(function (name) {
      var L = self.layers[name];
      if (L.user) {
        var it = self.items[self.profile[name]];
        if (!it) { L.has = false; L.img.style.visibility = "hidden"; L.div.style.display = "none"; return; }
        var s = it.scale || 1, dx = it.dx || 0, dy = it.dy || 0;
        L.img.style.width = L.img.style.height = (s * 100) + "%";
        L.img.style.left = (((1 - s) / 2 + dx) * 100) + "%";
        L.img.style.top = (((1 - s) / 2 + dy) * 100) + "%";
        if (L.src !== it.file) { L.src = it.file; L.img.src = it.file + v; }
        L.has = true; L.img.style.visibility = "visible";
        L.div.style.display = self.hid[name] ? "none" : "block";
      } else {
        Object.keys(L.variants).forEach(function (k) {
          var vr = L.variants[k], f = self.faceFile(vr.key);
          vr.file = f;
          if (f && vr.src !== f) { vr.src = f; vr.img.src = f + v; }
          if (!f) { vr.src = null; vr.img.removeAttribute("src"); }
        });
      }
    });
  };

  proto.hasVariant = function (layer, name) {
    var L = this.layers[layer], vr = L && L.variants[name];
    return !!(vr && vr.file && vr.img.complete && vr.img.naturalWidth > 0);
  };

  // показывает первый существующий вариант из списка; возвращает его имя или null
  proto.setVariant = function (layer, names) {
    var L = this.layers[layer]; if (!L) return null;
    var pick = null;
    for (var i = 0; i < names.length; i++) {
      if (names[i] && this.hasVariant(layer, names[i])) { pick = names[i]; break; }
    }
    if (L.cur !== pick) {
      Object.keys(L.variants).forEach(function (k) { L.variants[k].img.style.visibility = (k === pick) ? "visible" : "hidden"; });
      L.cur = pick;
    }
    return pick;
  };

  proto.react = function (text, o) {
    o = o || {};
    var a = (typeof text === "object" && text) ? text : analyze(text, o.emotes);
    if (a.skip) return a;
    if (o.emotion) a.emotion = o.emotion;
    a.start = performance.now() / 1000;
    this.reaction = a;
    this.nextTalk = 0;
    return a;
  };

  /* ---------- кадр анимации ---------- */
  proto.frame = function (now) {
    var T = E.timing, r = this.reaction, dt = clamp(now - this.last, 0, 0.1);
    this.last = now;
    if (++this.frames % 60 === 1) this.size = this.root.offsetWidth || 256;

    var active = false, holding = false, k = 0, j = 0, I = 1, end = 0;
    if (r) {
      end = r.start + r.duration; j = now - r.start;
      if (now < end) { active = true; holding = true; k = 1; }
      else if (now < end + T.tail) { holding = true; k = (end + T.tail - now) / T.tail; }
      else { this.reaction = r = null; }
    }
    var name = r ? r.emotion : "neutral";
    var emo = E.emotions[name] || E.emotions.neutral;
    if (r) I = r.intensity;

    /* рот */
    if (active) {
      if (now >= this.nextTalk) { this.mouthOpen = !this.mouthOpen; this.nextTalk = now + rand(T.talkMin, T.talkMax) * (emo.talkSlow || 1); }
    } else this.mouthOpen = false;
    var mouthWant = ["closed"];
    if (holding) {
      if (active) mouthWant = this.mouthOpen ? (r.caps ? [E.loudMouth, emo.mouthB, "open", "closed"] : [emo.mouthB, "open", "closed"]) : [emo.mouthA, emo.mouthIdle, "closed"];
      else mouthWant = [emo.mouthIdle, "closed"];
    }
    this.setVariant("mouth", mouthWant);
    this.setVariant("brow", [holding ? emo.brow : "neutral", "neutral"]);

    /* глаза */
    var exWant = [];
    if (holding) {
      if (active && r.caps && name !== "poker" && name !== "surprise") exWant.push("squeeze");
      if (emo.eyex) exWant.push(emo.eyex);
    }
    var exShown = this.setVariant("eyex", exWant);
    var eyesL = this.layers.eyes, exL = this.layers.eyex;

    var blink = 1;
    if (!(holding && emo.noBlink) && !exShown) {
      if (now >= this.nextBlink) { this.blinkStart = now; this.nextBlink = now + rand(2, 6); }
      var q = (now - this.blinkStart) / 0.14;
      if (q >= 0 && q < 1) blink = 1 - 0.92 * Math.sin(Math.PI * q);
    }
    var gx;
    if (holding && emo.gaze === "away") gx = -0.04 * k + Math.sin(now * 5) * 0.012;
    else {
      if (now >= this.nextGaze) { this.nextGaze = now + rand(1.5, 4.5); this.gazeTarget = Math.random() < 0.5 ? 0 : rand(-0.025, 0.025); }
      this.gazeNow += (this.gazeTarget - this.gazeNow) * Math.min(1, dt * 6);
      gx = this.gazeNow;
    }
    var es = 1, lid = 1;
    if (holding && emo.eyeScale) es = 1 + (emo.eyeScale - 1) * k;
    if (holding && emo.lid && !exShown) lid = 1 - (1 - emo.lid) * k;
    if (eyesL) {
      eyesL.div.style.display = (exShown || this.hid.eyes || !eyesL.has) ? "none" : "block";
      eyesL.div.style.transform = "translate(" + (gx * 100).toFixed(2) + "%,0) scale(" + es.toFixed(3) + "," + (es * blink * lid).toFixed(3) + ")";
    }
    if (exL) exL.div.style.transform = "translate(" + (gx * 100).toFixed(2) + "%,0) scale(" + es.toFixed(3) + ")";

    /* тело */
    var bx = 0, by = 0, rot = 0, sx = 1, sy = 1;
    var br = Math.sin(now * 1.7);
    by += br * 0.004; sy *= 1 + br * 0.006;

    if (r && active && r.caps) {
      var env = clamp((end - now) / 0.2, 0, 1);
      bx += Math.sin(now * 55) * 0.022 * I * env;
      rot += Math.sin(now * 43) * 3.5 * I * env;
    }
    if (r && r.bang && j < 0.75) {
      var tt = j / 0.75;
      by -= 0.12 * (0.8 + 0.4 * I) * Math.abs(Math.sin(2 * Math.PI * tt)) * (1 - tt);
    }
    if (holding) {
      if (name === "joy") by -= 0.012 * I * Math.abs(Math.sin(now * 8)) * k;
      else if (name === "anger") { bx += Math.sin(now * 70) * 0.007 * I * k; var p = 1 + 0.025 * Math.sin(now * 16) * k; sx *= p; sy *= p; }
      else if (name === "sadness") { rot += (3.2 + Math.sin(now * 1.5)) * k; by += 0.025 * k; }
      else if (name === "embarrassed") { rot += Math.sin(now * 7) * 1.8 * k; bx += Math.sin(now * 3.5) * 0.006 * k; }
      else if (name === "surprise" && j < 0.4) {
        var ps = Math.sin(Math.PI * j / 0.4);
        sx *= 1 + 0.16 * I * ps; sy *= 1 + 0.16 * I * ps; rot -= 4 * ps;
      }
    }
    var bt = "translate(" + (bx * 100).toFixed(2) + "%," + (by * 100).toFixed(2) + "%) rotate(" + rot.toFixed(2) + "deg) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")";
    if (bt !== this.lastBody) { this.body.style.transform = bt; this.lastBody = bt; }

    /* свечение */
    var filter = "";
    if (holding && emo.aura) {
      var au = emo.aura, pulse = au.pulse ? (0.65 + 0.35 * Math.sin(now * au.pulse)) : 1;
      var col = "rgba(" + au.c[0] + "," + au.c[1] + "," + au.c[2] + "," + (au.a * pulse * k).toFixed(2) + ")";
      var px = Math.max(3, this.size * 0.035).toFixed(1);
      filter = (au.extra ? au.extra + " " : "") + "drop-shadow(0 0 " + px + "px " + col + ") drop-shadow(0 0 " + px + "px " + col + ")";
    }
    if (filter !== this.lastFilter) { this.body.style.filter = filter; this.lastFilter = filter; }

    /* эффекты */
    var fxL = this.layers.fx;
    if (fxL) {
      var want = holding ? (emo.fx || []).concat(r.love ? ["heart"] : []) : [];
      var appear = r ? clamp(j / 0.15, 0, 1) : 0, a = appear * k;
      Object.keys(fxL.variants).forEach(function (n) {
        var vr = fxL.variants[n], on = want.indexOf(n) >= 0 && vr.file && vr.img.complete && vr.img.naturalWidth > 0;
        if (!on) { if (vr.shown) { vr.div.style.visibility = "hidden"; vr.shown = false; } return; }
        var tr = "", op = a, ph = (now * 0.55) % 1;
        if (n === "sparkle") { tr = "scale(" + (1 + 0.12 * Math.sin(now * 9)).toFixed(3) + ")"; op *= 0.75 + 0.25 * Math.sin(now * 13); }
        else if (n === "vein") tr = "scale(" + (1 + 0.2 * Math.abs(Math.sin(now * 10))).toFixed(3) + ")";
        else if (n === "tears") { tr = "translateY(" + (ph * 4).toFixed(2) + "%)"; op *= 0.7 + 0.3 * (1 - ph); }
        else if (n === "gloom") op *= 0.7 + 0.3 * Math.sin(now * 3);
        else if (n === "blush") op *= 0.85 + 0.15 * Math.sin(now * 4);
        else if (n === "sweat") { tr = "translateY(" + (ph * 6).toFixed(2) + "%)"; op *= 1 - ph * ph * ph; }
        else if (n === "excl") { var pp = clamp(j / 0.25, 0, 1); tr = "scale(" + (pp < 1 ? pp * 1.25 : 1 + 0.05 * Math.sin(now * 12)).toFixed(3) + ")"; }
        else if (n === "heart") { tr = "translateY(" + (-ph * 5).toFixed(2) + "%)"; op *= 1 - ph * ph; }
        vr.div.style.transform = tr; vr.div.style.opacity = op.toFixed(2);
        if (!vr.shown) { vr.div.style.visibility = "visible"; vr.shown = true; }
      });
    }
  };

  proto.destroy = function () {
    var i = live.indexOf(this); if (i >= 0) live.splice(i, 1);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  function loop() {
    var now = performance.now() / 1000;
    for (var i = 0; i < live.length; i++) live[i].frame(now);
    rafId = live.length ? requestAnimationFrame(loop) : 0;
  }

  global.AvatarKit = {
    init: function (catalog, emotions) { C = catalog; E = emotions; prepared = null; },
    create: function (container, opts) { return new Avatar(container, opts); },
    analyze: analyze,
    labels: function () { return E.labels; }
  };
})(window);
