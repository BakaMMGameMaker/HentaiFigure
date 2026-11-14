@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut((Join-Path $desktop 'HentaiFigure.lnk')); $s.TargetPath = '%~dp0启动.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0node_modules\electron\dist\electron.exe,0'; $s.Description = 'HentaiFigure · 收藏室'; $s.Save(); Write-Host '桌面快捷方式已创建。'"
pause
