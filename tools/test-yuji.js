/* 临时：虎杖悠仁两个技能的功能验证 */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js','src/game/skills/yuji.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js',
  'src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
const ok = (c, m) => console.log((c ? '  ✅ ' : '  ❌ ') + m);

function fresh(p2, seed) {
  const m = new SH.Match({ p1: 'yuji', p2: p2, seed: seed || 7 });
  m.countdownT = 0; m.phase = 'fight'; m.t = 0;
  m.balls[0].skills.forEach(s => s.resetAll());
  m.balls[1].skills.forEach(s => s.resetAll());
  return m;
}

console.log('=== 被动 西中之虎 ===');
{
  const m = fresh('gojo', 11);
  const a = m.balls[0], b = m.balls[1];
  ok(a.char.hp === 800, 'HP = ' + a.char.hp + '（应为 800）');
  ok(m.collisionDamageOf(a) === 8, '碰撞伤害 = ' + m.collisionDamageOf(a) + '（被动的 +1 已移除，回到基础 8）');
  ok(m.collisionDamageOf(b) === 8, '对手碰撞伤害 = ' + m.collisionDamageOf(b) + '（8，无被动）');
  const ca = Math.abs(m.blackFlashChanceOf(a) - 0.035) < 1e-9;
  ok(ca, '黑闪概率 = ' + (m.blackFlashChanceOf(a) * 100) + '%（2.5% + 1%）');
  ok(Math.abs(m.blackFlashChanceOf(b) - 0.025) < 1e-9, '对手黑闪概率 = ' + (m.blackFlashChanceOf(b) * 100) + '%');
  ok(Math.abs(a.speed() - 400 * 1.3) < 2, '开局速度 = ' + a.speed().toFixed(0) + '（400 × 1.3 = 520）');
  ok(Math.abs(b.speed() - 400) < 2, '对手开局速度 = ' + b.speed().toFixed(0));
  // 速度上限也要 ×1.3
  a.vx = 5000; a.vy = 0; m.step(DT);
  ok(Math.abs(a.speed() - 900 * 1.3) < 3, '最高速被夹到 = ' + a.speed().toFixed(0) + '（900 × 1.3 = 1170）');
}

console.log('');
console.log('=== 一技能 迳庭拳（Q）===');
{
  const m = fresh('gojo', 12);
  const a = m.balls[0], b = m.balls[1];
  b.skills.forEach(s => { s.cd = 99; });      // 不让对手还手干扰
  a.x = 300; a.y = 360; a.vx = 0; a.vy = 0;
  b.x = 420; b.y = 360; b.vx = 0; b.vy = 0;   // 距离 120 < 射程 200
  const hp0 = b.hp;
  ok(m.castSkill(a, 0) === true, '释放成功');
  const evs = m.drainEvents();
  const dmgs = evs.filter(e => e.type === 'damage');
  ok(dmgs.length === 3, '产生 ' + dmgs.length + ' 次伤害事件（2 次碰撞 + 1 次附加）');
  ok(hp0 - b.hp === 22, '总伤害 = ' + (hp0 - b.hp) + '（8 × 2 + 6 = 22）');
  ok(b.vx > 300, '被弹开：vx = ' + b.vx.toFixed(0) + '（应明显向右）');
  ok(evs.some(e => e.type === 'punch'), '有 punch 特效事件');
  ok(Math.abs(a.skills[0].cd - SH.CHARACTERS.yuji.skills[0].cd) < 0.01, 'CD 开始转：' + a.skills[0].cd.toFixed(2) + 's（数据里配的 ' + SH.CHARACTERS.yuji.skills[0].cd + 's）');
}

console.log('');
console.log('=== 一技能：超出射程根本放不出去（canCast）===');
{
  const m = fresh('gojo', 13);
  const a = m.balls[0], b = m.balls[1];
  a.x = 100; a.y = 100; b.x = 600; b.y = 600;   // 距离约 707
  const hp0 = b.hp;
  const casted = m.castSkill(a, 0);
  const evs = m.drainEvents();
  ok(casted === false, '释放被拒绝（castSkill 返回 false）');
  ok(b.hp === hp0, '没造成伤害');
  ok(!evs.some(e => e.type === 'punchMiss'), '连空挥特效都没有（不再隔空挥拳）');
  ok(evs.some(e => e.type === 'castBlocked'), '发出 castBlocked 事件（界面据此变灰）');
  ok(a.skills[0].cd === 0, 'CD 没被消耗（放不出去就不进冷却）');
  ok(m.canCastSkill(a, 0) === false, 'canCastSkill 判定为否');

  /* 靠近之后就能放了 */
  a.x = 300; a.y = 360; b.x = 380; b.y = 360;
  ok(m.canCastSkill(a, 0) === true, '进入射程后 canCastSkill 为真');
  ok(m.castSkill(a, 0) === true, '这时候能正常放出去');
}

console.log('');
console.log('=== 弹开力度（要"弹得更远"）===');
{
  const m = fresh('gojo', 16);
  const a = m.balls[0], b = m.balls[1];
  b.skills.forEach(s => { s.cd = 99; });
  a.x = 300; a.y = 360; b.x = 400; b.y = 360;
  a.vx = 0; a.vy = 0; b.vx = 0; b.vy = 0;
  m.castSkill(a, 0);
  m.drainEvents();
  const kb = Math.hypot(b.vx, b.vy);
  ok(kb >= 900, '被弹开速度 = ' + kb.toFixed(0) + '（≥ 900，超过常规最高速）');

  /* 真的飞很远：场地只有 720 宽，留足空间再测 0.2 秒（950 × 0.2 = 190） */
  a.skills[0].resetAll(); a.skillLock = 0;
  a.x = 300; a.y = 360;
  b.x = 400; b.y = 360; b.vx = 0; b.vy = 0;
  m.castSkill(a, 0);
  m.drainEvents();
  const x0 = b.x;
  for (let i = 0; i < 12; i++) { m.step(DT); m.drainEvents(); }
  ok(b.x - x0 > 150, '0.2 秒内被推远 ' + (b.x - x0).toFixed(0) + ' 单位（> 150；场地只有 720 宽，再久就撞墙了）');
}

console.log('');
console.log('=== 二技能 黑闪（W）：必定黑闪状态 ===');
{
  const m = fresh('gojo', 14);
  const a = m.balls[0], b = m.balls[1];
  b.skills.forEach(s => { s.cd = 99; });
  ok(m.castSkill(a, 1) === true, '释放成功');
  ok(a.status.guaranteedBlackFlash === 1, '状态已挂上：' + a.status.guaranteedBlackFlash + ' 层');

  /* 兑现：迳庭拳打出去 */
  a.x = 300; a.y = 360; b.x = 420; b.y = 360;
  a.skillLock = 0;
  const hp0 = b.hp, hpA = a.hp = 100;   // 把自己打残，验证回满
  m.castSkill(a, 0);
  const evs = m.drainEvents();
  const dmgs = evs.filter(e => e.type === 'damage');
  const bf = evs.filter(e => e.type === 'blackflash');
  ok(a.status.guaranteedBlackFlash === 0, '状态已消耗');
  ok(bf.length === 1, '触发 ' + bf.length + ' 次黑闪（应为 1）');
  ok(dmgs.length === 3 && dmgs[0].skillId === 'blackflash', '只有第一下是黑闪，后两下是普通（' + dmgs.map(d => d.skillId).join(' / ') + '）');
  const expect = Math.round(Math.pow(8, 2.5));
  ok(Math.abs(dmgs[0].amount - expect) <= 1, '黑闪伤害 = ' + dmgs[0].amount + '（8^2.5 = ' + expect + '）');
  ok(a.hp === a.maxHp, '自己回满血：' + a.hp + '/' + a.maxHp + '（放之前是 ' + hpA + '）');
  ok(dmgs[1].amount === 8, '第二下仍是普通 8 点');
}

console.log('');
console.log('=== 黑闪的"CD 全清"不清大招（防无限循环）===');
{
  const m = fresh('gojo', 15);
  const a = m.balls[0], b = m.balls[1];
  a.skills[1].cd = 30;         // 大招冷却中（30 秒）
  a.status.guaranteedBlackFlash = 1;
  a.x = 300; a.y = 360; b.x = 400; b.y = 360;
  a.skillLock = 0;
  ok(a.skills[0].isReady(), '一技能就绪（CD ' + a.skills[0].cd + '）');
  m.castSkill(a, 0);
  m.drainEvents();
  ok(a.skills[0].cd === 0, '刚放完的一技能 CD 被清（' + a.skills[0].cd + '）← 这是"CD 全清"的意义');
  ok(a.skills[1].cd > 29, '大招 CD 保持不动（' + a.skills[1].cd.toFixed(1) + 's）← 否则会无限循环');
}

console.log('');
console.log('=== 键位 / 槽位 ===');
{
  const ch = SH.CHARACTERS.yuji;
  const keys = { 1: 'Q', 2: 'W', 3: 'E' };
  ch.skills.forEach(s => console.log('  ' + keys[s.slot] + ' → ' + s.name + '（slot ' + s.slot + ', CD ' + s.cd + 's）'));
  ok(ch.skills.length === 2, '只有 2 个技能');
  ok(ch.skills.map(s => s.slot).join(',') === '1,2', '槽位是 1,2 → 键位 Q,W（没有 E）');
}
