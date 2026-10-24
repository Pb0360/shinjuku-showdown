/* 水门胜率速测：p1 固定 minato，逐一对位跑 N 局
 * 用法：node tools/sim-minato.js [每组局数，默认 300]
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const L = ['src/core/math.js', 'src/data/characters.js', 'src/game/ball.js', 'src/game/projectile.js', 'src/game/field.js',
  'src/game/skills/gojo.js', 'src/game/skills/sukuna.js', 'src/game/skills/yuji.js', 'src/game/skills/naruto.js',
  'src/game/skills/pain.js', 'src/game/skills/minato.js', 'src/game/ai.js', 'src/game/match.js'];
const s = { window: {}, console }; s.globalThis = s; vm.createContext(s);
for (const f of L) vm.runInContext(fs.readFileSync(f, 'utf8'), s, { filename: f });
const SH = s.window.SH;
const N = parseInt(process.argv[2] || '300', 10);
const names = { gojo: '五条悟', sukuna: '宿傩', yuji: '虎杖', naruto: '鸣人', pain: '佩恩' };
let sum = 0, cnt = 0;
for (const opp of ['gojo', 'sukuna', 'yuji', 'naruto', 'pain']) {
  let w = 0, to = 0, dur = 0, dmg = 0, heal = 0;
  for (let i = 0; i < N; i++) {
    const m = new SH.Match({ p1: 'minato', p2: opp, seed: 95000 + i });
    const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
    let st = 0;
    while (m.phase !== 'over' && st < 60 * 200) { m.stepAI(ais, 1 / 60); m.step(1 / 60); m.drainEvents(); st++; }
    if (m.phase !== 'over') to++; else if (m.winner === 0) w++;
    dur += m.t; dmg += m.balls[0].stats.damageDealt; heal += m.balls[0].stats.healed;
  }
  const pct = w / N * 100; sum += pct; cnt++;
  console.log('水门 vs ' + names[opp].padEnd(4) + ' 胜 ' + pct.toFixed(1) + '%  平均 ' + (dur / N).toFixed(0) + 's  输出 ' + (dmg / N).toFixed(0) + '  回血 ' + (heal / N).toFixed(0) + '  超时 ' + to);
}
console.log('平均胜率 ' + (sum / cnt).toFixed(1) + '%');
