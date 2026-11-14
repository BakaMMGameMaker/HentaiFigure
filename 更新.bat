@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   HentaiFigure 更新
echo ==========================================
echo.
echo 本地数据在 %%APPDATA%%\HentaiFigure，更新不会动它。
echo.

if exist ".git" (
  echo 正在从 git 远程拉取…
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo git pull 失败。你可以在应用内「设置 - 更新」里重试，或手动下载新版本覆盖程序文件。
    pause
    exit /b 1
  )
) else (
  echo 当前不是 git 仓库，跳过 git 拉取。
  echo 请在应用内「设置 - 更新」配置 GitHub 仓库，或手动下载新版本覆盖程序文件。
)

echo.
echo 正在更新依赖…
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo 依赖安装失败。
  pause
  exit /b 1
)

echo.
echo 正在构建界面…
call npm run build
if errorlevel 1 (
  echo 构建失败。
  pause
  exit /b 1
)

echo.
echo 更新完成。双击「启动.bat」即可打开。
pause
