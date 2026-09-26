// Livewire BI map page: Leaflet choropleth of Texas ZIPs by Resilience Demand Score.
// Data: ROWS (from data/tx_zip_final.csv, embedded by index.php) + data/tx_zips.geojson + data/tx_counties.geojson
(() => {
const ROWS = JSON.parse(document.getElementById('zip-data').textContent);   // embedded by index.php
const HIGH = 70;
// Sequential ramp, one hue (Base greens), light -> dark = low -> high demand
const BINS = [[70,'#1E4D2B'],[60,'#77A45A'],[50,'#B2DD79'],[0,'#D6F0B4']];
const colorFor = s => s == null ? '#D8D7D5' : BINS.find(b => s >= b[0])[1];
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString();
const fmt = n => n == null ? '–' : Math.round(n).toLocaleString();
const pct = n => n == null ? '–' : Math.round(n * 100) + '%';
const money = n => n == null ? '–' : '$' + Math.round(n).toLocaleString();
const $ = id => document.getElementById(id);

const state = { market: 'filter', showAllUtil: false, min: 0, fitOnly: true /* always on: ZIPs that are mostly renters/apartments are greyed out */, tab: 'zips', sel: null, w: { need: 40, value: 30, ability: 30 } };

function score(r) {
  const parts = [[r.need_score, state.w.need], [r.value_score, state.w.value], [r.ability_score, state.w.ability]]
    .filter(p => p[0] != null && p[1] > 0);
  const W = parts.reduce((a, p) => a + p[1], 0);
  return W ? parts.reduce((a, p) => a + p[0] * p[1], 0) / W : null;
}
// ---- utility filter: which utilities count as "our market" (saved per browser; defaults to Base's market today) ----
const UKEY = r => r.utility || '(unknown)';
const LS_KEY = 'livewire.selectedUtilities.v1';
const BASE_TODAY = new Set(ROWS.filter(r => r.base_market === 'yes').map(UKEY));
let SEL;
try { const saved = JSON.parse(localStorage.getItem(LS_KEY)); SEL = Array.isArray(saved) ? new Set(saved) : new Set(BASE_TODAY); }
catch (e) { SEL = new Set(BASE_TODAY); }
function saveSel() { try { localStorage.setItem(LS_KEY, JSON.stringify([...SEL])); } catch (e) {} }
const isSel = r => SEL.has(UKEY(r));
function inMarket(r) { return state.market === 'all' || isSel(r); }
function visible() {
  return ROWS.filter(r => inMarket(r) && (!state.fitOnly || r.home_fit === 'yes') && (r._s ?? 0) >= state.min);
}

// ---- map ----
const map = L.map('map', { preferCanvas: true, zoomControl: true });
const TEXAS = [[25.8, -106.7], [36.6, -93.5]];
map.fitBounds(TEXAS, { padding: [8, 8] });                 // fits Texas on any screen size (phone or desktop)
map.createPane('zips').style.zIndex = 410;
map.createPane('counties').style.zIndex = 420; map.getPane('counties').style.pointerEvents = 'none';
map.createPane('labels').style.zIndex = 430;   map.getPane('labels').style.pointerEvents = 'none';
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3ysp_1_2a15d445d1f58077f3c8984d', {
  attribution: '&copy; OpenStreetMap &copy; CARTO &middot; Boundaries: U.S. Census', maxZoom: 14 }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png?key=cb1_3ysp_1_2a15d445d1f58077f3c8984d', { pane: 'labels', maxZoom: 14 }).addTo(map);

const BYZIP = Object.fromEntries(ROWS.map(r => [r.zip, r]));
let visSet = new Set();
let zipLayer = null;                          // ZIP polygons (data/tx_zips.geojson); falls back to dots if missing
const dotLayer = L.layerGroup().addTo(map);
const tip = r => r ? `<b>${r.zip}</b> · ${r.county_name}<br>Score <b>${r._s == null ? '–' : r._s.toFixed(0)}</b> · ${r.utility || 'unknown utility'}` : '';

function zipStyle(f) {
  const r = BYZIP[f.properties.zip], sel = r && r.zip === state.sel;
  if (!r || !visSet.has(r.zip))
    return { pane: 'zips', fillColor: '#D8D7D5', fillOpacity: 0.12, color: '#A9A8A7', weight: 0.3, opacity: 0.5 };
  const base = isSel(r);
  return { pane: 'zips', fillColor: colorFor(r._s), fillOpacity: base ? 0.8 : 0.45,
    color: sel ? '#ED6C30' : '#FFFFFF', weight: sel ? 3 : 0.5, opacity: sel ? 1 : 0.8 };
}

fetch('data/tx_zips.geojson').then(r => r.ok ? r.json() : null).then(g => {
  if (!g) return;
  zipLayer = L.geoJSON(g, { style: zipStyle, onEachFeature: (f, l) => {
    l.bindTooltip(() => tip(BYZIP[f.properties.zip]), { sticky: true });
    l.on('mouseover', () => { if (visSet.has(f.properties.zip)) l.setStyle({ weight: 2, color: '#292826' }); });
    l.on('mouseout', () => zipLayer.resetStyle(l));
    l.on('click', () => { if (BYZIP[f.properties.zip]) select(f.properties.zip, false); });
  } }).addTo(map);
  draw();
}).catch(() => {});
fetch('data/tx_counties.geojson').then(r => r.ok ? r.json() : null).then(g => {
  if (g) L.geoJSON(g, { pane: 'counties', interactive: false,
    style: { color: '#54524F', weight: 0.8, opacity: 0.55, fill: false } }).addTo(map);
}).catch(() => {});

const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const d = L.DomUtil.create('div', 'legend');
  const collapsed = window.matchMedia('(max-width: 820px)').matches;   // start collapsed on phones
  d.classList.toggle('collapsed', collapsed);
  d.innerHTML = `<button class="legend-toggle" aria-expanded="${!collapsed}" title="Show / hide legend">
      <b>Resilience demand</b><span class="chev">▾</span></button><div class="legend-body">` + BINS.map((b, i) =>
    `<div class="row"><span class="sw sq" style="background:${b[1]}"></span>${i ? b[0] + '–' + (BINS[i-1][0]-1) : b[0] + '+'}</div>`).join('') +
    '<div class="row"><span class="sw sq" style="background:#1E4D2B;opacity:.45"></span>Faded = unselected utility</div>' +
    '<div class="row"><span class="sw sq" style="background:#D8D7D5;opacity:.5"></span>Mostly renters / apartments, or below min score</div>' +
    '<div class="row"><span style="display:inline-block;width:14px;border-top:1.5px solid #54524F"></span>County lines</div></div>';
  L.DomEvent.disableClickPropagation(d);
  d.querySelector('.legend-toggle').onclick = () => {
    const c = d.classList.toggle('collapsed');
    d.querySelector('.legend-toggle').setAttribute('aria-expanded', String(!c));
  };
  return d;
};
legend.addTo(map);

function draw() {
  ROWS.forEach(r => r._s = score(r));
  const vis = visible().sort((a, b) => (a._s ?? 0) - (b._s ?? 0));
  visSet = new Set(vis.map(r => r.zip));
  dotLayer.clearLayers();
  if (zipLayer) {
    zipLayer.setStyle(zipStyle);
  } else vis.forEach(r => {                       // fallback: dots, if tx_zips.geojson isn't there
    const base = isSel(r);
    const rad = Math.max(4, Math.min(18, 3 + Math.sqrt(r.addressable_homes || 0) / 9));
    L.circleMarker([r.lat, r.lon], {
      radius: rad, fillColor: colorFor(r._s), fillOpacity: base ? 0.9 : 0.45,
      color: r.zip === state.sel ? '#ED6C30' : '#FFFFFF', weight: r.zip === state.sel ? 3 : 1
    }).bindTooltip(tip(r), { direction: 'top', offset: [0, -rad] })
      .on('click', () => select(r.zip, false)).addTo(dotLayer);
  });
  // KPIs
  const fit = vis.filter(r => r.home_fit === 'yes');
  $('kZips').textContent = vis.length.toLocaleString();
  $('kHomes').textContent = compact(fit.reduce((a, r) => a + (r.addressable_homes || 0), 0));
  $('kHD').textContent = compact(fit.filter(r => (r._s ?? 0) >= HIGH).reduce((a, r) => a + (r.addressable_homes || 0), 0));
  renderList(vis);
  if (state.sel) renderDetail(ROWS.find(r => r.zip === state.sel));
}

let lastVis = [];
// rows passing the score / good-fit filters, ignoring the utility filter
const candidates = () => ROWS.filter(r => (!state.fitOnly || r.home_fit === 'yes') && (r._s ?? 0) >= state.min);
function utilityRollup(rows) {
  const g = {};
  rows.filter(r => r.home_fit === 'yes').forEach(r => {
    const k = UKEY(r);
    const a = g[k] || (g[k] = { name: k, market: r.market, base: r.base_market, zips: 0, homes: 0, hd: 0, hdz: 0, wsum: 0, cause: {} });
    a.zips++; a.homes += r.addressable_homes || 0; a.wsum += (r._s ?? 0) * (r.addressable_homes || 0);
    if ((r._s ?? 0) >= HIGH) { a.hd += r.addressable_homes || 0; a.hdz++; }
    if (r.top_cause) a.cause[r.top_cause] = (a.cause[r.top_cause] || 0) + (r.addressable_homes || 0);
  });
  return Object.values(g).sort((a, b) => b.hd - a.hd || b.homes - a.homes);
}
function renderList(vis) {
  lastVis = vis;
  const el = $('list');
  if (state.tab === 'zips') {
    const top = vis.filter(r => r.home_fit === 'yes').sort((a, b) => (b._s ?? 0) - (a._s ?? 0)).slice(0, 25);
    el.innerHTML = '<table><tr><th>ZIP</th><th>County</th><th class="n">Homes</th><th class="n">Score</th></tr>' +
      top.map(r => `<tr class="click" data-zip="${r.zip}"><td><b>${r.zip}</b></td><td>${r.county_name.replace(' County','')}</td>
        <td class="n">${fmt(r.addressable_homes)}</td><td class="n"><b>${r._s.toFixed(0)}</b></td></tr>`).join('') + '</table>';
    el.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => select(tr.dataset.zip, true));
  } else {
    // every utility (ignores the utility filter itself, so unchecked ones can be switched on)
    const list = utilityRollup(candidates());
    const shown = state.showAllUtil ? list : list.slice(0, 25);
    el.innerHTML = `<div class="presets"><span class="small muted">Map these utilities:</span>
        <button data-preset="base">Base today</button><button data-preset="all">All</button><button data-preset="none">None</button>
        <span class="small muted">${SEL.size} selected</span></div>
      <p class="small muted" style="margin:0 0 6px">Check the utilities Base can sell in. Saved in this browser.
        High-demand = score ${HIGH}+; unchecked utilities with high demand are partnership leads.</p>
      <table class="util"><tr><th></th><th>Utility</th><th class="n">High-demand homes</th><th class="n">Owned homes</th></tr>` +
      shown.map(u => `<tr class="${SEL.has(u.name) ? 'on' : ''}"><td><input type="checkbox" data-u="${encodeURIComponent(u.name)}" ${SEL.has(u.name) ? 'checked' : ''} aria-label="Map ${u.name}"></td>
        <td>${u.name}<br><span class="chip ${u.market === 'base_tdsp' ? 'base' : ''}">${label(u.market)}</span></td>
        <td class="n"><b>${fmt(u.hd)}</b></td><td class="n">${fmt(u.homes)}</td></tr>`).join('') + '</table>' +
      (list.length > 25 ? `<button class="more" id="utilMore">${state.showAllUtil ? 'Show top 25' : `Show all ${list.length} utilities`}</button>` : '');
    el.querySelectorAll('input[data-u]').forEach(cb => cb.onchange = () => {
      const name = decodeURIComponent(cb.dataset.u);
      cb.checked ? SEL.add(name) : SEL.delete(name); saveSel(); draw();
    });
    el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const p = b.dataset.preset;
      SEL = p === 'base' ? new Set(BASE_TODAY) : p === 'all' ? new Set(list.map(u => u.name)) : new Set();
      saveSel(); draw();
    });
    const more = $('utilMore'); if (more) more.onclick = () => { state.showAllUtil = !state.showAllUtil; draw(); };
  }
}
// ---- lead-list export (CSV of the current view: market toggle, filters and model weights all apply) ----
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function download(name, rows) {
  const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');   // BOM so Excel reads UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportLeads() {
  const base = location.href.replace(/[^/]*([?#].*)?$/, '');
  const stamp = new Date().toISOString().slice(0, 10);
  const view = (state.market === 'all' ? 'all-texas' : `selected-${SEL.size}-utilities`) + (state.min ? '_min' + state.min : '');
  const fit = lastVis.filter(r => r.home_fit === 'yes' || !state.fitOnly);
  const w = state.w, wsum = (w.need + w.value + w.ability) || 1;
  const note = `Livewire BI lead list · ${state.market === 'all' ? 'all of Texas' : 'selected utilities: ' + [...SEL].join(' | ')} · min score ${state.min}` +
    ` · weights need ${Math.round(100 * w.need / wsum)}% / value ${Math.round(100 * w.value / wsum)}% / ability ${Math.round(100 * w.ability / wsum)}% · ${stamp}`;
  if (state.tab === 'zips') {
    const rows = fit.slice().sort((a, b) => (b._s ?? 0) - (a._s ?? 0));
    download(`livewire-leads_zips_${view}_${stamp}.csv`, [[note], [
      'rank', 'zip', 'county', 'utility', 'market', 'utility_selected', 'demand_score', 'need', 'value', 'ability',
      'owner_occupied_single_family_homes', 'median_income', 'owner_rate', 'single_family_rate', 'electric_heat_share', 'outage_hours_per_home_yr',
      'notable_outage_days_yr', 'typical_restore_hours_major', 'avg_outage_length_hours', 'top_outage_cause', 'peak_outage_season', 'worst_event', 'why_this_zip', 'sales_view_link'],
      ...rows.map((r, i) => [i + 1, r.zip, r.county_name.replace(/ County$/, ''), r.utility, label(r.market), isSel(r) ? 'yes' : 'no',
        r._s == null ? '' : r._s.toFixed(1), r.need_score?.toFixed(0), r.value_score?.toFixed(0), r.ability_score?.toFixed(0),
        r.addressable_homes, r.median_hh_income, r.owner_rate, r.single_family_rate, r.electric_heat,
        r.outage_hours?.toFixed(1), r.event_days?.toFixed(0), r.restore_hours?.toFixed(0), r.avg_outage_length?.toFixed(1), r.top_cause, r.peak_season, r.worst_event,
        r.top_reasons, base + 'rep.html?zip=' + r.zip])]);
  } else {
    const list = utilityRollup(candidates());   // all utilities, with a 'selected' column
    download(`livewire-leads_utilities_${view}_${stamp}.csv`, [[note], [
      'rank', 'utility', 'market', 'selected', 'zips', 'owner_occupied_single_family_homes', 'high_demand_zips', 'high_demand_homes',
      'avg_score_home_weighted', 'main_outage_cause', 'opportunity'],
      ...list.map((u, i) => {
        const cause = Object.entries(u.cause).sort((a, b) => b[1] - a[1])[0];
        return [i + 1, u.name, label(u.market), SEL.has(u.name) ? 'yes' : 'no', u.zips, u.homes, u.hdz, u.hd,
          u.homes ? (u.wsum / u.homes).toFixed(1) : '', cause ? cause[0] : '',
          SEL.has(u.name) ? 'Selected market (sell direct)'
            : u.base === 'yes' ? 'Open market, not selected'
            : u.market === 'competitive' ? 'Open market Base does not serve yet (expansion)'
            : 'Partnership lead (Backup-Only / utility program)'];
      })]);
  }
}
$('exportCsv').onclick = exportLeads;

const label = m => ({ base_tdsp: 'Base market', competitive: 'Open market', coop: 'Co-op', municipal: 'City utility',
  ioi_non_ercot: 'Non-ERCOT utility', none: 'Unknown' }[m] || m || 'Unknown');

function select(zip, fly) {
  state.sel = zip;
  const r = ROWS.find(x => x.zip === zip);
  if (fly && r) map.flyTo([r.lat, r.lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
  if (fly && window.matchMedia('(max-width: 820px)').matches)          // phones: bring the map back into view
    $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (zipLayer) zipLayer.setStyle(zipStyle); else draw();
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
        <span class="small muted">${r.utility || ''}</span></div>
        <a class="chip base link" href="rep.html?zip=${r.zip}" target="_blank" style="margin-top:8px">Open sales view →</a></div>
      <div style="text-align:right"><div class="big">${r._s == null ? '–' : r._s.toFixed(0)}</div><div class="small muted">of 100</div></div>
    </div>
    ${bar('Need', r.need_score)}${bar('Value', r.value_score)}${bar('Ability', r.ability_score)}
    ${r.top_reasons ? '<ul class="reasons">' + r.top_reasons.split('; ').map(x => `<li>${x}</li>`).join('') + '</ul>' : ''}
    ${r.not_serviceable_reason ? `<p class="small" style="color:#742C0B;margin:8px 0 0">⚠ ${r.not_serviceable_reason}</p>` : ''}
    <div class="stats">
      <div><span title="Estimated owner-occupied single-family homes: the homes Base can install a battery on">Owned homes</span><b>${fmt(r.addressable_homes)}</b></div>
      <div><span>Median income</span><b>${money(r.median_hh_income)}</b></div>
      <div><span>Owner-occupied</span><b>${pct(r.owner_rate)}</b></div>
      <div><span>Single-family</span><b>${pct(r.single_family_rate)}</b></div>
      <div><span title="Total customer-hours without power per year ÷ customers in the county (2018–2025)">Hours without power / customer / yr*</span><b>${r.outage_hours == null ? '–' : r.outage_hours.toFixed(1)}</b></div>
      <div><span title="Days per year when at least 2% of the county's customers (min. 100) were out at the same time">Days with a notable outage / yr*</span><b>${r.event_days == null ? '–' : r.event_days.toFixed(0)}</b></div>
      <div><span title="Median hours from the peak of a major outage (1%+ of the county out) until 90% of those customers had power back">Typical restore time, major outages*</span><b>${r.restore_hours == null ? '–' : r.restore_hours.toFixed(0) + ' h'}</b></div>
      <div><span title="Estimated average length of an outage for an affected customer">Avg outage length*</span><b>${r.avg_outage_length == null ? '–' : r.avg_outage_length.toFixed(1) + ' h'}</b></div>
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
$('mBase').onclick = () => { state.market = 'filter'; $('mBase').classList.add('on'); $('mAll').classList.remove('on'); draw(); };
$('mAll').onclick = () => { state.market = 'all'; $('mAll').classList.add('on'); $('mBase').classList.remove('on'); draw(); };
$('minScore').oninput = e => { state.min = +e.target.value; $('minScoreV').textContent = state.min; draw(); };
$('tZips').onclick = () => { state.tab = 'zips'; $('tZips').classList.add('on'); $('tUtil').classList.remove('on'); draw(); };
$('tUtil').onclick = () => { state.tab = 'util'; $('tUtil').classList.add('on'); $('tZips').classList.remove('on'); draw(); };
['Need', 'Value', 'Ability'].forEach(k => $('w' + k).oninput = e => {
  state.w[k.toLowerCase()] = +e.target.value; $('w' + k + 'V').textContent = e.target.value; draw(); });
draw();
})();
