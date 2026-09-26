<?php
// Livewire BI - reads data/tx_zip_final.csv (from build_scores.py) and renders a Leaflet map.
// Run locally from the project folder:   php -S localhost:8000     then open http://localhost:8000
$csvPath = __DIR__ . '/data/tx_zip_final.csv';
$keep = ['zip','lat','lon','county_fips','county_name','longest_restore_start','serviceable','home_fit','base_market','utility','utility_type','market',
  'not_serviceable_reason','resilience_demand_score','need_score','value_score','ability_score','top_reasons',
  'addressable_homes','population','median_hh_income','owner_rate','single_family_rate','median_home_value','rooms',
  'electric_heat','outage_hours','event_days','restore_hours','avg_outage_length','grid_value','ercot_zone','major_outages','longest_restore_hours','weather_hazard','hurricane_score','ice_storm_score','winter_weather_score',
  'strong_wind_score','cold_wave_score','heat_wave_score','tornado_score','ptc_median_1000kwh','res_rate','growth'];
$text = ['zip','county_fips','county_name','longest_restore_start','ercot_zone','serviceable','home_fit','base_market','utility','utility_type','market','not_serviceable_reason','top_reasons'];
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
  // county outage causes + peak season (from fetch_events.py), used by the lead-list export
  $causes = []; $season = [];
  $cp = __DIR__ . '/data/tx_county_causes.csv';
  if (file_exists($cp)) {
    $fh = fopen($cp, 'r'); $h = fgetcsv($fh, 0, ',', '"', '');
    while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
      if (count($r) === count($h)) { $a = array_combine($h, $r); $causes[$a['county_fips']] = $a['top_cause']; }
    }
    fclose($fh);
  }
  $ep = __DIR__ . '/data/tx_county_events.json';
  if (file_exists($ep)) {
    $ev = json_decode(file_get_contents($ep), true); $mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    foreach (($ev['counties'] ?? []) as $fips => $c) {
      $tot = array_fill(0, 12, 0.0);
      foreach ($ev['months'] as $i => $m) { if ($m !== '2021-02') $tot[(int)substr($m, 5) - 1] += $c['monthly_hours'][$i] ?? 0; }
      $best = -1; $k0 = 0;
      for ($k = 0; $k < 12; $k++) { $w = $tot[$k] + $tot[($k + 1) % 12] + $tot[($k + 2) % 12]; if ($w > $best) { $best = $w; $k0 = $k; } }
      $worst = $c['worst'][0] ?? null;
      $season[$fips] = [$mon[$k0] . '–' . $mon[($k0 + 2) % 12], $worst ? trim(($worst['storm'] ?: $worst['cause']) . ', ' . $worst['date'] . ' (' . round($worst['pct_out']) . '% out)') : ''];
    }
  }
  foreach ($rows as &$o) {
    $o['top_cause'] = $causes[$o['county_fips']] ?? '';
    $o['peak_season'] = $season[$o['county_fips']][0] ?? '';
    $o['worst_event'] = $season[$o['county_fips']][1] ?? '';
  }
  unset($o);
  if (!$rows) $err = 'No ZIPs with map points - re-run build_scores.py (it adds lat/lon).';
}
$v = '20260926n';   // bump to bust browser/host caches after editing css/ or js/
$updated = file_exists($csvPath) ? date('M j, Y g:ia', filemtime($csvPath)) : '';
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Livewire BI: Where Texas needs backup next</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Zilla+Slab:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="stylesheet" href="css/map.css?v=<?= $v ?>">
</head>
<body>
<header>
  <div class="brand">
    <img src="logo-light.png" alt="Livewire BI" class="logo" width="397" height="96">
    <div>
      <div class="eyebrow">Built for Base Power × AITX Hackathon</div>
      <h1>Where Texas needs backup next.</h1>
    </div>
  </div>
  <div class="spacer"></div>
  <a href="rep.html" target="_blank" class="hdr-link long">Sales View →</a>
  <a href="rep.html" class="hdr-link short">Sales →</a>
  <a href="plan.html" class="hdr-link long">Marketing plan →</a>
  <a href="plan.html" class="hdr-link short">Plan →</a>
  <a href="events.html" class="hdr-link long">Statewide events →</a>
  <a href="events.html" class="hdr-link short">Events →</a>
  <div class="seg" role="tablist" aria-label="Market">
    <button id="mBase" class="on" title="Only utilities checked in the By utility tab (default: Base's market today)">Selected utilities</button>
    <button id="mAll">All of Texas</button>
  </div>
  <label class="ctl">Min score <input id="minScore" type="range" min="0" max="90" step="5" value="0"> <span id="minScoreV">0</span></label>
</header>

<?php if ($err): ?>
  <div class="card err"><b>Data not ready.</b><p><?= htmlspecialchars($err) ?></p></div>
<?php else: ?>
<main>
  <aside>
    <div class="card kpis">
      <div class="kpi"><div class="v" id="kZips">–</div><div class="l">ZIPs shown</div></div>
      <div class="kpi"><div class="v" id="kHomes">–</div><div class="l">Owned homes</div></div>
      <div class="kpi"><div class="v" id="kHD">–</div><div class="l">High-demand homes (70+)</div></div>
    </div>

    <div class="card" id="detail">
      <div class="muted">Click a ZIP on the map or in the list to see why it scores the way it does.</div>
    </div>

    <div class="card">
      <div class="tabs"><button id="tZips" class="on">Top ZIPs</button><button id="tUtil">By utility</button>
        <button id="exportCsv" class="export" title="Download the current view (market, filters and weights applied) as a CSV lead list">⬇ Export CSV</button></div>
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
<script id="zip-data" type="application/json"><?= json_encode($rows, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?></script>
<script src="js/map.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
