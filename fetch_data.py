#!/usr/bin/env python3
"""
Texas Outage x Customer Fit - data pipeline (stdlib only, no pip installs).

Run from this folder:   python3 fetch_data.py            (all years 2018-2025)
                        python3 fetch_data.py 2021 2024  (just some years)

Downloads (cached in data/raw/ so re-runs are fast):
  - DOE EAGLE-I county outage snapshots (15-min), filtered to Texas   [figshare 10.6084/m9.figshare.24237376]
  - EAGLE-I modeled customers per county (MCC.csv)
  - Census ACS 2020-2024 5-yr summary-file tables by ZIP (ZCTA)
  - Census 2020 ZCTA -> county relationship file
Writes to data/:
  tx_zip_profile.csv          one row per Texas ZIP: population, income, ownership, single-family share
  tx_county_outage_days.csv   one row per county per day with an outage: peak customers out, customer-hours out
  tx_county_outage_summary.csv  per county: customers, avg annual outage hours per customer, event days, peak %
  tx_statewide_daily.csv      per day: peak statewide customers out (use to find big events: Uri, Beryl, derecho...)
  tx_zip_scores.csv           ZIP profile joined to its county's outage history + draft "Resilience Demand Score"
"""
import csv, io, os, sys, time, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw"); OUT = os.path.join(HERE, "data")
os.makedirs(RAW, exist_ok=True)

EAGLE_FILES = {2014: 42547717, 2015: 42547822, 2016: 42547825, 2017: 42547828, 2018: 42547879,
               2019: 42547885, 2020: 42547894, 2021: 42547891, 2022: 42547897, 2023: 44574907,
               2024: 53581661, 2025: 62164877}
MCC_FILE = 42547708
FIG = "https://ndownloader.figshare.com/files/%d"
ACS = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-%s.dat"
XWALK = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}

def is_tx_zip(z):
    return len(z) == 5 and (z[:2] in ("75", "76", "77", "78", "79") or z[:3] in ("885", "733"))

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)

def cached_text(url, name):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        print("  downloading", name)
        with get(url) as r, open(path + ".part", "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        os.rename(path + ".part", path)
    return path

# ---------- 1. EAGLE-I, streamed and filtered to Texas ----------
def parse_ts(s):
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%m/%d/%y %H:%M", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M"):
        try: return datetime.strptime(s, fmt)
        except ValueError: pass
    return None

def eagle_texas(year):
    """Returns path to cached Texas-only CSV (fips,customers_out,utc_timestamp)."""
    path = os.path.join(RAW, "eaglei_tx_%d.csv" % year)
    if os.path.exists(path): return path
    print("  streaming EAGLE-I %d (~1 GB, keeps only Texas rows)..." % year)
    t0 = time.time(); n = 0
    with get(FIG % EAGLE_FILES[year]) as r, open(path + ".part", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["fips", "customers_out", "utc"])
        text = io.TextIOWrapper(r, encoding="utf-8", errors="replace", newline="")
        header = next(text).strip().split(",")
        for line in text:
            if ",Texas," not in line: continue
            p = line.rstrip("\r\n").split(",")
            try: c = int(float(p[3]))
            except ValueError: continue
            if c > 0:
                w.writerow([p[0].zfill(5), c, p[4].strip()]); n += 1
    os.rename(path + ".part", path)
    print("    %d Texas rows in %.0fs" % (n, time.time() - t0))
    return path

STUCK_HOURS = 72   # same outage count repeated this long = a stuck utility outage map, not a real outage

def build_outages(years):
    """County-day peaks and customer-hours, after cleaning:
       - duplicate snapshots (same county + timestamp) are counted once
       - 'stuck' readings (identical count repeated for > STUCK_HOURS) are dropped
    """
    cday_peak = defaultdict(int); cday_ch = defaultdict(float); state_ts = defaultdict(int)
    qc = defaultdict(lambda: {"duplicates": 0, "stuck_snapshots": 0, "stuck_customer_hours": 0.0})
    for y in years:
        tsdt = {}
        series = defaultdict(dict)                       # fips -> {timestamp: customers_out}
        with open(eagle_texas(y)) as f:
            for row in csv.DictReader(f):
                ts = row["utc"]
                if ts not in tsdt: tsdt[ts] = parse_ts(ts)
                if tsdt[ts] is None: continue
                c = int(row["customers_out"]); s_ = series[row["fips"]]
                if ts in s_:
                    qc[row["fips"]]["duplicates"] += 1
                    if c <= s_[ts]: continue
                s_[ts] = c
        for fips, s_ in series.items():
            pts = sorted((tsdt[ts], c, ts) for ts, c in s_.items())
            keep = [True] * len(pts)
            i = 0
            while i < len(pts):                          # find runs of identical counts with no gap > 1 hour
                j = i
                while (j + 1 < len(pts) and pts[j + 1][1] == pts[i][1]
                       and (pts[j + 1][0] - pts[j][0]) <= timedelta(hours=1)):
                    j += 1
                if (pts[j][0] - pts[i][0]) > timedelta(hours=STUCK_HOURS):
                    for k in range(i, j + 1): keep[k] = False
                    qc[fips]["stuck_snapshots"] += j - i + 1
                    qc[fips]["stuck_customer_hours"] += pts[i][1] * 0.25 * (j - i + 1)
                i = j + 1
            for (dt, c, ts), ok in zip(pts, keep):
                if not ok: continue
                d = (dt - timedelta(hours=6)).strftime("%Y-%m-%d")   # ~Central time
                k = (fips, d)
                if c > cday_peak[k]: cday_peak[k] = c
                cday_ch[k] += c * 0.25                   # 15-minute snapshot -> customer-hours
                state_ts[ts] += c
    sday = {}
    for ts, v in state_ts.items():
        dt = parse_ts(ts)
        if not dt: continue
        d = (dt - timedelta(hours=6)).strftime("%Y-%m-%d")
        if v > sday.get(d, 0): sday[d] = v
    return cday_peak, cday_ch, sday, qc

# ---------- 2. Census ----------
def build_zip_profile():
    acs = defaultdict(dict)
    for tb in ("b01003", "b19013", "b25003", "b25024", "b25077"):
        path = cached_text(ACS % tb, "acs2024_%s.dat" % tb)
        with open(path, encoding="utf-8", errors="replace") as f:
            hdr = next(f).rstrip("\n").split("|")
            for line in f:
                if not line.startswith("860Z200US"): continue
                p = line.rstrip("\n").split("|"); z = p[0][9:]
                if is_tx_zip(z): acs[z].update(zip(hdr[1:], p[1:]))
    path = cached_text(XWALK, "zcta_county_2020.txt")
    best = {}
    with open(path, encoding="utf-8-sig") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("|")
            if len(p) < 17 or not is_tx_zip(p[1]) or not p[9].startswith("48"): continue
            a = int(p[16] or 0)
            if p[1] not in best or a > best[p[1]][1]: best[p[1]] = (p[9], a, p[10])
    num = lambda v: float(v) if v not in (None, "") and float(v) >= 0 else None
    rows = []
    for z in sorted(acs):
        o = acs[z]; pop = num(o.get("B01003_E001"))
        if not pop: continue
        occ = num(o.get("B25003_E001")); own = num(o.get("B25003_E002"))
        units = num(o.get("B25024_E001")); sfd = num(o.get("B25024_E002")) or 0; sfa = num(o.get("B25024_E003")) or 0
        cty = best.get(z, ("", 0, ""))
        rows.append({"zip": z, "county_fips": cty[0], "county_name": cty[2], "population": int(pop),
                     "median_hh_income": int(num(o.get("B19013_E001")) or 0) or "",
                     "owner_rate": round(own / occ, 3) if occ and own is not None else "",
                     "single_family_rate": round((sfd + sfa) / units, 3) if units else "",
                     "median_home_value": int(num(o.get("B25077_E001")) or 0) or ""})
    return rows

def write(name, rows, fields):
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
    print("  wrote data/%s (%d rows)" % (name, len(rows)))

def pct_rank(values):
    s = sorted(v for v in values if v is not None)
    return lambda v: (sum(1 for x in s if x <= v) / len(s)) if (v is not None and s) else 0

def main():
    years = [int(a) for a in sys.argv[1:]] or list(range(2018, 2026))
    print("1) Census ZIP profile"); zips = build_zip_profile()
    write("tx_zip_profile.csv", zips, list(zips[0].keys()))

    print("2) County customer counts")
    mcc = {}
    with open(cached_text(FIG % MCC_FILE, "MCC.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            fips = r["County_FIPS"].zfill(5)
            if fips.startswith("48"): mcc[fips] = int(r["Customers"])

    print("3) EAGLE-I outages", years)
    peak, ch, sday, qc = build_outages(years)
    write("tx_county_outage_days.csv",
          [{"county_fips": k[0], "date": k[1], "peak_customers_out": v, "customer_hours_out": round(ch[k], 1),
            "peak_pct_of_customers": round(100 * v / mcc[k[0]], 2) if mcc.get(k[0]) else ""}
           for k, v in sorted(peak.items())],
          ["county_fips", "date", "peak_customers_out", "customer_hours_out", "peak_pct_of_customers"])
    write("tx_statewide_daily.csv", [{"date": d, "peak_customers_out": v} for d, v in sorted(sday.items())],
          ["date", "peak_customers_out"])

    nyears = len(years); agg = {}
    for (fips, d), v in peak.items():
        a = agg.setdefault(fips, {"ch": 0.0, "event_days": 0, "peak": 0})
        a["ch"] += ch[(fips, d)]; a["peak"] = max(a["peak"], v)
        cust = max(mcc.get(fips) or 1, v)   # never divide by fewer customers than were seen out at once
        if v >= max(100, 0.02 * cust): a["event_days"] += 1   # "event day" = 2%+ of county customers out (min 100)
    csum = []
    for fips, cust in sorted(mcc.items()):
        a = agg.get(fips, {"ch": 0, "event_days": 0, "peak": 0})
        cust = max(cust, a["peak"])        # EAGLE-I's modeled count can be lower than what utilities report
        csum.append({"county_fips": fips, "customers": cust,
                     "avg_annual_outage_hours_per_customer": round(a["ch"] / cust / nyears, 2),
                     "event_days_per_year": round(a["event_days"] / nyears, 1),
                     "worst_peak_customers_out": a["peak"], "worst_peak_pct": round(100 * a["peak"] / cust, 1)})
    # cap extreme values at the 99th percentile (display sanity; scores use ranks anyway)
    for key in ("avg_annual_outage_hours_per_customer", "event_days_per_year"):
        vals = sorted(c[key] for c in csum); cap = vals[int(0.99 * (len(vals) - 1))]
        for c in csum:
            c[key + "_raw"] = c[key]; c[key] = min(c[key], cap)
    for c in csum:
        q = qc.get(c["county_fips"], {})
        c["stuck_customer_hours_removed"] = round(q.get("stuck_customer_hours", 0), 1) if q else 0
        c["duplicate_snapshots_removed"] = q.get("duplicates", 0) if q else 0
    write("tx_county_outage_summary.csv", csum, list(csum[0].keys()))
    worst = sorted(csum, key=lambda c: -c["stuck_customer_hours_removed"])[:5]
    print("  data cleaning - most stuck customer-hours removed:",
          ", ".join("%s (%.0f)" % (c["county_fips"], c["stuck_customer_hours_removed"]) for c in worst))

    print("4) ZIP scores")
    cby = {c["county_fips"]: c for c in csum}
    r_out = pct_rank([c["avg_annual_outage_hours_per_customer"] for c in csum])
    r_evt = pct_rank([c["event_days_per_year"] for c in csum])
    r_inc = pct_rank([z["median_hh_income"] or None for z in zips])
    scored = []
    for z in zips:
        c = cby.get(z["county_fips"])
        if not c: continue
        own = z["owner_rate"] or 0; sf = z["single_family_rate"] or 0
        score = 100 * (0.30 * r_out(c["avg_annual_outage_hours_per_customer"]) + 0.15 * r_evt(c["event_days_per_year"])
                       + 0.25 * own + 0.15 * sf + 0.15 * r_inc(z["median_hh_income"] or None))
        scored.append(dict(z, **{k: c[k] for k in ("avg_annual_outage_hours_per_customer", "event_days_per_year",
                                                   "worst_peak_pct")},
                           owner_households=int(z["population"] / 2.6 * own),  # rough: ~2.6 people per household
                           resilience_demand_score=round(score, 1)))
    scored.sort(key=lambda r: -r["resilience_demand_score"])
    write("tx_zip_scores.csv", scored, list(scored[0].keys()))
    print("Done.")

if __name__ == "__main__":
    main()
