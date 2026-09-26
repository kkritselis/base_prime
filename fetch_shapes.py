#!/usr/bin/env python3
"""
Download simplified Texas ZIP (ZCTA) and county boundaries for the map.   Stdlib only.
Run from the project folder:   python fetch_shapes.py        (~1-3 min, one time)

Source: U.S. Census Bureau TIGERweb map services (public, returns GeoJSON directly).
Outputs (small enough to commit and upload with index.php):
  data/tx_zips.geojson       one polygon per Texas ZIP in tx_zip_final.csv   (property: zip)
  data/tx_counties.geojson   254 Texas county outlines                        (property: name)
"""
import csv, json, os, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
UA = {"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"}
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/%s/MapServer/%d/query"
TX_BOX = "-106.7,25.8,-93.5,36.6"
ZCTA_LAYERS = [("PUMA_TAD_TAZ_UGA_ZCTA", i) for i in (7, 1, 4, 11)]      # 2020 ZCTAs; first that works wins
COUNTY_LAYERS = [("State_County", i) for i in (1, 3, 5, 7, 9, 11, 13)]    # any current county layer

def query(service, layer, params):
    url = TIGER % (service, layer) + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return json.load(r)

def fetch_all(layers, base_params, what):
    for service, layer in layers:
        feats, offset = [], 0
        try:
            while True:
                j = query(service, layer, dict(base_params, resultOffset=offset, resultRecordCount=250))
                if "error" in j: raise RuntimeError(j["error"].get("message"))
                page = j.get("features", [])
                feats += page; offset += len(page)
                print("    %s: %d" % (what, len(feats)))
                if not page or not (j.get("exceededTransferLimit") or j.get("properties", {}).get("exceededTransferLimit")):
                    break
            if feats and "GEOID" in (feats[0].get("properties") or {}):
                return feats
            print("    layer %d has no GEOID field, trying next" % layer)
        except Exception as e:
            print("    layer %d failed (%s), trying next" % (layer, e))
    raise SystemExit("Could not download %s boundaries from TIGERweb." % what)

def round_coords(g, nd=4):
    if isinstance(g, list):
        if g and isinstance(g[0], (int, float)): return [round(g[0], nd), round(g[1], nd)]
        return [round_coords(x, nd) for x in g]
    return g

def save(name, feats, prop_map):
    out = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {k: f["properties"].get(v) for k, v in prop_map.items()},
         "geometry": {"type": f["geometry"]["type"], "coordinates": round_coords(f["geometry"]["coordinates"])}}
        for f in feats if f.get("geometry")]}
    path = os.path.join(DATA, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print("  wrote data/%s (%d shapes, %.1f MB)" % (name, len(out["features"]), os.path.getsize(path) / 1e6))

def main():
    final = os.path.join(DATA, "tx_zip_final.csv")
    want = None
    if os.path.exists(final):
        with open(final, encoding="utf-8", errors="replace") as f:
            want = {r["zip"] for r in csv.DictReader(f)}

    common = {"geometry": TX_BOX, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
              "returnGeometry": "true", "outSR": 4326, "geometryPrecision": 4, "f": "geojson"}

    print("1) ZIP boundaries (Census TIGERweb)")
    z = fetch_all(ZCTA_LAYERS, dict(common, where="1=1", maxAllowableOffset=0.002), "ZIPs")
    z = [f for f in z if (want is None and str(f["properties"]["GEOID"])[:2] in ("75", "76", "77", "78", "79"))
         or (want is not None and str(f["properties"]["GEOID"]) in want)]
    save("tx_zips.geojson", z, {"zip": "GEOID"})

    print("2) County boundaries")
    c = fetch_all(COUNTY_LAYERS, dict(common, where="STATE='48'", maxAllowableOffset=0.004), "counties")
    save("tx_counties.geojson", c, {"name": "NAME", "fips": "GEOID"})

if __name__ == "__main__":
    main()
