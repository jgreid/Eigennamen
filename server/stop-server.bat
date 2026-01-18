@echo off

:: Codenames Server - Windows Stop Script
:: This script will stop all Docker services

echo.
echo ========================================
echo   Codenames Server - Stopping
echo ========================================
echo.

:: Navigate to the script's directory
cd /d "%~dp0"

:: Check if docker-compose.yml exists
if not exist "docker-compose.yml" (
    echo ERROR: docker-compose.yml not found.
    echo Please make sure you're running this script from the 'server' folder.
    pause
    exit /b 1
)

echo Stopping all services...
docker compose down

if %ERRORLEVEL% equ 0 (
    echo.
    echo Server stopped successfully!
) else (
    echo.
    echo Note: If you see errors above, the server may already be stopped.
)

echo.
pause
