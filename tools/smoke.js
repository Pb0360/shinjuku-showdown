#!/usr/bin/env node
/* ==========================================================================
 * 浏览器无头冒烟测试 + 场景出图
 * --------------------------------------------------------------------------
 * 做法：把 src/index.html 原样复制成 src/_smoke.html，在 </body> 前注入测试脚本，
 *       用真实 Chrome (--headless) 打开，在真 DOM + 真 Canvas 里跑完整对局。
 *
 * 用法：
 *   node tools/smoke.js            跑对局测试并打印报告
 *   node tools/smoke.js --shots    额外生成 4 张场景截图到 tools/shots/
 *   node tools/smoke.js --keep     保留 _smoke.html
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const HTML = path.join(SRC, 'index.html');
const SMOKE_HTML = path.join(SRC, '_smoke.html');
const SHOT_DIR = path.join(__dirname, 'shots');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

/* ------------------------------------------------------------------ 客户端脚本 */
const CLIENT = `
(function () {
  var errors = [];
  window.onerror = function (msg, src, line, col) {
    errors.push('onerror: ' + msg + ' @' + (src || '?').split('/').pop() + ':' + line + ':' + col);
  };
  window.addEventListener('unhandledrejection', function (e) { errors.push('rejection: ' + (e && e.reason)); });
  var origErr = console.error;
  console.error = function () {
    errors.push('console.error: ' + Array.prototype.join.call(arguments, ' '));
    origErr.apply(console, arguments);
  };

  function report(obj) {
    var d = document.createElement('div');
    d.id = '__report';
    d.style.display = 'none';
    d.textContent = '###REPORT###' + JSON.stringify(obj) + '###END###';
    document.body.appendChild(d);
  }
  function safe(fn, tag) {
    try { return fn(); } catch (e) { errors.push(tag + ': ' + (e && e.stack ? e.stack : e)); return null; }
  }
  function pixelStats() {
    var cv = SH.Renderer.canvas, ctx = cv.getContext('2d');
    var d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var ink = 0, total = 0;
    for (var i = 0; i < d.length; i += 4 * 131) {
      total++;
      if (!(d[i] > 238 && d[i + 1] > 236 && d[i + 2] > 224)) ink++;
    }
    var fx = SH.Game.fx || {};
    return { ink: ink, total: total, cw: cv.width, ch: cv.height,
             styleW: cv.style.width, styleH: cv.style.height, dpr: window.devicePixelRatio,
             flashA: +(fx.flashA || 0).toFixed(3), zoom: +(fx.zoom || 1).toFixed(3),
             parts: (fx.particles || []).length, rings: (fx.rings || []).length,
             nums: (fx.numbers || []).length, ts: fx.timeScale ? +fx.timeScale().toFixed(2) : 1 };
  }
  function stageLayout() {
    var st = document.getElementById('stage');
    var btn = document.querySelector('.skill-btn');
    var sb = document.getElementById('skillbar');
    var top = document.querySelector('.battle-top');
    var cv = document.getElementById('arena');
    return {
      winW: innerWidth, winH: innerHeight,
      stageW: st.clientWidth, stageH: st.clientHeight,
      canvas: cv ? (cv.style.width + ' x ' + cv.style.height) : null,
      skillBarH: sb ? sb.clientHeight : 0,
      skillBtn: btn ? (Math.round(btn.getBoundingClientRect().width) + ' x ' +
                       Math.round(btn.getBoundingClientRect().height)) : null,
      topBarH: top ? top.clientHeight : 0,
      touch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight
    };
  }

  /* 把技能名大字冻结在"最好看"的那一帧（截图用） */
  function freezeCallout() {
    var n = document.getElementById('callout');
    if (!n) return;
    n.className = 'callout show' + (n.dataset.big === '1' ? ' big' : '');
    n.style.opacity = '1';
    n.style.animation = 'none';
    var inner = n.querySelector('.co-inner');
    if (inner) inner.style.transform = 'scale(1)';
  }

  function stage(scene) {
    var G = SH.Game, dt = 1 / 60;

    /* 选人界面单独截图（看角色配色 / 技能行 / 被动行） */
    if (scene === 'select') {
      G.stop();
      SH.UI.handleAction('select');
      var mSel = /sel=([a-z]+)/.exec(location.search);
      SH.UI.picks = [mSel ? mSel[1] : 'yuji', 'gojo'];
      SH.UI.renderSlot(document.querySelector('.slot[data-side="0"]'), 0);
      SH.UI.renderSlot(document.querySelector('.slot[data-side="1"]'), 1);
      return;
    }

    G.stop();
    /* 虎杖专属场景用他自己的对局（球 0 = 虎杖） */
    if (scene === 'yuji' || scene === 'punch') G.start('yuji', 'gojo');
    else if (scene === 'naruto') G.start('naruto', 'gojo');
    else if (scene === 'pain') G.start('pain', 'gojo');
    else if (scene === 'well') G.start('pain', 'gojo');
    else if (scene === 'shinra') G.start('pain', 'gojo');
    else if (scene === 'minato') G.start('minato', 'gojo');
    else if (scene === 'vampire') G.start('vampire', 'gojo');
    else if (scene === 'custom') G.start('gojo', 'sukuna');
    else G.start('gojo', 'sukuna');
    G.loop.stop();
    G.ais = [null, null];          // ★ 关掉 AI，否则它会自己放技能污染场景
    var m = G.match;
    m.countdownT = 0; m.phase = 'fight';
    G.paused = false;

    function cast(bi, si) { m.castSkill(m.balls[bi], si); m.balls[bi].skillLock = 0; }
    function free() { m.balls[0].skills.forEach(function (s) { s.resetAll(); }); m.balls[1].skills.forEach(function (s) { s.resetAll(); }); }

    if (scene === 'immune') {
      /* 无下限：环绕发光（并用一次"挡下伤害"触发强化版） */
      m.balls[0].x = 360; m.balls[0].y = 380;
      m.balls[1].x = 580; m.balls[1].y = 250;
      m.balls[0].vx = 0; m.balls[0].vy = 0;
      m.balls[1].vx = 0; m.balls[1].vy = 0;
      free();
      cast(0, 1);                       // 无下限术式
      /* 让宿傩的「解」打过来，被挡下 → 强化版光环 */
      var sspec = SH.CHARACTERS.sukuna.skills[0].slash;
      m.addProjectile(SH.makeSlash(1, 250, 380, { x: 1, y: 0 }, sspec, { charId: 'sukuna' }));
      for (var ii = 0; ii < 5; ii++) G.step(dt);
      SH.UI.callout({ title: '无下限术式', subtitle: '术式' });
    } else if (scene === 'bind') {
      /* 无量空处：24×5 直伤 + 1 秒定身 */
      m.balls[0].x = 250; m.balls[0].y = 300;
      m.balls[1].x = 470; m.balls[1].y = 380;
      m.balls[0].vx = 120; m.balls[0].vy = 60;
      m.balls[1].vx = -80; m.balls[1].vy = 140;
      free();
      cast(0, 2);                        // 无量空处
      for (var bi4 = 0; bi4 < 32; bi4++) G.step(dt);
      SH.UI.callout({ title: '领域展开·无量空处', subtitle: '领域展开', big: true });
      document.getElementById('callout').dataset.big = '1';
    } else if (scene === 'blue') {
      /* 苍：引力场（力场环 + 吸力流线 + 被拽弯的球） */
      m.balls[0].x = 330; m.balls[0].y = 620;
      m.balls[1].x = 560; m.balls[1].y = 90;
      m.balls[0].vx = 0; m.balls[0].vy = 0;
      m.balls[1].vx = -140; m.balls[1].vy = 260;
      free();
      var bg = SH.CHARACTERS.gojo.skills[0].blue;
      var b1 = SH.makeOrb('blue', 0, 300, 330, { x: 1, y: 0 }, bg, { charId: 'gojo', skillId: 'gojo1' });
      b1.vx = 0; b1.vy = 0;
      m.addProjectile(b1);
      for (var bi3 = 0; bi3 < 34; bi3++) G.step(dt);
      SH.UI.callout({ title: '术式顺转·苍', subtitle: '术式顺转·苍 / 术式反转·赫' });
    } else if (scene === 'naruto') {
      /* 鸣人：分身 + 螺旋丸 + 色诱术 */
      m.balls[0].x = 220; m.balls[0].y = 320;
      m.balls[1].x = 520; m.balls[1].y = 400;
      m.balls[0].vx = 120; m.balls[0].vy = 90;
      m.balls[1].vx = -80; m.balls[1].vy = 60;
      free();
      for (var nk = 0; nk < 3; nk++) { m.balls[0].skillLock = 0; cast(0, 0); m.step(dt); }
      m.balls[0].skillLock = 0;
      cast(0, 1);                                   // 色诱术
      for (var nk2 = 0; nk2 < 12; nk2++) { G.step(dt); }
      m.balls[0].skillLock = 0;
      cast(0, 2);                                   // 螺旋丸
      for (var nk3 = 0; nk3 < 4; nk3++) { G.step(dt); }   // 只跑 4 帧，截握着丸子冲出去的瞬间
      SH.UI.callout({ title: '螺旋丸', subtitle: 'Rasengan', big: true });
    } else if (scene === 'custom') {
      /* 自定义角色编辑器：开一个已保存的角色 + 填好表单，截图看排版 */
      SH.Custom.save({
        name: '我的主角', hp: 1500,
        skills: ['gojo2', 'pain2', 'naruto3'],
        passive: 'uzumaki_blood'
      });
      SH.Custom.save({
        name: '三无下限', hp: 1000,
        skills: ['gojo2', 'gojo2', 'gojo2'],
        passive: 'reverse_curse'
      });
      SH.CustomEditor.open();
      var all2 = SH.Custom.all();
      SH.CustomEditor.fillForm(all2[0]);
      SH.CustomEditor.renderList();
      SH.UI.callout({ title: "", subtitle: "" });
    } else if (scene === 'shinra') {
      /* 小神罗（扩到最大后的残影）+ 超·神罗天征（持续动画的淡蓝巨圈） */
      m.balls[0].x = 300; m.balls[0].y = 380;
      m.balls[1].x = 420; m.balls[1].y = 330;
      free();
      m.balls[0].skillLock = 0;
      cast(0, 1, false);                      // 小神罗
      for (var sk1 = 0; sk1 < 16; sk1++) G.step(dt);   // 0.27 秒：环扩到最大，正在残影期
      m.balls[0].skills[1].castCd = 0;
      m.balls[0].skillLock = 0;
      cast(0, 1, true);                       // 超·神罗天征
      for (var sk2 = 0; sk2 < 14; sk2++) G.step(dt);
      out.ringsDump = SH.Game.fx.rings.map(function (rg) {
        return Math.round(rg.r) + "/" + Math.round(rg.maxR) + " life=" + rg.life.toFixed(2) + " c=" + rg.color;
      }).join(" | ");
      SH.UI.callout({ title: "超·神罗天征", subtitle: "Shinra Tensei", big: true });
    } else if (scene === 'well') {
      /* 万象天引：黑白引力奇点 */
      m.balls[0].x = 250; m.balls[0].y = 380;
      m.balls[1].x = 430; m.balls[1].y = 330;
      m.balls[0].vx = 40; m.balls[0].vy = -30;
      m.balls[1].vx = -40; m.balls[1].vy = 30;
      free();
      m.balls[0].skillLock = 0;
      cast(0, 0);
      for (var wk = 0; wk < 22; wk++) G.step(dt);
      SH.UI.callout({ title: "万象天引", subtitle: "Bansho Ten'in" });
    } else if (scene === 'vampire') {
      /* 吸血球化蝠：本体应消失，只剩一圈盘旋的蝙蝠 */
      m.balls[0].x = 300; m.balls[0].y = 360;
      m.balls[1].x = 520; m.balls[1].y = 300;
      m.balls[1].hp = 900;
      free();
      m.balls[0].skills[0].resetAll();
      m.balls[0].skillLock = 0;
      cast(0, 0);
      for (var bv = 0; bv < 70; bv++) G.step(dt);
      SH.UI.callout({ title: "蝠群", subtitle: "吸血球", big: true });
    } else if (scene === 'minato') {
      /* 水门大招：丢苦无 → 等 1 秒 → 轮流瞬移留拖影斩 */
      m.balls[0].x = 200; m.balls[0].y = 380;
      m.balls[1].x = 620; m.balls[1].y = 260;
      free();
      m.balls[0].skillLock = 0;
      cast(0, 0);                                     // 先丢一枚苦无
      for (var mk1 = 0; mk1 < 40; mk1++) G.step(dt);
      m.balls[0].skills[2].resetAll(); m.balls[0].skillLock = 0;
      cast(0, 2);                                     // 大招
      for (var mk2 = 0; mk2 < 60 * 1.45; mk2++) G.step(dt);   // 跑到第 3~4 段，能看到多条拖影
      SH.UI.callout({ title: "螺旋闪光超轮舞吼叁式", subtitle: "Hiraishin", big: true });
    } else if (scene === 'pain') {
      /* 佩恩：万象天引 + 超·神罗天征 + 地爆天星 */
      m.balls[0].x = 250; m.balls[0].y = 380;
      m.balls[1].x = 520; m.balls[1].y = 300;
      m.balls[0].vx = 60; m.balls[0].vy = -40;
      m.balls[1].vx = -60; m.balls[1].vy = 40;
      free();
      m.balls[0].skillLock = 0;
      cast(0, 0);                                     // 万象天引
      for (var pk1 = 0; pk1 < 24; pk1++) G.step(dt);
      m.balls[0].skillLock = 0;
      cast(0, 1, true);                               // 超·神罗天征（长按版）
      for (var pk2 = 0; pk2 < 10; pk2++) G.step(dt);
      m.balls[0].skillLock = 0;
      cast(0, 2);                                     // 地爆天星
      for (var pk3 = 0; pk3 < 235; pk3++) G.step(dt);   // 跑久一点，让岩石裹成壳、并把对手封住
      SH.UI.callout({ title: '地爆天星', subtitle: 'Chibaku Tensei', big: true });
    } else if (scene === 'punch') {
      /* 只放迳庭拳（不放大招，免得黑闪闪屏挡住拳） */
      m.balls[0].x = 250; m.balls[0].y = 330;
      m.balls[1].x = 400; m.balls[1].y = 360;
      m.balls[0].vx = 0; m.balls[0].vy = 0;
      m.balls[1].vx = 0; m.balls[1].vy = 0;
      free();
      m.balls[0].skillLock = 0;
      cast(0, 0);
      for (var q0 = 0; q0 < 4; q0++) { G.step(dt); }
      SH.UI.callout({ title: '迳庭拳', subtitle: 'Divergent Fist' });
    } else if (scene === 'yuji') {
      /* 虎杖：迳庭拳 + 黑闪状态光晕（球 0 是虎杖） */
      m.balls[0].x = 250; m.balls[0].y = 330;
      m.balls[1].x = 420; m.balls[1].y = 360;
      m.balls[0].vx = 150; m.balls[0].vy = 80;
      m.balls[1].vx = -90; m.balls[1].vy = 120;
      free();
      cast(0, 1);                       // 黑闪（挂必定黑闪状态）
      for (var y0 = 0; y0 < 10; y0++) { G.step(dt); }
      cast(0, 0);                       // 迳庭拳兑现黑闪
      for (var y1 = 0; y1 < 8; y1++) { G.step(dt); }
      SH.UI.callout({ title: '黑闪', subtitle: 'Black Flash · 2.5 次方', big: true });
    } else if (scene === 'gojo') {
      /* 苍 + 赫 + 茈 + 无量空处 */
      m.balls[0].x = 200; m.balls[0].y = 360;
      m.balls[1].x = 540; m.balls[1].y = 330;
      m.balls[0].vx = 180; m.balls[0].vy = 90;
      m.balls[1].vx = -120; m.balls[1].vy = 150;
      free();
      cast(0, 0);                       // 苍 或 赫
      m.balls[0].skills[0].charges = 2; cast(0, 0);
      m.balls[0].skills[0].charges = 2;
      /* 手工造一个茈 */
      var ch = SH.CHARACTERS.gojo;
      var spec = ch.skills[0].purple;
      var dir = { x: 0.9, y: 0.1 };
      m.addProjectile(SH.makeOrb('purple', 0, 330, 300, dir, spec, { charId: 'gojo', skillId: 'gojo1' }));
      m.projectiles[m.projectiles.length - 1].r = spec.growTo;
      cast(0, 2);                       // 无量空处
      for (var i = 0; i < 40; i++) { G.step(dt); }
      SH.UI.callout({ title: '虚式·茈', subtitle: '术式顺转·苍 + 术式反转·赫', big: true });
    } else if (scene === 'sukuna') {
      m.balls[0].x = 230; m.balls[0].y = 250;
      m.balls[1].x = 470; m.balls[1].y = 420;
      m.balls[0].vx = 200; m.balls[0].vy = 120;
      m.balls[1].vx = -140; m.balls[1].vy = -110;
      free();
      cast(1, 2);                       // 伏魔御厨子
      for (var j = 0; j < 30; j++) { G.step(dt); }
      m.balls[1].skills[0].cd = 0; cast(1, 0);   // 解 / 捌
      m.balls[1].skills[1].cd = 0; cast(1, 1);   // 灶·开
      for (var k = 0; k < 26; k++) { G.step(dt); }
      SH.UI.callout({ title: '伏魔御厨子', subtitle: '领域展开', big: true });
    } else if (scene === 'blackflash') {
      m.balls[0].x = 330; m.balls[0].y = 380;
      m.balls[1].x = 400; m.balls[1].y = 380;
      m.balls[0].vx = 160; m.balls[0].vy = 40;
      m.balls[1].vx = -160; m.balls[1].vy = -40;
      cast(0, 0);
      for (var q = 0; q < 20; q++) { G.step(dt); }
      var mx = (m.balls[0].x + m.balls[1].x) / 2, my = (m.balls[0].y + m.balls[1].y) / 2;
      m.triggerBlackFlash(m.balls[0], mx, my);
      var ev = m.drainEvents();
      for (var e = 0; e < ev.length; e++) G.fx.onEvent(ev[e], m);
      G.fx.onEvent({ type: 'blackflash', ball: m.balls[0], x: mx, y: my, idx: 0 }, m);
      SH.UI.callout({ title: '黑闪', subtitle: 'Black Flash · 2.5 次方', big: true, blackflash: true });
      document.getElementById('callout').dataset.big = '1';
      for (var q2 = 0; q2 < 6; q2++) { G.step(dt); }
    } else if (scene === 'grid') {
      /* 捌：3×3 网格斩击（近距离触发） */
      m.balls[0].x = 400; m.balls[0].y = 330;
      m.balls[1].x = 330; m.balls[1].y = 400;
      m.balls[0].vx = 240; m.balls[0].vy = 120;
      m.balls[1].vx = -80; m.balls[1].vy = 160;
      free();
      cast(1, 0);                        // 距离 < 160 → 捌
      for (var gi = 0; gi < 7; gi++) G.step(dt);
      SH.UI.callout({ title: '捌', subtitle: '解 / 捌' });
      document.getElementById('callout').dataset.big = '';
    } else if (scene === 'arrow') {
      /* 灶·开：火焰弓 + 火焰箭 */
      m.balls[0].x = 220; m.balls[0].y = 300;
      m.balls[1].x = 480; m.balls[1].y = 420;
      m.balls[0].vx = 160; m.balls[0].vy = 80;
      m.balls[1].vx = -120; m.balls[1].vy = -60;
      free();
      cast(1, 1);                        // 灶·开
      for (var ai2 = 0; ai2 < 8; ai2++) G.step(dt);
      SH.UI.callout({ title: '灶·开', subtitle: '术式' });
    } else if (scene === 'purple') {
      /* 茈：原地膨胀（走真实合成路径：赫 撞上苍） */
      m.balls[0].x = 300; m.balls[0].y = 610;
      m.balls[1].x = 545; m.balls[1].y = 620;
      m.balls[0].vx = 180; m.balls[0].vy = 0;
      m.balls[1].vx = -80; m.balls[1].vy = 40;
      free();
      var chg = SH.CHARACTERS.gojo;
      var bs = chg.skills[0].blue, rs = chg.skills[0].red;
      /* 苍 静止在中间偏上，赫 从右边水平飞过去撞它 —— 避开两个球与技能名大字 */
      var blue = SH.makeOrb('blue', 0, 240, 330, { x: 1, y: 0 }, bs, { charId: 'gojo', skillId: 'gojo1' });
      blue.vx = 0; blue.vy = 0;
      m.addProjectile(blue);
      m.addProjectile(SH.makeOrb('red', 0, 520, 330, { x: -1, y: 0 }, rs, { charId: 'gojo', skillId: 'gojo1' }));
      for (var pi = 0; pi < 54; pi++) G.step(dt);   // 等合成并膨胀到最大
      SH.UI.callout({ title: '虚式·茈', subtitle: '术式顺转·苍 + 术式反转·赫', big: true });
      document.getElementById('callout').dataset.big = '1';
    } else if (scene === 'purpleGrow') {
      /* 茈：刚合成、正在膨胀的那一瞬间 */
      m.balls[0].x = 300; m.balls[0].y = 610;
      m.balls[1].x = 545; m.balls[1].y = 620;
      free();
      var chg2 = SH.CHARACTERS.gojo;
      var blue2 = SH.makeOrb('blue', 0, 240, 330, { x: 1, y: 0 }, chg2.skills[0].blue, { charId: 'gojo', skillId: 'gojo1' });
      blue2.vx = 0; blue2.vy = 0;
      m.addProjectile(blue2);
      m.addProjectile(SH.makeOrb('red', 0, 400, 330, { x: -1, y: 0 }, chg2.skills[0].red, { charId: 'gojo', skillId: 'gojo1' }));
      for (var pg = 0; pg < 27; pg++) G.step(dt);   // 合成后刚刚开始膨胀
      SH.UI.callout({ title: '虚式·茈', subtitle: '术式顺转·苍 + 术式反转·赫', big: true });
      document.getElementById('callout').dataset.big = '1';
    } else if (scene === 'slash') {
      /* 解：一字型斩击的月牙刀刃 */
      m.balls[0].x = 330; m.balls[0].y = 300;
      m.balls[1].x = 620; m.balls[1].y = 300;
      m.balls[0].vx = 120; m.balls[0].vy = 60;
      m.balls[1].vx = -60; m.balls[1].vy = 100;
      free();
      cast(1, 0);                        // 远距离 → 解
      for (var si2 = 0; si2 < 4; si2++) G.step(dt);
      SH.UI.callout({ title: '解', subtitle: '解 / 捌' });
    } else { /* burst：混战全景 */
      m.balls[0].x = 250; m.balls[0].y = 300;
      m.balls[1].x = 480; m.balls[1].y = 400;
      free();
      cast(0, 0); m.balls[0].skills[0].charges = 2; cast(0, 0);
      cast(0, 2);
      cast(1, 2);
      m.balls[1].skills[0].cd = 0; cast(1, 0);
      m.balls[1].skills[1].cd = 0; cast(1, 1);
      for (var z = 0; z < 34; z++) { G.step(dt); }
      SH.UI.callout({ title: '解', subtitle: '解 / 捌', big: false });
    }

    /* 冻结画面：禁掉 resize（否则 canvas 尺寸变化会清空画布），再画一帧 */
    SH.Renderer.resize = function () {};
    if (scene !== 'gojo' && scene !== 'sukuna' && scene !== 'blackflash' && scene !== 'burst') { /* noop */ }
    SH.UI.callout = (function (orig) {
      return function (p) { orig.call(SH.UI, p); freezeCallout(); };
    })(SH.UI.callout);
    freezeCallout();
    G.render(1 / 60);
    return {
      scene: scene, t: +m.t.toFixed(2), phase: m.phase,
      proj: m.projectiles.length, fields: m.fields.length,
      kinds: m.projectiles.map(function (p) { return p.kind; }).join(','),
      pixels: pixelStats(), layout: stageLayout()
    };
  }

  window.addEventListener('load', function () {
    /* 只测自备 BGM 的模式：不在同一页里跑对局，避免主线程长时间阻塞影响媒体加载事件 */
    if (/probe=bgm/.test(location.search)) {
      var o = { ok: true, errors: errors };
      SH.Audio.userBgmUrl(function (url) {
        o.resolved = url || null;
        o.configured = (SH.CONFIG.audio && SH.CONFIG.audio.userBgm) || null;
        if (!url) { report(o); return; }
        var a = new Audio();
        a.preload = 'metadata';
        a.src = url;
        setTimeout(function () {
          o.duration = (isFinite(a.duration) && a.duration > 0) ? +a.duration.toFixed(1) : null;
          o.readyState = a.readyState;
          o.videoWidth = a.videoWidth || 0;
          report(o);
        }, 900);
      });
      return;
    }

    setTimeout(function () {
      var SH = window.SH;
      var out = { ok: true, errors: errors, matches: [], screens: {}, combat: {}, shots: [], pixels: null, layout: null };

      var shotOnly = /shot=/.test(location.search);
      var scene = (location.search.match(/shot=([A-Za-z]+)/) || [])[1] || 'burst';

      if (shotOnly) {
        var info = safe(function () { return stage(scene); }, 'stage');
        out.shots.push(info);
        out.pixels = info ? info.pixels : null;
        out.layout = info ? info.layout : null;
        if (errors.length) out.ok = false;
        report(out);
        return;
      }

      safe(function () {
        var G = SH.Game;
        if (!G) throw new Error('SH.Game 未初始化');
        var combos = [['gojo', 'sukuna'], ['sukuna', 'gojo'], ['gojo', 'gojo'], ['sukuna', 'sukuna']];
        var dt = 1 / 60;

        for (var ci = 0; ci < combos.length; ci++) {
          var c = combos[ci];
          G.stop();
          G.start(c[0], c[1]);
          G.loop.stop();
          var m = G.match;
          m.countdownT = 0; m.phase = 'fight';

          for (var bi = 0; bi < 2; bi++) for (var si = 0; si < 3; si++) {
            m.castSkill(m.balls[bi], si); m.balls[bi].skillLock = 0;
          }
          m.balls[0].skills.forEach(function (s) { s.resetAll(); });
          m.balls[1].skills.forEach(function (s) { s.resetAll(); });

          var guard = 0, overAt = -1;
          while (guard < 60 * 200) {
            if (guard % 90 === 0) {
              for (var b2 = 0; b2 < 2; b2++) for (var s2 = 0; s2 < 3; s2++) {
                if (m.castSkill(m.balls[b2], s2)) m.balls[b2].skillLock = 0;
              }
            }
            if (guard % 30 === 0) safe(function () { SH.UI.updateBattle(m); }, 'updateBattle');
            safe(function () { G.step(dt); }, 'step');
            safe(function () { G.render(dt); }, 'render');
            guard++;
            if (m.phase === 'over') {
              if (overAt < 0) overAt = guard;
              if (guard > overAt + 130) break;
            }
          }

          var s = m.summary();
          out.matches.push({
            p1: c[0], p2: c[1], phase: m.phase, winner: s.winner,
            dur: +s.duration.toFixed(1), steps: guard,
            dealt: s.balls.map(function (b) { return Math.round(b.dealt); }),
            taken: s.balls.map(function (b) { return Math.round(b.taken); }),
            healed: s.balls.map(function (b) { return Math.round(b.healed); }),
            casts: s.balls.map(function (b) { return b.casts; }),
            collisions: s.collisions, blackFlashes: s.blackFlashes,
            projLeft: m.projectiles.length, fieldsLeft: m.fields.length
          });
          var seen = {};
          s.balls.forEach(function (b) { for (var k in b.bySkill) seen[k] = 1; });
          out.combat['seen_' + c[0] + '_' + c[1]] = Object.keys(seen).sort().join(',');
          out.combat['blocks_' + c[0] + '_' + c[1]] = s.balls.map(function (b) { return b.immunityBlocks; });
          out.combat['tenkai_' + c[0] + '_' + c[1]] = s.balls.map(function (b) { return b.tenkaiHits; });
        }

        out.screens.resultHtml = (document.getElementById('result-inner').innerHTML || '').length;
        out.screens.resultActive = document.getElementById('screen-result').classList.contains('active');
        out.screens.battleActive = document.getElementById('screen-battle').classList.contains('active');

        safe(function () { SH.UI.show('screen-menu'); SH.UI.handleAction('select'); }, 'nav-select');
        out.screens.selectActive = document.getElementById('screen-select').classList.contains('active');
        out.screens.selectSkillRows = document.querySelectorAll('#sel-body .skill-row').length;
        safe(function () { SH.UI.openSkillDetail('gojo', 0); }, 'detail-gojo1');
        safe(function () { SH.UI.openSkillDetail('gojo', -1); }, 'detail-passive');
        safe(function () { SH.UI.openSkillDetail('sukuna', 2); }, 'detail-sukuna3');
        out.screens.skillDetailLen = (document.getElementById('skill-modal-body').innerHTML || '').length;
        safe(function () { SH.UI.closeAllModals(); }, 'close-modals');
        safe(function () { SH.UI.openModal('modal-settings'); SH.UI.closeModal('modal-settings'); }, 'settings-modal');
        safe(function () { SH.UI.setPick(0, 'sukuna'); SH.UI.setPick(1, 'gojo'); }, 'set-pick');
        out.screens.picks = SH.UI.picks.join(',');
        safe(function () { SH.Audio.voice('gojo', '苍'); SH.Audio.play('black_flash'); }, 'audio-missing');

        /* --- 弹窗互斥与暂停流程（用户实测反馈的问题） --- */
        safe(function () {
          var U = SH.UI;
          U.closeAllModals();
          U.openModal('modal-pause');
          var s1 = { pause: U.isModalOpen('modal-pause'), visible: document.querySelectorAll('.modal.show').length };
          U.openModal('modal-settings');
          var s2 = { pause: U.isModalOpen('modal-pause'), settings: U.isModalOpen('modal-settings'), visible: document.querySelectorAll('.modal.show').length };
          U.closeModal('modal-settings');
          var s3 = { pause: U.isModalOpen('modal-pause'), settings: U.isModalOpen('modal-settings'), visible: document.querySelectorAll('.modal.show').length };
          U.handleAction('resume');
          var s4 = { pause: U.isModalOpen('modal-pause'), visible: document.querySelectorAll('.modal.show').length };
          out.modals = { opened: s1, afterSettings: s2, afterCloseSettings: s3, afterResume: s4 };
        }, 'modal-stack');


        /* --- 自定义角色：三个无下限 + 反转术式，能真的打起来 --- */
        safe(function () {
          var res = {};
          var def = SH.Custom.save({
            name: '测试机', hp: 1234,
            skills: ['gojo2', 'gojo2', 'gojo2'],     // 故意重复选同一个技能
            passive: 'reverse_curse'
          });
          res.saved = !!def;
          var ch = def ? SH.CHARACTERS[def.id] : null;
          res.hp = ch ? ch.hp : 0;
          res.skillCount = ch ? ch.skills.length : 0;
          res.allSame = ch ? (ch.skills[0].id === 'gojo2' && ch.skills[1].id === 'gojo2' && ch.skills[2].id === 'gojo2') : false;
          res.slots = ch ? ch.skills.map(function (k) { return k.slot; }).join(',') : '';
          res.passive = ch ? ch.passive.name : '';
          res.series = ch ? ch.series : '';
          res.inRoster = Object.keys(SH.CHARACTERS).indexOf(def.id) >= 0;

          /* 真打一局：能放技能、能正常推进 */
          if (ch) {
            var m2 = new SH.Match({ p1: def.id, p2: 'gojo', seed: 3 });
            m2.countdownT = 0; m2.phase = 'fight';
            var ok1 = m2.castSkill(m2.balls[0], 0);
            m2.balls[0].skillLock = 0;                 // 连续放要先把技能锁清掉
            var ok2 = m2.castSkill(m2.balls[0], 1);
            res.canCast = !!ok1 && !!ok2;
            for (var i2 = 0; i2 < 240; i2++) { m2.step(1 / 60); m2.drainEvents(); }
            res.fighting = m2.phase === 'fight';
          }
          SH.Custom.remove(def.id);
          res.removed = !SH.CHARACTERS[def.id];
          out.customChars = res;
        }, 'custom-chars');

        /* --- 长按技能：0.2 秒内松手放普通版，按住到 0.2 秒立刻放强化版 --- */
        safe(function () {
          var G4 = SH.Game;
          G4.stop();
          G4.start('gojo', 'sukuna');
          G4.loop.stop();
          G4.ais = [null, null];
          var m4 = G4.match;
          m4.countdownT = 0; m4.phase = 'fight';
          /* 给二技能临时挂上长按配置（佩恩的神罗天征以后就是这么配的） */
          m4.balls[0].skills[1].data.hold = { threshold: 0.2 };

          var seen = [];
          var orig = SH.SkillImpl.gojo2.cast;
          SH.SkillImpl.gojo2.cast = function (mm, ball, target, st, opts) {
            seen.push(opts && opts.charged ? 'charged' : 'normal');
            return orig.apply(this, arguments);
          };

          var res = {};
          /* 短按：按下 0.05 秒就松手 */
          m4.balls[0].skills[1].resetAll(); m4.balls[0].skillLock = 0;
          G4.holdStart(2);
          G4.updateHold(0.05);
          res.stillHolding = G4.holdSlot;          // 应为 2（还在按）
          G4.holdRelease(2);
          res.shortFired = seen.slice();           // 应为 ['normal']

          /* 长按：推到 0.19 秒还没放，越过 0.2 立刻放强化版 */
          m4.balls[0].skills[1].resetAll(); m4.balls[0].skillLock = 0;
          G4.holdStart(2);
          G4.updateHold(0.19);
          res.beforeThreshold = G4.holdSlot;       // 应为 2（还没放）
          G4.updateHold(0.02);                     // 累计 0.21 > 0.2
          res.afterThreshold = G4.holdSlot;        // 应为 -1（已经放掉）
          res.longFired = seen.slice();            // 应为 ['normal','charged']
          res.releaseAfterFire = (function () { G4.holdRelease(2); return seen.slice(); })();  // 松手不该再放一次

          /* 普通技能（没配 hold）按下即发，手感不变 */
          m4.balls[0].skills[0].resetAll(); m4.balls[0].skillLock = 0;
          var c0 = m4.balls[0].stats.casts;
          G4.holdStart(1);
          res.normalInstant = (m4.balls[0].stats.casts === c0 + 1) && G4.holdSlot === -1;

          SH.SkillImpl.gojo2.cast = orig;
          delete m4.balls[0].skills[1].data.hold;
          out.hold = res;
        }, 'long-press');

        /* --- 时间暂缓：只有大招（和黑闪）才允许，普通技能必须保持在 1 --- */
        safe(function () {
          var G3 = SH.Game;
          var res = {};
          G3.stop();
          G3.start('gojo', 'sukuna');
          G3.loop.stop();
          G3.ais = [null, null];
          var m = G3.match;
          m.countdownT = 0; m.phase = 'fight';
          G3.fx.reset();
          var probe = function (label, fn) {
            G3.fx.reset();
            fn();
            G3.fx.onEvent({ type: 'cast', ball: m.balls[0], skillId: 'x', title: 'x', vfx: { zoom: 1.02, timeScale: 1, slow: 0 } }, m);
            res[label] = +G3.fx.timeScale().toFixed(2);
          };
          /* 普通技能：直接看数据里配的 timeScale */
          res.gojo1_cfg = SH.CHARACTERS.gojo.skills[0].vfx.timeScale;
          res.gojo2_cfg = SH.CHARACTERS.gojo.skills[1].vfx.timeScale;
          res.sukuna1_cfg = SH.CHARACTERS.sukuna.skills[0].vfx.timeScale;
          res.sukuna2_cfg = SH.CHARACTERS.sukuna.skills[1].vfx.timeScale;
          res.purple_cfg = SH.CHARACTERS.gojo.skills[0].purple.vfx.timeScale;
          res.gojo3_cfg = SH.CHARACTERS.gojo.skills[2].vfx.timeScale;
          res.sukuna3_cfg = SH.CHARACTERS.sukuna.skills[2].vfx.timeScale;
          /* 实际效果：普通技能放完 timeScale 必须是 1 */
          G3.fx.reset();
          m.balls[0].skillLock = 0;
          m.balls[0].skills.forEach(function (s) { s.resetAll(); });
          res.normalCastOk = m.castSkill(m.balls[0], 0);
          G3.handleEvents(m.drainEvents());
          res.afterNormalCast = +G3.fx.timeScale().toFixed(2);
          G3.fx.reset();
          m.balls[0].skillLock = 0;                 // 清掉出手硬直，否则这一发放不出去
          m.balls[0].skills.forEach(function (s) { s.resetAll(); });
          res.ultimateCastOk = m.castSkill(m.balls[0], 2);
          G3.handleEvents(m.drainEvents());
          res.afterUltimate = +G3.fx.timeScale().toFixed(2);
          G3.fx.reset();
          G3.fx.onEvent({ type: 'blackflash', ball: m.balls[0], x: 300, y: 300 }, m);
          res.afterBlackFlash = +G3.fx.timeScale().toFixed(2);
          out.timeScale = res;
        }, 'timescale');

        /* --- 背景音乐时机：倒计时不放、开打才放、暂停停住、结束停掉 --- */
        safe(function () {
          var G2 = SH.Game;
          G2.stop();
          var st = { beforeMatch: SH.Audio._bgmName };
          G2.start('gojo', 'sukuna');
          G2.loop.stop();
          st.atCountdown = SH.Audio._bgmName;
          for (var i = 0; i < 60 * 4; i++) { G2.step(1 / 60); }
          st.atFight = SH.Audio._bgmName;
          G2.pauseGame();
          st.pausedFlag = SH.Audio._bgmPaused;
          G2.resumeGame();
          st.resumedFlag = SH.Audio._bgmPaused;
          G2.stop();
          st.afterStop = SH.Audio._bgmName;
          out.bgmState = st;
        }, 'bgm-state');

        G.stop();
        G.start('gojo', 'sukuna');
        G.loop.stop();
        var mm = G.match;
        for (var g2 = 0; g2 < 60 * 9; g2++) {
          if (g2 % 40 === 0) for (var b3 = 0; b3 < 2; b3++) for (var s3 = 0; s3 < 3; s3++) {
            if (mm.castSkill(mm.balls[b3], s3)) mm.balls[b3].skillLock = 0;
          }
          G.step(dt); G.render(dt);
        }
        out.afterShot = { t: +mm.t.toFixed(1), proj: mm.projectiles.length, fields: mm.fields.length, phase: mm.phase };
        out.pixels = pixelStats();
        out.layout = stageLayout();
        return true;
      }, 'main');

      if (errors.length) out.ok = false;

      /* 自备 BGM 探测（异步，等结果再出报告） */
      var finished = false;
      function finish(bgm) {
        if (finished) return;
        finished = true;
        out.bgm = bgm;
        report(out);
      }
      safe(function () {
        SH.Audio.userBgmUrl(function (url) {
          var info = {
            configured: (SH.CONFIG.audio && SH.CONFIG.audio.userBgm) || null,
            resolved: url || null
          };
          if (!url) return finish(info);
          var a = new Audio();
          a.preload = 'metadata';
          a.src = url;
          setTimeout(function () {
            info.duration = (isFinite(a.duration) && a.duration > 0) ? +a.duration.toFixed(1) : null;
            info.readyState = a.readyState;
            info.videoWidth = a.videoWidth || 0;
            finish(info);
          }, 800);
        });
      }, 'bgm-probe');
      setTimeout(function () { finish({ resolved: null, timeout: true }); }, 12000);
    }, 120);
  });
})();
`;

/* ------------------------------------------------------------------ 工具 */
function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}
function fileUrl(p, query) {
  let u = 'file:///' + p.replace(/\\/g, '/');
  u = u.split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
  return u + (query || '');
}
function runChrome(chrome, args) {
  return execFileSync(chrome, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function chromeBase(profile, extra) {
  return ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--allow-file-access-from-files', '--user-data-dir=' + profile,
    '--window-size=1360,900', '--hide-scrollbars'].concat(extra || []);
}

/* ------------------------------------------------------------------ 主流程 */
function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const wantShots = args.includes('--shots');
  const chrome = findChrome();
  if (!chrome) { console.error('没有找到 Chrome / Edge'); process.exit(1); }

  const html = fs.readFileSync(HTML, 'utf8');
  if (!html.includes('</body>')) throw new Error('index.html 里没有 </body>');
  fs.writeFileSync(SMOKE_HTML, html.replace('</body>', '<script>' + CLIENT + '</scr' + 'ipt>\n</body>'), 'utf8');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shinjuku-chrome-'));
  let fail = 0;

  console.log('=== 新宿对决 · 浏览器冒烟测试 ===');

  /* 先单独验一次自备 BGM：独立页面，不受对局测试的主线程阻塞影响 */
  try {
    const domBgm = runChrome(chrome, chromeBase(profile, ['--virtual-time-budget=20000', '--dump-dom', fileUrl(SMOKE_HTML, '?probe=bgm')]));
    const mb = domBgm.match(/<div id="__report"[^>]*>([\s\S]*?)<\/div>/);
    if (mb) {
      const rawB = mb[1].replace(/^###REPORT###/, '').replace(/###END###$/, '')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      console.log('自备 BGM: ' + rawB);
    } else {
      console.log('自备 BGM: 没抓到报告');
    }
  } catch (e) { console.error('BGM 检查失败：' + e.message); }

  let dom = '';
  try {
    dom = runChrome(chrome, chromeBase(profile, ['--virtual-time-budget=30000', '--dump-dom', fileUrl(SMOKE_HTML)]));
  } catch (e) { console.error('Chrome 运行失败：' + e.message); fail = 1; }

  const m = dom.match(/<div id="__report"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) {
    console.error('没有抓到测试报告。DOM 头部：');
    console.error(dom.slice(0, 900));
    fail = 1;
  } else {
    const raw = m[1].replace(/^###REPORT###/, '').replace(/###END###$/, '')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const rep = JSON.parse(raw);
    console.log('对局：');
    for (const x of rep.matches) {
      console.log(`  ${x.p1} vs ${x.p2}  phase=${x.phase}  winner=${x.winner}  ${x.dur}s  ` +
        `输出[${x.dealt}] 承伤[${x.taken}] 回复[${x.healed}] 出手[${x.casts}]  ` +
        `碰撞${x.collisions} 黑闪${x.blackFlashes}  残留飞行物${x.projLeft} 领域${x.fieldsLeft}`);
    }
    console.log('技能覆盖（bySkill 里出现过的技能）：');
    for (const k in rep.combat) if (k.startsWith('seen_')) console.log(`  ${k}: ${rep.combat[k]}`);
    for (const k in rep.combat) if (k.startsWith('blocks_')) console.log(`  ${k}: ${rep.combat[k]}`);
    console.log('界面：' + JSON.stringify(rep.screens));
    console.log('截图前状态: ' + JSON.stringify(rep.afterShot));
    console.log('画布: ' + JSON.stringify(rep.pixels));
    console.log('布局: ' + JSON.stringify(rep.layout));
    console.log('背景音乐: ' + JSON.stringify(rep.bgm));
    console.log('音乐时机: ' + JSON.stringify(rep.bgmState));
    console.log('时间暂缓: ' + JSON.stringify(rep.timeScale));
    if (rep.ringsDump) console.log('环状态: ' + rep.ringsDump);
    console.log('长按机制: ' + JSON.stringify(rep.hold));
    console.log('自定义角色: ' + JSON.stringify(rep.customChars));
    console.log('弹窗流程: ' + JSON.stringify(rep.modals));
    if (rep.errors && rep.errors.length) {
      console.log('!! 错误 ' + rep.errors.length + ' 条：');
      rep.errors.slice(0, 20).forEach((e) => console.log('   - ' + e));
      fail = 1;
    } else console.log('错误：0 条');
  }

  if (wantShots) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const onlyIdx = args.indexOf('--only');
    const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
    const scenes = only ? [only]
      : ['select', 'custom', 'naruto', 'vampire', 'minato', 'pain', 'well', 'shinra', 'punch', 'blue', 'immune', 'gojo', 'sukuna', 'yuji', 'purple', 'purpleGrow', 'slash', 'grid', 'arrow', 'blackflash', 'bind', 'burst'];
    for (const scene of scenes) {      const outPng = path.join(SHOT_DIR, 'scene-' + scene + '.png');
      try {
        const domShot = runChrome(chrome, chromeBase(profile, ['--virtual-time-budget=4000',
          '--screenshot=' + outPng, '--dump-dom', fileUrl(SMOKE_HTML, '?shot=' + scene)]));
        const sz = fs.existsSync(outPng) ? fs.statSync(outPng).size : 0;
        const mm = domShot.match(/<div id="__report"[^>]*>([\s\S]*?)<\/div>/);
        let extra = '';
        if (mm) {
          const raw = mm[1].replace(/^###REPORT###/, '').replace(/###END###$/, '')
            .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          try {
            const r2 = JSON.parse(raw);
            extra = ' | ' + JSON.stringify(r2.shots && r2.shots[0]) + ' | err=' + (r2.errors || []).length;
          } catch (e) { extra = ' | (报告解析失败)'; }
        }
        console.log(`场景图 ${scene}: ${sz} bytes${extra}`);
      } catch (e) { console.error('场景 ' + scene + ' 截图失败：' + e.message); }
    }
  }

  /* 3. iPad 尺寸实测（横屏 / 竖屏） */
  if (args.includes('--ipad')) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const sizes = [
      ['ipad-land', 1180, 820],
      ['ipad-port', 820, 1180],
      ['ipad-12.9-land', 1366, 1024]
    ];
    for (const [name, w, h] of sizes) {
      const png = path.join(SHOT_DIR, name + '.png');
      try {
        const domI = runChrome(chrome, chromeBase(profile, [
          '--window-size=' + w + ',' + h, '--virtual-time-budget=6000',
          '--screenshot=' + png, '--dump-dom', fileUrl(SMOKE_HTML, '?shot=burst&touch=1')
        ]));
        const mi = domI.match(/<div id="__report"[^>]*>([\s\S]*?)<\/div>/);
        let info = '(没抓到布局)';
        if (mi) {
          const rawI = mi[1].replace(/^###REPORT###/, '').replace(/###END###$/, '')
            .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          try { info = JSON.stringify(JSON.parse(rawI).layout); } catch (e) { info = '(解析失败)'; }
        }
        console.log(`iPad ${name} (${w}x${h}): ` + info);
      } catch (e) { console.error('iPad ' + name + ' 失败：' + e.message); }
    }
  }

  if (!keep) { try { fs.unlinkSync(SMOKE_HTML); } catch (e) {} }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail);
}

main();
