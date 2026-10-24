/* 漩涡鸣人的技能实现 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  /* ---------------- 一技能：影分身之术（Q） ---------------- */
  SH.SkillImpl.naruto1 = {
    cast: function (m, ball, target, st) {
      var clone = m.spawnClone(ball);
      m.emit('cast', {
        ball: ball, skillId: 'naruto1',
        title: st.data.name, subtitle: clone ? '影分身之术' : '已达上限',
        voiceKey: clone ? st.data.voiceKey : null, vfx: st.data.vfx,
        full: !clone
      });
    }
  };

  /* ---------------- 二技能：色诱术（W） ---------------- */
  SH.SkillImpl.naruto2 = {
    cast: function (m, ball, target, st) {
      m.emit('cast', {
        ball: ball, skillId: 'naruto2',
        title: st.data.name, subtitle: '色诱术 · 5 秒',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx
      });
      m.applyAllure(ball, st.data.allure.duration);
    }
  };

  /* ---------------- 三技能：螺旋丸（E · 大招） ---------------- */
  /* 只有一颗丸子：本体 + 最近的分身一起搓，丢出去追踪对手。
   * 伤害 = 40 × X，X = 1 + 场上分身数（其他分身不参与搓丸子） */
  SH.SkillImpl.naruto3 = {
    canCast: function (m, ball, target, st) {
      return m.clonesOf(ball.side).length >= 1;
    },

    cast: function (m, ball, target, st) {
      var spec = st.data.rasengan;
      var clones = m.clonesOf(ball.side);
      if (!clones.length) return;

      var foe = m.nearestEnemy(ball);
      if (!foe) return;

      /* 释放螺旋丸立刻打断色诱术（色诱术期间自己打不出伤害） */
      var all = m.aliveOfSide(ball.side);
      for (var z = 0; z < all.length; z++) {
        if (all[z].status.charmUntil > m.t) {
          all[z].status.charmUntil = -1;
          m.emit('charmBreak', { ball: all[z], x: all[z].x, y: all[z].y });
        }
      }

      var X = 1 + clones.length;
      var total = spec.damage * X;
      var seg = Math.round(total / spec.hits);

      /* 最近的那个分身跟本体一起冲 */
      var nearest = clones.slice().sort(function (a, b) {
        return M.dist2(ball.x, ball.y, a.x, a.y) - M.dist2(ball.x, ball.y, b.x, b.y);
      })[0];
      var dir = M.norm(foe.x - ball.x, foe.y - ball.y);
      [ball, nearest].forEach(function (p) {
        p.vx += dir.x * spec.dash;
        p.vy += dir.y * spec.dash;
      });

      m.emit('cast', {
        ball: ball, skillId: 'naruto3',
        title: st.data.name, subtitle: '螺旋丸 · 40 × ' + X,
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true,
        aim: dir
      });

      var ox = (ball.x + nearest.x) / 2, oy = (ball.y + nearest.y) / 2;
      var orb = SH.makeOrb('rasengan', ball.id, ox, oy, dir, {
        r: spec.r, speed: spec.speed, life: spec.life, homing: spec.homing,
        /* 段间隔要小：700 速度穿过对手只有几帧 */
        hit: { amount: seg, type: 'direct', interval: 0.02, maxHits: spec.hits },
        onHit: 'pass'
      }, { charId: ball.char.id, skillId: 'naruto3' });
      orb.maxHits = spec.hits;
      m.addProjectile(orb);

      m.emit('rasengan', { x: ox, y: oy, a: ball, b: nearest, target: foe, dir: dir, damage: total });
    }
  };
})();
