/* 宿傩的技能实现 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;
  SH.SkillImpl = SH.SkillImpl || {};

  /* ---------------- 一技能：解 / 捌 ---------------- */
  SH.SkillImpl.sukuna1 = {
    /* 捌 的 CD 更长，先按距离决定这次用哪个 CD */
    cdFor: function (m, ball, st, target) {
      var d = st.data;
      var dist = M.dist(ball.x, ball.y, target.x, target.y);
      return dist < d.nearRange ? d.cdGrid : d.cd;
    },

    cast: function (m, ball, target, st) {
      var d = st.data;
      var dist = M.dist(ball.x, ball.y, target.x, target.y);
      var useGrid = dist < d.nearRange;

      if (useGrid) {
        var g = d.grid;
        var ap = m.aimPoint(target, 0.12);
        var grid = SH.makeGrid(ball.id, ap.x, ap.y, g, {
          charId: ball.char.id
        });
        m.addProjectile(grid);
        m.emit('cast', {
          ball: ball, skillId: 'sukuna1', move: 'grid',
          title: '捌', subtitle: '解 / 捌',
          voiceKey: '捌', vfx: st.data.vfx
        });
      } else {
        var s = d.slash;
        var dir = m.aimDir(ball, target, s.speed);
        var pos = m.spawnFrom(ball, dir, ball.r + 8);
        var slash = SH.makeSlash(ball.id, pos.x, pos.y, dir, s, {
          charId: ball.char.id
        });
        m.addProjectile(slash);
        m.emit('cast', {
          ball: ball, skillId: 'sukuna1', move: 'slash',
          title: '解', subtitle: '解 / 捌',
          voiceKey: '解', vfx: st.data.vfx
        });
      }
    }
  };

  /* ---------------- 二技能：灶·开 ---------------- */
  SH.SkillImpl.sukuna2 = {
    cast: function (m, ball, target, st) {
      var spec = st.data.arrow;
      var dir = m.aimDir(ball, target, spec.speed);
      var pos = m.spawnFrom(ball, dir, ball.r + spec.r + 2);
      var p = SH.makeOrb('arrow', ball.id, pos.x, pos.y, dir, spec, {
        charId: ball.char.id          // skillId 默认取 kind = 'arrow'
      });
      p.spin = Math.atan2(dir.y, dir.x);
      m.addProjectile(p);

      m.emit('cast', {
        ball: ball, skillId: 'sukuna2',
        title: st.data.name, subtitle: '术式',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx,
        aim: dir                      // 给特效层用：火焰弓的朝向
      });
    }
  };

  /* ---------------- 三技能：领域展开·伏魔御厨子 ---------------- */
  SH.SkillImpl.sukuna3 = {
    cast: function (m, ball, target, st) {
      var f = st.data.field;
      var field = SH.makeField('sukuna3', ball.id, ball.x, ball.y, {
        charId: ball.char.id,
        radius: f.radius, duration: f.duration, interval: f.interval,
        damageRatio: f.damageRatio, refSkill: f.refSkill, refAmount: f.refAmount,
        type: f.type, voiceKey: st.data.voiceKey
      });
      m.fields.push(field);

      m.emit('cast', {
        ball: ball, skillId: 'sukuna3',
        title: st.data.name, subtitle: '领域展开',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true
      });
      m.emit('domainOpen', { field: field, ball: ball, radius: f.radius });
    }
  };
})();
