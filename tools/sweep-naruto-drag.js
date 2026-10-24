#!/usr/bin/env node
/* ==========================================================================
 * 鸣人"拖时间"问题诊断：试几种改法，看哪种能把对局时长压回 60 秒左右
 * 只报告数据，不改 characters.js
 * 用法： node tools/sweep-naruto-drag.js [每局数，默认 800]
 * ========================================================================== */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/core/math.js','src/data/characters.js','src/game/ball.js','src/game/projectile.js',
  'src/game/field.js','src/game/skills/gojo.js','src/game/skills/sukuna.js','src/game/skills/yuji.js',
  'src/game/skills/naruto.js','src/game/ai.js','src/game/match.js'];
const sb = { window: {}, console }; sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
const SH = sb.window.SH;
const DT = 1 / 60;
const N = parseInt(process.argv[2] || '800', 10);

const BASE = JSON.parse(JSON.stringify(SH.CHARACTERS.naruto));
function restore() {
  const fresh = JSON.parse(JSON.stringify(BASE));
  for (const k of Object.keys(SH.CHARACTERS.naruto)) delete SH.CHARACTERS.naruto[k];
  Object.assign(SH.CHARACTERS.naruto, fresh);
}

function run(n, opp, seedBase) {
  let w = 0, d = 0, timeout = 0, dur = 0, cols = 0;
  for (let i = 0; i < n; i++) {
    const m = new SH.Match({ p1: 'naruto', p2: opp, seed: seedBase + i });
    const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
    let s = 0;
    while (m.phase !== 'over' && s < 60 * 200) { m.stepAI(ais, DT); m.step(DT); m.drainEvents(); s++; }
    if (m.phase !== 'over') timeout++;
    else if (m.winner === 0) w++; else if (m.winner === 1) d++;
    dur += m.t; cols += m.collisions;
  }
  return { win: w / n * 100, lose: d / n * 100, timeout: timeout / n * 100, dur: dur / n, cols: cols / n };
}

const CASES = [
  ['现状：回血 100/2s，上限 9', function () {}],
  ['回血 100 → 60', function (y) { y.passive.healAmount = 60; }],
  ['回血 100 → 40', function (y) { y.passive.healAmount = 40; }],
  ['回血 100 → 25', function (y) { y.passive.healAmount = 25; }],
  ['上限 9 → 5', function (y) { y.skills[0].clone.max = 5; }],
  ['上限 9 → 3', function (y) { y.skills[0].clone.max = 3; }],
  ['分身 100 血但本体也按比例分（回到平分，上限保留 9）', function (y) {}],
  ['回血 40 + 上限 5', function (y) { y.passive.healAmount = 40; y.skills[0].clone.max = 5; }],
  ['回血 40 + 上限 3', function (y) { y.passive.healAmount = 40; y.skills[0].clone.max = 3; }]
];

console.log('=== 鸣人拖时间诊断（每个对局 ' + N + ' 局）===');
console.log('');
console.log('  改动                                   vs五条(胜/超时/时长)      vs宿傩(胜/超时/时长)');
console.log('  ' + '-'.repeat(78));
for (const [name, apply] of CASES) {
  restore();
  apply(SH.CHARACTERS.naruto);
  const a = run(N, 'gojo', 31000);
  const b = run(N, 'sukuna', 31000);
  console.log('  ' + name.padEnd(36, ' ') +
    (a.win.toFixed(1) + '% / ' + a.timeout.toFixed(1) + '% / ' + a.dur.toFixed(0) + 's').padStart(22) +
    (b.win.toFixed(1) + '% / ' + b.timeout.toFixed(1) + '% / ' + b.dur.toFixed(0) + 's').padStart(22));
}
restore();
console.log('');
console.log('（超时 = 200 秒还打不完被判平局；正常对局约 54 秒、超时 0%）');
