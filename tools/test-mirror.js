/* ==========================================================================
 * 镜像局（内战）回归测试
 * --------------------------------------------------------------------------
 * 目前覆盖：
 *   1. 茈的合成只能用自己的苍 —— A 的赫不能抓 B 的苍（用户报的内战 bug）
 *   2. 镜像局的基本不变量（无自伤、输出/承伤对得上、双方契约一致）
 *
 * 用法： node tools/test-mirror.js
 * ========================================================================== */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js','src/game/skills/yuji.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js',
  'src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };

function fresh(p1, p2, seed) {
  const m = new SH.Match({ p1, p2, seed: seed || 99 });
  m.countdownT = 0; m.phase = 'fight'; m.t = 0;
  return m;
}

const GOJO = () => SH.CHARACTERS.gojo.skills[0];

console.log('=== 1. 茈的合成：只能用自己的苍 ===');
{
  const m = fresh('gojo', 'gojo', 101);
  const A = m.balls[0], B = m.balls[1];
  A.x = 200; A.y = 360; A.vx = 0; A.vy = 0;
  B.x = 520; B.y = 360; B.vx = 0; B.vy = 0;

  const spec = GOJO();
  const dir = { x: 1, y: 0 };

  /* B 放一个苍（在场地中间），A 放一个赫，让它们贴在一起 */
  const bBlue = SH.makeOrb('blue', B.id, 360, 360, dir, spec.blue, { charId: 'gojo', skillId: 'gojo1' });
  bBlue.vx = 0; bBlue.vy = 0;
  m.addProjectile(bBlue);
  const aRed = SH.makeOrb('red', A.id, 380, 360, dir, spec.red, { charId: 'gojo', skillId: 'gojo1' });
  aRed.vx = 0; aRed.vy = 0;
  m.addProjectile(aRed);

  for (let i = 0; i < 8; i++) { m.step(DT); m.drainEvents(); }
  const purples = m.projectiles.filter(p => !p.dead && p.kind === 'purple');
  ok(purples.length === 0, 'A 的赫没有和 B 的苍合出茈（合成数 = ' + purples.length + '）');
  ok(!aRed.dead, 'A 的赫还活着（没被对方的苍吃掉）');
  ok(!bBlue.dead, 'B 的苍还活着');
}

console.log('');
console.log('=== 2. 茈的合成：自己的苍赫仍然能合（没修坏） ===');
{
  const m = fresh('gojo', 'gojo', 102);
  const A = m.balls[0], B = m.balls[1];
  A.x = 200; A.y = 360; A.vx = 0; A.vy = 0;
  B.x = 520; B.y = 360; B.vx = 0; B.vy = 0;

  const spec = GOJO();
  const dir = { x: 1, y: 0 };
  const aBlue = SH.makeOrb('blue', A.id, 360, 360, dir, spec.blue, { charId: 'gojo', skillId: 'gojo1' });
  aBlue.vx = 0; aBlue.vy = 0;
  m.addProjectile(aBlue);
  const aRed = SH.makeOrb('red', A.id, 380, 360, dir, spec.red, { charId: 'gojo', skillId: 'gojo1' });
  aRed.vx = 0; aRed.vy = 0;
  m.addProjectile(aRed);

  m.step(DT); m.drainEvents();
  const purples = m.projectiles.filter(p => !p.dead && p.kind === 'purple');
  ok(purples.length === 1, '自己的苍赫合出了 ' + purples.length + ' 个茈（应为 1）');
  if (purples.length) ok(purples[0].owner === A.id, '茈的归属是自己（owner=' + purples[0].owner + '，应为 ' + A.id + '）');
}

console.log('');
console.log('=== 3. 镜像局跑 400 局的不变量 ===');
{
  for (const [p1, p2] of [['gojo', 'gojo'], ['sukuna', 'sukuna'], ['yuji', 'yuji']]) {
    let w0 = 0, w1 = 0, selfHit = 0, mismatch = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const m = new SH.Match({ p1, p2, seed: 5000 + i });
      const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
      let s = 0;
      while (m.phase !== 'over' && s < 60 * 200) {
        m.stepAI(ais, DT);
        m.step(DT);
        for (const e of m.drainEvents()) {
          if (e.type === 'damage' && e.srcIdx !== null && e.srcIdx !== undefined) {
            const src = m.balls[e.srcIdx];
            if (src && e.target && src === e.target) selfHit++;   // 现在只有两颗球，自己打自己 = 同一个 id
          }
        }
        s++;
      }
      if (m.winner === 0) w0++; else if (m.winner === 1) w1++;
      const d0 = m.balls[0].stats.damageDealt, t1 = m.balls[1].stats.damageTaken;
      const d1 = m.balls[1].stats.damageDealt, t0 = m.balls[0].stats.damageTaken;
      if (Math.abs(d0 - t1) > 0.01 || Math.abs(d1 - t0) > 0.01) mismatch++;
      n++;
    }
    const rate = w0 / n * 100;
    ok(selfHit === 0, p1 + ' vs ' + p2 + '：没有友伤（' + selfHit + ' 次）');
    ok(mismatch === 0, p1 + ' vs ' + p2 + '：输出/承伤完全对得上（' + mismatch + ' 局不符）');
    ok(rate > 42 && rate < 58, p1 + ' vs ' + p2 + '：槽位胜率 ' + rate.toFixed(1) + '%（应在 42~58 之间）');
  }
}

console.log('');
console.log(fails === 0 ? '全部通过（' + 0 + ' 项失败）' : ('❌ 有 ' + fails + ' 项失败'));
process.exitCode = fails === 0 ? 0 : 1;
