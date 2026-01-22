@echo off
echo Building and Starting DeepAgents2 in Production Mode...
echo.

echo [1/4] Installing Python dependencies...
cd backend
@REM pip install -r backend/requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install Python dependencies!
    pause
    exit /b 1
)
cd ..

echo.
echo [2/4] Installing Node dependencies...
call npm install

echo.
echo [3/4] Building frontend...
call npm run build

if errorlevel 1 (
    echo.
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo [4/4] Starting production server...
echo.
echo ========================================
echo Production Mode - Single Server
echo Application: http://localhost:8000
echo ========================================
echo.

cd backend
python main.py

pause
