# ==========================================================================
#  一键编译 APK
# --------------------------------------------------------------------------
#  为什么需要这个脚本：
#    游戏目录是「D:\AI工作目录4\新宿对决」——含中文。
#    Android 的构建链（aapt2 等）在 Windows 上处理非 ASCII 路径会失败，
#    Gradle 会直接报 "Your project path contains non-ASCII characters"。
#    所以这里把 android 工程复制到一个纯英文路径去编译，再把 apk 拷回来。
#
#  用法：右键「使用 PowerShell 运行」，或在项目根目录执行
#        powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
# ==========================================================================

$ErrorActionPreference = 'Continue'

# ---- 配置 ----
$root       = Split-Path -Parent $PSScriptRoot          # 项目根目录
$androidSrc = Join-Path $root 'android'
$srcDir     = Join-Path $root 'src'
$work       = 'C:\Android\build\shinjuku'               # 必须纯 ASCII
$jdk        = 'C:\Android\jdk21'
$sdk        = 'C:\Android\Sdk'
$outDir     = Join-Path $root 'dist'

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' 新宿对决 · 编译 APK' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "  项目目录 : $root"
Write-Host "  编译工作区: $work  (英文路径)"
Write-Host ''

if (!(Test-Path $androidSrc)) { Write-Host '[x] 找不到 android 工程，先执行 npx cap add android' -ForegroundColor Red; exit 1 }
if (!(Test-Path "$jdk\bin\java.exe")) { Write-Host "[x] 找不到 JDK：$jdk" -ForegroundColor Red; exit 1 }
if (!(Test-Path "$sdk\platform-tools")) { Write-Host "[x] 找不到 Android SDK：$sdk" -ForegroundColor Red; exit 1 }

# ---- 1. 把 android 工程镜像到英文路径 ----
Write-Host '[1/4] 复制 android 工程到英文路径 ...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $work | Out-Null
# /MIR 镜像；排除 build 产物与 .gradle 缓存（省时间）
robocopy $androidSrc $work /MIR /XD build .gradle /XF local.properties /NFL /NDL /NJH /NJS /NP | Out-Null

# ---- 2. 把最新的游戏代码同步进去 ----
Write-Host '[2/4] 同步游戏代码 (src -> assets/public) ...' -ForegroundColor Yellow
$pub = Join-Path $work 'app\src\main\assets\public'
robocopy $srcDir $pub /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

# ---- 2b. 带上 Capacitor 的原生依赖（capacitor-android 是用相对路径 ../node_modules 引的）----
Write-Host '[2/4] 准备 Capacitor 依赖 ...' -ForegroundColor Yellow
$nmDst = Join-Path (Split-Path -Parent $work) 'node_modules\@capacitor'
robocopy (Join-Path $root 'node_modules\@capacitor') $nmDst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
# ---- 3. 写 local.properties 并编译 ----
Write-Host '[3/4] 编译中（第一次会比较久）...' -ForegroundColor Yellow
Set-Content -Path (Join-Path $work 'local.properties') -Value ('sdk.dir=' + $sdk.Replace('\', '\\')) -Encoding ASCII
# 顺手关掉那个非 ASCII 路径检查（工作区是英文，这里只是双保险）
$gp = Join-Path $work 'gradle.properties'
if (Test-Path $gp) {
  $gpc = Get-Content $gp -Raw
  if ($gpc -notmatch 'overridePathCheck') { Add-Content $gp "`nandroid.overridePathCheck=true" }
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;$env:Path"

Push-Location $work
& .\gradlew.bat assembleDebug --no-daemon
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
  Write-Host ''
  Write-Host "[x] 编译失败（退出码 $code）。上面有 Gradle 的报错信息。" -ForegroundColor Red
  Write-Host "    工作区保留在 $work，可以直接进去重新跑 .\gradlew.bat assembleDebug" -ForegroundColor DarkGray
  exit $code
}

# ---- 4. 把 apk 拷回来 ----
Write-Host ''
Write-Host '[4/4] 收集 APK ...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$apks = Get-ChildItem (Join-Path $work 'app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue
foreach ($a in $apks) {
  $name = if ($a.Name -eq 'app-debug.apk') { '新宿对决-debug.apk' } else { $a.Name }
  Copy-Item $a.FullName (Join-Path $outDir $name) -Force
  Write-Host ("  √ " + (Join-Path $outDir $name) + "  (" + [math]::Round($a.Length / 1MB, 1) + " MB)") -ForegroundColor Green
}
if (!$apks) { Write-Host '  ？没找到 apk，检查一下 build 目录' -ForegroundColor Red }

Write-Host ''
Write-Host '完成。把这个 apk 传到手机就能装（需要允许「未知来源」）。' -ForegroundColor Cyan
Write-Host '注意：debug 版用的是调试签名，能直接玩、能发给朋友；要正式签名版跑 gradlew assembleRelease。' -ForegroundColor DarkGray
