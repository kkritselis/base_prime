<?php
// Livewire BI: recent press coverage of Base Power, from publishers' own RSS search feeds (WordPress sites support
// ?s=<query>&feed=rss2). Keeps only items that mention "Base Power". Cached for 6 hours in data/cache/.
//   news.php -> JSON [{title, url, source, date, summary}]
// (Google News RSS is avoided on purpose: its terms limit it to personal, non-commercial use.)
header('Content-Type: application/json; charset=utf-8');

const QUERY = '"base power"';
const MATCH_RE = '/\bbase power\b/i';
const FEEDS = [                                     // name => site (WordPress search feed)
  'Electrek'         => 'https://electrek.co/',
  'pv magazine USA'  => 'https://pv-magazine-usa.com/',
  'TechCrunch'       => 'https://techcrunch.com/',
  'CleanTechnica'    => 'https://cleantechnica.com/',
  'Energy Storage News' => 'https://www.energy-storage.news/',
];
const CACHE_HOURS = 6;
const MAX_ITEMS = 12;

function http_get($url) {
  if (getenv('LW_FIXTURES')) {
    $f = getenv('LW_FIXTURES') . '/' . preg_replace('/^www\./', '', parse_url($url, PHP_URL_HOST));
    $f = preg_replace('/\.(co|com|news)$/', '', $f) . '.xml';
    return @file_get_contents($f);
  }
  if (function_exists('curl_init')) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_USERAGENT => 'LivewireBI/1.0 (hackathon prototype; RSS reader)']);
    $body = curl_exec($c); $code = curl_getinfo($c, CURLINFO_HTTP_CODE); curl_close($c);
    return ($body !== false && $code < 400) ? $body : false;
  }
  $ctx = stream_context_create(['http' => ['timeout' => 10, 'user_agent' => 'LivewireBI/1.0 (hackathon prototype; RSS reader)']]);
  return @file_get_contents($url, false, $ctx);
}

$dir = __DIR__ . '/data/cache'; $cache = "$dir/news.json";
if (!getenv('LW_FIXTURES') && is_file($cache) && time() - filemtime($cache) < CACHE_HOURS * 3600) { readfile($cache); exit; }

$items = []; $seen = []; $ok = 0;
foreach (FEEDS as $name => $site) {
  $xml = http_get($site . '?s=' . rawurlencode(QUERY) . '&feed=rss2');
  if (!$xml) continue;
  libxml_use_internal_errors(true);
  $rss = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA);
  if (!$rss || !isset($rss->channel->item)) continue;
  $ok++;
  foreach ($rss->channel->item as $it) {
    $title = trim(html_entity_decode((string)$it->title, ENT_QUOTES, 'UTF-8'));
    $summary = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string)$it->description), ENT_QUOTES, 'UTF-8')));
    $summary = preg_replace('/\s*more…$/u', '', $summary);
    if (!preg_match(MATCH_RE, $title . ' ' . $summary)) continue;       // search feeds also return loose matches
    $k = strtolower(preg_replace('/\W+/', '', $title));
    if (isset($seen[$k])) continue; $seen[$k] = 1;
    $t = strtotime((string)$it->pubDate);
    $items[] = ['title' => $title, 'url' => (string)$it->link, 'source' => $name, 'date' => $t ? date('Y-m-d', $t) : '',
      'summary' => function_exists('mb_strimwidth') ? mb_strimwidth($summary, 0, 220, '…', 'UTF-8') : substr($summary, 0, 220)];
  }
}
usort($items, fn($a, $b) => strcmp($b['date'], $a['date']));
$items = array_slice($items, 0, MAX_ITEMS);
if (!$ok && is_file($cache)) { readfile($cache); exit; }
$json = json_encode(['updated' => date('c'), 'feeds_ok' => $ok, 'feeds' => count(FEEDS), 'items' => $items], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if (!getenv('LW_FIXTURES') && $ok) { @mkdir($dir, 0755, true); @file_put_contents($cache, $json); }
echo $json;
