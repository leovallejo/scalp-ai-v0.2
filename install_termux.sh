#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# CryptoScalp AI — Termux Android Installer
# Run this ONCE before start.sh
# ============================================================

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  CryptoScalp AI — Termux Setup${NC}"
echo -e "${CYAN}  ================================${NC}"
echo ""

# ── Step 1: System packages ──────────────────────────────────
echo -e "${YELLOW}[1/5] Updating Termux packages...${NC}"
pkg update -y -q
pkg upgrade -y -q

echo -e "${YELLOW}[2/5] Installing system dependencies...${NC}"
pkg install -y -q \
  python \
  python-pip \
  python-numpy \
  clang \
  libffi \
  openssl \
  nodejs \
  curl

echo -e "${GREEN}  ✓ System packages ready${NC}"

# ── Step 2: Python packages ──────────────────────────────────
echo -e "${YELLOW}[3/5] Installing Python packages (this takes a few minutes)...${NC}"

# Install from Termux's pre-built wheels when possible
pip install --upgrade pip --quiet

# numpy first — Termux already has it as a system pkg, pip should reuse it
pip install --quiet flask flask-cors requests

echo -e "  Installing pandas (may take 2-5 min on first run)..."
# Use pre-built binary if available; fall back to source
pip install --quiet pandas || {
  echo -e "${YELLOW}  Trying pandas with no-build-isolation...${NC}"
  pip install --quiet --no-build-isolation pandas
}

echo -e "  Installing scikit-learn..."
pip install --quiet scikit-learn || {
  echo -e "${YELLOW}  Trying scikit-learn with no-build-isolation...${NC}"
  pip install --quiet --no-build-isolation scikit-learn
}

echo -e "${GREEN}  ✓ Python packages ready${NC}"

# ── Step 3: Node / npm ───────────────────────────────────────
echo -e "${YELLOW}[4/5] Installing Node dependencies...${NC}"
FRONTEND_DIR="$(dirname "$0")/frontend"
cd "$FRONTEND_DIR"
npm install --silent
echo -e "${GREEN}  ✓ Node packages ready${NC}"

# ── Step 4: Verify ───────────────────────────────────────────
echo -e "${YELLOW}[5/5] Verifying installation...${NC}"

python - <<'PYCHECK'
import sys
ok = True
for pkg in ["flask","flask_cors","pandas","numpy","sklearn","requests"]:
    try:
        __import__(pkg)
        print(f"  ✓ {pkg}")
    except ImportError:
        print(f"  ✗ {pkg} MISSING")
        ok = False
if not ok:
    sys.exit(1)
PYCHECK

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete! Now run:${NC}"
echo -e "${CYAN}    ./start_termux.sh${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
