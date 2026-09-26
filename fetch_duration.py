#!/usr/bin/env python3
"""
How LONG do outages last in each Texas county?   Stdlib only, no downloads.
Run from the project folder after fetch_data.py:   python fetch_duration.py      (~2-4 min)

Reads the cached EAGLE-I Texas files (data/raw/eaglei_tx_YEAR.csv, 15-minute snapshots of customers out per county).
The same cleaning as fetch_data.py is applied (duplicate snapshots merged, "stuck" readings >72 h dropped).

Two measures per county:
  1) avg_outage_hours   Estimated average outage length per affected customer (like the utility metric CAIDI):
                        customer-hours out  /  customers newly knocked out (sum of rises between snapshots).
                        Missing snapshots count as 0 customers out (EAGLE-I only records non-zero counts).
  2) Restoration after MAJOR outages (5%+ of the county's customers out at once, minimum 500):
                        hours from the peak until fewer than 10% of the peak are still out.
                        median, 90th percentile and the longest (with its date) are reported.
Output: data/tx_county_duration.csv
"""
import csv, os, statistics
from collections import defaultdict
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data"); RAW = os.path.join(DATA, "raw")
YEARS = range(2018, 2026)
STUCK_HOURS = 72
GAP = timedelta(minutes=20)          # a missing snapshot longer than this means "0 out" in between
MAJOR_PCT, MAJOR_MIN = 0.05, 500   # 'major' = 5%+ of the county's customers out at once (min 500), so small and large counties compare fairly
RESTORED_FRACTION = 0.10

def parse_ts(s):
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%m/%d/%y %H:%M", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M"):
        try: return datetime.strptime(s, fmt)
        except ValueError: pass
    return None

def load_customers():
    cust = {}
    p = os.path.join(DATA, "tx_county_outage_summary.csv")
    with open(p, encoding="utf-8") as f:
        for r in csv.DictReader(f): cust[r["county_fips"]] = float(r["customers"] or 0)
    return cust

def clean_series(pts):
    """pts: sorted [(dt, count)] -> same list with 'stuck' runs removed."""
    keep = [True] * len(pts); i = 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and pts[j + 1][1] == pts[i][1] and pts[j + 1][0] - pts[j][0] <= timedelta(hours=1):
            j += 1
        if pts[j][0] - pts[i][0] > timedelta(hours=STUCK_HOURS):
            for k in range(i, j + 1): keep[k] = False
        i = j + 1
    return [p for p, ok in zip(pts, keep) if ok]

def main():
    cust = load_customers()
    ch = defaultdict(float); new_out = defaultdict(float)
    restore = defaultdict(list); longest = {}
    for y in YEARS:
        path = os.path.join(RAW, "eaglei_tx_%d.csv" % y)
        if not os.path.exists(path):
            print("  (missing %s - run fetch_data.py first; skipping)" % os.path.basename(path)); continue
        print("  %d ..." % y, end="", flush=True)
        tsdt = {}; series = defaultdict(dict)
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ts = r["utc"]
                if ts not in tsdt: tsdt[ts] = parse_ts(ts)
                dt = tsdt[ts]
                if dt is None: continue
                c = int(r["customers_out"]); s = series[r["fips"]]
                if c > s.get(dt, 0): s[dt] = c
        for fips, s in series.items():
            pts = clean_series(sorted(s.items()))
            thr = max(MAJOR_MIN, MAJOR_PCT * cust.get(fips, 0))
            prev_t, prev_c = None, 0
            ep = None                                        # current major episode: [peak_t, peak_c, last_t_above_10pct]
            armed = True                                     # a new episode can only start after dropping below the threshold
            for t, c in pts:
                gap = prev_t is None or t - prev_t > GAP
                base = 0 if gap else prev_c
                if c > base: new_out[fips] += c - base
                ch[fips] += c * 0.25
                # --- major-outage restoration episodes ---
                if ep and (gap or c < RESTORED_FRACTION * ep[1]):
                    end = prev_t + timedelta(minutes=15)
                    hrs = (end - ep[0]).total_seconds() / 3600
                    restore[fips].append(hrs)
                    if hrs > longest.get(fips, (0, None))[0]: longest[fips] = (hrs, ep[0])
                    ep = None; armed = False
                if gap or c < thr: armed = True
                if ep is None and armed and c >= thr:
                    ep = [t, c, t]
                elif ep:
                    if c > ep[1]: ep[0], ep[1] = t, c
                    ep[2] = t
                prev_t, prev_c = t, c
            if ep:                                           # series ended mid-episode
                hrs = (prev_t + timedelta(minutes=15) - ep[0]).total_seconds() / 3600
                restore[fips].append(hrs)
                if hrs > longest.get(fips, (0, None))[0]: longest[fips] = (hrs, ep[0])
        print(" done")

    rows = []
    for fips in sorted(cust):
        r = restore.get(fips, [])
        q = sorted(r)
        lg = longest.get(fips)
        rows.append({
            "county_fips": fips,
            "avg_outage_hours": round(ch[fips] / new_out[fips], 2) if new_out[fips] else "",
            "major_outages": len(r),
            "median_restore_hours": round(statistics.median(q), 1) if q else "",
            "p90_restore_hours": round(q[round(0.9 * (len(q) - 1))], 1) if q else "",
            "longest_restore_hours": round(lg[0], 1) if lg else "",
            "longest_restore_start": (lg[1] - timedelta(hours=6)).strftime("%Y-%m-%d") if lg else "",   # ~Central date
        })
    names = {}
    hp = os.path.join(DATA, "tx_county_hazards.csv")
    if os.path.exists(hp):
        with open(hp, encoding="utf-8", errors="replace") as f:
            names = {r["county_fips"]: r["county"] for r in csv.DictReader(f)}
    for r in rows: r["county"] = names.get(r["county_fips"], "")
    out = os.path.join(DATA, "tx_county_duration.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print("wrote data/tx_county_duration.csv (%d counties)" % len(rows))
    ok = [r for r in rows if r["median_restore_hours"] != "" and r["major_outages"] >= 10]
    ok.sort(key=lambda r: -r["median_restore_hours"])
    print("\nSlowest to restore (median hours after a major outage, counties with 10+ major outages):")
    for r in ok[:8]:
        print("  %-14s median %5.1f h  p90 %6.1f h  (%d major outages; avg outage %s h)" % (
            r["county"] or r["county_fips"], r["median_restore_hours"], r["p90_restore_hours"], r["major_outages"], r["avg_outage_hours"]))
    print("Fastest:")
    for r in ok[-4:]:
        print("  %-14s median %5.1f h  p90 %6.1f h  (%d major outages; avg outage %s h)" % (
            r["county"] or r["county_fips"], r["median_restore_hours"], r["p90_restore_hours"], r["major_outages"], r["avg_outage_hours"]))

if __name__ == "__main__":
    main()
