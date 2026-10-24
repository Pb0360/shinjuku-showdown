#!/usr/bin/env node
/* ==========================================================================
 * 时间暂缓覆盖率：一局里有多少比例的时间在慢动作里
 * --------------------------------------------------------------------------
 * 调手感时用这个：改完 vfx 里的 timeScale / slow，跑一下看覆盖率。
 * 经验值：
 *   0%    —— 全程原速，技能太快要靠反应（用户反馈"不好反应"）
 *   7%    —— 只有大招和黑闪（实测过，偏快）
 *   25~30% —— 现在这一版（普通技能 70% 强度）
 *   40%+  —— 每个技能都重慢放（用户反馈"一卡一卡"）
 *
 * 用法： node tools/probe-slow.js [局数]
 * ========================================================================== */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js', 'src/game/skills/yuji.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
const N = parseInt(process.argv[2] || '400', 10);

/* fx.js 里写在代码里的那几处暂缓（不在 characters.js 里） */
const CODE_SLOWS = { fuse: [0.55, 0.42], immuneBig: [0.65, 0.25] };

function coverage(intervals) {
  if (!intervals.length) return 0;
  intervals.sort(function (a, b) { return a[0] - b[0]; });
  let total = 0, s = intervals[0][0], e = intervals[0][1];
  for (const iv of intervals) {
    if (iv[0] > e) { total += e - s; s = iv[0]; e = iv[1]; }
    else e = Math.max(e, iv[1]);
  }
  return total + (e - s);
}

let sumSlow = 0, sumDur = 0, sumMatches = 0, slowCasts = 0, totalCasts = 0;

for (let i = 0; i < N; i++) {
  const m = new SH.Match({ p1: 'gojo', p2: 'sukuna', seed: 25000 + i });
  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  const iv = [];
  let s = 0;
  while (m.phase !== 'over' && s < 60 * 300) {
    m.stepAI(ais, DT);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'cast') {
        totalCasts++;
        const v = e.vfx || {};
        if (v.timeScale !== undefined && v.timeScale < 0.999 && v.slow > 0) {
          slowCasts++;
          iv.push([m.t, m.t + v.slow]);
        }
      } else if (e.type === 'blackflash') {
        iv.push([m.t, m.t + SH.CONFIG.blackFlash.slowMo]);
      } else if (e.type === 'fuse') {
        iv.push([m.t, m.t + CODE_SLOWS.fuse[1]]);
      } else if (e.type === 'immune' && e.big) {
        iv.push([m.t, m.t + CODE_SLOWS.immuneBig[1]]);
      }
    }
    s++;
  }
  sumSlow += coverage(iv);
  sumDur += m.t;
  sumMatches++;
}

console.log('=== 时间暂缓覆盖率（' + N + ' 局）===');
console.log('慢放总时长   ' + (sumSlow / sumMatches).toFixed(2) + ' 秒/局');
console.log('平均对局     ' + (sumDur / sumMatches).toFixed(1) + ' 秒');
console.log('覆盖率       ' + (sumSlow / sumDur * 100).toFixed(1) + '%');
console.log('会触发慢放的施法占比  ' + (slowCasts / totalCasts * 100).toFixed(1) + '%' +
  '（' + slowCasts + '/' + totalCasts + ' 次）');
console.log('');
console.log('各技能的暂缓配置：');
for (const id of ['gojo', 'sukuna']) {
  const ch = SH.CHARACTERS[id];
  ch.skills.forEach(function (sk, i) {
    const v = sk.vfx || {};
    const label = sk.short || sk.name;
    console.log('  ' + ch.name + ' ' + (i + 1) + '技能 ' + label +
      '  timeScale=' + (v.timeScale === undefined ? 1 : v.timeScale) +
      '  持续=' + (v.slow || 0) + 's' + (sk.ultimate ? '   ← 大招' : ''));
    if (sk.purple) console.log('        （茈）timeScale=' + sk.purple.vfx.timeScale + ' 持续=' + sk.purple.vfx.slow + 's');
  });
}
console.log('  代码内：茈合成 timeScale=' + CODE_SLOWS.fuse[0] + ' 持续=' + CODE_SLOWS.fuse[1] +
  's   无下限挡下强化 timeScale=' + CODE_SLOWS.immuneBig[0] + ' 持续=' + CODE_SLOWS.immuneBig[1] + 's');
console.log('  黑闪 timeScale=0.28 持续=' + SH.CONFIG.blackFlash.slowMo + 's');
