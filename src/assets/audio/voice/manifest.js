/* 语音清单占位文件
 * 你把自己的语音放进 assets/audio/voice/<角色文件夹>/ 之后，
 * 运行 `node tools/scan_voice.js`，这个文件会被自动重写。
 * 没有语音时它保持为空对象，游戏会安静地跳过语音、只放音效。
 */
(function () {
  var SH = (window.SH = window.SH || {});
  SH.VOICE_MANIFEST = {};
})();
