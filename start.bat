@echo off
REM =====================================================
REM CryptoScalp AI — Windows Startup Script
REM =====================================================

echo.
echo   CryptoScalp AI — ML Trading Signals
echo ========================================

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

REM --- Backend Setup ---
echo [1/3] Setting up Python backend...
cd /d "%BACKEND%"

if not exist venv (
    echo   Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate
echo   Installing Python dependencies...
pip install -q -r requirements.txt

echo [2/3] Starting Flask API on port 5001...
start "CryptoScalp-Backend" cmd /c "call venv\Scripts\activate && python app.py"

timeout /t 3 /nobreak >nul

REM --- Frontend Setup ---
echo [3/3] Setting up React frontend...
cd /d "%FRONTEND%"

if not exist node_modules (
    echo   Installing Node dependencies...
    npm install
)

echo.
echo ========================================
echo   Local:   http://localhost:5173/
echo   API:     http://localhost:5001/api/health
echo ========================================
echo.

npm run dev

pause
