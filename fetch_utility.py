#!/usr/bin/env python3
"""
Which electric utility serves each Texas ZIP, and can Base sell there?   Stdlib only.
Run from the project folder:   python fetch_utility.py
(~1,900 lookups against Power to Choose, 8 at a time: ~5-10 min. Progress is cached, so if it stops, just re-run.)

Sources:
  1) Power to Choose (PUCT's official plan search), one call per ZIP:
       plans listed  -> ZIP is in the open (competitive) market; each plan names the wires company (TDU)
       no plans      -> not open to retail choice
     Also captures: number of plans, median & lowest 1,000-kWh price. (Base Power does not list on Power to Choose.)
  2) DOE/NREL "Utility Companies and Rates: Look-up by Zip Code (2024)" (EIA-861)  https://data.openei.org/submissions/8563
       names the co-op / city utility / non-ERCOT utility for ZIPs that are NOT in the open market.
       (It is county-level and doesn't list Oncor/CenterPoint/AEP/TNMP, so it's only used as the fallback name.)
Output: data/tx_zip_utility.csv
  zip, utility, utility_type, market, base_market, grid, open_market_tdus, ptc_plans, ptc_median_1000kwh,
  ptc_lowest_1000kwh, other_utilities_nearby, res_rate
  market = base_tdsp (Oncor / CenterPoint / AEP Texas / TNMP) | competitive (other open-market TDU, e.g. Lubbock)
           | coop | municipal | ioi_non_ercot (Entergy, SWEPCO, Xcel/SPS, El Paso Electric) | other | none
"""
import csv, json, os, re, statistics, time, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw"); OUT = os.path.join(HERE, "data")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}
PTC = "http://api.powertochoose.org/api/PowerToChoose/plans?zip_code=%s"
PTC_CACHE = os.path.join(RAW, "ptc_by_zip.csv")
WORKERS = 8
FILES = {"iou": "https://data.openei.org/files/8563/iou_zipcodes_2024.csv",
         "non_iou": "https://data.openei.org/files/8563/non_iou_zipcodes_2024.csv"}

BASE_TDSP = re.compile(r"ONCOR|CENTERPOINT|AEP TEXAS|TEXAS[- ]NEW MEXICO|TNMP", re.I)
NON_ERCOT_IOU = re.compile(r"ENTERGY|SOUTHWESTERN ELECTRIC POWER|SOUTHWESTERN PUBLIC SERVICE|EL PASO ELECTRIC|XCEL", re.I)
MARKET_RANK = ["municipal", "coop", "ioi_non_ercot", "other"]
PTC_FIELDS = ["zip", "ptc_plans", "open_market_tdus", "ptc_median_1000kwh", "ptc_lowest_1000kwh", "base_plan_listed", "error"]

def is_tx_zip(z):
    return len(z) == 5 and (z[:2] in ("75", "76", "77", "78", "79") or z[:3] in ("885", "733"))

# ---------- DOE / EIA-861 fallback names ----------
def doe_utilities():
    per_zip = defaultdict(dict)
    for kind, url in FILES.items():
        path = os.path.join(RAW, "openei_%s_zipcodes_2024.csv" % kind)
        if not os.path.exists(path):
            print("  downloading", os.path.basename(url))
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(path, "wb") as f:
                f.write(r.read())
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            for r in csv.DictReader(f):
                z = (r.get("zip") or "").strip().zfill(5)
                own = (r.get("ownership") or "").strip()
                if (r.get("state") or "").strip() != "TX" or not is_tx_zip(z) or "marketer" in own.lower():
                    continue
                name = (r.get("utility_name") or "").strip(); o = own.lower()
                m = ("ioi_non_ercot" if NON_ERCOT_IOU.search(name) else "coop" if "coop" in o
                     else "municipal" if ("municipal" in o or "political" in o or "state" in o) else "other")
                per_zip[z][name] = (m, own, (r.get("res_rate") or "").strip())
    return per_zip

# ---------- Power to Choose ----------
def ptc_lookup(z):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(PTC % z, headers=UA), timeout=60) as r:
                j = json.load(r)
            plans = j.get("data") or []
            tdus = sorted({(p.get("company_tdu_name") or "").strip() for p in plans} - {""})
            prices = [p.get("price_kwh1000") for p in plans if isinstance(p.get("price_kwh1000"), (int, float))]
            base = any("BASE POWER" in (p.get("company_name") or "").upper() for p in plans)
            return {"zip": z, "ptc_plans": len(plans), "open_market_tdus": "; ".join(tdus),
                    "ptc_median_1000kwh": round(statistics.median(prices), 2) if prices else "",
                    "ptc_lowest_1000kwh": min(prices) if prices else "", "base_plan_listed": "yes" if base else "no",
                    "error": ""}
        except Exception as e:
            err = str(e); time.sleep(2 * (attempt + 1))
    return {"zip": z, "ptc_plans": "", "open_market_tdus": "", "ptc_median_1000kwh": "", "ptc_lowest_1000kwh": "",
            "base_plan_listed": "", "error": err[:120]}

def ptc_all(zips):
    done = {}
    if os.path.exists(PTC_CACHE):
        with open(PTC_CACHE, encoding="utf-8") as f:
            done = {r["zip"]: r for r in csv.DictReader(f) if not r.get("error")}
    todo = [z for z in zips if z not in done]
    print("  Power to Choose: %d cached, %d to look up" % (len(done), len(todo)))
    new_file = not os.path.exists(PTC_CACHE)
    with open(PTC_CACHE, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PTC_FIELDS)
        if new_file: w.writeheader()
        with ThreadPoolExecutor(WORKERS) as ex:
            futs = [ex.submit(ptc_lookup, z) for z in todo]
            for i, fu in enumerate(as_completed(futs), 1):
                r = fu.result(); w.writerow(r); f.flush()
                if not r["error"]: done[r["zip"]] = r
                if i % 100 == 0 or i == len(todo):
                    print("    %d / %d" % (i, len(todo)))
    errs = len(todo) - sum(1 for z in todo if z in done)
    if errs: print("  %d ZIPs failed - re-run to retry them" % errs)
    return done

def main():
    doe = doe_utilities()
    zips = set(doe)
    prof = os.path.join(OUT, "tx_zip_profile.csv")
    if os.path.exists(prof):
        with open(prof, encoding="utf-8", errors="replace") as f:
            zips |= {r["zip"] for r in csv.DictReader(f)}
    ptc = ptc_all(sorted(zips))

    rows = []
    for z in sorted(zips):
        u = doe.get(z, {}); p = ptc.get(z, {})
        others = sorted(u, key=lambda n: MARKET_RANK.index(u[n][0]) if u[n][0] in MARKET_RANK else 99)
        tdus = [t for t in (p.get("open_market_tdus") or "").split("; ") if t]
        n_plans = int(p["ptc_plans"]) if str(p.get("ptc_plans", "")).isdigit() else None
        if n_plans:                                   # open market
            base_t = [t for t in tdus if BASE_TDSP.search(t)]
            name = (base_t or tdus or ["Open market"])[0]
            market = "base_tdsp" if base_t else "competitive"
            utype = "Wires company (TDU)"
            rate = ""
        elif others:
            name = others[0]; market = u[name][0]; utype = u[name][1]; rate = u[name][2]
        else:
            name, market, utype, rate = "", ("unknown" if n_plans is None else "none"), "", ""
        rows.append({
            "zip": z, "utility": name, "utility_type": utype, "market": market,
            "base_market": "yes" if market == "base_tdsp" else "no",
            "grid": "non-ERCOT" if market == "ioi_non_ercot" else "ERCOT" if market in ("base_tdsp", "competitive") else "",
            "open_market_tdus": "; ".join(tdus), "ptc_plans": p.get("ptc_plans", ""),
            "ptc_median_1000kwh": p.get("ptc_median_1000kwh", ""), "ptc_lowest_1000kwh": p.get("ptc_lowest_1000kwh", ""),
            "other_utilities_nearby": "; ".join(n for n in others if n != name),
            "res_rate": rate,
        })
    with open(os.path.join(OUT, "tx_zip_utility.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print("wrote data/tx_zip_utility.csv (%d ZIPs)" % len(rows))
    print("  by market:", dict(Counter(r["market"] for r in rows)))
    print("  open-market wires companies:", Counter(r["utility"] for r in rows if r["market"] in ("base_tdsp", "competitive")).most_common(8))

if __name__ == "__main__":
    main()
