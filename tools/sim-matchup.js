/* 通用对位胜率：node tools/sim-matchup.js <p1> <p2> [局数]
 * 例：node tools/sim-matchup.js gojo yuji 200
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const L = ['src/core/math.js', 'src/data/characters.js', 'src/game/ball.js', 'src/game/projectile.js', 'src/game/field.js',
  'src/game/skills/gojo.js', 'src/game/skills/sukuna.js', 'src/game/skills/yuji.js', 'src/game/skills/naruto.js',
  'src/game/skills/pain.js', 'src/game/skills/minato.js', 'src/game/ai.js', 'src/game/match.js'];
const s = { window: {}, console }; s.globalThis = s; vm.createContext(s);
for (const f of L) vm.runInContext(fs.readFileSync(f, 'utf8'), s, { filename: f });
const SH = s.window.SH;

const p1 = process.argv[2] || 'gojo';
const p2 = process.argv[3] || 'yuji';
const N = parseInt(process.argv[4] || '200', 10);
const names = { gojo: '五条悟', sukuna: '宿傩', yuji: '虎杖', naruto: '鸣人', pain: '佩恩', minato: '水门' };

let w = 0, to = 0, dur = 0, dmg = 0, taken = 0;
for (let i = 0; i < N; i++) {
  const m = new SH.Match({ p1: p1, p2: p2, seed: 100000 + i });
  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  let st = 0;
  while (m.phase !== 'over' && st < 60 * 200) { m.stepAI(ais, 1 / 60); m.step(1 / 60); m.drainEvents(); st++; }
  if (m.phase !== 'over') to++; else if (m.winner === 0) w++;
  dur += m.t; dmg += m.balls[0].stats.damageDealt; taken += m.balls[0].stats.damageTaken;
}
console.log((names[p1] || p1) + ' vs ' + (names[p2] || p2) + '  ' + N + ' 局');
console.log('  ' + (names[p1] || p1) + ' 胜 ' + (w / N * 100).toFixed(1) + '%   负 ' + ((N - w - to) / N * 100).toFixed(1) + '%   超时 ' + to);
console.log('  平均 ' + (dur / N).toFixed(0) + 's   输出 ' + (dmg / N).toFixed(0) + '   承伤 ' + (taken / N).toFixed(0));
