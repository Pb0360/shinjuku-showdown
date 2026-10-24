/* ==========================================================================
 * 音频系统
 * --------------------------------------------------------------------------
 * 分两层：
 *   1) 音效层 —— src/assets/audio/sfx/*.wav（已内置，程序化合成）
 *   2) 语音层 —— src/assets/audio/voice/<角色>/<技能名>_1.mp3 …
 *      · 语音永远叠加在音效之上播放
 *      · 文件不存在就静默跳过，绝不报错、绝不刷 404
 *      · 支持多条随机播（苍_1.mp3 / 苍_2.mp3 / 苍_3.mp3 …）
 *
 * 命名规范详见 docs/语音与音效命名规范.md
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});

  var SFX_DIR = 'assets/audio/sfx/';
  var VOICE_DIR = 'assets/audio/voice/';

  /* 音量校准：合成时峰值统一到 -3dBFS，但持续型音效 RMS 天然更高，
   * 这里按"听感"把响度拉齐（>1 = 放大，<1 = 压低） */
  var GAIN = {
    cast_gojo1_blue: 0.55,
    cast_gojo2: 0.55,
    cast_gojo3: 0.7,
    cast_sukuna3: 0.65,
    cast_murasaki: 0.7,
    explosion: 1.35,
    hit_generic: 1.3,
    cast_sukuna1: 1.35,
    domain_tick: 0.9,
    bgm_menu: 1.0,
    bgm_battle: 1.0
  };

  var Audio = {
    ready: false,
    unlocked: false,
    sfxVolume: 0.75,
    voiceVolume: 0.9,
    bgmVolume: 0.28,
    _el: {},        // name -> HTMLAudioElement 原型
    _missing: {},   // name -> true
    _voiceCache: {},// "char/key" -> [url…] | null
    _voiceMissing: {},
    _lastVoice: {}, // 防止同一条语音瞬间重复
    _bgm: null,
    _bgmName: null,
    _bgmUrl: null,
    _probeBgm: {},      // userBgm 名字 -> url | null | 'pending'
    _probeBgmCbs: {},
    _bgmPaused: false,
    _probeQueue: [],

    /* 用数据的 CONFIG.audio 初始化 */
    init: function (cfg) {
      cfg = cfg || (SH.CONFIG && SH.CONFIG.audio) || {};
      this.sfxVolume = cfg.sfxVolume !== undefined ? cfg.sfxVolume : 0.75;
      this.voiceVolume = cfg.voiceVolume !== undefined ? cfg.voiceVolume : 0.9;
      this.bgmVolume = cfg.bgmVolume !== undefined ? cfg.bgmVolume : 0.28;
      this.ready = true;
      this.preloadSfx();
      /* 开机就把自备 BGM 探好，免得第一局开打时先响一下内置 BGM 再切过去 */
      this.userBgmUrl(function () {});
    },

    setVolumes: function (v) {
      if (v.sfxVolume !== undefined) this.sfxVolume = v.sfxVolume;
      if (v.voiceVolume !== undefined) this.voiceVolume = v.voiceVolume;
      if (v.bgmVolume !== undefined) this.bgmVolume = v.bgmVolume;
      if (this._bgm) this._bgm.volume = this.bgmVolume;
    },

    /* 预加载内置音效（本地文件，秒加载） */
    preloadSfx: function () {
      var names = Object.keys(SH.SFX_LIST || {});
      for (var i = 0; i < names.length; i++) this._get(names[i]);
    },

    _get: function (name) {
      if (this._missing[name]) return null;
      var el = this._el[name];
      if (el) return el;
      var path = SFX_DIR + name + '.wav';
      el = new window.Audio();
      el.preload = 'auto';
      el.src = path;
      var self = this;
      el.addEventListener('error', function () {
        self._missing[name] = true;
        self._el[name] = null;
      });
      this._el[name] = el;
      return el;
    },

    /* 移动端浏览器需要用户手势后才能出声 */
    unlock: function () {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        var A = window.AudioContext || window.webkitAudioContext;
        if (A) {
          var ctx = new A();
          if (ctx.state === 'suspended') ctx.resume();
          var buf = ctx.createBuffer(1, 1, 22050);
          var src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        }
      } catch (e) { /* 忽略：只是解锁尝试 */ }

      /* 之前被自动播放策略拦下的 BGM，趁这次手势重试 */
      var bgm = this._bgm;
      if (bgm && bgm.paused) {
        try {
          var pr = bgm.play();
          if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
      }
    },

    /* 播放音效 */
    play: function (name, opts) {
      if (!this.ready) return;
      opts = opts || {};
      var proto = this._get(name);
      if (!proto) return;
      var vol = this.sfxVolume * (GAIN[name] || 1) * (opts.volume === undefined ? 1 : opts.volume);
      if (vol <= 0.001) return;
      vol = Math.min(1, vol);

      var node;
      try {
        node = proto.cloneNode();
      } catch (e) {
        node = proto;
      }
      node.volume = vol;
      node.playbackRate = opts.rate || 1;
      try {
        var pr = node.play();
        if (pr && pr.catch) pr.catch(function () { /* 自动播放被拦：忽略 */ });
      } catch (e) { /* 忽略 */ }

      /* 播完释放引用，避免节点堆积 */
      node.addEventListener('ended', function () { node.src = ''; });
    },

    /* ------------------------------------------------------------------
     * 语音层
     * ------------------------------------------------------------------ */

    /* 找出某角色某技能有哪些语音文件（首次调用时探测一次） */
    _listVoice: function (charId, key) {
      var cacheKey = charId + '/' + key;
      if (this._voiceCache[cacheKey] !== undefined) return this._voiceCache[cacheKey];

      var dir = this._voiceDirOf(charId);
      var found = null;

      /* 优先读清单文件（tools/scan_voice.js 生成），支持任意文件名 */
      var manifest = SH.VOICE_MANIFEST;
      if (manifest && manifest[dir] && manifest[dir][key]) {
        var list = manifest[dir][key];
        found = [];
        for (var m = 0; m < list.length; m++) found.push(VOICE_DIR + dir + '/' + list[m]);
      }

      if (!found) {
        /* 回退：探测 <技能>_1.mp3 … _6.mp3，以及 .wav */
        found = [];
        var exts = ['.mp3', '.wav', '.ogg', '.m4a'];
        for (var i = 1; i <= 6; i++) {
          for (var e = 0; e < exts.length; e++) {
            found.push(VOICE_DIR + dir + '/' + key + '_' + i + exts[e]);
          }
        }
      }

      this._voiceCache[cacheKey] = found.length ? found : null;
      return this._voiceCache[cacheKey];
    },

    _voiceDirOf: function (charId) {
      var ch = SH.CHARACTERS[charId];
      return (ch && ch.voiceDir) || charId;
    },

    /* 播放语音：多条随机挑一条，缺失就静默 */
    voice: function (charId, key, opts) {
      if (!this.ready || !charId || !key) return;
      opts = opts || {};
      var list = this._listVoice(charId, key);
      if (!list || !list.length) return;

      var now = (window.performance && performance.now()) ? performance.now() : Date.now();
      var lk = charId + '/' + key;
      if (this._lastVoice[lk] && now - this._lastVoice[lk] < 180) return; // 180ms 内不重复
      this._lastVoice[lk] = now;

      var url = list[Math.floor(Math.random() * list.length)];
      var a = new window.Audio();
      a.volume = Math.min(1, this.voiceVolume * (opts.volume === undefined ? 1 : opts.volume));
      a.src = url;
      a.addEventListener('error', function () {
        /* 该条不存在：从候选里剔除，下次不会再试 */
        var idx = list.indexOf(url);
        if (idx >= 0) list.splice(idx, 1);
      });
      try {
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () { /* 忽略 */ });
      } catch (e) { /* 忽略 */ }
    },

    /* ------------------------------------------------------------------
     * 背景音乐
     * 优先级：用户自备文件（assets/audio/bgm/<userBgm>.<ext>）
     *         → 找不到就回退到内置的合成 BGM（assets/audio/sfx/<name>.wav）
     * ------------------------------------------------------------------ */
    userBgmUrl: function (cb) {
      var u = (SH.CONFIG && SH.CONFIG.audio && SH.CONFIG.audio.userBgm) || null;
      if (!u) return cb(null);

      var cached = this._probeBgm[u];
      if (cached === 'pending') {
        (this._probeBgmCbs[u] = this._probeBgmCbs[u] || []).push(cb);
        return;
      }
      if (cached !== undefined) return cb(cached);

      /* 首次：按扩展名依次探测 */
      var self = this;
      this._probeBgm[u] = 'pending';
      this._probeBgmCbs[u] = [cb];
      var exts = ['mp3', 'm4a', 'mp4', 'ogg', 'wav', 'aac'];
      var i = 0;

      function next() {
        if (i >= exts.length) { self._finishBgm(u, null); return; }
        var url = 'assets/audio/bgm/' + u + '.' + exts[i++];
        var a = new window.Audio();
        var settled = false;
        var timer = null;
        function ok() { if (settled) return; settled = true; clearTimeout(timer); self._finishBgm(u, url); }
        function fail() { if (settled) return; settled = true; clearTimeout(timer); next(); }
        a.addEventListener('loadedmetadata', ok, { once: true });
        a.addEventListener('canplay', ok, { once: true });
        a.addEventListener('canplaythrough', ok, { once: true });
        a.addEventListener('error', fail, { once: true });
        /* 给足时间：慢网络 + 大文件时不能让探测过早放弃 */
        timer = setTimeout(fail, 6000);
        a.preload = 'auto';
        a.src = url;
      }
      next();
    },

    _finishBgm: function (name, url) {
      this._probeBgm[name] = url;
      var cbs = this._probeBgmCbs[name] || [];
      delete this._probeBgmCbs[name];
      for (var i = 0; i < cbs.length; i++) cbs[i](url);
    },

    bgmUrl: function () { return this._bgmUrl || null; },

    bgm: function (name) {
      if (!this.ready) return;
      if (this._bgmName === name) return;
      this._bgmName = name;

      if (!name) {
        if (this._bgm) { var o = this._bgm; this._bgm = null; this._bgmUrl = null; fadeOut(o, 500, function () { try { o.pause(); } catch (e) {} }); }
        return;
      }

      var self = this;
      var u = (SH.CONFIG && SH.CONFIG.audio && SH.CONFIG.audio.userBgm) || null;
      var cached = u ? this._probeBgm[u] : undefined;

      /* 已经知道自备音乐在哪 → 直接用 */
      if (cached && cached !== 'pending') {
        this._startBgm(cached, name);
        return;
      }

      /* 还不知道（首次 / 正在探测）→ 先放内置 BGM 保证不冷场，
       * 等自备音乐探测出来再无缝换过去（本地文件通常 0.1 秒内就换好了） */
      this._startBgm('assets/audio/sfx/' + name + '.wav', name);
      this.userBgmUrl(function (url) {
        if (!url) return;
        if (self._bgmName !== name) return;   // 期间又切歌了
        if (self._bgmUrl === url) return;     // 已经换过了
        self._startBgm(url, name);
      });
    },

    _startBgm: function (url, name) {
      var self = this;

      if (this._bgm) {
        var old = this._bgm;
        this._bgm = null;
        fadeOut(old, 600, function () { try { old.pause(); } catch (e) {} });
      }

      var node = null;
      if (url.indexOf('assets/audio/sfx/') === 0) {
        var proto = this._get(name);
        if (!proto || !proto.cloneNode) return;
        node = proto.cloneNode();
      } else {
        node = new window.Audio();
        node.src = url;
      }

      node.loop = true;
      node.volume = 0;
      this._bgm = node;
      this._bgmUrl = url;
      this._bgmPaused = false;
      try {
        var pr = node.play();
        if (pr && pr.catch) pr.catch(function () { /* 自动播放被拦：等用户手势后 unlock() 会重试 */ });
      } catch (e) {}
      fadeIn(node, this.bgmVolume, 900);
    },

    stopBgm: function () { this.bgm(null); },

    /* 暂停游戏时把音乐也停住（保留播放位置，恢复时接着放） */
    pauseBgm: function () {
      if (this._bgm && !this._bgm.paused) {
        try { this._bgm.pause(); } catch (e) {}
        this._bgmPaused = true;
      }
    },

    resumeBgm: function () {
      if (this._bgm && this._bgmPaused) {
        this._bgmPaused = false;
        try {
          var pr = this._bgm.play();
          if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
      }
    }
  };

  function fadeIn(node, target, ms) {
    var steps = Math.max(1, Math.round(ms / 50));
    var i = 0;
    var id = setInterval(function () {
      i++;
      node.volume = Math.min(1, target * (i / steps));
      if (i >= steps) clearInterval(id);
    }, 50);
  }

  function fadeOut(node, ms, done) {
    var start = node.volume;
    var steps = Math.max(1, Math.round(ms / 50));
    var i = 0;
    var id = setInterval(function () {
      i++;
      node.volume = Math.max(0, start * (1 - i / steps));
      if (i >= steps) { clearInterval(id); if (done) done(); }
    }, 50);
  }

  SH.Audio = Audio;

  /* 内置音效清单（tools/gen_sfx.py 生成，改音效后同步这里即可） */
  SH.SFX_LIST = {
    ui_click: 1, ui_hover: 1, countdown: 1, round_start: 1, victory: 1, defeat: 1,
    hit_generic: 1, hit_slash: 1, hit_heavy: 1, explosion: 1,
    bounce_wall: 1, bounce_ball: 1, hurt: 1, immune_block: 1, black_flash: 1,
    cast_gojo1_blue: 1, cast_gojo1_red: 1, cast_murasaki: 1, cast_gojo2: 1, cast_gojo3: 1,
    cast_sukuna1: 1, cast_sukuna1_grid: 1, cast_sukuna2: 1, cast_sukuna3: 1,
    domain_tick: 1,
    bgm_menu: 1, bgm_battle: 1
  };
})();
