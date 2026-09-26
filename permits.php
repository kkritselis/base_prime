<?php
// Livewire BI: where Base Power is installing, from public city building permits.
//   permits.php            -> JSON summary (counts by month and by ZIP; no addresses or names)
// Source: City of Austin Open Data, "Issued Construction Permits" (Socrata dataset 3syk-w9eu), no API key needed.
// Battery installs = residential permits, work class "Auxiliary Power", contractor "Base Power".
// Cached for 12 hours in data/cache/ so the city's API is called at most twice a day.
header('Content-Type: application/json; charset=utf-8');

const CITIES = [
  'austin' => [
    'name'    => 'Austin',
    'utility' => 'Austin Energy',
    'api'     => 'https://data.austintexas.gov/resource/3syk-w9eu.json',
    'page'    => 'https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu',
    'where'   => "upper(contractor_company_name) like '%BASE POWER%' AND permit_class_mapped='Residential' AND work_class='Auxiliary Power'",
    'date'    => 'issue_date', 'zip' => 'original_zip',
  ],
  // More Socrata cities can be added here with their own dataset and field names.
];
const CACHE_HOURS = 12;

function http_get($url) {
  if (getenv('LW_FIXTURES')) {                                   // local testing without network
    $q = urldecode($url);
    $f = strpos($q, 'date_trunc_ym') !== false ? 'months' : (strpos($q, ' as z') !== false ? 'zips' : 'last30');
    return @file_get_contents(getenv('LW_FIXTURES') . "/$f.json");
  }
  if (function_exists('curl_init')) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_USERAGENT => 'LivewireBI/1.0 (hackathon prototype)']);
    $body = curl_exec($c); $code = curl_getinfo($c, CURLINFO_HTTP_CODE); curl_close($c);
    return ($body !== false && $code < 400) ? $body : false;
  }
  $ctx = stream_context_create(['http' => ['timeout' => 15, 'user_agent' => 'LivewireBI/1.0 (hackathon prototype)']]);
  return @file_get_contents($url, false, $ctx);
}
function soql($city, $select) {
  $url = $city['api'] . '?' . $select . '&$where=' . rawurlencode($city['where']);
  $j = http_get($url);
  return $j === false ? null : json_decode($j, true);
}

$key = $_GET['city'] ?? 'austin';
if (!isset(CITIES[$key])) { http_response_code(400); echo json_encode(['error' => 'Unknown city']); exit; }
$city = CITIES[$key];

$dir = __DIR__ . '/data/cache';
$cache = "$dir/permits_$key.json";
if (!getenv('LW_FIXTURES') && is_file($cache) && time() - filemtime($cache) < CACHE_HOURS * 3600) { readfile($cache); exit; }

$d = $city['date'];
$months = soql($city, '$select=' . rawurlencode("date_trunc_ym($d) as m, count(*) as n") . '&$group=m&$order=m');
$zips   = soql($city, '$select=' . rawurlencode("{$city['zip']} as z, count(*) as n") . '&$group=z&$order=' . rawurlencode('n DESC') . '&$limit=300');
$city30 = $city; $city30['where'] .= " AND $d >= '" . date('Y-m-d', time() - 30 * 86400) . "'";
$last30 = soql($city30, '$select=' . rawurlencode('count(*) as n'));

if ($months === null || $zips === null) {
  if (is_file($cache)) { readfile($cache); exit; }                // serve stale data rather than nothing
  http_response_code(502); echo json_encode(['error' => 'Permit data is unavailable right now.']); exit;
}
$out = [
  'city' => $city['name'], 'utility' => $city['utility'], 'source' => $city['page'], 'updated' => date('c'),
  'total' => array_sum(array_map(fn($r) => (int)$r['n'], $months)),
  'last30' => isset($last30[0]['n']) ? (int)$last30[0]['n'] : null,
  'months' => array_map(fn($r) => ['m' => substr($r['m'] ?? '', 0, 7), 'n' => (int)$r['n']], $months),
  'zips' => array_values(array_filter(array_map(fn($r) => ['z' => substr($r['z'] ?? '', 0, 5), 'n' => (int)$r['n']], $zips),
    fn($r) => preg_match('/^\d{5}$/', $r['z']))),
];
$json = json_encode($out, JSON_UNESCAPED_SLASHES);
if (!getenv('LW_FIXTURES')) { @mkdir($dir, 0755, true); @file_put_contents($cache, $json); }
echo $json;
