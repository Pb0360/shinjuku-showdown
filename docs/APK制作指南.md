# 怎么把《新宿对决》做成 APK

## 现在的状态：**已经能一键出 apk 了**

```
✅ JDK 21        C:\Android\jdk21          （Android Studio 自带的是 JDK 25，Gradle 8.14 不认，所以另装了一个）
✅ Android SDK   C:\Android\Sdk            （platform-tools + android-36 + build-tools 36.0.0）
✅ Capacitor 工程 新宿对决\android\
✅ 编译脚本      tools\build-apk.ps1
✅ 实测产物      dist\新宿对决-debug.apk   （15.2 MB，包名 com.shinjuku.duel，应用名「新宿对决」）
```

---

## 一键出包（推荐）

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
```

跑完产物在 **`dist\新宿对决-debug.apk`**，传到手机就能装（手机要允许「安装未知来源应用」）。
首次大约 1~2 分钟，之后改完代码再跑只要十几秒。

---

## ⚠️ 为什么要用这个脚本，而不是直接在 android 目录里编译

游戏目录是 `D:\AI工作目录4\新宿对决` —— **含中文**。
Android 的构建链（aapt2 等）在 Windows 上处理非 ASCII 路径会失败，Gradle 直接报：

```
Your project path contains non-ASCII characters.
This will most likely cause the build to fail on Windows.
```

网上常见的做法是加 `android.overridePathCheck=true` 把它糊过去，但**后面 aapt2 那一步照样会炸**，
所以脚本用的是正解：**把 android 工程镜像到纯英文路径去编译，再把 apk 拷回来**。

脚本做的事情：

| 步骤 | 说明 |
|---|---|
| 1 | `android\` → `C:\Android\build\shinjuku\`（镜像，排除 build/.gradle） |
| 2 | `src\` → `...\app\src\main\assets\public\`（把最新游戏代码同步进去） |
| 2b | 带上 `node_modules\@capacitor`（capacitor-android 是用相对路径引的，不带会报 "No variants exist"） |
| 3 | 写 `local.properties`，用 JDK 21 + 指定 SDK 路径编译 |
| 4 | 把 `app-debug.apk` 拷回 `dist\新宿对决-debug.apk` |

> 编译工作区 `C:\Android\build\shinjuku` 会保留，方便排查问题。

---

## 想在 Android Studio 里开发 / 调试

**不要**在 Android Studio 里打开 `D:\AI工作目录4\新宿对决\android`（中文路径，Gradle 会拒绝）。

正确做法：先跑一次上面那个脚本（生成英文工作区），然后
**Android Studio → Open → `C:\Android\build\shinjuku`**。

在那里可以：
- 直接点 ▶ 跑到手机或模拟器上
- Build → Build APK(s)
- Logcat 看报错

改完 `src\` 里的游戏代码后，重新跑一次脚本（或用 `npx cap sync android` 同步到工程）再点运行。

---

## 改完游戏代码之后

`src\` 是唯一的代码来源，安卓工程里的 `assets/public` 只是拷贝。所以每次都要同步：

```powershell
# 最省事：直接重跑编译脚本（它自己会同步 + 编译）
powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1

# 或者分两步
npx cap sync android
# 然后再 Build APK
```

---

## 正式签名版（能上架 / 能长期分发）

debug 版用调试签名，卸载重装、后续升级会有麻烦。正式版要自己的 keystore：

```powershell
& 'C:\Android\jdk21\bin\keytool.exe' -genkey -v -keystore shinjuku.keystore `
   -alias shinjuku -keyalg RSA -keysize 2048 -validity 10000
```

然后编辑 `android\app\build.gradle`，在 `android { }` 里加：

```gradle
signingConfigs {
    release {
        storeFile file("../../shinjuku.keystore")
        storePassword "你设的密码"
        keyAlias "shinjuku"
        keyPassword "你设的密码"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

把脚本里的 `assembleDebug` 改成 `assembleRelease` 再跑一次即可。
产物：`app\build\outputs\apk\release\app-release.apk`

> ⚠️ keystore 和密码务必保存好：以后更新 apk 必须用同一个签名，丢了就没法覆盖安装。

---

## 手动编译（不想用脚本时）

```powershell
$env:JAVA_HOME = 'C:\Android\jdk21'
$env:ANDROID_HOME = 'C:\Android\Sdk'
$env:Path = "C:\Android\jdk21\bin;$env:Path"

# 必须先镜像到英文路径！
robocopy android C:\Android\build\shinjuku /MIR /XD build .gradle
robocopy src C:\Android\build\shinjuku\app\src\main\assets\public /MIR
robocopy node_modules\@capacitor C:\Android\build\node_modules\@capacitor /MIR

cd C:\Android\build\shinjuku
.\gradlew.bat assembleDebug
```

---

## 常见问题

| 现象 | 解决 |
|---|---|
| `Your project path contains non-ASCII characters` | 用 `tools\build-apk.ps1`（镜像到英文路径）；**别**只加 `overridePathCheck`，后面照样炸 |
| `No matching variant of project :capacitor-android` | 忘了带 `node_modules\@capacitor`，脚本的 2b 步就是干这个的 |
| `Could not determine java version` / Gradle 报 Java 版本不支持 | 用 **JDK 21**（`C:\Android\jdk21`），别用 Android Studio 自带的 JDK 25（Gradle 8.14 不认） |
| `SDK location not found` | `android\local.properties` 写 `sdk.dir=C\:\\Android\\Sdk` |
| 手机上没声音 | 移动端要求**先点一下屏幕**才允许出声，点「开始对决」即可解锁 |
| 想强制横屏 | `AndroidManifest.xml` 里给 `<activity>` 加 `android:screenOrientation="sensorLandscape"` |
| 装到手机提示「解析包错误」 | 传输损坏或没编译成功，重新编译并确认文件大小约 15MB |

---

## 不想折腾的话：PWA 也能用

```powershell
npm run web
```
手机浏览器打开终端打印的地址 → 「添加到主屏幕」→ 全屏、离线可玩。
体验和 apk 很接近，区别是不需要签名、不能上架、iOS 上受 Safari 限制。
