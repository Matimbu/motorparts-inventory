@echo off
title Motorparts Inventory
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org & pause & exit /b)
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
pause
