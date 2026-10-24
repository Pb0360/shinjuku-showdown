/* 固定步长主循环
 * - 逻辑固定 60Hz（dt 恒定），保证可复现、可无头模拟
 * - timeScale 只影响"喂给逻辑的时间"，不影响渲染（慢放特效靠它）
 */
(function () {
  var SH = (window.SH = window.SH || {});

  var FIXED_DT = 1 / 60;
  var MAX_FRAME = 0.25;   // 单帧最多承认 250ms，防止切后台回来瞬移
  var MAX_STEPS = 5;      // 单帧最多推进 5 个逻辑步

  SH.FIXED_DT = FIXED_DT;

  SH.Loop = {
    create: function (opts) {
      var stepFn = opts.step;
      var renderFn = opts.render;
      var timeScaleFn = opts.timeScale || function () { return 1; };
      var acc = 0;
      var last = 0;
      var rafId = 0;
      var running = false;
      var self = {
        fps: 60,
        stepsLastFrame: 0,
        simTime: 0
      };

      function frame(now) {
        if (!running) return;
        rafId = requestAnimationFrame(frame);

        var dtReal = (now - last) / 1000;
        last = now;
        if (!isFinite(dtReal) || dtReal < 0) dtReal = 0;
        if (dtReal > MAX_FRAME) dtReal = MAX_FRAME;

        // 平滑 FPS 显示
        if (dtReal > 0) self.fps += ((1 / dtReal) - self.fps) * 0.08;

        var scaled = dtReal * timeScaleFn();
        acc += scaled;

        var steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS) {
          stepFn(FIXED_DT);
          acc -= FIXED_DT;
          steps++;
          self.simTime += FIXED_DT;
        }
        if (steps >= MAX_STEPS) acc = 0; // 落后太多就丢弃，避免雪崩
        self.stepsLastFrame = steps;

        if (renderFn) renderFn(dtReal, acc / FIXED_DT);
      }

      /* 后台保活：标签页隐藏时 rAF 不再触发，用定时器按真实时间补进度 */
      self.backgroundTick = function () {
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var dtReal = (now - last) / 1000;
        last = now;
        if (!isFinite(dtReal) || dtReal <= 0) return;
        if (dtReal > 0.5) dtReal = 0.5;              // 一次最多补 0.5 秒，避免雪崩
        acc += dtReal * timeScaleFn();
        var steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS) {
          stepFn(FIXED_DT);
          acc -= FIXED_DT;
          steps++;
          self.simTime += FIXED_DT;
        }
        if (steps >= MAX_STEPS) acc = 0;
        /* 后台也把画面渲染一次：有些浏览器仍然允许隐藏页绘制 */
        if (renderFn) renderFn(dtReal, acc / FIXED_DT);
      };

      self.start = function () {
        if (running) return;
        running = true;
        last = performance.now();
        rafId = requestAnimationFrame(frame);
      };
      self.stop = function () {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      };
      self.isRunning = function () { return running; };
      self.resetClock = function () { last = performance.now(); acc = 0; };

      return self;
    }
  };
})();
