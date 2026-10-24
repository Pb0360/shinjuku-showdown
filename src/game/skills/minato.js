/* 波风水门的技能实现
 *   minato1 忍爱之剑：射苦无（速度衰减，慢了停下变标记）；命中则换位 + 横斩
 *   minato2 飞雷神  ：瞬移到苦无；落地附近有敌人就补一发 10×2；1 秒内可接二段
 *   minato3 大招    ：朝敌人扇形丢苦无，然后依次瞬移过去留斩击
 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  /* ---------------- 一技能：忍爱之剑 ---------------- */
  SH.SkillImpl.minato1 = {
    cast: function (m, ball, target, st, opts) {
      var spec = st.data.kunai;
      var charged = !!(opts && opts.charged);

      /* 场上满 2 枚 → 短按毁更早的，长按毁更新的 */
      var placed = m.kunaiOf(ball.side, false);
      var removed = null;
      if (placed.length >= spec.max) {
        removed = charged ? placed[placed.length - 1] : placed[0];
        m.removeKunai(removed);
      }

      /* 朝【敌人方向】射 */
      var aim = m.nearestEnemy(ball);
      var dx, dy;
      if (aim) {
        var nv = M.norm(aim.x - ball.x, aim.y - ball.y);
        dx = nv.x; dy = nv.y;
      } else {
        var vsp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (vsp > 1) { dx = ball.vx / vsp; dy = ball.vy / vsp; }
        else { dx = 1; dy = 0; }
      }

      var proj = SH.makeOrb('kunai', ball.id, ball.x + dx * ball.r, ball.y + dy * ball.r,
        { x: dx, y: dy }, {
          r: spec.r, speed: spec.speed, life: spec.life,
          hit: { amount: spec.hit, type: 'direct' },
          onHit: 'pass'
        }, { charId: 'minato', skillId: 'minato1' });
      proj.drag = spec.decay;
      proj.stopSpeed = spec.stopSpeed;
      proj.kunaiSpec = spec;
      proj.kunaiCap = spec.max;      // 落地时按上限挤掉最早的
      proj.bounceOnWall = true;
      m.addProjectile(proj);

      st.castCd = st.data.castCd || 5;      // 独立的释放冷却

      m.emit('cast', {
        ball: ball, skillId: 'minato1',
        title: st.data.name, subtitle: charged ? '苦无 · 长按' : '苦无',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx,
        aim: { x: dx, y: dy }
      });
      m.emit('kunaiThrow', { x: ball.x, y: ball.y, dir: { x: dx, y: dy }, ball: ball });
      if (removed) m.emit('kunaiBreak', { x: removed.x, y: removed.y });
    }
  };

  /* ---------------- 二技能：飞雷神 ---------------- */
  SH.SkillImpl.minato2 = {
    canCast: function (m, ball, foe, st) {
      if (m.kunaiCount(ball.side) < 1) return false; // 没有苦无：放不出来
      /* 注意：canCastSkill 会【直接返回】这里的结果、跳过 isReady()，
       * 所以按钮灰显必须自己把充能点 / 释放冷却算进去，
       * 否则会出现"按钮亮着但按下去没反应"（二段窗口过期后尤其明显）。 */
      return st ? st.isReady() : true;
    },

    cast: function (m, ball, target, st, opts) {
      var spec = st.data.hiraishin;
      var placed = m.kunaiOf(ball.side, false);
      if (!placed.length) return;

      var charged = !!(opts && opts.charged);
      var stage2 = ball.status.hiraishinUntil > m.t && ball.status.hiraishinFrom >= 0;
      var dest = null, i;

      if (stage2) {
        /* 飞雷神二段：去【另一枚】（第一次去了最新，二段就去更旧的；反之亦然）
         * 从最新往回找，取第一枚不是当前所在的那枚 */
        for (i = placed.length - 1; i >= 0; i--) {
          if (placed[i].id !== ball.status.hiraishinFrom) { dest = placed[i]; break; }
        }
        if (!dest) return;                       // 只有一枚时不传送
        st.freeCast = false;                  // 二段用完，恢复正常（consume 已跳过扣充能）
        ball.status.hiraishinUntil = 0;
        ball.status.hiraishinFrom = -1;
        st.castCd = st.data.castCd || 3;
      } else {
        /* 短按 = 最新的，长按 = 更早的 */
        dest = charged ? placed[0] : placed[placed.length - 1];   // 长按=更早的，短按=最新的
        ball.status.hiraishinUntil = m.t + (spec.stage2 || 1);
        ball.status.hiraishinFrom = dest.id;
        st.castCd = 0;                        // 1 秒窗口内允许再接一次
        st.freeCast = true;                   // 二段免费：没有充能点也能放
      }

      ball.x = dest.x; ball.y = dest.y;
      ball.vx = 0; ball.vy = 0;

      m.emit('cast', {
        ball: ball, skillId: 'minato2',
        title: stage2 ? '飞雷神二段' : st.data.name,
        subtitle: stage2 ? '飞雷神二段' : (charged ? '飞雷神 · 长按' : '飞雷神'),
        voiceKey: st.data.voiceKey, vfx: st.data.vfx
      });
      m.emit('kunaiSwap', { x: ball.x, y: ball.y, ball: ball, stage2: stage2 });

      /* 落地附近有敌人 → 补一发 10 × 2 的螺旋丸 */
      var foe = m.nearestEnemy(ball);
      /* 普通飞雷神落地 2 段；二段触发的 3 段 */
      var hitsN = stage2 ? (spec.stage2Hits || spec.hits || 2) : (spec.hits || 2);
      /* 二段的螺旋丸伤害也更高（15×2 / 25×2） */
      var dmgEach = stage2 ? (spec.stage2Rasengan || spec.rasengan) : spec.rasengan;
      if (foe && foe.alive && M.dist(ball.x, ball.y, foe.x, foe.y) <= (spec.range || 130) + foe.r) {
        for (i = 0; i < hitsN; i++) {
          if (!foe.alive) break;
          m.dealDamage(ball.id, foe, dmgEach || 15, 'direct', {
            skillId: 'minato2', x: foe.x, y: foe.y, rasengan: true
          });
        }
        m.emit('rasenganHit', { x: foe.x, y: foe.y, amount: (dmgEach || 15) * hitsN, left: 0 });

        /* 被动：螺旋丸命中对手后回血 */
        var healAmt = (ball.char.passive && ball.char.passive.rasenganHeal) || 0;
        if (healAmt > 0 && ball.alive) {
          ball.heal(healAmt, '螺旋丸');
          m.emit('heal', { x: ball.x, y: ball.y, amount: healAmt, ball: ball });
        }
      }
    }
  };

  /* ---------------- 吸血球：蝠群 ---------------- */
  SH.SkillImpl.vampire1 = {
    cast: function (m, ball, target, st) {
      var bt = st.data.bat;
      var dur = bt.duration || 3;
      ball.status.batUntil = Math.max(ball.status.batUntil, m.t + dur);
      ball.status.invulnUntil = Math.max(ball.status.invulnUntil, m.t + dur);
      ball.status.rootUntil = Math.max(ball.status.rootUntil, m.t + dur);
      ball.batTick = 0;
      ball.vx = 0; ball.vy = 0;
      m.emit('cast', {
        ball: ball, skillId: 'vampire1',
        title: st.data.name, subtitle: '蝠群',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx
      });
      m.emit('batSwarm', { ball: ball, x: ball.x, y: ball.y, duration: dur });
    }
  };

  /* ---------------- 三技能：螺旋闪光超轮舞吼叁式 ---------------- */
  SH.SkillImpl.minato3 = {
    cast: function (m, ball, target, st) {
      var d = st.data.dance;
      var foe = m.nearestEnemy(ball);
      if (!foe) return;

      var base = M.norm(foe.x - ball.x, foe.y - ball.y);
      var baseAng = Math.atan2(base.y, base.x);
      var made = [];
      var n = d.count || 5;

      for (var i = 0; i < n; i++) {
        var off = (n > 1) ? (i / (n - 1) - 0.5) : 0;
        var ang = baseAng + off * (d.spread || 0.5);
        var dir = { x: Math.cos(ang), y: Math.sin(ang) };
        var proj = SH.makeOrb('kunai', ball.id,
          ball.x + dir.x * ball.r, ball.y + dir.y * ball.r, dir, {
            r: 11, life: 4.0,
            hit: { amount: 0, type: 'direct' },   // 伤害为 0：命中只触发"瞬移+斩击"
            onHit: 'pass'
          }, { charId: 'minato', skillId: 'minato3' });
        /* 每枚苦无初速独立随机；并且【伪随机保证】至少一枚很快、一枚较慢 */
        var jit = (d.speedJitter || 0);
        var base = d.speed || 620;
        var sp;
        if (i === 0) sp = base + jit * 0.95;                 // 第一枚固定很快
        else if (i === n - 1) sp = base - jit * 0.95;        // 最后一枚固定较慢
        else sp = base + (m.rng() * 2 - 1) * jit;            // 中间随机
        var spd = Math.max(200, sp);
        proj.vx = dir.x * spd; proj.vy = dir.y * spd;
        proj.speed = spd;
        proj.drag = d.decay || 1.6;
        proj.stopSpeed = -1;                 // 大招的苦无不停下
        proj.bounceOnWall = true;
        proj.ultKunai = true;
        proj.slashDmg = d.slash || 30;            // 命中后这一刀多少伤害
        m.addProjectile(proj);
        made.push(proj);
      }

      m.emit('cast', {
        ball: ball, skillId: 'minato3',
        title: st.data.name, subtitle: '螺旋闪光超轮舞吼叁式',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true,
        aim: base
      });

      /* 瞬移顺序：离本体【最远】的苦无优先 */
      var bx = ball.x, by = ball.y;
      made.sort(function (p1, p2) {
        return M.dist(bx, by, p2.x, p2.y) - M.dist(bx, by, p1.x, p1.y);
      });

      m.startHiraishinDance(ball, made, d);
    }
  };
})();
