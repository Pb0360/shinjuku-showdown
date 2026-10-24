/* ==========================================================================
 * 对局核心 —— 纯逻辑，无 DOM 依赖
 * 可以在浏览器里跑，也可以在 Node 里以固定步长无头批量模拟（tools/sim.js）
 *
 * 流程： countdown → fight → over
 * 职责： 球的运动与墙反弹 / 球球碰撞与黑闪 / 飞行物运动与命中 / 领域结算 /
 *        伤害类型判定（弹幕 vs 直伤）/ 无下限免疫 / 领域展延 / 被动回复
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  function circleRect(cx, cy, cr, rx, ry, rw, rh, pad) {
    pad = pad || 0;
    var hw = rw / 2 + pad, hh = rh / 2 + pad;
    var nx = M.clamp(cx, rx - hw, rx + hw);
    var ny = M.clamp(cy, ry - hh, ry + hh);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= cr * cr;
  }

  function Match(opts) {
    opts = opts || {};
    this.cfg = SH.CONFIG;
    this.seed = (opts.seed === undefined) ? (Math.floor(Math.random() * 0x7fffffff)) : opts.seed;
    this.rng = M.mulberry32(this.seed);

    this.balls = [
      SH.newBall(opts.p1 || 'gojo', 0, 0, false),
      SH.newBall(opts.p2 || 'sukuna', 1, 1, false)
    ];
    /* 本体的下标（分身会被追加到 balls 末尾，索引不会变） */
    this.mains = [0, 1];

    /* ★ 每个球一条独立随机数流：
     *   否则双方共用一条流时，"谁先决策"会影响对方看到的随机数，
     *   镜像对局里会产生明显的槽位优势（实测 17 个百分点的不公平）。
     *   种子用「乘一个奇数再异或」打散，避免两个球的流在开头就相关。 */
    for (var bi = 0; bi < this.balls.length; bi++) {
      var mixed = ((this.seed * 2654435761) + (bi + 1) * 0x9E3779B1) >>> 0;
      this.balls[bi].rng = M.mulberry32(mixed);
    }

    /* 大招（领域展开）开局带随机初始 CD，避免开局就互放大招 */
    var ultCd = this.cfg.ultimateInitialCd;
    if (ultCd) {
      for (var bj = 0; bj < this.balls.length; bj++) {
        var bb = this.balls[bj];
        for (var sj = 0; sj < bb.skills.length; sj++) {
          var sd = bb.skills[sj].data;
          if (sd.ultimate && sd.cdType === 'cooldown') {
            bb.skills[sj].cd = M.rand(bb.rng, ultCd.min, ultCd.max);
          }
        }
      }
    }

    this.projectiles = [];
    this.fields = [];
    this.rasengans = [];     // 鸣人：握在手上的螺旋丸（每对球一颗）
    this._kunaiId = 0;        // 苦无 id 计数器（必须初始化，否则 ++undefined = NaN）
    this.kunai = [];          // 水门：留在场上的飞雷神苦无
    this.hiraishinDance = null; // 水门大招的连段状态
    this.events = [];
    this.pairCd = {};

    this.t = 0;
    this.phase = 'countdown';
    this.countdownT = this.cfg.countdown;
    this.winner = null;      // 0 / 1 / -1(平局)
    this.timeScale = 1;      // 由特效层写入，无头模拟时恒为 1
    this.collisions = 0;
    this.blackFlashTotal = 0;
    this.startedAt = 0;

    this.spawnBalls();
  }

  /* ------------------------------------------------------------------
   * 开局摆位
   * ------------------------------------------------------------------ */
  Match.prototype.spawnBalls = function () {
    var size = this.cfg.arena.size;
    var bcfg = this.cfg.ball;
    var pad = bcfg.spawnPadding;
    var a = this.balls[0], b = this.balls[1];
    var tries = 0, ok = false;
    while (tries++ < 200 && !ok) {
      a.x = M.rand(this.rng, pad, size - pad);
      a.y = M.rand(this.rng, pad, size - pad);
      b.x = M.rand(this.rng, pad, size - pad);
      b.y = M.rand(this.rng, pad, size - pad);
      ok = M.dist(a.x, a.y, b.x, b.y) >= bcfg.spawnMinGap;
    }
    var i, ang;
    for (i = 0; i < 2; i++) {
      var ball = this.balls[i];
      ang = M.rand(this.rng, 0, M.TAU);
      // 初速方向统一朝向场地中心附近，避免开局贴着墙磨
      var toCx = size / 2 - ball.x, toCy = size / 2 - ball.y;
      var ca = Math.atan2(toCy, toCx) + M.rand(this.rng, -0.9, 0.9);
      if (this.rng() < 0.5) ca = ang;
      var v0 = bcfg.startSpeed * this.speedMulOf(ball);
      ball.vx = Math.cos(ca) * v0;
      ball.vy = Math.sin(ca) * v0;
    }
    
    this.placeStartKunai();   // 金色闪光：开局自带苦无（必须在球创建之后）
  };

  /* 移动速度倍率（被动，例如虎杖 +30%） */
  Match.prototype.speedMulOf = function (ball) {
    return (ball && ball.char.speedMul) || (ball && ball.char.passive && ball.char.passive.speedMul) || 1;
  };

  /* 被动「金色闪光」：开局在出生点自带飞雷神苦无 */
  Match.prototype.placeStartKunai = function () {
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      var n = (b.char.passive && b.char.passive.startKunai) || 0;
      for (var k = 0; k < n; k++) this.addPlacedKunai(b, b.x, b.y, {});
    }
  };

  /* ------------------------------------------------------------------
   * 阵营相关的小工具（支持"每方多颗球"）
   * ------------------------------------------------------------------ */
  /* 某一方的本体 */
  Match.prototype.mainOf = function (side) {
    var idx = this.mains[side];
    return this.balls[idx];
  };

  Match.prototype.aliveOfSide = function (side) {
    var out = [];
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (b.alive && b.side === side) out.push(b);
    }
    return out;
  };

  /* 选攻击目标：优先打【敌方本体】。
   * 这是被数据逼出来的规则：如果只按"最近的"选，鸣人的分身会变成纯粹的伤害护盾 ——
   * 对手的弹幕全打在分身上，本体几乎不掉血，实测对局被拖到 129 秒、25% 的对局打不完。
   * 改成瞄本体后：超时 24.6% → 3.2%，时长 129s → 90s。
   * （弹幕在物理上仍然会被路径上的分身挡下，所以分身还是有肉盾价值的） */
  Match.prototype.nearestEnemy = function (ball) {
    var main = this.mainOf(1 - ball.side);
    if (main && main.alive) return main;
    var best = null, bestD = Infinity;
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (!b.alive || b.side === ball.side) continue;
      var d = M.dist2(ball.x, ball.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) return best;
    return this.mainOf(1 - ball.side);
  };

  /* 某一方的分身（活着的） */
  Match.prototype.clonesOf = function (side) {
    var out = [];
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (b.alive && b.isClone && b.side === side) out.push(b);
    }
    return out;
  };

  Match.prototype.opponentSide = function (ball) { return 1 - ball.side; };

  /* ------------------------------------------------------------------
   * 主步进（dt 固定）
   * ------------------------------------------------------------------ */
  Match.prototype.step = function (dt) {
    if (this.phase === 'countdown') {
      var before = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      var after = Math.ceil(this.countdownT);
      if (after !== before && after > 0) this.emit('countdown', { n: after });
      if (this.countdownT <= 0) {
        this.phase = 'fight';
        this.startedAt = this.t;
        this.emit('start', {});
      }
      return;
    }
    if (this.phase !== 'fight') return;

    this.t += dt;

    for (var k in this.pairCd) if (this.pairCd[k] > 0) this.pairCd[k] -= dt;

    this.updateBalls(dt);
    this.updateNewChars(dt);
    this.updateHiraishinWindow();
    this.updateHiraishinDance(dt);
    this.updateRasengans();
    this.updateProjectiles(dt);
    this.updateFields(dt);
    this.checkBallCollision();
    this.checkDeath();
  };

  /* ------------------------------------------------------------------
   * 球：移动 / 墙 / 技能计时 / 被动 / 灼烧
   * ------------------------------------------------------------------ */
  Match.prototype.updateBalls = function (dt) {
    /* 速度保底：被瞬吸 / 封印 / 钉住之后速度会被清零，如果没有方向，
     * 球就永远停在原地（要等下一次被撞才动）。这里每帧兜一下底。 */
    var minSp = this.cfg.ball.minSpeed;
    for (var bi = 0; bi < this.balls.length; bi++) {
      var bb = this.balls[bi];
      if (!bb.alive) continue;
      var sp = Math.sqrt(bb.vx * bb.vx + bb.vy * bb.vy);
      if (sp >= minSp * 0.999) continue;
      var mul = this.speedMulOf(bb);
      var want = Math.max(minSp * mul, this.cfg.ball.startSpeed * mul);
      if (sp < 1) {
        /* 完全静止：给一个随机方向（用球自己的随机流，保证可复现） */
        var na = bb.rng() * Math.PI * 2;
        bb.vx = Math.cos(na) * want;
        bb.vy = Math.sin(na) * want;
      } else {
        bb.vx = bb.vx / sp * want;
        bb.vy = bb.vy / sp * want;
      }
    }

    var size = this.cfg.arena.size;
    var bcfg = this.cfg.ball;
    var e = this.cfg.arena.wallRestitution;

    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (!b.alive) continue;

      /* 定身 或者 被超·神罗天征钉在原地（root）：都不移动 */
      var rooted = b.status.rootUntil > this.t;
      var bound = b.isBound(this.t) || rooted;

      if (bound) {
        /* 被定身：原地不动（速度保留，解控后继续），只做贴墙修正避免被顶进墙里 */
        b.x = M.clamp(b.x, b.r, size - b.r);
        b.y = M.clamp(b.y, b.r, size - b.r);
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        /* 墙反弹（完全弹性） */
        var r = b.r;
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * e; this.emitBounce(b, 'x'); }
        else if (b.x > size - r) { b.x = size - r; b.vx = -Math.abs(b.vx) * e; this.emitBounce(b, 'x'); }
        if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * e; this.emitBounce(b, 'y'); }
        else if (b.y > size - r) { b.y = size - r; b.vy = -Math.abs(b.vy) * e; this.emitBounce(b, 'y'); }

        /* 速度保护：太快夹住，太慢拉回下限（否则球会慢慢磨停）
         * 上下限都乘以速度倍率，所以"速度 +30%"的角色是真的整体更快 */
        var mul = this.speedMulOf(b);
        var spMax = bcfg.maxSpeed * mul;
        var spMin = bcfg.minSpeed * mul;
        var sp = b.speed();
        if (sp > spMax) {
          b.vx = b.vx / sp * spMax;
          b.vy = b.vy / sp * spMax;
        } else if (sp < spMin && sp > 0.001) {
          b.vx = b.vx / sp * spMin;
          b.vy = b.vy / sp * spMin;
        }
      }

      if (b.skillLock > 0) b.skillLock = Math.max(0, b.skillLock - dt);
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
      if (b.immuneGlow > 0) b.immuneGlow = Math.max(0, b.immuneGlow - dt);

      for (var s = 0; s < b.skills.length; s++) b.skills[s].tick(dt);

      this.updatePassive(b, dt);
      this.updateBurn(b, dt);
    }
  };

  Match.prototype.emitBounce = function (b, axis) {
    var sp = b.speed();
    if (sp < 40) return;
    this.emit('wall', { ball: b, x: b.x, y: b.y, speed: sp, axis: axis });
  };

  /* 被动回复（反转术式 / 漩涡血脉） */
  /* 飞雷神二段：1 秒窗口过期后，把释放冷却补回去 */
  /* 变大球 / 吸血球的每帧逻辑 */
  Match.prototype.updateNewChars = function (dt) {
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (!b.alive) continue;

      /* --- 变大球：每秒长一圈 + 受伤减免 --- */
      var gr = b.char.passive && b.char.passive.grow;
      if (gr) {
        if (b.growAcc === undefined) b.growAcc = 0;
        if (this.t < (gr.until || 40)) {
          /* 每帧按 dt 连续放大（以前是"每秒跳一格"，看着一顿一顿） */
          b.r = Math.min(gr.maxRadius || 330, b.r + (gr.radiusPerSec || 7) * dt);
          b.dr = Math.min(gr.maxDr || 0.7, (b.dr || 0) + (gr.drPerSec || 0.0175) * dt);
        }
      }

      /* --- 吸血球：蝠群盘旋 --- */
      if (b.status.batUntil > this.t) {
        var bt = b.char.skills[0] && b.char.skills[0].bat;
        if (bt) {
          b.vx = 0; b.vy = 0;
          if (b.batTick === undefined) b.batTick = 0;
          b.batTick -= dt;
          if (b.batTick <= 0) {
            b.batTick = bt.tickEvery || 0.4;
            var foes = this.aliveOfSide(1 - b.side);
            for (var f = 0; f < foes.length; f++) {
              var ff = foes[f];
              if (M.dist(b.x, b.y, ff.x, ff.y) > (bt.radius || 150) + ff.r) continue;
              this.dealDamage(b.id, ff, bt.damage || 8, 'direct', {
                skillId: 'vampire1', x: ff.x, y: ff.y, bat: true
              });
            }
          }
        }
      }
    }
  };

  Match.prototype.updateHiraishinWindow = function () {
    /* 兜底：连段已经结束，但场上还有大招苦无 → 立刻清掉（之前会残留） */
    if (!this.hiraishinDance) this.clearUltKunai();
    this.enforceKunaiCap(2);          // 兜底：标记最多 2 枚

    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (!b.alive || !b.status.hiraishinUntil) continue;
      if (this.t > b.status.hiraishinUntil) {
        b.status.hiraishinUntil = 0;
        b.status.hiraishinFrom = -1;
        for (var s = 0; s < b.skills.length; s++) {
          var st = b.skills[s];
          if (st.data.id === 'minato2') {
            st.freeCast = false;                 // 窗口过期：免费施放结束（否则会永久免费）
            if (st.castCd <= 0) st.castCd = (st.data.castCd || 3);
          }
        }
      }
    }
  };

  Match.prototype.updatePassive = function (b, dt) {
    var pas = b.char.passive;
    if (!pas) return;

    /* 漩涡血脉：固定数值回血，本体和分身数额不同（分身只有 20） */
    if (pas.healAmount) {
      b.healTimer -= dt;
      if (b.healTimer > 0) return;
      var iv = pas.healInterval || pas.interval || 2;
      b.healTimer += iv;
      /* 脱战（这 2 秒内没挨打）才回满，战斗中只回 healAmountCombat ——
       * 不然本体 50 HP/秒 的回血远高于对手约 20 HP/秒 的输出，对局永远打不完 */
      var safe = (this.t - b.lastDamageAt) >= iv;
      var amt = b.isClone
        ? (pas.healAmountClone || 0)
        : (safe ? pas.healAmount : (pas.healAmountCombat || pas.healAmount));
      var gotHp = b.heal(amt, 'uzumaki');
      if (gotHp > 0) this.emit('heal', { ball: b, amount: gotHp, bonus: false, x: b.x, y: b.y });
      return;
    }

    if (!pas.healMaxHpPct) return;
    b.healTimer -= dt;
    if (b.healTimer > 0) return;
    b.healTimer += pas.interval;

    var noDamage = (this.t - b.lastDamageAt) >= pas.interval;
    var got = b.heal(b.maxHp * pas.healMaxHpPct);
    if (noDamage) {
      var missing = b.maxHp - b.hp;
      got += b.heal(missing * pas.healMissingPct);
    }
    if (got > 0) {
      this.emit('heal', { ball: b, amount: got, bonus: noDamage, x: b.x, y: b.y });
    }
  };

  /* 灼烧（灶·开） */
  Match.prototype.updateBurn = function (b, dt) {
    var burn = b.status.burn;
    if (!burn) return;
    if (this.t >= burn.until) { b.status.burn = null; return; }
    burn.timer -= dt;
    while (burn.timer <= 0) {
      burn.timer += burn.interval;
      if (this.t >= burn.until) break;
      this.dealDamage(burn.srcIdx, b, burn.dps * burn.interval, burn.type, {
        skillId: burn.skillId, burn: true, x: b.x, y: b.y
      });
    }
  };

  Match.prototype.applyBurn = function (srcIdx, target, burnSpec, skillId) {
    target.status.burn = {
      dps: burnSpec.dps,
      until: this.t + burnSpec.duration,
      type: burnSpec.type || 'barrage',
      interval: 0.25,
      timer: 0.25,
      srcIdx: srcIdx,
      skillId: skillId
    };
  };

  /* ------------------------------------------------------------------
   * 飞行物
   * ------------------------------------------------------------------ */
  Match.prototype.addProjectile = function (p) {
    /* 注入阵营：弹幕的敌对判定按阵营走（分身机制需要） */
    var ob = this.balls[p.owner];
    if (ob) p.ownerSide = ob.side;
    this.projectiles.push(p);
    var cap = this.cfg.projectilesPerSide * 2;
    if (this.projectiles.length > cap) {
      var removed = this.projectiles.shift();
      if (removed) removed.dead = true;
    }
    return p;
  };

  Match.prototype.updateProjectiles = function (dt) {
    var size = this.cfg.arena.size;
    var list = this.projectiles;

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.dead) continue;

      p.age += dt;
      if (p.age >= p.life) { this.expireProjectile(p); continue; }

      /* 被黑球吸住的岩石就【定住不动】了（只保留命中/挤压判定和位置分离） */
      if (p.caught) {
        if (p.onHit && p.onHit !== 'pass') this.handleProjectileHit(p, dt);
        continue;
      }

      if (p.kind === 'grid') {
        this.handleProjectileHit(p, dt);
        continue;
      }

      if (p.attract) this.applyAttraction(p, dt);

      /* 追踪（螺旋丸）：朝最近的敌人转向，转向强度 p.homing */
      if (p.homing) {
        var foe = this.nearestEnemy(this.balls[p.owner] || { x: p.x, y: p.y, side: p.ownerSide });
        if (foe && foe.alive) {
          var sp0 = Math.hypot(p.vx, p.vy) || 1;
          var wantX = foe.x - p.x, wantY = foe.y - p.y;
          var wl = Math.hypot(wantX, wantY) || 1;
          var curX = p.vx / sp0, curY = p.vy / sp0;
          var rate = Math.min(1, p.homing * dt);
          var nx2 = curX + (wantX / wl - curX) * rate;
          var ny2 = curY + (wantY / wl - curY) * rate;
          var nl = Math.hypot(nx2, ny2) || 1;
          p.vx = nx2 / nl * sp0;
          p.vy = ny2 / nl * sp0;
        }
      }

      /* 水门苦无：速度持续衰减，太慢就停下变成留在场上的标记 */
      if (p.kind === 'kunai' && !p.stopped) {
        var dk2 = Math.exp(-(p.drag || 0) * dt);
        p.vx *= dk2; p.vy *= dk2;
        var sp2 = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (sp2 <= (p.stopSpeed || 120)) {
          var ob = this.balls[p.owner];
          if (ob) this.addPlacedKunai(ob, p.x, p.y, { cap: p.kunaiCap || 0 });
          p.stopped = true;
          p.dead = true;
          continue;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.growTo && p.growTime > 0) {
        var k = M.clamp(p.age / p.growTime, 0, 1);
        p.r = M.lerp(p.r0, p.growTo, k * k * (3 - 2 * k));
      }

      /* 赫 命中场上的 苍 → 合成 茈（优先于撞到敌人） */
      if (p.kind === 'red' && this.tryFusion(p, this.nearestEnemy(this.balls[p.owner]))) continue;

      if (this.handleProjectileWall(p, size)) continue;
      this.handleProjectileHit(p, dt);
    }

    /* 就地压缩数组，避免每帧产生垃圾 */
    var w = 0;
    for (var j = 0; j < list.length; j++) {
      if (!list[j].dead) list[w++] = list[j];
    }
    list.length = w;
  };

  Match.prototype.expireProjectile = function (p) {
    if (p.dead) return;
    if (p.explode && p.kind === 'purple') this.explodeAt(p, p.x, p.y);
    p.dead = true;
  };

  Match.prototype.handleProjectileWall = function (p, size) {
    /* 完全静止的飞行物（例如原地的茈）不与墙发生关系 */
    if (p.vx === 0 && p.vy === 0) return false;

    var halfW = (p.kind === 'slash') ? p.width / 2 : p.r;
    var out = (p.x < halfW || p.x > size - halfW || p.y < halfW || p.y > size - halfW);
    if (!out) return false;

    if (p.bounceOnWall) {
      if (p.x < halfW) { p.x = halfW; p.vx = Math.abs(p.vx); this.emit('pbounce', { x: p.x, y: p.y, kind: p.kind }); }
      else if (p.x > size - halfW) { p.x = size - halfW; p.vx = -Math.abs(p.vx); this.emit('pbounce', { x: p.x, y: p.y, kind: p.kind }); }
      if (p.y < halfW) { p.y = halfW; p.vy = Math.abs(p.vy); this.emit('pbounce', { x: p.x, y: p.y, kind: p.kind }); }
      else if (p.y > size - halfW) { p.y = size - halfW; p.vy = -Math.abs(p.vy); this.emit('pbounce', { x: p.x, y: p.y, kind: p.kind }); }
      return false;
    }

    var cx = M.clamp(p.x, 0, size), cy = M.clamp(p.y, 0, size);
    if (p.onWall === 'explode') this.explodeAt(p, cx, cy);
    else this.emit('pdie', { x: cx, y: cy, kind: p.kind });
    p.dead = true;
    return true;
  };

  /* 苍 的吸引场：以苍的圆心为中心的圆形力场
   * 越靠近圆心吸力越强，到半径处归零；falloff 越小整个范围内的吸力越均匀 */
  Match.prototype.applyAttraction = function (p, dt) {
    var at = p.attract;
    var fall = (at.falloff === undefined) ? 1 : at.falloff;
    var i, q, dx, dy, d2, d, f, rad, accel;

    if (at.accelProj) {
      for (i = 0; i < this.projectiles.length; i++) {
        q = this.projectiles[i];
        if (q === p || q.dead || q.kind === 'grid') continue;

        /* 「赫」享有更大的吸引半径与更强的吸力：
         * 这样苍才能主动把赫"钓"过来凑成茈 */
        rad = at.radius;
        accel = at.accelProj;
        if (q.kind === 'red') {
          if (at.radiusRed) rad = at.radiusRed;
          if (at.accelRed) accel = at.accelRed;
        } else if (q.kind === 'slash') {
          /* 解 是 1800 速度的高速斩击，同样在力场内，但掠过时间极短 */
          if (at.accelSlash) accel = at.accelSlash;
        }

        dx = p.x - q.x; dy = p.y - q.y; d2 = dx * dx + dy * dy;
        if (d2 > rad * rad || d2 < 1) continue;
        d = Math.sqrt(d2);
        f = Math.pow(1 - d / rad, fall) * accel * dt;
        q.vx += dx / d * f; q.vy += dy / d * f;
      }
    }

    if (at.accelBall) {
      /* 苍只吸敌人：以前只有两颗球，直接取"另一颗"就行；
       * 现在有分身，要按阵营筛，否则苍会把自己的分身一起吸过来 */
      var caster = this.balls[p.owner];
      for (var bi = 0; bi < this.balls.length; bi++) {
        var target = this.balls[bi];
        if (!target.alive || target.side === caster.side) continue;
        dx = p.x - target.x; dy = p.y - target.y; d2 = dx * dx + dy * dy;
        if (d2 <= at.radius * at.radius && d2 > 1) {
          d = Math.sqrt(d2);
          f = Math.pow(1 - d / at.radius, fall) * at.accelBall * dt;
          target.vx += dx / d * f; target.vy += dy / d * f;
        }
      }
    }
  };

  /* 赫 撞到 苍 → 原地合成 茈
   * enemy 传入时可以额外判断：如果敌人正待在苍里面，
   * 就把赫 提前抓走（否则赫会先撞上敌人，茈永远合不出来） */
  Match.prototype.tryFusion = function (red, enemy) {
    for (var i = 0; i < this.projectiles.length; i++) {
      var blue = this.projectiles[i];
      if (blue.dead || blue.kind !== 'blue') continue;
      /* ★ 只能和自己放的苍融合。
       * 少了这一句，镜像局里 A 的赫会抓着 B 的苍合出茈 —— 这就是内战串味的原因 */
      if (blue.owner !== red.owner) continue;

      var grab = blue.fusionGrab || 58;
      if (enemy && !enemy.dead &&
        M.dist(enemy.x, enemy.y, blue.x, blue.y) <= blue.r + enemy.r + 24) {
        grab += 150;   // 敌人在苍里 → 扩大抓取半径，优先合成
      }
      var rr = red.r + blue.r + grab;
      if (M.dist2(red.x, red.y, blue.x, blue.y) > rr * rr) continue;

      var ch = SH.CHARACTERS[red.charId];
      var spec = null;
      for (var s = 0; s < ch.skills.length; s++) {
        if (ch.skills[s].id === 'gojo1') spec = ch.skills[s].purple;
      }
      if (!spec) break;

      var target = this.nearestEnemy(this.balls[red.owner]);
      var dir = this.aimDir(this.balls[red.owner], target, spec.speed);
      var pur = SH.makeOrb('purple', red.owner, blue.x, blue.y, dir, spec, { charId: red.charId });
      this.addProjectile(pur);

      red.dead = true;
      blue.dead = true;

      this.emit('fuse', { x: blue.x, y: blue.y });
      this.emit('cast', {
        ball: this.balls[red.owner], skillId: 'gojo1',
        title: spec.title || '虚式·茈', subtitle: '术式顺转·苍 + 术式反转·赫',
        voiceKey: spec.voiceKey || '茈', vfx: spec.vfx, fused: true
      });
      return true;
    }
    return false;
  };

  /* 命中判定 */
  Match.prototype.handleProjectileHit = function (p, dt) {
    var isGrid = (p.kind === 'grid');

    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (!b.alive || !p.isHostileTo(b)) continue;

      if (isGrid) {
        /* 网格：靠「每格只能被吃一次 + maxHits 上限」控制伤害，
         * 不能走单段命中的 canHit 冷却，否则永远只能结算 1 格 */
        if (!this.gridHits(p, b, i)) continue;
      } else if (p.kind === 'slash') {
        if (!this.slashHits(p, b)) continue;
        if (!p.hit || !p.canHit(i, this.t)) continue;
      } else {
        var rr = p.r + b.r;
        if (M.dist2(p.x, p.y, b.x, b.y) > rr * rr) continue;
        if (!p.hit || !p.canHit(i, this.t)) continue;
        /* 赫 正要打到一个"待在苍里"的敌人时，先把赫吸去合成茈 */
        if (p.kind === 'red' && this.tryFusion(p, b)) return;
      }

      /* 无下限术式：免疫弹幕 / 反弹飞行物（直伤照吃，走下面正常流程） */
      if (b.status.immunityUntil > this.t) {
        var gojo2 = this.findSkillData(b, 'gojo2');
        if (gojo2 && gojo2.immunity.reflect && !p.reflected && p.kind !== 'grid' && p.hit) {
          this.reflectProjectile(p, b, i, gojo2);
          continue;
        }
      }

      /* 注意：网格已经在上面用「每格一次 + maxHits」判定过了，这里不能再套 canHit，
       * 否则整张网格只会结算第一格 */
      if (!isGrid && (!p.hit || !p.canHit(i, this.t))) continue;

      var before = b.hp;
      this.dealDamage(p.owner, b, p.hit.amount, p.hit.type, {
        skillId: p.skillId || p.kind, x: p.x, y: p.y,
        blade: (p.kind === 'slash') ? { dx: p.dirx, dy: p.diry, half: p.halfLen } : null
      });
      p.markHit(i, this.t);   // 注意：markHit 内部已经会给 totalHits 计数

      /* 多段飞行物（螺旋丸）：打满 maxHits 次就消失，否则'pass'会让它一直贴脸刷伤害 */
      if (p.hit && p.hit.maxHits && p.totalHits >= p.hit.maxHits) {
        this.explodeAt(p, p.x, p.y);
        p.dead = true;
        return;
      }

      if (p.burn && b.hp < before) this.applyBurn(p.owner, b, p.burn, p.skillId || p.kind);

      if (p.onHit === 'explode') {
        this.explodeAt(p, p.x, p.y);
        p.dead = true;
        return;
      }
      if (p.kind === 'kunai' && b && b.alive) {
        if (p.ultKunai) this.onUltKunaiHit(p, b);   // 大招苦无：立刻瞬移 + 斩击
        else this.onKunaiHit(p, b);                 // 一技能苦无：换位 + 横斩
      }
      if (p.onHit === 'disappear') {
        this.emit('pdie', { x: p.x, y: p.y, kind: p.kind });
        p.dead = true;
        return;
      }
      /* 'pass'：多段飞行物 / 网格继续存在 */
    }
  };

  Match.prototype.slashHits = function (p, b) {
    var dx = b.x - p.x, dy = b.y - p.y;
    var along = dx * p.dirx + dy * p.diry;
    var perp = -dx * p.diry + dy * p.dirx;
    return Math.abs(along) <= p.width / 2 + b.r && Math.abs(perp) <= p.halfLen + b.r;
  };

  Match.prototype.gridHits = function (p, b, ballIndex) {
    if (p.maxHits && (p.hitCounts[ballIndex] || 0) >= p.maxHits) return false;
    var pad = p.cellPad || 32;
    for (var c = 0; c < p.cells.length; c++) {
      var cell = p.cells[c];
      if (cell.hit) continue;
      if (circleRect(b.x, b.y, b.r, cell.x, cell.y, cell.w, cell.h, pad)) {
        cell.hit = true;
        p.totalCellHits++;
        return true;
      }
    }
    return false;
  };

  Match.prototype.reflectProjectile = function (p, b, ballIndex, gojo2) {
    var im = gojo2.immunity;
    p.owner = ballIndex;
    p.ownerSide = b.side;      // ★ 阵营也要跟着改，否则反弹回来的弹幕会打到反弹者自己
    p.charId = b.char.id;
    p.vx = -p.vx * im.reflectSpeedMul;
    p.vy = -p.vy * im.reflectSpeedMul;
    p.reflected = true;
    if (p.hit) p.hit = { amount: p.hit.amount * im.reflectDamageMul, type: p.hit.type, interval: p.hit.interval };
    p.origSkill = p.skillId;
    p.skillId = 'reflect';   // 结算界面单独统计"反弹"伤害
    p.hitTimes = {};
    p.hitCounts = {};
    b.immuneGlow = 0.5;
    this.emit('reflect', { x: p.x, y: p.y, ball: b, kind: p.kind });
    this.extendImmunity(b, gojo2);
  };

  /* ------------------------------------------------------------------
   * 爆炸
   * ------------------------------------------------------------------ */
  Match.prototype.explodeAt = function (p, x, y) {
    var e = p.explode;
    if (!e) return;
    var target = this.nearestEnemy(this.balls[p.owner]);
    if (target && target.alive) {
      var d = M.dist(x, y, target.x, target.y);
      if (d <= e.radius + target.r) {
        var k = M.clamp(d / e.radius, 0, 1);
        var amount = M.lerp(e.center, e.edge, k);
        this.dealDamage(p.owner, target, amount, e.type || 'barrage', {
          skillId: p.skillId || p.kind, x: x, y: y, aoe: true
        });
      }
    }
    this.emit('explode', { x: x, y: y, radius: e.radius, kind: p.kind, owner: p.owner });
  };

  /* ------------------------------------------------------------------
   * 领域
   * ------------------------------------------------------------------ */
  Match.prototype.updateFields = function (dt) {
    var list = this.fields;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.dead) continue;
      f.age += dt;
      if (f.follows) {
        var owner = this.balls[f.owner];
        if (owner) { f.x = owner.x; f.y = owner.y; }
      }
      /* 会飞的领域（地爆天星的黑球）：移动 + 减速 */
      if (f.vx || f.vy) {
        var dk = Math.exp(-(f.drag || 2.0) * dt);
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vx *= dk; f.vy *= dk;
        var padF = (f.r || 40) * 0.6;
        var sizeF = this.cfg.arena.size;
        if (f.x < padF || f.x > sizeF - padF) { f.vx = 0; f.x = M.clamp(f.x, padF, sizeF - padF); }
        if (f.y < padF || f.y > sizeF - padF) { f.vy = 0; f.y = M.clamp(f.y, padF, sizeF - padF); }
      }

      /* 引力：把敌人和飞行物吸过来 */
      if (f.attract) this.applyFieldAttraction(f, dt);

      /* 地爆天星：岩石黏到球面 + 把球心附近的敌人封印住 */
      if (f.core) {
        this.captureRocks(f);
        this.crushRocks(f, dt);
        this.separateRocks(f);
        this.sealAt(f, dt);
      }

      f.timer -= dt;
      var guard = 0;
      while (f.timer <= 0 && !f.dead && guard++ < 200) {
        f.timer += f.interval;
        this.fieldTick(f);
      }
      if (f.age >= f.life) { f.dead = true; this.cleanupField(f); }
    }
    var w = 0;
    for (var j = 0; j < list.length; j++) if (!list[j].dead) list[w++] = list[j];
    list.length = w;
  };

  /* 领域展开结算。
   * 领域是范围技：打到【该方所有活着的球】（含分身），而不是只打本体。
   * 无量空处必中；伏魔御厨子在圈内的才算。 */
  /* ------------------------------------------------------------------
   * 引力场（佩恩）：把【所有敌人】和【所有飞行物】吸向 (f.x, f.y)
   * ------------------------------------------------------------------ */
  Match.prototype.applyFieldAttraction = function (f, dt) {
    var at = f.attract;
    var fall = at.falloff === undefined ? 0.5 : at.falloff;
    var ownerBall = this.balls[f.owner];
    var side = ownerBall ? ownerBall.side : 0;
    var i, dx, dy, d, d2;

    if (at.accelBall) {
      var list = this.aliveOfSide(1 - side);
      for (i = 0; i < list.length; i++) {
        var b = list[i];
        dx = f.x - b.x; dy = f.y - b.y; d2 = dx * dx + dy * dy;
        if (d2 > at.radius * at.radius || d2 < 1) continue;
        d = Math.sqrt(d2);
        var fb = Math.pow(1 - d / at.radius, fall) * at.accelBall * dt;
        b.vx += dx / d * fb; b.vy += dy / d * fb;
      }
    }

    if (at.accelProj) {
      /* 地爆天星的岩石：像滚雪球一样【吸在已有的石头上】。
       *   · 还没吸住的石头：朝最近的"已吸住"的石头飞（没有就朝黑球飞）
       *   · 碰到任何一块已吸住的石头 → 贴住、速度清零、之后完全不动
       * 这样石头会一层层贴着长成实心岩球，而不是被推成一个空心大圈。 */
      var core = f.core;
      var rocksOfField = null;
      if (core) {
        rocksOfField = [];
        for (i = 0; i < this.projectiles.length; i++) {
          var rq = this.projectiles[i];
          if (!rq.dead && rq.fromField === f) rocksOfField.push(rq);
        }
      }

      for (i = 0; i < this.projectiles.length; i++) {
        var q = this.projectiles[i];
        if (q.dead || q.kind === 'grid') continue;
        dx = f.x - q.x; dy = f.y - q.y; d2 = dx * dx + dy * dy;
        if (d2 < 1) continue;

        if (core && q.fromField === f) {
          /* 已经贴住的：彻底不动 */
          if (q.caught) { q.vx = 0; q.vy = 0; continue; }

          /* 找最近的"已贴住"的石头当锚点 */
          var anchor = null, ad = 1e9;
          for (var ri = 0; ri < rocksOfField.length; ri++) {
            var rr2 = rocksOfField[ri];
            if (!rr2.caught || rr2 === q) continue;
            var dd = M.dist(q.x, q.y, rr2.x, rr2.y);
            if (dd < ad) { ad = dd; anchor = rr2; }
          }

          /* 碰到锚点 → 贴上去停住 */
          if (anchor && ad <= (q.r + anchor.r) * 0.95) {
            q.caught = true;
            q.vx = 0; q.vy = 0;
            f.crust = (f.crust || 0) + 1;
            this.emit('rockCatch', { x: q.x, y: q.y });
            continue;
          }

          /* 没有任何石头贴上去过，而且已经贴到黑球表面 → 也算贴住 */
          if (!anchor) {
            d = Math.sqrt(d2);
            if (d <= (f.r || 20) + q.r * 0.92) {
              q.caught = true;
              q.vx = 0; q.vy = 0;
              f.crust = (f.crust || 0) + 1;
              this.emit('rockCatch', { x: q.x, y: q.y });
              continue;
            }
          }

          /* 兜底：进场超过 2.5 秒还没贴住，就【就地贴住】——
           * 免得有个别石头一直绕着飞。 */
          if ((q.age || 0) > 2.5) {
            q.caught = true;
            q.vx = 0; q.vy = 0;
            f.crust = (f.crust || 0) + 1;
            this.emit('rockCatch', { x: q.x, y: q.y });
            continue;
          }

          /* 朝【黑球】加速（始终往中心吸），路上碰到任何一块已贴住的石头就停 */
          var ax = f.x - q.x, ay = f.y - q.y;
          var al = Math.sqrt(ax * ax + ay * ay) || 1;
          q.vx += ax / al * 2600 * dt;
          q.vy += ay / al * 2600 * dt;
          var dampR = Math.max(0, 1 - 1.6 * dt);
          q.vx *= dampR; q.vy *= dampR;
          continue;
        }

        if (d2 > at.radius * at.radius) continue;
        d = Math.sqrt(d2);
        var fq = Math.pow(1 - d / at.radius, fall) * at.accelProj * dt;
        q.vx += dx / d * fq; q.vy += dy / d * fq;
      }
    }
  };

  /* ------------------------------------------------------------------
   * 【吸一下】：一次性把范围内的敌人和飞行物猛拽向 (cx, cy)
   * 和引力场的区别是它只在释放瞬间施加一次速度增量，不是持续吸
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
   * 【吸一下】：瞬间把范围内的敌人和飞行物拽到 (cx, cy) 本体位置上
   * （不是加一次速度，是真的瞬移吸附；多颗球会散在中心周围一圈，不会完全重叠）
   * ------------------------------------------------------------------ */
  Match.prototype.yank = function (cx, cy, radius, side, opts) {
    opts = opts || {};
    var spread = opts.spread || 30;
    var i, dx, dy, d;
    var pulled = 0;
    var pulledList = [];

    var list = this.aliveOfSide(1 - side);
    for (i = 0; i < list.length; i++) {
      var b = list[i];
      dx = b.x - cx; dy = b.y - cy; d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      var ang = (d > 1) ? Math.atan2(dy, dx) : (i * 2.4);
      var rr = spread * (0.45 + 0.35 * i);
      pulledList.push(b);
      b.x = M.clamp(cx + Math.cos(ang) * rr, b.r, this.cfg.arena.size - b.r);
      b.y = M.clamp(cy + Math.sin(ang) * rr, b.r, this.cfg.arena.size - b.r);
      b.vx = 0; b.vy = 0;
      pulled++;
      if (!b.status.yanked) {
        b.status.yanked = true;
        this.emit('yanked', { ball: b, x: b.x, y: b.y });
      }
    }

    for (i = 0; i < this.projectiles.length; i++) {
      var q = this.projectiles[i];
      if (q.dead || q.kind === 'grid') continue;
      dx = q.x - cx; dy = q.y - cy; d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      q.x = cx; q.y = cy;
      q.vx = 0; q.vy = 0;
    }
    /* 黑棒天赋：吸住敌人 + 场上有黑棒 → 销毁全部黑棒并定身敌人（秒数 = 黑棒数） */
    var caster = opts.caster || this.mainOf(side);
    if (pulled > 0 && caster && caster.rods && caster.rods.length) {
      this.fireBlackRods(caster, cx, cy);
    }
    return pulled;
  };

  /* 地爆天星：石头碰到敌人不消失，持续挤压伤害 */
  Match.prototype.crushRocks = function (f, dt) {
    if (!f.core) return;
    var dmg = f.core.crushDamage || 2;
    var iv = f.core.crushInterval || 0.25;
    var ownerBall = this.balls[f.owner];
    var side = ownerBall ? ownerBall.side : 0;
    var foes = this.aliveOfSide(1 - side);
    var list = this.projectiles;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q.dead || q.fromField !== f) continue;
      q.crushCd = (q.crushCd || 0) - dt;
      for (var k = 0; k < foes.length; k++) {
        var b = foes[k];
        if (!b.alive) continue;
        if (M.dist(q.x, q.y, b.x, b.y) > (q.r + b.r) * 1.02) continue;   // 贴上就算（分离会推到刚好接触）
        if (q.crushCd > 0) break;
        q.crushCd = iv;
        this.dealDamage(f.owner, b, dmg, 'direct', {
          skillId: 'pain3', x: b.x, y: b.y, crush: true
        });
        this.emit('crush', { x: b.x, y: b.y, ball: b });
        break;
      }
    }
  };

  /* ------------------------------------------------------------------
   * 黑棒（佩恩天赋）：每次碰撞在碰撞点留下一枚黑棒（短黑线，不是障碍物/飞行物）
   * 场上有黑棒时，用万象天引【吸住】敌人 → 销毁全部黑棒，并定身敌人
   * （定身秒数 = 销毁的黑棒数量，1~5 秒），期间无法移动、无法放技能。
   * ------------------------------------------------------------------ */
  Match.prototype.addBlackRod = function (owner, x, y) {
    var spec = owner && owner.char && owner.char.passive && owner.char.passive.blackRod;
    if (!spec) return;
    if (!owner.rods) owner.rods = [];
    /* 满了就【不再生成】：之前是"顶掉最老的那一枚"，每撞一次 5 根就集体换位置，
     * 看起来既"跟着人跑"又"抽搐"。 */
    if (owner.rods.length >= (spec.max || 5)) return;
    /* 开局倒计时（球还没动起来）不生成 */
    if (this.phase !== 'fight') return;
    /* 同一次纠缠里不要连出一堆：每 0.25 秒最多留一根 */
    if (this.t - (owner.rodT === undefined ? -99 : owner.rodT) < 0.25) return;
    owner.rodT = this.t;
    owner.rods.push({ x: x, y: y, ang: (owner.rng ? owner.rng() : Math.random()) * Math.PI });
    this.emit('blackRod', { x: x, y: y, ball: owner, count: owner.rods.length });
  };

  /* 触发：把敌人吸住的那一刻 */
  Match.prototype.fireBlackRods = function (caster, cx, cy) {
    if (!caster || !caster.rods || !caster.rods.length) return 0;
    var secs = Math.max(1, Math.min(5, caster.rods.length));
    var n = caster.rods.length;
    caster.rods.length = 0;
    /* 每枚黑棒额外造成 20 点伤害（5 枚 = 100 点） */
    var spec = (caster.char.passive && caster.char.passive.blackRod) || {};
    var per = (spec.damageEach || 0) * n;
    var list = this.aliveOfSide(1 - caster.side);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      /* silent：这是【黑棒的定身】，绝对不要播无量空处那套白色爆发 + 六边笼 */
      this.applyBind(v, secs, { source: 'rod' });   // 黑棒自己的定身表现
      v.status.bindRod = true;
      if (per > 0 && v.alive) {
        this.dealDamage(caster.id, v, per, 'direct', {
          skillId: 'blackRod', x: v.x, y: v.y, rods: n
        });
      }
    }
    this.emit('blackRodFire', { x: cx, y: cy, seconds: secs, count: n, damage: per, ball: caster });
    /* 摧毁代价：每根黑棒给万象天引 +1 秒 CD（避免连续定身太强）。
     * 注意要"挂账"：技能释放时 consume() 会把 CD 重置为基础值，
     * 直接写 cd 会被它覆盖掉。 */
    var perRodCd = (caster.char.passive && caster.char.passive.cdPerRod) || 0;
    if (perRodCd > 0 && caster.skills) {
      for (var si = 0; si < caster.skills.length; si++) {
        if (caster.skills[si].data.id === 'pain1') {
          caster.skills[si].pendingCdPenalty = (caster.skills[si].pendingCdPenalty || 0) + perRodCd * n;
          break;
        }
      }
    }
    return secs;
  };

  /* ==================================================================
   * 飞雷神苦无（波风水门）
   * ================================================================== */
  /* 留在场上的苦无（停下之后 / 开局自带） */
  Match.prototype.addPlacedKunai = function (ball, x, y, opts) {
    opts = opts || {};
    var k = {
      id: ++this._kunaiId,
      side: ball.side,
      owner: ball.id,
      x: x, y: y,
      ang: ball.rng ? ball.rng() * Math.PI : 0,
      t: this.t,
      ult: !!opts.ult
    };
    this.kunai.push(k);
    this.emit('kunaiPlace', { x: x, y: y, k: k });
    return k;
  };

  /* 某一方场上的苦无（按放置时间排序，早的在前） */
  Match.prototype.kunaiOf = function (side, includeUlt) {
    var out = [];
    for (var i = 0; i < this.kunai.length; i++) {
      var k = this.kunai[i];
      if (k.side !== side) continue;
      if (k.ult && !includeUlt) continue;
      out.push(k);
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  };

  /* 普通苦无数量（不含大招丢的） */
  Match.prototype.kunaiCount = function (side) {
    return this.kunaiOf(side, false).length;
  };

  Match.prototype.removeKunai = function (k) {
    var i = this.kunai.indexOf(k);
    if (i >= 0) {
      this.kunai.splice(i, 1);
      this.emit('kunaiGone', { x: k.x, y: k.y });
    }
  };

  /* 命中敌人：10 伤害之后换位 + 横斩 */
  /* 大招的苦无命中了敌人：立刻瞬移过去 + 斩一刀 */
  Match.prototype.onUltKunaiHit = function (proj, target) {
    if (proj.ultUsed) return;                    // 只触发一次
    var owner = this.balls[proj.owner];
    if (!owner || !owner.alive) return;
    proj.ultUsed = true;

    /* 瞬移（不是换位：苦无继续飞，作为后续连段的目标） */
    owner.x = proj.x; owner.y = proj.y;
    owner.vx = 0; owner.vy = 0;
    this.emit('kunaiSwap', { x: owner.x, y: owner.y, ball: owner });

    /* 斩击 */
    if (target && target.alive) {
      this.dealDamage(owner.id, target, proj.slashDmg || 30, 'direct', {
        skillId: 'minato3', x: target.x, y: target.y, slash: true
      });
      this.emit('kunaiSlash', { x: target.x, y: target.y, ball: owner, target: target });
    }
  };

  Match.prototype.onKunaiHit = function (proj, target) {
    var owner = this.balls[proj.owner];
    if (!owner || !owner.alive) return;

    var ox = owner.x, oy = owner.y;
    /* 与苦无交换位置 */
    owner.x = proj.x; owner.y = proj.y;
    proj.x = ox; proj.y = oy;
    owner.vx = 0; owner.vy = 0;
    this.emit('kunaiSwap', { x: owner.x, y: owner.y, ball: owner });

    /* 命中后苦无【不再是飞行物】：原地定住，变成留在场上的标记 */
    proj.stopped = true;
    proj.dead = true;
    this.addPlacedKunai(owner, proj.x, proj.y, {});

    /* 追加横斩 */
    var spec = proj.kunaiSpec || {};
    var dmg = spec.slash || 10;
    if (target && target.alive) {
      this.dealDamage(owner.id, target, dmg, 'direct', {
        skillId: 'minato1', x: target.x, y: target.y, slash: true
      });
      this.emit('kunaiSlash', { x: target.x, y: target.y, ball: owner, target: target });
    }
  };

  /* 大招连段：依次瞬移到每枚苦无，并留下斩击 */
  /* 点到线段的距离（大招拖影斩的判定用） */
  Match.prototype.distToSeg = function (px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L2 = dx * dx + dy * dy;
    if (L2 < 0.0001) return M.dist(px, py, x1, y1);
    var t = ((px - x1) * dx + (py - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return M.dist(px, py, x1 + t * dx, y1 + t * dy);
  };

  /* 兜底：任何一方在场上最多保留 cap 枚标记（多出来的一律挤掉最早的） */
  Match.prototype.enforceKunaiCap = function (cap) {
    for (var s = 0; s < 2; s++) {
      var mine = this.kunaiOf(s, false);
      while (mine.length > (cap || 2)) {
        var drop = mine.shift();
        var di = this.kunai.indexOf(drop);
        if (di >= 0) { this.kunai.splice(di, 1); this.emit('kunaiGone', { x: drop.x, y: drop.y }); }
      }
    }
  };

  /* 清掉所有大招丢的苦无（它们只是大招的一部分，不该留下） */
  Match.prototype.clearUltKunai = function () {
    var killed = 0;
    for (var i = 0; i < this.projectiles.length; i++) {
      var p = this.projectiles[i];
      if (p.ultKunai && !p.dead) { p.dead = true; killed++; }
    }
    return killed;
  };

  Match.prototype.startHiraishinDance = function (ball, kunaiList, spec) {
    /* 万一上一轮还没结束（连续放大招）：只清【上一轮】列出的苦无。
     * 不能做全局清理 —— 新一轮的苦无是刚生成的，会被一起清掉（这是个真 bug）。 */
    if (this.hiraishinDance) {
      var oldList = this.hiraishinDance.list || [];
      for (var oi = 0; oi < oldList.length; oi++) {
        if (oldList[oi] && oldList[oi].ultKunai) oldList[oi].dead = true;
      }
      this.hiraishinDance = null;
    }
    this.hiraishinDance = {
      /* 先等 delay 秒（默认 1 秒）让苦无飞出去，再开始瞬移斩击 */
      ball: ball, list: kunaiList, idx: 0, spec: spec,
      timer: (spec.delay === undefined ? 1.0 : spec.delay), done: false
    };
  };

  Match.prototype.updateHiraishinDance = function (dt) {
    var d = this.hiraishinDance;
    if (!d || d.done) return;
    var ball = d.ball, spec = d.spec;
    if (!ball || !ball.alive) { this.endHiraishinDance(); return; }
    d.timer -= dt;
    if (d.timer > 0) return;
    d.timer = spec.interval || 0.22;

    /* 本轮还剩哪些可以去的目标 */
    var pool = [];
    var i, kk;
    for (i = 0; i < d.list.length; i++) {
      kk = d.list[i];
      if (!kk || kk.visited) continue;
      if (kk.ultKunai && kk.dead) continue;      // 大招苦无可能已经消失
      pool.push(kk);
    }

    /* 大招丢的苦无都去过了 → 追加场上【最新 + 更早】两个标记 */
    if (!pool.length && !d.extended) {
      d.extended = true;
      var marks = this.kunaiOf(d.ball.side, false);
      marks.sort(function (a, b) { return b.t - a.t; });
      for (var mi = 0; mi < marks.length && mi < 2; mi++) {
        marks[mi].visited = false;
        d.list.push(marks[mi]);
        pool.push(marks[mi]);
      }
    }
    if (!pool.length) { this.endHiraishinDance(); return; }

    /* ★ 每一段都重新挑【当前离本体最远】的那一枚（苦无一直在飞，顺序会变） */
    var dest = pool[0], bestD = -1;
    for (i = 0; i < pool.length; i++) {
      var dd = M.dist(ball.x, ball.y, pool[i].x, pool[i].y);
      if (dd > bestD) { bestD = dd; dest = pool[i]; }
    }
    dest.visited = true;

    var fromX = ball.x, fromY = ball.y;
    ball.x = dest.x; ball.y = dest.y;
    ball.vx = 0; ball.vy = 0;
    this.emit('kunaiSwap', { x: ball.x, y: ball.y, ball: ball });

    /* 拖影斩击：这一段直线上范围内的敌人都吃伤害 */
    var foes = this.aliveOfSide(1 - ball.side);
    var R = spec.slashR || 150;
    for (i = 0; i < foes.length; i++) {
      var f = foes[i];
      if (!f.alive) continue;
      if (this.distToSeg(f.x, f.y, fromX, fromY, ball.x, ball.y) > R + f.r) continue;
      this.dealDamage(ball.id, f, spec.slash || 30, 'direct', {
        skillId: 'minato3', x: f.x, y: f.y, slash: true
      });
    }
    this.emit('kunaiTrail', { x1: fromX, y1: fromY, x2: ball.x, y2: ball.y, ball: ball, dist: Math.round(bestD) });
  };

  Match.prototype.endHiraishinDance = function () {
    var d = this.hiraishinDance;
    if (!d) return;
    d.done = true;
    /* 大招丢的苦无一起消失 */
    for (var q = 0; q < this.projectiles.length; q++) { if (this.projectiles[q].ultKunai) this.projectiles[q].dead = true; }
    for (var i = 0; i < d.list.length; i++) {
      /* 留在场上的标记（有 t 字段）要保留；大招丢的飞行物由上面清掉 */
      if (d.list[i] && d.list[i].t === undefined) this.removeKunai(d.list[i]);
    }
    this.hiraishinDance = null;
    this.emit('kunaiDanceEnd', {});
  };

  /* 地爆天星：岩石被吸到球面就黏住，把黑球越裹越大 */
  Match.prototype.captureRocks = function (f) {
    if (!f.core) return;
    /* 壳半径要躲开被封印在球心的敌人（不然石头会嵌进它身体里） */
    /* 石头从【球体表面】弹开（让它贴着球堆起来），
     * "不许嵌进敌人身体"那件事交给 separateRocks 处理 ——
     * 之前按封印半径算，石头被挡在 128 外，根本碰不到被钉在球心的敌人。 */
    var base = (f.r || 20) + (f.core.rockR || 19) + 5;
    var rr = base + Math.sqrt(f.crust || 0) * 4.2;
    var list = this.projectiles;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q.dead || q.fromField !== f) continue;
      if (M.dist(f.x, f.y, q.x, q.y) <= rr) {
        /* 不再让石头消失：从球面弹开，继续留在场上飞（物理引擎照旧），
         * 只有大招结束时才和黑球一起消失。crust 只给外壳特效计数。 */
        f.crust = (f.crust || 0) + 1;
        var nx = q.x - f.x, ny = q.y - f.y;
        var nd = Math.sqrt(nx * nx + ny * ny) || 1;
        var sp = Math.max(200, Math.sqrt(q.vx * q.vx + q.vy * q.vy));
        q.x = f.x + nx / nd * (rr + 2);
        q.y = f.y + ny / nd * (rr + 2);
        q.vx = nx / nd * sp;
        q.vy = ny / nd * sp;
        this.emit('rockStick', { x: q.x, y: q.y });
      }
    }
  };

  /* 地爆天星：把球心附近的敌人【封印】住 */
  Match.prototype.sealAt = function (f, dt) {
    if (!f.core || !f.core.sealRadius) return;
    var ownerBall = this.balls[f.owner];
    var side = ownerBall ? ownerBall.side : 0;
    var list = this.aliveOfSide(1 - side);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (M.dist(f.x, f.y, b.x, b.y) > f.core.sealRadius) {
        if (b.status.sealed) b.status.sealed = false;
        continue;
      }
      /* 封印 = 极强的吸力，而不是定身：
       * 敌人没有被锁住（技能照放、身体照弹），只是被引力死死按在球心，
       * 挣扎着也跑不出去 —— 更接近原著，也不会借用到无量空处的定身表现。 */
      var dx = f.x - b.x, dy = f.y - b.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      /* 1) 每帧直接往球心拽一段（贴身效果） */
      b.x += dx * Math.min(1, 16 * dt);
      b.y += dy * Math.min(1, 16 * dt);
      /* 2) 再加上极强的向心加速度，抵消掉它想跑出去的速度 */
      b.vx += dx / d * 5200 * dt;
      b.vy += dy / d * 5200 * dt;
      /* 3) 阻尼：把挣脱的速度一点点磨掉，形成"被吸住"的手感 */
      var damp = Math.max(0, 1 - 6.5 * dt);
      b.vx *= damp; b.vy *= damp;
      if (!b.status.sealed) {
        b.status.sealed = true;
        this.emit('sealed', { ball: b, x: b.x, y: b.y });
      }
    }
  };

  /* 地爆天星：石头之间互不重叠，也不嵌进敌人身体里 */
  /* 地爆天星：石头之间互不重叠，也不嵌进敌人身体里。
   * 两步必须放进同一个迭代里交替求解 —— 单独跑的话，"把石头推出敌人身体"
   * 又会把它挤到别的石头上，留下残余重叠。 */
  Match.prototype.separateRocks = function (f) {
    if (!f.core) return;
    var rocks = [];
    var i;
    for (i = 0; i < this.projectiles.length; i++) {
      var q = this.projectiles[i];
      if (!q.dead && q.fromField === f) rocks.push(q);
    }
    if (!rocks.length) return;

    var ownerBall = this.balls[f.owner];
    var side = ownerBall ? ownerBall.side : 0;
    var foes = this.aliveOfSide(1 - side);
    var size = this.cfg.arena.size;

    for (var it = 0; it < 12; it++) {
      var a, b, k, e, dx, dy, d;

      /* 1) 石头之间【不做分离】：要的就是层层贴住。
       *    之前这里每帧把石头互相推开，看起来"像中间有斥力"，还会把飞进来的
       *    石头挡在外面组不成实心球。现在只有第一条按接触距离贴住。 */
      /* 石头之间不做分离（见上面的说明） */
      for (a = 0; a < rocks.length; a++) {
        for (b = a + 1; b < rocks.length; b++) {
          var A = rocks[a], B = rocks[b];
          if (A.caught && B.caught) continue;
          dx = B.x - A.x; dy = B.y - A.y;
          d = Math.sqrt(dx * dx + dy * dy);
          var minD = (A.r + B.r) * 0.84;   // 允许略微重叠，堆得更密
          if (d >= minD) continue;
          var push = (minD - d) / 2;
          var ra = Math.sqrt((A.x - f.x) * (A.x - f.x) + (A.y - f.y) * (A.y - f.y));
          var rb = Math.sqrt((B.x - f.x) * (B.x - f.x) + (B.y - f.y) * (B.y - f.y));
          if (Math.abs(ra - rb) < minD * 0.45 && ra > 1 && rb > 1) {
            var uax = (A.x - f.x) / ra, uay = (A.y - f.y) / ra;
            var ubx = (B.x - f.x) / rb, uby = (B.y - f.y) / rb;
            if (ra <= rb) {
              A.x -= uax * push; A.y -= uay * push;
              B.x += ubx * push; B.y += uby * push;
            } else {
              A.x += uax * push; A.y += uay * push;
              B.x -= ubx * push; B.y -= uby * push;
            }
          } else {
            var ux, uy;
            if (d < 0.001) { ux = 1; uy = 0; }
            else { ux = dx / d; uy = dy / d; }
            A.x -= ux * push; A.y -= uy * push;
            B.x += ux * push; B.y += uy * push;
          }
        }
      }

      /* 2) 石头不能嵌进敌人身体：推到贴着表面 */
      for (k = 0; k < rocks.length; k++) {
        var R = rocks[k];
        for (e = 0; e < foes.length; e++) {
          var E = foes[e];
          if (!E.alive) continue;
          var ex = R.x - E.x, ey = R.y - E.y;
          var ed = Math.sqrt(ex * ex + ey * ey);
          var need = R.r + E.r;
          if (ed >= need) continue;
          if (ed < 0.001) { ex = 1; ey = 0; ed = 1; }
          R.x = E.x + ex / ed * need;
          R.y = E.y + ey / ed * need;
        }
      }
    }

    /* 收尾：别被推出场地 */
    for (var z = 0; z < rocks.length; z++) {
      rocks[z].x = M.clamp(rocks[z].x, rocks[z].r, size - rocks[z].r);
      rocks[z].y = M.clamp(rocks[z].y, rocks[z].r, size - rocks[z].r);
    }
  };

  /* 从场地四周的墙壁剥一块岩石（地爆天星） */
  Match.prototype.spawnRock = function (f) {
    var c = f.core;
    if (!c) return;
    var size = this.cfg.arena.size;
    /* 注意：要生成在【墙面内侧】，不然半径比边距大，第一帧就会被判成撞墙消失 */
    var m2 = Math.max(40, (c.rockR || 15) * 2.5);
    var edge = Math.floor(this.rng() * 4);
    var x, y;
    if (edge === 0) { x = M.rand(this.rng, m2, size - m2); y = m2; }
    else if (edge === 1) { x = size - m2; y = M.rand(this.rng, m2, size - m2); }
    else if (edge === 2) { x = M.rand(this.rng, m2, size - m2); y = size - m2; }
    else { x = m2; y = M.rand(this.rng, m2, size - m2); }

    /* 新剥的石头是在"分离"逻辑之后才生成的，取点时必须自己避让，
     * 否则两颗会叠在同一个墙角（要等下一帧才被推开） */
    var rockR0 = c.rockR || 19;
    var owner0 = this.balls[f.owner];
    var side0 = owner0 ? owner0.side : 0;
    var foes0 = this.aliveOfSide(1 - side0);
    for (var tries = 0; tries < 14; tries++) {
      var clash = false;
      for (var pi = 0; pi < this.projectiles.length; pi++) {
        var pp = this.projectiles[pi];
        if (pp.dead || pp.fromField !== f) continue;
        if (M.dist(x, y, pp.x, pp.y) < (rockR0 + pp.r) * 1.06) { clash = true; break; }
      }
      for (var fi = 0; fi < foes0.length && !clash; fi++) {
        if (M.dist(x, y, foes0[fi].x, foes0[fi].y) < rockR0 + foes0[fi].r + 5) clash = true;
      }
      if (!clash) break;
      var shift = 26 + tries * 20;
      if (edge === 0 || edge === 2) x = M.clamp(x + shift, m2, size - m2);
      else y = M.clamp(y + shift, m2, size - m2);
    }

    /* 取点试了 14 次还冲突（墙就那么长）：直接把新石头推出去，保证不重叠 */
    for (var fi2 = 0; fi2 < 40; fi2++) {
      var bad = null, badNeeds = 0;
      for (var pj = 0; pj < this.projectiles.length; pj++) {
        var pj2 = this.projectiles[pj];
        if (pj2.dead || pj2.fromField !== f) continue;
        var need2 = (rockR0 + pj2.r) * 1.02;
        if (M.dist(x, y, pj2.x, pj2.y) < need2) { bad = pj2; badNeeds = need2; break; }
      }
      if (!bad) break;
      var nx2 = x - bad.x, ny2 = y - bad.y;
      var nd2 = Math.sqrt(nx2 * nx2 + ny2 * ny2);
      if (nd2 < 0.001) { nx2 = 1; ny2 = 0; nd2 = 1; }
      x = M.clamp(bad.x + nx2 / nd2 * badNeeds, m2, size - m2);
      y = M.clamp(bad.y + ny2 / nd2 * badNeeds, m2, size - m2);
    }

    var dir = M.norm(f.x - x, f.y - y);
    var rock = SH.makeOrb('rock', f.owner, x, y, dir, {
      r: c.rockR, speed: c.rockSpeed, life: c.life + 0.4,
      hit: { amount: c.rockDamage, type: 'barrage' },
      onHit: 'pass', onWall: 'bounce'
    }, { charId: 'pain', skillId: 'pain3' });
    rock.fromField = f;
    rock.bounceOnWall = true;   // 岩石撞墙弹开，否则被吸过中心撞墙就没了，场上凑不到一大堆
    this.addProjectile(rock);
    if (!f.rocks) f.rocks = [];
    f.rocks.push(rock);

    this.emit('rock', { x: x, y: y, ball: rock });
  };

  /* 领域结束：岩石一起收掉 */
  Match.prototype.cleanupField = function (f) {
    /* 封印解除（球没了就不该还标着"被封住"） */
    for (var k = 0; k < this.balls.length; k++) {
      if (this.balls[k].status.sealed) this.balls[k].status.sealed = false;
    }
    if (f.rocks) {
      /* 每块岩石消失时炸一下：小范围 2 点伤害 */
      if (f.core) {
        var ownerB = this.balls[f.owner];
        var sd = ownerB ? ownerB.side : 0;
        var foes = this.aliveOfSide(1 - sd);
        var br = f.core.rockBlastRadius || 46;
        var bd = f.core.rockBlastDamage || 2;
        for (var ri = 0; ri < f.rocks.length; ri++) {
          var rk = f.rocks[ri];
          if (!rk) continue;
          for (var fi = 0; fi < foes.length; fi++) {
            var fb2 = foes[fi];
            if (!fb2.alive) continue;
            if (M.dist(rk.x, rk.y, fb2.x, fb2.y) > br + fb2.r) continue;
            this.dealDamage(f.owner, fb2, bd, 'direct', {
              skillId: 'pain3', x: fb2.x, y: fb2.y, blast: true
            });
          }
          this.emit('rockBlast', { x: rk.x, y: rk.y });
        }
      }
      for (var i = 0; i < f.rocks.length; i++) if (f.rocks[i]) f.rocks[i].dead = true;
      f.rocks.length = 0;
    }
    this.emit('fieldEnd', { x: f.x, y: f.y, kind: f.kind });
  };

  Match.prototype.fieldTick = function (f) {
    /* 地爆天星：一边吸一边从墙上剥岩石。
     * 领域每 interval（0.12 秒）才结算一次，所以"每 tick 剥一块"会被卡在 ~42 块；
     * 这里按 rockEvery 换算成"每 tick 剥几块"。 */
    if (f.core) {
      f.rockTimer -= f.interval;
      if (f.rockTimer <= 0) {
        f.rockTimer = f.core.rockEvery;
        var batch = Math.max(1, Math.round(f.interval / (f.core.rockEvery || 0.05)));
        for (var rb = 0; rb < batch; rb++) this.spawnRock(f);
      }
    }
    var ownerBall = this.balls[f.owner];
    var side = ownerBall ? ownerBall.side : 0;
    f.tickCount++;

    var hit = false, hx = f.x, hy = f.y, total = 0;
    var list = this.aliveOfSide(1 - side);

    if (f.kind === 'gojo3') {
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var dealt = this.dealDamage(f.owner, t, f.tickDamage(), f.type, {
          skillId: 'gojo3', x: t.x, y: t.y, domain: true
        });
        total += dealt;
        if (dealt > 0) { hit = true; hx = t.x; hy = t.y; }
      }
      f.totalDamage += total;
      f.ticksLeft--;
      this.emit('fieldtick', { field: f, hit: hit, x: hx, y: hy });
      if (f.ticksLeft <= 0) f.dead = true;
      return;
    }

    for (var j = 0; j < list.length; j++) {
      var b = list[j];
      if (M.dist(f.x, f.y, b.x, b.y) > f.radius + b.r) continue;
      var dmg = this.dealDamage(f.owner, b, f.tickDamage(), f.type, {
        skillId: f.kind, x: b.x, y: b.y, domain: true   // 按领域自己的类型记账（原来写死成 sukuna3，佩恩的伤害被算到宿傩头上）
      });
      total += dmg;
      if (dmg > 0) { hit = true; hx = b.x; hy = b.y; }
    }
    f.totalDamage += total;
    this.emit('fieldtick', { field: f, hit: hit, x: hx, y: hy });
  };

  /* ------------------------------------------------------------------ */
  Match.prototype.dealDamage = function (srcIdx, target, amount, type, opts) {
    /* 完全无敌（蝠群）：什么都打不进来 */
    if (target.status.invulnUntil > this.t && opts.bypassInvuln !== true) {
      this.emit('invulnBlock', { ball: target, x: (opts.x !== undefined ? opts.x : target.x), y: (opts.y !== undefined ? opts.y : target.y), skillId: opts.skillId || null });
      return 0;
    }
    /* 受伤减免（变大球） */
    if (target.dr > 0) amount = amount * (1 - Math.min(0.95, target.dr));

    opts = opts || {};
    if (!target || !target.alive || amount <= 0) return 0;

    var src = (srcIdx === null || srcIdx === undefined) ? null : this.balls[srcIdx];

    /* 加时赛：拖太久就全场伤害递增，保证任何对局都能结束 */
    var sd = this.cfg.suddenDeath;
    if (sd && this.t > sd.start) {
      var mul = Math.min(sd.maxMul, 1 + (this.t - sd.start) / sd.ramp);
      amount = amount * mul;
      if (!this.overtime) { this.overtime = true; this.emit('overtime', { t: this.t }); }
    }

    /* 色诱术：状态期间【自己打出的伤害全部无效】（代价是换来免伤）
     * 想恢复输出就放螺旋丸，那会立刻打断色诱术（见 skills/naruto.js） */
    if (src && src.status.charmUntil > this.t) {
      this.emit('charmVoid', { ball: src, x: opts.x !== undefined ? opts.x : target.x, y: opts.y !== undefined ? opts.y : target.y });
      return 0;
    }

    /* 领域展延：宿傩的攻击有概率变成直伤，穿透无下限 */
    var tenkai = false;
    if (src && src.char.passive && src.char.passive.directChance && type === 'barrage' && !opts.isCollision) {
      if (src.rng() < src.char.passive.directChance) {
        type = 'direct';
        tenkai = true;
      }
    }

    /* 黑闪判定（集中在这里，所以碰撞、迳庭拳、任何攻击都走同一条路）
     *   1) 「必定黑闪」状态（虎杖大招）—— 消耗一层，必定触发
     *   2) 球球碰撞 —— 按概率判定（基础 2.5% + 被动加成）
     * 触发后伤害变成原伤害的 exponent 次方（8^2.5 ≈ 181），并让攻击者回满血 + CD 全清 */
    /* 黑闪 / 暴击：
     *   · 咒术回战角色（char.series === 'jjk'）→ 黑闪：伤害^2.5 + 自己回满血 + 技能 CD 全清
     *   · 其他作品的角色 → 暴击：伤害同样变成 ^2.5，但【不回血、不清 CD】
     * 两者共用同一次概率判定，只是结算不同。 */
    var black = false, crit = false;
    if (src && !opts.noBlackFlash) {
      var isJjk = (src.char.series || 'jjk') === 'jjk';

      if (isJjk && src.status.guaranteedBlackFlash > 0) {
        src.status.guaranteedBlackFlash--;
        black = true;
      } else if (opts.isCollision && !src.isClone && src.rng() < this.blackFlashChanceOf(src)) {
        /* 分身打不出（鸣人的影分身靠这条限制，否则分身多了会失控） */
        if (isJjk) black = true; else crit = true;
      }
    }
    if (black || crit) {
      /* 变大球：免疫暴击 / 黑闪的伤害。
       * 注意必须放在这里 —— 只有【真的触发了暴击】才免疫，
       * 放在上面判定链外面会导致他对所有伤害都免疫（我第一次就写错了）。 */
      if (target.char.passive && target.char.passive.immuneCrit) {
        this.emit('critImmune', { ball: target, x: (opts.x !== undefined ? opts.x : target.x), y: (opts.y !== undefined ? opts.y : target.y) });
        return 0;
      }
      amount = this.damageFormula(amount);
      opts = Object.assign({}, opts, { skillId: black ? 'blackflash' : 'crit' });
    }

    /* 无下限术式免疫：弹幕 + 球体碰撞 / 黑闪（暴击）这类"物理接触"伤害。
     * 注意它们的 type 仍是 direct —— 这里只是额外放行给无下限，
     * 这样色诱术、神罗天征这些按 type 判定的机制不受影响。 */
    if (target.status.immunityUntil > this.t &&
        (type === 'barrage' || opts.isCollision || opts.contact ||
         opts.skillId === 'collision' || opts.skillId === 'crit' || opts.skillId === 'blackflash')) {
      this.onImmunityBlock(target, src, opts);
      return 0;
    }

    /* 色诱术：本体与分身在此期间把【非直伤】的攻击全部转为等量治疗 */
    if (target.status.charmUntil > this.t && type !== 'direct') {
      var healed = target.heal(amount, 'charm');
      this.emit('charmed', {
        ball: target, amount: healed || amount, x: opts.x !== undefined ? opts.x : target.x,
        y: opts.y !== undefined ? opts.y : target.y, skillId: opts.skillId || null
      });
      return 0;
    }

    var before = target.hp;
    target.hp = Math.max(0, target.hp - amount);
    var dealt = before - target.hp;
    if (dealt <= 0) return 0;

    target.lastDamageAt = this.t;
    target.flash = 0.18;
    target.stats.damageTaken += dealt;
    if (src) src.creditDamage(opts.skillId || null, dealt);
    if (target.hp <= 0) {
      target.alive = false;
      if (target.isClone) this.onCloneDeath(target);   // 分身阵亡：上限回归本体 + 回血
    }

    if (tenkai && src) {
      target.status.tenkaiHits++;
      for (var i = 0; i < target.skills.length; i++) target.skills[i].pushCd(src.char.passive.cdPush);
    }

    this.emit('damage', {
      target: target, srcIdx: srcIdx, amount: dealt, dmgType: type,
      tenkai: tenkai, skillId: opts.skillId || null, burn: !!opts.burn, aoe: !!opts.aoe,
      domain: !!opts.domain, blade: opts.blade || null, blackFlash: black,
      x: opts.x !== undefined ? opts.x : target.x,
      y: opts.y !== undefined ? opts.y : target.y
    });
    /* 黑闪的额外收益：攻击者回满血 + 技能 CD 全清（暴击没有这些） */
    if (black && src) this.triggerBlackFlash(src, target.x, target.y);
    else if (crit && src) {
      src.crits = (src.crits || 0) + 1;
      this.critTotal = (this.critTotal || 0) + 1;
      this.emit('crit', { ball: src, x: target.x, y: target.y, idx: src.id, amount: dealt });
    }
    /* 吸血：造成伤害的 N% 转成自身治疗 */
    var lsSpec = src && src.char.passive && src.char.passive.lifesteal;
    if (lsSpec && dealt > 0 && src.alive && src !== target) {
      var got = src.heal(dealt * lsSpec, 'lifesteal');
      if (got > 0) this.emit('lifesteal', { ball: src, x: src.x, y: src.y, amount: got });
    }

    return dealt;
  };

  Match.prototype.onImmunityBlock = function (target, src, opts) {
    target.status.immunityBlocks++;
    this.extendImmunity(target, this.findSkillData(target, 'gojo2'));
    this.emit('immune', {
      ball: target, big: target.status.immunityBig,
      x: target.x, y: target.y, blocked: opts.skillId || null
    });
  };

  /* 成功挡下 → 免疫时间延长（0.2s → 0.5s），只延长一次 */
  Match.prototype.extendImmunity = function (b, gojo2) {
    if (!gojo2) return;
    if (b.status.immunityBig) return;
    b.status.immunityBig = true;
    var ext = gojo2.immunity.extended;
    b.status.immunityUntil = Math.max(b.status.immunityUntil, b.status.immunityStart + ext);
    b.immuneGlow = 0.6;
  };

  Match.prototype.findSkillData = function (b, id) {
    for (var i = 0; i < b.char.skills.length; i++) if (b.char.skills[i].id === id) return b.char.skills[i];
    return null;
  };

  /* 定身：不能移动、不能放技能（CD 照常恢复） */
  /* 领域定身对群：把该方所有活着的球一起定住（含分身） */
  Match.prototype.applyBindAll = function (casterSide, seconds, opts) {
    var list = this.aliveOfSide(1 - casterSide);
    for (var i = 0; i < list.length; i++) this.applyBind(list[i], seconds, opts);
  };
  Match.prototype.applyBind = function (target, seconds, opts) {
    if (!target || !target.alive || seconds <= 0) return;
    opts = opts || {};
    var wasBound = target.isBound(this.t);
    target.status.bindUntil = Math.max(target.status.bindUntil, this.t + seconds);
    /* 定身是通用机制，"特效"由【谁定身谁负责】：
     *   opts.source 指明来源，只有无量空处用那套白蓝爆发 + 六边笼。
     *   不传 source 就只定身、不播任何专属特效。 */
    target.status.bindSource = opts.source || null;
    if (opts.source === 'gojo3' && !wasBound) {
      this.emit('bind', { ball: target, until: target.status.bindUntil, seconds: seconds });
    }
  };

  Match.prototype.damageFormula = function (base) {
    return Math.pow(base, this.cfg.blackFlash.exponent);
  };

  /* 某个球的碰撞伤害（含被动加成，例如虎杖的基础碰撞伤害 +1） */
  Match.prototype.collisionDamageOf = function (ball) {
    var bonus = (ball && ball.char.passive && ball.char.passive.collisionDamageBonus) || 0;
    return this.cfg.collision.damage + bonus;
  };

  /* 某个球的黑闪概率（含被动加成，例如虎杖 +1%） */
  Match.prototype.blackFlashChanceOf = function (ball) {
    var bonus = (ball && ball.char.passive && ball.char.passive.blackFlashBonus) || 0;
    return this.cfg.blackFlash.chance * this.cfg.blackFlash.debugMultiplier + bonus;
  };

  /* ------------------------------------------------------------------
   * 球球碰撞（N 对 N：分身多了也能正确结算，同阵营不互撞）
   * ------------------------------------------------------------------ */
  Match.prototype.checkBallCollision = function () {
    var list = [];
    for (var i = 0; i < this.balls.length; i++) if (this.balls[i].alive) list.push(this.balls[i]);
    for (var x = 0; x < list.length; x++) {
      for (var y = x + 1; y < list.length; y++) {
        var ba = list[x], bb = list[y];
        if (ba.side === bb.side) continue;   // 自己人（本体/分身）之间不结算碰撞
        this.resolveBallPair(ba, bb);
      }
    }
  };

  Match.prototype.resolveBallPair = function (a, b) {
    if (!a.alive || !b.alive) return;
    /* 注意：checkBallCollision 会对【每一对敌人】都调用这里，
     * 真正"有没有碰上"要看下面的距离判断 —— 所以留黑棒必须放在那之后。 */
    this.tryRasenganHit(a, b);

    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.hypot(dx, dy);
    var rr = a.r + b.r;
    if (d >= rr || d < 0.0001) return;

    /* 到这里才算真碰上了：在碰撞点留一枚黑棒 */
    var midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    this.addBlackRod(a, midX, midY);
    this.addBlackRod(b, midX, midY);

    var nx = dx / d, ny = dy / d;

    /* 位置分离 */
    var overlap = rr - d;
    a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
    b.x += nx * overlap / 2; b.y += ny * overlap / 2;

    /* 等质量完全弹性：交换法向速度分量 */
    var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    var rvn = rvx * nx + rvy * ny;
    var e = this.cfg.collision.restitution;
    if (rvn < 0) {
      var imp = -(1 + e) * rvn / 2;
      a.vx -= imp * nx; a.vy -= imp * ny;
      b.vx += imp * nx; b.vy += imp * ny;
    }

    var key = Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id);
    if ((this.pairCd[key] || 0) > 0) return;
    this.pairCd[key] = this.cfg.collision.pairCooldown;
    this.collisions++;

    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.emit('ballhit', { x: mx, y: my, speed: Math.max(a.speed(), b.speed()), a: a.id, b: b.id });

    /* 伤害交给 dealDamage，黑闪判定也集中在那边（含"必定黑闪"状态）。
     * 随机决定谁先结算：后结算的一方是在挨完打、血量更低时才判黑闪，
     * 回满血的收益更大 —— 固定顺序会制造"后手优势"（镜像局偏差的来源之一）。 */
    if (this.rng() < 0.5) { var tmp = a; a = b; b = tmp; }
    this.dealDamage(a.id, b, this.collisionDamageOf(a), 'direct',
      { isCollision: true, skillId: 'collision', x: mx, y: my });
    this.dealDamage(b.id, a, this.collisionDamageOf(b), 'direct',
      { isCollision: true, skillId: 'collision', x: mx, y: my });
  };

  Match.prototype.triggerBlackFlash = function (ball, x, y) {
    ball.blackFlashes++;
    this.blackFlashTotal++;
    if (ball.alive) {
      ball.heal(ball.maxHp - ball.hp, 'blackflash');   // 血量回满（走 heal 才会被统计进"回复"）
      ball.resetCooldowns('yuji2');                     // CD 全恢复，但【黑闪自己】除外（否则虎杖能无限接黑闪）
    }
    ball.flash = 0.6;
    this.emit('blackflash', { ball: ball, x: x, y: y, idx: ball.id });
  };

  /* ------------------------------------------------------------------
   * 结束判定
   * ------------------------------------------------------------------ */
  Match.prototype.checkDeath = function () {
    if (this.phase !== 'fight') return;
    /* 只看本体：分身死光不算输，本体血空才算 */
    var da = !this.mainOf(0).alive;
    var db = !this.mainOf(1).alive;
    if (!da && !db) return;
    this.phase = 'over';
    this.winner = (da && db) ? -1 : (da ? 1 : 0);
    this.emit('end', { winner: this.winner, t: this.t });
  };

  /* 分身阵亡：把它的血量上限还给本体，并把上限的 10% 作为治疗给本体 */
  Match.prototype.onCloneDeath = function (clone) {
    var main = this.mainOf(clone.side);
    if (main) {
      /* 只归还一半上限：否则"分一个 → 死掉 → 全额退上限"等于每 5 秒白送
       * 100 点承伤 + 10 点治疗（约 22 HP/秒），对局会被无限拖长 */
      main.maxHp = Math.min(main.char.hp, main.maxHp + clone.maxHp);
      main.heal(clone.maxHp * 0.10, 'cloneReturn');
    }
    this.emit('cloneDeath', { ball: clone, main: main, x: clone.x, y: clone.y, side: clone.side });
  };

  /* ------------------------------------------------------------------
   * 影分身（鸣人）
   * ------------------------------------------------------------------ */
  /* 分身的体型：按"分到的血量上限比例"缩小，但不会缩得太小（略小一点） */
  Match.prototype.cloneRadius = function (char, maxHp) {
    var ratio = Math.max(0, Math.min(1, maxHp / char.hp));
    return char.radius * (0.55 + 0.45 * Math.sqrt(ratio));
  };

  /* 按当前分身数重新分配血量上限：总量恒为 char.hp
   *   规则（用户指定）：每个分身固定 100 血，剩下的全在本体身上
   *   1 个分身 → 分身 100 / 本体 900      9 个分身 → 每个 100 / 本体 100 */
  Match.prototype.redistributeHp = function (side) {
    var main = this.mainOf(side);
    if (!main) return;
    var total = main.char.hp;
    var perClone = this.cloneHpEach(main.char);
    var clones = this.clonesOf(side);
    var n = clones.length;

    for (var i = 0; i < n; i++) {
      var c = clones[i];
      c.maxHp = perClone;
      c.hp = Math.max(1, Math.min(c.maxHp, c.hp));
      c.r = this.cloneRadius(main.char, c.maxHp);
    }

    var oldMainMax = main.maxHp || total;
    /* 本体上限 = 总上限 - 每个分身 100（用户指定的分配规则，总上限恒为 char.hp） */
    main.maxHp = Math.max(100, total - perClone * n);
    main.hp = Math.max(1, Math.min(main.maxHp, main.hp / oldMainMax * main.maxHp));
    main.r = main.char.radius;
  };

  /* 分身配置（每个分身多少血 / 最多几个） */
  Match.prototype.cloneHpEach = function (char) {
    for (var i = 0; i < char.skills.length; i++) {
      if (char.skills[i].clone) return char.skills[i].clone.hpEach || 100;
    }
    return 100;
  };

  Match.prototype.cloneMax = function (char) {
    for (var i = 0; i < char.skills.length; i++) {
      if (char.skills[i].clone) return char.skills[i].clone.max || 9;
    }
    return 0;
  };

  Match.prototype.spawnClone = function (ownerBall) {
    var self = this;
    var side = ownerBall.side;
    var char = ownerBall.char;
    /* 上限：最多 cloneMax 个 */
    if (this.clonesOf(side).length >= this.cloneMax(char)) return null;
    var idx = this.balls.length;

    var clone = SH.newBall(char.id, idx, side, true);
    clone.ownerId = this.mains[side];
    /* 自己的随机数流（和本体的流要打散，避免分身的决策/判定与本体同步） */
    clone.rng = M.mulberry32(((this.seed * 2654435761) + (idx + 1) * 0x9E3779B1) >>> 0);

    /* 出现在本体附近，尽量不重叠 */
    var placed = false;
    for (var tries = 0; tries < 40 && !placed; tries++) {
      var ang = M.rand(clone.rng, 0, M.TAU);
      var dist = ownerBall.r + clone.r + M.rand(clone.rng, 26, 90);
      var nx = ownerBall.x + Math.cos(ang) * dist;
      var ny = ownerBall.y + Math.sin(ang) * dist;
      var pad = clone.r + 6;
      if (nx < pad || ny < pad || nx > this.cfg.arena.size - pad || ny > this.cfg.arena.size - pad) continue;
      var overlap = false;
      for (var i = 0; i < this.balls.length; i++) {
        var o = this.balls[i];
        if (!o.alive) continue;
        if (M.dist(nx, ny, o.x, o.y) < o.r + clone.r + 10) { overlap = true; break; }
      }
      if (overlap) continue;
      clone.x = nx; clone.y = ny;
      placed = true;
    }
    if (!placed) {
      clone.x = M.clamp(ownerBall.x + 70, clone.r + 6, this.cfg.arena.size - clone.r - 6);
      clone.y = M.clamp(ownerBall.y + 70, clone.r + 6, this.cfg.arena.size - clone.r - 6);
    }

    /* 速度：朝本体之外散开 */
    var va = Math.atan2(clone.y - ownerBall.y, clone.x - ownerBall.x) + M.rand(clone.rng, -0.5, 0.5);
    var sp = this.cfg.ball.startSpeed * this.speedMulOf(clone);
    clone.vx = Math.cos(va) * sp;
    clone.vy = Math.sin(va) * sp;

    this.balls.push(clone);
    this.redistributeHp(side);      // 重新平分（新分身也在这里拿到 maxHp/半径）
    this.emit('cloneSpawn', { ball: clone, main: ownerBall, x: clone.x, y: clone.y, side: side });
    return clone;
  };

  /* 色诱术：本体 + 全部分身 */
  Match.prototype.applyAllure = function (ball, seconds) {
    var until = this.t + seconds;
    var list = this.aliveOfSide(ball.side);
    for (var i = 0; i < list.length; i++) {
      list[i].status.charmUntil = Math.max(list[i].status.charmUntil, until);
    }
    this.emit('allure', { ball: ball, until: until, seconds: seconds, side: ball.side, count: list.length });
  };
  /* ------------------------------------------------------------------
   * 螺旋丸（握在手上一起冲，不脱手）
   * 一对球共享一颗丸子：总共能打 spec.hits 段，每段 spec.damage
   * ------------------------------------------------------------------ */
  Match.prototype.addRasengan = function (a, b, spec) {
    this.rasengans.push({
      ids: [a.id, b.id],
      side: a.side,
      damage: spec.damage,
      hitsLeft: spec.hits,
      until: this.t + (spec.duration || 3),
      spec: spec,
      dead: false
    });
  };

  Match.prototype.updateRasengans = function () {
    var list = this.rasengans;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (g.dead) continue;
      if (this.t >= g.until || g.hitsLeft <= 0) { g.dead = true; continue; }
      var gone = false;
      for (var k = 0; k < g.ids.length; k++) {
        var bb = this.balls[g.ids[k]];
        if (!bb || !bb.alive) gone = true;
      }
      if (gone) g.dead = true;
    }
    var w = 0;
    for (var j = 0; j < list.length; j++) if (!list[j].dead) list[w++] = list[j];
    list.length = w;
  };

  Match.prototype.rasenganOf = function (ballId) {
    for (var i = 0; i < this.rasengans.length; i++) {
      if (this.rasengans[i].ids.indexOf(ballId) >= 0) return this.rasengans[i];
    }
    return null;
  };

  /* 撞上敌人时结算丸子伤害（丸子不脱手，撞到才算） */
  Match.prototype.tryRasenganHit = function (a, b) {
    for (var i = 0; i < this.rasengans.length; i++) {
      var g = this.rasengans[i];
      if (g.dead || g.hitsLeft <= 0) continue;
      var carrier = null, victim = null;
      if (g.ids.indexOf(a.id) >= 0) { carrier = a; victim = b; }
      else if (g.ids.indexOf(b.id) >= 0) { carrier = b; victim = a; }
      else continue;
      if (!victim.alive) continue;

      var dealt = this.dealDamage(carrier.id, victim, g.damage, 'direct', {
        skillId: 'naruto3', x: victim.x, y: victim.y, melee: true
      });
      g.hitsLeft--;
      this.emit('rasenganHit', {
        x: victim.x, y: victim.y, carrier: carrier, victim: victim,
        amount: dealt, left: g.hitsLeft
      });
      if (g.hitsLeft <= 0) g.dead = true;
      return true;
    }
    return false;
  };

  /* ------------------------------------------------------------------
   * 释放技能
   * ------------------------------------------------------------------ */
  /* 技能能不能放（不只是 CD 好了）：有些技能必须"够得着"才允许出手。
   * 例如虎杖的迳庭拳，隔空挥拳不只是浪费，还会让人机看起来很蠢。 */
  Match.prototype.canCastSkill = function (ball, index) {
    if (ball.isBound(this.t)) return false;      // 被定身（无量空处 / 黑棒）：什么技能都放不出来
    var st = ball.skills[index];
    if (!st) return false;
    var impl = SH.SkillImpl[st.data.id];
    if (!impl || !impl.canCast) return true;
    return impl.canCast(this, ball, this.nearestEnemy(ball), st);
  };

  Match.prototype.castSkill = function (ball, index, opts) {
    opts = opts || {};
    if (this.phase !== 'fight' || !ball.alive) return false;
    if (ball.isBound(this.t)) return false;      // 被定身：按不出任何技能
    var st = ball.skills[index];
    if (!st || !st.isReady() || ball.skillLock > 0) return false;
    var impl = SH.SkillImpl[st.data.id];
    if (!impl) return false;
    if (!opts.skipCanCast && !this.canCastSkill(ball, index)) {
      this.emit('castBlocked', { ball: ball, skillId: st.data.id, index: index });
      return false;
    }

    var target = this.nearestEnemy(ball);
    if (impl.cdFor) st.cdOverride = impl.cdFor(this, ball, st, target);
    st.consume();
    ball.skillLock = this.cfg.castGlobalLock;
    ball.stats.casts++;

    impl.cast(this, ball, target, st, opts || {});

    /* 释放过程中累积的 CD 惩罚（黑棒天赋：每摧毁一根 +1 秒）。
     * 必须放在 impl.cast 之后 —— 惩罚是在 cast 里触发的，
     * 而 consume() 已经把 CD 重置为基础值。 */
    if (st.pendingCdPenalty) {
      st.cd = (st.cd || 0) + st.pendingCdPenalty;
      st.pendingCdPenalty = 0;
    }
    return true;
  };

  /* ------------------------------------------------------------------
   * 统一跑一帧 AI：prepare（都判断）→ 统一校验 → commit（都出手）
   * 所有调用方（浏览器主循环 / 模拟器 / 各种探针）都走这里，
   * 保证镜像局两个槽位完全对等
   * ------------------------------------------------------------------ */
  Match.prototype.stepAI = function (ais, dt) {
    var i;
    for (i = 0; i < ais.length; i++) if (ais[i]) ais[i].prepare(dt);
    for (i = 0; i < ais.length; i++) if (ais[i] && !ais[i].canCommit()) ais[i].pending = null;

    /* 同拍出手时顺序才有影响，这时随机决定谁先。
     * 为什么必须随机：后出手的一方是在挨完这一拍的伤害、血量更低的时候才结算，
     * 所以黑闪的"回满血"收益更大 —— 实测固定 0 号先出手时，虎杖内战 0 号只有
     * 41%，反过来就变成 53%（后手方平均多回 48 点血）。随机之后两边各占一半。 */
    var pending = [];
    for (i = 0; i < ais.length; i++) {
      if (ais[i] && ais[i].pending !== null && ais[i].pending !== undefined) pending.push(ais[i]);
    }
    if (pending.length > 1 && this.rng() < 0.5) pending.reverse();

    /* 按打乱后的顺序出手（没有 pending 的 AI 本来也没事可做） */
    for (i = 0; i < pending.length; i++) pending[i].commit();
  };

  /* ------------------------------------------------------------------
   * 瞄准辅助：带部分预判的自动瞄准
   * ------------------------------------------------------------------ */
  Match.prototype.aimDir = function (ball, target, speed) {
    var lead = this.cfg.aimLead;
    var dx = target.x - ball.x, dy = target.y - ball.y;
    var tof = speed > 0 ? Math.hypot(dx, dy) / speed : 0;
    var px = target.x + target.vx * tof * lead;
    var py = target.y + target.vy * tof * lead;
    var d = M.norm(px - ball.x, py - ball.y);

    var noise = ball.aimNoise || 0;
    if (noise > 0) {
      var ang = Math.atan2(d.y, d.x) + (ball.rng() * 2 - 1) * noise;
      d = { x: Math.cos(ang), y: Math.sin(ang) };
    }
    return d;
  };

  Match.prototype.aimPoint = function (target, horizon, leadOverride) {
    var lead = (leadOverride === undefined) ? this.cfg.aimLead : leadOverride;
    return {
      x: M.clamp(target.x + target.vx * horizon * lead, 20, this.cfg.arena.size - 20),
      y: M.clamp(target.y + target.vy * horizon * lead, 20, this.cfg.arena.size - 20)
    };
  };

  /* 从球外缘生成飞行物，避免一出生就和自己重叠 */
  Match.prototype.spawnFrom = function (ball, dir, offset) {
    return {
      x: M.clamp(ball.x + dir.x * offset, 5, this.cfg.arena.size - 5),
      y: M.clamp(ball.y + dir.y * offset, 5, this.cfg.arena.size - 5)
    };
  };

  /* ------------------------------------------------------------------
   * 事件
   * ------------------------------------------------------------------ */
  Match.prototype.emit = function (type, data) {
    data = data || {};
    data.type = type;
    data.t = this.t;
    this.events.push(data);
    if (this.events.length > 2000) this.events.splice(0, 1000);
  };

  Match.prototype.drainEvents = function () {
    if (!this.events.length) return [];
    var e = this.events;
    this.events = [];
    return e;
  };

  /* 结算数据 */
  Match.prototype.summary = function () {
    return {
      winner: this.winner,
      duration: this.t,
      seed: this.seed,
      collisions: this.collisions,
      blackFlashes: this.blackFlashTotal,
      balls: this.balls.map(function (b) {
        return {
          id: b.char.id, name: b.char.name,
          hp: Math.max(0, b.hp), maxHp: b.maxHp,
          dealt: b.stats.damageDealt, taken: b.stats.damageTaken,
          healed: b.stats.healed, casts: b.stats.casts,
          blackFlashes: b.blackFlashes,
          immunityBlocks: b.status.immunityBlocks,
          tenkaiHits: b.status.tenkaiHits,
          bySkill: b.stats.bySkill
        };
      })
    };
  };

  SH.Match = Match;
})();
