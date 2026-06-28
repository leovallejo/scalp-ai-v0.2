# CryptoScalp AI — ML-Powered Crypto Scalping System

A professional crypto scalp trading prediction system with machine-learning signal
generation, live Binance data, and a dark-themed React dashboard.

---

## Architecture

```
crypto-scalp-trader/
├── backend/
│   ├── app.py              # Flask API + ML pipeline
│   └── requirements.txt    # Python deps
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main React UI
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── start.sh                # Linux/macOS startup
├── start.bat               # Windows startup
└── README.md
```

---

## Quick Start

### Requirements
- Python 3.9+ with pip
- Node.js 18+ with npm

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
```

### Windows
```cmd
start.bat
```

### Manual (two terminals)

**Terminal 1 — Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

---

## Features

### Data Sources
| Source          | Purpose              | Auth Required |
|-----------------|----------------------|---------------|
| Binance Public  | Live OHLCV data      | No            |
| CryptoCompare   | Backup OHLCV data    | No            |
| alternative.me  | Fear & Greed Index   | No            |
| Binance 24hr    | Ticker / price data  | No            |

### ML Models
- **Logistic Regression** — baseline classifier
- **Random Forest** — primary model (200 trees)
- **Gradient Boosting** — ensemble option
- **Time-series CV** — 5-fold walk-forward validation

### Feature Engineering (24 features)
- Trend: EMA9, EMA21, EMA cross, HH/LL
- Momentum: RSI(14), MACD histogram, ROC
- Volume: Volume ratio, buy/sell pressure
- Volatility: ATR%, rolling volatility, candle range
- Candle structure: body, wicks, direction
- S/R: swing high/low distance

### Signal Output
```json
{
  "signal":     "UP",
  "action":     "LONG",
  "confidence": 0.73,
  "entry":      65420.5,
  "stop_loss":  64896.0,
  "take_profit": 66469.0,
  "rr_ratio":   "1:2",
  "reasons":    ["EMA9 > EMA21 (bullish trend)", "..."],
  "risk_warning": ["..."]
}
```

### Backtest Metrics
- Win rate / loss rate
- Average return per trade
- Total return %
- Max drawdown %
- Profit factor
- Equity curve chart

---

## API Endpoints

| Method | Path               | Description                    |
|--------|--------------------|--------------------------------|
| GET    | /api/health        | Health check                   |
| GET    | /api/symbols       | Supported symbols & intervals  |
| POST   | /api/analyze       | Full ML pipeline + backtest    |
| POST   | /api/signal        | Quick signal (cached model)    |
| POST   | /api/ohlcv         | Raw OHLCV data                 |
| GET    | /api/fear_greed    | Fear & Greed Index             |
| POST   | /api/ticker        | 24h ticker for symbol          |
| POST   | /api/multi_signal  | Scan multiple symbols          |

### Example: Full Analysis
```bash
curl -X POST http://localhost:5001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTCUSDT", "interval": "5m"}'
```

---

## Risk Management Rules

Trades are only signaled when ALL conditions pass:
- ✓ Model confidence ≥ 60%
- ✓ Volume above 80% of 20-period average
- ✓ ATR% between 0.1% and 5% (healthy volatility)
- ✓ Price not within 0.3% of major resistance (LONG)
- ✓ Price not within 0.3% of major support (SHORT)

Stop Loss: 0.8% | Take Profit: 1.6% | R:R = 1:2

---

## Supported Symbols & Timeframes

**Symbols:** BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT

**Timeframes:** 1m, 3m, 5m, 15m

---

## Risk Disclaimer

> This software is for **educational and research purposes only**.
> 
> - Crypto markets are highly volatile and unpredictable.
> - Past backtest results do not guarantee future performance.
> - Fees, slippage, and execution delays are not fully modeled.
> - Always paper trade before using real capital.
> - Never invest more than you can afford to lose.
> - This is not financial advice.

---

## License
MIT — Use at your own risk.
