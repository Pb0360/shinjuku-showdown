/* 虎杖悠仁的技能实现（只有 1 技能和 2 技能） */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  /* ---------------- 一技能：迳庭拳（Q） ---------------- */
  SH.SkillImpl.yuji1 = {
    /* 够得着才允许出手：隔空挥拳既浪费又难看，人机还会一直空挥 */
    canCast: function (m, ball, target, st) {
      if (!target || !target.alive) return false;
      var p = st.data.punch;
      return M.dist(ball.x, ball.y, target.x, target.y) <= p.range + target.r;
    },

    cast: function (m, ball, target, st) {
      var p = st.data.punch;
      var dist = M.dist(ball.x, ball.y, target.x, target.y);
      var dmgEach = m.collisionDamageOf(ball);     // 自己的碰撞伤害（含被动 +1）
      var hit = 0;
      var ang = Math.atan2(target.y - ball.y, target.x - ball.x);

      m.emit('cast', {
        ball: ball, skillId: 'yuji1',
        title: st.data.name, subtitle: '迳庭拳',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx,
        aim: M.norm(target.x - ball.x, target.y - ball.y)
      });

      if (!target.alive) {
        m.emit('punchMiss', { ball: ball, x: ball.x, y: ball.y });
        return;
      }
      /* 注意：这里【不再】重新判断距离。
       * canCast 已经在"出手前那一份统一状态"上判定过了（玩家按键时判一次、
       * AI 在 Match.stepAI 里对双方各判一次）。如果这里再判一次，先出手的一方
       * 把对手击飞出射程后，后手那一拳就会变成空挥 —— 虎杖内战胜率 41% 的根源。 */

      /* 2 次碰撞伤害（第二下只有在对手还活着时才算）
       * 标记 contact：这两下算"接触伤害"，会被无下限术式挡下。
       * 下面的附加直伤不带这个标记，所以照样打穿。 */
      for (var i = 0; i < p.hits; i++) {
        if (!target.alive) break;
        var dealt = m.dealDamage(ball.id, target, dmgEach, p.type, {
          skillId: 'yuji1', x: target.x, y: target.y, melee: true, contact: true
        });
        if (dealt > 0) hit++;
      }

      /* 附加直伤（固定值，独立结算一次，所以会单独飘一个数字） */
      if (target.alive && p.bonus) {
        if (m.dealDamage(ball.id, target, p.bonus, p.type, {
          skillId: 'yuji1', x: target.x, y: target.y, melee: true
        }) > 0) hit++;
      }

      /* 把对手弹开（力度很大，能直接把人轰到墙上） */
      if (target.alive) {
        var dir = M.norm(target.x - ball.x, target.y - ball.y);
        target.vx += dir.x * p.knockback;
        target.vy += dir.y * p.knockback;
      }

      m.emit('punch', {
        ball: ball, target: target, hits: hit, ang: ang,
        x: target.x, y: target.y,
        x0: ball.x, y0: ball.y
      });
    }
  };

  /* ---------------- 二技能：黑闪（W） ---------------- */
  SH.SkillImpl.yuji2 = {
    cast: function (m, ball, target, st) {
      var n = st.data.buff.guaranteedBlackFlash;
      ball.status.guaranteedBlackFlash += n;

      m.emit('cast', {
        ball: ball, skillId: 'yuji2',
        title: st.data.name, subtitle: '大招 · 状态',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true
      });
      m.emit('charged', { ball: ball, n: ball.status.guaranteedBlackFlash });
    }
  };
})();
