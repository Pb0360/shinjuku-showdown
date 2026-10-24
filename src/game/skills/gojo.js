/* 五条悟的技能实现 */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;
  SH.SkillImpl = SH.SkillImpl || {};

  /* ---------------- 一技能：术式顺转·苍 / 术式反转·赫 / 虚式·茈 ---------------- */
  SH.SkillImpl.gojo1 = {
    cast: function (m, ball, target, st) {
      var mode = M.pickWeighted(ball.rng, st.data.modes);
      var spec = st.data[mode.key];
      var dir = m.aimDir(ball, target, spec.speed);
      var pos = m.spawnFrom(ball, dir, ball.r + spec.r + 2);

      var p = SH.makeOrb(mode.key, ball.id, pos.x, pos.y, dir, spec, {
        charId: ball.char.id,
        skillId: mode.key          // 'blue' / 'red'：让伤害统计能拆到具体招式
      });
      m.addProjectile(p);

      m.emit('cast', {
        ball: ball, skillId: 'gojo1',
        title: mode.title, subtitle: st.data.name,
        voiceKey: mode.voiceKey, vfx: st.data.vfx, move: mode.key
      });
    }
  };

  /* ---------------- 二技能：无下限术式 ---------------- */
  SH.SkillImpl.gojo2 = {
    cast: function (m, ball, target, st) {
      var im = st.data.immunity;
      ball.status.immunityUntil = m.t + im.base;
      ball.status.immunityStart = m.t;
      ball.status.immunityBig = false;
      ball.immuneGlow = 0.35;

      m.emit('cast', {
        ball: ball, skillId: 'gojo2',
        title: '无下限术式', subtitle: '术式',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx
      });
      m.emit('immunity', { ball: ball, until: ball.status.immunityUntil });
    }
  };

  /* ---------------- 三技能：领域展开·无量空处 ---------------- */
  SH.SkillImpl.gojo3 = {
    cast: function (m, ball, target, st) {
      var f = st.data.field;
      var field = SH.makeField('gojo3', ball.id, ball.x, ball.y, {
        charId: ball.char.id,
        damage: f.damage, type: f.type,
        interval: f.interval, ticks: f.ticks,
        duration: f.castTime,
        voiceKey: st.data.voiceKey
      });
      m.fields.push(field);

      /* 无量空处：附加定身 —— 不能移动、不能放技能 */
      if (f.bind) m.applyBindAll(ball.side, f.bind, { source: 'gojo3' });   // 领域定身：对群

      m.emit('cast', {
        ball: ball, skillId: 'gojo3',
        title: st.data.name, subtitle: '领域展开',
        voiceKey: st.data.voiceKey, vfx: st.data.vfx, ultimate: true
      });
      m.emit('domainOpen', { field: field, ball: ball, radius: 1000 });
    }
  };
})();
