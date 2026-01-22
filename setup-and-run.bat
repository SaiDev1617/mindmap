@echo off
REM Setup and Run Script for AI-Powered Document to Mindmap
REM This script installs dependencies and starts the application
REM Compatible with Windows

echo =========================================
echo AI-Powered Document to Mindmap - Setup
echo =========================================
echo.

REM Get the directory where the script is located
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM Step 1: Check Node.js installation
echo [1/5] Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed. Please install Node.js 16+ from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js %NODE_VERSION% found
echo.

REM Step 2: Check Python installation
echo [2/5] Checking Python installation...
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed. Please install Python 3.9+ from https://python.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
echo [OK] %PYTHON_VERSION% found
echo.

REM Step 3: Install frontend dependencies and build
echo [3/5] Installing frontend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend dependencies
    pause
    exit /b 1
)
echo [OK] Frontend dependencies installed
echo.

echo [3/5] Building frontend...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build frontend
    pause
    exit /b 1
)
echo [OK] Frontend built successfully
echo.

REM Step 4: Install backend dependencies
echo [4/5] Installing backend dependencies...
cd /d "%SCRIPT_DIR%backend"

REM Check if virtual environment exists, create if not
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install requirements
python -m pip install --upgrade pip
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install backend dependencies
    pause
    exit /b 1
)
echo [OK] Backend dependencies installed
echo.

REM Step 5: Check for .env file
echo [5/5] Checking configuration...
if not exist ".env" (
    echo WARNING: No .env file found. Creating template...
    (
        echo # Required: Your OpenAI API Key
        echo OPENAI_API_KEY=your_openai_api_key_here
        echo.
        echo # Optional: Parser selection ^(TRUE for LlamaParse, FALSE for Docling^)
        echo USE_LLAMAPARSE=FALSE
        echo.
        echo # Optional: LlamaParse API key ^(only needed if USE_LLAMAPARSE=TRUE^)
        echo # LLAMA_CLOUD_API_KEY=your_llama_cloud_api_key
        echo.
        echo # Optional: File paths
        echo DATA_FOLDER=data
        echo OUTPUT_MD=output/output.md
        echo OUTPUT_TOC=toc_tree.json
        echo OUTPUT_MINDMAP=mindmap_transformed.json
    ) > .env
    echo WARNING: Please edit backend\.env and add your OPENAI_API_KEY
    echo          Then run this script again to start the server.
    pause
    exit /b 0
)

REM Check if API key is set
findstr /C:"your_openai_api_key_here" .env >nul
if %errorlevel% equ 0 (
    echo WARNING: Please edit backend\.env and add your real OPENAI_API_KEY
    echo          Then run this script again to start the server.
    pause
    exit /b 0
)

echo [OK] Configuration file found
echo.

REM Start the server
echo =========================================
echo Setup complete! Starting server...
echo =========================================
echo.
echo The application will be available at:
echo http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Run the FastAPI server
python main.py

pause
