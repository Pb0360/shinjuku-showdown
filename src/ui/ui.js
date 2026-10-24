/* ==========================================================================
 * UI 层：界面切换 / 角色选择 / 技能说明 / 战斗 HUD / 结算 / 设置
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});

  var SETTINGS_KEY = 'shinjuku.settings.v1';

  var DEFAULT_SETTINGS = {
    sfx: 0.75,
    voice: 0.9,
    bgm: 0.28,
    numbers: true,
    shake: 1.0,
    callout: true,
  };

  var UI = {
    settings: null,
    on: {},
    el: {},
    picks: ['gojo', 'sukuna'],
    player: null,      // 玩家球的 char 数据
    skillNodes: [],
    hpNodes: [],
    lastReady: [-1, -1, -1],
    calloutLock: 0,

    /* ------------------------------------------------------------------ */
    init: function (opts) {
      this.on = (opts && opts.on) || {};
      this.settings = this.loadSettings();
      this.cacheEls();
      this.bindGlobal();
      this.buildSelect();
      this.applySettings();

      var v = document.getElementById('version-label');
      if (v) v.textContent = 'v' + (SH.VERSION || '0.1.0') + ' · 数值可在 src/data/characters.js 里调整';
    },

    cacheEls: function () {
      var ids = ['screen-menu', 'screen-select', 'screen-battle', 'screen-result',
        'sel-body', 'skillbar', 'hp0', 'hp1', 'clock', 'callout', 'toast', 'bind-badge',
        'modal-skill', 'modal-settings', 'modal-pause', 'modal-help',
        'skill-modal-name', 'skill-modal-body', 'result-inner'];
      for (var i = 0; i < ids.length; i++) this.el[ids[i]] = document.getElementById(ids[i]);
    },

    /* ------------------------------------------------------------------ */
    bindGlobal: function () {
      var self = this;

      document.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-act],[data-close]') : null;
        if (!t) return;

        var close = t.getAttribute('data-close');
        if (close) { self.closeModal(close); SH.Audio.play('ui_click'); return; }

        var act = t.getAttribute('data-act');
        if (!act) return;
        SH.Audio.play('ui_click');
        self.handleAction(act);
      });

      document.addEventListener('pointerdown', function () { SH.Audio.unlock(); }, { once: true });

      /* 设置项 */
      var bind = function (id, key, transform) {
        var n = document.getElementById(id);
        if (!n) return;
        n.addEventListener('input', function () {
          self.settings[key] = transform ? transform(n) : (n.type === 'checkbox' ? n.checked : parseFloat(n.value));
          self.saveSettings();
          self.applySettings();
        });
      };
      bind('opt-sfx', 'sfx');
      bind('opt-voice', 'voice');
      bind('opt-bgm', 'bgm');
      bind('opt-numbers', 'numbers');
      bind('opt-shake', 'shake');
      bind('opt-callout', 'callout');

      var rs = document.getElementById('opt-reset');
      if (rs) rs.addEventListener('click', function () {
        self.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        self.saveSettings(); self.applySettings(); self.syncSettingsUI();
        SH.Audio.play('ui_click');
      });
    },

    handleAction: function (act) {
      switch (act) {
        case 'select': this.show('screen-select'); this.on.select && this.on.select(); break;
        case 'menu':
          this.closeAllModals();
          this.show('screen-menu');
          this.on.menu && this.on.menu();
          break;
        case 'fight': this.on.fight && this.on.fight(this.picks[0], this.picks[1]); break;
        case 'pause': this.openModal('modal-pause'); this.on.pause && this.on.pause(); break;
        case 'resume': this.closeAllModals(); this.on.resume && this.on.resume(); break;
        case 'restart': this.closeAllModals(); this.on.restart && this.on.restart(); break;
        case 'settings': this.openModal('modal-settings'); break;
        case 'help': this.openModal('modal-help'); break;
        default: break;
      }
    },

    show: function (id) {
      var list = ['screen-menu', 'screen-select', 'screen-battle', 'screen-result'];
      for (var i = 0; i < list.length; i++) {
        var n = this.el[list[i]];
        if (n) n.classList.toggle('active', list[i] === id);
      }
    },

    /* 弹窗做成"互斥 + 栈"：
     * 打开设置会把暂停收起来，关掉设置后暂停自动回来 —— 不会再叠在一起 */
    modalStack: [],

    openModal: function (id) {
      var n = document.getElementById(id);
      if (!n) return;
      /* 把其它弹窗收起来（不压栈，等关掉当前这个再恢复） */
      var all = document.querySelectorAll('.modal');
      for (var i = 0; i < all.length; i++) {
        if (all[i] !== n) all[i].classList.remove('show');
      }
      if (!n.classList.contains('show')) {
        if (this.modalStack.indexOf(id) < 0) this.modalStack.push(id);
        n.classList.add('show');
      }
    },

    closeModal: function (id) {
      var n = document.getElementById(id);
      if (n) n.classList.remove('show');
      var idx = this.modalStack.indexOf(id);
      if (idx >= 0) this.modalStack.splice(idx, 1);
      /* 恢复栈顶那个 */
      var prev = this.modalStack[this.modalStack.length - 1];
      if (prev) {
        var p = document.getElementById(prev);
        if (p) p.classList.add('show');
      }
    },

    topModal: function () {
      return this.modalStack.length ? this.modalStack[this.modalStack.length - 1] : null;
    },

    isModalOpen: function (id) {
      var n = document.getElementById(id);
      return !!(n && n.classList.contains('show'));
    },

    closeAllModals: function () {
      var m = document.querySelectorAll('.modal');
      for (var i = 0; i < m.length; i++) m[i].classList.remove('show');
      this.modalStack = [];
    },

    /* ------------------------------------------------------------------
     * 角色选择
     * ------------------------------------------------------------------ */
    buildSelect: function () {
      var host = this.el['sel-body'];
      if (!host) return;
      host.innerHTML = '';
      for (var side = 0; side < 2; side++) host.appendChild(this.buildSlot(side));
      this.picks = ['gojo', 'sukuna'];
    },

    buildSlot: function (side) {
      var self = this;
      var wrap = document.createElement('div');
      wrap.className = 'slot';
      wrap.dataset.side = String(side);

      var tag = document.createElement('div');
      tag.className = 'side-tag';
      tag.textContent = side === 0 ? '玩家（你 · 键盘操作）' : '对手（系统 AI）';
      wrap.appendChild(tag);

      /* 角色切换（从角色表动态生成，新增角色不用改这里） */
      var head = document.createElement('div');
      head.className = 'slot-head';
      Object.keys(SH.CHARACTERS).forEach(function (cid) {
        var b = document.createElement('button');
        b.className = 'pick';
        b.dataset.char = cid;
        b.dataset.side = String(side);
        b.textContent = SH.CHARACTERS[cid].name;
        b.addEventListener('click', function () {
          self.setPick(side, cid);
          SH.Audio.play('ui_click');
        });
        head.appendChild(b);
      });

      /* 随机：点一次换一个，可以反复摇 */
      var rnd = document.createElement('button');
      rnd.className = 'pick pick-random';
      rnd.dataset.side = String(side);
      rnd.textContent = '随机';
      rnd.title = '随机挑一个角色（再点一次重新摇）';
      rnd.addEventListener('click', function () {
        var ids = Object.keys(SH.CHARACTERS);
        var pool = ids.filter(function (x) { return x !== self.picks[side]; });
        var pickId = pool[Math.floor(Math.random() * pool.length)];
        self.setPick(side, pickId);
        SH.Audio.play('ui_click');
        SH.UI.toast('随机到 ' + SH.CHARACTERS[pickId].name, 1200);
      });
      head.appendChild(rnd);

      /* 自定义角色入口（只在玩家那一侧显示一次） */
      if (side === 0) {
        var cbtn = document.createElement('button');
        cbtn.className = 'pick pick-custom';
        cbtn.textContent = '＋ 自定义';
        cbtn.title = '自己搭配技能和被动，做一个角色（存在本地）';
        cbtn.addEventListener('click', function () {
          SH.Audio.play('ui_click');
          SH.CustomEditor.open();
        });
        head.appendChild(cbtn);
      }
      wrap.appendChild(head);

      var who = document.createElement('div');
      who.className = 'who';
      who.innerHTML = '<div class="orb"></div><div class="meta"><div class="nm"></div><div class="ti"></div></div><div class="hp"></div>';
      wrap.appendChild(who);

      var list = document.createElement('div');
      list.className = 'skill-list';
      wrap.appendChild(list);

      this.renderSlot(wrap, side);
      return wrap;
    },

    renderSlot: function (wrap, side) {
      var self = this;
      var ch = SH.CHARACTERS[this.picks[side]];

      var picks = wrap.querySelectorAll('.pick');
      for (var i = 0; i < picks.length; i++) {
        picks[i].classList.toggle('on', picks[i].dataset.char === ch.id);
      }

      wrap.querySelector('.orb').className = 'orb ' + ch.id;
      wrap.querySelector('.nm').textContent = ch.name;
      wrap.querySelector('.ti').textContent = ch.title;
      wrap.querySelector('.hp').textContent = ch.hp + ' HP';

      var list = wrap.querySelector('.skill-list');
      list.innerHTML = '';

      ch.skills.forEach(function (sk, idx) {
        var row = document.createElement('button');
        row.className = 'skill-row';
        var slot = sk.slot || (idx + 1);
        var keyName = { 1: 'Q', 2: 'W', 3: 'E' }[slot] || '';
        row.innerHTML =
          '<span class="idx">' + slot + '</span>' +
          '<span class="txt"><span class="nm">' + esc(sk.name) +
          '<em class="keycap">' + keyName + '</em></span>' +
          '<span class="cd">' + esc(cdSummary(sk)) + '</span></span>' +
          '<span class="arrow">详情 ›</span>';
        row.addEventListener('click', function () { self.openSkillDetail(ch.id, idx); SH.Audio.play('ui_click'); });
        list.appendChild(row);
      });

      var p = document.createElement('button');
      p.className = 'skill-row passive';
      p.innerHTML =
        '<span class="idx">被</span>' +
        '<span class="txt"><span class="nm">' + esc(ch.passive.name) + '</span>' +
        '<span class="cd">被动 · 始终生效</span></span>' +
        '<span class="arrow">详情 ›</span>';
      p.addEventListener('click', function () { self.openSkillDetail(ch.id, -1); SH.Audio.play('ui_click'); });
      list.appendChild(p);
    },

    setPick: function (side, charId) {
      this.picks[side] = charId;
      var slots = this.el['sel-body'].querySelectorAll('.slot');
      for (var i = 0; i < slots.length; i++) {
        this.renderSlot(slots[i], parseInt(slots[i].dataset.side, 10));
      }
    },

    openSkillDetail: function (charId, skillIndex) {
      var ch = SH.CHARACTERS[charId];
      var body = this.el['skill-modal-body'];
      var nameEl = this.el['skill-modal-name'];
      if (!body) return;
      if (skillIndex < 0) {
        nameEl.textContent = ch.name + ' · 被动 · ' + ch.passive.name;
        body.innerHTML = '<div class="skill-detail">' + esc(ch.passive.desc) + '</div>';
      } else {
        var sk = ch.skills[skillIndex];
        nameEl.textContent = ch.name + ' · 技能' + (skillIndex + 1) + ' · ' + sk.name;
        body.innerHTML =
          '<div class="skill-detail"><div class="meta"><span>' + esc(cdSummary(sk)) + '</span>' +
          '<span>' + esc(typeSummary(sk)) + '</span></div>' + esc(sk.desc) + '</div>';
      }
      this.openModal('modal-skill');
    },

    /* ------------------------------------------------------------------
     * 战斗 HUD
     * ------------------------------------------------------------------ */
    buildBattle: function (match) {
      var self = this;
      this.el['hp0'].innerHTML = hpMarkup(match.balls[0]);
      this.el['hp1'].innerHTML = hpMarkup(match.balls[1]);
      this.hpNodes = [
        { wrap: this.el['hp0'], fill: this.el['hp0'].querySelector('.fill'), num: this.el['hp0'].querySelector('.num'), shield: this.el['hp0'].querySelector('.shield') },
        { wrap: this.el['hp1'], fill: this.el['hp1'].querySelector('.fill'), num: this.el['hp1'].querySelector('.num'), shield: this.el['hp1'].querySelector('.shield') }
      ];

      var bar = this.el['skillbar'];
      bar.innerHTML = '';
      this.skillNodes = [];
      var ball = match.balls[0];
      /* 键位跟“技能槽位”走，不是数组下标 ——
       * 虎杖只有 1 和 2 槽，就是 Q 和 W（没有 E） */
      var keys = { 1: 'Q', 2: 'W', 3: 'E' };
      ball.char.skills.forEach(function (sk, idx) {
        var slot = sk.slot || (idx + 1);
        var b = document.createElement('button');
        b.className = 'skill-btn ' + ball.char.id + (sk.ultimate ? ' ult' : '');
        b.setAttribute('data-slot', slot);
        b.innerHTML =
          '<span class="key">' + (keys[slot] || '?') + ' / ' + slot + '</span>' +
          '<span class="nm">' + esc(sk.short || sk.name) + '</span>' +
          (sk.cdType === 'charge'
            ? '<span class="pips">' + pipsMarkup(sk) + '</span>'
            : '') +
          '<span class="hint">' + esc(sk.cdType === 'charge' ? sk.charges + ' 充能' : 'CD ' + sk.cd + 's') + '</span>' +
          '<div class="cdmask"></div><span class="cdtext"></span>';
        /* 按下 → 交给上层处理（可能立刻释放，也可能是长按技能开始蓄力）；
         * 松手/移出 → 通知上层结束长按。不再用 click，避免和 pointerdown 重复触发。
         * 只处理主键/触摸，避免右键也放技能。 */
        b.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          if (self.on.holdStart) self.on.holdStart(slot);
          else if (self.on.skill) self.on.skill(idx);
        });
        b.addEventListener('pointerup', function (e) {
          e.preventDefault();
          if (self.on.holdRelease) self.on.holdRelease(slot);
        });
        b.addEventListener('pointercancel', function () {
          if (self.on.holdRelease) self.on.holdRelease(slot);
        });
        b.addEventListener('pointerleave', function () {
          if (self.on.holdRelease) self.on.holdRelease(slot);
        });
        bar.appendChild(b);
        var hintNode = b.querySelector('.hint');
        if (hintNode) hintNode.dataset.orig = hintNode.textContent;
        self.skillNodes.push({
          node: b,
          slot: slot,
          data: sk,
          mask: b.querySelector('.cdmask'),
          text: b.querySelector('.cdtext'),
          hint: hintNode,
          pips: b.querySelectorAll('.pips i')
        });
      });
      this.lastReady = [-1, -1, -1];
    },

    updateBattle: function (match) {
      var t = match.t;
      var a = match.balls[0], b = match.balls[1];

      /* 血条 */
      var hr0 = a.hpRatio(), hr1 = b.hpRatio();
      this.hpNodes[0].fill.style.width = (hr0 * 100).toFixed(1) + '%';
      this.hpNodes[1].fill.style.width = (hr1 * 100).toFixed(1) + '%';
      this.hpNodes[0].num.textContent = Math.max(0, Math.round(a.hp)) + ' / ' + a.maxHp;
      this.hpNodes[1].num.textContent = Math.max(0, Math.round(b.hp)) + ' / ' + b.maxHp;
      this.hpNodes[0].wrap.classList.toggle('low', hr0 < SH.CONFIG.lowHpRatio);
      this.hpNodes[1].wrap.classList.toggle('low', hr1 < SH.CONFIG.lowHpRatio);
      this.hpNodes[0].shield.textContent = a.status.immunityBig ? '无下限·强化' : (a.status.immunityUntil > t ? '无下限' : '');
      /* 分身数量（鸣人） */
      var cl0 = match.clonesOf(0).length, cl1 = match.clonesOf(1).length;
      if (this.el['hp0'].querySelector('.clones')) this.el['hp0'].querySelector('.clones').textContent = cl0 ? ('影分身 ×' + cl0) : '';
      if (this.el['hp1'].querySelector('.clones')) this.el['hp1'].querySelector('.clones').textContent = cl1 ? ('影分身 ×' + cl1) : '';
      this.hpNodes[1].shield.textContent = b.status.burn ? '灼烧' : '';

      /* 计时 */
      if (this.el['clock']) this.el['clock'].textContent = SH.M.fmtTime(t);

      /* 被定身提示（无量空处） */
      var bound = a.isBound(t);
      var badge = this.el['bind-badge'];
      if (badge) {
        badge.classList.toggle('show', bound);
        if (bound) badge.textContent = '定身 ' + (a.status.bindUntil - t).toFixed(1) + 's';
      }
      if (this.el['skillbar']) this.el['skillbar'].classList.toggle('bound', bound);

      /* 技能按钮 */
      for (var i = 0; i < this.skillNodes.length; i++) {
        var s = this.skillNodes[i];
        var st = a.skills[i];
        var ready = st.isReady();
        var rd = st.readiness();

        s.mask.style.background = 'conic-gradient(rgba(43,43,43,.14) ' +
          ((1 - rd) * 360).toFixed(1) + 'deg, rgba(0,0,0,0) 0)';

        if (st.data.cdType === 'charge') {
          /* 有"释放冷却"时优先显示它（佩恩神罗天征：充能点恢复和 CD 是两件事） */
          if (st.castCd > 0) s.text.textContent = st.castCd.toFixed(1);
          else s.text.textContent = (st.charges < st.max) ? st.recharge.toFixed(1) : '';
          if (s.pips) {
            for (var p = 0; p < s.pips.length; p++) {
              s.pips[p].classList.toggle('on', p < st.charges);
              s.pips[p].classList.toggle(a.char.id, true);
            }
          }
        } else {
          s.text.textContent = st.cd > 0 ? st.cd.toFixed(1) : '';
        }

        s.node.classList.toggle('notready', !ready);
        /* 够不着的技能（比如虎杖的迳庭拳）：按钮压暗并写明原因，按下去不会有反应 */
        var castable = match.canCastSkill(a, i);
        s.node.classList.toggle('outofrange', ready && !castable);
        if (ready && !castable && s.hint) s.hint.textContent = '超出范围';
        else if (ready && s.hint && s.hint.dataset.orig) s.hint.textContent = s.hint.dataset.orig;
        if (ready && this.lastReady[i] !== 1) {
          s.node.classList.remove('ready');
          void s.node.offsetWidth;
          s.node.classList.add('ready');
        }
        this.lastReady[i] = ready ? 1 : 0;
      }
    },

    /* ------------------------------------------------------------------
     * 技能名大字
     * ------------------------------------------------------------------ */
    callout: function (p) {
      if (!this.settings.callout) return;
      var node = this.el['callout'];
      if (!node) return;
      var now = (window.performance && performance.now()) ? performance.now() : Date.now();
      var gap = p.big ? 260 : 130;
      if (!p.blackflash && now - this.calloutLock < gap) return;
      this.calloutLock = now;

      var titleEl = node.querySelector('.co-title');
      titleEl.textContent = p.title || '';
      /* 名字越长字号越小，避免横着冲出场地 */
      var len = (p.title || '').length;
      titleEl.classList.remove('long', 'xlong');
      if (len >= 7) titleEl.classList.add('xlong');
      else if (len >= 5) titleEl.classList.add('long');

      node.querySelector('.co-sub').textContent = p.subtitle || p.roman || '';
      node.className = 'callout' + (p.big ? ' big' : '') + (p.blackflash ? ' blackflash' : '');
      void node.offsetWidth;
      node.classList.add('show');
    },

    toast: function (text, ms) {
      var n = this.el['toast'];
      if (!n) return;
      n.textContent = text;
      n.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { n.classList.remove('show'); }, ms || 1600);
    },

    /* ------------------------------------------------------------------
     * 结算
     * ------------------------------------------------------------------ */
    showResult: function (sum, onAgain, onSelect, onMenu) {
      var self = this;
      var host = this.el['result-inner'];
      var w = sum.winner;
      var winName = w === -1 ? '平局' : sum.balls[w].name;
      var winCls = w === -1 ? '' : sum.balls[w].id;

      var html = '';
      html += '<div class="result-head">';
      html += '<div class="win ' + winCls + '">' + esc(winName) + (w === -1 ? '' : ' 胜利') + '</div>';
      html += '<div class="sub">用时 ' + SH.M.fmtTime(sum.duration) +
        ' · 球球碰撞 ' + sum.collisions + ' 次 · 黑闪 ' + sum.blackFlashes + ' 次</div>';
      if (sum.balls.some(function (b) { return b.blackFlashes > 0; })) {
        html += '<div class="sub">★ 本局出现过黑闪：' +
          sum.balls.filter(function (b) { return b.blackFlashes > 0; })
            .map(function (b) { return b.name + ' ×' + b.blackFlashes; }).join('、') + '</div>';
      }
      html += '</div><div class="result-grid">';

      for (var i = 0; i < 2; i++) {
        var b = sum.balls[i];
        var total = 0;
        for (var k in b.bySkill) total += b.bySkill[k];
        total = total || 1;

        html += '<div class="card"><h4>' + esc(b.name) + '</h4>';
        html += statRow('剩余生命', Math.max(0, Math.round(b.hp)) + ' / ' + b.maxHp);
        html += statRow('造成伤害', Math.round(b.dealt));
        html += statRow('承受伤害', Math.round(b.taken));
        html += statRow('被动回复', Math.round(b.healed));
        html += statRow('出手次数', b.casts);
        if (b.immunityBlocks) html += statRow('无下限挡伤', b.immunityBlocks + ' 次');
        if (b.tenkaiHits) html += statRow('被领域展延命中', b.tenkaiHits + ' 次');
        html += statRow('黑闪', b.blackFlashes + ' 次');

        var rows = Object.keys(b.bySkill).map(function (kk) { return [kk, b.bySkill[kk]]; })
          .sort(function (x, y) { return y[1] - x[1]; });
        if (rows.length) {
          html += '<div style="margin-top:10px"><h4 style="font-size:12px;color:#6B6459">伤害构成</h4>';
          rows.forEach(function (r) {
            var pct = r[1] / total * 100;
            var col = b.id === 'gojo' ? '#3B82F6' : '#8B1A1A';
            if (r[0] === 'blackflash') col = '#B91C1C';
            html += '<div class="dmgbar"><div class="lbl"><span>' + esc(skillLabel(b.id, r[0])) + '</span>' +
              '<span>' + pct.toFixed(1) + '% · ' + Math.round(r[1]) + '</span></div>' +
              '<div class="track"><div class="fill" style="width:' + pct.toFixed(1) + '%;background:' + col + '"></div></div></div>';
          });
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      html += '<div class="result-buttons">' +
        '<button class="btn primary" id="res-again">再来一局</button>' +
        '<button class="btn" id="res-select">更换角色</button>' +
        '<button class="btn ghost" id="res-menu">回到主菜单</button>' +
        '</div>';

      host.innerHTML = html;
      host.scrollTop = 0;
      this.show('screen-result');

      document.getElementById('res-again').addEventListener('click', function () { SH.Audio.play('ui_click'); onAgain(); });
      document.getElementById('res-select').addEventListener('click', function () { SH.Audio.play('ui_click'); onSelect(); });
      document.getElementById('res-menu').addEventListener('click', function () { SH.Audio.play('ui_click'); onMenu(); });
    },

    /* ------------------------------------------------------------------
     * 设置
     * ------------------------------------------------------------------ */
    loadSettings: function () {
      var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      try {
        var raw = window.localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          var o = JSON.parse(raw);
          for (var k in s) if (o[k] !== undefined) s[k] = o[k];
        }
      } catch (e) { /* 无 localStorage：用默认值 */ }
      return s;
    },

    saveSettings: function () {
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) {}
    },

    syncSettingsUI: function () {
      var s = this.settings;
      setVal('opt-sfx', s.sfx); setVal('opt-voice', s.voice); setVal('opt-bgm', s.bgm);
      setVal('opt-shake', s.shake);
      setChk('opt-numbers', s.numbers); setChk('opt-callout', s.callout);
    },

    applySettings: function () {
      var s = this.settings;
      if (SH.CONFIG && SH.CONFIG.vfx) {
        SH.CONFIG.vfx.damageNumbers = !!s.numbers;
        SH.CONFIG.vfx.shake = s.shake;
      }
      SH.Audio.setVolumes({ sfxVolume: s.sfx, voiceVolume: s.voice, bgmVolume: s.bgm });
      this.syncSettingsUI();
    }
  };

  /* ------------------------------------------------------------------ 小工具 */
  function setVal(id, v) { var n = document.getElementById(id); if (n) n.value = v; }
  function setChk(id, v) { var n = document.getElementById(id); if (n) n.checked = !!v; }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 伤害来源 id → 中文名。技能 id 从角色表里查（自定义角色也适用），
   * 剩下的（碰撞/暴击等）用固定表兜底 —— 不然结算面板上会直接显示英文 id。 */
  var FIXED_LABEL = {
    collision: '球体碰撞',
    crit: '暴击',
    blackflash: '黑闪',
    blackRod: '黑棒',
    reflect: '反弹飞行物',
    reflected: '被反弹',
    field: '领域',
    blue: '苍',
    red: '赫',
    purple: '茈',
    arrow: '灶·开',
    slash: '解',
    grid: '捌'
  };

  function hpMarkup(ball) {
    /* 血条配色按角色色板内联生成 —— 以前只有 gojo/sukuna 在 CSS 里写了配色，
     * 后加的角色（虎杖/鸣人/佩恩/自定义）血条是透明的，看起来像"没血" */
    var c = ball.char.color || {};
    var grad = 'linear-gradient(90deg,' + (c.light || '#E5E7EB') + ',' + (c.main || '#6B7280') + ')';
    return '<div class="hp-inner"><span class="nm">' + esc(ball.char.name) + '</span>' +
      '<div class="bar"><div class="fill" style="width:100%;background:' + grad + '"></div></div>' +
      '<span class="num">' + ball.maxHp + ' / ' + ball.maxHp + '</span>' +
      '<span class="shield"></span><span class="clones"></span></div>';
  }

  function pipsMarkup(sk) {
    var s = '';
    for (var i = 0; i < sk.charges; i++) s += '<i></i>';
    return s;
  }

  function cdSummary(sk) {
    if (sk.cdType === 'charge') return sk.charges + ' 充能 · 每点 ' + sk.chargeTime + 's';
    if (sk.id === 'sukuna1') return 'CD ' + sk.cd + 's（解） / ' + sk.cdGrid + 's（捌）';
    return 'CD ' + sk.cd + 's';
  }

  function typeSummary(sk) {
    if (sk.ultimate) return '大招';
    if (sk.cdType === 'charge') return '充能型';
    return '冷却型';
  }

  function statRow(k, v) {
    return '<div class="stat-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }

  /* 伤害来源 id → 中文名。先查固定表，再在【所有角色】的技能里反查
   * （这样佩恩的 pain1、黑棒这种跨角色的来源也能显示中文，而不是英文 id）。 */
  function skillLabel(charId, key) {
    if (key === undefined || key === null || key === '') return '其他';
    if (FIXED_LABEL[key]) return FIXED_LABEL[key];
    var chars = SH.CHARACTERS;
    for (var c in chars) {
      var sk = chars[c].skills || [];
      for (var i = 0; i < sk.length; i++) {
        if (sk[i].id === key) return sk[i].short || sk[i].name;
      }
    }
    var ch = SH.CHARACTERS[charId];
    if (ch) for (var j = 0; j < ch.skills.length; j++) if (ch.skills[j].id === key) return ch.skills[j].short || ch.skills[j].name;
    return key;
  }

  SH.UI = UI;
})();
