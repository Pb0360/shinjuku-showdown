/* ==========================================================================
 * 渲染层 —— 米白简约几何风
 * 只读状态、只画东西，不修改任何战斗数据
 * （唯一例外：飞行物的 p.trail 是纯表现字段，用来画火焰拖尾）
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});
  var M = SH.M;

  var INK = '43,43,43';
  var PAPER = '#FFFDF8';
  var PAPER_DARK = '#F3EEE2';

  var Renderer = {
    canvas: null,
    ctx: null,
    dpr: 1,
    sizeCss: 0,
    arenaSize: 720,

    attach: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();
    },

    resize: function () {
      if (!this.canvas) return;
      var host = this.canvas.parentElement;
      var w = host.clientWidth || 0;
      var h = host.clientHeight || 0;
      var side = Math.max(180, Math.min(w, h));
      this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.sizeCss = side;
      this.canvas.style.width = side + 'px';
      this.canvas.style.height = side + 'px';
      this.canvas.width = Math.round(side * this.dpr);
      this.canvas.height = Math.round(side * this.dpr);
      this.arenaSize = SH.CONFIG.arena.size;
    },

    draw: function (match, fx) {
      var ctx = this.ctx;
      if (!ctx) return;
      var D = this.canvas.width;
      var A = this.arenaSize;
      var s = D / A;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, D, D);

      /* 逻辑坐标：1 单位 = 1 逻辑长度 */
      ctx.setTransform(s, 0, 0, s, 0, 0);

      /* 镜头（缩放 + 震动），fx 在逻辑坐标系里工作 */
      fx.applyTransform(ctx, A, A);

      this.drawArena(ctx, A, match);

      /* 黑棒（佩恩天赋）：碰撞点留下的短黑线，不是障碍物也不是飞行物 */
      for (var bi = 0; bi < match.balls.length; bi++) {
        var bb = match.balls[bi];
        if (!bb.alive || !bb.rods || !bb.rods.length) continue;
        for (var ri = 0; ri < bb.rods.length; ri++) {
          var rod = bb.rods[ri];
          var half = 17;
          ctx.save();
          ctx.translate(rod.x, rod.y);
          ctx.rotate(rod.ang);
          ctx.strokeStyle = 'rgba(0,0,0,0.95)';     // 纯黑：之前是黑边 + 橙色芯，看着像"橙底黑边"
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-half, 0);
          ctx.lineTo(half, 0);
          ctx.stroke();
          /* 两端稍微收一点，看起来像一根细长的棒 */
          ctx.strokeStyle = 'rgba(0,0,0,1)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-half * 0.72, 0);
          ctx.lineTo(half * 0.72, 0);
          ctx.stroke();
          ctx.restore();
        }
      }
      var _kList = (match.kunai || []);
      var _kNewest = -1;
      for (var _kn = 0; _kn < _kList.length; _kn++) {
        if (_kNewest < 0 || _kList[_kn].t > _kList[_kNewest].t) _kNewest = _kn;
      }
      for (var ki = 0; ki < _kList.length; ki++) {
        try { this.drawPlacedKunai(ctx, _kList[ki], match, ki === _kNewest); } catch (e) { ctx.restore(); }
      }
      for (var i = 0; i < match.fields.length; i++) this.drawField(ctx, match.fields[i], match);
      for (var j = 0; j < match.projectiles.length; j++) this.drawProjectile(ctx, match.projectiles[j], match);
      /* 只画活着的球：死掉的分身以前会被一直画出来，看起来就是"残影" */
      for (var k = 0; k < match.balls.length; k++) {
        if (match.balls[k].alive) {
          var _bk = match.balls[k];
          if (_bk.status.batUntil > match.t) this.drawBats(ctx, _bk, match);   // 化蝠：本体消失，只剩蝠群
          else this.drawBall(ctx, _bk, match);
        }
      }

      fx.drawWorld(ctx);

      /* 闪屏用设备坐标 */
      fx.drawOverlay(ctx, D, D);
    },

    /* ------------------------------------------------------------------ */
    drawArena: function (ctx, A, match) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, A, A);

      /* 极淡的方格纸 */
      ctx.strokeStyle = 'rgba(' + INK + ',0.045)';
      ctx.lineWidth = 1;
      var step = A / 8;
      ctx.beginPath();
      for (var i = 1; i < 8; i++) {
        ctx.moveTo(Math.round(i * step) + 0.5, 0);
        ctx.lineTo(Math.round(i * step) + 0.5, A);
        ctx.moveTo(0, Math.round(i * step) + 0.5);
        ctx.lineTo(A, Math.round(i * step) + 0.5);
      }
      ctx.stroke();

      /* 中心圆 */
      ctx.strokeStyle = 'rgba(' + INK + ',0.07)';
      ctx.beginPath();
      ctx.arc(A / 2, A / 2, A * 0.14, 0, M.TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(A / 2, A / 2, 4, 0, M.TAU);
      ctx.fillStyle = 'rgba(' + INK + ',0.12)';
      ctx.fill();

      /* 倒计时数字 */
      if (match.phase === 'countdown') {
        var n = Math.ceil(match.countdownT);
        if (n > 0) {
          var frac = match.countdownT - Math.floor(match.countdownT);
          ctx.save();
          ctx.globalAlpha = 0.14 + 0.5 * Math.max(0, frac);
          ctx.fillStyle = '#2B2B2B';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '800 ' + (A * 0.3) + 'px "Noto Sans SC","Microsoft YaHei",sans-serif';
          ctx.fillText(String(n), A / 2, A / 2 + A * 0.02);
          ctx.restore();
        }
      }

      /* 场地边框 */
      ctx.strokeStyle = 'rgba(' + INK + ',0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, A - 3, A - 3);

      /* 四角小刻线 */
      ctx.strokeStyle = 'rgba(' + INK + ',0.5)';
      ctx.lineWidth = 2;
      var L = A * 0.05;
      var pad = 10;
      var corners = [[pad, pad, 1, 1], [A - pad, pad, -1, 1], [pad, A - pad, 1, -1], [A - pad, A - pad, -1, -1]];
      for (var c = 0; c < corners.length; c++) {
        var o = corners[c];
        ctx.beginPath();
        ctx.moveTo(o[0] + o[2] * L, o[1]);
        ctx.lineTo(o[0], o[1]);
        ctx.lineTo(o[0], o[1] + o[3] * L);
        ctx.stroke();
      }
    },

    /* ------------------------------------------------------------------ */
    drawField: function (ctx, f, match) {
      /* ---- 佩恩：万象天引（引力奇点） ---- */
      if (f.kind === 'pain1') {
        var k1 = 1 - f.age / f.life;
        ctx.save();
        /* 黑白引力场：外围透明 → 中段灰 → 中心纯黑 */
        var gp = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.radius);
        gp.addColorStop(0, 'rgba(0,0,0,0.94)');
        gp.addColorStop(0.35, 'rgba(40,40,40,0.42)');
        gp.addColorStop(0.75, 'rgba(120,120,120,0.16)');
        gp.addColorStop(1, 'rgba(150,150,150,0)');
        ctx.fillStyle = gp;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, M.TAU); ctx.fill();

        /* 向心旋转的白色螺旋线（表现"吸"） */
        ctx.globalAlpha = 0.62 * k1;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        for (var s1 = 0; s1 < 5; s1++) {
          var a0s = match.t * 3.0 + s1 * (M.TAU / 5);
          ctx.beginPath();
          for (var st1 = 0; st1 <= 22; st1++) {
            var tt1 = st1 / 22;
            var rr1 = f.radius * (1 - tt1 * 0.92);
            var aa1 = a0s + tt1 * 3.6;
            var px1 = f.x + Math.cos(aa1) * rr1, py1 = f.y + Math.sin(aa1) * rr1;
            if (st1 === 0) ctx.moveTo(px1, py1); else ctx.lineTo(px1, py1);
          }
          ctx.stroke();
        }
        /* 一圈白边 + 纯黑核心 */
        ctx.globalAlpha = 0.5 * k1;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius * 0.96, 0, M.TAU); ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.98)';
        ctx.beginPath(); ctx.arc(f.x, f.y, 10 + Math.sin(match.t * 12) * 2, 0, M.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, 12 + Math.sin(match.t * 12) * 2, 0, M.TAU); ctx.stroke();
        ctx.restore();
        return;
      }

      /* ---- 佩恩：超·神罗天征（淡蓝，持续向外扩散的动画） ---- */
      if (f.kind === 'pain2') {
        var k2 = 1 - f.age / f.life;
        ctx.save();
        var gs = ctx.createRadialGradient(f.x, f.y, f.radius * 0.35, f.x, f.y, f.radius);
        gs.addColorStop(0, 'rgba(219,234,254,0.24)');
        gs.addColorStop(0.7, 'rgba(147,197,253,0.30)');
        gs.addColorStop(1, 'rgba(59,130,246,0.42)');
        ctx.fillStyle = gs;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, M.TAU); ctx.fill();

        /* 永远在动的向外扩散环（不是静态领域） */
        for (var s2 = 0; s2 < 4; s2++) {
          var prog = ((match.t * 1.7 + s2 / 4) % 1);
          var rr2 = f.radius * (0.2 + 0.8 * prog);
          ctx.globalAlpha = (0.35 + 0.65 * (1 - prog)) * k2;
          ctx.strokeStyle = 'rgba(255,255,255,1)';
          ctx.lineWidth = 4.2;
          ctx.beginPath(); ctx.arc(f.x, f.y, rr2, 0, M.TAU); ctx.stroke();
        }
        /* 中心旋转的放射气流 */
        ctx.globalAlpha = 0.45 * k2;
        ctx.strokeStyle = 'rgba(219,234,254,1)';
        ctx.lineWidth = 2.6;
        for (var s2b = 0; s2b < 10; s2b++) {
          var aa2 = match.t * 1.9 + s2b * (M.TAU / 10);
          ctx.beginPath();
          ctx.moveTo(f.x + Math.cos(aa2) * f.radius * 0.2, f.y + Math.sin(aa2) * f.radius * 0.2);
          ctx.lineTo(f.x + Math.cos(aa2) * f.radius * 0.72, f.y + Math.sin(aa2) * f.radius * 0.72);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.75 * k2;
        ctx.strokeStyle = 'rgba(30,64,175,0.95)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, M.TAU); ctx.stroke();
        ctx.restore();
        return;
      }

      /* ---- 佩恩：地爆天星（黑色球体） ---- */
      if (f.kind === 'pain3') {
        var cr = f.r || 46;
        ctx.save();
        var gc = ctx.createRadialGradient(f.x, f.y, cr * 0.8, f.x, f.y, cr * 3.4);
        gc.addColorStop(0, 'rgba(60,30,12,0.55)');
        gc.addColorStop(0.5, 'rgba(154,52,18,0.18)');
        gc.addColorStop(1, 'rgba(154,52,18,0)');
        ctx.fillStyle = gc;
        ctx.beginPath(); ctx.arc(f.x, f.y, cr * 3.4, 0, M.TAU); ctx.fill();

        ctx.strokeStyle = 'rgba(251,146,60,0.5)';
        ctx.lineWidth = 2;
        for (var s3 = 0; s3 < 3; s3++) {
          var rr3 = cr * (1.5 + s3 * 0.55);
          var a3 = match.t * (1.6 - s3 * 0.4);
          ctx.globalAlpha = 0.7 - s3 * 0.18;
          ctx.beginPath();
          ctx.arc(f.x, f.y, rr3, a3, a3 + Math.PI * 1.25);
          ctx.stroke();
        }
        /* 黏上去的岩石壳：黏得越多裹得越厚（对应 captureRocks 的 f.crust） */
        var nCrust = Math.min(f.crust || 0, 46);
        if (nCrust > 0) {
          var core0 = f.core || {};
          var base = Math.max(cr + 5, (core0.sealRadius || 0) + (core0.rockR || 19) + 4);
          var shellR = base + Math.min(14, Math.sqrt(nCrust) * 1.3);   // 固定住，别越裹越大
          for (var ci = 0; ci < nCrust; ci++) {
            var ca = ci * 2.399963 + f.id * 0.7;                 // 黄金角：分布均匀
            var cR = shellR * (0.86 + 0.2 * ((ci * 37) % 7) / 7);
            var cxx = f.x + Math.cos(ca) * cR;
            var cyy = f.y + Math.sin(ca) * cR;
            var csize = 4 + ((ci * 13) % 5);
            ctx.save();
            ctx.translate(cxx, cyy);
            ctx.rotate(ca * 2.1);
            ctx.fillStyle = ci % 3 === 0 ? '#6B6560' : (ci % 3 === 1 ? '#544E4A' : '#7A736C');
            ctx.beginPath();
            for (var ck = 0; ck < 5; ck++) {
              var cka = ck * (M.TAU / 5);
              var ckr = csize * (0.75 + 0.25 * ((ci + ck) % 3));
              if (ck === 0) ctx.moveTo(Math.cos(cka) * ckr, Math.sin(cka) * ckr);
              else ctx.lineTo(Math.cos(cka) * ckr, Math.sin(cka) * ckr);
            }
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        ctx.globalAlpha = 1;
        var gb = ctx.createRadialGradient(f.x - cr * 0.3, f.y - cr * 0.3, cr * 0.1, f.x, f.y, cr);
        gb.addColorStop(0, '#4A3520');
        gb.addColorStop(0.55, '#1C1208');
        gb.addColorStop(1, '#0A0603');
        ctx.fillStyle = gb;
        ctx.beginPath(); ctx.arc(f.x, f.y, cr, 0, M.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(251,146,60,0.8)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, cr, 0, M.TAU); ctx.stroke();
        ctx.restore();
        return;
      }

      var ch = SH.CHARACTERS[f.charId];
      var main = ch ? ch.color.main : '#8B1A1A';

      if (f.kind === 'sukuna3') {
        ctx.save();
        ctx.globalAlpha = 0.5;
        var g = ctx.createRadialGradient(f.x, f.y, f.radius * 0.2, f.x, f.y, f.radius);
        g.addColorStop(0, 'rgba(139,26,26,0.05)');
        g.addColorStop(0.75, 'rgba(139,26,26,0.10)');
        g.addColorStop(1, 'rgba(139,26,26,0.16)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, M.TAU);
        ctx.fill();

        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = 'rgba(139,26,26,0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, M.TAU);
        ctx.stroke();

        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = 'rgba(139,26,26,0.7)';
        ctx.lineWidth = 1.2;
        var t = match.t;
        for (var i = 0; i < 10; i++) {
          var a = t * 0.35 + i * (M.TAU / 10);
          var r0 = f.radius * 0.18;
          ctx.beginPath();
          ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
          ctx.lineTo(f.x + Math.cos(a) * f.radius, f.y + Math.sin(a) * f.radius);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.22;
        for (var r = 1; r <= 4; r++) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (r / 4.6), 0, M.TAU);
          ctx.stroke();
        }

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#8B1A1A';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 20px "Noto Sans SC","Microsoft YaHei",sans-serif';
        ctx.fillText('伏魔御厨子', f.x, f.y - f.radius + 22);
        ctx.restore();
        return;
      }

      if (f.kind === 'gojo3') {
        var k = M.clamp(f.age / f.life, 0, 1);
        ctx.save();
        var rad = 40 + 900 * (1 - Math.pow(1 - k, 3));
        var gg = ctx.createRadialGradient(f.x, f.y, rad * 0.55, f.x, f.y, rad);
        gg.addColorStop(0, 'rgba(255,255,255,0)');
        gg.addColorStop(0.8, 'rgba(120,150,255,0.06)');
        gg.addColorStop(1, 'rgba(120,150,255,0.16)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(f.x, f.y, rad, 0, M.TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,90,200,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, rad, 0, M.TAU);
        ctx.stroke();
        ctx.restore();
      }
    },

    /* ------------------------------------------------------------------
     * 飞行物
     * ------------------------------------------------------------------ */
    drawProjectile: function (ctx, p, match) {
      switch (p.kind) {
        case 'blue': this.drawBlue(ctx, p, match); break;
        case 'red': this.drawRed(ctx, p); break;
        case 'purple': this.drawPurple(ctx, p); break;
        case 'arrow': this.drawArrow(ctx, p); break;
        case 'slash': this.drawSlash(ctx, p); break;
        case 'grid': this.drawGrid(ctx, p); break;
      case 'kunai': this.drawKunai(ctx, p, match); break;
      case 'rock': this.drawRock(ctx, p, match); break;
        case 'rasengan': this.drawRasengan(ctx, p, match); break;
        default: break;
      }
    },

    /* 螺旋丸：高速自转的蓝白色查克拉球 + 外圈气旋 */
    /* 地爆天星剥下来的岩石 */
    /* 地爆天星剥下来的岩石 */
    drawRock: function (ctx, p, match) {
      var r = p.r || 15;
      var seed = (p.id || 1) * 1.7;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.age || 0) * 2.2 + seed);
      var g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
      g.addColorStop(0, '#9A8E86');
      g.addColorStop(1, '#4A4340');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (var i = 0; i < 7; i++) {
        var a = i * (M.TAU / 7);
        var rr = r * (0.72 + 0.28 * Math.abs(Math.sin(seed + i * 2.3)));
        var px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,25,22,0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = 'rgba(251,146,60,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-(p.vx || 0) * 0.03, -(p.vy || 0) * 0.03);
      ctx.stroke();
      ctx.restore();
    },

    /* 飞雷神苦无：三叉苦无 + 金边 + 术式尾迹 */
    drawKunai: function (ctx, p, match) {
      var r = p.r || 11;
      var ang = Math.atan2(p.vy || 0, p.vx || 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      /* 尾迹 */
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(245,158,11,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 3.2, 0);
      ctx.lineTo(-r * 1.2, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      /* 刃 */
      ctx.fillStyle = '#3F3F46';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.2, -r * 0.45);
      ctx.lineTo(-r * 0.2, r * 0.45);
      ctx.closePath();
      ctx.fill();
      /* 两个侧叉 */
      ctx.strokeStyle = '#3F3F46';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, 0); ctx.lineTo(-r * 0.95, -r * 0.7);
      ctx.moveTo(-r * 0.2, 0); ctx.lineTo(-r * 0.95, r * 0.7);
      ctx.stroke();
      /* 术式光点 */
      ctx.fillStyle = '#FCD34D';
      ctx.beginPath(); ctx.arc(-r * 0.2, 0, r * 0.28, 0, M.TAU); ctx.fill();
      ctx.restore();
    },

    /* 蝠群（吸血球化蝠形态）：本体隐藏，改画一圈盘旋的蝙蝠 + 暗红光晕 */
    drawBats: function (ctx, ball, match) {
      var t = match.t;
      var R = ball.r * 1.8;     // 范围扩大 100%，视觉同步放大
      ctx.save();
      ctx.translate(ball.x, ball.y);

      /* 暗红光晕 */
      var g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.7);
      g.addColorStop(0, 'rgba(190,18,60,0.45)');
      g.addColorStop(1, 'rgba(136,19,55,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.7, 0, M.TAU); ctx.fill();

      /* 数量随剩余时间变少（收尾时蝙蝠归位） */
      var left = Math.max(0, Math.min(1, (ball.status.batUntil - t) / 3));
      var n = 6 + Math.round(8 * left);
      ctx.fillStyle = '#1C1917';
      for (var i = 0; i < n; i++) {
        var a = t * 3.4 + i * (M.TAU / n);
        var rr = R * (1.05 + 0.75 * ((i % 3) / 3)) * (1 + 0.07 * Math.sin(t * 7 + i));
        var bx = Math.cos(a) * rr, by = Math.sin(a) * rr * 0.75;
        var flap = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + i * 1.3));   // 翅膀扇动
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(Math.sin(t * 5 + i) * 0.5);
        /* 两片翅膀 */
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-11, -9 * flap, -19, 1.5);
        ctx.quadraticCurveTo(-6, 1.5, 0, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(11, -9 * flap, 19, 1.5);
        ctx.quadraticCurveTo(6, 1.5, 0, 0);
        ctx.fill();
        /* 身体 */
        ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 4.8, 0, 0, M.TAU); ctx.fill();
        ctx.restore();
      }
      /* 外圈（表示还在无敌） */
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 6);
      ctx.strokeStyle = 'rgba(255,228,230,0.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.25, 0, M.TAU); ctx.stroke();
      ctx.restore();
    },

    /* 留在场上的苦无标记（画成一枚真正的苦无：刃 + 柄 + 环，金边） */
    drawPlacedKunai: function (ctx, k, match, isNewest) {
      var L = 15;
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.ang || 0);

      /* 最新那枚：外面套一个黄圈，方便分辨 */
      if (isNewest) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, L * 1.9, 0, M.TAU); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(0, 0, L * 2.35, 0, M.TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      /* 刃（菱形） */
      ctx.fillStyle = '#52525B';
      ctx.beginPath();
      ctx.moveTo(L, 0);
      ctx.lineTo(L * 0.15, -L * 0.42);
      ctx.lineTo(L * 0.02, 0);
      ctx.lineTo(L * 0.15, L * 0.42);
      ctx.closePath();
      ctx.fill();
      /* 柄 */
      ctx.strokeStyle = '#3F3F46';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(L * 0.02, 0); ctx.lineTo(-L * 0.62, 0); ctx.stroke();
      /* 尾环 */
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(-L * 0.82, 0, L * 0.24, 0, M.TAU); ctx.stroke();
      /* 术式金点 */
      ctx.fillStyle = '#FCD34D';
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, M.TAU); ctx.fill();
      ctx.restore();
    },

    drawRasengan: function (ctx, p, match) {
      this.drawRasenganAt(ctx, p.x, p.y, p.r, p.age || 0, p.vx || 0, p.vy || 0);
    },

    /* 螺旋丸的通用画法：飞行版和"握在手上"版共用，保证看起来是同一个东西 */
    drawRasenganAt: function (ctx, x, y, r, age, vx, vy) {
      var spin = age * 22;

      ctx.save();
      ctx.translate(x, y);

      /* 外层光晕 */
      var g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.75);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.42, 'rgba(125,211,252,0.75)');
      g.addColorStop(0.72, 'rgba(59,130,246,0.35)');
      g.addColorStop(1, 'rgba(59,130,246,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.75, 0, M.TAU);
      ctx.fill();

      /* 球心 */
      var core = ctx.createRadialGradient(-r * 0.22, -r * 0.22, 1, 0, 0, r);
      core.addColorStop(0, '#FFFFFF');
      core.addColorStop(0.5, '#BFE6FF');
      core.addColorStop(1, '#3B82F6');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, M.TAU);
      ctx.fill();

      /* 外圈气旋：两条反向旋转的弧 */
      ctx.lineWidth = 3;
      for (var k = 0; k < 2; k++) {
        ctx.strokeStyle = k === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(147,197,253,0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.15 + k * 0.18), spin * (k ? -1 : 1), spin * (k ? -1 : 1) + Math.PI * 1.25);
        ctx.stroke();
      }

      /* 拖尾 */
      var sp = Math.hypot(vx, vy) || 1;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(191,230,255,0.9)';
      ctx.lineWidth = r * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-vx / sp * r * 1.1, -vy / sp * r * 1.1);
      ctx.lineTo(-vx / sp * r * 3.4, -vy / sp * r * 3.4);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.restore();
    },

    /* 苍 —— 漩涡 / 黑洞感：深色事件视界 + 旋转吸积盘 + 可见的吸力流线 */
    drawBlue: function (ctx, p, match) {
      var r = p.r;

      ctx.save();

      /* 外层引力光晕 */
      var glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 1.55);
      glow.addColorStop(0, 'rgba(59,130,246,0.40)');
      glow.addColorStop(0.6, 'rgba(96,165,250,0.16)');
      glow.addColorStop(1, 'rgba(96,165,250,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.55, 0, M.TAU);
      ctx.fill();

      /* 事件视界（深色核心） */
      var core = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 0.72);
      core.addColorStop(0, 'rgba(6,14,40,0.98)');
      core.addColorStop(0.55, 'rgba(12,30,86,0.92)');
      core.addColorStop(0.82, 'rgba(37,99,235,0.85)');
      core.addColorStop(1, 'rgba(59,130,246,0.12)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.72, 0, M.TAU);
      ctx.fill();

      /* 吸积盘：两条反向旋转的螺旋臂 */
      ctx.save();
      ctx.translate(p.x, p.y);
      var spin = p.age * 2.1;
      for (var arm = 0; arm < 3; arm++) {
        for (var dir = -1; dir <= 1; dir += 2) {
          ctx.beginPath();
          var base = arm * (M.TAU / 3) + (dir < 0 ? 0.35 : 0);
          for (var t = 0; t <= 1.0001; t += 0.08) {
            var ang = base + dir * t * 2.9 + spin * dir;
            var rad = r * (0.24 + 0.68 * Math.pow(t, 0.85));
            var x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
            if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.lineCap = 'round';
          ctx.strokeStyle = dir > 0 ? 'rgba(191,219,254,0.85)' : 'rgba(147,197,253,0.6)';
          ctx.lineWidth = 3.4;
          ctx.stroke();
        }
      }
      /* 耀眼的内环（吸积盘最亮处） */
      ctx.strokeStyle = 'rgba(224,242,254,0.95)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, M.TAU);
      ctx.stroke();
      ctx.restore();

      /* 边缘细环 */
      ctx.strokeStyle = 'rgba(37,99,235,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.98, 0, M.TAU);
      ctx.stroke();

      /* 引力范围（虚线） */
      ctx.globalAlpha = 0.16;
      ctx.setLineDash([7, 9]);
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.attract.radius, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      /* 向内收缩的引力环：让人一眼看出"这个圈里在被吸" */
      for (var ring = 0; ring < 4; ring++) {
        var prog = (p.age * 0.5 + ring / 4) % 1;      // 0 → 1 向圆心收缩
        var rr = p.attract.radius * (1 - prog);
        if (rr <= r * 0.55) continue;
        ctx.globalAlpha = 0.13 * (1 - prog) * (1 - prog);
        ctx.strokeStyle = 'rgba(147,197,253,0.95)';
        ctx.lineWidth = 2 + 3 * (1 - prog);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, M.TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      /* 吸力流线：把"正在被吸的东西"画出来 */
      if (match) this.drawSuction(ctx, p, match);

      ctx.restore();
    },

    /* 在苍 与被吸住的物体之间画向内汇聚的小点 */
    drawSuction: function (ctx, p, match) {
      var at = p.attract;
      var fall = (at.falloff === undefined) ? 1 : at.falloff;
      var list = [];

      for (var i = 0; i < match.projectiles.length; i++) {
        var q = match.projectiles[i];
        if (q === p || q.dead || q.kind === 'grid') continue;
        list.push(q);
      }
      for (var b = 0; b < match.balls.length; b++) {
        if (b !== p.owner && match.balls[b].alive) list.push(match.balls[b]);
      }

      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        var rad = at.radius;
        if (o.kind === 'red' && at.radiusRed) rad = at.radiusRed;
        var dx = p.x - o.x, dy = p.y - o.y;
        var d = Math.hypot(dx, dy);
        if (d >= rad || d < 1) continue;

        var strength = Math.pow(1 - d / rad, fall);
        if (strength < 0.02) continue;

        /* 沿连线向内滑动的 3 个小点 */
        for (var n = 0; n < 3; n++) {
          var prog = (p.age * 1.5 + n / 3) % 1;
          var t = 1 - prog;
          var x = o.x + dx * t, y = o.y + dy * t;
          ctx.globalAlpha = strength * (1 - prog) * 0.85;
          ctx.fillStyle = o.kind === 'red' ? 'rgba(255,150,150,0.95)' : 'rgba(190,220,255,0.95)';
          ctx.beginPath();
          ctx.arc(x, y, 2.2 + strength * 2.4, 0, M.TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },

    /* 赫 —— 极小的暗红飞弹 + 拖尾 */
    drawRed: function (ctx, p) {
      var sp = Math.hypot(p.vx, p.vy) || 1;
      var ux = p.vx / sp, uy = p.vy / sp;
      ctx.save();
      for (var t = 4; t >= 1; t--) {
        ctx.globalAlpha = 0.20 * (5 - t) / 4;
        ctx.fillStyle = 'rgba(139,26,26,1)';
        ctx.beginPath();
        ctx.arc(p.x - ux * t * 16, p.y - uy * t * 16, p.r * (1.15 - t * 0.16), 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      var g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r * 2.2);
      g.addColorStop(0, 'rgba(255,200,180,0.95)');
      g.addColorStop(0.35, 'rgba(139,26,26,0.9)');
      g.addColorStop(1, 'rgba(74,13,13,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.2, 0, M.TAU);
      ctx.fill();
      ctx.fillStyle = '#4A0D0D';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, M.TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,140,110,0.95)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.45, 0, M.TAU);
      ctx.fill();
      ctx.restore();
    },

    /* 茈 —— 原地的紫色漩涡：逐渐膨胀 → 炸开 */
    drawPurple: function (ctx, p) {
      var r = p.r;
      var growK = p.growTime > 0 ? M.clamp(p.age / p.growTime, 0, 1) : 1;
      var near = M.clamp(p.age / p.life, 0, 1);   // 越接近爆炸越亮
      var pulse = 0.5 + 0.5 * Math.sin(p.age * 14);

      ctx.save();

      /* 膨胀过程中的冲击环 */
      if (growK < 1) {
        for (var k = 0; k < 2; k++) {
          var rk = M.clamp(growK * 1.4 - k * 0.3, 0, 1);
          if (rk <= 0) continue;
          ctx.globalAlpha = 0.5 * (1 - rk);
          ctx.strokeStyle = 'rgba(167,139,250,1)';
          ctx.lineWidth = 5 * (1 - rk) + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (0.7 + 0.9 * rk), 0, M.TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      /* 外层光晕（越接近爆炸越大越亮） */
      var halo = r * (1.4 + 0.35 * near) + pulse * 4;
      var g1 = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, halo);
      g1.addColorStop(0, 'rgba(124,58,237,' + (0.5 + 0.3 * near).toFixed(3) + ')');
      g1.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, M.TAU);
      ctx.fill();

      /* 主体：深紫→紫的球 */
      var g2 = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
      g2.addColorStop(0, 'rgba(255,255,255,0.98)');
      g2.addColorStop(0.18, 'rgba(233,213,255,0.95)');
      g2.addColorStop(0.5, 'rgba(139,92,246,0.9)');
      g2.addColorStop(0.85, 'rgba(76,29,149,0.85)');
      g2.addColorStop(1, 'rgba(46,16,101,0.25)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, M.TAU);
      ctx.fill();

      /* 旋转的紫色漩涡 */
      ctx.save();
      ctx.translate(p.x, p.y);
      var spin = p.age * (2.6 + 3 * near);
      ctx.lineCap = 'round';
      for (var arm = 0; arm < 4; arm++) {
        ctx.beginPath();
        for (var t = 0; t <= 1.0001; t += 0.07) {
          var ang = arm * (M.TAU / 4) + t * 3.4 + spin;
          var rad = r * (0.14 + 0.8 * t);
          var x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
          if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 - arm * 0.08).toFixed(2) + ')';
        ctx.lineWidth = 3.6;
        ctx.stroke();
      }
      /* 炽白核心 */
      var coreR = r * (0.2 + 0.12 * pulse);
      var g3 = ctx.createRadialGradient(0, 0, 1, 0, 0, coreR);
      g3.addColorStop(0, 'rgba(255,255,255,1)');
      g3.addColorStop(0.6, 'rgba(243,232,255,0.85)');
      g3.addColorStop(1, 'rgba(196,181,253,0)');
      ctx.fillStyle = g3;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, M.TAU);
      ctx.fill();
      ctx.restore();

      /* 边缘亮环（临近爆炸时越来越亮） */
      ctx.strokeStyle = 'rgba(216,180,254,' + (0.5 + 0.5 * near).toFixed(2) + ')';
      ctx.lineWidth = 3 + 3 * near;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.97, 0, M.TAU);
      ctx.stroke();

      /* 充能环：一圈走完就炸开（让"即将炸开"变得可读） */
      ctx.strokeStyle = 'rgba(139,92,246,0.35)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 16, 0, M.TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 16, -Math.PI / 2, -Math.PI / 2 + M.TAU * near);
      ctx.stroke();

      ctx.restore();
    },

    /* 灶·开 —— 火焰箭：木杆 + 火焰箭头 + 火尾 */
    drawArrow: function (ctx, p) {
      var ang = Math.atan2(p.vy, p.vx);
      var r = p.r * 1.35;   // 画得比判定稍大一点，看得清

      /* 记录拖尾（纯表现字段） */
      if (!p.trail) p.trail = [];
      var last = p.trail[p.trail.length - 1];
      if (!last || M.dist(last.x, last.y, p.x, p.y) > 3) {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 22) p.trail.shift();
      }

      ctx.save();

      /* 火焰拖尾：从暗红到亮黄 */
      for (var i = 0; i < p.trail.length; i++) {
        var tp = p.trail[i];
        var k = (i + 1) / p.trail.length;          // 越新越大越亮
        var flick = 0.78 + 0.22 * Math.sin(p.age * 30 + i);
        var rr = r * (1.5 * k + 0.2) * flick;
        var alpha = 0.55 * k;
        var col = k > 0.72 ? '253,224,71' : (k > 0.45 ? '249,115,22' : '170,40,16');
        ctx.fillStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, rr, 0, M.TAU);
        ctx.fill();
      }
      /* 火星 */
      for (var sp2 = 0; sp2 < 4; sp2++) {
        var ph2 = (p.age * 5 + sp2 * 0.25) % 1;
        var idx = Math.max(0, p.trail.length - 1 - sp2 * 3);
        var bp = p.trail[idx] || p;
        ctx.globalAlpha = 0.6 * (1 - ph2);
        ctx.fillStyle = 'rgba(253,224,71,0.95)';
        ctx.beginPath();
        ctx.arc(bp.x + Math.sin(p.age * 18 + sp2) * 10,
          bp.y + Math.cos(p.age * 16 + sp2) * 10, 3 * (1 - ph2), 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* 箭头本体 */
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);

      /* 火头光晕 */
      var fg = ctx.createRadialGradient(r * 1.2, 0, 2, r * 1.2, 0, r * 2.8);
      fg.addColorStop(0, 'rgba(255,255,255,0.9)');
      fg.addColorStop(0.3, 'rgba(253,224,71,0.85)');
      fg.addColorStop(0.65, 'rgba(249,115,22,0.6)');
      fg.addColorStop(1, 'rgba(220,38,38,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(r * 1.2, 0, r * 2.8, 0, M.TAU);
      ctx.fill();

      /* 箭杆（画粗一点，和判定半径无关） */
      ctx.strokeStyle = 'rgba(70,38,14,0.98)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 1.6, 0);
      ctx.lineTo(r * 1.0, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,196,120,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 1.5, -1.4);
      ctx.lineTo(r * 0.9, -1.4);
      ctx.stroke();

      /* 尾羽 */
      ctx.fillStyle = 'rgba(220,38,38,0.95)';
      for (var f = -1; f <= 1; f += 2) {
        ctx.beginPath();
        ctx.moveTo(-r * 1.5, 0);
        ctx.lineTo(-r * 2.5, f * r * 0.95);
        ctx.lineTo(-r * 0.85, f * r * 0.24);
        ctx.closePath();
        ctx.fill();
      }

      /* 箭头 */
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.moveTo(r * 2.4, 0);
      ctx.lineTo(r * 0.75, r * 0.85);
      ctx.lineTo(r * 1.15, 0);
      ctx.lineTo(r * 0.75, -r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(154,52,18,0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.restore();
    },

    /* 解 —— 一字型斩击：向前鼓起的月牙刀刃 + 后像 */
    drawSlash: function (ctx, p) {
      var half = p.halfLen;
      var bulge = p.halfLen * 0.18;   // 弧度跟着长度等比缩放
      var appear = M.clamp(p.age / 0.05, 0, 1);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.diry, p.dirx));
      ctx.lineCap = 'round';

      /* 后像：沿飞行方向往后排 3 层（深红残影） */
      for (var lay = 3; lay >= 1; lay--) {
        ctx.globalAlpha = 0.22 * (4 - lay) / 3 * appear;
        ctx.strokeStyle = 'rgba(139,26,26,1)';
        ctx.lineWidth = 9 - lay * 1.6;
        ctx.beginPath();
        ctx.moveTo(-lay * 28, -half * 0.94);
        ctx.quadraticCurveTo(-lay * 28 + bulge, 0, -lay * 28, half * 0.94);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      /* 外层血光 */
      ctx.globalAlpha = 0.4 * appear;
      ctx.strokeStyle = 'rgba(190,40,40,0.9)';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(0, -half * 0.98);
      ctx.quadraticCurveTo(bulge, 0, 0, half * 0.98);
      ctx.stroke();
      ctx.globalAlpha = 1;

      /* 刀身：深红墨色（在米白底上才是"看得见的斩击"） */
      var grad = ctx.createLinearGradient(0, -half, 0, half);
      grad.addColorStop(0, 'rgba(74,13,13,0)');
      grad.addColorStop(0.1, 'rgba(74,13,13,0.95)');
      grad.addColorStop(0.5, 'rgba(120,20,20,1)');
      grad.addColorStop(0.9, 'rgba(74,13,13,0.95)');
      grad.addColorStop(1, 'rgba(74,13,13,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 8 * appear;
      ctx.beginPath();
      ctx.moveTo(0, -half);
      ctx.quadraticCurveTo(bulge, 0, 0, half);
      ctx.stroke();

      /* 刃口高光（前缘的白色细线，制造锋利的切割感） */
      var grad2 = ctx.createLinearGradient(0, -half, 0, half);
      grad2.addColorStop(0, 'rgba(255,255,255,0)');
      grad2.addColorStop(0.16, 'rgba(255,255,255,0.95)');
      grad2.addColorStop(0.5, 'rgba(255,255,255,1)');
      grad2.addColorStop(0.84, 'rgba(255,255,255,0.95)');
      grad2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad2;
      ctx.lineWidth = 2.6 * appear;
      ctx.beginPath();
      ctx.moveTo(2.5, -half * 0.99);
      ctx.quadraticCurveTo(bulge + 2.5, 0, 2.5, half * 0.99);
      ctx.stroke();

      /* 两端火花 */
      for (var e = -1; e <= 1; e += 2) {
        var sg = ctx.createRadialGradient(bulge * 0.35, e * half, 1, bulge * 0.35, e * half, 30);
        sg.addColorStop(0, 'rgba(255,255,255,0.95)');
        sg.addColorStop(0.35, 'rgba(255,150,130,0.5)');
        sg.addColorStop(1, 'rgba(200,60,40,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(bulge * 0.35, e * half, 30, 0, M.TAU);
        ctx.fill();
      }

      ctx.restore();
    },

    /* 捌 —— 井字网格斩击：只有井字，没有别的线条 */
    drawGrid: function (ctx, p) {
      var cs = p.cells[0].w;
      var fade = M.clamp(p.life / 0.3, 0, 1);          // 1 → 0
      var grow = M.clamp(p.age / 0.09, 0, 1);          // 0 → 1（落刀展开）

      /* 取全部格子的包围盒（cornerAligned 时格子不是以瞄准点对称的） */
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var c = 0; c < p.cells.length; c++) {
        minX = Math.min(minX, p.cells[c].x - cs / 2);
        maxX = Math.max(maxX, p.cells[c].x + cs / 2);
        minY = Math.min(minY, p.cells[c].y - cs / 2);
        maxY = Math.max(maxY, p.cells[c].y + cs / 2);
      }

      var over = cs * 0.34;                            // 井字的出头
      var x1 = minX + cs, x2 = minX + cs * 2;
      var y1 = minY + cs, y2 = minY + cs * 2;
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

      ctx.save();
      /* 快速展开的落刀感 */
      var k = 0.62 + 0.38 * grow;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
      ctx.lineCap = 'round';

      /* 外发光 */
      ctx.globalAlpha = 0.28 * fade;
      ctx.strokeStyle = 'rgba(190,40,40,0.9)';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(x1, minY - over); ctx.lineTo(x1, maxY + over);
      ctx.moveTo(x2, minY - over); ctx.lineTo(x2, maxY + over);
      ctx.moveTo(minX - over, y1); ctx.lineTo(maxX + over, y1);
      ctx.moveTo(minX - over, y2); ctx.lineTo(maxX + over, y2);
      ctx.stroke();

      /* 井字主体：墨红 */
      ctx.globalAlpha = 0.95 * fade;
      ctx.strokeStyle = 'rgba(110,16,16,0.95)';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(x1, minY - over); ctx.lineTo(x1, maxY + over);
      ctx.moveTo(x2, minY - over); ctx.lineTo(x2, maxY + over);
      ctx.moveTo(minX - over, y1); ctx.lineTo(maxX + over, y1);
      ctx.moveTo(minX - over, y2); ctx.lineTo(maxX + over, y2);
      ctx.stroke();

      /* 白色刀口：画在墨红线中央，看起来才像"切出来的线" */
      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x1, minY - over); ctx.lineTo(x1, maxY + over);
      ctx.moveTo(x2, minY - over); ctx.lineTo(x2, maxY + over);
      ctx.moveTo(minX - over, y1); ctx.lineTo(maxX + over, y1);
      ctx.moveTo(minX - over, y2); ctx.lineTo(maxX + over, y2);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();
    },

    /* ------------------------------------------------------------------
     * 角色球：纯色 + 描边 + 中间名字
     * ------------------------------------------------------------------ */
    drawBall: function (ctx, b, match) {
      var ch = b.char;
      var col = ch.color;
      var r = b.r;

      ctx.save();

      /* 落地阴影 */
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#2B2B2B';
      ctx.beginPath();
      ctx.ellipse(b.x + 6, b.y + 8, r * 0.96, r * 0.88, 0, 0, M.TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      /* 运动拖尾：被引力拽弯的轨迹靠它才看得出来 */
      if (!b.trail) b.trail = [];
      var lastT = b.trail[b.trail.length - 1];
      if (!lastT || M.dist(lastT.x, lastT.y, b.x, b.y) > 4) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 18) b.trail.shift();
      }
      for (var ti = 0; ti < b.trail.length; ti++) {
        var tk = (ti + 1) / b.trail.length;
        ctx.globalAlpha = 0.20 * tk * tk;
        ctx.fillStyle = col.main;
        ctx.beginPath();
        ctx.arc(b.trail[ti].x, b.trail[ti].y, r * (0.3 + 0.55 * tk), 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* 纯色球体 */
      ctx.fillStyle = col.main;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, M.TAU);
      ctx.fill();

      /* 外描边 */
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r - 2.5, 0, M.TAU);
      ctx.stroke();

      /* 内部细白圈（让名字区域更清爽，也有体积感） */
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 0.78, 0, M.TAU);
      ctx.stroke();

      /* 受击白闪 */
      if (b.flash > 0) {
        ctx.globalAlpha = M.clamp(b.flash / 0.18, 0, 1) * 0.8;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, M.TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* 中间的名字（分身不写名字，只留一个"影"字，避免一堆字糊在一起） */
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(r * 0.66) + 'px "Noto Sans SC","Microsoft YaHei",sans-serif';
      ctx.fillText(b.isClone ? '影' : (ch.shortName || ch.name), b.x, b.y + r * 0.03);

      /* 分身：虚线感的外圈 + 半透明，让玩家一眼分清本体和分身 */
      if (b.isClone) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 7]);
        ctx.lineDashOffset = -match.t * 26;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 7, 0, M.TAU);
        ctx.stroke();
        ctx.restore();
      }

      /* 定身（无量空处）：双层旋转六边笼 + 剩余时间 */
    /* 定身表现按【来源】决定：只有无量空处才画白蓝六边笼，
     * 黑棒画黑棒钉住，其余来源什么都不画（它们有自己的表现）。 */
    if (b.isBound(match.t)) {
      if (b.status.bindSource === 'rod') {
        var rk = M.clamp((b.status.bindUntil - match.t) / 5, 0, 1);
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.92)';
        ctx.lineCap = 'round';
        for (var rbi = 0; rbi < 5; rbi++) {
          var ra = rbi * (M.TAU / 5) + 0.4;   // 定住就不再转
          var rx = b.x + Math.cos(ra) * (r + 4);
          var ry = b.y + Math.sin(ra) * (r + 4);
          var rl = 20 + 6 * (1 - rk);
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx + Math.cos(ra) * rl, ry + Math.sin(ra) * rl);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.35 + 0.35 * rk;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 13, 0, M.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        return;
      }
      if (b.status.bindSource !== 'gojo3') return;   // 其他来源：不画无量空处那套
    }
    /* 无量空处（只有它用这套）：白蓝双层六边笼 + 剩余时间弧 */
    if (b.status.bindSource === 'gojo3' && b.isBound(match.t)) {
      var bindK = M.clamp((b.status.bindUntil - match.t) / 1.0, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(220,235,255,0.95)';
      ctx.lineWidth = 2.5;
      for (var hx = 0; hx < 2; hx++) {
        var hrad = r + 22 + hx * 12;
        ctx.beginPath();
        for (var hv = 0; hv < 6; hv++) {
          var ha = match.t * (hx ? -0.9 : 1.2) + hv * (M.TAU / 6);
          var px2 = b.x + Math.cos(ha) * hrad;
          var py2 = b.y + Math.sin(ha) * hrad;
          if (hv === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 30, -Math.PI / 2, -Math.PI / 2 + M.TAU * bindK);
      ctx.stroke();
      ctx.restore();
    }

      /* 无下限：环绕一圈的发光特效 */
      if (b.status.immunityUntil > match.t) {
        var big = b.status.immunityBig;
        var pulse = 0.5 + 0.5 * Math.sin(match.t * 22);
        var R = r + 13 + pulse * 3.5;
        var spin = match.t * 2.6;

        /* 发光带：由内向外散开的蓝白光晕 */
        var halo = ctx.createRadialGradient(b.x, b.y, r + 1, b.x, b.y, R + 16);
        halo.addColorStop(0, 'rgba(150,205,255,0)');
        halo.addColorStop(0.30, big ? 'rgba(130,195,255,0.80)' : 'rgba(150,205,255,0.55)');
        halo.addColorStop(0.55, big ? 'rgba(215,240,255,0.95)' : 'rgba(200,232,255,0.72)');
        halo.addColorStop(0.80, 'rgba(120,180,255,0.22)');
        halo.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(b.x, b.y, R + 16, 0, M.TAU);
        ctx.fill();

        /* 亮环 */
        ctx.strokeStyle = big ? 'rgba(240,250,255,0.98)' : 'rgba(225,242,255,0.9)';
        ctx.lineWidth = big ? 3.6 : 2.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, R, 0, M.TAU);
        ctx.stroke();

        /* 环绕旋转的光点 */
        for (var sp = 0; sp < 6; sp++) {
          var sa = spin + sp * (M.TAU / 6);
          var sx = b.x + Math.cos(sa) * (R + 7), sy = b.y + Math.sin(sa) * (R + 7);
          var sg = ctx.createRadialGradient(sx, sy, 1, sx, sy, 8);
          sg.addColorStop(0, 'rgba(255,255,255,0.95)');
          sg.addColorStop(0.5, 'rgba(170,215,255,0.6)');
          sg.addColorStop(1, 'rgba(140,190,255,0)');
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.arc(sx, sy, 8, 0, M.TAU);
          ctx.fill();
        }
      }

      /* 虎杖「黑闪」状态：球体外围黑红色裂纹光晕（表示下一击必定黑闪） */
      if (b.status.guaranteedBlackFlash > 0) {
        var bfPulse = 0.5 + 0.5 * Math.sin(match.t * 9);
        var bfR = r + 10 + bfPulse * 5;

        var bfg = ctx.createRadialGradient(b.x, b.y, r - 2, b.x, b.y, bfR + 22);
        bfg.addColorStop(0, 'rgba(20,8,12,0)');
        bfg.addColorStop(0.42, 'rgba(24,8,14,0.55)');
        bfg.addColorStop(0.72, 'rgba(120,16,48,0.42)');
        bfg.addColorStop(1, 'rgba(228,71,122,0)');
        ctx.fillStyle = bfg;
        ctx.beginPath();
        ctx.arc(b.x, b.y, bfR + 22, 0, M.TAU);
        ctx.fill();

        /* 黑红裂纹：绕着球转的折线 */
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(match.t * 0.9);
        ctx.strokeStyle = 'rgba(255,90,120,' + (0.55 + bfPulse * 0.35).toFixed(2) + ')';
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        for (var cr = 0; cr < 5; cr++) {
          var ca0 = cr * (M.TAU / 5);
          ctx.beginPath();
          ctx.moveTo(Math.cos(ca0) * (r + 2), Math.sin(ca0) * (r + 2));
          ctx.lineTo(Math.cos(ca0 + 0.20) * (r + 11), Math.sin(ca0 + 0.20) * (r + 11));
          ctx.lineTo(Math.cos(ca0 + 0.06) * bfR, Math.sin(ca0 + 0.06) * bfR);
          ctx.stroke();
        }
        ctx.restore();

        /* 外圈一道很细的暗环 */
        ctx.strokeStyle = 'rgba(30,10,16,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, bfR + 2, 0, M.TAU);
        ctx.stroke();
      }

      /* 色诱术：粉色的柔光环（表示当前非直伤会回血） */
      if (b.status.charmUntil > match.t) {
        var chPulse = 0.5 + 0.5 * Math.sin(match.t * 6);
        var chR = r + 12 + chPulse * 5;
        var chg = ctx.createRadialGradient(b.x, b.y, r, b.x, b.y, chR + 18);
        chg.addColorStop(0, 'rgba(244,114,182,0.10)');
        chg.addColorStop(0.55, 'rgba(244,114,182,0.42)');
        chg.addColorStop(1, 'rgba(244,114,182,0)');
        ctx.fillStyle = chg;
        ctx.beginPath();
        ctx.arc(b.x, b.y, chR + 18, 0, M.TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(251,207,232,' + (0.55 + chPulse * 0.35).toFixed(2) + ')';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = match.t * 30;
        ctx.beginPath();
        ctx.arc(b.x, b.y, chR, 0, M.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* 灼烧 */
      if (b.status.burn) {
        for (var f = 0; f < 3; f++) {
          var ph = (match.t * 3 + f * 0.7) % 1;
          ctx.globalAlpha = 0.5 * (1 - ph);
          ctx.fillStyle = ph < 0.5 ? '#F59E0B' : '#DC2626';
          ctx.beginPath();
          ctx.arc(b.x + Math.sin((match.t * 4 + f) * 3) * r * 0.5,
            b.y - r - 6 - ph * 22, 4.5 * (1 - ph * 0.5), 0, M.TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      /* 血环 */
      var hr = b.hpRatio();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 8, 0, M.TAU);
      ctx.stroke();
      ctx.strokeStyle = hr < SH.CONFIG.lowHpRatio ? '#DC2626' : col.main;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 8, -Math.PI / 2, -Math.PI / 2 + M.TAU * hr);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  };

  Renderer.PAPER = PAPER;
  Renderer.PAPER_DARK = PAPER_DARK;
  SH.Renderer = Renderer;
})();
