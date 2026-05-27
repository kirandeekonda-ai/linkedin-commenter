@echo off
:: Change directory to the project folder
cd /d "c:\Users\Kiran\linkedin-commenter"

echo ======================================================
echo    LinkedIn Commenter Agent — Automated pipeline
echo ======================================================
echo.

:: Execute the full orchestrator pipeline (scanner + comment generator)
node src/run.js

echo.
echo ======================================================
echo    Execution Complete. Press any key to exit.
echo ======================================================
pause
