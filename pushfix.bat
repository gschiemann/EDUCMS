@echo off
cd /d "C:\Users\gschi\OneDrive\Desktop\EDU CMS"
del /f .git\index.lock 2>nul
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "fix: emergency alerts - raw WS handler + 10s polling fallback for life-safety reliability"
"C:\Program Files\Git\bin\git.exe" push origin master
echo.
echo === PUSH COMPLETE ===
pause
