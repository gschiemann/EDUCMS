@echo off
cd /d "C:\Users\gschi\OneDrive\Desktop\EDU CMS"
del /f .git\index.lock 2>nul
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "fix: EmergencyTriggerModal missing auth token - all admin accounts can now trigger"
"C:\Program Files\Git\bin\git.exe" push origin master
echo.
echo === PUSH COMPLETE ===
pause
