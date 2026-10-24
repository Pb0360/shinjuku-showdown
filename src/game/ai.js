/* 系统 AI —— 固定一档难度
 * 它【只决定什么时候按技能】，不改任何数值，也不作弊（不知道随机数结果）
 * 唯一的"优势"是它也能用部分预判瞄准，和玩家完全一样
 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  function AI(match, ballIndex) {
    this.m = match;
    this.idx = ballIndex;
    this.ball = match.balls[ballIndex];
    this.cfg = SH.CONFIG.ai;
    this.think = 0;
    this.rng = match.balls[ballIndex].rng;  // 用自己那条流，避免和对手耦合
    this.ball.aimNoise = this.cfg.aimNoise;
  }

  /* ------------------------------------------------------------------
   * 两阶段决策
   *   prepare(dt) 只判断"想放哪个技能"，不改动世界
   *   commit()    统一释放
   * 这样两边的 AI 永远基于同一份局面做判断，不会有"后手多看一眼"的不公平
   * ------------------------------------------------------------------ */
  AI.prototype.update = function (dt) {
    this.prepare(dt);
    this.commit();
  };

  AI.prototype.prepare = function (dt) {
    this.pending = this.decide(dt);
  };

  /* 准备阶段判定完了，这里只做"最后一次统一校验"：
   * 两颗球都用同一份出手前状态检查"够不够得着"，避免先出手的一方
   * 把对手击飞出射程、导致 1 号槽位这一拍白丢（虎杖内战胜率 41% 就是这个原因） */
  /* 决策结果可以是：
   *   数字              → 直接放这个槽位
   *   { idx, charged }  → 放这个槽位，并且按"长按版"释放（佩恩的神罗天征） */
  AI.prototype.pendingIdx = function () {
    var p = this.pending;
    if (p === null || p === undefined) return -1;
    return (typeof p === 'object') ? p.idx : p;
  };

  AI.prototype.canCommit = function () {
    var i = this.pendingIdx();
    if (i < 0) return false;
    return this.m.canCastSkill(this.ball, i);
  };

  AI.prototype.commit = function () {
    var i = this.pendingIdx();
    if (i < 0) return;
    var charged = (typeof this.pending === 'object') && !!this.pending.charged;
    this.pending = null;
    /* skipCanCast：上面已经用统一状态校验过了，这里不再重判 */
    this.m.castSkill(this.ball, i, { skipCanCast: true, charged: charged });
  };

  /* 返回要释放的技能下标，或 null */
  AI.prototype.decide = function (dt) {
    var m = this.m, b = this.ball;
    if (m.phase !== 'fight' || !b.alive) return null;
    if (b.isBound(m.t)) return null;           // 被定身：这一拍什么都做不了

    this.think -= dt;
    if (this.think > 0) return null;
    this.think = this.cfg.thinkInterval;

    var opp = m.balls[1 - this.idx];
    if (!opp.alive) return null;
    var dist = M.dist(b.x, b.y, opp.x, opp.y);

    /* 按“技能槽位”找下标，而不是硬编码数组位置 ——
     * 这样只有一个技能、或者没有二技能的角色（虎杖）也能正常跑 */
    var bySlot = {};
    var ultIdx = -1;
    for (var i = 0; i < b.skills.length; i++) {
      var d = b.skills[i].data;
      bySlot[d.slot] = i;
      if (d.ultimate) ultIdx = i;
    }
    var ready = function (slot) {
      var k = bySlot[slot];
      return k !== undefined && b.skills[k].isReady() ? k : -1;
    };

    /* 1. 先保命：五条悟用无下限术式吃掉即将命中的弹幕 */
    var i2 = ready(2);
    if (b.char.id === 'gojo' && i2 >= 0 && this.shouldImmune(opp)) {
      if (b.skillLock <= 0) return i2;
    }

    /* 2. 大招（没有二技能的角色，大招就在 1 或 2 槽上） */
    if (ultIdx >= 0 && b.skills[ultIdx].isReady()) {
      var ultSlot = b.skills[ultIdx].data.slot;
      if (b.char.id === 'gojo') return ultIdx;            // 必中 100 点，一好就放
      if (b.char.id === 'yuji') return ultIdx;            // 状态类，早放早攒着
      if (dist <= 270) return ultIdx;                     // 宿傩：确保敌人在圈里
    }

    /* 3. 鸣人：分身铺场 → 搓丸子 → 挨打时开色诱术 */
    var i1 = ready(1);
    if (b.char.id === 'naruto') {
      var n2 = ready(2), n3 = ready(3);
      /* 有分身就搓丸子（伤害最高） */
      if (n3 >= 0 && b.skillLock <= 0 && m.canCastSkill(b, n3)) return n3;
      /* 血少，或者预测到马上要挨弹幕 → 色诱术把伤害转成治疗 */
      if (n2 >= 0 && b.skillLock <= 0 && (b.hp / b.maxHp < 0.72 || this.shouldImmune(opp))) return n2;
      /* 补分身，但【别把本体上限压到 300 以下】——没有本体就没有胜负判定，
       * 无脑分身等于把 1000 点血量白送成 10 个 100 血的靶子 */
      if (i1 >= 0 && b.skillLock <= 0) {
        var per = m.cloneHpEach(b.char);
        if (b.maxHp - per >= 300) return i1;
      }
      return null;
    }

    /* 3.9 水门：没苦无就先丢；有苦无就瞬移过去打；敌人近身时用长按拉开 */
    if (b.char.id === 'minato') {
      var i1m = ready(1), i2m = ready(2);
      var myKunai = m.kunaiCount(b.side);
      /* 飞雷神二段窗口：直接接上 */
      if (i2m >= 0 && b.skillLock <= 0 && b.status.hiraishinUntil > m.t && myKunai >= 2) {
        return { idx: i2m, charged: true };
      }
      /* 没苦无 → 先丢一枚 */
      if (myKunai < 1 && i1m >= 0 && b.skillLock <= 0) return { idx: i1m, charged: false };
      /* 有苦无 + 敌人不在身边 → 瞬移过去 */
      if (i2m >= 0 && b.skillLock <= 0 && m.canCastSkill(b, i2m) && dist > 220) {
        return { idx: i2m, charged: false };
      }
      /* 满了 2 枚还够得着 → 短按丢（毁掉更早的那枚） */
      if (i1m >= 0 && b.skillLock <= 0 && myKunai >= 2 && dist < 260) {
        return { idx: i1m, charged: false };
      }
      if (i1m >= 0 && b.skillLock <= 0 && myKunai < 2) return { idx: i1m, charged: false };
      return null;
    }

    /* 4. 虎杖：迳庭拳（够不着就别挥，canCast 会给出准确判断） */
    if (b.char.id === 'yuji') {
      if (i1 >= 0 && b.skillLock <= 0 && m.canCastSkill(b, i1)) return i1;
      return null;                                        // 没别的技能了
    }

    /* 4.5 佩恩：先万象天引把对手拉进节奏 → 神罗天征弹开/接超神罗 → 大招 */
    if (b.char.id === 'pain') {
      var p2 = ready(2), p3s = ready(3);
      /* 对手贴脸 → 短按神罗把人弹飞（也顺手把弹幕清掉） */
      if (p2 >= 0 && b.skillLock <= 0 && dist < 150) {
        return { idx: p2, charged: false };
      }
      /* 预测到要挨弹幕 → 短按神罗免疫 0.2 秒 */
      if (p2 >= 0 && b.skillLock <= 0 && this.shouldImmune(opp)) {
        return { idx: p2, charged: false };
      }
      /* 场上有弹幕、或者对手中距离 → 超·神罗打一片（多段伤害） */
      if (p2 >= 0 && b.skillLock <= 0 && m.projectiles.length >= 2 && dist < 340) {
        return { idx: p2, charged: true };
      }
      /* 一技能：把对手吸过来，方便接神罗 */
      if (i1 >= 0 && b.skillLock <= 0) return i1;
      /* 神罗还有充能就交掉 */
      if (p2 >= 0 && b.skillLock <= 0) return { idx: p2, charged: dist < 340 };
      return null;
    }

    /* 5. 中段技能（宿傩 灶·开 / 五条 无下限的进攻性使用） */
    if (b.char.id === 'sukuna' && i2 >= 0 && this.rng() < this.cfg.readyGate) {
      return i2;
    }

    /* 6. 一技能（充能/短 CD 的常规输出） */
    if (i1 >= 0 && this.rng() < this.cfg.readyGate) return i1;

    return null;
  };

  /* 预测：未来 reactWindow 秒内会不会被弹幕打到 */
  AI.prototype.shouldImmune = function (opp) {
    var m = this.m, b = this.ball;
    var st = null;
    for (var s = 0; s < b.skills.length; s++) {
      if (b.skills[s].data.slot === 2) { st = b.skills[s]; break; }
    }
    if (!st || !st.isReady()) return false;
    if (b.status.immunityUntil > m.t) return false;

    var W = this.cfg.reactWindow;
    var margin = this.cfg.reactMissMargin;
    var list = m.projectiles;

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.dead || !p.isHostileTo(b) || !p.hit) continue;
      if (p.hit.type !== 'barrage') continue;   // 直伤免疫不了，不浪费

      if (p.kind === 'slash') {
        /* 移动刀刃：算还要多久扫到自己 */
        var dx = b.x - p.x, dy = b.y - p.y;
        var along = dx * p.dirx + dy * p.diry;
        var perp = -dx * p.diry + dy * p.dirx;
        if (Math.abs(perp) > p.halfLen + b.r) continue;
        var sp = Math.hypot(p.vx, p.vy) || 1;
        var tt = along / sp;
        if (tt > -0.05 && tt <= W) return true;
        continue;
      }

      /* 圆形飞行物：最近接近距离 */
      var relx = p.x - b.x, rely = p.y - b.y;
      var rvx = p.vx - b.vx, rvy = p.vy - b.vy;
      var vv = rvx * rvx + rvy * rvy;
      var tc = vv < 1 ? 0 : -(relx * rvx + rely * rvy) / vv;
      if (tc < 0 || tc > W) continue;
      var mx = relx + rvx * tc, my = rely + rvy * tc;
      if (Math.hypot(mx, my) <= b.r + p.r + margin) return true;
    }
    return false;
  };

  SH.AI = AI;
})();
