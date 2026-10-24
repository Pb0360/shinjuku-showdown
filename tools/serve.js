#!/usr/bin/env node
/* ==========================================================================
 * 极简静态服务器：给手机/平板打开游戏用
 * --------------------------------------------------------------------------
 * 用法：
 *   node tools/serve.js            默认 8080 端口
 *   node tools/serve.js --port 9000
 * 然后在同一 WiFi 下的手机浏览器打开终端里打印的地址。
 * 手机浏览器菜单里"添加到主屏幕"就能全屏离线玩（PWA）。
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, '..', 'src');
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? parseInt(args[portArg + 1], 10) || 8080 : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return send(res, 400, 'bad request');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const full = path.normalize(path.join(SRC, urlPath));
  if (!full.startsWith(SRC)) return send(res, 403, 'forbidden');

  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) {
      return send(res, 404, '404 ' + urlPath);
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60'
    });
    fs.createReadStream(full).pipe(res);
  });
});

function lanIps() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const ni of nets[name]) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', function () {
  console.log('新宿对决 · 本地服务器已启动');
  console.log('  本机：  http://localhost:' + PORT + '/');
  for (const ip of lanIps()) console.log('  手机：  http://' + ip + ':' + PORT + '/');
  console.log('');
  console.log('手机与电脑连同一个 WiFi，用上面的"手机"地址打开即可。');
  console.log('iPhone Safari：分享 → 添加到主屏幕；Android Chrome：菜单 → 安装应用。');
  console.log('按 Ctrl+C 停止。');
});
