@echo off
cd /d "%~dp0"
del /f ".git\index.lock" 2>nul
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "fix: EmergencyTriggerModal missing auth token - all admin accounts can now trigger"
"C:\Program Files\Git\bin\git.exe" push origin master
echo.
echo === DONE - you can close this window ===
pause
