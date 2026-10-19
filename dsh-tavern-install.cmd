@echo off
rem DSH Tavern: double-click to install into the official DeepSeek Harness desktop.
rem Runs the same one-line PowerShell installer as the README. Percent signs are doubled for cmd.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.ps1')); Invoke-Expression $tavernInstaller"
echo.
pause
