<?php
// Resilience Demand Map - reads data/tx_zip_final.csv (from build_scores.py) and renders a Leaflet map.
// Run locally from the project folder:   php -S localhost:8000     then open http://localhost:8000
$csvPath = __DIR__ . '/data/tx_zip_final.csv';
$keep = ['zip','lat','lon','county_name','serviceable','home_fit','base_market','utility','utility_type','market',
  'not_serviceable_reason','resilience_demand_score','need_score','value_score','ability_score','top_reasons',
  'addressable_homes','population','median_hh_income','owner_rate','single_family_rate','median_home_value','rooms',
  'electric_heat','outage_hours','event_days','weather_hazard','hurricane_score','ice_storm_score','winter_weather_score',
  'strong_wind_score','cold_wave_score','heat_wave_score','tornado_score','ptc_median_1000kwh','res_rate','growth'];
$text = ['zip','county_name','serviceable','home_fit','base_market','utility','utility_type','market','not_serviceable_reason','top_reasons'];
$rows = []; $err = '';
if (!file_exists($csvPath)) {
  $err = 'data/tx_zip_final.csv not found - run: python build_scores.py';
} else {
  $fh = fopen($csvPath, 'r');
  $hdr = fgetcsv($fh, 0, ',', '"', '');
  while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
    if (count($r) !== count($hdr)) continue;
    $a = array_combine($hdr, $r); $o = [];
    foreach ($keep as $k) {
      $v = $a[$k] ?? '';
      $o[$k] = in_array($k, $text) ? $v : ($v === '' ? null : $v + 0);
    }
    if ($o['lat'] !== null) $rows[] = $o;
  }
  fclose($fh);
  if (!$rows) $err = 'No ZIPs with map points - re-run build_scores.py (it adds lat/lon).';
}
$updated = file_exists($csvPath) ? date('M j, Y g:ia', filemtime($csvPath)) : '';
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Livewire: "Where Texas needs backup next."</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Zilla+Slab:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
:root{
  --terminal:#292826; --grey-80:#54524F; --grey-60:#7F7D7A; --grey-40:#A9A8A7; --grey-20:#D8D7D5; --conduit:#F0EEEB;
  --grounded:#1E4D2B; --green-100:#102A17; --green-60:#77A45A; --livewire:#B2DD79; --green-5:#D6F0B4;
  --energy:#ED6C30; --goldenrod:#F7C33C; --white:#fff;
  --font:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; --display:"Zilla Slab",Georgia,serif;
  --r-md:8px; --r-card:20px; --r-pill:9999px; --shadow:0 2px 8px rgba(0,0,0,.08);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--conduit);color:var(--terminal);font:400 14px/1.5 var(--font);letter-spacing:.2px;display:flex;flex-direction:column}
header{background:var(--grounded);color:#fff;padding:12px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.eyebrow{font:700 11px/1 var(--display);letter-spacing:.6px;text-transform:uppercase;color:var(--livewire)}
h1{font-size:20px;font-weight:600;margin:4px 0 0;letter-spacing:0}
.spacer{flex:1}
.seg{display:inline-flex;background:rgba(255,255,255,.12);border-radius:var(--r-pill);padding:3px}
.seg button{border:0;background:transparent;color:#fff;font:600 13px var(--font);padding:7px 14px;border-radius:var(--r-pill);cursor:pointer}
.seg button.on{background:var(--livewire);color:var(--grounded)}
.ctl{display:flex;align-items:center;gap:8px;font-size:13px}
.ctl input[type=range]{accent-color:var(--livewire);width:110px}
main{flex:1;display:flex;min-height:0}
aside{width:380px;flex:none;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
#map{flex:1;min-height:300px}
.card{background:#fff;border-radius:var(--r-card);box-shadow:var(--shadow);padding:16px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.kpi .v{font-size:22px;font-weight:600;color:var(--grounded);line-height:1.1}
.kpi .l{font-size:11px;color:var(--grey-60);text-transform:uppercase;letter-spacing:.48px;font-weight:500}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{border:1px solid var(--grey-20);background:var(--conduit);font:600 12px var(--font);padding:5px 12px;border-radius:var(--r-pill);cursor:pointer;color:var(--terminal)}
.tabs button.on{background:var(--grounded);border-color:var(--grounded);color:#fff}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;font-weight:500;color:var(--grey-60);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:4px 4px;border-bottom:1px solid var(--grey-20)}
td{padding:6px 4px;border-bottom:1px solid #f3f2f0;vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.click{cursor:pointer} tr.click:hover{background:var(--conduit)}
.chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);background:var(--conduit);color:var(--grey-80);white-space:nowrap}
.chip.base{background:var(--green-5);color:var(--grounded)}
.big{font-size:44px;font-weight:600;color:var(--grounded);line-height:1}
.bar{display:grid;grid-template-columns:70px 1fr 34px;align-items:center;gap:8px;font-size:12px;margin:5px 0}
.bar .t{height:8px;background:var(--conduit);border-radius:4px;overflow:hidden}
.bar .f{height:100%;background:var(--grounded);border-radius:4px}
.reasons{margin:10px 0 0;padding-left:18px;color:var(--grey-80)}
.muted{color:var(--grey-60)} .small{font-size:12px}
.stats{display:grid;grid-template-columns:1fr;gap:0;font-size:12.5px;margin-top:10px}
.stats div{display:flex;justify-content:space-between;border-bottom:1px solid #f3f2f0;padding:3px 0}
.stats b{font-weight:600}
.legend{background:#fff;padding:10px 12px;border-radius:12px;box-shadow:var(--shadow);font:12px var(--font);color:var(--terminal)}
.legend .row{display:flex;align-items:center;gap:6px;margin:3px 0}
.legend .sw{width:12px;height:12px;border-radius:50%;display:inline-block}
.leaflet-tooltip{font:12px var(--font);border-radius:8px}
details summary{cursor:pointer;font-weight:600;font-size:13px}
.w{display:grid;grid-template-columns:70px 1fr 34px;gap:8px;align-items:center;font-size:12px;margin-top:6px}
.w input{accent-color:var(--grounded)}
footer{font-size:11px;color:var(--grey-60);padding:6px 20px;background:var(--conduit)}
.err{margin:40px auto;max-width:520px}
@media (max-width:820px){main{flex-direction:column-reverse} aside{width:100%;max-height:50vh}}
</style>
</head>
<body>
<header>
  <div>
    <div class="eyebrow">Built for Base Power × AITX Hackathon</div>
    <h1>Livewire: "Where Texas needs backup next."</h1>
  </div>
  <div class="spacer"></div>
  <div class="seg" role="tablist" aria-label="Market">
    <button id="mBase" class="on">Base market today</button>
    <button id="mAll">All of Texas</button>
  </div>
  <label class="ctl">Min score <input id="minScore" type="range" min="0" max="90" step="5" value="0"> <span id="minScoreV">0</span></label>
  <label class="ctl"><input id="fitOnly" type="checkbox" checked> Good-fit homes only</label>
</header>

<?php if ($err): ?>
  <div class="card err"><b>Data not ready.</b><p><?= htmlspecialchars($err) ?></p></div>
<?php else: ?>
<main>
  <aside>
    <div class="card kpis">
      <div class="kpi"><div class="v" id="kZips">–</div><div class="l">ZIPs shown</div></div>
      <div class="kpi"><div class="v" id="kHomes">–</div><div class="l">Fit homes</div></div>
      <div class="kpi"><div class="v" id="kHD">–</div><div class="l">High-demand homes (70+)</div></div>
    </div>

    <div class="card" id="detail">
      <div class="muted">Click a ZIP on the map or in the list to see why it scores the way it does.</div>
    </div>

    <div class="card">
      <div class="tabs"><button id="tZips" class="on">Top ZIPs</button><button id="tUtil">By utility</button></div>
      <div id="list"></div>
    </div>

    <div class="card">
      <details>
        <summary>Model weights</summary>
        <div class="w"><span>Need</span><input id="wNeed" type="range" min="0" max="100" value="40"><span id="wNeedV">40</span></div>
        <div class="w"><span>Value</span><input id="wValue" type="range" min="0" max="100" value="30"><span id="wValueV">30</span></div>
        <div class="w"><span>Ability</span><input id="wAbility" type="range" min="0" max="100" value="30"><span id="wAbilityV">30</span></div>
        <p class="small muted">Need = outage history, severe-weather risk, electric heat. Value = home size, home value, electric load.
          Ability = income, homeownership, long-term owners, new-home growth. Weights re-normalize automatically.</p>
      </details>
    </div>
  </aside>
  <div id="map"></div>
</main>
<footer>Data: DOE EAGLE-I outages (ORNL, CC BY 4.0) · FEMA National Risk Index · U.S. Census ACS 2020–24 · PUCT Power to Choose · EIA-861 via NREL. Scores updated <?= htmlspecialchars($updated) ?>. Not an official Base product.</footer>

<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const ROWS = <?= json_encode($rows, JSON_UNESCAPED_SLASHES) ?>;
const HIGH = 70;
// Sequential ramp, one hue (Base greens), light -> dark = low -> high demand
const BINS = [[70,'#1E4D2B'],[60,'#77A45A'],[50,'#B2DD79'],[0,'#D6F0B4']];
const colorFor = s => s == null ? '#D8D7D5' : BINS.find(b => s >= b[0])[1];
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString();
const fmt = n => n == null ? '–' : Math.round(n).toLocaleString();
const pct = n => n == null ? '–' : Math.round(n * 100) + '%';
const money = n => n == null ? '–' : '$' + Math.round(n).toLocaleString();
const $ = id => document.getElementById(id);

const state = { market: 'base', min: 0, fitOnly: true, tab: 'zips', sel: null, w: { need: 40, value: 30, ability: 30 } };

function score(r) {
  const parts = [[r.need_score, state.w.need], [r.value_score, state.w.value], [r.ability_score, state.w.ability]]
    .filter(p => p[0] != null && p[1] > 0);
  const W = parts.reduce((a, p) => a + p[1], 0);
  return W ? parts.reduce((a, p) => a + p[0] * p[1], 0) / W : null;
}
function inMarket(r) { return state.market === 'all' || r.base_market === 'yes'; }
function visible() {
  return ROWS.filter(r => inMarket(r) && (!state.fitOnly || r.home_fit === 'yes') && (r._s ?? 0) >= state.min);
}

// ---- map ----
const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([31.2, -99.3], 6);
L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_3ysp_1_2a15d445d1f58077f3c8984d', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 14 }).addTo(map);
const layer = L.layerGroup().addTo(map);
const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const d = L.DomUtil.create('div', 'legend');
  d.innerHTML = '<b>Resilience demand</b>' + BINS.map((b, i) =>
    `<div class="row"><span class="sw" style="background:${b[1]}"></span>${i ? b[0] + '–' + (BINS[i-1][0]-1) : b[0] + '+'}</div>`).join('') +
    '<div class="row"><span class="sw" style="background:#fff;border:1.5px solid #1E4D2B"></span>Base market (solid ring)</div>' +
    '<div class="row"><span class="sw" style="background:#fff;border:2px dashed #54524F"></span>Outside Base market</div>' +
    '<div class="small muted">Dot size = fit homes</div>';
  return d;
};
legend.addTo(map);

function draw() {
  ROWS.forEach(r => r._s = score(r));
  layer.clearLayers();
  const vis = visible().sort((a, b) => (a._s ?? 0) - (b._s ?? 0));   // high scores drawn on top
  vis.forEach(r => {
    const base = r.base_market === 'yes';
    const rad = Math.max(4, Math.min(18, 3 + Math.sqrt(r.addressable_homes || 0) / 9));
    const m = L.circleMarker([r.lat, r.lon], {
      radius: rad, fillColor: colorFor(r._s), fillOpacity: r.home_fit === 'yes' ? 0.9 : 0.35,
      color: base ? '#1E4D2B' : '#54524F', opacity: base ? 0.7 : 0.9, weight: base ? 1 : 1.2, dashArray: base ? null : '3 2'
    });
    m.bindTooltip(`<b>${r.zip}</b> · ${r.county_name}<br>Score <b>${r._s == null ? '–' : r._s.toFixed(0)}</b> · ${r.utility || 'unknown utility'}`,
      { direction: 'top', offset: [0, -rad] });
    m.on('click', () => select(r.zip, false));
    m.addTo(layer);
  });
  // KPIs
  const fit = vis.filter(r => r.home_fit === 'yes');
  $('kZips').textContent = vis.length.toLocaleString();
  $('kHomes').textContent = compact(fit.reduce((a, r) => a + (r.addressable_homes || 0), 0));
  $('kHD').textContent = compact(fit.filter(r => (r._s ?? 0) >= HIGH).reduce((a, r) => a + (r.addressable_homes || 0), 0));
  renderList(vis);
  if (state.sel) renderDetail(ROWS.find(r => r.zip === state.sel));
}

function renderList(vis) {
  const el = $('list');
  if (state.tab === 'zips') {
    const top = vis.filter(r => r.home_fit === 'yes').sort((a, b) => (b._s ?? 0) - (a._s ?? 0)).slice(0, 25);
    el.innerHTML = '<table><tr><th>ZIP</th><th>County</th><th class="n">Homes</th><th class="n">Score</th></tr>' +
      top.map(r => `<tr class="click" data-zip="${r.zip}"><td><b>${r.zip}</b></td><td>${r.county_name.replace(' County','')}</td>
        <td class="n">${fmt(r.addressable_homes)}</td><td class="n"><b>${r._s.toFixed(0)}</b></td></tr>`).join('') + '</table>';
    el.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => select(tr.dataset.zip, true));
  } else {
    const g = {};
    vis.filter(r => r.home_fit === 'yes').forEach(r => {
      const k = r.utility || '(unknown)';
      const a = g[k] || (g[k] = { name: k, market: r.market, homes: 0, hd: 0, zips: 0 });
      a.zips++; a.homes += r.addressable_homes || 0;
      if ((r._s ?? 0) >= HIGH) a.hd += r.addressable_homes || 0;
    });
    const list = Object.values(g).sort((a, b) => b.hd - a.hd || b.homes - a.homes).slice(0, 20);
    el.innerHTML = '<p class="small muted" style="margin:0 0 6px">High-demand = score ' + HIGH + '+. Outside Base\'s market these are partnership leads.</p>' +
      '<table><tr><th>Utility</th><th class="n">High-demand homes</th><th class="n">Fit homes</th></tr>' +
      list.map(u => `<tr><td>${u.name}<br><span class="chip ${u.market === 'base_tdsp' ? 'base' : ''}">${label(u.market)}</span></td>
        <td class="n"><b>${fmt(u.hd)}</b></td><td class="n">${fmt(u.homes)}</td></tr>`).join('') + '</table>';
  }
}
const label = m => ({ base_tdsp: 'Base market', competitive: 'Open market', coop: 'Co-op', municipal: 'City utility',
  ioi_non_ercot: 'Non-ERCOT utility', none: 'Unknown' }[m] || m || 'Unknown');

function select(zip, fly) {
  state.sel = zip;
  const r = ROWS.find(x => x.zip === zip);
  if (fly && r) map.flyTo([r.lat, r.lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
  renderDetail(r);
}
function renderDetail(r) {
  if (!r) return;
  const bar = (n, v) => `<div class="bar"><span>${n}</span><div class="t"><div class="f" style="width:${v ?? 0}%"></div></div><b>${v == null ? '–' : Math.round(v)}</b></div>`;
  const price = r.base_market === 'yes' || r.market === 'competitive'
    ? ['Open-market price', r.ptc_median_1000kwh == null ? '–' : r.ptc_median_1000kwh.toFixed(1) + '¢/kWh']
    : ['Utility res. rate', r.res_rate == null ? '–' : (r.res_rate * 100).toFixed(1) + '¢/kWh'];
  const haz = [['Hurricane', r.hurricane_score], ['Ice storm', r.ice_storm_score], ['Winter', r.winter_weather_score],
    ['Wind', r.strong_wind_score], ['Tornado', r.tornado_score], ['Cold wave', r.cold_wave_score], ['Heat wave', r.heat_wave_score]]
    .filter(h => h[1] != null).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('detail').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><div style="font-size:18px;font-weight:600">${r.zip}</div><div class="muted">${r.county_name}</div>
        <div style="margin-top:6px"><span class="chip ${r.base_market === 'yes' ? 'base' : ''}">${label(r.market)}</span>
        <span class="small muted">${r.utility || ''}</span></div></div>
      <div style="text-align:right"><div class="big">${r._s == null ? '–' : r._s.toFixed(0)}</div><div class="small muted">of 100</div></div>
    </div>
    ${bar('Need', r.need_score)}${bar('Value', r.value_score)}${bar('Ability', r.ability_score)}
    ${r.top_reasons ? '<ul class="reasons">' + r.top_reasons.split('; ').map(x => `<li>${x}</li>`).join('') + '</ul>' : ''}
    ${r.not_serviceable_reason ? `<p class="small" style="color:#742C0B;margin:8px 0 0">⚠ ${r.not_serviceable_reason}</p>` : ''}
    <div class="stats">
      <div><span>Fit homes</span><b>${fmt(r.addressable_homes)}</b></div>
      <div><span>Median income</span><b>${money(r.median_hh_income)}</b></div>
      <div><span>Owner-occupied</span><b>${pct(r.owner_rate)}</b></div>
      <div><span>Single-family</span><b>${pct(r.single_family_rate)}</b></div>
      <div><span title="Total customer-hours without power per year ÷ customers in the county (2018–2025)">Hours without power / customer / yr*</span><b>${r.outage_hours == null ? '–' : r.outage_hours.toFixed(1)}</b></div>
      <div><span title="Days per year when at least 2% of the county's customers (min. 100) were out at the same time">Days with a notable outage / yr*</span><b>${r.event_days == null ? '–' : r.event_days.toFixed(0)}</b></div>
      <div><span>Electric heat</span><b>${pct(r.electric_heat)}</b></div>
      <div><span>Median rooms</span><b>${r.rooms == null ? '–' : r.rooms.toFixed(1)}</b></div>
      <div><span>${price[0]}</span><b>${price[1]}</b></div>
      <div><span>Home value</span><b>${money(r.median_home_value)}</b></div>
    </div>
    <p class="small muted" style="margin:8px 0 0">* County-level, 2018–2025 (DOE EAGLE-I). A "notable outage" day = 2%+ of the county's
      customers out at once, usually a small area for a few hours. Stuck utility-map readings removed.</p>
    ${haz.length ? '<p class="small muted" style="margin:10px 0 0">Top FEMA hazards (national percentile): ' +
      haz.map(h => `${h[0]} ${Math.round(h[1])}`).join(' · ') + '</p>' : ''}`;
}

// ---- controls ----
$('mBase').onclick = () => { state.market = 'base'; $('mBase').classList.add('on'); $('mAll').classList.remove('on'); draw(); };
$('mAll').onclick = () => { state.market = 'all'; $('mAll').classList.add('on'); $('mBase').classList.remove('on'); draw(); };
$('minScore').oninput = e => { state.min = +e.target.value; $('minScoreV').textContent = state.min; draw(); };
$('fitOnly').onchange = e => { state.fitOnly = e.target.checked; draw(); };
$('tZips').onclick = () => { state.tab = 'zips'; $('tZips').classList.add('on'); $('tUtil').classList.remove('on'); draw(); };
$('tUtil').onclick = () => { state.tab = 'util'; $('tUtil').classList.add('on'); $('tZips').classList.remove('on'); draw(); };
['Need', 'Value', 'Ability'].forEach(k => $('w' + k).oninput = e => {
  state.w[k.toLowerCase()] = +e.target.value; $('w' + k + 'V').textContent = e.target.value; draw(); });
draw();
</script>
<?php endif; ?>
</body>
</html>
