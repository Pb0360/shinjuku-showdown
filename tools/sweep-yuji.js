#!/usr/bin/env node
/* ==========================================================================
 * 虎杖悠仁 参数扫描：逐个旋钮试，看对胜率的影响
 * --------------------------------------------------------------------------
 * 只报告数据，不改 characters.js 里的任何值。
 * 用法： node tools/sweep-yuji.js [每个对局的局数，默认 1200]
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
const N = parseInt(process.argv[2] || '1200', 10);

/* 备份一份原始虎杖数据，每个配置都从它开始 */
const BASE = JSON.parse(JSON.stringify(SH.CHARACTERS.yuji));

function restore() {
  const fresh = JSON.parse(JSON.stringify(BASE));
  for (const k of Object.keys(SH.CHARACTERS.yuji)) delete SH.CHARACTERS.yuji[k];
  Object.assign(SH.CHARACTERS.yuji, fresh);
}

function runMatch(p1, p2, seed) {
  const m = new SH.Match({ p1, p2, seed });
  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  let s = 0;
  while (m.phase !== 'over' && s < 60 * 200) {
    m.stepAI(ais, DT);
    m.step(DT);
    m.drainEvents();
    s++;
  }
  return m;
}

function winRate(p1, p2, n) {
  let w = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const m = runMatch(p1, p2, 777000 + i);
    if (m.winner === 0) w++; else if (m.winner === -1) d++;
  }
  return w / n * 100;
}

/* 每个配置：名字 + 对 SH.CHARACTERS.yuji 做的改动 */
const CONFIGS = [
  ['现在：cd 0.5 + 2×8+6=22 + 射程 200', function () {}],
  ['射程 220 + cd 0.5 + 22', function (y) { y.skills[0].punch.range = 220; }],
  ['射程 240 + cd 0.5 + 22', function (y) { y.skills[0].punch.range = 240; }],
  ['射程 260 + cd 0.5 + 1×8+6=14', function (y) { y.skills[0].punch.range = 260; y.skills[0].punch.hits = 1; }],
  ['射程 260 + cd 0.5 + 1×8+3=11', function (y) { y.skills[0].punch.range = 260; y.skills[0].punch.hits = 1; y.skills[0].punch.bonus = 3; }],
  ['射程 260 + cd 0.9 + 22', function (y) { y.skills[0].punch.range = 260; y.skills[0].cd = 0.9; }],
  ['射程 260 + cd 1.2 + 22', function (y) { y.skills[0].punch.range = 260; y.skills[0].cd = 1.2; }],
  ['射程 240 + cd 0.8 + 22', function (y) { y.skills[0].punch.range = 240; y.skills[0].cd = 0.8; }],
  ['射程 240 + cd 1.0 + 22', function (y) { y.skills[0].punch.range = 240; y.skills[0].cd = 1.0; }],
  ['射程 260 + cd 0.5 + 1×8+6 + 血量 1000', function (y) { y.skills[0].punch.range = 260; y.skills[0].punch.hits = 1; y.hp = 1000; }]
];

console.log('=== 虎杖悠仁 参数扫描（每个对局 ' + N + ' 局）===');
console.log('');
console.log('  配置                              vs五条悟   vs宿傩    综合');
console.log('  ' + '-'.repeat(62));

const rows = [];
for (const [name, apply] of CONFIGS) {
  restore();
  apply(SH.CHARACTERS.yuji);
  const g = winRate('yuji', 'gojo', N);
  const s = winRate('yuji', 'sukuna', N);
  rows.push({ name, g, s, avg: (g + s) / 2 });
}
restore();

/* 基线放在最前面参考 */
const base = rows[0];
for (const r of rows) {
  const dg = r.g - base.g, ds = r.s - base.s;
  const tag = r === base ? '' :
    '  (' + (dg >= 0 ? '+' : '') + dg.toFixed(1) + ' / ' + (ds >= 0 ? '+' : '') + ds.toFixed(1) + ')';
  console.log('  ' + r.name.padEnd(32, ' ') +
    r.g.toFixed(1).padStart(7) + '%' +
    r.s.toFixed(1).padStart(9) + '%' +
    r.avg.toFixed(1).padStart(8) + '%' + tag);
}

console.log('');
console.log('（"综合" = 两个对局的平均胜率。括号里是相对基线的变化。）');

/* 顺便看看宿傩那场的承伤，判断是不是"太脆" */
console.log('');
console.log('=== 基线下的详细数据（各 600 局）===');
restore();
for (const opp of ['gojo', 'sukuna']) {
  let dealt = 0, taken = 0, healed = 0, hpLeft = 0, dur = 0, over = 0;
  for (let i = 0; i < 600; i++) {
    const m = runMatch('yuji', opp, 555000 + i);
    dealt += m.balls[0].stats.damageDealt;
    taken += m.balls[0].stats.damageTaken;
    healed += m.balls[0].stats.healed;
    hpLeft += Math.max(0, m.balls[0].hp);
    dur += m.t;
    if (m.balls[0].hp > m.balls[1].hp) over++;
  }
  console.log('  对 ' + SH.CHARACTERS[opp].name +
    '：输出 ' + (dealt / 600).toFixed(0) +
    '  承伤 ' + (taken / 600).toFixed(0) +
    '  回复 ' + (healed / 600).toFixed(0) +
    '  平均残血 ' + (hpLeft / 600).toFixed(0) +
    '  平均时长 ' + (dur / 600).toFixed(1) + 's');
}
