@echo off
setlocal enabledelayedexpansion

:: Codenames Server - Windows Startup Script
:: This script will start all Docker services needed to run the game

echo.
echo ========================================
echo   Codenames Server - Starting Up
echo ========================================
echo.

:: Check if Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Docker is not installed or not in PATH.
    echo.
    echo Please install Docker Desktop from:
    echo   https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

:: Check if Docker daemon is running
echo Checking if Docker is running...
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo Docker is not running. Attempting to start Docker Desktop...
    echo.
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

    echo Waiting for Docker to start (this may take a minute^)...

    :: Wait up to 60 seconds for Docker to start
    set /a count=0
    :waitloop
    timeout /t 3 /nobreak >nul
    docker info >nul 2>nul
    if %ERRORLEVEL% equ 0 goto dockerready
    set /a count+=1
    if !count! lss 20 (
        echo   Still waiting... (!count!/20^)
        goto waitloop
    )

    echo.
    echo ERROR: Docker did not start in time.
    echo Please start Docker Desktop manually and try again.
    pause
    exit /b 1
)

:dockerready
echo Docker is running!
echo.

:: Navigate to the script's directory (in case user double-clicked the script)
cd /d "%~dp0"

:: Check if docker-compose.yml exists
if not exist "docker-compose.yml" (
    echo ERROR: docker-compose.yml not found.
    echo Please make sure you're running this script from the 'server' folder.
    pause
    exit /b 1
)

:: Stop any existing containers first (clean start)
echo Stopping any existing containers...
docker compose down >nul 2>nul

:: Build and start the containers
echo.
echo Building and starting services...
echo This may take several minutes on the first run.
echo.

docker compose up -d --build

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Failed to start the services.
    echo.
    echo Common fixes:
    echo   1. Make sure Docker Desktop is fully started
    echo   2. Try running this script as Administrator
    echo   3. Check if ports 3000, 5432, or 6379 are in use
    echo.
    pause
    exit /b 1
)

:: Wait a moment for services to initialize
echo.
echo Waiting for services to initialize...
timeout /t 10 /nobreak >nul

:: Check the status
echo.
echo ========================================
echo   Service Status
echo ========================================
docker compose ps

:: Get the local IP for sharing
echo.
echo ========================================
echo   Access Information
echo ========================================
echo.
echo On this computer:
echo   http://localhost:3000
echo.
echo For other devices on your network, use your IP address:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set ip=%%a
    set ip=!ip:~1!
    echo   http://!ip!:3000
    goto :showip
)
:showip
echo.
echo ========================================
echo.
echo The server is now running!
echo.
echo To stop the server, run: stop-server.bat
echo Or close this window and run: docker compose down
echo.
pause
