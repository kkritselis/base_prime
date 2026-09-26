<?php
// Livewire BI API: everything the sales-call view needs for one ZIP, as JSON.
//   api.php?zip=77523
// Reads the pipeline outputs in data/ (no database).
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');

$zip = preg_replace('/\D/', '', $_GET['zip'] ?? '');
if (strlen($zip) !== 5) { http_response_code(400); echo json_encode(['error' => 'Enter a 5-digit Texas ZIP code.']); exit; }

function csv_find($path, $key, $value) {
  if (!file_exists($path)) return null;
  $fh = fopen($path, 'r');
  $hdr = fgetcsv($fh, 0, ',', '"', '');
  $i = array_search($key, $hdr);
  while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
    if (count($r) === count($hdr) && $r[$i] === $value) { fclose($fh); return array_combine($hdr, $r); }
  }
  fclose($fh);
  return null;
}
function nums($row) {                       // numeric strings -> numbers, '' -> null
  if (!$row) return $row;
  foreach ($row as $k => $v) {
    if ($v === '') $row[$k] = null;
    elseif (is_numeric($v) && !in_array($k, ['zip', 'county_fips'])) $row[$k] = $v + 0;
  }
  return $row;
}

$d = __DIR__ . '/data/';
$z = nums(csv_find($d . 'tx_zip_final.csv', 'zip', $zip));
if (!$z) { http_response_code(404); echo json_encode(['error' => "No data for ZIP $zip. Is it a Texas ZIP?"]); exit; }

$fips = $z['county_fips'];
$causes = nums(csv_find($d . 'tx_county_causes.csv', 'county_fips', $fips));
$county = null; $months = [];
if (file_exists($d . 'tx_county_events.json')) {
  $ev = json_decode(file_get_contents($d . 'tx_county_events.json'), true);
  $months = $ev['months'] ?? [];
  $county = $ev['counties'][$fips] ?? null;
}
$summary = nums(csv_find($d . 'tx_county_outage_summary.csv', 'county_fips', $fips));

echo json_encode(['zip' => $z, 'causes' => $causes, 'county' => $county, 'months' => $months, 'outage' => $summary],
  JSON_UNESCAPED_SLASHES);
