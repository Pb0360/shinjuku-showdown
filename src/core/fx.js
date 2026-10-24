/* ==========================================================================
 * 特效层：镜头放大 / 时间暂缓 / 震屏 / 闪屏 / 粒子 / 伤害飘字 / 技能名大字
 * --------------------------------------------------------------------------
 * 设计约定：
 *   · 逻辑世界受 timeScale 影响（慢放），特效本身按真实时间推进
 *   · 所有表现都是"消费事件"产生的：战斗逻辑只管发事件，不管怎么演
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  var MAX_PARTICLES = 420;
  var MAX_NUMBERS = 40;

  function FX(opts) {
    opts = opts || {};
    var cfg = (SH.CONFIG && SH.CONFIG.vfx) || {};
    this.enabled = cfg.enabled !== false;
    this.onCallout = opts.onCallout || function () {};

    this.now = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.zoomHold = 0;
    this.shakeAmp = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flashA = 0;
    this.flashColor = '255,255,255';
    this.slowScale = 1;
    this.slowEnd = 0;

    this.particles = [];
    this.numbers = [];
    this.rings = [];
    this.blades = [];
    this.cuts = [];     // 斩击留在空中的刀痕
    this.bows = [];     // 灶·开的火焰弓
    this.fists = [];    // 迳庭拳的蓝黑色拳
    this.trails = [];   // 飞雷神瞬移的金色刀痕
    this.orbs = [];     // 螺旋丸：旋转的蓝色球体

    this.shakeScale = cfg.shake === undefined ? 1 : cfg.shake;
    this.showNumbers = cfg.damageNumbers !== false;
    this.useZoom = cfg.screenZoom !== false;
    this.useSlow = cfg.slowMotion !== false;
  }

  FX.prototype.timeScale = function () {
    if (!this.enabled || !this.useSlow) return 1;
    return (this.now < this.slowEnd) ? this.slowScale : 1;
  };

  FX.prototype.reset = function () {
    this.particles.length = 0;
    this.numbers.length = 0;
    this.rings.length = 0;
    this.blades.length = 0;
    this.cuts.length = 0;
    this.bows.length = 0;
    this.fists.length = 0;
    this.zoom = this.zoomTarget = 1;
    this.shakeAmp = 0;
    this.flashA = 0;
    this.slowScale = 1;
    this.slowEnd = 0;
  };

  /* ------------------------------------------------------------------ */
  FX.prototype.slow = function (scale, dur) {
    if (!this.enabled || !this.useSlow) return;
    /* 只有"真的变慢"才算，scale >= 1 或时长为 0 直接忽略 ——
     * 普通技能一律不暂缓时间，否则一局里有 1/3 时间在慢放，玩起来一卡一卡 */
    if (!(scale < 0.999) || !(dur > 0)) return;
    this.slowScale = Math.min(this.slowScale, scale);
    this.slowEnd = Math.max(this.slowEnd, this.now + dur);
  };

  FX.prototype.punchZoom = function (z, hold) {
    if (!this.enabled || !this.useZoom) return;
    this.zoomTarget = Math.max(this.zoomTarget, z);
    this.zoomHold = Math.max(this.zoomHold, hold || 0.25);
  };

  FX.prototype.shake = function (amp) {
    if (!this.enabled) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp * this.shakeScale);
  };

  FX.prototype.flash = function (alpha, color) {
    if (!this.enabled) return;
    /* 只有"更强的那次闪光"才有资格决定颜色，
     * 否则黑闪的全屏黑红会被随后一次轻微的白色闪光覆盖掉 */
    if (color && alpha >= this.flashA) this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  };

  /* ------------------------------------------------------------------
   * 粒子与飘字
   * ------------------------------------------------------------------ */
  FX.prototype.spark = function (x, y, n, color, speed, life, size) {
    if (!this.enabled) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * M.TAU;
      var s = speed * (0.35 + Math.random() * 0.9);
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.7), maxLife: life,
        r: size * (0.55 + Math.random() * 0.8), color: color,
        drag: 2.2, kind: 'spark'
      });
    }
    this.trim();
  };

  FX.prototype.ring = function (x, y, maxR, color, life, width, expand) {
    if (!this.enabled) return;
    this.rings.push({ x: x, y: y, r: 6, maxR: maxR, color: color, life: life, maxLife: life, w: width || 4, expand: expand || life });
  };

  FX.prototype.orb = function (x, y, r, life) {
    if (!this.enabled) return;
    this.orbs.push({ x: x, y: y, r: r || 34, life: life || 0.45, maxLife: life || 0.45, age: 0 });
  };

  FX.prototype.trail = function (x1, y1, x2, y2, color, life, width) {
    if (!this.enabled) return;
    this.trails.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: color || '252,211,77', life: life || 0.35, maxLife: life || 0.35, w: width || 11 });
  };

  FX.prototype.dust = function (x, y, color) {
    if (!this.enabled) return;
    for (var i = 0; i < 4; i++) {
      var a = Math.random() * M.TAU;
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
        life: 0.3, maxLife: 0.3, r: 3 + Math.random() * 3, color: color || '43,43,43',
        drag: 5, kind: 'spark'
      });
    }
    this.trim();
  };

  FX.prototype.blade = function (x, y, ang, len, color, life) {
    if (!this.enabled) return;
    this.blades.push({ x: x, y: y, ang: ang, len: len, color: color, life: life, maxLife: life });
  };

  /* 斩击留在空中的刀痕（解 命中时用） */
  FX.prototype.cut = function (x, y, ang, len, color) {
    if (!this.enabled) return;
    this.cuts.push({
      x: x, y: y, ang: ang, len: len || 260,
      color: color || '255,255,255', life: 0.42, maxLife: 0.42
    });
    if (this.cuts.length > 24) this.cuts.shift();
  };

  /* 灶·开的火焰弓 */
  FX.prototype.bow = function (x, y, ang) {
    if (!this.enabled) return;
    this.bows.push({ x: x, y: y, ang: ang, life: 0.55, maxLife: 0.55 });
    if (this.bows.length > 6) this.bows.shift();
    this.spark(x, y, 14, '234,88,12', 140, 0.5, 4);
  };

  /* 迳庭拳的拳：蓝黑色，朝 ang 方向砸出去 */
  FX.prototype.fist = function (x, y, ang) {
    if (!this.enabled) return;
    this.fists.push({ x: x, y: y, ang: ang, life: 0.34, maxLife: 0.34 });
    if (this.fists.length > 8) this.fists.shift();
  };

  FX.prototype.number = function (x, y, text, color, size, bold) {
    if (!this.enabled || !this.showNumbers) return;
    this.numbers.push({
      x: x, y: y, text: text, color: color || '#2B2B2B',
      size: size || 26, life: 0.9, maxLife: 0.9,
      vy: -58, vx: (Math.random() - 0.5) * 90, bold: bold !== false
    });
    if (this.numbers.length > MAX_NUMBERS) this.numbers.shift();
  };

  FX.prototype.trim = function () {
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  };

  /* ------------------------------------------------------------------
   * 消费战斗事件
   * ------------------------------------------------------------------ */
  FX.prototype.onEvent = function (ev, match) {
    if (!this.enabled) return;
    var b, ch;
    switch (ev.type) {
      case 'cast':
        b = ev.ball; ch = b.char;
        var vfx = ev.vfx || {};
        this.punchZoom(vfx.zoom || 1.05, vfx.slow || 0.3);
        this.slow(vfx.timeScale === undefined ? 1 : vfx.timeScale, vfx.slow || 0);
        this.flash(vfx.big ? 0.22 : 0.08, '255,255,255');
        this.shake(vfx.big ? 9 : 2.5);
        this.ring(b.x, b.y, vfx.big ? 260 : 90, hexToRgb(ch.color.main), vfx.big ? 0.8 : 0.4, vfx.big ? 7 : 3);
        this.spark(b.x, b.y, vfx.big ? 26 : 10, hexToRgb(ch.color.main), vfx.big ? 300 : 140, 0.5, vfx.big ? 5 : 3);
        /* 灶·开：先亮出一张火焰弓 */
        if (ev.skillId === 'sukuna2' && ev.aim) this.bow(b.x, b.y, Math.atan2(ev.aim.y, ev.aim.x));
        this.onCallout({
          title: ev.title, subtitle: ev.subtitle,
          big: !!vfx.big, roman: vfx.roman || '',
          color: ch.color.main
        });
        break;

      case 'damage':
        var target = ev.target;
        var col = ev.tenkai ? '#4A0D0D' : (ev.dmgType === 'direct' ? '#2B2B2B' : '#3B82F6');
        if (ev.dmgType === 'barrage') col = target.char.color.main;
        if (ev.tenkai) col = '#B91C1C';
        this.number(ev.x, ev.y - 10, (ev.tenkai ? '展延 ' : '') + Math.round(ev.amount), col,
          ev.domain ? 34 : (ev.amount >= 30 ? 32 : 24), ev.amount >= 20);
        this.spark(ev.x, ev.y, ev.amount >= 20 ? 12 : 5,
          ev.tenkai ? '185,28,28' : '43,43,43', ev.amount >= 20 ? 220 : 120, 0.4, ev.amount >= 20 ? 4 : 2.6);
        this.shake(Math.min(6, ev.amount * 0.12));
        /* 解 命中：在空中留下刀痕 */
        if (ev.blade) {
          this.cut(ev.x, ev.y, Math.atan2(ev.blade.dy, ev.blade.dx) + Math.PI / 2,
            (ev.blade.half || 260) * 1.5, '255,255,255');
        }
        /* 火焰箭命中：炸开一团火 */
        if (ev.skillId === 'arrow') {
          this.spark(ev.x, ev.y, 22, '249,115,22', 260, 0.6, 5);
          this.spark(ev.x, ev.y, 10, '254,240,138', 180, 0.45, 3.5);
          this.ring(ev.x, ev.y, 90, '234,88,12', 0.4, 4);
        }
        break;

      case 'explode':
        if (ev.kind === 'purple') {
          /* 茈 的炸开：更大更白更响（但不暂缓时间） */
          this.ring(ev.x, ev.y, ev.radius * 1.5, '124,58,237', 0.75, 10);
          this.ring(ev.x, ev.y, ev.radius, '40,10,80', 0.55, 7);
          this.ring(ev.x, ev.y, ev.radius * 0.7, '255,255,255', 0.35, 5);
          this.spark(ev.x, ev.y, 46, '167,139,250', 420, 0.8, 6);
          this.flash(0.34, '235,225,255');
          this.shake(20);
          this.punchZoom(1.12, 0.5);
        } else {
          this.ring(ev.x, ev.y, ev.radius, '200,60,40', 0.5, 6);
          this.ring(ev.x, ev.y, ev.radius * 0.6, '255,220,180', 0.32, 3);
          this.spark(ev.x, ev.y, 26, '214,90,50', 320, 0.55, 5);
          this.flash(0.14, '255,210,180');
          this.shake(11);
        }
        break;

      case 'fuse':
        this.ring(ev.x, ev.y, 200, '124,58,237', 0.7, 6);
        this.spark(ev.x, ev.y, 34, '124,58,237', 340, 0.7, 5);
        this.flash(0.24, '220,200,255');
        this.shake(12);
        this.slow(0.55, 0.42);      // 原来的 ~70%
        break;

      case 'blackflash':
        this.flash(0.78, '74,0,14');
        this.slow(0.28, SH.CONFIG.blackFlash.slowMo);
        this.punchZoom(SH.CONFIG.blackFlash.zoom, 1.0);
        this.shake(26);
        this.ring(ev.x, ev.y, 520, '20,0,0', 1.1, 12);
        this.ring(ev.x, ev.y, 380, '255,0,51', 0.85, 6);
        this.spark(ev.x, ev.y, 60, '200,20,40', 520, 1.0, 6);
        this.onCallout({
          title: '黑闪', subtitle: 'Black Flash · 2.5 次方',
          big: true, roman: 'Kokusen', color: '#B91C1C', blackflash: true
        });
        break;

      case 'immune':
        this.ring(ev.x, ev.y, ev.big ? 190 : 110, '120,190,255', ev.big ? 0.7 : 0.4, ev.big ? 6 : 3);
        this.spark(ev.x, ev.y, ev.big ? 22 : 8, '150,210,255', 220, 0.5, 3.5);
        if (ev.big) { this.flash(0.18, '200,235,255'); this.punchZoom(1.08, 0.4); this.slow(0.65, 0.25); }
        break;

      case 'bind':
        /* 无量空处定身：白色几何爆发 + 冲击环 */
        this.ring(ev.x || ev.ball.x, ev.y || ev.ball.y, 260, '220,235,255', 0.6, 8);
        this.ring(ev.x || ev.ball.x, ev.y || ev.ball.y, 160, '37,99,235', 0.45, 5);
        this.spark(ev.x || ev.ball.x, ev.y || ev.ball.y, 30, '235,245,255', 340, 0.7, 5);
        this.flash(0.30, '240,248,255');
        this.punchZoom(1.10, 0.5);
        this.shake(13);
        break;

      case 'reflect':
        this.ring(ev.x, ev.y, 90, '96,165,250', 0.35, 3);
        this.spark(ev.x, ev.y, 10, '147,197,253', 200, 0.4, 3);
        break;

      case 'heal':
        this.number(ev.x + 26, ev.y - 34, '+' + Math.round(ev.amount), ev.bonus ? '#15803D' : '#65A30D',
          ev.bonus ? 24 : 18, false);
        break;

      case 'wall':
        if (ev.speed > 120) this.dust(ev.x, ev.y, '120,120,120');
        break;

      case 'pbounce':
        this.dust(ev.x, ev.y, '150,150,150');
        break;

      /* 鸣人：影分身出现 / 阵亡 / 色诱术 / 弹幕转治疗 */
      case 'cloneSpawn': {
        var cs = ev.ball;
        this.ring(cs.x, cs.y, cs.r * 3.2, '255,255,255', 0.38, 5);
        this.ring(cs.x, cs.y, cs.r * 2.1, '245,158,11', 0.32, 4);
        this.spark(cs.x, cs.y, 18, '251,191,36', 240, 0.45, 4);
        this.flash(0.10, '255,240,210');
        break;
      }
      case 'cloneDeath': {
        var cd2 = ev.ball;
        this.ring(cd2.x, cd2.y, cd2.r * 4.2, '245,158,11', 0.45, 5);
        this.ring(cd2.x, cd2.y, cd2.r * 2.4, '255,255,255', 0.3, 3);
        this.spark(cd2.x, cd2.y, 24, '255,220,150', 300, 0.5, 5);
        if (ev.main) {
          this.ring(ev.main.x, ev.main.y, ev.main.r * 2.6, '134,239,172', 0.45, 4);
          this.number(ev.main.x, ev.main.y - ev.main.r - 12, '+' + Math.round(cd2.maxHp * 0.1), '34,197,94', 18, true);
        }
        break;
      }
      case 'allure': {
        var al = ev.ball;
        this.ring(al.x, al.y, al.r * 5.2, '244,114,182', 0.6, 6);
        this.ring(al.x, al.y, al.r * 3.4, '251,207,232', 0.45, 4);
        this.spark(al.x, al.y, 26, '244,114,182', 280, 0.6, 5);
        this.flash(0.20, '255,214,235');
        this.punchZoom(1.05, 0.4);
        break;
      }
      case 'charmed': {
        this.number(ev.x, ev.y - 14, '+' + Math.round(ev.amount), '34,197,94', 17, true);
        this.ring(ev.x, ev.y, 34, '244,114,182', 0.3, 3);
        break;
      }
      /* 螺旋丸：起手（搓丸子） */
      case 'rasengan': {
        this.ring(ev.x, ev.y, 130, '191,230,255', 0.5, 7);
        this.ring(ev.x, ev.y, 76, '255,255,255', 0.36, 5);
        this.ring(ev.x, ev.y, 40, '147,197,253', 0.26, 3);
        this.spark(ev.x, ev.y, 30, '147,197,253', 360, 0.55, 6);
        this.flash(0.14, '225,240,255');
        this.shake(12);
        break;
      }

      /* 螺旋丸：撞上对手（真正的爆发） */
      case 'rasenganHit': {
        this.orb(ev.x, ev.y, 36, 0.42);              // 旋转的蓝色球体（和鸣人同款）
        this.ring(ev.x, ev.y, 170, '191,230,255', 0.5, 8);
        this.ring(ev.x, ev.y, 110, '255,255,255', 0.36, 6);
        this.ring(ev.x, ev.y, 64, '59,130,246', 0.3, 4);
        this.spark(ev.x, ev.y, 34, '147,197,253', 420, 0.6, 6);
        this.spark(ev.x, ev.y, 12, '255,255,255', 300, 0.4, 5);
        this.flash(0.20, '235,246,255');
        this.shake(20);
        this.punchZoom(1.10, 0.45);
        if (ev.amount) this.number(ev.x, ev.y - 26, '-' + Math.round(ev.amount), '59,130,246', 30, true);
        break;
      }

      case 'ballhit':
        this.spark(ev.x, ev.y, 12, '43,43,43', 180, 0.4, 3.4);
        this.ring(ev.x, ev.y, 60, '43,43,43', 0.3, 3);
        this.shake(7);
        break;

      /* 万象天引：引力奇点展开（向内收缩） */
      /* 万象天引：黑白引力奇点（向内收缩） */
      case 'gravityWell': {
        this.ring(ev.x, ev.y, ev.radius * 0.9, '20,20,20', 0.5, 5);
        this.ring(ev.x, ev.y, ev.radius * 0.55, '255,255,255', 0.42, 4);
        this.ring(ev.x, ev.y, ev.radius * 0.28, '10,10,10', 0.34, 3);
        this.spark(ev.x, ev.y, 26, '245,245,245', 300, 0.55, 5);
        this.spark(ev.x, ev.y, 12, '30,30,30', 240, 0.5, 4);
        this.flash(0.14, '250,250,250');
        this.shake(8);
        break;
      }

      /* 神罗天征 / 超·神罗天征：白色冲击波把一切推开 */
      case 'shinra': {
        if (ev.big) {
          /* 超·神罗天征：淡蓝白色的冲击波（场地那一层会持续动画） */
          this.ring(ev.x, ev.y, ev.radius, '30,64,175', 0.6, 10, 0.34);
          this.ring(ev.x, ev.y, ev.radius * 0.62, '147,197,253', 0.5, 7, 0.26);
          this.spark(ev.x, ev.y, 36, '219,234,254', 540, 0.6, 6);
          this.flash(0.3, '235,245,255');
          this.shake(24);
          this.punchZoom(1.12, 0.55);
        } else {
          /* 小神罗天征：黑环 0.19 秒扩到【角色直径的 2 倍】，然后停在最大处当 0.5 秒残影。
           * 用黑色是因为场地是米白色的，白环几乎没有对比度，看不出范围。 */
          this.ring(ev.x, ev.y, ev.ringR || ev.radius, '147,197,253', 0.42, 9, 0.17);
          this.ring(ev.x, ev.y, ev.ringR || ev.radius, '59,130,246', 0.42, 3, 0.17);
          this.flash(0.13, '255,255,255');
          this.shake(15);
        }
        break;
      }

      /* 黑棒天赋触发：暗色爆发 + 黑刺（刻意不用无量空处的白蓝效果） */
      case 'blackRodFire': {
        this.ring(ev.x, ev.y, 250, '20,20,20', 0.5, 9);
        this.ring(ev.x, ev.y, 150, '60,50,45', 0.4, 6);
        this.spark(ev.x, ev.y, 26, '35,30,28', 380, 0.5, 5);
        this.flash(0.16, '40,32,28');
        this.shake(18);
        this.punchZoom(1.10, 0.5);
        break;
      }

      /* 变大球：暴击被完全吸收（不显示伤害数字，只闪一下暗光） */
      case 'critImmune': {
        this.ring(ev.x, ev.y, 70, '124,58,237', 0.3, 5);
        break;
      }

      /* 吸血球：化蝠 / 蝠群结束 */
      case 'batSwarm': {
        /* 不要"红圈炸开"：改成低调的暗色烟雾 + 少量深红碎点 */
        this.spark(ev.x, ev.y, 26, '41,37,36', 210, 0.75, 7);
        this.spark(ev.x, ev.y, 10, '120,20,50', 160, 0.6, 5);
        this.shake(8);
        break;
      }

      /* 飞雷神瞬移：金色闪光（所有瞬移都用这个） */
      case 'kunaiSwap': {
        this.ring(ev.x, ev.y, 120, '252,211,77', 0.34, 7);
        this.ring(ev.x, ev.y, 62, '255,255,255', 0.26, 4);
        this.spark(ev.x, ev.y, 22, '253,224,71', 420, 0.36, 5);
        this.flash(0.16, '255,244,214');
        break;
      }

      /* 忍爱之剑命中：横斩（空中刀痕，和宿傩的"解"同一种表现） */
      case 'kunaiSlash': {
        this.cut(ev.x, ev.y, 0, 250, '252,211,77');
        this.cut(ev.x, ev.y, 0.12, 170, '255,255,255');
        this.spark(ev.x, ev.y, 14, '253,224,71', 300, 0.28, 4);
        break;
      }

      /* 大招拖影斩：两点之间拉一条金色刀痕 */
      case 'kunaiTrail': {
        /* 沿"两枚苦无之间"的连线拉一道刀痕（拖影） */
        var tx1 = ev.x1, ty1 = ev.y1, tx2 = ev.x2, ty2 = ev.y2;
        var tAng = Math.atan2(ty2 - ty1, tx2 - tx1);
        var tLen = Math.sqrt((tx2 - tx1) * (tx2 - tx1) + (ty2 - ty1) * (ty2 - ty1));
        if (tLen > 20) this.cut((tx1 + tx2) / 2, (ty1 + ty2) / 2, tAng, tLen, '252,211,77');
        this.trail(tx1, ty1, tx2, ty2, '252,211,77', 0.3, 10);
        this.ring(tx2, ty2, 70, '252,211,77', 0.26, 6);
        this.spark(tx2, ty2, 12, '253,224,71', 320, 0.26, 4);
        break;
      }

      /* 岩石挤压：小碎石飞溅 */
      case 'crush': {
        this.dust(ev.x, ev.y, '120,113,108');
        break;
      }

      /* 岩石消失时的小爆炸 */
      case 'rockBlast': {
        this.ring(ev.x, ev.y, 44, '154,120,90', 0.28, 4);
        this.dust(ev.x, ev.y, '150,140,130');
        this.dust(ev.x, ev.y, '110,100,92');
        break;
      }

      /* 地爆天星：黑色球体成型 */
      case 'chibaku': {
        this.ring(ev.x, ev.y, (ev.r || 46) * 3.2, '154,52,18', 0.5, 6);
        this.ring(ev.x, ev.y, (ev.r || 46) * 1.8, '251,146,60', 0.4, 4);
        this.spark(ev.x, ev.y, 30, '234,88,12', 340, 0.55, 5);
        this.flash(0.22, '255,235,215');
        this.shake(16);
        break;
      }

      /* 地爆天星结束：球体与岩石一起消散 */
      case 'fieldEnd': {
        this.ring(ev.x, ev.y, 150, '234,88,12', 0.45, 5);
        this.spark(ev.x, ev.y, 20, '251,146,60', 260, 0.5, 4);
        this.shake(8);
        break;
      }

      /* 暴击：非咒术回战角色的"黑闪"——金色爆裂，不回血不清 CD */
      case 'crit': {
        var cb = ev.ball;
        this.ring(ev.x, ev.y, 150, '255,196,61', 0.45, 7);
        this.ring(ev.x, ev.y, 96, '255,255,255', 0.3, 5);
        this.spark(ev.x, ev.y, 34, '251,191,36', 380, 0.5, 6);
        this.flash(0.26, '255,235,170');
        if (cb) cb.flash = 0.5;
        this.shake(16);
        this.punchZoom(1.09, 0.5);
        this.number(ev.x, ev.y - 34, '暴击 ' + Math.round(ev.amount), '217,119,6', 30, true);
        break;
      }
      /* 迳庭拳：命中 —— 蓝黑色的拳砸在对手身上 */
      case 'punch': {
        var pa = ev.ang === undefined ? 0 : ev.ang;
        this.fist(ev.x, ev.y, pa);
        this.ring(ev.x, ev.y, 104, '30,58,95', 0.36, 6);
        this.ring(ev.x, ev.y, 66, '125,211,252', 0.26, 3);
        this.spark(ev.x, ev.y, 16 + (ev.hits || 1) * 5, '125,211,252', 320, 0.42, 4);
        this.spark(ev.x, ev.y, 8, '15,23,42', 200, 0.5, 5);
        this.flash(0.10, '190,225,255');
        this.shake(11);
        break;
      }

      /* 迳庭拳：空挥（正常情况不会出现，canCast 会挡住） */
      case 'punchMiss':
        this.ring(ev.x, ev.y, 46, '30,58,95', 0.2, 3);
        break;

      /* 虎杖「黑闪」状态就绪：黑红冲击波 */
      case 'charged':
        this.ring(ev.ball.x, ev.ball.y, ev.ball.r * 3.4, '30,12,18', 0.5, 6);
        this.ring(ev.ball.x, ev.ball.y, ev.ball.r * 2.2, '228,71,122', 0.4, 4);
        this.spark(ev.ball.x, ev.ball.y, 20, '30,12,18', 260, 0.55, 5);
        this.flash(0.22, '255,200,210');
        this.punchZoom(1.06, 0.4);
        break;

      case 'fieldtick':
        if (ev.hit && ev.field.kind === 'sukuna3') {
          /* 每 0.1 秒一次，只用最轻的刀光 */
          var ang = Math.random() * Math.PI;
          this.blade(ev.x + (Math.random() - 0.5) * 90, ev.y + (Math.random() - 0.5) * 90,
            ang, 90 + Math.random() * 60, '139,26,26', 0.18);
        }
        break;

      case 'domainOpen':
        this.ring(ev.x, ev.y, 640, hexToRgb(ev.ball.char.color.main), 1.2, 10);
        this.flash(0.3, '255,255,255');
        this.shake(16);
        break;

      case 'end':
        this.slow(0.35, 1.4);
        this.punchZoom(1.08, 1.2);
        break;

      default: break;
    }
  };

  /* ------------------------------------------------------------------
   * 更新（用真实时间）
   * ------------------------------------------------------------------ */
  FX.prototype.update = function (dt) {
    this.now += dt;
    var i, p;

    /* 镜头 */
    if (this.zoomHold > 0) this.zoomHold -= dt;
    else this.zoomTarget = 1;
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 9);

    /* 震屏 */
    if (this.shakeAmp > 1) {
      this.shakeX = (Math.random() * 2 - 1) * this.shakeAmp;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 7);
    } else {
      this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0;
    }

    /* 闪屏 */
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - dt * 2.6);

    /* 粒子 */
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      var d = Math.exp(-dt * p.drag);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    /* 螺旋丸球体 */
    for (i = this.orbs.length - 1; i >= 0; i--) {
      var ob = this.orbs[i];
      ob.life -= dt;
      ob.age += dt;
      if (ob.life <= 0) this.orbs.splice(i, 1);
    }

    /* 金色刀痕 */
    for (i = this.trails.length - 1; i >= 0; i--) {
      var tr = this.trails[i];
      tr.life -= dt;
      if (tr.life <= 0) this.trails.splice(i, 1);
    }

    /* 冲击环 */
    for (i = this.rings.length - 1; i >= 0; i--) {
      var rg = this.rings[i];
      rg.life -= dt;
      if (rg.life <= 0) { this.rings.splice(i, 1); continue; }
      /* expand：扩到 maxR 需要的时间。life 比它长的话，剩下的时间就
       * 【停在最大半径上当残影】（小神罗用它来让人看清范围） */
      var ex = rg.expand || rg.maxLife;
      var aged = rg.maxLife - rg.life;
      var k = Math.min(1, aged / ex);
      rg.r = 6 + (rg.maxR - 6) * (1 - Math.pow(1 - k, 2.4));
    }

    /* 刀光 */
    for (i = this.blades.length - 1; i >= 0; i--) {
      this.blades[i].life -= dt;
      if (this.blades[i].life <= 0) this.blades.splice(i, 1);
    }

    /* 刀痕 */
    for (i = this.cuts.length - 1; i >= 0; i--) {
      this.cuts[i].life -= dt;
      if (this.cuts[i].life <= 0) this.cuts.splice(i, 1);
    }

    /* 火焰弓 */
    for (i = this.bows.length - 1; i >= 0; i--) {
      this.bows[i].life -= dt;
      if (this.bows[i].life <= 0) this.bows.splice(i, 1);
    }

    /* 迳庭拳的拳 */
    for (i = this.fists.length - 1; i >= 0; i--) {
      this.fists[i].life -= dt;
      if (this.fists[i].life <= 0) this.fists.splice(i, 1);
    }

    /* 飘字 */
    for (i = this.numbers.length - 1; i >= 0; i--) {
      var n = this.numbers[i];
      n.life -= dt;
      if (n.life <= 0) { this.numbers.splice(i, 1); continue; }
      n.x += n.vx * dt; n.y += n.vy * dt;
      n.vy += 52 * dt;
    }
  };

  /* 把镜头变换压到 context 上（在 canvas 像素坐标系里） */
  FX.prototype.applyTransform = function (ctx, W, H) {
    ctx.translate(W / 2 + this.shakeX, H / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-W / 2, -H / 2);
  };

  /* 世界坐标系里的特效（在 renderer 的逻辑坐标变换之后调用） */
  FX.prototype.drawWorld = function (ctx) {
    var i;

    /* 刀痕（留在空中的斩击痕迹） */
    for (i = 0; i < this.cuts.length; i++) {
      var cu = this.cuts[i];
      var ck = cu.life / cu.maxLife;
      ctx.save();
      ctx.translate(cu.x, cu.y);
      ctx.rotate(cu.ang);
      ctx.globalAlpha = ck * 0.35;
      ctx.strokeStyle = 'rgba(' + cu.color + ',1)';
      ctx.lineWidth = 14 * ck;
      ctx.beginPath();
      ctx.moveTo(-cu.len / 2, 0);
      ctx.lineTo(cu.len / 2, 0);
      ctx.stroke();
      ctx.globalAlpha = ck;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.2 * ck;
      ctx.beginPath();
      ctx.moveTo(-cu.len / 2, 0);
      ctx.lineTo(cu.len / 2, 0);
      ctx.stroke();
      ctx.restore();
    }

    /* 火焰弓 */
    for (i = 0; i < this.bows.length; i++) {
      this.drawBow(ctx, this.bows[i]);
    }

    /* 迳庭拳的拳 */
    for (i = 0; i < this.fists.length; i++) {
      this.drawFist(ctx, this.fists[i]);
    }

    /* 刀光 */
    for (i = 0; i < this.blades.length; i++) {
      var bl = this.blades[i];
      var a = bl.life / bl.maxLife;
      ctx.save();
      ctx.translate(bl.x, bl.y);
      ctx.rotate(bl.ang);
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = 'rgba(' + bl.color + ',1)';
      ctx.lineWidth = 3 + 4 * a;
      ctx.beginPath();
      ctx.moveTo(-bl.len / 2, 0);
      ctx.lineTo(bl.len / 2, 0);
      ctx.stroke();
      ctx.restore();
    }

    /* 螺旋丸：旋转的蓝色球体（和鸣人手上那颗同款） */
    for (i = 0; i < this.orbs.length; i++) {
      var ob2 = this.orbs[i];
      var ok = ob2.life / ob2.maxLife;                 // 1 → 0
      var grow = 1 + (1 - ok) * 0.55;                  // 略微膨胀
      var R = ob2.r * grow;
      ctx.save();
      ctx.translate(ob2.x, ob2.y);
      ctx.globalAlpha = Math.min(1, ok * 1.6);
      /* 球体：外深内亮的蓝色渐变 */
      var g = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.45, 'rgba(147,197,253,0.85)');
      g.addColorStop(1, 'rgba(37,99,235,0.55)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, M.TAU); ctx.fill();
      /* 旋转的纹路（鸣人螺旋丸的观感） */
      ctx.globalAlpha = Math.min(1, ok * 1.4) * 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(1.4, R * 0.09);
      ctx.lineCap = 'round';
      for (var sw = 0; sw < 3; sw++) {
        var a0 = ob2.age * 9 + sw * (M.TAU / 3);
        ctx.beginPath();
        ctx.arc(0, 0, R * (0.5 + 0.14 * sw), a0, a0 + 1.5);
        ctx.stroke();
      }
      /* 外圈 */
      ctx.globalAlpha = Math.min(1, ok * 1.2) * 0.75;
      ctx.strokeStyle = 'rgba(96,165,250,1)';
      ctx.lineWidth = Math.max(1.2, R * 0.08);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.06, 0, M.TAU); ctx.stroke();
      ctx.restore();
    }

    /* 金色刀痕（飞雷神瞬移的拖影）：先"扫过"，再从头淡掉 */
    for (i = 0; i < this.trails.length; i++) {
      var tr2 = this.trails[i];
      var tk = tr2.life / tr2.maxLife;              // 1 → 0
      var prog = 1 - tk;                            // 0 → 1
      /* 前 35% 时间：从起点一路扫到终点；之后整条淡出 */
      var sweep = Math.min(1, prog / 0.35);
      var fade = prog > 0.35 ? 1 - (prog - 0.35) / 0.65 : 1;
      var dx = tr2.x2 - tr2.x1, dy = tr2.y2 - tr2.y1;
      var headX = tr2.x1 + dx * sweep, headY = tr2.y1 + dy * sweep;
      /* 刀身：尾巴跟着头部一起推进，形成"刷"过去的感觉 */
      var tailK = Math.max(0, sweep - 0.55);
      var tailX = tr2.x1 + dx * tailK, tailY = tr2.y1 + dy * tailK;

      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = 'rgba(' + tr2.color + ',1)';
      ctx.lineCap = 'round';
      ctx.lineWidth = tr2.w * (0.4 + 0.6 * fade);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();
      /* 中间一条更亮的细线 */
      ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(1, tr2.w * 0.22);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();
      /* 刀尖亮点 */
      ctx.globalAlpha = fade * 0.95;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(headX, headY, tr2.w * 0.28, 0, M.TAU);
      ctx.fill();
    }

    /* 冲击环 */
    for (i = 0; i < this.rings.length; i++) {
      var rg = this.rings[i];
      var aged = rg.maxLife - rg.life;
      var holdAt = rg.expand || rg.maxLife;
      var a;
      if (aged < holdAt) {
        a = 1;                                  // 扩散阶段：保持不透明（看得清它长到多大）
      } else {
        var holdLen = Math.max(0.001, rg.maxLife - holdAt);
        a = Math.max(0, 1 - (aged - holdAt) / holdLen);   // 残影阶段：慢慢淡掉
      }
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = 'rgba(' + rg.color + ',1)';
      ctx.lineWidth = rg.w * (0.5 + 0.5 * a);
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, M.TAU);
      ctx.stroke();
    }

    /* 粒子 */
    for (i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var pk = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, pk * 1.3);
      ctx.fillStyle = 'rgba(' + p.color + ',1)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + pk * 0.6), 0, M.TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 飘字 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < this.numbers.length; i++) {
      var n = this.numbers[i];
      var nk = n.life / n.maxLife;
      ctx.globalAlpha = Math.min(1, nk * 1.6);
      ctx.font = (n.bold ? '700 ' : '500 ') + n.size + 'px "Noto Sans SC","Microsoft YaHei",sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  };

  /* 火焰弓：拉弓 → 放箭 的小动画（灶·开 专用） */
  FX.prototype.drawBow = function (ctx, bo) {
    var k = 1 - bo.life / bo.maxLife;       // 0 → 1
    var released = k > 0.62;
    var pull = released ? 0 : (k / 0.62);   // 拉弦进度
    var alpha = released ? Math.max(0, 1 - (k - 0.62) / 0.38) : Math.min(1, k * 4 + 0.4);

    ctx.save();
    ctx.globalAlpha = alpha;
    /* 弓就架在球上（球就是"弓手"）：弓臂朝目标方向弓出去，弦在身后 */
    ctx.translate(bo.x, bo.y);
    ctx.rotate(bo.ang);

    var R = 84, cx = -52;
    ctx.lineCap = 'round';

    /* 弓身的火光 */
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = 'rgba(249,115,22,0.9)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(cx, 0, R, -1.1, 1.1);
    ctx.stroke();

    /* 弓身 */
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(90,40,12,0.95)';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(cx, 0, R, -1.1, 1.1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(253,186,116,0.95)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(cx, 0, R, -1.1, 1.1);
    ctx.stroke();

    /* 弓身的火舌 */
    for (var fl = 0; fl < 5; fl++) {
      var fa = -1.0 + fl * 0.5;
      var fx2 = cx + Math.cos(fa) * R, fy2 = Math.sin(fa) * R;
      var ph = (k * 9 + fl * 0.37) % 1;
      ctx.globalAlpha = alpha * 0.5 * (1 - ph);
      ctx.fillStyle = fl % 2 ? 'rgba(253,224,71,0.95)' : 'rgba(249,115,22,0.95)';
      ctx.beginPath();
      ctx.arc(fx2, fy2, 7 * (1 - ph * 0.6), 0, M.TAU);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;

    /* 弓弦 */
    var tipX = cx + R * Math.cos(1.1), tipY = R * Math.sin(1.1);
    var nockX = tipX - 52 * pull;
    ctx.strokeStyle = 'rgba(255,244,230,0.9)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(nockX, 0);
    ctx.lineTo(tipX, -tipY);
    ctx.stroke();

    /* 搭在弦上的火焰箭 */
    if (!released) {
      var shaftLen = 104;
      ctx.strokeStyle = 'rgba(90,50,20,0.98)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(nockX, 0);
      ctx.lineTo(nockX + shaftLen, 0);
      ctx.stroke();
      var fg = ctx.createRadialGradient(nockX + shaftLen + 10, 0, 2, nockX + shaftLen + 10, 0, 34);
      fg.addColorStop(0, 'rgba(255,255,255,0.98)');
      fg.addColorStop(0.32, 'rgba(253,224,71,0.95)');
      fg.addColorStop(0.68, 'rgba(249,115,22,0.85)');
      fg.addColorStop(1, 'rgba(220,38,38,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(nockX + shaftLen + 10, 0, 34, 0, M.TAU);
      ctx.fill();
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.moveTo(nockX + shaftLen + 26, 0);
      ctx.lineTo(nockX + shaftLen + 2, 11);
      ctx.lineTo(nockX + shaftLen + 8, 0);
      ctx.lineTo(nockX + shaftLen + 2, -11);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(248,113,113,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(nockX + 6, 0); ctx.lineTo(nockX + 26, 12);
      ctx.moveTo(nockX + 6, 0); ctx.lineTo(nockX + 26, -12);
      ctx.stroke();
    } else {
      var rk = (k - 0.62) / 0.38;
      ctx.globalAlpha = alpha * (1 - rk);
      ctx.strokeStyle = 'rgba(253,224,71,0.95)';
      ctx.lineWidth = 7 * (1 - rk);
      ctx.beginPath();
      ctx.arc(tipX, 0, 18 + 70 * rk, 0, M.TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3 * (1 - rk);
      ctx.beginPath();
      ctx.arc(tipX, 0, 10 + 40 * rk, 0, M.TAU);
      ctx.stroke();
    }

    ctx.restore();
  };

  /* 全屏闪屏（canvas 像素坐标） */
  /* 圆角矩形路径（拳头的形状基础） */
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* 迳庭拳的拳：深蓝黑的拳头 + 青蓝色描边 + 来向速度线 */
  FX.prototype.drawFist = function (ctx, f) {
    var k = f.life / f.maxLife;                  // 1 → 0
    var pop = Math.min(1, (1 - k) / 0.18);       // 前 18% 快速弹出
    var s = (0.98 + 0.55 * pop) * (0.78 + 0.22 * k);

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.ang);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.min(1, k * 2.4);
    ctx.lineCap = 'round';

    /* 来向速度线 */
    ctx.strokeStyle = 'rgba(125,211,252,0.5)';
    for (var i = -1; i <= 1; i++) {
      ctx.lineWidth = 3.4 - Math.abs(i);
      ctx.beginPath();
      ctx.moveTo(-30, i * 16);
      ctx.lineTo(-30 - (46 + Math.abs(i) * 12) * (0.55 + 0.45 * k), i * 16);
      ctx.stroke();
    }

    /* 拳本体 */
    var g = ctx.createLinearGradient(-26, -30, 26, 30);
    g.addColorStop(0, '#26405F');
    g.addColorStop(0.5, '#111D30');
    g.addColorStop(1, '#05080F');
    ctx.fillStyle = g;
    roundRectPath(ctx, -24, -26, 48, 52, 13);
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,211,252,0.92)';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 四个指节 */
    for (var j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(-13 + j * 9, -28, 5.4, 0, Math.PI * 2);
      ctx.fillStyle = '#0A1220';
      ctx.fill();
      ctx.strokeStyle = 'rgba(125,211,252,0.6)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    /* 拳心的咒力核 */
    var cg = ctx.createRadialGradient(1, 3, 1, 1, 3, 22);
    cg.addColorStop(0, 'rgba(200,238,255,0.95)');
    cg.addColorStop(0.42, 'rgba(80,150,230,0.55)');
    cg.addColorStop(1, 'rgba(20,40,80,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(1, 3, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  FX.prototype.drawOverlay = function (ctx, W, H) {    if (this.flashA <= 0.002) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, this.flashA);
    ctx.fillStyle = 'rgb(' + this.flashColor + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  function hexToRgb(hex) {
    if (!hex) return '43,43,43';
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  }

  SH.FX = FX;
  SH.hexToRgb = hexToRgb;
})();
