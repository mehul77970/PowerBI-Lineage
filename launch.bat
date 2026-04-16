@echo off
setlocal

REM ---- Power BI Lineage launcher ----
REM Builds (if needed) and starts the standalone dashboard app.

cd /d "%~dp0"

if not exist "dist\app.js" (
  echo Building...
  call npm install
  call npm run build
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

node dist\app.js

endlocal
