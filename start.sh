#!/bin/bash
# ============================================================
# CryptoScalp AI — Startup Script
# Starts Flask backend (port 5001) + Vite frontend (port 5173)
# ============================================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║     CryptoScalp AI — ML Trader        ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
echo ""

# --- Python Backend ---
echo -e "${YELLOW}[1/3] Setting up Python backend...${NC}"
cd "$BACKEND_DIR"

if [ ! -d "venv" ]; then
  echo "  Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
echo "  Installing Python dependencies..."
pip install -q -r requirements.txt

echo -e "${GREEN}  ✓ Backend ready${NC}"

# Start Flask in background
echo -e "${YELLOW}[2/3] Starting Flask API on port 5001...${NC}"
python app.py &
FLASK_PID=$!
echo -e "${GREEN}  ✓ Flask PID: $FLASK_PID${NC}"

sleep 2

# --- Node Frontend ---
echo -e "${YELLOW}[3/3] Setting up React frontend...${NC}"
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  echo "  Installing Node dependencies..."
  npm install
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ CryptoScalp AI is starting!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}➜  Local:   http://localhost:5173/${NC}"
echo -e "  ${CYAN}➜  API:     http://localhost:5001/api/health${NC}"
echo ""

# Start Vite (foreground)
npm run dev

# Cleanup on exit
trap "kill $FLASK_PID 2>/dev/null; echo 'Servers stopped.'" EXIT
