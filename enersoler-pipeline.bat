@echo off
REM Enersoler Dashboard — 5-minute data pipeline
REM Run via Windows Task Scheduler every 5 min, 06:00-18:00 Tahiti

setlocal
set "WORKDIR=C:\Users\User\.openclaw\workspace\netrun"
set "SSH_KEY=%USERPROFILE%\.ssh\netrun_github_deploy"
set "GIT_SSH_COMMAND=ssh -i "%SSH_KEY%" -o StrictHostKeyChecking=accept-new -p 443"

cd /d "%WORKDIR%\dashboard"

echo [%date% %time%] Enersoler pipeline start

node extract.js
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: extract.js failed
    exit /b 1
)

node build.js
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: build.js failed
    exit /b 1
)

REM Copy outputs to docs/
copy /Y dashboard.html "..\docs\dashboard.html" >nul
copy /Y paea.html "..\docs\paea.html" >nul
copy /Y temana.html "..\docs\temana.html" >nul

cd /d "%WORKDIR%"

git add dashboard/isolar-data.json dashboard/isolar-tokens.json
git add dashboard/history.json dashboard/history-daily.json dashboard/history-monthly.json
git add dashboard/daily-baseline.json
git add dashboard/dashboard.html dashboard/paea.html dashboard/temana.html
git add docs/dashboard.html docs/paea.html docs/temana.html docs/index.html

git diff --staged --quiet
if %ERRORLEVEL% NEQ 0 (
    git commit -m "data refresh"
    git push
    echo [%date% %time%] Pushed to GitHub
) else (
    echo [%date% %time%] No changes
)

echo [%date% %time%] Done
