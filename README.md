<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-light.png">
    <img src="logo-light.png" alt="Livewire BI" width="400">
  </picture>
</h1>

Ranks Texas ZIP codes by demand for home battery backup. Built for the Base Power × AITX Talent Hackathon.

![Livewire BI: the map, the sales call view and the statewide events page](interface.png)

Live demo: [https://keithkritselis.com/base/](https://keithkritselis.com/base/)

## Quick start

Review the live demo above... Rebuilding data from source will take a minimum of an hour to setup.  Instructions for this are at the bottom.

## Tech stack & architecture

**Stack:** PHP + HTML/CSS/vanilla JS for the app. Python 3 (stdlib only) for the data pipeline. No database, no framework, no npm.

```
Public datasets
      |
      v
fetch_*.py  -------->  data/*.csv  *.json  *.geojson
      |
      v
build_scores.py  --->  scored ZIP / utility CSVs
      |
      v
PHP pages + vanilla JS     (index.php, rep.html, events.html, plan.html)
      |
      +-- permits.php / news.php  (live, optional; cached in data/cache/)
```

`Score = 0.40 × Need + 0.30 × Value + 0.30 × Ability`. Weights are sliders in the map.

## How to reproduce the demo

An API key is necessary to load the map images, without this key the app still functions.   
  
No `.env` required. Clone, start PHP, open the browser.

`permits.php` and `news.php` (marketing plan page) call public APIs with no key. They need outbound HTTP (`cURL` or `allow_url_fopen`) and write cache files to `data/cache/` if `data/` is writable. If those calls fail, the rest of the app still works.

Optional env var for offline fixtures:

```
# .env — nothing required
# LW_FIXTURES=./fixtures
```

```bash
export LW_FIXTURES=./fixtures   # only if you have local fixture files
php -S localhost:8000
```



## Datasets & provenance

No synthetic data. Everything is public:


| Dataset                         | Source                                                                                                 | Use                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| County power outages, 2018–2025 | DOE EAGLE-I, © Oak Ridge National Laboratory, CC BY 4.0, doi:10.6084/m9.figshare.24237376              | Outage hours, notable days, statewide timeline |
| Storm reports, 2018–2025        | NOAA NCEI Storm Events Database                                                                        | Cause of each notable outage day               |
| Natural hazards                 | FEMA National Risk Index (Dec 2025), county + census tract                                             | Need score                                     |
| Demographics / housing          | U.S. Census ACS 2020–2024 5-year, ZCTA relationship + Gazetteer                                        | Score inputs                                   |
| ZIP / county boundaries         | Census TIGERweb                                                                                        | Map                                            |
| Building permits (new homes)    | Census Building Permits Survey 2022–2024                                                               | Ability score                                  |
| Base Power installs             | City of Austin Open Data, Issued Construction Permits (Socrata 3syk-w9eu)                              | Marketing plan, live                           |
| Press mentions                  | Publisher RSS search feeds (Electrek, pv magazine USA, TechCrunch, CleanTechnica, Energy-Storage.news) | Marketing plan, live                           |
| Load-zone prices, 2018–2025     | ERCOT report 13061 (15-min RTM)                                                                        | Battery grid-value nudge                       |
| Wires company / plans per ZIP   | PUCT Power to Choose                                                                                   | Utility filter                                 |
| Utility rates by ZIP (2024)     | DOE/NREL, from EIA Form 861                                                                            | Local price                                    |
| Basemap                         | © OpenStreetMap contributors © CARTO                                                                   | Map tiles                                      |


Processed outputs live in `data/` and are committed. Raw downloads go in `data/raw/` (git-ignored).

## Known limitations

- Outage history is county-level; every ZIP in a county shares it.
- Outage causes are date-matched to NOAA reports, not utility-reported causes.
- Restoration times are rough in counties with few major events.
- ERCOT zone per ZIP is approximated; the battery-value number assumes perfect foresight of each day's cheapest/priciest 2 hours.
- One Power to Choose lookup per ZIP; boundary ZIPs can be split in reality.
- Scores rank ZIPs against each other. Not a sales forecast.




MIT License. Not an official Base product.


<hr>





## Data rebuild process

Processed data is already in `data/`. You only need PHP.

```bash
php -S localhost:8000
```

Open [http://localhost:8000](http://localhost:8000)

- Map: `/`
- Sales call view: `/rep.html?zip=77523`
- Statewide events: `/events.html`
- Marketing plan: `/plan.html`

To rebuild the data from source (optional, Python 3, no pip packages):

```bash
python fetch_data.py
python fetch_extra.py
python fetch_utility.py
python fetch_shapes.py
python fetch_events.py
python fetch_duration.py
python fetch_ercot.py
python build_scores.py
```

`fetch_data.py` downloads ~10 GB on first run (cached in `data/raw/`, not committed). The rest are smaller.