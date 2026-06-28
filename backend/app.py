"""
CryptoScalp AI — Backend API
Termux/Android optimised — HTTP 500 hardened version
"""

import traceback
import warnings
import threading
import time
from datetime import datetime

warnings.filterwarnings("ignore")

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests as req

app = Flask(__name__)
CORS(app)

# ── Dependency checks ────────────────────────────────────────
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

try:
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
    from sklearn.model_selection import TimeSeriesSplit
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# ── Globals ──────────────────────────────────────────────────
cache_lock   = threading.Lock()
model_cache  = {}
signal_cache = {}

SYMBOLS   = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT"]
INTERVALS = ["1m","3m","5m","15m"]

FEATURE_COLS = [
    "ema_cross","price_vs_ema9","price_vs_ema21",
    "hh5","ll5",
    "rsi","macd_hist","roc5","roc10","close_strength",
    "vol_ratio","vol_change","pressure_ratio",
    "atr_pct","roll_vol10","candle_range",
    "body_size","upper_wick_size","lower_wick_size",
    "wick_body_ratio","bullish_candle",
    "dist_resistance","dist_support","consec_bull"
]


# ── JSON serialiser — converts numpy types to plain Python ───
def safe_json(obj):
    """Recursively convert numpy/pandas types to JSON-safe Python."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [safe_json(v) for v in obj]
    if HAS_NUMPY:
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return None if (np.isnan(obj) or np.isinf(obj)) else float(obj)
        if isinstance(obj, np.ndarray):
            return [safe_json(v) for v in obj.tolist()]
        if isinstance(obj, np.bool_):
            return bool(obj)
    if isinstance(obj, float):
        import math
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int):
        return obj
    return str(obj)   # fallback: timestamp, etc.


def ok(data):
    return jsonify(safe_json(data))


def err(msg, code=500):
    return jsonify({"error": str(msg)}), code


# ── EMA (pure Python / numpy) ────────────────────────────────
def _ema_np(arr, span):
    k = 2.0 / (span + 1)
    out = np.empty(len(arr), dtype=float)
    out[0] = arr[0]
    for i in range(1, len(arr)):
        out[i] = arr[i] * k + out[i-1] * (1 - k)
    return out


# ── Data loading ─────────────────────────────────────────────
def load_data(symbol="BTCUSDT", interval="5m", limit=500):
    try:
        r = req.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            timeout=15
        )
        r.raise_for_status()
        raw = r.json()
        if not isinstance(raw, list) or len(raw) == 0:
            raise ValueError("Empty response")
        df = pd.DataFrame(raw, columns=[
            "timestamp","open","high","low","close","volume",
            "ct","qv","nt","tbb","tbq","ign"
        ])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        for col in ["open","high","low","close","volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df[["timestamp","open","high","low","close","volume"]].copy()
        df.sort_values("timestamp", inplace=True)
        df.reset_index(drop=True, inplace=True)
        return df
    except Exception as e:
        print(f"[Binance] {e} — trying backup")
        return _backup(symbol, limit)


def _backup(symbol, limit):
    fsym = symbol.replace("USDT","")
    try:
        r = req.get(
            "https://min-api.cryptocompare.com/data/v2/histominute",
            params={"fsym": fsym, "tsym": "USDT", "limit": min(limit,2000)},
            timeout=15
        )
        data = r.json().get("Data",{}).get("Data",[])
        df = pd.DataFrame(data)
        df["timestamp"] = pd.to_datetime(df["time"], unit="s")
        df = df.rename(columns={"volumefrom":"volume"})[
            ["timestamp","open","high","low","close","volume"]]
        df.sort_values("timestamp", inplace=True)
        df.reset_index(drop=True, inplace=True)
        return df
    except Exception as e:
        print(f"[Backup] {e}")
        return pd.DataFrame()


def fetch_fear_greed():
    try:
        r = req.get("https://api.alternative.me/fng/?limit=1", timeout=8)
        d = r.json()["data"][0]
        return {"value": int(d["value"]), "label": d["value_classification"]}
    except:
        return {"value": 50, "label": "Neutral"}


def fetch_ticker(symbol):
    try:
        r = req.get(
            f"https://api.binance.com/api/v3/ticker/24hr?symbol={symbol}",
            timeout=8
        )
        d = r.json()
        return {
            "price":      float(d["lastPrice"]),
            "change_pct": float(d["priceChangePercent"]),
            "volume_24h": float(d["quoteVolume"]),
            "high_24h":   float(d["highPrice"]),
            "low_24h":    float(d["lowPrice"])
        }
    except:
        return {}


# ── Feature engineering ──────────────────────────────────────
def add_indicators(df):
    if df is None or df.empty or len(df) < 30:
        return df

    df = df.dropna(subset=["open","high","low","close","volume"])
    df = df.reset_index(drop=True)

    c = df["close"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    o = df["open"].values.astype(float)
    v = df["volume"].values.astype(float)
    n = len(c)

    ema9  = _ema_np(c, 9)
    ema21 = _ema_np(c, 21)

    df["ema9"]           = ema9
    df["ema21"]          = ema21
    df["ema_cross"]      = (ema9 - ema21) / (ema21 + 1e-9)
    df["price_vs_ema9"]  = (c - ema9)  / (ema9  + 1e-9)
    df["price_vs_ema21"] = (c - ema21) / (ema21 + 1e-9)

    # HH / LL 5-period
    hh5 = pd.Series(h).rolling(5, min_periods=1).max().values
    ll5 = pd.Series(l).rolling(5, min_periods=1).min().values
    df["hh5"] = (h == hh5).astype(int)
    df["ll5"] = (l == ll5).astype(int)

    # RSI 14
    delta = np.diff(c, prepend=c[0])
    gain  = np.where(delta > 0, delta, 0.0)
    loss  = np.where(delta < 0, -delta, 0.0)
    ag = pd.Series(gain).rolling(14, min_periods=1).mean().values
    al = pd.Series(loss).rolling(14, min_periods=1).mean().values
    rs = ag / (al + 1e-9)
    df["rsi"] = 100.0 - (100.0 / (1.0 + rs))

    # MACD
    ema12 = _ema_np(c, 12)
    ema26 = _ema_np(c, 26)
    macd  = ema12 - ema26
    df["macd_hist"] = macd - _ema_np(macd, 9)

    # ROC
    df["roc5"]  = pd.Series(c).pct_change(5).fillna(0).values
    df["roc10"] = pd.Series(c).pct_change(10).fillna(0).values

    # Close strength
    rng = h - l
    rng = np.where(rng == 0, 1e-9, rng)
    df["close_strength"] = (c - l) / rng

    # Volume
    vol_ma = pd.Series(v).rolling(20, min_periods=1).mean().values
    df["vol_ma20"]    = vol_ma
    df["vol_ratio"]   = v / (vol_ma + 1e-9)
    df["vol_change"]  = pd.Series(v).pct_change().fillna(0).values
    buy_p  = np.where(c > o, v, 0.0)
    sell_p = np.where(c < o, v, 0.0)
    df["pressure_ratio"] = (buy_p - sell_p) / (v + 1e-9)

    # ATR
    prev_c = np.roll(c, 1); prev_c[0] = c[0]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev_c), np.abs(l - prev_c)))
    atr14 = pd.Series(tr).rolling(14, min_periods=1).mean().values
    df["atr14"]      = atr14
    df["atr_pct"]    = atr14 / (c + 1e-9)
    pct_chg          = pd.Series(np.diff(c, prepend=c[0]) / (c + 1e-9))
    df["roll_vol10"] = pct_chg.rolling(10, min_periods=1).std().fillna(0).values
    df["candle_range"] = (h - l) / (c + 1e-9)

    # Candle structure
    body       = np.abs(c - o)
    hi_body    = np.maximum(c, o)
    lo_body    = np.minimum(c, o)
    upper_wick = h - hi_body
    lower_wick = lo_body - l
    total_rng  = np.where(rng == 0, 1e-9, rng)

    df["body_size"]        = body / (c + 1e-9)
    df["upper_wick_size"]  = upper_wick / total_rng
    df["lower_wick_size"]  = lower_wick / total_rng
    df["wick_body_ratio"]  = (upper_wick + lower_wick) / (body + 1e-9)
    df["bullish_candle"]   = (c > o).astype(int)

    # S/R
    sh = pd.Series(h).rolling(20, min_periods=1).max().values
    sl = pd.Series(l).rolling(20, min_periods=1).min().values
    df["swing_high20"]    = sh
    df["swing_low20"]     = sl
    df["dist_resistance"] = (sh - c) / (c + 1e-9)
    df["dist_support"]    = (c - sl)  / (c + 1e-9)

    # Consecutive candle direction
    cdir = np.sign(c - o).astype(float)
    df["candle_dir"]  = cdir
    df["consec_bull"] = pd.Series(cdir).rolling(3, min_periods=1).sum().values

    # Clip extreme values to prevent sklearn warnings
    for col in FEATURE_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            df[col] = df[col].replace([np.inf, -np.inf], np.nan)

    df.dropna(subset=FEATURE_COLS, inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def create_labels(df, lookahead=1, threshold=0.003):
    df = df.copy()
    c = df["close"].values.astype(float)
    future = np.empty(len(c))
    future[:] = np.nan
    future[:-lookahead] = c[lookahead:] / c[:-lookahead] - 1

    df["future_ret"] = future
    df["label"] = 1  # NO_TRADE default
    df.loc[df["future_ret"] >  threshold, "label"] = 2  # UP
    df.loc[df["future_ret"] < -threshold, "label"] = 0  # DOWN
    df = df.dropna(subset=["future_ret"])
    df = df.iloc[:-lookahead] if lookahead > 0 else df
    df.reset_index(drop=True, inplace=True)
    return df


# ── Training ─────────────────────────────────────────────────
def train_model(df):
    valid = df.dropna(subset=FEATURE_COLS + ["label"])
    if len(valid) < 60:
        raise ValueError(f"Only {len(valid)} valid rows — need at least 60")

    X = valid[FEATURE_COLS].values.astype(float)
    y = valid["label"].values.astype(int)

    # Clip extreme feature values
    X = np.clip(X, -1e6, 1e6)

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    tscv = TimeSeriesSplit(n_splits=5)

    candidates = {
        "LogisticRegression": LogisticRegression(
            max_iter=500, class_weight="balanced", solver="lbfgs"),
        "RandomForest": RandomForestClassifier(
            n_estimators=100, max_depth=6, min_samples_leaf=5,
            class_weight="balanced", random_state=42, n_jobs=1),
        "GradientBoosting": GradientBoostingClassifier(
            n_estimators=60, max_depth=3, learning_rate=0.1, random_state=42),
    }

    results  = {}
    best_f1  = -1
    best_clf = None
    best_name= "RandomForest"

    for name, clf in candidates.items():
        try:
            fold_f1s = []
            for tr_i, va_i in tscv.split(Xs):
                clf.fit(Xs[tr_i], y[tr_i])
                p = clf.predict(Xs[va_i])
                fold_f1s.append(float(f1_score(y[va_i], p, average="macro", zero_division=0)))
            mean_f1 = float(np.mean(fold_f1s))
            clf.fit(Xs, y)
            p_all = clf.predict(Xs)
            results[name] = {
                "cv_f1":     round(mean_f1, 4),
                "accuracy":  round(float(accuracy_score(y, p_all)), 4),
                "precision": round(float(precision_score(y, p_all, average="macro", zero_division=0)), 4),
                "recall":    round(float(recall_score(y, p_all, average="macro", zero_division=0)), 4),
                "f1":        round(float(f1_score(y, p_all, average="macro", zero_division=0)), 4),
                "confusion_matrix": confusion_matrix(y, p_all).tolist(),
            }
            if mean_f1 > best_f1:
                best_f1 = mean_f1; best_clf = clf; best_name = name
        except Exception as e:
            results[name] = {"error": str(e)}

    if best_clf is None:
        raise RuntimeError("All models failed to train")

    # Feature importance
    fi = []
    try:
        if hasattr(best_clf, "feature_importances_"):
            imp = best_clf.feature_importances_
        elif hasattr(best_clf, "coef_"):
            imp = np.abs(best_clf.coef_).mean(axis=0)
        else:
            imp = np.zeros(len(FEATURE_COLS))
        fi = sorted(
            [{"feature": f, "importance": round(float(v), 4)}
             for f, v in zip(FEATURE_COLS, imp)],
            key=lambda x: x["importance"], reverse=True
        )[:10]
    except Exception:
        pass

    label_arr = df["label"].values
    return {
        "model":   best_clf,
        "scaler":  scaler,
        "best_name": best_name,
        "metrics": results,
        "feature_importance": fi,
        "label_dist": {
            "DOWN":     int((label_arr == 0).sum()),
            "NO_TRADE": int((label_arr == 1).sum()),
            "UP":       int((label_arr == 2).sum()),
            "total":    len(label_arr)
        }
    }


# ── Backtest ─────────────────────────────────────────────────
def backtest(df, model, scaler, conf_thr=0.60, sl=0.008, tp=0.016, fee=0.001):
    bt = df.dropna(subset=FEATURE_COLS).reset_index(drop=True)
    if len(bt) < 10:
        return {"error": "Not enough rows for backtest"}

    X     = np.clip(bt[FEATURE_COLS].values.astype(float), -1e6, 1e6)
    Xs    = scaler.transform(X)
    proba = model.predict_proba(Xs)
    preds = model.predict(Xs)
    confs = proba.max(axis=1)

    trades = []
    equity = [1.0]
    cur_eq = 1.0
    peak   = 1.0
    max_dd = 0.0
    wins = losses = 0

    for i in range(len(bt) - 1):
        pred = int(preds[i])
        conf = float(confs[i])
        vol_r = float(bt["vol_ratio"].iloc[i])
        atr_p = float(bt["atr_pct"].iloc[i])

        if conf < conf_thr or vol_r <= 0.8 or not (0.001 < atr_p < 0.05) or pred == 1:
            equity.append(cur_eq)
            continue

        entry    = float(bt["close"].iloc[i])
        nx_hi    = float(bt["high"].iloc[i+1])
        nx_lo    = float(bt["low"].iloc[i+1])
        nx_cl    = float(bt["close"].iloc[i+1])

        if pred == 2:   # LONG
            sl_p = entry*(1-sl); tp_p = entry*(1+tp)
            if nx_lo <= sl_p:   ret = -sl - fee
            elif nx_hi >= tp_p: ret =  tp - fee
            else:               ret = (nx_cl - entry)/entry - fee
        else:           # SHORT
            sl_p = entry*(1+sl); tp_p = entry*(1-tp)
            if nx_hi >= sl_p:   ret = -sl - fee
            elif nx_lo <= tp_p: ret =  tp - fee
            else:               ret = (entry - nx_cl)/entry - fee

        cur_eq *= (1 + ret)
        equity.append(cur_eq)
        peak   = max(peak, cur_eq)
        dd     = (peak - cur_eq) / peak
        max_dd = max(max_dd, dd)
        won    = ret > 0
        if won: wins += 1
        else:   losses += 1
        trades.append({
            "action":     "LONG" if pred==2 else "SHORT",
            "ret":        round(float(ret)*100, 3),
            "won":        bool(won),
            "confidence": round(float(conf), 3)
        })

    total = wins + losses
    if total == 0:
        return {"error": "No qualifying trades found — try looser filters"}

    pos = sum(t["ret"] for t in trades if t["ret"] > 0)
    neg = abs(sum(t["ret"] for t in trades if t["ret"] < 0))
    rets = [t["ret"] for t in trades]

    return {
        "total_trades":     int(total),
        "wins":             int(wins),
        "losses":           int(losses),
        "win_rate":         round(wins/total*100, 2),
        "loss_rate":        round(losses/total*100, 2),
        "avg_return_pct":   round(float(sum(rets)/len(rets)), 3),
        "total_return_pct": round((cur_eq - 1)*100, 2),
        "max_drawdown_pct": round(float(max_dd)*100, 2),
        "profit_factor":    round(pos/(neg+1e-9), 2),
        "equity_curve":     [round(float(e), 5) for e in equity[-200:]],
        "recent_trades":    trades[-20:]
    }


# ── Signal ───────────────────────────────────────────────────
def predict_signal(df, model, scaler):
    feat = df.dropna(subset=FEATURE_COLS)
    if feat.empty:
        return {"signal":"NO_TRADE","action":"NO_TRADE","confidence":0,"reasons":["No indicator data"]}

    row   = feat.iloc[-1]
    X     = np.clip(row[FEATURE_COLS].values.reshape(1,-1).astype(float), -1e6, 1e6)
    Xs    = scaler.transform(X)
    proba = model.predict_proba(Xs)[0]
    pred  = int(model.predict(Xs)[0])
    conf  = float(proba.max())

    signal = {0:"DOWN", 1:"NO_TRADE", 2:"UP"}[pred]
    entry  = float(row["close"])
    rsi    = float(row["rsi"])
    vol_r  = float(row["vol_ratio"])
    atr_p  = float(row["atr_pct"])
    ema_c  = float(row["ema_cross"])
    mh     = float(row["macd_hist"])

    filters = {
        "confidence_ok": bool(conf >= 0.60),
        "volume_ok":     bool(vol_r > 0.8),
        "atr_ok":        bool(0.001 < atr_p < 0.05),
    }
    if signal == "UP":
        filters["not_at_resistance"] = bool(float(row["dist_resistance"]) > 0.003)
    if signal == "DOWN":
        filters["not_at_support"] = bool(float(row["dist_support"]) > 0.003)

    all_pass = all(filters.values())
    if   signal == "UP"   and all_pass: action = "LONG"
    elif signal == "DOWN" and all_pass: action = "SHORT"
    else:                               action = "NO_TRADE"

    SL, TP = 0.008, 0.016
    if action == "LONG":
        stop  = round(entry*(1-SL), 6)
        take  = round(entry*(1+TP), 6)
        inval = round(entry*(1-SL*1.5), 6)
    elif action == "SHORT":
        stop  = round(entry*(1+SL), 6)
        take  = round(entry*(1-TP), 6)
        inval = round(entry*(1+SL*1.5), 6)
    else:
        stop = take = inval = None

    reasons = [
        "EMA9 > EMA21 — bullish bias" if ema_c > 0 else "EMA9 < EMA21 — bearish bias",
        f"RSI {rsi:.1f} — {'overbought caution' if rsi>70 else 'oversold bounce' if rsi<30 else 'neutral'}",
        "MACD hist positive" if mh > 0 else "MACD hist negative",
        f"Vol {vol_r:.2f}x avg — {'confirming' if vol_r>1.2 else 'weak' if vol_r<0.8 else 'average'}",
    ]
    warns = []
    if not filters.get("confidence_ok"): warns.append(f"Confidence {conf:.0%} < 60% threshold")
    if not filters.get("volume_ok"):     warns.append("Volume below average — choppy conditions")
    if not filters.get("atr_ok"):        warns.append("ATR out of healthy range")
    if not filters.get("not_at_resistance", True): warns.append("Near resistance — LONG risk elevated")
    if not filters.get("not_at_support",    True): warns.append("Near support — SHORT risk elevated")
    if not warns: warns = ["Setup passes all filters — manage position size carefully"]

    return {
        "signal":       signal,
        "action":       action,
        "confidence":   round(conf, 4),
        "entry":        entry,
        "stop_loss":    stop,
        "take_profit":  take,
        "invalidation": inval,
        "rr_ratio":     "1:2" if action != "NO_TRADE" else "N/A",
        "reasons":      reasons,
        "risk_warning": warns,
        "filters":      filters,
        "indicators": {
            "rsi":                round(rsi, 2),
            "macd_hist":          round(float(mh), 6),
            "ema_cross":          round(float(ema_c), 6),
            "vol_ratio":          round(float(vol_r), 2),
            "atr_pct":            round(float(atr_p)*100, 4),
            "dist_resistance_pct":round(float(row["dist_resistance"])*100, 2),
            "dist_support_pct":   round(float(row["dist_support"])*100, 2),
        },
        "proba": {
            "DOWN":     round(float(proba[0]), 4),
            "NO_TRADE": round(float(proba[1]), 4),
            "UP":       round(float(proba[2]), 4),
        },
        "timestamp": datetime.utcnow().isoformat()
    }


# ── Full pipeline ─────────────────────────────────────────────
def run_pipeline(symbol, interval):
    if not HAS_PANDAS or not HAS_NUMPY or not HAS_SKLEARN:
        missing = [p for p,h in [("numpy",HAS_NUMPY),("pandas",HAS_PANDAS),("scikit-learn",HAS_SKLEARN)] if not h]
        raise RuntimeError(f"Missing packages: {', '.join(missing)}")

    df_raw = load_data(symbol, interval, limit=500)
    if df_raw is None or df_raw.empty:
        raise RuntimeError(f"Could not fetch data for {symbol} {interval}")

    df_feat = add_indicators(df_raw.copy())
    if df_feat is None or df_feat.empty:
        raise RuntimeError("Feature engineering produced empty dataframe")

    df_label = create_labels(df_feat.copy(), lookahead=1, threshold=0.003)
    if len(df_label) < 60:
        raise RuntimeError(f"Not enough labeled rows ({len(df_label)}), need 60+")

    tr  = train_model(df_label)
    bt  = backtest(df_label, tr["model"], tr["scaler"])
    sig = predict_signal(df_feat, tr["model"], tr["scaler"])
    fg  = fetch_fear_greed()
    tk  = fetch_ticker(symbol)

    result = {
        "symbol":             symbol,
        "interval":           interval,
        "best_model":         tr["best_name"],
        "metrics":            tr["metrics"],
        "feature_importance": tr["feature_importance"],
        "label_distribution": tr["label_dist"],
        "backtest":           bt,
        "signal":             sig,
        "fear_greed":         fg,
        "ticker":             tk,
        "generated_at":       datetime.utcnow().isoformat()
    }

    key = f"{symbol}_{interval}"
    with cache_lock:
        model_cache[key]  = {"model": tr["model"], "scaler": tr["scaler"]}
        signal_cache[key] = result

    return result


# ── Routes ────────────────────────────────────────────────────

@app.errorhandler(Exception)
def handle_exception(e):
    tb = traceback.format_exc()
    print(f"[UNHANDLED] {e}\n{tb}")
    return jsonify({"error": str(e), "traceback": tb}), 500


@app.route("/api/health")
def health():
    return ok({
        "status": "ok" if (HAS_NUMPY and HAS_PANDAS and HAS_SKLEARN) else "degraded",
        "numpy":        HAS_NUMPY,
        "pandas":       HAS_PANDAS,
        "scikit_learn": HAS_SKLEARN,
        "time":         datetime.utcnow().isoformat()
    })


@app.route("/api/symbols")
def symbols():
    return ok({"symbols": SYMBOLS, "intervals": INTERVALS})


@app.route("/api/analyze", methods=["POST"])
def analyze():
    body     = request.get_json(silent=True) or {}
    symbol   = str(body.get("symbol","BTCUSDT")).upper().strip()
    interval = str(body.get("interval","5m")).strip()

    if symbol not in SYMBOLS:
        return err(f"Symbol '{symbol}' not supported. Use: {SYMBOLS}", 400)
    if interval not in INTERVALS:
        return err(f"Interval '{interval}' not supported. Use: {INTERVALS}", 400)
    try:
        result = run_pipeline(symbol, interval)
        return ok(result)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[analyze] {e}\n{tb}")
        return err(f"{e}", 500)


@app.route("/api/signal", methods=["POST"])
def signal_route():
    body     = request.get_json(silent=True) or {}
    symbol   = str(body.get("symbol","BTCUSDT")).upper().strip()
    interval = str(body.get("interval","5m")).strip()
    key      = f"{symbol}_{interval}"

    try:
        with cache_lock:
            cached_model = model_cache.get(key)
            cached_data  = signal_cache.get(key)

        if cached_model:
            df   = load_data(symbol, interval, limit=200)
            df   = add_indicators(df)
            sig  = predict_signal(df, cached_model["model"], cached_model["scaler"])
            data = dict(cached_data or {})
            data["signal"]     = sig
            data["ticker"]     = fetch_ticker(symbol)
            data["fear_greed"] = fetch_fear_greed()
            return ok(data)

        result = run_pipeline(symbol, interval)
        return ok(result)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[signal] {e}\n{tb}")
        return err(str(e), 500)


@app.route("/api/ohlcv", methods=["POST"])
def ohlcv():
    body     = request.get_json(silent=True) or {}
    symbol   = str(body.get("symbol","BTCUSDT")).upper().strip()
    interval = str(body.get("interval","5m")).strip()
    limit    = min(int(body.get("limit",100)), 500)
    try:
        df = load_data(symbol, interval, limit)
        if df is None or df.empty:
            return err("No data fetched", 502)
        records = []
        for _, row in df.tail(100).iterrows():
            records.append({
                "timestamp": str(row["timestamp"]),
                "open":  float(row["open"]),
                "high":  float(row["high"]),
                "low":   float(row["low"]),
                "close": float(row["close"]),
                "volume":float(row["volume"])
            })
        return ok({"data": records, "symbol": symbol, "interval": interval})
    except Exception as e:
        return err(str(e), 500)


@app.route("/api/fear_greed")
def fg_route():
    return ok(fetch_fear_greed())


@app.route("/api/ticker", methods=["POST"])
def ticker_route():
    body   = request.get_json(silent=True) or {}
    symbol = str(body.get("symbol","BTCUSDT")).upper().strip()
    return ok(fetch_ticker(symbol))


@app.route("/api/multi_signal", methods=["POST"])
def multi_signal():
    body     = request.get_json(silent=True) or {}
    interval = str(body.get("interval","5m")).strip()
    syms     = body.get("symbols", ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT"])[:5]
    results  = []
    for sym in syms:
        try:
            df  = load_data(str(sym).upper(), interval, limit=300)
            df  = add_indicators(df)
            dl  = create_labels(df.copy(), 1, 0.003)
            if len(dl) < 60:
                results.append({"symbol":sym,"error":"Not enough data"}); continue
            tr  = train_model(dl)
            sig = predict_signal(df, tr["model"], tr["scaler"])
            tk  = fetch_ticker(str(sym).upper())
            results.append({
                "symbol":     sym,
                "signal":     sig["signal"],
                "action":     sig["action"],
                "confidence": sig["confidence"],
                "price":      tk.get("price",0),
                "change_pct": tk.get("change_pct",0)
            })
        except Exception as e:
            results.append({"symbol":sym,"error":str(e)})
    return ok({"results":results,"interval":interval})


if __name__ == "__main__":
    print()
    print("  CryptoScalp AI — Backend v2")
    print("  ─────────────────────────────")
    print(f"  numpy:        {'OK' if HAS_NUMPY  else 'MISSING  →  pkg install python-numpy'}")
    print(f"  pandas:       {'OK' if HAS_PANDAS else 'MISSING  →  pip install pandas'}")
    print(f"  scikit-learn: {'OK' if HAS_SKLEARN else 'MISSING  →  pip install scikit-learn'}")
    print()
    print("  API  →  http://localhost:5001")
    print("  Health →  http://localhost:5001/api/health")
    print()
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)

# ── Multi-Timeframe Analysis ──────────────────────────────────
TF_WEIGHTS = {"1m": 1.0, "3m": 1.5, "5m": 2.0, "15m": 3.0}

def run_mtf_analysis(symbol):
    if not all([HAS_NUMPY, HAS_PANDAS, HAS_SKLEARN]):
        raise RuntimeError("Missing dependencies")

    tf_results = {}
    vote_score = 0.0
    total_weight = 0.0

    for iv in INTERVALS:
        try:
            df_raw = load_data(symbol, iv, limit=500)
            if df_raw is None or df_raw.empty:
                tf_results[iv] = {"error": "No data"}; continue
            df_feat = add_indicators(df_raw.copy())
            if df_feat is None or df_feat.empty:
                tf_results[iv] = {"error": "Feature error"}; continue
            df_label = create_labels(df_feat.copy(), lookahead=1, threshold=0.003)
            if len(df_label) < 60:
                tf_results[iv] = {"error": f"Only {len(df_label)} rows"}; continue
            tr  = train_model(df_label)
            sig = predict_signal(df_feat, tr["model"], tr["scaler"])
            bt  = backtest(df_label, tr["model"], tr["scaler"])
            w    = TF_WEIGHTS.get(iv, 1.0)
            conf = sig["confidence"]
            vote_val = 1.0 if sig["signal"]=="UP" else (-1.0 if sig["signal"]=="DOWN" else 0.0)
            vote_score   += vote_val * w * conf
            total_weight += w
            tf_results[iv] = {
                "signal": sig["signal"], "action": sig["action"],
                "confidence": sig["confidence"], "entry": sig["entry"],
                "stop_loss": sig["stop_loss"], "take_profit": sig["take_profit"],
                "invalidation": sig["invalidation"],
                "indicators": sig["indicators"], "proba": sig["proba"],
                "reasons": sig["reasons"], "filters": sig["filters"],
                "best_model": tr["best_name"],
                "backtest": {
                    "win_rate": bt.get("win_rate"),
                    "total_trades": bt.get("total_trades"),
                    "profit_factor": bt.get("profit_factor"),
                    "total_return_pct": bt.get("total_return_pct"),
                    "max_drawdown_pct": bt.get("max_drawdown_pct"),
                }
            }
        except Exception as e:
            tf_results[iv] = {"error": str(e)}

    norm_score = vote_score / (total_weight + 1e-9)
    valid = [r for r in tf_results.values() if "signal" in r]
    up_count   = sum(1 for r in valid if r["signal"]=="UP")
    down_count = sum(1 for r in valid if r["signal"]=="DOWN")
    nt_count   = sum(1 for r in valid if r["signal"]=="NO_TRADE")
    total_valid = len(valid)
    alignment  = max(up_count, down_count, nt_count) / (total_valid + 1e-9)

    if norm_score >= 0.25:
        consensus_signal = "UP";   consensus_action = "LONG"
    elif norm_score <= -0.25:
        consensus_signal = "DOWN"; consensus_action = "SHORT"
    else:
        consensus_signal = "NO_TRADE"; consensus_action = "NO_TRADE"

    raw_conf  = abs(norm_score)
    align_bonus = (alignment - 0.5) * 0.2
    mtf_conf  = min(1.0, raw_conf + max(0, align_bonus))

    ref = tf_results.get("5m") or (valid[0] if valid else {})
    entry = ref.get("entry")
    SL_PCT, TP_PCT = 0.008, 0.016
    if consensus_action == "LONG" and entry:
        stop=round(entry*(1-SL_PCT),6); take=round(entry*(1+TP_PCT),6); inval=round(entry*(1-SL_PCT*1.5),6)
    elif consensus_action == "SHORT" and entry:
        stop=round(entry*(1+SL_PCT),6); take=round(entry*(1-TP_PCT),6); inval=round(entry*(1+SL_PCT*1.5),6)
    else:
        stop=take=inval=None

    warns = []
    if alignment < 0.60: warns.append(f"Low TF alignment ({alignment:.0%}) — mixed signals")
    if total_valid < 3:  warns.append(f"Only {total_valid}/4 timeframes available")
    if abs(norm_score) < 0.35: warns.append("Weak consensus — market may be ranging")
    if mtf_conf < 0.55:  warns.append("MTF confidence below 55% — consider NO TRADE")
    if not warns: warns = [f"Strong {alignment:.0%} TF alignment — higher probability setup"]

    reasons = [
        f"Weighted score: {norm_score:+.3f} ({up_count}↑ {down_count}↓ {nt_count}— across {total_valid} TFs)",
        f"TF alignment: {alignment:.0%}",
        "Majority TFs bullish" if up_count > down_count else ("Majority TFs bearish" if down_count > up_count else "TFs split — no clear bias")
    ]

    return {
        "symbol": symbol, "mode": "multi_timeframe",
        "consensus": {
            "signal": consensus_signal, "action": consensus_action,
            "confidence": round(float(mtf_conf), 4),
            "norm_score": round(float(norm_score), 4),
            "alignment":  round(float(alignment), 4),
            "tf_votes": {"up": int(up_count), "down": int(down_count), "no_trade": int(nt_count), "total": int(total_valid)},
            "entry": entry, "stop_loss": stop, "take_profit": take, "invalidation": inval,
            "rr_ratio": "1:2" if consensus_action != "NO_TRADE" else "N/A",
            "reasons": reasons, "risk_warning": warns,
        },
        "timeframes": tf_results,
        "ticker": fetch_ticker(symbol),
        "fear_greed": fetch_fear_greed(),
        "generated_at": datetime.utcnow().isoformat()
    }


@app.route("/api/mtf_analyze", methods=["POST"])
def mtf_analyze():
    body   = request.get_json(silent=True) or {}
    symbol = str(body.get("symbol","BTCUSDT")).upper().strip()
    if symbol not in SYMBOLS:
        return err(f"Symbol '{symbol}' not supported", 400)
    try:
        return ok(run_mtf_analysis(symbol))
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[mtf_analyze] {e}\n{tb}")
        return err(str(e), 500)
