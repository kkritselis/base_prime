#!/usr/bin/env python3
"""
What CAUSED each outage?  Joins county outage days (fetch_data.py) with NOAA Storm Events.   Stdlib only.
Run from the project folder after fetch_data.py:   python fetch_events.py      (~1-2 min; downloads ~90 MB once)

Source: NOAA NCEI Storm Events Database (bulk CSV), 2018-2025, Texas rows.
        https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
Method: every notable county outage day (1%+ of customers out at once) is matched to storm events reported in
        that county (or its NWS forecast zone) from the day before through the day after. The dominant cause wins
        (tropical > winter > wind > tornado > flood > heat > hail > lightning > wildfire). No storm on record ->
        "no storm on record" (equipment failure, animals, vehicles, planned work...). ERCOT-ordered load shed days
        (Winter Storm Uri, Feb 15-18 2021) are tagged "grid emergency".
Outputs (data/):
  tx_county_causes.csv        per county: share of outage customer-hours by cause, top cause, notable days by cause
  tx_county_events.json       per county: 5 worst outage days (date, % out, cause, storm name) + monthly outage series
  tx_statewide_events.csv     statewide outage events (100k+ customers), grid-wide vs local, with cause and storm name
  tx_statewide_causes.csv     statewide share of outage customer-hours by cause
"""
import csv, gzip, io, json, os, re, urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data"); RAW = os.path.join(DATA, "raw")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}
NOAA = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
YEARS = range(2018, 2026)
NOTABLE_PCT = 1.0          # county outage day counts if 1%+ of its customers were out at once
# ERCOT-directed rotating outages (Winter Storm Uri). Source: ERCOT / PUCT reports on the February 2021 event.
GRID_EMERGENCY = {date(2021, 2, d) for d in (15, 16, 17, 18)}

CAUSES = [  # (cause, NOAA event types) in priority order
    ("tropical", {"Hurricane", "Hurricane (Typhoon)", "Tropical Storm", "Tropical Depression", "Storm Surge/Tide"}),
    ("winter", {"Winter Storm", "Ice Storm", "Winter Weather", "Heavy Snow", "Blizzard", "Cold/Wind Chill",
                "Extreme Cold/Wind Chill", "Frost/Freeze", "Freezing Fog", "Sleet"}),
    ("wind", {"Thunderstorm Wind", "High Wind", "Strong Wind", "Marine Thunderstorm Wind", "Dust Storm"}),
    ("tornado", {"Tornado", "Funnel Cloud"}),   # after wind: widespread outages come from straight-line winds (derechos)
    ("flood", {"Flash Flood", "Flood", "Coastal Flood", "Heavy Rain"}),
    ("heat", {"Heat", "Excessive Heat"}),
    ("hail", {"Hail"}),
    ("lightning", {"Lightning"}),
    ("wildfire", {"Wildfire"}),
]
TYPE2CAUSE = {t: c for c, ts in CAUSES for t in ts}
PRIORITY = [c for c, _ in CAUSES] + ["none"]
LABEL = {"tropical": "hurricane / tropical storm", "winter": "winter storm / ice", "tornado": "tornado",
         "wind": "high winds / severe thunderstorms", "flood": "flooding", "heat": "extreme heat", "hail": "hail",
         "lightning": "lightning", "wildfire": "wildfire", "none": "no storm on record", "grid": "grid emergency (ERCOT load shed)"}
NAME_RE = re.compile(r"\b(Hurricane|Tropical Storm)\s+([A-Z][a-z]+)")
ZONE_PREFIX = re.compile(r"^(INLAND|COASTAL|NORTHERN|SOUTHERN|EASTERN|WESTERN|CENTRAL|NORTHWEST|NORTHEAST|SOUTHWEST|"
                         r"SOUTHEAST|NORTH|SOUTH|EAST|WEST|UPPER|LOWER|MOUNTAINS OF|GUADALUPE MOUNTAINS OF)\s+")

def norm(name):
    n = (name or "").upper().replace(" COUNTY", "").replace(".", "").strip()
    return ZONE_PREFIX.sub("", n).replace(" ISLANDS", "").replace(" BAY", "").strip()

def storm_files():
    listing = os.path.join(RAW, "noaa_listing.html")
    if not os.path.exists(listing):
        with urllib.request.urlopen(urllib.request.Request(NOAA, headers=UA), timeout=120) as r:
            open(listing, "wb").write(r.read())
    html = open(listing, encoding="utf-8", errors="replace").read()
    out = {}
    for y in YEARS:
        m = sorted(set(re.findall(r"StormEvents_details-ftp_v1\.0_d%d_c\d+\.csv\.gz" % y, html)))
        if m: out[y] = m[-1]
    return out

def storm_events(county_by_name):
    """-> {(county_fips, date): set(cause)}, {(county_fips, date): storm name}"""
    ev = defaultdict(set); names = {}
    for y, fname in storm_files().items():
        path = os.path.join(RAW, fname)
        if not os.path.exists(path):
            print("  downloading", fname)
            with urllib.request.urlopen(urllib.request.Request(NOAA + fname, headers=UA), timeout=300) as r:
                open(path, "wb").write(r.read())
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                if r.get("STATE") != "TEXAS": continue
                cause = TYPE2CAUSE.get(r.get("EVENT_TYPE", ""))
                if not cause: continue
                if r.get("CZ_TYPE") == "C":
                    fips = ["48" + r["CZ_FIPS"].zfill(3)]
                else:                                              # NWS forecast zone -> county by name
                    fips = [county_by_name[n] for n in {norm(r.get("CZ_NAME"))} if n in county_by_name]
                if not fips: continue
                try:
                    b = date(int(r["BEGIN_YEARMONTH"][:4]), int(r["BEGIN_YEARMONTH"][4:]), int(r["BEGIN_DAY"]))
                    e = date(int(r["END_YEARMONTH"][:4]), int(r["END_YEARMONTH"][4:]), int(r["END_DAY"]))
                except (ValueError, KeyError):
                    continue
                e = min(e, b + timedelta(days=10))
                m = NAME_RE.search((r.get("EPISODE_NARRATIVE") or "") + " " + (r.get("EVENT_NARRATIVE") or ""))
                d = b - timedelta(days=1)
                while d <= e + timedelta(days=1):                  # outage can lag or lead the report by a day
                    for fp in fips:
                        ev[(fp, d)].add(cause)
                        if m and cause == "tropical": names[(fp, d)] = m.group(2)
                    d += timedelta(days=1)
    # prefer "Hurricane X" if the storm was ever described as a hurricane in Texas reports
    hurricanes = set()
    for y, fname in storm_files().items():
        with gzip.open(os.path.join(RAW, fname), "rt", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                if r.get("STATE") == "TEXAS":
                    hurricanes |= set(re.findall(r"Hurricane\s+([A-Z][a-z]+)", (r.get("EPISODE_NARRATIVE") or "")))
    names = {k: ("Hurricane " if v in hurricanes else "Tropical Storm ") + v for k, v in names.items()}
    return ev, names

def main():
    days_path = os.path.join(DATA, "tx_county_outage_days.csv")
    summ_path = os.path.join(DATA, "tx_county_outage_summary.csv")
    if not os.path.exists(days_path):
        raise SystemExit("Run fetch_data.py first (needs data/tx_county_outage_days.csv).")
    customers = {}
    with open(summ_path, encoding="utf-8") as f:
        for r in csv.DictReader(f): customers[r["county_fips"]] = float(r["customers"] or 0)

    county_by_name, county_name = {}, {}
    for fn, key, nm in (("tx_county_hazards.csv", "county_fips", "county"), ("tx_zip_profile.csv", "county_fips", "county_name")):
        p = os.path.join(DATA, fn)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                for r in csv.DictReader(f):
                    if r.get(key) and r.get(nm):
                        county_by_name[norm(r[nm])] = r[key]; county_name.setdefault(r[key], r[nm].replace(" County", ""))
    print("1) NOAA Storm Events (Texas, %d-%d)" % (YEARS[0], YEARS[-1]))
    ev, storm_name = storm_events(county_by_name)
    print("   %d county-days with storm reports" % len(ev))

    print("2) Attributing outage days to causes")
    recs = []; monthly = defaultdict(lambda: defaultdict(float))
    with open(days_path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            fp = r["county_fips"]; d = date.fromisoformat(r["date"])
            peak = int(float(r["peak_customers_out"])); chh = float(r["customer_hours_out"])
            pct = 100 * peak / customers[fp] if customers.get(fp) else float(r.get("peak_pct_of_customers") or 0)
            monthly[fp]["%d-%02d" % (d.year, d.month)] += chh
            if pct < NOTABLE_PCT: continue
            causes = ev.get((fp, d), set())
            cause = "grid" if d in GRID_EMERGENCY else next((c for c in PRIORITY if c in causes), "none")
            recs.append({"fp": fp, "d": d, "peak": peak, "chh": chh, "pct": pct, "cause": cause,
                         "storm": storm_name.get((fp, d), "Winter Storm Uri" if cause == "grid" else ""), "how": "direct"})
    # (a) restoration tail: an outage that continues from a storm day keeps that storm's cause (up to 14 days)
    by_county = defaultdict(list)
    for x in recs: by_county[x["fp"]].append(x)
    for lst in by_county.values():
        lst.sort(key=lambda x: x["d"])
        for prev, cur in zip(lst, lst[1:]):
            if (cur["cause"] == "none" and prev["cause"] != "none" and (cur["d"] - prev["d"]).days <= 1
                    and prev.get("chain", 0) < 14):
                cur.update(cause=prev["cause"], storm=prev["storm"], how="restoration", chain=prev.get("chain", 0) + 1)
    # (b) regional storms: on a big outage day, unexplained counties take the day's dominant storm cause
    by_day = defaultdict(list)
    for x in recs: by_day[x["d"]].append(x)
    for d, lst in by_day.items():
        total = sum(x["peak"] for x in lst)
        known = Counter(); names_d = Counter()
        for x in lst:
            if x["cause"] != "none": known[x["cause"]] += x["peak"]
            if x["storm"]: names_d[x["storm"]] += x["peak"]
        if total >= 50000 and known:
            c, v = known.most_common(1)[0]
            if v >= 0.3 * sum(known.values()):
                for x in lst:
                    if x["cause"] == "none":
                        x.update(cause=c, how="regional",
                                 storm=names_d.most_common(1)[0][0] if names_d else "")
    how = Counter(x["how"] for x in recs)
    print("   notable county-days: %d  (direct storm match %d, restoration tail %d, regional storm %d)"
          % (len(recs), how["direct"], how["restoration"], how["regional"]))

    ch_by_cause = defaultdict(lambda: defaultdict(float)); days_by_cause = defaultdict(Counter)
    worst = defaultdict(list)
    state_days = defaultdict(lambda: {"out": 0, "counties": 0, "causes": Counter(), "names": Counter()})
    for x in recs:
        fp, cause = x["fp"], x["cause"]
        ch_by_cause[fp][cause] += x["chh"]; days_by_cause[fp][cause] += 1
        worst[fp].append({"date": x["d"].isoformat(), "pct_out": round(x["pct"], 1), "customers_out": x["peak"],
                          "cause": LABEL[cause], "storm": x["storm"]})
        sd = state_days[x["d"].isoformat()]; sd["out"] += x["peak"]; sd["counties"] += 1; sd["causes"][cause] += x["peak"]
        if x["storm"]: sd["names"][x["storm"]] += x["peak"]

    # ---- county causes ----
    rows = []
    for fp in sorted(customers):
        tot = sum(ch_by_cause[fp].values())
        row = {"county_fips": fp, "county": county_name.get(fp, "")}
        for c in PRIORITY + ["grid"]:
            row["share_" + c] = round(ch_by_cause[fp][c] / tot, 3) if tot else ""
            row["days_" + c] = days_by_cause[fp][c]
        weather = {c: v for c, v in ch_by_cause[fp].items() if c not in ("none",)}
        row["top_cause"] = LABEL[max(weather, key=weather.get)] if weather else ""
        row["notable_days"] = sum(days_by_cause[fp].values())
        rows.append(row)
    with open(os.path.join(DATA, "tx_county_causes.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print("   wrote data/tx_county_causes.csv (%d counties)" % len(rows))

    # ---- per-county worst days + monthly series (hours without power per customer) ----
    months = ["%d-%02d" % (y, m) for y in YEARS for m in range(1, 13)]
    out = {"months": months, "counties": {}}
    for fp in sorted(customers):
        cust = customers[fp] or 1
        top = sorted(worst[fp], key=lambda e: -e["pct_out"])[:5]
        out["counties"][fp] = {"name": county_name.get(fp, ""), "worst": top,
                               "monthly_hours": [round(monthly[fp].get(m, 0) / cust, 2) for m in months]}
    with open(os.path.join(DATA, "tx_county_events.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print("   wrote data/tx_county_events.json")

    # ---- statewide event classifier: consecutive big days -> one event ----
    big = sorted(d for d, sd in state_days.items() if sd["out"] >= 100000)
    events, cur = [], []
    for d in big:
        if cur and (date.fromisoformat(d) - date.fromisoformat(cur[-1])).days > 1:
            events.append(cur); cur = []
        cur.append(d)
    if cur: events.append(cur)
    ev_rows = []
    for days in events:
        causes, names = Counter(), Counter()
        for d in days:
            causes.update(state_days[d]["causes"]); names.update(state_days[d]["names"])
        peak_day = max(days, key=lambda d: state_days[d]["out"])
        main_c = causes.most_common(1)[0][0]
        tot = sum(causes.values())
        ev_rows.append({
            "start": days[0], "end": days[-1], "peak_day": peak_day,
            "peak_customers_out": state_days[peak_day]["out"],
            "counties_hit": len({x["fp"] for x in recs if x["d"].isoformat() in days}),
            "type": "GRID-WIDE (ERCOT load shed)" if any(date.fromisoformat(d) in GRID_EMERGENCY for d in days)
                    else "LOCAL (weather / wires)",
            "main_cause": LABEL[main_c],
            "storm": names.most_common(1)[0][0] if names else "",
            "cause_mix": "; ".join("%s %d%%" % (LABEL[c], round(100 * v / tot)) for c, v in causes.most_common(3)),
        })
    ev_rows.sort(key=lambda e: -e["peak_customers_out"])
    with open(os.path.join(DATA, "tx_statewide_events.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ev_rows[0].keys())); w.writeheader(); w.writerows(ev_rows)
    print("   wrote data/tx_statewide_events.csv (%d events of 100k+ customers)" % len(ev_rows))
    print("\nTop 12 statewide outage events:")
    for e in ev_rows[:12]:
        span = e["start"] if e["start"] == e["end"] else "%s..%s" % (e["start"], e["end"][5:])
        print("  %-17s %10s out  %-27s %-34s %s" % (span, "{:,}".format(e["peak_customers_out"]), e["type"],
                                                   e["main_cause"], e["storm"]))
    allc = Counter()
    for fp in ch_by_cause:
        for c, v in ch_by_cause[fp].items(): allc[c] += v
    tot = sum(allc.values())
    with open(os.path.join(DATA, "tx_statewide_causes.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["cause", "label", "customer_hours", "share"])
        for c, v in allc.most_common():
            w.writerow([c, LABEL[c], round(v), round(v / tot, 4) if tot else ""])
    print("   wrote data/tx_statewide_causes.csv")
    print("\nStatewide outage customer-hours by cause:",
          ", ".join("%s %d%%" % (LABEL[c], round(100 * v / tot)) for c, v in allc.most_common() if v / tot >= 0.005))

if __name__ == "__main__":
    main()
