@echo off
chcp 65001 >nul
rem ==========================================================================
rem  新宿对决 —— 独立窗口启动器（带控制台，方便看日志 / 排查问题）
rem  双击即可：用 Electron 打开原生窗口运行游戏，不经过浏览器。
rem ==========================================================================
setlocal
cd /d "%~dp0"

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo.
  echo [x] 找不到 Electron 运行时：
  echo     %ELECTRON%
  echo.
  echo     请先在本目录执行：  npm install
  echo     或者直接双击 dist 里的「新宿对决-免安装-*.exe」，
  echo     那是打包好的独立程序，不需要 Node / Electron 环境。
  echo.
  pause
  exit /b 1
)

rem Electron 在部分受限环境里会退化成纯 Node，这里主动清掉
set ELECTRON_RUN_AS_NODE=

echo 正在启动 新宿对决 ...
"%ELECTRON%" "%~dp0."
if errorlevel 1 (
  echo.
  echo [x] 启动失败，退出码 %errorlevel%
  pause
)
endlocal
