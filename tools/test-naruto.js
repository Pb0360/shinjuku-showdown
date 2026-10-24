/* ==========================================================================
 * 漩涡鸣人 功能验证（当前规则）
 *   1. 影分身：每个固定 100 血、上限 9 个、本体拿剩下的
 *   2. 分身死亡：上限回归本体 + 10% 治疗
 *   3. 分身打不出黑闪
 *   4. 色诱术：非直伤转治疗；【自己打出的伤害无效】；放螺旋丸立刻打断
 *   5. 螺旋丸：需要分身、握在手上撞人、40×2、配对数
 *   6. 被动：本体 100/2s、分身 20/2s
 * 用法： node tools/test-naruto.js
 * ========================================================================== */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js','src/game/skills/yuji.js',
  'src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
/* 夹具说明：测试里会把球摆到固定位置并冻住，所以关掉"速度保底"
 * （那套保底是为了修"被瞬吸后卡死不动"的线上 bug，见 Match.updateBalls） */
SH.CONFIG.ball.minSpeed = 0;
SH.CONFIG.ball.startSpeed = 0;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };

function fresh(p1, p2, seed) {
  const m = new SH.Match({ p1: p1 || 'naruto', p2: p2 || 'gojo', seed: seed || 42 });
  m.countdownT = 0; m.phase = 'fight'; m.t = 0;
  if (m.balls[1]) { m.balls[1].vx = 0; m.balls[1].vy = 0; m.balls[1].skills.forEach(s => { s.cd = 999; }); }
  return m;
}

console.log('=== 1. 影分身：每个固定 100 血、上限 9 ===');
{
  const m = fresh();
  const main = m.balls[0];
  ok(main.maxHp === 1000 && main.hp === 1000, '开局 1000/1000');

  m.spawnClone(main);
  ok(m.clonesOf(0).length === 1, '分出 1 个分身');
  ok(m.clonesOf(0)[0].maxHp === 100, '分身上限 = ' + m.clonesOf(0)[0].maxHp + '（固定 100）');
  ok(main.maxHp === 900, '本体上限 = ' + main.maxHp + '（1000 - 100）');

  m.spawnClone(main);
  ok(m.clonesOf(0).length === 2 && m.clonesOf(0)[1].maxHp === 100, '第 2 个分身也是 100');
  ok(main.maxHp === 800, '本体上限 = ' + main.maxHp + '（1000 - 200）');
  ok(m.clonesOf(0)[0].r < main.r, '分身半径 ' + m.clonesOf(0)[0].r.toFixed(1) + ' < 本体 ' + main.r.toFixed(1));

  for (let i = 0; i < 12; i++) m.spawnClone(main);
  ok(m.clonesOf(0).length === 9, '最多只能有 9 个分身（实测 ' + m.clonesOf(0).length + '）');
  ok(main.maxHp === 100, '9 个分身时本体上限 = ' + main.maxHp);
  const totalMax = m.aliveOfSide(0).reduce((s, b) => s + b.maxHp, 0);
  ok(totalMax === 1000, '总上限仍是 ' + totalMax);
  ok(m.spawnClone(main) === null, '第 10 个分身分不出来（返回 null）');
}

console.log('');
console.log('=== 2. 分身死亡：上限回归本体 + 10% 治疗 ===');
{
  const m = fresh();
  const main = m.balls[0];
  m.spawnClone(main);
  const clone = m.clonesOf(0)[0];
  main.hp = 200;
  m.dealDamage(1, clone, 99999, 'direct', { skillId: 'test' });
  ok(!clone.alive, '分身已阵亡');
  ok(main.maxHp === 1000, '本体上限全额归还：' + main.maxHp);
  ok(Math.abs(main.hp - 210) < 1, '本体回血 ' + (main.hp - 200).toFixed(0) + '（应为上限的 10% = 10）');
}

console.log('');
console.log('=== 3. 分身打不出黑闪 ===');
{
  const m = fresh();
  const main = m.balls[0];
  m.spawnClone(main);
  const clone = m.clonesOf(0)[0];
  const foe = m.balls[1];
  foe.hp = foe.maxHp = 999999;
  for (let i = 0; i < 3000; i++) m.dealDamage(clone.id, foe, 8, 'direct', { isCollision: true, skillId: 'collision' });
  ok(clone.blackFlashes === 0, '分身 3000 次碰撞打出黑闪 ' + clone.blackFlashes + ' 次（应 0）');
}

console.log('');
console.log('=== 4. 色诱术：挨打回血 + 自己打不出伤害 + 放丸子打断 ===');
{
  const m = fresh();
  const main = m.balls[0];
  m.spawnClone(main);
  const foe = m.balls[1];
  m.applyAllure(main, 5);
  ok(main.status.charmUntil > m.t && m.clonesOf(0)[0].status.charmUntil > m.t, '本体与分身都进入色诱术');

  main.hp = 300;
  m.dealDamage(foe.id, main, 120, 'barrage', { skillId: 'blue' });
  ok(main.hp === 420, '弹幕 120 → 回血：' + main.hp.toFixed(0));

  const fh = foe.hp;
  m.dealDamage(main.id, foe, 500, 'barrage', { skillId: 'test' });
  ok(foe.hp === fh, '色诱术期间自己打出的伤害无效（对手血量没变：' + foe.hp.toFixed(0) + '）');

  const bh = foe.hp;
  m.dealDamage(main.id, foe, 50, 'direct', { skillId: 'test' });
  ok(foe.hp === bh, '直伤也一样打不出去（这是色诱术的代价）');

  main.skills.forEach(s => s.resetAll());
  main.skillLock = 0;
  main.x = 100; main.y = 360; foe.x = 620; foe.y = 360;
  foe.vx = 0; foe.vy = 0;
  ok(m.castSkill(main, 2) === true, '释放螺旋丸');
  ok(main.status.charmUntil < 0, '色诱术被立刻打断（charmUntil=' + main.status.charmUntil + '）');
  const bh2 = foe.hp;
  m.dealDamage(main.id, foe, 30, 'barrage', { skillId: 'test' });
  ok(foe.hp === bh2 - 30, '打断后伤害恢复正常：' + (bh2 - foe.hp).toFixed(0));
}

console.log('');
console.log('=== 5. 螺旋丸：握在手上冲过去撞人 ===');
{
  const m = fresh();
  const main = m.balls[0];
  const foe = m.balls[1];
  main.skills.forEach(s => s.resetAll());
  ok(m.canCastSkill(main, 2) === false, '没有分身时放不出来');
  ok(m.castSkill(main, 2) === false, 'castSkill 也返回 false');

  m.spawnClone(main);
  ok(m.canCastSkill(main, 2) === true, '有 1 个分身就能放了');

  main.x = 150; main.y = 360; foe.x = 560; foe.y = 360;
  foe.hp = foe.maxHp = 999999; foe.r = 46;
  m.clonesOf(0)[0].x = 120; m.clonesOf(0)[0].y = 360;
  main.skillLock = 0;
  ok(m.castSkill(main, 2) === true, '释放成功');
  ok(m.projectiles.filter(p => p.kind === 'rasengan').length === 1, '丢出 1 颗会追踪的丸子');

  let dealt = 0, segs = 0;
  for (let i = 0; i < 72; i++) {
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'damage' && e.skillId === 'naruto3') { dealt += e.amount; segs++; }
    }
  }
  ok(dealt >= 78 && dealt <= 82, '1 个分身：造成 ' + dealt.toFixed(0) + ' 点（' + segs + ' 段，应 40 × 2 = 80）');

  /* 3 个分身 → 40 × 4 = 160，而且只有一颗丸子 */
  const m2 = fresh('naruto', 'gojo', 77);
  const main2 = m2.balls[0], foe2 = m2.balls[1];
  m2.spawnClone(main2); m2.spawnClone(main2); m2.spawnClone(main2);
  main2.skills.forEach(s => s.resetAll());
  main2.skillLock = 0;
  main2.x = 150; main2.y = 360; foe2.x = 560; foe2.y = 360;
  foe2.hp = foe2.maxHp = 999999; foe2.r = 46;
  m2.clonesOf(0).forEach(cl => { cl.x = 130; cl.y = 360; });
  m2.castSkill(main2, 2);
  ok(m2.projectiles.filter(p => p.kind === 'rasengan').length === 1, '3 个分身时【也只有一颗丸子】');
  let d2 = 0;
  for (let i = 0; i < 72; i++) {
    m2.step(DT);
    for (const e of m2.drainEvents()) if (e.type === 'damage' && e.skillId === 'naruto3') d2 += e.amount;
  }
  ok(d2 >= 155 && d2 <= 165, '3 个分身：造成 ' + d2.toFixed(0) + ' 点（应 40 × 4 = 160）');
}

console.log('');
console.log('=== 6. 被动：本体 100/2s、分身 20/2s ===');
{
  const m = fresh();
  const main = m.balls[0];
  m.spawnClone(main);
  const clone = m.clonesOf(0)[0];
  main.hp = 200; clone.hp = 50;
  const m0 = main.hp, c0 = clone.hp;
  for (let i = 0; i < 121; i++) m.step(DT);
  ok(Math.abs((main.hp - m0) - 100) < 1, '本体 2 秒回 ' + (main.hp - m0).toFixed(0) + '（应 100）');
  ok(Math.abs((clone.hp - c0) - 20) < 1, '分身 2 秒回 ' + (clone.hp - c0).toFixed(0) + '（应 20）');
}

console.log('');
console.log(fails === 0 ? '全部通过（0 项失败）' : ('❌ 有 ' + fails + ' 项失败'));
process.exitCode = fails === 0 ? 0 : 1;
