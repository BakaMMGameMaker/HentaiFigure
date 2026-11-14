@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安装 Node.js 22 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo 首次启动，正在安装依赖，请稍候…
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo 依赖安装失败。请检查网络后重新双击本文件。
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在修复 Electron 运行时…
  call node "scripts\ensure-electron.cjs"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo 正在准备界面…
call npm run build
if errorlevel 1 (
  echo 构建失败。
  pause
  exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0

