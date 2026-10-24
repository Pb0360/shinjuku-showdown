#!/usr/bin/env node
/* 镜像局按槽位拆分统计：找出到底哪一项偏向 0 号 */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js','src/game/skills/yuji.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js',
  'src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
const N = parseInt(process.argv[2] || '800', 10);
const CH = process.argv[3] || 'yuji';

const acc = [
  { casts: 0, dealt: 0, taken: 0, healed: 0, bf: 0, punchLand: 0, punchHit: 0, win: 0, dur: 0, hpLeft: 0, killBlow: 0 },
  { casts: 0, dealt: 0, taken: 0, healed: 0, bf: 0, punchLand: 0, punchHit: 0, win: 0, dur: 0, hpLeft: 0, killBlow: 0 }
];

for (let i = 0; i < N; i++) {
  const m = new SH.Match({ p1: CH, p2: CH, seed: 91000 + i });
  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  let s = 0, lastSrc = null;
  while (m.phase !== 'over' && s < 60 * 200) {
    m.stepAI(ais, DT);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'punch') { acc[e.ball.id].punchLand++; acc[e.ball.id].punchHit += e.hits; }
      if (e.type === 'damage' && e.srcIdx !== null && e.srcIdx !== undefined) lastSrc = e.srcIdx;
    }
    s++;
  }
  for (const b of m.balls) {
    const a = acc[b.id];
    a.casts += b.stats.casts; a.dealt += b.stats.damageDealt; a.taken += b.stats.damageTaken;
    a.healed += b.stats.healed; a.bf += b.blackFlashes; a.hpLeft += Math.max(0, b.hp); a.dur += m.t;
  }
  if (m.winner === 0 || m.winner === 1) { acc[m.winner].win++; if (lastSrc !== null) acc[lastSrc].killBlow++; }
}

console.log('=== ' + CH + ' 内战按槽位拆分（' + N + ' 局）===');
console.log('');
console.log('  指标                0 号槽位      1 号槽位       差值');
console.log('  ' + '-'.repeat(54));
function row(label, k, digits) {
  const a = acc[0][k] / N, b = acc[1][k] / N;
  const f = (v) => v.toFixed(digits === undefined ? 1 : digits);
  console.log('  ' + label.padEnd(20, ' ') + f(a).padStart(9) + f(b).padStart(14) + f(a - b).padStart(13));
}
row('胜局', 'win', 1);
row('技能释放次数', 'casts');
row('迳庭拳命中次数', 'punchLand');
row('迳庭拳命中段数', 'punchHit');
row('总输出', 'dealt');
row('总承伤', 'taken');
row('总回复', 'healed');
row('黑闪次数', 'bf', 2);
row('最后击杀者次数', 'killBlow', 1);
console.log('');
console.log('  0 号胜率：' + (acc[0].win / N * 100).toFixed(1) + '%   （理想 50%）');
