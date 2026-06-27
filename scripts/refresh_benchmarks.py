#!/usr/bin/env python3
"""Re-fetch SPY and QQQ adjusted-close history into public/benchmarks/.

Uses yfinance because the v8 chart endpoint at query{1,2}.finance.yahoo.com
rate-limits anonymous IPs and yfinance handles the cookie/crumb dance.

Run: python3 scripts/refresh_benchmarks.py
"""
from __future__ import annotations
import json
import os
import sys

try:
    import yfinance as yf
except ImportError:
    sys.exit("yfinance is not installed. Run: pip3 install yfinance")

SYMBOLS = [("SPY", "spy"), ("QQQ", "qqq")]
START = "2006-01-01"

def main() -> None:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(here, "public", "benchmarks")
    os.makedirs(out_dir, exist_ok=True)
    for sym, name in SYMBOLS:
        df = yf.download(sym, start=START, auto_adjust=True, progress=False)
        if df is None or len(df) == 0:
            print(f"!! {sym}: no data", file=sys.stderr)
            continue
        rows = []
        for ts, row in df.iterrows():
            close = row["Close"]
            try:
                close = float(close.item())
            except AttributeError:
                close = float(close)
            rows.append([ts.strftime("%Y-%m-%d"), round(close, 4)])
        path = os.path.join(out_dir, f"{name}.json")
        with open(path, "w") as f:
            json.dump(rows, f)
        print(f"{sym}: wrote {len(rows)} rows -> {path}")

if __name__ == "__main__":
    main()
