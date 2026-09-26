#!/usr/bin/env python3
"""
Build the final ZIP-level "Resilience Demand Score" for the map.  Stdlib only, runs in seconds.
Run from the project folder:   python build_scores.py
Re-run any time fetch_data.py / fetch_extra.py finish with more years.

Inputs (data/):
  tx_zip_profile.csv            (fetch_data.py)  population, income, ownership, single-family, home value
  tx_county_outage_summary.csv  (fetch_data.py)  outage hours / event days per county
  tx_zip_extra.csv              (fetch_extra.py) FEMA hazards, electric heat, rooms, year moved in, permits
  tx_zip_utility.csv            (fetch_utility.py) which utility serves each ZIP, and whether Base sells there
Outputs:
  data/tx_zip_final.csv         one row per ZIP (ALL markets, flagged), sorted best-first, sub-scores + reasons
  data/tx_utility_summary.csv   per utility: how much high-demand demand sits in its territory
                                (use it to rank which utilities / co-ops to partner with next)

Market toggle: every ZIP is kept and flagged with `base_market`; the map can filter on it.
  python build_scores.py               console top-10 = Base's current market only
  python build_scores.py --all-markets console top-10 = all of Texas

Score = 0.40 Need + 0.30 Value to Base + 0.30 Ability & Ease   (each sub-score 0-100, Texas percentile based)
"""
import csv, io, os, sys, urllib.request, zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

# ---- Tunables -------------------------------------------------------------
WEIGHTS = {"need": 0.40, "value": 0.30, "ability": 0.30}
NEED = {"outage_hours": 0.35, "event_days": 0.15, "weather_hazard": 0.35, "electric_heat": 0.15}
VALUE = {"rooms": 0.50, "home_value": 0.30, "electric_heat": 0.20}
ABILITY = {"income": 0.40, "owner_rate": 0.30, "stability": 0.15, "growth": 0.15}
# FEMA NRI hazards that cause outages (scores are 0-100 national percentiles)
OUTAGE_HAZARDS = ["hurricane", "ice_storm", "winter_weather", "strong_wind", "cold_wave", "heat_wave", "tornado"]
# Serviceability gate (approximate - replace with a real ZIP->utility list when available)
MIN_POP, MIN_OWNER, MIN_SF = 500, 0.40, 0.50
HIGH_DEMAND = 70          # score at/above which a ZIP counts as "high demand" in the utility summary
BASE_MARKET_ONLY = "--all-markets" not in sys.argv
NOT_OPEN_TO_CHOICE = {  # fallback ONLY if tx_zip_utility.csv is missing
    "48453": "Austin Energy (most of Travis Co.)",
    "48029": "CPS Energy (most of Bexar Co.)",
}
# ---------------------------------------------------------------------------

def load(name, key):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        print("  (missing %s - skipping)" % name); return {}
    with open(path, encoding="utf-8", errors="replace") as f:
        return {r[key]: r for r in csv.DictReader(f)}

GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip"

def zip_points():
    """ZIP interior lat/lon from the Census Gazetteer (cached in data/raw/) - used to place ZIPs on the map."""
    path = os.path.join(DATA, "raw", "gaz_zcta_2020.zip")
    try:
        if not os.path.exists(path):
            print("  downloading ZIP map points (Census Gazetteer)")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            req = urllib.request.Request(GAZ, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f: f.write(r.read())
        z = zipfile.ZipFile(path)
        f = io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", errors="replace")
        hdr = [h.strip() for h in next(f).split("\t")]; ix = {h: i for i, h in enumerate(hdr)}
        out = {}
        for line in f:
            p = [c.strip() for c in line.split("\t")]
            out[p[ix["GEOID"]]] = (round(float(p[ix["INTPTLAT"]]), 5), round(float(p[ix["INTPTLONG"]]), 5))
        return out
    except Exception as e:
        print("  (could not load ZIP map points: %s)" % e); return {}

def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None

def pct_ranker(values):
    s = sorted(v for v in values if v is not None)
    n = len(s)
    def rank(v):
        if v is None or not n: return None
        import bisect            # mid-rank, so ties (e.g. ZIPs sharing a county value) aren't all "top 1%"
        return 100.0 * (bisect.bisect_left(s, v) + bisect.bisect_right(s, v)) / 2 / n
    return rank

def wavg(parts, weights):
    """Weighted average over the parts that exist (missing data re-weights instead of scoring 0)."""
    got = [(parts[k], w) for k, w in weights.items() if parts.get(k) is not None]
    return sum(v * w for v, w in got) / sum(w for _, w in got) if got else None

LABELS = {
    "outage_hours": "outage hours per customer", "event_days": "major outage days",
    "weather_hazard": "severe-weather risk (FEMA)", "electric_heat": "all-electric heating",
    "rooms": "home size", "home_value": "home value", "income": "household income",
    "owner_rate": "homeownership", "stability": "long-term owners", "growth": "new-home growth",
}

def main():
    prof = load("tx_zip_profile.csv", "zip")
    extra = load("tx_zip_extra.csv", "zip")
    outage = load("tx_county_outage_summary.csv", "county_fips")
    util = load("tx_zip_utility.csv", "zip")
    pts = zip_points()
    if not prof:
        print("Run fetch_data.py first."); return

    rows = []
    for z, p in prof.items():
        e = extra.get(z, {}); cf = p.get("county_fips") or e.get("county_fips", ""); o = outage.get(cf, {})
        haz = [num(e.get(h + "_score")) for h in OUTAGE_HAZARDS]
        haz = [h for h in haz if h is not None]
        moved = num(e.get("owner_median_year_moved_in"))
        rows.append({
            "zip": z, "county_fips": cf, "county_name": p.get("county_name", ""),
            "lat": pts.get(z, (None, None))[0], "lon": pts.get(z, (None, None))[1],
            "population": num(p.get("population")), "median_hh_income": num(p.get("median_hh_income")),
            "owner_rate": num(p.get("owner_rate")), "single_family_rate": num(p.get("single_family_rate")),
            "median_home_value": num(p.get("median_home_value")),
            "outage_hours": num(o.get("avg_annual_outage_hours_per_customer")),
            "event_days": num(o.get("event_days_per_year")),
            "weather_hazard": sum(haz) / len(haz) if haz else None,
            "electric_heat": num(e.get("electric_heat_share")), "rooms": num(e.get("median_rooms")),
            "stability": (2024 - moved) if moved else None,
            "growth": num(e.get("new_sf_homes_per_1k_households_county")),
            "fema_risk_score": num(e.get("risk_score")),
            **{h + "_score": num(e.get(h + "_score")) for h in OUTAGE_HAZARDS},
        })

    metrics = {"outage_hours", "event_days", "weather_hazard", "electric_heat", "rooms",
               "home_value", "income", "owner_rate", "stability", "growth"}
    src = {"home_value": "median_home_value", "income": "median_hh_income"}
    rankers = {m: pct_ranker([r[src.get(m, m)] for r in rows]) for m in metrics}

    for r in rows:
        pr = {m: rankers[m](r[src.get(m, m)]) for m in metrics}
        r["need_score"] = wavg(pr, NEED)
        r["value_score"] = wavg(pr, VALUE)
        r["ability_score"] = wavg(pr, ABILITY)
        subs = {"need": r["need_score"], "value": r["value_score"], "ability": r["ability_score"]}
        total = wavg(subs, WEIGHTS)
        # 1) is it a good-fit home area?
        why_not = []
        if (r["population"] or 0) < MIN_POP: why_not.append("small population")
        if (r["owner_rate"] or 0) < MIN_OWNER: why_not.append("mostly renters")
        if (r["single_family_rate"] or 0) < MIN_SF: why_not.append("mostly apartments")
        r["home_fit"] = "yes" if not why_not else "no"
        # 2) can Base sell there today?
        u = util.get(r["zip"])
        if u:
            r.update(utility=u.get("utility", ""), utility_type=u.get("utility_type", ""), market=u.get("market", ""),
                     grid=u.get("grid", ""), base_market=u.get("base_market", "no"),
                     any_base_tdsp_overlap=u.get("any_base_tdsp_overlap", ""),
                     ptc_median_1000kwh=u.get("ptc_median_1000kwh", ""),
                     res_rate=u.get("res_rate", ""), other_utilities_nearby=u.get("other_utilities_nearby", ""))
            if r["base_market"] == "no":
                why_not.append("%s (%s)" % (r["utility"] or "unknown utility", r["market"]))
            elif r["base_market"] == "partial":
                why_not.append("partly %s (%s)" % (r["utility"], r["market"]))
        elif util:   # utility file loaded but this ZIP had no match
            r.update(utility="", utility_type="", market="none", grid="", any_base_tdsp_overlap="", base_market="no")
            why_not.append("no utility match")
        else:
            r.update(utility="", utility_type="", market="", grid="", any_base_tdsp_overlap="",
                     base_market="no" if r["county_fips"] in NOT_OPEN_TO_CHOICE else "yes")
            if r["county_fips"] in NOT_OPEN_TO_CHOICE: why_not.append(NOT_OPEN_TO_CHOICE[r["county_fips"]])
        r["serviceable"] = "yes" if r["home_fit"] == "yes" and r["base_market"] in ("yes", "partial") else "no"
        r["not_serviceable_reason"] = "; ".join(why_not)
        r["resilience_demand_score"] = round(total, 1) if total is not None else ""
        # addressable homes: owner-occupied single-family (rough, ~2.6 people per household)
        hh = (r["population"] or 0) / 2.6
        r["addressable_homes"] = int(hh * min(r["owner_rate"] or 0, r["single_family_rate"] or 0))
        # top reasons (plain English, for the map click panel)
        top = sorted(((v, m) for m, v in pr.items() if v is not None and v >= 75), reverse=True)[:3]
        r["top_reasons"] = "; ".join("Top %d%% for %s" % (max(1, round(100 - v)), LABELS[m]) for v, m in top)

    rows.sort(key=lambda r: (r["serviceable"] != "yes", -(r["resilience_demand_score"] or 0)))
    fields = ["zip", "lat", "lon", "county_fips", "county_name", "serviceable", "home_fit", "base_market", "utility",
              "utility_type", "market", "grid", "ptc_median_1000kwh", "res_rate",
              "other_utilities_nearby", "not_serviceable_reason",
              "resilience_demand_score", "need_score", "value_score", "ability_score", "top_reasons",
              "addressable_homes", "population", "median_hh_income", "owner_rate", "single_family_rate",
              "median_home_value", "rooms", "electric_heat", "outage_hours", "event_days", "weather_hazard",
              "fema_risk_score"] + [h + "_score" for h in OUTAGE_HAZARDS] + ["stability", "growth"]
    out = os.path.join(DATA, "tx_zip_final.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore"); w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else int(v) if isinstance(v, float) and v.is_integer() and k != "resilience_demand_score"
                            else round(v, 3) if isinstance(v, float) else v) for k, v in r.items()})
    # ---- utility summary: where is the high-demand business, by utility? ----
    agg = defaultdict(lambda: {"zips": 0, "population": 0, "addressable_homes": 0, "hd_zips": 0, "hd_homes": 0, "wsum": 0.0, "w": 0.0})
    OPEN = "Open market (Oncor/CenterPoint/AEP/TNMP)"
    for r in rows:
        keys = [(r.get("utility") or "(unknown)", r.get("market") or "", r.get("base_market") or "")]
        if r.get("market") == "mixed":   # count split ZIPs under BOTH the co-op/city AND Base's open market
            keys.append((OPEN, "base_tdsp", "yes"))
        for key in keys:
            a = agg[key]; a["zips"] += 1; a["population"] += int(r["population"] or 0)
            if r["home_fit"] == "yes":
                a["addressable_homes"] += r["addressable_homes"]
                if (r["resilience_demand_score"] or 0) >= HIGH_DEMAND:
                    a["hd_zips"] += 1; a["hd_homes"] += r["addressable_homes"]
                if r["resilience_demand_score"] != "":
                    a["wsum"] += r["resilience_demand_score"] * r["addressable_homes"]; a["w"] += r["addressable_homes"]
    summ = [{"utility": k[0], "market": k[1], "base_market": k[2], "zips": a["zips"], "population": a["population"],
             "addressable_homes": a["addressable_homes"], "high_demand_zips": a["hd_zips"],
             "high_demand_homes": a["hd_homes"], "avg_score_weighted": round(a["wsum"] / a["w"], 1) if a["w"] else ""}
            for k, a in agg.items()]
    summ.sort(key=lambda d: -d["high_demand_homes"])
    with open(os.path.join(DATA, "tx_utility_summary.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(summ[0].keys())); w.writeheader(); w.writerows(summ)

    ok = [r for r in rows if r["serviceable"] == "yes"] if BASE_MARKET_ONLY else [r for r in rows if r["home_fit"] == "yes"]
    print("wrote data/tx_zip_final.csv: %d ZIPs, %d good-fit ZIPs, %d in Base's market"
          % (len(rows), sum(r["home_fit"] == "yes" for r in rows), sum(r["serviceable"] == "yes" for r in rows)))
    print("wrote data/tx_utility_summary.csv (%d utilities)" % len(summ))
    print("\nTop utilities by high-demand homes (score >= %d):" % HIGH_DEMAND)
    for d in summ[:8]:
        print("  %-42s %-14s %8d homes  (%d ZIPs)" % (d["utility"][:42], d["market"], d["high_demand_homes"], d["high_demand_zips"]))
    print("\nTop 10 ZIPs (%s):" % ("Base's current market" if BASE_MARKET_ONLY else "all markets"))
    for r in ok[:10]:
        print("  %s  %-18s %-22s %5.1f   %s" % (r["zip"], r["county_name"][:18], (r.get("utility") or "")[:22],
                                           r["resilience_demand_score"] or 0, r["top_reasons"]))

if __name__ == "__main__":
    main()
