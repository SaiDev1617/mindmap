#!/bin/bash

# Setup and Run Script for AI-Powered Document to Mindmap
# This script installs dependencies and starts the application
# Compatible with macOS and Linux

set -e  # Exit on error

echo "========================================="
echo "AI-Powered Document to Mindmap - Setup"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Step 1: Check Node.js installation
echo -e "${BLUE}[1/5] Checking Node.js installation...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js is not installed. Please install Node.js 16+ from https://nodejs.org/${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version) found${NC}"
echo ""

# Step 2: Check Python installation
echo -e "${BLUE}[2/5] Checking Python installation...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}Python 3 is not installed. Please install Python 3.9+ from https://python.org/${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python $(python3 --version) found${NC}"
echo ""

# Step 3: Install frontend dependencies and build
echo -e "${BLUE}[3/5] Installing frontend dependencies...${NC}"
cd "$SCRIPT_DIR"
npm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
echo ""

echo -e "${BLUE}[3/5] Building frontend...${NC}"
npm run build
echo -e "${GREEN}✓ Frontend built successfully${NC}"
echo ""

# Step 4: Install backend dependencies
echo -e "${BLUE}[4/5] Installing backend dependencies...${NC}"
cd "$SCRIPT_DIR/backend"

# Check if virtual environment exists, create if not
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install requirements
pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✓ Backend dependencies installed${NC}"
echo ""

# Step 5: Check for .env file
echo -e "${BLUE}[5/5] Checking configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ No .env file found. Creating template...${NC}"
    cat > .env << 'EOF'
# Required: Your OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Parser selection (TRUE for LlamaParse, FALSE for Docling)
USE_LLAMAPARSE=FALSE

# Optional: LlamaParse API key (only needed if USE_LLAMAPARSE=TRUE)
# LLAMA_CLOUD_API_KEY=your_llama_cloud_api_key

# Optional: File paths
DATA_FOLDER=data
OUTPUT_MD=output/output.md
OUTPUT_TOC=toc_tree.json
OUTPUT_MINDMAP=mindmap_transformed.json
EOF
    echo -e "${YELLOW}⚠ Please edit backend/.env and add your OPENAI_API_KEY${NC}"
    echo -e "${YELLOW}  Then run this script again to start the server.${NC}"
    exit 0
fi

# Check if API key is set
if grep -q "your_openai_api_key_here" .env; then
    echo -e "${YELLOW}⚠ Please edit backend/.env and add your real OPENAI_API_KEY${NC}"
    echo -e "${YELLOW}  Then run this script again to start the server.${NC}"
    exit 0
fi

echo -e "${GREEN}✓ Configuration file found${NC}"
echo ""

# Start the server
echo "========================================="
echo -e "${GREEN}Setup complete! Starting server...${NC}"
echo "========================================="
echo ""
echo -e "${BLUE}The application will be available at:${NC}"
echo -e "${GREEN}http://localhost:8000${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Run the FastAPI server
python main.py
