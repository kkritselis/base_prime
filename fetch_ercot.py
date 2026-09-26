#!/usr/bin/env python3
"""
Battery grid value by ERCOT load zone (the Track 1 tie-in).   Stdlib only.
Run from the project folder:   python fetch_ercot.py        (~100 MB download once, then ~3-6 min to parse)

Source: ERCOT report 13061 "Historical RTM Load Zone and Hub Prices" (15-minute real-time settlement point prices),
        one zip per year, listed at https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=13061
Per load zone and year we compute:
  arbitrage_usd_per_kw_yr  What a 2-hour home battery could earn per kW of capacity by charging in each day's
                           cheapest 2 hours and discharging in its most expensive 2 hours (85% round-trip efficiency).
                           A simple, transparent proxy for how much a battery is worth to Base in normal times.
  spike_intervals          15-minute intervals priced at $1,000/MWh or more (grid-stress moments)
  mean_price, p99_price    context
The "typical year" excludes 2021. Note: during Uri prices sat at the $9,000 cap for days, so a same-day
charge/discharge earned little then; a battery's Uri value was backup power, not arbitrage.
Outputs:
  data/ercot_zone_value.csv       one row per zone: typical-year value, all-years value, spikes/yr
  data/ercot_zone_by_year.csv     zone x year detail
"""
import csv, io, json, os, re, statistics, urllib.request, zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data"); RAW = os.path.join(DATA, "raw", "ercot")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}
LIST = "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=13061"
DOWNLOAD = "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId=%s"
YEARS = range(2018, 2026)
EFF = 0.85
HOURS = 2                      # battery duration: charge/discharge in the 2 cheapest / 2 dearest hours of each day
SPIKE = 1000.0                 # $/MWh
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)

def year_files():
    with get(LIST) as r:
        docs = json.loads(r.read().decode("utf-8"))["ListDocsByRptTypeRes"]["DocumentList"]
    out = {}
    for d in docs:
        d = d["Document"]; m = re.search(r"_(\d{4})$", d["FriendlyName"])
        if m and int(m.group(1)) in YEARS: out[int(m.group(1))] = d["DocID"]
    return out

# ---------- minimal .xlsx reader (stdlib): yields rows as lists of strings ----------
def xlsx_rows(xbytes):
    z = zipfile.ZipFile(io.BytesIO(xbytes))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml")):
            if el.tag == NS + "si":
                shared.append("".join(t.text or "" for t in el.iter(NS + "t"))); el.clear()
    sheets = sorted((n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n, re.I)),
                    key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
    for sh in sheets:
        for _, el in ET.iterparse(z.open(sh)):
            if el.tag != NS + "row": continue
            row = {}
            for c in el.iter(NS + "c"):
                ref = c.get("r", ""); col = re.match(r"[A-Z]+", ref).group(0) if ref else str(len(row))
                v = c.find(NS + "v"); t = c.get("t")
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(NS + "t"))
                elif v is None: val = ""
                elif t == "s": val = shared[int(v.text)]
                else: val = v.text
                row[col] = val
            el.clear()
            if row:
                idx = {}
                for k, v in row.items():
                    n = 0
                    for ch in k: n = n * 26 + (ord(ch) - 64) if ch.isalpha() else n
                    idx[n - 1] = v
                width = max(idx) + 1
                yield [idx.get(i, "") for i in range(width)]   # keep column positions even when cells are empty

def year_prices(year, docid):
    """-> cached CSV of load-zone prices: date, hour, interval, zone, price"""
    path = os.path.join(RAW, "rtm_lz_%d.csv" % year)
    if os.path.exists(path) and os.path.getsize(path) > 1000: return path
    zpath = os.path.join(RAW, "rtm_%d.zip" % year)
    if not os.path.exists(zpath):
        print("  downloading %d prices ..." % year, flush=True)
        with get(DOWNLOAD % docid) as r, open(zpath + ".part", "wb") as f: f.write(r.read())
        os.replace(zpath + ".part", zpath)
    print("  parsing %d ..." % year, end="", flush=True)
    outer = zipfile.ZipFile(zpath)
    n = 0
    with open(path + ".part", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["date", "hour", "interval", "zone", "price"])
        for name in outer.namelist():
            data = outer.read(name)
            rows = xlsx_rows(data) if name.lower().endswith(".xlsx") else csv.reader(io.StringIO(data.decode("utf-8", "replace")))
            hdr = None
            for r in rows:
                if hdr is None or (r and r[0] == "Delivery Date"):
                    if r and "Settlement Point Name" in r:
                        hdr = {h: i for i, h in enumerate(r)}
                    continue
                try:
                    zone = r[hdr["Settlement Point Name"]]
                    if not zone.startswith("LZ_"): continue
                    # each zone is listed twice: type LZ and LZEW (energy-weighted); keep one
                    if "Settlement Point Type" in hdr and r[hdr["Settlement Point Type"]] not in ("LZ", ""): continue
                    w.writerow([r[hdr["Delivery Date"]], int(float(r[hdr["Delivery Hour"]])),
                                int(float(r[hdr["Delivery Interval"]])), zone, float(r[hdr["Settlement Point Price"]])])
                    n += 1
                except (KeyError, ValueError, IndexError):
                    continue
    os.replace(path + ".part", path)
    print(" %d zone prices" % n)
    return path

def zone_metrics(path):
    """-> {zone: dict(metrics)} for one year"""
    daily = defaultdict(lambda: defaultdict(list))     # zone -> date -> [hourly avg prices...]
    hourly = defaultdict(list)                          # (zone,date,hour) -> [15-min prices]
    allp = defaultdict(list); spikes = defaultdict(int)
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            p = float(r["price"]); z = r["zone"]
            hourly[(z, r["date"], int(r["hour"]))].append(p)
            allp[z].append(p)
            if p >= SPIKE: spikes[z] += 1
    for (z, d, h), ps in hourly.items():
        daily[z][d].append(sum(ps) / len(ps))
    out = {}
    for z, days in daily.items():
        value = 0.0
        for d, hp in days.items():
            if len(hp) < 2 * HOURS: continue
            s = sorted(hp)
            buy = sum(s[:HOURS]) / HOURS; sell = sum(s[-HOURS:]) / HOURS
            value += max(0.0, sell - buy / EFF) * HOURS / 1000.0      # $ per kW of battery per day
        ps = sorted(allp[z])
        out[z] = {"arbitrage_usd_per_kw": round(value, 2), "spike_intervals": spikes[z],
                  "mean_price": round(statistics.mean(ps), 2), "p99_price": round(ps[int(0.99 * (len(ps) - 1))], 2),
                  "days": len(days)}
    return out

def main():
    print("1) ERCOT document list")
    docs = year_files()
    print("   years available:", sorted(docs))
    by_year = {}
    for y in sorted(docs):
        by_year[y] = zone_metrics(year_prices(y, docs[y]))

    rows_y = []
    for y, zs in sorted(by_year.items()):
        for z, m in sorted(zs.items()): rows_y.append(dict(zone=z, year=y, **m))
    with open(os.path.join(DATA, "ercot_zone_by_year.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_y[0].keys())); w.writeheader(); w.writerows(rows_y)

    zones = sorted({r["zone"] for r in rows_y})
    out = []
    for z in zones:
        ys = [r for r in rows_y if r["zone"] == z]
        typ = [r for r in ys if r["year"] != 2021]
        out.append({
            "zone": z,
            "typical_year_usd_per_kw": round(statistics.mean(r["arbitrage_usd_per_kw"] for r in typ), 1) if typ else "",
            "all_years_avg_usd_per_kw": round(statistics.mean(r["arbitrage_usd_per_kw"] for r in ys), 1),
            "uri_2021_usd_per_kw": next((r["arbitrage_usd_per_kw"] for r in ys if r["year"] == 2021), ""),
            "spike_intervals_per_year_typical": round(statistics.mean(r["spike_intervals"] for r in typ), 1) if typ else "",
            "mean_price_typical": round(statistics.mean(r["mean_price"] for r in typ), 2) if typ else "",
            "years": "%d-%d" % (min(r["year"] for r in ys), max(r["year"] for r in ys)),
        })
    out.sort(key=lambda r: -(r["typical_year_usd_per_kw"] or 0))
    with open(os.path.join(DATA, "ercot_zone_value.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
    print("\nwrote data/ercot_zone_value.csv and data/ercot_zone_by_year.csv")
    print("\n2-hour battery arbitrage value, $ per kW per year (typical year = excluding 2021 / Uri):")
    for r in out:
        print("  %-10s typical $%6.1f   all-years $%7.1f   Uri 2021 $%8s   spikes/yr %s" % (
            r["zone"], r["typical_year_usd_per_kw"] or 0, r["all_years_avg_usd_per_kw"], r["uri_2021_usd_per_kw"],
            r["spike_intervals_per_year_typical"]))

if __name__ == "__main__":
    main()
