@echo off
setlocal
title Nexus Agent Desktop OS
cd /d "%~dp0"

echo =========================================================
echo             Starting Nexus Agent Desktop OS              
echo =========================================================
echo.
echo [1/2] Checking environment and launching backend server...
echo [2/2] Launching native Electron desktop shell...
echo.

node scripts\start-desktop.mjs

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [Nexus] App terminated with exit code %ERRORLEVEL%.
  pause
)
