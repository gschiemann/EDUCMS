@echo off
cd /d "%~dp0"
echo ========================================
echo   EDU CMS - Database Reset
echo ========================================
echo.
echo [1/3] Generating Prisma client...
call pnpm run db:generate
echo.
echo [2/3] Pushing schema to database...
call pnpm run db:push
echo.
echo [3/3] Seeding template presets...
call pnpm run db:seed
echo.
echo ========================================
echo   Done! Now restart your dev server:
echo   pnpm run dev
echo ========================================
pause
