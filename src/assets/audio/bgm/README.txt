自备背景音乐放这里
==================

放一个音乐文件进来，游戏就会用它当背景音乐（菜单和对战都用这一首，循环播放）。

命名必须和 src/data/characters.js 里的这一行一致：

    audio: {
      userBgm: 'RainieLove',     ← 这里写什么名字，文件就叫什么名字
      ...
    }

支持的扩展名（游戏会按这个顺序找，找到哪个用哪个）：
    .mp3  .m4a  .mp4  .ogg  .wav  .aac

也就是说下面任何一个都能被认出来：
    RainieLove.mp3
    RainieLove.m4a
    RainieLove.mp4
    RainieLove.ogg

找不到文件怎么办？
    自动回退到内置的合成 BGM（assets/audio/sfx/bgm_menu.wav / bgm_battle.wav），
    不会报错、不会静音崩溃。

想换歌：
    1) 把新文件放进这个文件夹
    2) 改 characters.js 里的 userBgm 名字
    （或者直接把文件改名成现在的名字，覆盖掉旧的）

想改音量：
    游戏里「设置 → 背景音乐」可以直接拖。注意这是背景音乐音量，
    和「音效音量 / 语音音量」是分开的三条。

关于当前这个文件：
    RainieLove.mp4  —— 原始文件其实是一个 MP4 容器（H.264 视频 + 音轨），
    只是扩展名被写成了 .mp3。因为手机浏览器（尤其是 iOS）会按扩展名判断
    MIME 类型，扩展名和容器对不上时可能直接不播，所以这里改成了 .mp4。
    <audio> 元素播放 MP4 时只会取音轨，不会画视频。
