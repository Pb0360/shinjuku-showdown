/* ==========================================================================
 * 主控制器：把逻辑层 / 表现层 / 音频层 / UI 串起来
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});

  /* 同一音效的最小重复间隔（秒），防止连击时糊成一片 */
  var SFX_GAP = {
    bounce_wall: 0.06,
    bounce_ball: 0.07,
    hit_generic: 0.05,
    hit_slash: 0.06,
    hit_heavy: 0.08,
    domain_tick: 0.11,
    hurt: 0.5
  };

  var Game = {
    match: null,
    fx: null,
    ais: [],
    loop: null,
    paused: false,
    ended: false,
    pendingResult: 0,
    lastSfx: {},
    lastHurt: 0,

    init: function () {
      var self = this;

      /* 触屏设备打标记：CSS 里用 html.touch 给 iPad / 手机做专门布局。
       * 判定条件 = 有触摸能力 **且** 主指针是粗的（手指）。
       * 只看 maxTouchPoints 会把"带触摸屏的 Windows 笔记本"也误判成平板，
       * 所以加上 (pointer: coarse) —— 那类设备主指针是鼠标，不会被误判。
       * ?touch=1 / ?touch=0 可以强制，测试用。 */
      var forceTouch = /[?&]touch=([01])/.exec(location.search);
      var canTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      var isTouch = forceTouch ? forceTouch[1] === '1' : (canTouch && coarse);
      if (isTouch) document.documentElement.classList.add('touch');

      SH.Audio.init(SH.CONFIG.audio);

/* 自定义角色：先把本地存的注册进角色表，选人界面才能列出来 */
if (SH.Custom) SH.Custom.register();
      SH.UI.init({
        on: {
          select: function () { /* 菜单/选人界面不放音乐，只有开打才放 */ },
          fight: function (p1, p2) { self.start(p1, p2); },
          menu: function () { self.stop(); },
          pause: function () { self.pauseGame(); },
          resume: function () { self.resumeGame(); },
          restart: function () { self.start(SH.UI.picks[0], SH.UI.picks[1]); },
          skill: function (i) { self.cast(i); },
          holdStart: function (slot) { self.holdStart(slot); },
          holdRelease: function (slot) { self.holdRelease(slot); }
        }
      });

      this.fx = new SH.FX({
        onCallout: function (p) { SH.UI.callout(p); }
      });

      SH.Renderer.attach(document.getElementById('arena'));

      this.loop = SH.Loop.create({
        step: function (dt) { self.step(dt); },
        render: function (dtReal) { self.render(dtReal); },
        timeScale: function () { return self.paused ? 0 : self.fx.timeScale(); }
      });

      window.addEventListener('resize', function () { SH.Renderer.resize(); });
      /* iOS / iPadOS：旋转屏幕、地址栏收放时 visualViewport 变化更及时 */
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () { SH.Renderer.resize(); });
      }
      window.addEventListener('orientationchange', function () {
        setTimeout(function () { SH.Renderer.resize(); }, 120);
        setTimeout(function () { SH.Renderer.resize(); }, 320);
        setTimeout(function () { SH.Renderer.resize(); }, 700);
      });
      /* 切后台【不暂停】：隐藏时 rAF 会停，改用一个定时器继续推进游戏 */
      var bgTimer = null;
      function startBgTimer() {
        if (bgTimer) return;
        bgTimer = setInterval(function () {
          if (self.paused || !self.match || self.match.phase !== 'fight') return;
          self.loop.backgroundTick();
        }, 250);
      }
      function stopBgTimer() {
        if (bgTimer) { clearInterval(bgTimer); bgTimer = null; }
      }
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) startBgTimer();
        else { stopBgTimer(); self.loop.resetClock(); }   // 回来时重置时钟，避免一次性补太多
      });

      this.bindKeys();
      SH.UI.show('screen-menu');
      /* 主菜单不放音乐：只有真正开打之后才播 BGM */

      /* PWA：只有通过 http(s) 打开时才注册 Service Worker（file:// 下不允许） */
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
      }
    },

    /* ------------------------------------------------------------------ */
    pauseGame: function () {
      this.paused = true;
      SH.Audio.pauseBgm();
    },

    resumeGame: function () {
      this.paused = false;
      this.holdSlot = -1;
      this.holdT = 0;
      this.loop.resetClock();
      SH.Audio.resumeBgm();
    },

    /* ------------------------------------------------------------------ */
    bindKeys: function () {
      var self = this;
      window.addEventListener('keydown', function (e) {
        var k = e.key.toLowerCase();

        if (k === 'escape') {
          /* ESC：优先关掉最上层弹窗；关掉的如果是暂停面板，就同时继续游戏 */
          var top = SH.UI.topModal();
          if (top) {
            SH.UI.closeModal(top);
            if (top === 'modal-pause') self.resumeGame();
            return;
          }
          if (self.match && self.match.phase === 'fight' && !self.paused) {
            SH.UI.openModal('modal-pause');
            self.pauseGame();
          }
          return;
        }
        if (k === 'r' && self.match) { self.start(SH.UI.picks[0], SH.UI.picks[1]); return; }
        if (k === 'f') {
          var d = document;
          if (!d.fullscreenElement && d.documentElement.requestFullscreen) d.documentElement.requestFullscreen();
          else if (d.exitFullscreen) d.exitFullscreen();
          return;
        }
        if (k === ' ' || k === 'enter') {
          if (SH.UI.el['screen-menu'].classList.contains('active')) { SH.UI.handleAction('select'); e.preventDefault(); }
          return;
        }
        if (self.paused || !self.match) return;

        /* 键位对应「技能槽位」而不是数组下标：
         * 虎杖只有 1 / 2 槽，所以是 Q 和 W（没有 E），不会错位 */
        var slot = -1;
        if (k === 'q' || k === '1') slot = 1;
        else if (k === 'w' || k === '2') slot = 2;
        else if (k === 'e' || k === '3') slot = 3;
        if (slot > 0) { e.preventDefault(); if (e.repeat) return; self.holdStart(slot); }
      });

      /* 键盘松手也算松手（长按技能需要） */
      window.addEventListener('keyup', function (e) {
        var k = e.key.toLowerCase();
        var s2 = -1;
        if (k === 'q' || k === '1') s2 = 1;
        else if (k === 'w' || k === '2') s2 = 2;
        else if (k === 'e' || k === '3') s2 = 3;
        if (s2 > 0) self.holdRelease(s2);
      });
    },

    /* 按槽位释放技能（键鼠用） */
    castSlot: function (slot) {
      if (!this.match) return;
      var b = this.match.balls[0];
      for (var i = 0; i < b.skills.length; i++) {
        if ((b.skills[i].data.slot || (i + 1)) === slot) { this.cast(i); return; }
      }
    },

    cast: function (i, charged) {
      if (!this.match || this.paused || this.match.phase !== 'fight') return;
      this.match.castSkill(this.match.balls[0], i, charged ? { charged: true } : undefined);
    },

    /* ------------------------------------------------------------------
     * 长按技能
     *   规则（用户指定）：按下后 threshold 秒内松手 → 立刻放普通版；
     *   按住到 threshold 那一刻 → 立刻放强化版，之后松不松手都不影响。
     *   所以任何一次按压都会在 threshold 内出招，不会有黏滞感。
     * ------------------------------------------------------------------ */
    skillIndexBySlot: function (slot) {
      if (!this.match) return -1;
      var b = this.match.balls[0];
      for (var i = 0; i < b.skills.length; i++) {
        if ((b.skills[i].data.slot || (i + 1)) === slot) return i;
      }
      return -1;
    },

    holdStart: function (slot) {
      if (!this.match || this.paused || this.match.phase !== 'fight') return;
      var idx = this.skillIndexBySlot(slot);
      if (idx < 0) return;
      var data = this.match.balls[0].skills[idx].data;
      if (!data.hold) { this.cast(idx); return; }   // 普通技能：按下即发
      this.holdSlot = slot;
      this.holdT = 0;
      this.setCharging(slot, true);
    },

    holdRelease: function (slot) {
      if (this.holdSlot !== slot) return;
      var idx = this.skillIndexBySlot(slot);
      var thr = this.holdThreshold(idx);
      if (this.holdT < thr && idx >= 0) this.cast(idx);   // 没到阈值 → 普通版
      this.clearHold();
    },

    holdThreshold: function (idx) {
      if (!this.match || idx < 0) return 0.2;
      var d = this.match.balls[0].skills[idx].data;
      return (d.hold && d.hold.threshold) || 0.2;
    },

    clearHold: function () {
      if (this.holdSlot >= 0) this.setCharging(this.holdSlot, false);
      this.holdSlot = -1;
      this.holdT = 0;
    },

    setCharging: function (slot, on) {
      if (!SH.UI.skillNodes) return;
      for (var i = 0; i < SH.UI.skillNodes.length; i++) {
        var n = SH.UI.skillNodes[i];
        if (n.slot === slot) n.node.classList.toggle('charging', !!on);
      }
    },

    updateHold: function (dt) {
      if (this.holdSlot < 0) return;
      this.holdT += dt;
      var idx = this.skillIndexBySlot(this.holdSlot);
      if (idx < 0) { this.clearHold(); return; }
      if (this.holdT >= this.holdThreshold(idx)) {
        var slot = this.holdSlot;
        this.setCharging(slot, false);
        this.holdSlot = -1;
        this.cast(idx, true);      // 强化版：到点立刻放，不等松手
      }
    },

    /* ------------------------------------------------------------------ */
    start: function (p1, p2) {
      this.stop();
      SH.UI.closeAllModals();
      this.paused = false;
      this.ended = false;
      this.pendingResult = 0;
      this.lastSfx = {};
      this.lastHurt = 0;

      this.match = new SH.Match({ p1: p1 || 'gojo', p2: p2 || 'sukuna' });
      this.ais = [null, new SH.AI(this.match, 1)];  // 球 0 是玩家，球 1 是 AI
      this.fx.reset();

      SH.UI.show('screen-battle');
      SH.UI.buildBattle(this.match);
      SH.Renderer.resize();

      /* 音乐等倒计时结束、真正开打那一刻才起（见 soundFor 的 'start'） */
      SH.Audio.stopBgm();
      this.loop.resetClock();
      this.loop.start();

      var self = this;
      SH.UI.toast('Q / W / E 释放技能 · 球无法操控移动，只能靠技能', 2600);
    },

    stop: function () {
      if (this.loop) this.loop.stop();
      this.match = null;
      this.ais = [];
      SH.Audio.stopBgm();
    },

    /* ------------------------------------------------------------------ */
    step: function (dt) {
      if (!this.match || this.paused) return;
      var m = this.match;

      /* 两阶段 AI：先都判断，再统一释放 */
      this.updateHold(dt);
      /* 两阶段 AI：都判断 → 统一校验 → 都出手（见 Match.stepAI） */
      m.stepAI(this.ais, dt);

      m.step(dt);
      this.handleEvents(m.drainEvents());
      SH.UI.updateBattle(m);

      if (m.phase === 'over' && !this.ended) {
        this.ended = true;
        this.pendingResult = 1.8;  // 让死亡演出播完再弹结算
      }
      if (this.pendingResult > 0) {
        this.pendingResult -= dt;
        if (this.pendingResult <= 0) this.finish();
      }
    },

    render: function (dtReal) {
      if (!this.match) return;
      this.fx.update(dtReal);
      SH.Renderer.draw(this.match, this.fx);
    },

    /* ------------------------------------------------------------------
     * 事件 → 音效 / 特效
     * ------------------------------------------------------------------ */
    handleEvents: function (events) {
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        this.fx.onEvent(ev, this.match);
        this.soundFor(ev);
      }
    },

    _gap: function (name) {
      var g = SFX_GAP[name] || 0;
      if (g <= 0) return true;
      var now = (window.performance && performance.now()) ? performance.now() / 1000 : Date.now() / 1000;
      if (this.lastSfx[name] && now - this.lastSfx[name] < g) return false;
      this.lastSfx[name] = now;
      return true;
    },

    soundFor: function (ev) {
      var A = SH.Audio;
      switch (ev.type) {
        case 'cast': {
          var id = ev.skillId, move = ev.move;
          var name = null;
          if (id === 'gojo1') name = (move === 'red') ? 'cast_gojo1_red' : 'cast_gojo1_blue';
          else if (id === 'gojo2') name = 'cast_gojo2';
          else if (id === 'gojo3') name = 'cast_gojo3';
          else if (id === 'sukuna1') name = (move === 'grid') ? 'cast_sukuna1_grid' : 'cast_sukuna1';
          else if (id === 'sukuna2') name = 'cast_sukuna2';
          else if (id === 'sukuna3') name = 'cast_sukuna3';
          if (ev.fused) name = 'cast_murasaki';
          if (name) A.play(name);
          A.voice(ev.ball.char.id, ev.voiceKey || ev.title);
          break;
        }

        case 'damage':
          if (ev.domain) break;               // 领域逐跳伤害太密，靠释放音效覆盖
          if (ev.burn) { if (this._gap('hit_generic')) A.play('hit_generic', { volume: 0.3 }); break; }
          if (ev.amount >= 30) { if (this._gap('hit_heavy')) A.play('hit_heavy'); }
          else if (ev.skillId === 'slash' || ev.skillId === 'grid') { if (this._gap('hit_slash')) A.play('hit_slash'); }
          else if (this._gap('hit_generic')) A.play('hit_generic');
          /* 玩家挨重击时补一声闷响 + 受击语音 */
          if (ev.target.id === 0 && ev.amount >= 20) {
            var now = (window.performance && performance.now()) ? performance.now() / 1000 : Date.now() / 1000;
            if (now - this.lastHurt > 0.5) {
              this.lastHurt = now;
              A.play('hurt');
              A.voice(ev.target.char.id, '受击');
            }
          }
          break;

        case 'explode': A.play('explosion'); break;
        case 'blackflash':
          A.play('black_flash');
          A.voice(ev.ball.char.id, '黑闪');
          break;
        case 'immune': A.play('immune_block', { volume: ev.big ? 1 : 0.6 }); break;
        case 'reflect': if (this._gap('hit_generic')) A.play('immune_block', { volume: 0.45 }); break;
        case 'ballhit': if (this._gap('bounce_ball')) A.play('bounce_ball', { volume: 0.8 }); break;
        case 'wall':
          if (ev.speed > 100 && this._gap('bounce_wall')) A.play('bounce_wall', { volume: Math.min(0.85, ev.speed / 700) });
          break;
        case 'pbounce': if (this._gap('bounce_wall')) A.play('bounce_wall', { volume: 0.35 }); break;
        case 'fieldtick':
          if (ev.hit && ev.field.kind === 'sukuna3' && this._gap('domain_tick')) {
            A.play('domain_tick', { rate: 0.94 + Math.random() * 0.12, volume: 0.75 });
          }
          break;
        case 'countdown': A.play('countdown'); break;
        case 'start':
          A.play('round_start');
          A.bgm('bgm_battle');       // 真正开打才起音乐
          break;
        case 'end':
          A.stopBgm();               // 打完就停，结算界面不放歌
          A.play(ev.winner === 0 ? 'victory' : 'defeat');
          A.voice(ev.winner === 0 ? this.match.balls[0].char.id : this.match.balls[1].char.id,
            ev.winner === 0 ? '胜利' : '失败');
          break;
        default: break;
      }
    },

    /* ------------------------------------------------------------------ */
    finish: function () {
      var m = this.match;
      var sum = m.summary();
      var self = this;
      this.loop.stop();

      SH.UI.showResult(sum,
        function () { self.start(SH.UI.picks[0], SH.UI.picks[1]); },
        function () { self.stop(); SH.UI.show('screen-select'); SH.Audio.bgm('bgm_menu'); },
        function () { self.stop(); SH.UI.show('screen-menu'); SH.Audio.bgm('bgm_menu'); }
      );
    }
  };

  SH.Game = Game;

  var booted = false;
  function boot() { if (booted) return; booted = true; Game.init(); }
  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
