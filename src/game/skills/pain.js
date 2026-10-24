/* 佩恩【天道】的技能实现
 *   万象天引（Q）  ：定点引力奇点，吸敌人 + 吸飞行物 + 多段伤害
 *   神罗天征（W）  ：2 充能。短按 = 0.2 秒非直伤免疫 + 弹飞全场（单段低伤）
 *                   长按 0.2 秒 = 超·神罗天征，1 秒免疫 + 巨圈多段高伤
 *   地爆天星（E）  ：丢出会飞的黑色球体，全场吸引 + 从墙上剥岩石
 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  /* ---------------- 一技能：万象天引（Q） ---------------- */
  SH.SkillImpl.pain1 = {
    cast: function (m, ball, target, st) {
      var p = st.data.pull;
      var dir = m.aimDir(ball, target, 600);
      var cx = M.clamp(ball.x + dir.x * p.ahead, 60, m.cfg.arena.size - 60);
      var cy = M.clamp(ball.y + dir.y * p.ahead, 60, m.cfg.arena.size - 60);

      m.emit('cast', {
        ball: ball, skillId: 'pain1',
        title: st.data.name, subtitle: '万象天引',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, aim: dir
      });

      /* 【吸一下】：释放瞬间给一次极强的拉力（速度增量，不是持续吸） */
      m.yank(cx, cy, p.radius, ball.side, { spread: p.spread, caster: ball });

      var f = SH.makeField('pain1', ball.id, cx, cy, {
        charId: ball.char.id,
        radius: p.radius,
        duration: p.duration,
        interval: p.interval,
        damage: p.damage,
        type: 'direct',
        voiceKey: st.data.voiceKey,
        /* 瞬吸之后留一点持续吸力（比瞬吸弱得多，只是"拽着不让跑"） */
        attract: {
          radius: p.radius, accelBall: p.accelBall, accelProj: p.accelProj,
          falloff: p.holdFalloff
        }
      });
      m.fields.push(f);
      m.emit('gravityWell', { x: cx, y: cy, radius: p.radius, life: p.duration });
    }
  };

  /* ---------------- 二技能：神罗天征（W · 支持长按） ---------------- */
  SH.SkillImpl.pain2 = {
    cast: function (m, ball, target, st, opts) {
      var rp = st.data.repel;
      var charged = !!(opts && opts.charged);
      var spec = charged ? rp.big : rp.short;

      /* 免疫除直伤外的所有伤害（照抄无下限的机制：只挡 barrage） */
      if (spec.immunity) {
        ball.status.immunityUntil = Math.max(ball.status.immunityUntil, m.t + spec.immunity);
        ball.status.immunityStart = m.t;
        ball.status.immunityBig = charged;
      }

      /* 释放冷却：和充能点恢复互相独立（短按 5 秒 / 长按 10 秒） */
      if (spec.castCd) st.castCd = Math.max(st.castCd || 0, spec.castCd);

      m.emit('cast', {
        ball: ball, skillId: 'pain2',
        title: charged ? '超·神罗天征' : st.data.name,
        subtitle: charged ? '超·神罗天征' : '神罗天征',
        voiceKey: st.data.voiceKey,
        vfx: charged ? { zoom: 1.13, timeScale: 0.30, slow: 0.85, big: true, roman: 'Shinra Tensei' } : st.data.vfx,
        charged: charged
      });

      var cx = ball.x, cy = ball.y;
      var size = m.cfg.arena.size;

      /* 弹飞范围内的敌人 + 飞行物（弹力极大） */
      var blast = function (radius, knockback, damage, hits) {
        var list = m.aliveOfSide(1 - ball.side);
        for (var i = 0; i < list.length; i++) {
          var b = list[i];
          var d = M.dist(cx, cy, b.x, b.y);
          if (d > radius + b.r) continue;
          var dir = M.norm(b.x - cx, b.y - cy);
          b.vx += dir.x * knockback;
          b.vy += dir.y * knockback;
          if (damage) {
            for (var h = 0; h < (hits || 1); h++) {
              if (!b.alive) break;
              m.dealDamage(ball.id, b, damage, 'direct', {
                skillId: 'pain2', x: b.x, y: b.y, aoe: true
              });
            }
          }
        }
        /* 飞行物：反向弹飞（按离圆心的方向推开） */
        for (var j = 0; j < m.projectiles.length; j++) {
          var q = m.projectiles[j];
          if (q.dead || q.kind === 'grid') continue;
          var dd = M.dist(cx, cy, q.x, q.y);
          if (dd > radius + q.r) continue;
          var qd = M.norm(q.x - cx, q.y - cy);
          var qs = Math.hypot(q.vx, q.vy) || 1;
          var push = Math.max(qs * 1.5, knockback * 0.8);
          q.vx = qd.x * push;
          q.vy = qd.y * push;
        }
      };

      /* 超·神罗天征：本体在原地不动（定住自己，不跟着弹开） */
      if (charged) {
        ball.status.rootUntil = Math.max(ball.status.rootUntil || -1, m.t + spec.duration + 0.1);
        ball.vx = 0; ball.vy = 0;
      }

      if (!charged) {
        blast(spec.radius, spec.knockback, spec.damage, 1);
        /* 小神罗：只有一个小环，迅速放大到【角色直径的 2 倍】 */
        m.emit('shinra', { x: cx, y: cy, radius: spec.radius, ringR: (ball.r || 48) * (spec.ringScale || 4), big: false });
      } else {
        /* 超·神罗：立刻打第一段，然后持续多段 */
        blast(spec.radius, spec.knockback, spec.damage, 1);
        m.emit('shinra', { x: cx, y: cy, radius: spec.radius, big: true });
        var f = SH.makeField('pain2', ball.id, cx, cy, {
          charId: ball.char.id,
          radius: spec.radius,
          duration: spec.duration,
          interval: spec.interval,
          ticks: Math.max(1, Math.round(spec.duration / spec.interval) - 1),
          damage: spec.damage,
          type: 'direct'
        });
        f.noAttract = true;
        m.fields.push(f);
      }
    }
  };

  /* ---------------- 三技能：地爆天星（E · 大招） ---------------- */
  SH.SkillImpl.pain3 = {
    cast: function (m, ball, target, st) {
      var c = st.data.core;
      var dir = m.aimDir(ball, target, c.speed);
      var size = m.cfg.arena.size;

      m.emit('cast', {
        ball: ball, skillId: 'pain3',
        title: st.data.name, subtitle: '地爆天星',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true, aim: dir
      });

      var f = SH.makeField('pain3', ball.id, ball.x + dir.x * 40, ball.y + dir.y * 40, {
        charId: ball.char.id,
        radius: c.radius,
        duration: c.life,
        interval: 0.12,
        damage: 0,
        type: 'direct',
        r: c.r,
        vx: dir.x * c.speed,
        vy: dir.y * c.speed,
        drag: c.drag,
        core: c,
        attract: {
          radius: c.radius, accelBall: c.accelBall, accelProj: c.accelProj, falloff: c.falloff
        }
      });
      m.fields.push(f);
      m.emit('chibaku', { x: f.x, y: f.y, r: c.r, life: c.life });
    }
  };
})();
