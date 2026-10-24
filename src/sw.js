/* Service Worker：让手机可以"添加到主屏幕"后离线玩
 * 策略：安装时预缓存核心文件，运行时对同源 GET 走"缓存优先 + 后台更新"
 */
'use strict';

const CACHE = 'shinjuku-v1';

const CORE = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.webmanifest',
  './data/characters.js',
  './core/math.js',
  './core/loop.js',
  './core/audio.js',
  './core/fx.js',
  './game/ball.js',
  './game/projectile.js',
  './game/field.js',
  './game/skills/gojo.js',
  './game/skills/sukuna.js',
  './game/ai.js',
  './game/match.js',
  './render/renderer.js',
  './ui/ui.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 单个文件失败不要拖垮整个安装 */
      return Promise.all(CORE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
