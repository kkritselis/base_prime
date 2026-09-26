#!/usr/bin/env python3
"""
Extra customer-fit data. Safe to run at the same time as fetch_data.py (it uses different cache files).
Stdlib only.   Run from the project folder (next to fetch_data.py, NOT inside data/):  python fetch_extra.py

Downloads (cached in data/raw/):
  - FEMA National Risk Index (NRI): county table + Texas census-tract table
  - Census 2020 ZCTA -> tract relationship file (to roll tract hazards up to ZIPs)
  - Census ACS 2020-2024 5-yr: B25040 heating fuel, B25018 median rooms, B25035 median year built,
    B25039 median year moved in (by tenure)
  - Census Building Permits Survey, county annual 2022-2024 (new 1-unit homes)
Writes to data/:
  tx_county_hazards.csv   per county: NRI overall risk, social vulnerability, resilience + outage-relevant hazard scores
  tx_zip_extra.csv        per ZIP: hazard scores (land-area weighted from tracts), electric-heat share, rooms,
                          year built, owner median year moved in, new single-family permits (county, per 1k homes)

If the FEMA download fails (they move files sometimes), download the "All Counties" and "Texas census tracts"
CSV tables from https://hazards.fema.gov/nri/data-resources and drop the zips/CSVs into data/raw/ as
NRI_Table_Counties.zip and NRI_Table_CensusTracts_Texas.zip, then re-run.
"""
import csv, io, os, sys, zipfile, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw"); OUT = os.path.join(HERE, "data")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}

# FEMA's public ArcGIS layers (Dec 2025 NRI). hazards.fema.gov direct downloads return 403 to scripts.
NRI_ARCGIS = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/%s/FeatureServer/0/query"
NRI_COUNTY_LAYER = "National_Risk_Index_Counties"
NRI_TRACT_LAYER = "National_Risk_Index_Census_Tracts"
ZCTA_TRACT = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt"
ACS = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-%s.dat"
BPS = "https://www2.census.gov/econ/bps/County/co%da.txt"

# Outage-relevant NRI hazards (prefix -> label). Earthquake/tsunami/volcano/avalanche skipped for Texas.
HAZARDS = {"HRCN": "hurricane", "ISTM": "ice_storm", "CWAV": "cold_wave", "HWAV": "heat_wave",
           "SWND": "strong_wind", "WNTW": "winter_weather", "TRND": "tornado", "HAIL": "hail",
           "LTNG": "lightning", "IFLD": "inland_flood", "CFLD": "coastal_flood", "WFIR": "wildfire"}

def is_tx_zip(z):
    return len(z) == 5 and (z[:2] in ("75", "76", "77", "78", "79") or z[:3] in ("885", "733"))

def download(urls, name):
    path = os.path.join(RAW, name)
    if os.path.exists(path): return path
    for url in ([urls] if isinstance(urls, str) else urls):
        try:
            print("  downloading", name)
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, \
                 open(path + ".part", "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    f.write(b)
            os.rename(path + ".part", path)
            return path
        except Exception as e:
            print("    failed:", url, "->", e)
    return None

def arcgis_texas(layer, name):
    """Page through a FEMA ArcGIS layer (2000 rows/page) for Texas and cache it as CSV."""
    path = os.path.join(RAW, name)
    if os.path.exists(path): return path
    import json, urllib.parse
    rows, offset = [], 0
    print("  downloading %s (Texas) from FEMA ArcGIS" % layer)
    try:
        while True:
            q = urllib.parse.urlencode({"where": "STATEABBRV='TX'", "outFields": "*", "returnGeometry": "false",
                                        "f": "json", "resultOffset": offset, "resultRecordCount": 2000})
            with urllib.request.urlopen(urllib.request.Request(NRI_ARCGIS % layer + "?" + q, headers=UA), timeout=300) as r:
                j = json.load(r)
            if "error" in j: raise RuntimeError(j["error"])
            feats = [f["attributes"] for f in j.get("features", [])]
            rows += feats; offset += len(feats)
            print("    %d rows" % len(rows))
            if not feats or not j.get("exceededTransferLimit"): break
    except Exception as e:
        print("    failed:", e); return None
    if not rows: return None
    fields = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
    return path

def read_csv_from(path):
    """Yield dict rows from a .csv or from the biggest .csv inside a .zip."""
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        name = max((n for n in z.namelist() if n.lower().endswith(".csv")), key=lambda n: z.getinfo(n).file_size)
        f = io.TextIOWrapper(z.open(name), encoding="utf-8-sig", errors="replace")
    else:
        f = open(path, encoding="utf-8-sig", errors="replace")
    yield from csv.DictReader(f)

def fnum(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def write(name, rows, fields):
    with open(os.path.join(OUT, name), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    print("  wrote data/%s (%d rows)" % (name, len(rows)))

# ---------- NRI ----------
def nri_row(r):
    o = {"risk_score": r.get("RISK_SCORE", ""), "risk_rating": r.get("RISK_RATNG", ""),
         "eal_total_usd": r.get("EAL_VALT", ""), "social_vulnerability": r.get("SOVI_SCORE", ""),
         "community_resilience": r.get("RESL_SCORE", "")}
    for p, label in HAZARDS.items():
        o[label + "_score"] = r.get(p + "_RISKS", "")
        o[label + "_rating"] = r.get(p + "_RISKR", "")
    return o

def county_hazards():
    manual = os.path.join(RAW, "NRI_Table_Counties.zip")
    path = manual if os.path.exists(manual) else arcgis_texas(NRI_COUNTY_LAYER, "nri_counties_tx.csv")
    if not path:
        print("  !! NRI county table unavailable - see instructions at top of file"); return []
    rows = []
    for r in read_csv_from(path):
        fips = str(r.get("STCOFIPS") or "").zfill(5)
        if fips.startswith("48"):
            rows.append(dict(county_fips=fips, county=r.get("COUNTY", ""), **nri_row(r)))
    return rows

def tract_hazards():
    manual = os.path.join(RAW, "NRI_Table_CensusTracts_Texas.zip")
    path = manual if os.path.exists(manual) else arcgis_texas(NRI_TRACT_LAYER, "nri_tracts_tx.csv")
    if not path:
        print("  !! NRI tract table unavailable - ZIP hazards will fall back to county values"); return {}
    out = {}
    for r in read_csv_from(path):
        t = str(r.get("TRACTFIPS") or "").zfill(11)
        if t.startswith("48"): out[t] = nri_row(r)
    return out

def zip_tract_weights():
    path = download(ZCTA_TRACT, "zcta_tract_2020.txt")
    w = defaultdict(list)
    if not path: return w
    with open(path, encoding="utf-8-sig") as f:
        hdr = next(f).rstrip("\r\n").split("|"); ix = {h: i for i, h in enumerate(hdr)}
        for line in f:
            p = line.rstrip("\r\n").split("|")
            z, t = p[ix["GEOID_ZCTA5_20"]], p[ix["GEOID_TRACT_20"]]
            if is_tx_zip(z) and t.startswith("48"):
                w[z].append((t, float(p[ix["AREALAND_PART"]] or 0)))
    return w

# ---------- ACS ----------
def acs_tables(tables):
    data = defaultdict(dict)
    for tb in tables:
        path = download(ACS % tb, "acs2024_%s.dat" % tb)
        if not path: continue
        with open(path, encoding="utf-8", errors="replace") as f:
            hdr = next(f).rstrip("\n").split("|")
            for line in f:
                if not line.startswith("860Z200US"): continue
                p = line.rstrip("\n").split("|"); z = p[0][9:]
                if is_tx_zip(z): data[z].update(zip(hdr[1:], p[1:]))
    return data

# ---------- Building permits ----------
def permits(years=(2022, 2023, 2024)):
    units = defaultdict(float); got = []
    for y in years:
        path = download(BPS % y, "bps_county_%d.txt" % y)
        if not path: continue
        got.append(y)
        with open(path, encoding="utf-8", errors="replace") as f:
            for row in csv.reader(f):
                # data rows: survey date, state FIPS, county FIPS, region, division, name, 1-unit bldgs, 1-unit units, ...
                if len(row) > 7 and row[1].strip() == "48" and row[2].strip().isdigit():
                    u = fnum(row[7])
                    if u is not None: units["48" + row[2].strip().zfill(3)] += u
    return {k: v / len(got) for k, v in units.items()} if got else {}

def main():
    print("1) FEMA NRI county hazards")
    ch = county_hazards()
    if ch: write("tx_county_hazards.csv", ch, list(ch[0].keys()))
    cby = {r["county_fips"]: r for r in ch}

    print("2) FEMA NRI tract hazards -> ZIP")
    th = tract_hazards(); zw = zip_tract_weights() if th else {}

    print("3) Census extras")
    acs = acs_tables(["b25040", "b25018", "b25035", "b25039", "b25003"])

    print("4) Building permits")
    bp = permits()

    # ZIP -> primary county from fetch_data.py output if present, else from tract weights
    zcounty = {}
    prof = os.path.join(OUT, "tx_zip_profile.csv")
    if os.path.exists(prof):
        for r in csv.DictReader(open(prof, encoding="utf-8", errors="replace")): zcounty[r["zip"]] = r["county_fips"]

    rows = []
    for z in sorted(set(acs) | set(zw)):
        a = acs.get(z, {}); o = {"zip": z}
        tot = fnum(a.get("B25040_E001"))
        o["electric_heat_share"] = round(fnum(a.get("B25040_E004")) / tot, 3) if tot and fnum(a.get("B25040_E004")) is not None else ""
        o["median_rooms"] = a.get("B25018_E001", "")
        yb = fnum(a.get("B25035_E001")); o["median_year_built"] = int(yb) if yb and yb > 1800 else ""
        ym = fnum(a.get("B25039_E002")); o["owner_median_year_moved_in"] = int(ym) if ym and ym > 1900 else ""
        # hazards: land-area weighted average of tract scores
        parts = [(th[t], w) for t, w in zw.get(z, []) if t in th and w > 0]
        cf = zcounty.get(z) or (zw[z][0][0][:5] if zw.get(z) else "")
        o["county_fips"] = cf
        if parts:
            wsum = sum(w for _, w in parts)
            for key in ["risk_score", "social_vulnerability", "community_resilience"] + [h + "_score" for h in HAZARDS.values()]:
                vals = [(fnum(r[key]), w) for r, w in parts if fnum(r[key]) is not None]
                o[key] = round(sum(v * w for v, w in vals) / sum(w for _, w in vals), 2) if vals else ""
            o["hazard_source"] = "tract"
        elif cf in cby:
            for key in ["risk_score", "social_vulnerability", "community_resilience"] + [h + "_score" for h in HAZARDS.values()]:
                o[key] = cby[cf].get(key, "")
            o["hazard_source"] = "county"
        occ = fnum(a.get("B25003_E001"))
        o["new_sf_homes_per_1k_households_county"] = ""
        if cf in bp:
            # county households = sum of ZIP occupied units assigned to that county (approximation)
            o["_cf_units"] = bp[cf]
        o["_occ"] = occ or 0
        rows.append(o)
    # permits per 1k households at county level
    hh = defaultdict(float)
    for o in rows: hh[o["county_fips"]] += o["_occ"]
    for o in rows:
        if "_cf_units" in o and hh[o["county_fips"]]:
            o["new_sf_homes_per_1k_households_county"] = round(1000 * o["_cf_units"] / hh[o["county_fips"]], 1)
    fields = ["zip", "county_fips", "hazard_source", "risk_score", "social_vulnerability", "community_resilience"] + \
             [h + "_score" for h in HAZARDS.values()] + \
             ["electric_heat_share", "median_rooms", "median_year_built", "owner_median_year_moved_in",
              "new_sf_homes_per_1k_households_county"]
    write("tx_zip_extra.csv", rows, fields)
    print("Done. Join to tx_zip_scores.csv on 'zip'.")

if __name__ == "__main__":
    main()
