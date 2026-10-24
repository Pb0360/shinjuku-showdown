#!/usr/bin/env node
/* ==========================================================================
 * 语音清单扫描器
 * --------------------------------------------------------------------------
 * 把你裁好的语音丢进 src/assets/audio/voice/<角色文件夹>/，然后运行：
 *     node tools/scan_voice.js
 * 它会：
 *   1) 扫描所有音频文件，生成 src/assets/audio/voice/manifest.js
 *      （游戏会优先读这个清单，所以文件名不必是我预留的 _1/_2 格式）
 *   2) 打印一张"哪些语音键已有 / 缺失"的对照表
 *
 * 文件名规则（两种都支持）：
 *   A. 带序号：苍_1.mp3、苍_2.mp3      ← 同名多条 → 每次随机播一条
 *   B. 任意名：五条悟_苍.mp3、赫(2).mp3 ← 会被归到"苍"这个键下
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const VOICE_DIR = path.join(SRC, 'assets', 'audio', 'voice');
const EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

/* 角色需要的语音键（从 characters.js 里读，保证和游戏一致） */
function loadKeys() {
  const code = fs.readFileSync(path.join(SRC, 'data', 'characters.js'), 'utf8');
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  require('vm').runInNewContext(code, sandbox, { filename: 'characters.js' });
  const chars = sandbox.window.SH.CHARACTERS;

  const map = {};
  for (const id in chars) {
    const ch = chars[id];
    const keys = [];
    ch.skills.forEach(function (sk) {
      keys.push(sk.voiceKey);
      if (sk.modes) sk.modes.forEach(function (mo) { if (mo.voiceKey) keys.push(mo.voiceKey); });
      if (sk.purple && sk.purple.voiceKey) keys.push(sk.purple.voiceKey);
    });
    keys.push('黑闪', '受击', '胜利', '失败');
    map[ch.voiceDir || id] = keys;
  }
  return map;
}

function baseName(file) {
  let n = file.replace(/\.[^.]+$/, '');
  /* 去掉结尾的 _1 / -2 / 3 之类的序号 */
  const stripped = n.replace(/[_\-\s]*\d+$/, '');
  return (stripped || n).trim();
}

function main() {
  const keysByChar = loadKeys();
  const result = {};
  const problems = [];

  if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

  const dirs = fs.readdirSync(VOICE_DIR, { withFileTypes: true })
    .filter(function (d) { return d.isDirectory(); })
    .map(function (d) { return d.name; });

  if (!dirs.length) {
    console.log('src/assets/audio/voice/ 下还没有任何角色文件夹。');
    console.log('请新建文件夹（名字必须是这些之一）：' + Object.keys(keysByChar).join('、'));
    return;
  }

  for (const dir of dirs) {
    const full = path.join(VOICE_DIR, dir);
    const files = fs.readdirSync(full).filter(function (f) {
      return EXTS.indexOf(path.extname(f).toLowerCase()) >= 0;
    });
    const bucket = {};
    for (const f of files) {
      const key = baseName(f);
      (bucket[key] = bucket[key] || []).push(f);
    }
    for (const k in bucket) {
      bucket[k].sort(function (a, b) {
        const na = parseInt((a.match(/(\d+)(?=\.[^.]+$)/) || [0, 0])[1], 10);
        const nb = parseInt((b.match(/(\d+)(?=\.[^.]+$)/) || [0, 0])[1], 10);
        return na - nb;
      });
    }
    result[dir] = bucket;
    if (!keysByChar[dir]) problems.push('文件夹「' + dir + '」不是已知角色文件夹，游戏不会读取');
  }

  /* 写清单 */
  const manifestPath = path.join(VOICE_DIR, 'manifest.js');
  const lines = [];
  lines.push('/* 由 tools/scan_voice.js 自动生成，不要手改（改了会被下次扫描覆盖） */');
  lines.push('(function () {');
  lines.push('  var SH = (window.SH = window.SH || {});');
  lines.push('  SH.VOICE_MANIFEST = ' + JSON.stringify(result, null, 2) + ';');
  lines.push('})();');
  fs.writeFileSync(manifestPath, lines.join('\n') + '\n', 'utf8');

  /* 报告 */
  console.log('=== 语音清单 ===');
  for (const dir in result) {
    const need = keysByChar[dir] || [];
    const have = result[dir];
    const known = Object.keys(have).filter(function (k) { return need.indexOf(k) >= 0; });
    const unknown = Object.keys(have).filter(function (k) { return need.indexOf(k) < 0; });
    let count = 0;
    for (const k in have) count += have[k].length;

    console.log('');
    console.log('[' + dir + '] 共 ' + count + ' 个文件，命中 ' + known.length + '/' + need.length + ' 个语音键');

    const miss = need.filter(function (k) { return !have[k]; });
    if (known.length) {
      console.log('  已有：' + known.map(function (k) { return k + '(' + have[k].length + ')'; }).join('  '));
    }
    if (miss.length) console.log('  缺失：' + miss.join('  '));
    if (unknown.length) {
      console.log('  名字对不上的（不会播放，请改名）：' + unknown.map(function (k) {
        return k + '[' + have[k].length + ']';
      }).join('  '));
    }
  }
  if (problems.length) {
    console.log('');
    problems.forEach(function (p) { console.log('⚠ ' + p); });
  }
  console.log('');
  console.log('清单已写入：' + manifestPath);
  console.log('记得在 src/index.html 里加载它：<script src="assets/audio/voice/manifest.js"></script>');
}

main();
