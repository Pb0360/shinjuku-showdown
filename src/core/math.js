/* 数学与随机工具（纯逻辑，可在 Node 无头环境中运行） */
(function () {
  var SH = (window.SH = window.SH || {});

  var M = {
    TAU: Math.PI * 2,

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    sign: function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },

    dist: function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
    dist2: function (ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy;
    },

    len: function (x, y) { return Math.hypot(x, y); },

    /* 归一化，长度为 0 时返回 (1,0) */
    norm: function (x, y) {
      var l = Math.hypot(x, y);
      if (l < 1e-6) return { x: 1, y: 0 };
      return { x: x / l, y: y / l };
    },

    /* 角度差归一化到 [-PI, PI] */
    angleDiff: function (a, b) {
      var d = (a - b) % M.TAU;
      if (d > Math.PI) d -= M.TAU;
      if (d < -Math.PI) d += M.TAU;
      return d;
    },

    /* 返回区间 [a,b) 的随机数，用给定 rng 函数 */
    rand: function (rng, a, b) { return a + (b - a) * rng(); },
    randInt: function (rng, a, b) { return Math.floor(a + (b - a + 1) * rng()); },
    pick: function (rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; },

    /* 按权重挑选：items = [{weight, ...}] */
    pickWeighted: function (rng, items) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += (items[i].weight || 0);
      var r = rng() * total;
      for (i = 0; i < items.length; i++) {
        r -= (items[i].weight || 0);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },

    /* 可复现随机数（mulberry32）：同一个种子跑出完全一样的一局 */
    mulberry32: function (seed) {
      var a = (seed >>> 0) || 1;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    /* 把秒格式化成 "0:00" 或 "12.3s" */
    fmtTime: function (s) {
      s = Math.max(0, s);
      var m = Math.floor(s / 60), r = s - m * 60;
      return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
    }
  };

  SH.M = M;
})();
