@echo off
echo ============================================
echo   EDU CMS - Local Development Startup
echo ============================================
echo.

REM Set environment variables
set DATABASE_URL=file:C:/Users/gschi/OneDrive/Desktop/EDU CMS/packages/database/prisma/dev.db
set JWT_SECRET=dev_only_jwt_secret_CHANGE_ME
set SESSION_SECRET=dev_only_session_secret_CHANGE_ME
set REDIS_URL=redis://localhost:6379
set ALLOWED_ORIGINS=http://localhost:3000
set NODE_ENV=development
set PORT=8080
set UPLOAD_DIR=./uploads

echo [1/2] Starting API server on port 8080...
cd /d "C:\Users\gschi\OneDrive\Desktop\EDU CMS\apps\api"
start "EDU CMS API" cmd /c "node dist/main.js"

echo [2/2] Starting Next.js frontend on port 3000...
cd /d "C:\Users\gschi\OneDrive\Desktop\EDU CMS\apps\web"
start "EDU CMS Web" cmd /c "npx next dev"

echo.
echo ============================================
echo   API:      http://localhost:8080
echo   Frontend: http://localhost:3000
echo   Login:    admin@springfield.edu / admin123
echo ============================================
echo.
echo Both servers should now be running in separate windows.
echo Press any key to exit this launcher.
pause >nul
