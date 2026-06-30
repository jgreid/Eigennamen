@echo off

:: Eigennamen Server - Windows Stop Script
:: This script will stop all Docker services

echo.
echo ========================================
echo   Eigennamen Server - Stopping
echo ========================================
echo.

:: Navigate to the repository root (docker-compose.yml lives one level up from server/).
cd /d "%~dp0.."

:: Check if docker-compose.yml exists
if not exist "docker-compose.yml" (
    echo ERROR: docker-compose.yml not found.
    echo Please make sure this script is located in the 'server' folder of the repository.
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
