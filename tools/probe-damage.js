#!/usr/bin/env node
/* ==========================================================================
 * 伤害构成细查：每一招每局打多少、每次放出去打多少
 * --------------------------------------------------------------------------
 * 用法：
 *   node tools/probe-damage.js [局数] [角色1] [角色2]
 *   node tools/probe-damage.js 800 yuji gojo
 *   node tools/probe-damage.js 1500                （默认 gojo vs sukuna）
 *
 * 角色与技能都是动态读 characters.js 的，新增角色不用改这个脚本。
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
const N = parseInt(process.argv[2] || '1500', 10);
const P1 = process.argv[3] || 'gojo';
const P2 = process.argv[4] || 'sukuna';

/* ------------------------------------------------------------------
 * 技能 key → 显示名（按角色动态生成）
 * ------------------------------------------------------------------ */
const LABEL = { collision: '球体碰撞', blackflash: '黑闪', reflect: '反弹飞行物', tenkai: '领域展延' };
const MULTI = {
  gojo1: [['blue', '苍'], ['red', '赫'], ['purple', '茈']],
  sukuna1: [['slash', '解'], ['grid', '捌']]
};
const KEYS = {};
for (const id of Object.keys(SH.CHARACTERS)) {
  const ch = SH.CHARACTERS[id];
  const keys = [];
  ch.skills.forEach(function (sk) {
    if (MULTI[sk.id]) {
      MULTI[sk.id].forEach(function (p) { LABEL[p[0]] = p[1]; keys.push(p[0]); });
    } else {
      LABEL[sk.id] = sk.short || sk.name;
      keys.push(sk.id);
    }
  });
  keys.push('reflect', 'collision', 'blackflash');
  KEYS[id] = keys;
}

/* 统计"放出去多少次" */
const castCount = {};
const origOrb = SH.makeOrb, origSlash = SH.makeSlash, origGrid = SH.makeGrid, origField = SH.makeField;
SH.makeOrb = function (kind) { castCount[kind] = (castCount[kind] || 0) + 1; return origOrb.apply(null, arguments); };
SH.makeSlash = function () { castCount.slash = (castCount.slash || 0) + 1; return origSlash.apply(null, arguments); };
SH.makeGrid = function () { castCount.grid = (castCount.grid || 0) + 1; return origGrid.apply(null, arguments); };
SH.makeField = function (kind) { castCount[kind] = (castCount[kind] || 0) + 1; return origField.apply(null, arguments); };

const dmg = {};          // "0:skill" / "1:skill" -> 伤害
let w0 = 0, w1 = 0, cols = 0, dur = 0, bf = 0;

for (let i = 0; i < N; i++) {
  const m = new SH.Match({ p1: P1, p2: P2, seed: 20260101 + i });
  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  let s = 0;
  while (m.phase !== 'over' && s < 60 * 200) {
    m.stepAI(ais, DT);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'damage') {
        const k = e.srcIdx + ':' + (e.skillId || 'unknown');
        dmg[k] = (dmg[k] || 0) + e.amount;
      }
    }
    s++;
  }
  if (m.winner === 0) w0++; else if (m.winner === 1) w1++;
  cols += m.collisions; dur += m.t; bf += m.blackFlashTotal;
  for (const b of m.balls) {
    for (const st of b.skills) {
      const key = 'cast_' + b.char.id + '_' + st.data.id;
      castCount[key] = (castCount[key] || 0) + st.used;
    }
  }
}

function per(side, k) { return (dmg[side + ':' + k] || 0) / N; }

/* 某个角色的某个技能被放了多少次（充能/多形态的技能会被拆开统计） */
function castOf(charId, skillId) { return (castCount['cast_' + charId + '_' + skillId] || 0) / N; }

function table(charId, title) {
  const keys = KEYS[charId];
  const total = keys.reduce(function (s, k) { return s + per(charId === P1 ? 0 : 1, k); }, 0);
  const side = charId === P1 ? 0 : 1;
  console.log('');
  console.log('【' + title + '】每局总输出 ' + total.toFixed(1));
  console.log('  招式            每局伤害   占比     释放次数/局   每次平均');
  for (const k of keys) {
    const d = per(side, k);
    if (d <= 0.05) continue;
    /* 释放次数：优先用投射物计数（苍/赫/解…），没有投射物的（迳庭拳）用技能自己的 used */
    let cnt = (castCount[k] || 0) / N;
    if (cnt === 0) {
      const owner = keys === KEYS[charId] ? charId : null;
      const sk = owner && SH.CHARACTERS[owner].skills.filter(function (s) {
        return s.id === k || (MULTI[s.id] || []).some(function (p) { return p[0] === k; });
      })[0];
      if (sk) cnt = castOf(owner, sk.id);
    }
    console.log('  ' + (LABEL[k] || k).padEnd(12, '　') +
      String(d.toFixed(1)).padStart(8) +
      ('  ' + (d / total * 100).toFixed(1) + '%').padStart(8) +
      String(cnt.toFixed(2)).padStart(12) +
      (cnt > 0 ? String((d / cnt).toFixed(1)).padStart(12) : ''.padStart(12)));
  }
  return total;
}

console.log('=== 伤害构成细查（' + N + ' 局）===');
console.log(P1 + ' vs ' + P2);
table(P1, SH.CHARACTERS[P1].name);
table(P2, SH.CHARACTERS[P2].name);

console.log('');
console.log('技能释放次数/局（按槽位）：');
for (const id of [P1, P2]) {
  const ch = SH.CHARACTERS[id];
  const parts = ch.skills.map(function (sk) {
    let n = castOf(id, sk.id);
    if (MULTI[sk.id]) {
      n = MULTI[sk.id].reduce(function (s, p) { return s + (castCount[p[0]] || 0) / N; }, 0);
    }
    return 'slot' + sk.slot + ' ' + (sk.short || sk.name) + ' ' + n.toFixed(2);
  });
  console.log('  ' + ch.name + '：' + parts.join(' / '));
}

console.log('');
console.log('胜率 ' + SH.CHARACTERS[P1].name + ' ' + (w0 / N * 100).toFixed(1) + '%   ' +
  SH.CHARACTERS[P2].name + ' ' + (w1 / N * 100).toFixed(1) + '%   ' +
  '平均时长 ' + (dur / N).toFixed(1) + 's   碰撞 ' + (cols / N).toFixed(1) + ' 次/局   黑闪 ' + (bf / N).toFixed(2) + ' 次/局');
