@echo off

:: Eigennamen Server - Status Check Script
:: Shows the status of all Docker services

echo.
echo ========================================
echo   Eigennamen Server - Status
echo ========================================
echo.

:: Navigate to the repository root (docker compose must run where docker-compose.yml lives).
cd /d "%~dp0.."

:: Check if Docker is running
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Docker is not running.
    echo Please start Docker Desktop first.
    echo.
    pause
    exit /b 1
)

:: Show container status
echo Service Status:
echo.
docker compose ps

echo.
echo ----------------------------------------
echo.

:: Check if the API is responding
echo Checking if the game is accessible...
curl -s -o nul -w "API Health: %%{http_code}" http://localhost:3000/health 2>nul
if %ERRORLEVEL% neq 0 (
    echo API Health: Not responding (curl not available or server down)
)

echo.
echo.
pause
