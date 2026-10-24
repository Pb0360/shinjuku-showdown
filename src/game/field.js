/* 领域 / 场地效果（无量空处、伏魔御厨子）
 * 每隔 interval 秒结算一次，可以是一次性多段（无量空处）或持续区域（伏魔御厨子）
 */
(function () {
  var SH = (window.SH = window.SH || {});

  var _id = 0;

  function Field(kind, owner, x, y, spec) {
    this.id = ++_id;
    this.kind = kind;
    this.owner = owner;      // 施法者的球 index
    this.charId = spec.charId;
    this.x = x; this.y = y;  // 释放瞬间锁定的位置（之后不跟随）
    this.radius = spec.radius || 0;

    this.age = 0;
    this.life = spec.duration || (spec.ticks * spec.interval) || 1;
    this.interval = spec.interval || 0.1;
    this.timer = 0;
    this.ticksLeft = spec.ticks || Infinity;

    this.damage = spec.damage || 0;
    this.type = spec.type || 'barrage';
    this.refSkill = spec.refSkill || null;
    this.refAmount = spec.refAmount || null;
    this.damageRatio = spec.damageRatio || 0;

    this.tickCount = 0;
    this.totalDamage = 0;
    this.dead = false;
    this.follows = !!spec.follows; // 默认 false：锁定释放位置
    this.voiceKey = spec.voiceKey || null;

    /* 佩恩的引力场扩展 */
    this.attract = spec.attract || null;   // {radius, accelBall, accelProj, falloff}
    this.core = spec.core || null;         // 地爆天星：球体参数（含剥岩石设置）
    this.vx = spec.vx || 0;                // 会飞的领域
    this.vy = spec.vy || 0;
    this.drag = spec.drag === undefined ? 2.0 : spec.drag;
    this.r = spec.r || 40;
    this.rocks = null;
    this.rockTimer = 0;
  }

  Field.prototype.tickDamage = function () {
    if (this.damageRatio > 0 && this.refSkill) {
      var ch = SH.CHARACTERS[this.charId];
      var sk = null;
      for (var i = 0; i < ch.skills.length; i++) if (ch.skills[i].id === this.refSkill) sk = ch.skills[i];
      if (sk) {
        var amount = this.refAmount.split('.').reduce(function (o, k) { return o[k]; }, sk);
        return amount * this.damageRatio;
      }
    }
    return this.damage;
  };

  SH.Field = Field;
  SH.makeField = function (kind, owner, x, y, spec) { return new Field(kind, owner, x, y, spec); };
})();
