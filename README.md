# Livewire

**Where Texas needs home backup next.** Livewire ranks every Texas ZIP code by how much it needs, and can buy, whole-home battery
backup. It then shows which utility stands between Base and each customer.

**Live demo:** https://keithkritselis.com/base/
Built solo for the **Base Power × AITX Talent Hackathon** (Austin, Sep 25–27, 2026). Tracks: **Open Grid Data** + **Most Commercializable**.

---

## The insight

Texas's biggest outages are mostly **local**, not grid-wide. Of the largest statewide outage days since 2018, only Winter Storm Uri
(Feb 2021, 4.26M customers out at once) was an ERCOT supply failure. The rest were storms tearing down local wires: Hurricane Nicholas,
Hurricane Laura, Hurricane Hanna, the 2019 Dallas derecho and tornado. More power plants don't fix those; **backup at the home does.**
That's Base's product. Livewire finds the homes that need it most, and shows whether Base can reach them today.

| Date | Peak customers out | What happened | Type |
|---|---|---|---|
| 2021-02-16 | 4,257,874 | Winter Storm Uri | Grid-wide (supply) |
| 2021-09-14 | 523,960 | Hurricane Nicholas | Local wires |
| 2019-06-09 | 384,428 | Dallas derecho | Local wires |
| 2020-08-27 | 299,096 | Hurricane Laura | Local wires |
| 2020-07-26 | 238,030 | Hurricane Hanna | Local wires |
| 2019-10-21 | 187,308 | Dallas tornado | Local wires |

## What it does

- **Scores ~1,900 Texas ZIP codes (0–100)** on a "Resilience Demand Score": how much a ZIP needs backup, and how good a customer it is.
- **Market toggle: "Base market today" vs "All of Texas."** Every ZIP is tagged with its actual utility (from the state's Power to
  Choose data), so Livewire shows both where Base can sell now and where it can't.
- **Utility ranking.** Outside Base's market (Oncor, CenterPoint, AEP Texas, TNMP), the same scoring shows which co-ops and city
  utilities hold the most high-demand homes. That makes it a **partnership lead list** for Base's Backup-Only offering
  (e.g. CPS Energy in San Antonio, the co-ops ringing Dallas–Fort Worth).
- **Explainable scores.** Click any ZIP to see its score broken into Need / Value / Ability, the top reasons in plain English
  ("Top 5% for severe-weather risk"), outage history, FEMA hazards, and the local electricity price.
- **Live weight tuning.** Sliders re-weight the model instantly, e.g. "what if we care most about need?"

## How the score works

`Score = 0.40 × Need + 0.30 × Value to Base + 0.30 × Ability & Ease`, each part scored 0–100 as a Texas percentile.

| Part | Signals |
|---|---|
| **Need** | Outage hours per customer and notable-outage days (DOE EAGLE-I, 2018–2025); FEMA risk for hurricane, ice storm, winter weather, wind, tornado, cold and heat waves; share of all-electric homes (lose heat in a winter outage) |
| **Value to Base** | Home size (median rooms), home value, electric load |
| **Ability & Ease** | Household income, homeownership, long-term owners (Base plans are 36 months), new single-family construction |
| **Filters** | *Good-fit homes:* 500+ residents, 40%+ owner-occupied, 50%+ single-family. *Base market:* Oncor / CenterPoint / AEP Texas / TNMP per Power to Choose |

Missing data re-weights instead of counting as zero. Weights and cutoffs live at the top of `build_scores.py`.

## Data pipeline

Plain Python (standard library only, no installs) → CSVs → one PHP page. No database.

```
fetch_data.py     DOE EAGLE-I outages (15-min snapshots, ~10 GB streamed, Texas kept) + Census ACS by ZIP
                  → cleans stuck readings / duplicates → county outage stats, statewide daily peaks
fetch_extra.py    FEMA National Risk Index (county + census tract → ZIP), extra Census columns, building permits
fetch_utility.py  Power to Choose (every Texas ZIP) + EIA-861 via NREL → utility + market for each ZIP, local prices
build_scores.py   joins everything → data/tx_zip_final.csv (+ ZIP map points) and data/tx_utility_summary.csv
index.php         Leaflet map + panels, styled with Base's brand (see DESIGN.md)
```

### Run it

```bash
python fetch_data.py        # first run downloads ~10 GB (cached in data/raw/, git-ignored); ~20–30 min
python fetch_extra.py       # can run alongside fetch_data.py
python fetch_utility.py     # ~2,300 Power to Choose lookups, ~5–10 min, resumable
python build_scores.py      # seconds; add --all-markets to print the statewide top 10
php -S localhost:8000       # open http://localhost:8000
```

The processed CSVs in `data/` are committed, so the map runs right after cloning. The fetch scripts are only needed to rebuild.

## Repo layout

```
index.php            the app
build_scores.py      scoring model
fetch_*.py           data pipeline
data/*.csv           processed outputs (committed)
data/raw/            downloads cache (git-ignored)
DESIGN.md            Base brand tokens used for styling
```

## Data sources

- **DOE EAGLE-I** county power outages, 2014–2025, © Oak Ridge National Laboratory, CC BY 4.0. doi:10.6084/m9.figshare.24237376
- **FEMA National Risk Index** (Dec 2025), counties and census tracts
- **U.S. Census Bureau:** ACS 2020–2024 5-year (population, income, tenure, units in structure, home value, heating fuel, rooms,
  year moved in), 2020 ZIP (ZCTA) relationship files and Gazetteer, Building Permits Survey 2022–2024
- **PUCT Power to Choose:** open-market plans and wires company for each ZIP
- **DOE/NREL Utility Rates by ZIP (2024)**, from EIA Form 861: co-op, city and non-ERCOT utility names and residential rates

## Limitations

- Outage data is **county-level**; every ZIP in a county shares its outage history. The script removes stuck utility-map readings
  (the same count repeated for 3+ days) and caps the top 1% of values.
- A "notable outage day" means 2%+ of a county's customers were out at once, usually a small area for a few hours.
- Utility assignment uses one lookup per ZIP; ZIPs on a service boundary can be split in reality.
- Scores rank ZIPs against each other. They're a targeting aid, not a forecast of sales.

## Next steps

- Label each outage event grid-wide vs. local using ERCOT supply/demand and prices for the same dates (a deeper Track 1 tie-in)
- Add ERCOT load-zone price volatility to "Value to Base" (batteries in spikier zones earn more for the grid)
- ZIP boundary polygons instead of points; exportable lead lists by utility

---

Styling follows Base Power's public brand using free substitute fonts; no Base font or logo files are included.
Built for the Base Power × AITX Hackathon. **Not an official Base product.** See `LICENSE`.
