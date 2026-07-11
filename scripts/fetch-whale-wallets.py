#!/usr/bin/env python3
"""
Fetch top profitable Solana whale wallets from gmgn.ai
gmgn.ai has a public API endpoint for smart money / top traders
"""
import requests
import json
import time

def fetch_gmgn_smart_money():
    """Fetch smart money wallets from gmgn.ai"""
    url = "https://gmgn.ai/defai/quotation/v1/rank/sol/swaps"
    params = {
        "orderby": "total_profit",
        "order": "desc",
        "limit": 100,
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    
    wallets = []
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            rows = data.get("data", {}).get("rows", [])
            print(f"Got {len(rows)} wallets from gmgn.ai")
            for row in rows:
                addr = row.get("address", "")
                if addr:
                    wallets.append({
                        "address": addr,
                        "pnl": row.get("total_profit", 0),
                        "win_rate": row.get("win_rate", 0),
                        "label": f"gmgn PnL ${row.get('total_profit', 0):.0f}"
                    })
        else:
            print(f"Response: {resp.text[:500]}")
    except Exception as e:
        print(f"Error: {e}")
    
    return wallets

def fetch_gmgn_pumpfun_snipers():
    """Fetch top pump.fun snipers"""
    url = "https://gmgn.ai/defai/quotation/v1/rank/sol/swaps"
    params = {
        "orderby": "profit",
        "order": "desc", 
        "limit": 100,
        "filter": "pumpfun",
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    
    wallets = []
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            rows = data.get("data", {}).get("rows", [])
            print(f"Got {len(rows)} pump.fun snipers from gmgn.ai")
            for row in rows:
                addr = row.get("address", "")
                if addr:
                    wallets.append({
                        "address": addr,
                        "pnl": row.get("profit", 0),
                        "win_rate": row.get("win_rate", 0),
                        "label": f"pumpfun PnL ${row.get('profit', 0):.0f}"
                    })
        else:
            print(f"Response: {resp.text[:500]}")
    except Exception as e:
        print(f"Error: {e}")
    
    return wallets

# Run
print("=" * 60)
print("Fetching gmgn.ai smart money wallets...")
print("=" * 60)

all_wallets = []

# Fetch smart money
print("\n--- Smart Money ---")
sm = fetch_gmgn_smart_money()
all_wallets.extend(sm)

time.sleep(2)

# Fetch pumpfun snipers  
print("\n--- Pump.fun Snipers ---")
pf = fetch_gmgn_pumpfun_snipers()
all_wallets.extend(pf)

# Dedupe by address
seen = set()
unique = []
for w in all_wallets:
    if w["address"] not in seen:
        seen.add(w["address"])
        unique.append(w)

print(f"\n{'=' * 60}")
print(f"Total unique wallets: {len(unique)}")
print(f"{'=' * 60}")

# Save to file
with open("whale-wallets-gmgn.json", "w") as f:
    json.dump(unique, f, indent=2)

# Also save plain addresses
with open("whale-wallets-gmgn.txt", "w") as f:
    for w in unique:
        f.write(f'{w["address"]}\n')

print(f"\nSaved to whale-wallets-gmgn.json and whale-wallets-gmgn.txt")
print(f"\nTop 10:")
for i, w in enumerate(unique[:10], 1):
    print(f"  {i}. {w['address'][:20]}... {w['label']}")
