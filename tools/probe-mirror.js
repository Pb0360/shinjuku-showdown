#!/usr/bin/env node
/* ==========================================================================
 * 镜像局槽位偏差探针：找出"0 号槽位占便宜"的原因
 * --------------------------------------------------------------------------
 * 做法：在完全镜像的对局里改掉某一个机制，看偏差有没有消失。
 * 用法： node tools/probe-mirror.js [每组局数，默认 800]
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
const N = parseInt(process.argv[2] || '800', 10);

const BASE_YUJI = JSON.parse(JSON.stringify(SH.CHARACTERS.yuji));
function restoreYuji() {
  const fresh = JSON.parse(JSON.stringify(BASE_YUJI));
  for (const k of Object.keys(SH.CHARACTERS.yuji)) delete SH.CHARACTERS.yuji[k];
  Object.assign(SH.CHARACTERS.yuji, fresh);
}

function slot0Rate(p1, p2, n, seedBase) {
  let w0 = 0, w1 = 0, draw = 0;
  for (let i = 0; i < n; i++) {
    const m = new SH.Match({ p1, p2, seed: seedBase + i });
    const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
    let s = 0;
    while (m.phase !== 'over' && s < 60 * 200) {
      m.stepAI(ais, DT);
      m.step(DT);
      m.drainEvents();
      s++;
    }
    if (m.winner === 0) w0++; else if (m.winner === 1) w1++; else draw++;
  }
  return { rate: w0 / n * 100, w0, w1, draw };
}

function line(label, r) {
  const dev = r.rate - 50;
  const flag = Math.abs(dev) > 4 ? '  ← 偏差明显' : '';
  console.log('  ' + label.padEnd(34, ' ') + r.rate.toFixed(1).padStart(6) + '%   (0号 ' + r.w0 + ' / 1号 ' + r.w1 + ')' + flag);
}

console.log('=== 镜像局 0 号槽位胜率（' + N + ' 局/组，理想值 50%）===');
console.log('');

console.log('【基线】');
restoreYuji();
line('虎杖 vs 虎杖', slot0Rate('yuji', 'yuji', N, 91000));
line('五条 vs 五条', slot0Rate('gojo', 'gojo', N, 91000));
line('宿傩 vs 宿傩', slot0Rate('sukuna', 'sukuna', N, 91000));

console.log('');
console.log('【虎杖：逐个关掉可疑机制，看哪个能消掉偏差】');

restoreYuji();
SH.CHARACTERS.yuji.skills[0].punch.knockback = 0;
line('① 迳庭拳不击飞', slot0Rate('yuji', 'yuji', N, 91000));

restoreYuji();
SH.CHARACTERS.yuji.skills[0].punch.range = 5000;
line('② 迳庭拳射程无限（canCast 恒真）', slot0Rate('yuji', 'yuji', N, 91000));

restoreYuji();
SH.CHARACTERS.yuji.skills[0].cd = 3.0;
line('③ 迳庭拳 CD 拉到 3 秒', slot0Rate('yuji', 'yuji', N, 91000));

restoreYuji();
SH.CHARACTERS.yuji.skills[1].cd = 999;
line('④ 禁掉大招（黑闪）', slot0Rate('yuji', 'yuji', N, 91000));

restoreYuji();
SH.CHARACTERS.yuji.passive.speedMul = 1;
SH.CHARACTERS.yuji.speedMul = 1;
line('⑤ 去掉速度 +30%', slot0Rate('yuji', 'yuji', N, 91000));

restoreYuji();
line('（恢复原样核对）虎杖 vs 虎杖', slot0Rate('yuji', 'yuji', N, 91000));
