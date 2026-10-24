#!/usr/bin/env node
/* ==========================================================================
 * 无头批量模拟 —— 机器 vs 机器跑胜率
 * --------------------------------------------------------------------------
 * 用法：
 *   node tools/sim.js                         默认 500 局 五条悟 vs 宿傩
 *   node tools/sim.js --n 2000                跑 2000 局
 *   node tools/sim.js --p1 sukuna --p2 gojo   换边
 *   node tools/sim.js --p1 gojo --p2 gojo     内战
 *   node tools/sim.js --seed 12345            固定种子（可复现）
 *   node tools/sim.js --trace 1               打印 1 局的详细事件流（调试用）
 *   node tools/sim.js --bfm 1000              把黑闪调试倍率调到 1000（测试黑闪演出）
 *
 * 说明：模拟器加载的是和浏览器完全相同的那几个逻辑文件（用 vm 沙箱运行），
 *       所以这里跑出来的胜率就是真实对局的胜率。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DT = 1 / 60;
const MAX_SECONDS = 300; // 单局上限 5 分钟，超时算平局

/* 只加载纯逻辑文件（不含渲染 / 音频 / UI） */
const LOGIC_FILES = [
  'src/core/math.js',
  'src/data/characters.js',
  'src/game/ball.js',
  'src/game/projectile.js',
  'src/game/field.js',
  'src/game/skills/gojo.js',
  'src/game/skills/sukuna.js', 'src/game/skills/yuji.js', 'src/game/skills/naruto.js','src/game/skills/pain.js','src/game/skills/minato.js','src/game/skills/pain.js','src/game/skills/minato.js',
  'src/game/ai.js',
  'src/game/match.js'
];

function loadWorld() {
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const rel of LOGIC_FILES) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox.window.SH;
}

/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) ? argv[++i] : '1';
      out[k] = v;
    }
  }
  return out;
}

function runOne(SH, p1, p2, seed, opts) {
  opts = opts || {};
  const m = new SH.Match({ p1, p2, seed });
  if (opts.bfm) m.cfg.blackFlash.debugMultiplier = opts.bfm;

  const ais = [new SH.AI(m, 0), new SH.AI(m, 1)];
  const maxSteps = Math.ceil(MAX_SECONDS / DT);
  let steps = 0;

  while (m.phase !== 'over' && steps < maxSteps) {
    /* 两阶段：双方都基于同一份局面做判断，再统一释放 */
    m.stepAI(ais, DT);
    m.step(DT);
    if (opts.trace) traceEvents(m.drainEvents(), m);
    else m.drainEvents();
    steps++;
  }

  const sum = m.summary();
  sum.timedOut = (m.phase !== 'over');
  if (sum.timedOut) sum.winner = null;
  return sum;
}

/* 调试：把一局的事件流打出来（压缩输出，避免刷屏） */
function traceEvents(events, m) {
  for (const e of events) {
    const tag = e.type;
    if (tag === 'damage') {
      const src = e.srcIdx === null ? '-' : m.balls[e.srcIdx].char.name;
      console.log(`  t=${m.t.toFixed(2)} 伤害 ${src} → ${e.target.char.name} ` +
        `${e.amount.toFixed(1)} [${e.dmgType}${e.tenkai ? '/展延' : ''}] skill=${e.skillId}`);
    } else if (tag === 'cast') {
      console.log(`  t=${m.t.toFixed(2)} 释放 ${e.ball.char.name} :: ${e.title}`);
    } else if (tag === 'blackflash') {
      console.log(`  t=${m.t.toFixed(2)} ★★ 黑闪！ ${e.ball.char.name} 回满血 + CD 全清`);
    } else if (tag === 'end') {
      console.log(`  t=${m.t.toFixed(2)} 结束 winner=${e.winner}`);
    } else if (tag === 'immune') {
      console.log(`  t=${m.t.toFixed(2)} 无下限挡下伤害${e.big ? '（加强）' : ''}`);
    }
  }
}

/* ------------------------------------------------------------------ */
function fmt(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toFixed(d || 0); }

function bar(ratio, width) {
  width = width || 24;
  const n = Math.round(ratio * width);
  return '█'.repeat(n) + '·'.repeat(width - n);
}

function main() {
  const args = parseArgs(process.argv);
  const SH = loadWorld();

  const n = parseInt(args.n || '500', 10);
  const p1 = args.p1 || 'gojo';
  const p2 = args.p2 || 'sukuna';
  const baseSeed = args.seed !== undefined ? parseInt(args.seed, 10) : 20260101;
  const bfm = args.bfm ? parseFloat(args.bfm) : 0;

  if (args.trace) {
    console.log(`=== 单局追踪 ${p1} vs ${p2} seed=${baseSeed} ===`);
    const r = runOne(SH, p1, p2, baseSeed, { trace: true, bfm });
    console.log('--- 结果 ---');
    printSummary(r);
    return;
  }

  console.log(`=== 新宿对决 · 平衡模拟 ===`);
  console.log(`${SH.CHARACTERS[p1].name} vs ${SH.CHARACTERS[p2].name}   ${n} 局   种子 ${baseSeed}` +
    (bfm ? `   黑闪倍率 ×${bfm}` : ''));
  console.log('');

  const t0 = Date.now();
  let win1 = 0, win2 = 0, draw = 0, timeout = 0;
  let durSum = 0, durMin = 1e9, durMax = 0;
  let bfMatches = 0, bfTotal = 0, collisionsSum = 0;
  const agg = [{}, {}];
  const acc = [
    { dealt: 0, taken: 0, healed: 0, casts: 0, blocks: 0, tenkai: 0, bf: 0, hpLeft: 0 },
    { dealt: 0, taken: 0, healed: 0, casts: 0, blocks: 0, tenkai: 0, bf: 0, hpLeft: 0 }
  ];

  for (let i = 0; i < n; i++) {
    const r = runOne(SH, p1, p2, baseSeed + i, { bfm });
    if (r.timedOut) timeout++;
    if (r.winner === 0) win1++;
    else if (r.winner === 1) win2++;
    else draw++;

    durSum += r.duration;
    durMin = Math.min(durMin, r.duration);
    durMax = Math.max(durMax, r.duration);
    collisionsSum += r.collisions;
    bfTotal += r.blackFlashes;
    if (r.blackFlashes > 0) bfMatches++;

    for (let k = 0; k < 2; k++) {
      const b = r.balls[k], a = acc[k];
      a.dealt += b.dealt; a.taken += b.taken; a.healed += b.healed; a.casts += b.casts;
      a.blocks += b.immunityBlocks; a.tenkai += b.tenkaiHits; a.bf += b.blackFlashes;
      a.hpLeft += Math.max(0, b.hp);
      for (const sk in b.bySkill) agg[k][sk] = (agg[k][sk] || 0) + b.bySkill[sk];
    }
  }

  const dtMs = Date.now() - t0;
  const pct1 = win1 / n, pct2 = win2 / n, pctD = draw / n;

  console.log(`胜率    ${SH.CHARACTERS[p1].name}  ${fmt(pct1 * 100, 1)}%  ${bar(pct1)}`);
  console.log(`        ${SH.CHARACTERS[p2].name}  ${fmt(pct2 * 100, 1)}%  ${bar(pct2)}`);
  if (draw) console.log(`        平局  ${fmt(pctD * 100, 1)}%（其中超时 ${timeout} 局）`);
  console.log('');
  console.log(`对局时长  平均 ${fmt(durSum / n, 1)}s   最短 ${fmt(durMin, 1)}s   最长 ${fmt(durMax, 1)}s`);
  console.log(`球球碰撞  平均 ${fmt(collisionsSum / n, 1)} 次/局`);
  console.log(`黑闪      共 ${bfTotal} 次 · 出现黑闪的对局 ${bfMatches}/${n} (${fmt(bfMatches / n * 100, 2)}%)`);
  console.log('');
  console.log('分角色数据（每局平均）');
  for (let k = 0; k < 2; k++) {
    const a = acc[k], c = SH.CHARACTERS[k === 0 ? p1 : p2];
    console.log(`  ${c.name.padEnd(4, '　')} 输出 ${fmt(a.dealt / n, 1)}  承伤 ${fmt(a.taken / n, 1)}  ` +
      `回复 ${fmt(a.healed / n, 1)}  出手 ${fmt(a.casts / n, 1)} 次  ` +
      `挡伤 ${fmt(a.blocks / n, 1)}  被展延命中 ${fmt(a.tenkai / n, 1)}  黑闪 ${a.bf || 0}  残血 ${fmt(a.hpLeft / n, 1)}`);
    const rows = Object.keys(agg[k]).map(sk => [sk, agg[k][sk] / n]).sort((x, y) => y[1] - x[1]);
    if (rows.length) {
      const total = rows.reduce((s, r) => s + r[1], 0) || 1;
      console.log('        伤害构成： ' + rows.map(r =>
        `${skillLabel(SH, k === 0 ? p1 : p2, r[0])} ${fmt(r[1] / total * 100, 1)}%(${fmt(r[1], 1)})`
      ).join('  '));
    }
    console.log('');
  }

  console.log(`耗时 ${(dtMs / 1000).toFixed(1)}s（${fmt(dtMs / n, 1)}ms/局）`);
}

function skillLabel(SH, charId, skillId) {
  if (skillId === 'collision') return '碰撞';
  if (skillId === 'blackflash') return '黑闪';
  if (skillId === 'reflect') return '反弹';
  if (skillId === 'blue') return '苍';
  if (skillId === 'red') return '赫';
  if (skillId === 'purple') return '茈';
  if (skillId === 'arrow') return '灶·开';
  if (skillId === 'slash') return '解';
  if (skillId === 'grid') return '捌';
  const ch = SH.CHARACTERS[charId];
  for (const s of ch.skills) if (s.id === skillId) return s.short || s.name;
  return skillId;
}

function printSummary(r) {
  console.log(`胜者：${r.winner === null ? '平局/超时' : r.balls[r.winner].name}`);
  console.log(`时长：${fmt(r.duration, 1)}s   碰撞：${r.collisions}   黑闪：${r.blackFlashes}`);
  for (const b of r.balls) {
    console.log(`  ${b.name}  HP ${fmt(b.hp, 1)}/${b.maxHp}  输出 ${fmt(b.dealt, 1)}  ` +
      `承伤 ${fmt(b.taken, 1)}  回复 ${fmt(b.healed, 1)}  出手 ${b.casts}  ` +
      `挡伤 ${b.immunityBlocks}  展延 ${b.tenkaiHits}  黑闪 ${b.blackFlashes}`);
  }
}

main();
