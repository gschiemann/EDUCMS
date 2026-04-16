@echo off
cd /d "%~dp0"
del /f ".git\index.lock" 2>nul
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "fix: aggressive anti-frame-busting - intercept location.href/replace/assign, hide frameElement"
"C:\Program Files\Git\bin\git.exe" push origin master
echo.
echo === DONE - you can close this window ===
pause
