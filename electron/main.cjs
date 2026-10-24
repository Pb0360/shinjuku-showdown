/* Electron 主进程：把 src/index.html 装进一个原生窗口
 * 目标：双击 exe 就能玩，全屏可选，不用浏览器、不用联网
 */
'use strict';

const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/* --------------------------------------------------------------------------
 * 启动日志：无论成功失败都写一份，出问题时可以直接看
 * 位置：%APPDATA%\ShinjukuDuel\startup.log（一定可写，不会因为程序目录只读而失败）
 * ------------------------------------------------------------------------ */
const SMOKE = !!process.env.SHINJUKU_SMOKE;
const SMOKE_OUT = process.env.SHINJUKU_SMOKE_OUT || path.join(process.cwd(), 'electron-smoke.png');

let LOG_PATH = null;
try { LOG_PATH = path.join(app.getPath('userData'), 'startup.log'); } catch (e) { LOG_PATH = null; }

function log(msg) {
  if (!LOG_PATH) return;
  try { fs.appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + msg + '\r\n'); } catch (e) {}
}

/* 每次启动重写日志头，避免无限增长 */
try {
  if (LOG_PATH) {
    fs.writeFileSync(LOG_PATH,
      '=== 新宿对决 启动日志 ===\r\n' +
      '时间: ' + new Date().toLocaleString() + '\r\n' +
      '程序: ' + process.execPath + '\r\n' +
      'electron=' + process.versions.electron + ' chrome=' + process.versions.chrome + '\r\n' +
      'ELECTRON_RUN_AS_NODE=' + process.env.ELECTRON_RUN_AS_NODE + '\r\n\r\n');
  }
} catch (e) {}

process.on('uncaughtException', function (e) { log('!! uncaughtException: ' + (e && e.stack || e)); });
process.on('unhandledRejection', function (e) { log('!! unhandledRejection: ' + (e && e.stack || e)); });

log('main.cjs 载入完成');

/* 让游戏跑得更稳：关掉不需要的后台节流 */
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win = null;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const work = display.workAreaSize;
  const w = Math.max(960, Math.min(1440, Math.round(work.width * 0.82)));
  const h = Math.max(640, Math.min(960, Math.round(work.height * 0.86)));

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#F2ECE0',
    title: '新宿对决 · SHINJUKU SHOWDOWN',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  /* 窗口一定要出来：正常走 ready-to-show，万一没触发（加载失败/渲染进程卡住）
   * 也在 1.8 秒后强制显示，绝不允许"双击了但什么都没发生" */
  let shown = false;
  function showOnce(why) {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    log('显示窗口（' + why + '）');
    try { win.show(); win.focus(); } catch (e) { log('show 失败: ' + e.message); }
    if (why === 'ready-to-show' && SMOKE) maybeSmokeTest();
  }

  try {
    win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    log('开始加载 ' + path.join(__dirname, '..', 'src', 'index.html'));
  } catch (e) {
    log('!! loadFile 抛异常: ' + e.message);
  }

  setTimeout(function () { showOnce('超时兜底'); }, 1800);
  setTimeout(function () { showOnce('二次兜底'); }, 5000);

  win.webContents.on('did-finish-load', function () { log('页面加载完成'); showOnce('ready-to-show'); });
  win.webContents.on('did-fail-load', function (e, code, desc, url) {
    log('!! 页面加载失败 ' + code + ' ' + desc + ' ' + url);
    showOnce('加载失败兜底');
  });
  win.webContents.on('render-process-gone', function (e, details) {
    log('!! 渲染进程崩溃: ' + JSON.stringify(details));
    showOnce('渲染崩溃兜底');
  });
  win.webContents.on('console-message', function (e, level, message, line, source) {
    if (level >= 2) log('页面 console: ' + message + ' @' + source + ':' + line);
  });

  win.once('ready-to-show', function () { showOnce('ready-to-show'); });

  /* F11 全屏 / Esc 退出全屏（游戏内 Esc 是暂停，这里只在全屏时接管） */
  win.webContents.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

  /* 外链一律用系统浏览器打开 */
  win.webContents.setWindowOpenHandler(function (info) {
    if (/^https?:/.test(info.url)) shell.openExternal(info.url);
    return { action: 'deny' };
  });

  win.on('closed', function () { win = null; });
}

/* 同一时间只跑一个实例 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* --------------------------------------------------------------------------
 * 自检模式：设了环境变量 SHINJUKU_SMOKE=1 时，启动后自动截一张图然后退出。
 * 用来验证打包出来的 exe 真的能跑（npm run verify:exe）。
 * ------------------------------------------------------------------------ */
function maybeSmokeTest() {
  if (!SMOKE) return;
  const out = SMOKE_OUT;
  log('ready-to-show：开始自检');

  /* 让页面先跑起来：切到对战、打几秒、再截图 */
  const script = `
    (function () {
      try {
        var G = window.SH && window.SH.Game;
        if (!G) return 'no-game';
        G.start('gojo', 'sukuna');
        G.loop.stop();
        var dt = 1 / 60;
        G.ais = [null, null];
        var m = G.match;
        m.countdownT = 0; m.phase = 'fight';
        for (var i = 0; i < 60 * 4; i++) {
          if (i % 40 === 0) for (var b = 0; b < 2; b++) for (var s = 0; s < 3; s++) {
            if (m.castSkill(m.balls[b], s)) m.balls[b].skillLock = 0;
          }
          G.step(dt); G.render(dt);
        }
        window.SH.UI.callout({ title: '解', subtitle: '解 / 捌' });
        G.render(dt);
        return 'ok t=' + m.t.toFixed(1) + ' hp=' + Math.round(m.balls[0].hp) + '/' + Math.round(m.balls[1].hp);
      } catch (e) { return 'error: ' + (e && e.message); }
    })();
  `;

  setTimeout(function () {
    win.webContents.executeJavaScript(script).then(function (res) {
      console.log('[自检] 游戏脚本返回：' + res);
      return win.webContents.capturePage();
    }).then(function (img) {
      fs.writeFileSync(out, img.toPNG());
      console.log('[自检] 截图已保存：' + out);
    }).catch(function (e) {
      console.error('[自检] 失败：' + (e && e.message));
      process.exitCode = 1;
    }).then(function () {
      setTimeout(function () { app.quit(); }, 400);
    });
  }, 2500);
}
