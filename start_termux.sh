#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# CryptoScalp AI — Termux Start Script
# No virtualenv (Termux manages its own Python env)
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║   CryptoScalp AI  — Termux       ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════╝${NC}"
echo ""

# Kill any leftover process on port 5001
fuser -k 5001/tcp 2>/dev/null || true

# ── Backend ──────────────────────────────────────────────────
echo -e "${YELLOW}► Starting Flask API (port 5001)...${NC}"
cd "$BACKEND_DIR"
python app.py &
FLASK_PID=$!

# Wait for Flask to be ready
echo -n "  Waiting for API"
for i in {1..15}; do
  sleep 1
  echo -n "."
  curl -s http://localhost:5001/api/health > /dev/null 2>&1 && break
done
echo ""
echo -e "${GREEN}  ✓ Flask running (PID $FLASK_PID)${NC}"

# ── Frontend ─────────────────────────────────────────────────
echo -e "${YELLOW}► Starting Vite frontend (port 5173)...${NC}"
cd "$FRONTEND_DIR"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ CryptoScalp AI is LIVE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}➜  Local:   http://localhost:5173/${NC}"
echo -e "  ${CYAN}➜  Network: http://$(hostname -I | awk '{print $1}'):5173/${NC}"
echo -e "  ${CYAN}➜  API:     http://localhost:5001/api/health${NC}"
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all servers."
echo ""

# Start Vite
npm run dev -- --host 0.0.0.0

# Cleanup
trap "echo 'Stopping...'; kill $FLASK_PID 2>/dev/null; fuser -k 5001/tcp 2>/dev/null" EXIT
