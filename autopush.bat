@echo off
cd /d "%~dp0"
del /f ".git\index.lock" 2>nul
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "fix: ensure Buffer + explicit memoryStorage for multer"
"C:\Program Files\Git\bin\git.exe" push origin master
echo.
echo === DONE - you can close this window ===
pause
