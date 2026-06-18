@echo off
:: Change directory to the project folder
cd /d "c:\Users\Kiran\linkedin-commenter"

echo ======================================================
echo    LinkedIn Commenter Agent — Automated pipeline
echo ======================================================
echo.

:: Execute Phase 1 of the orchestrator pipeline (scanner only)
node src/run.js --scrape-only

echo.
echo ======================================================
echo    Execution Complete. Press any key to exit.
echo ======================================================
pause
