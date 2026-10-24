/* 临时诊断：苍 的吸引到底有没有生效、有多强 */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js', 'src/game/skills/yuji.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/pain.js','src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/pain.js','src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;

/* 让一个目标以固定速度从苍旁边直线掠过，测 1 秒后的方向偏转 */
function deflection(kind, offset, accelOverride) {
  const m = new SH.Match({ p1: 'gojo', p2: 'sukuna', seed: 1 });
  m.phase = 'fight';
  const ch = SH.CHARACTERS.gojo;
  const bspec = JSON.parse(JSON.stringify(ch.skills[0].blue));
  if (accelOverride !== undefined) {
    bspec.attract.accelBall = accelOverride;
    bspec.attract.accelProj = accelOverride;
  }
  /* 苍 固定在场地中心 */
  const blue = SH.makeOrb('blue', 0, 360, 360, { x: 1, y: 0 }, bspec, { charId: 'gojo', skillId: 'gojo1' });
  blue.vx = 0; blue.vy = 0; blue.life = 99;
  m.addProjectile(blue);

  let angleBefore = 0, angleAfter = 0;
  if (kind === 'ball') {
    const b = m.balls[1];
    b.x = 360 + offset; b.y = 60;
    b.vx = 0; b.vy = 400;                 // 竖直向上穿过，水平偏移 offset
    angleBefore = Math.atan2(b.vy, b.vx);
    for (let i = 0; i < 60; i++) {
      /* 关掉墙与碰撞影响：把这个球放到空旷位置并锁 y 范围 */
      m.step(DT);
      m.drainEvents();
      if (i === 59) angleAfter = Math.atan2(b.vy, b.vx);
    }
    return { before: angleBefore, after: angleAfter, dx: m.balls[1].x - 360, dy: m.balls[1].y - 60 };
  }

  const spec = JSON.parse(JSON.stringify(ch.skills[0].red));
  const red = SH.makeOrb('red', 0, 360 + offset, 60, { x: 0, y: 1 }, spec, { charId: 'gojo', skillId: 'gojo1' });
  red.life = 99;
  m.addProjectile(red);
  angleBefore = Math.atan2(red.vy, red.vx);
  for (let i = 0; i < 40; i++) { m.step(DT); m.drainEvents(); }
  angleAfter = Math.atan2(red.vy, red.vx);
  return { before: angleBefore, after: angleAfter, dx: red.x - 360, dy: red.y - 60 };
}

function show(label, r) {
  const d = (r.after - r.before) * 180 / Math.PI;
  console.log(`${label}  偏转 ${d >= 0 ? '+' : ''}${d.toFixed(1)}°   （横向被拉近 ${(-r.dx).toFixed(1)} 单位）`);
}

console.log('=== 苍 对「敌方球」的吸引（球初速 400 向上 / 苍在中心静止）===');
[50, 110, 170, 220].forEach(function (off) { show(`球 横向偏移 ${off}:`, deflection('ball', off)); });
console.log('');
console.log('=== 苍 对「赫」的吸引（赫速度 700）===');
[50, 110, 170, 300, 400].forEach(function (off) { show(`赫 横向偏移 ${off}:`, deflection('red', off)); });
console.log('');
console.log('=== 如果把 accelBall 调大，球会被拉多少 ===');
[260, 600, 1000, 1600].forEach(function (a) { show(`accelBall=${a}（偏移 110）:`, deflection('ball', 110, a)); });
