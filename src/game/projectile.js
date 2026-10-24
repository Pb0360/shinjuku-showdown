/* 飞行物（苍 / 赫 / 茈 / 解 / 捌 / 灶·开 的箭）
 * 只负责"是什么"，运动与命中判定在 match.js 里统一处理
 */
(function () {
  var SH = (window.SH = window.SH || {});

  var _id = 0;

  function Projectile(o) {
    this.id = ++_id;
    this.kind = o.kind;
    this.owner = o.owner;       // 归属球的 index（反弹后会改）
    this.charId = o.charId;

    this.x = o.x; this.y = o.y;
    this.vx = o.vx || 0; this.vy = o.vy || 0;
    this.r = o.r || 10;
    this.r0 = this.r;
    this.growTo = o.growTo || 0;   // 茈：膨胀目标半径
    this.growTime = o.growTime || 0;

    this.age = 0;
    this.life = o.life || 2;
    this.dead = false;

    this.hit = o.hit || null;      // {amount, type, interval?}
    this.hitTimes = {};            // targetId -> 上次命中时刻
    this.hitCounts = {};           // targetId -> 命中次数（网格用）
    this.totalHits = 0;

    this.explode = o.explode || null;
    this.attract = o.attract || null;
    this.burn = o.burn || null;

    this.homing = o.homing || 0;   // 追踪转向强度（螺旋丸）
    this.bounceOnWall = !!o.bounceOnWall;
    this.onWall = o.onWall || 'disappear';
    this.onHit = o.onHit || 'disappear';

    /* 一字型斩击：沿 dir 方向前进的"移动刀刃" */
    this.dirx = o.dirx || 0;
    this.diry = o.diry || 0;
    this.halfLen = o.halfLen || 0;
    this.width = o.width || 0;

    /* 网格斩击 */
    this.cells = o.cells || null;   // [{x,y,w,h,hit}]
    this.maxHits = o.maxHits || 0;
    this.totalCellHits = 0;

    this.reflected = !!o.reflected; // 被无下限反弹过（不再二次反弹）
    this.voiceKey = o.voiceKey || null;
    this.skillId = o.skillId || o.kind; // 伤害归属（结算界面 / 免疫判定）
    this.cellPad = o.cellPad || 32;     // 网格判定外扩（让贴边格也能结算）
    this.spin = 0;                  // 表现用自转角
    this.trail = [];                // 表现用拖尾（渲染层写入）
  }

  /* 敌对判定按【阵营】而不是"是不是我"：
   * 这样鸣人的分身不会挡下本体自己的弹幕，对手的弹幕也能打到任意分身。
   * ownerSide 由 Match.addProjectile 注入（老代码只传 ballIndex 的场合会自动兜底）。 */
  Projectile.prototype.isHostileTo = function (ball) {
    if (ball === null || ball === undefined) return false;
    if (typeof ball === 'number') return this.owner !== ball;   // 兼容旧调用
    if (this.ownerSide === undefined || this.ownerSide === null) return this.owner !== ball.id;
    return this.ownerSide !== ball.side;
  };

  Projectile.prototype.canHit = function (ballIndex, t) {
    if (!this.hit) return false;
    var last = this.hitTimes[ballIndex];
    if (last === undefined) return true;
    var interval = this.hit.interval || 999; // 无 interval = 单段
    return (t - last) >= interval;
  };

  Projectile.prototype.markHit = function (ballIndex, t) {
    this.hitTimes[ballIndex] = t;
    this.hitCounts[ballIndex] = (this.hitCounts[ballIndex] || 0) + 1;
    this.totalHits++;
  };

  /* ------------------------------------------------------------------
   * 构造助手
   * ------------------------------------------------------------------ */

  /* 多段伤害的飞行物默认不会因为命中而消失 */
  function defaultOnHit(spec) {
    if (spec.onHit) return spec.onHit;
    return (spec.hit && spec.hit.interval) ? 'pass' : 'disappear';
  }

  /* 圆形弹（苍 / 赫 / 茈 / 箭） */
  SH.makeOrb = function (kind, owner, x, y, dir, spec, extra) {
    extra = extra || {};
    /* 注意：速度 0 是合法值（原地的茈），不能用 || 兜底 */
    var sp = (spec.speed === undefined || spec.speed === null) ? 200 : spec.speed;
    var o = {
      kind: kind, owner: owner, charId: extra.charId,
      x: x, y: y,
      vx: dir.x * sp, vy: dir.y * sp,
      r: spec.r, life: spec.life,
      growTo: spec.growTo, growTime: spec.growTime,
      hit: spec.hit || null,
      explode: spec.explode || null,
      attract: spec.attract || null,
      burn: spec.burn || null,
      homing: spec.homing || 0,
    bounceOnWall: !!spec.bounceOnWall,
      onWall: spec.onWall || 'disappear',
      onHit: defaultOnHit(spec),
      voiceKey: spec.voiceKey || null,
      skillId: extra.skillId || kind
    };
    return new Projectile(o);
  };

  /* 一字型斩击：垂直于前进方向的刀刃 */
  SH.makeSlash = function (owner, x, y, dir, spec, extra) {
    extra = extra || {};
    var sp = spec.speed || 1600;
    return new Projectile({
      kind: 'slash', owner: owner, charId: extra.charId,
      x: x, y: y,
      vx: dir.x * sp, vy: dir.y * sp,
      dirx: dir.x, diry: dir.y,
      halfLen: spec.halfLen, width: spec.width,
      r: spec.width / 2,
      life: spec.life || 1.0,
      hit: spec.hit, onWall: spec.onWall || 'disappear', onHit: spec.onHit || 'disappear',
      voiceKey: spec.voiceKey || null,
      skillId: extra.skillId || 'slash'
    });
  };

  /* 网格斩击：以 aim 为中心展开 3×3；cornerAligned 时瞄准点落在四格交点上 */
  SH.makeGrid = function (owner, ax, ay, spec, extra) {
    extra = extra || {};
    var n = spec.cells || 3;
    var cs = spec.cell || 90;
    var half = n * cs / 2;
    var ox = ax, oy = ay;
    if (spec.cornerAligned) { ox = ax - cs / 2; oy = ay - cs / 2; }
    var cells = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        cells.push({
          x: ox + (c - (n - 1) / 2) * cs,
          y: oy + (r - (n - 1) / 2) * cs,
          w: cs, h: cs,
          hit: false
        });
      }
    }
    return new Projectile({
      kind: 'grid', owner: owner, charId: extra.charId,
      x: ox, y: oy,
      r: half,
      life: spec.life || 0.15,
      hit: spec.hit,
      cells: cells,
      maxHits: spec.maxHits || 4,
      cellPad: spec.cellPad || 32,
      /* ★ 必须用 pass：网格要留在场上把 maxHits 格全部结算完，
       *   用 disappear 会变成"命中第一格就消失"，4 格伤害永远打不出来 */
      onWall: 'disappear', onHit: 'pass',
      voiceKey: spec.voiceKey || null,
      skillId: extra.skillId || 'grid'
    });
  };

  SH.Projectile = Projectile;
})();
