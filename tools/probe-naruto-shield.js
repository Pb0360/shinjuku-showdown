#!/usr/bin/env node
/* 拖时间根因验证：分身当护盾 vs 回血 */
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
const N = parseInt(process.argv[2] || '600', 10);
const BASE = JSON.parse(JSON.stringify(SH.CHARACTERS.naruto));
function restore() {
  const f = JSON.parse(JSON.stringify(BASE));
  for (const k of Object.keys(SH.CHARACTERS.naruto)) delete SH.CHARACTERS.naruto[k];
  Object.assign(SH.CHARACTERS.naruto, f);
}

/* 直接改 Match 的行为来对比：分身阵亡归还比例 */
const origOnDeath = SH.Match.prototype.onCloneDeath;
function setReturn(frac) {
  SH.Match.prototype.onCloneDeath = function (clone) {
    var main = this.mainOf(clone.side);
    if (main) {
      main.maxHp = Math.max(200, Math.min(main.char.hp, main.maxHp + clone.maxHp * frac));
      main.heal(clone.maxHp * 0.10, 'cloneReturn');
    }
    this.emit('cloneDeath', { ball: clone, main: main, x: clone.x, y: clone.y, side: clone.side });
  };
}

function run(opp, seedBase) {
  let w = 0, to = 0, dur = 0, dealt = 0, taken = 0;
  for (let i = 0; i < N; i++) {
    const m = new SH.Match({ p1: 'naruto', p2: opp, seed: seedBase + i });
    const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
    let s = 0;
    while (m.phase !== 'over' && s < 60 * 200) { m.stepAI(ais, DT); m.step(DT); m.drainEvents(); s++; }
    if (m.phase !== 'over') to++; else if (m.winner === 0) w++;
    dur += m.t; dealt += m.balls[0].stats.damageDealt; taken += m.balls[0].stats.damageTaken;
  }
  return { w: w / N * 100, to: to / N * 100, dur: dur / N, dealt: dealt / N, taken: taken / N };
}

console.log('=== 拖时间根因验证（每个对局 ' + N + ' 局）===');
console.log('');
const CASES = [
  ['归还 50%（当前代码）+ 战斗回血 40', 0.5, null],
  ['归还 0%（分身彻底吃掉上限）', 0.0, null],
  ['归还 0% + 战斗回血 20', 0.0, 20],
  ['归还 0% + 战斗回血 0（只有脱战才回）', 0.0, 0],
  ['归还 0% + 战斗中完全不回血 + 分身上限 5', 0.0, 0, 5]
];
for (const [name, frac, combatHeal, maxClone] of CASES) {
  restore();
  if (combatHeal !== null) SH.CHARACTERS.naruto.passive.healAmountCombat = combatHeal;
  if (maxClone) SH.CHARACTERS.naruto.skills[0].clone.max = maxClone;
  setReturn(frac);
  const a = run('gojo', 41000);
  const b = run('sukuna', 41000);
  console.log('  ' + name.padEnd(40, ' ') +
    ('vs五条 ' + a.w.toFixed(1) + '% / 超时' + a.to.toFixed(1) + '% / ' + a.dur.toFixed(0) + 's  承伤' + a.taken.toFixed(0)).padStart(30) +
    ('   vs宿傩 ' + b.w.toFixed(1) + '% / 超时' + b.to.toFixed(1) + '% / ' + b.dur.toFixed(0) + 's').padStart(30));
}
SH.Match.prototype.onCloneDeath = origOnDeath;
restore();
console.log('');
console.log('（正常对局约 54 秒、超时 0%）');
