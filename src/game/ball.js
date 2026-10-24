/* 角色球：状态、技能充能 / CD、被动计时
 * 纯逻辑，不碰 DOM，可在 Node 无头环境里跑
 */
(function () {
  var SH = (window.SH = window.SH || {});

  /* ------------------------------------------------------------------
   * 技能状态：两种形态
   *   charge   —— 充能型（如 苍/赫 2 点、无下限 3 点）
   *   cooldown —— 冷却型（如 解 2.2s、无量空处 40s）
   * ------------------------------------------------------------------ */
  function SkillState(data) {
    this.data = data;
    this.max = data.cdType === 'charge' ? data.charges : 1;
    this.charges = data.cdType === 'charge' ? data.charges : 0; // 充能型：当前可用点数
    this.recharge = 0;   // 充能型：距离下一点充能完成的秒数（0 = 停表）
    this.cd = 0;         // 冷却型：剩余 CD 秒数
    this.cdOverride = 0; // 本次 CD 覆盖值（宿傩 解/捌 用不同 CD）
    this.used = 0;       // 释放次数统计
    this.readyFlash = 0; // 刚转好时的高亮计时（纯表现）
    this.castCd = 0;     // 「释放冷却」：和充能点恢复互相独立（佩恩神罗天征用）
  }

  SkillState.prototype.isReady = function () {
    /* 飞雷神二段这类"免费施放"：没有充能点也允许（只看释放冷却） */
    if (this.freeCast) return this.cd <= 0;
    if (this.castCd > 0) return false;          // 释放冷却中（和充能点无关）
    if (this.data.cdType === 'charge') return this.charges > 0;
    return this.cd <= 0;
  };

  SkillState.prototype.consume = function () {
    if (this.freeCast) { this.castCd = this.data.castCd || 0; this.stats && 0; return; }
    this.used++;
    if (this.data.cdType === 'charge') {
      this.charges--;
      if (this.recharge <= 0 && this.charges < this.max) this.recharge = this.chargeTime();
      this.readyFlash = 0;
    } else {
      this.cd = this.cdMax();
      this.readyFlash = 0;
    }
  };

  /* 当前实际使用的 CD 值（宿傩一技能 解/捌 的 CD 不同） */
  SkillState.prototype.cdMax = function () { return this.cdOverride || this.data.cd; };

  SkillState.prototype.chargeTime = function () {
    return this.data.chargeTime || 1;
  };

  SkillState.prototype.tick = function (dt) {
    if (this.castCd > 0) this.castCd = Math.max(0, this.castCd - dt);
    if (this.readyFlash > 0) this.readyFlash = Math.max(0, this.readyFlash - dt);

    if (this.data.cdType === 'charge') {
      if (this.charges < this.max) {
        var wasReady = this.charges > 0;
        this.recharge -= dt;
        if (this.recharge <= 0) {
          this.charges++;
          this.recharge = (this.charges < this.max) ? this.chargeTime() : 0;
          if (this.charges > 0 && !wasReady) this.readyFlash = 0.4;
        }
      } else {
        this.recharge = 0;
      }
    } else {
      if (this.cd > 0) {
        this.cd -= dt;
        if (this.cd <= 0) { this.cd = 0; this.readyFlash = 0.4; }
      }
    }
  };

  /* 领域展延：给当前 CD / 充能进度加时间 */
  SkillState.prototype.pushCd = function (sec) {
    if (this.data.cdType === 'charge') {
      if (this.charges < this.max) this.recharge += sec;
    } else {
      if (this.cd > 0) this.cd += sec;
    }
  };

  /* 黑闪：CD 全恢复 */
  SkillState.prototype.resetAll = function () {
    if (this.data.cdType === 'charge') { this.charges = this.max; this.recharge = 0; }
    else this.cd = 0;
    this.readyFlash = 0.6;
  };

  /* 给 UI 用：0 = 完全没好，1 = 可用 */
  SkillState.prototype.readiness = function () {
    if (this.data.cdType === 'charge') {
      if (this.charges > 0) return 1;
      return 1 - SH.M.clamp(this.recharge / this.chargeTime(), 0, 1);
    }
    if (this.cd <= 0) return 1;
    return 1 - SH.M.clamp(this.cd / this.cdMax(), 0, 1);
  };

  /* ------------------------------------------------------------------
   * 球体
   * ------------------------------------------------------------------ */
  function Ball(char, index, side, isClone) {
    this.id = index;                 // 在 match.balls 里的唯一下标（不要移除元素，死了也留着）
    this.side = (side === undefined) ? index : side;   // 阵营：0 = 玩家方，1 = AI 方
    this.isClone = !!isClone;        // 是不是分身
    this.ownerId = this.isClone ? null : index;        // 分身挂在本体上（Match 里补）
    this.char = char;
    this.rng = SH.M.mulberry32((index + 1) * 2246822519); // Match 会注入真正的种子流
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.r = char.radius;
    this.maxHp = char.hp;
    this.hp = char.hp;
    this.alive = true;

    this.skills = [];
    for (var i = 0; i < char.skills.length; i++) this.skills.push(new SkillState(char.skills[i]));

    this.status = {
      burn: null,            // {dps, until, type, source}
      immunityUntil: -1,     // 无下限术式：免疫结束时刻（-1 = 未激活）
      immunityStart: -1,     // 本次免疫的起始时刻（用于延长到 0.5s）
      immunityBig: false,    // 是否已触发"挡下伤害"的加强版
      immunityBlocks: 0,     // 挡下次数（统计）
      tenkaiHits: 0,         // 被领域展延强化命中次数（统计）
      bindUntil: -1,         // 无量空处：定身结束时刻（不能移动、不能放技能）
      guaranteedBlackFlash: 0, // 虎杖大招：还剩几次"必定黑闪"
      charmUntil: -1,        // 鸣人色诱术：结束时刻（期间非直伤转为治疗）
      rootUntil: -1,         // 佩恩超·神罗天征：结束时刻（期间本体原地不动）
      sealed: false,         // 地爆天星：是否正被封在球心
      bindRod: false,
      invulnUntil: 0,        // 完全无敌（蝠群）
      batUntil: 0,           // 蝠群盘旋中
      bindSource: null,      // 这次定身是谁造成的（决定用哪套表现）        // 是否被黑棒钉住（用黑棒自己的表现，不用无量空处的笼子）
    };

    this.lastDamageAt = -999; // 最后一次受伤时刻（反转术式判定用）
    this.healTimer = char.passive && char.passive.interval ? char.passive.interval : 2;
    this.skillLock = 0;       // 出手硬直
    this.flash = 0;           // 受击白闪计时（表现）
    this.immuneGlow = 0;      // 免疫光圈计时（表现）
    this.blackFlashes = 0;
    this.dr = 0;             // 受伤减免（变大球被动）

    /* 统计（结算界面用） */
    this.stats = {
      damageDealt: 0,
      damageTaken: 0,
      healed: 0,
      bySkill: {},   // skillId -> 造成的伤害
      casts: 0
    };
  }

  Ball.prototype.hpRatio = function () {
    return SH.M.clamp(this.hp / this.maxHp, 0, 1);
  };

  Ball.prototype.skill = function (i) { return this.skills[i]; };

  Ball.prototype.speed = function () { return Math.hypot(this.vx, this.vy); };

  /* 记录一次伤害归属（结算界面） */
  Ball.prototype.creditDamage = function (skillId, amount) {
    this.stats.damageDealt += amount;
    if (skillId) this.stats.bySkill[skillId] = (this.stats.bySkill[skillId] || 0) + amount;
  };

  Ball.prototype.heal = function (amount, source) {
    if (!this.alive) return 0;
    var before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    var got = this.hp - before;
    this.stats.healed += got;
    return got;
  };

  /* 黑闪的"技能 CD 全清"。
   * ⚠ 大招呼略：否则虎杖的「黑闪(大招) → 迳庭拳 → 必定黑闪 → CD 全清 → 黑闪…」
   * 会变成无限循环（实测每局 4.2 次黑闪、100% 对局触发）。 */
  Ball.prototype.resetCooldowns = function (exceptId) {
    for (var i = 0; i < this.skills.length; i++) {
      if (this.skills[i].data.ultimate) continue;
      /* 例外：黑闪不能清掉【黑闪自己】的 CD，否则虎杖可以无限接黑闪 */
      if (exceptId && this.skills[i].data.id === exceptId) continue;
      this.skills[i].resetAll();
    }
  };

  Ball.prototype.isImmune = function (t) {
    return this.status.immunityUntil > t;
  };

  /* 被定身：不能移动、不能放技能 */
  Ball.prototype.isBound = function (t) {
    return this.status.bindUntil > t;
  };

  SH.SkillState = SkillState;
  SH.Ball = Ball;
  SH.newBall = function (charId, index, side, isClone) {
    return new Ball(SH.CHARACTERS[charId], index, side, isClone);
  };
})();
