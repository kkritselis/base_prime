// Livewire BI sales-call view: ZIP lookup -> outage timeline, talking points, cause mix, campaign brief.
// Data comes from api.php?zip=XXXXX (reads the pipeline CSV/JSON in data/).
(() => {
  const VERSION = '2026-09-26d (stacked log toggle)';
  const DEBUG = true;                                  // set false to silence the [Livewire] logs
  const log = (...a) => DEBUG && console.log('%c[Livewire]', 'color:#1E4D2B;font-weight:bold', ...a);
  log('rep.js loaded, version', VERSION);
  const $ = id => document.getElementById(id);
  ['chart', 'season', 'seasonNote', 'seasonLegend', 'points', 'causes', 'brief'].forEach(id =>
    log('element #' + id, $(id) ? 'found' : 'MISSING (rep.html is out of date?)'));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CAUSE_LABEL = {
    tropical: 'Hurricanes / tropical storms', winter: 'Winter storms / ice', wind: 'High winds / thunderstorms',
    tornado: 'Tornadoes', flood: 'Flooding', heat: 'Extreme heat', hail: 'Hail', lightning: 'Lightning',
    wildfire: 'Wildfire', grid: 'Grid emergency (Uri load shed)', none: 'No storm on record'
  };
  const SHORT = {   // compact chart labels for unnamed events
    'high winds / severe thunderstorms': 'Windstorm', 'winter storm / ice': 'Ice / winter storm', 'tornado': 'Tornadoes',
    'flooding': 'Flooding', 'extreme heat': 'Heat wave', 'hail': 'Hailstorm', 'lightning': 'Lightning', 'wildfire': 'Wildfire',
    'hurricane / tropical storm': 'Tropical storm', 'no storm on record': 'Major outage', 'grid emergency (ERCOT load shed)': 'Grid emergency'
  };
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const fmt = n => n == null ? '–' : Math.round(n).toLocaleString();
  const pct = n => n == null ? '–' : Math.round(n * 100) + '%';
  const monthName = ym => { const [y, m] = ym.split('-'); return `${MON[+m - 1]} ${y}`; };
  const dayName = iso => { const [y, m, d] = iso.split('-'); return `${MON[+m - 1]} ${+d}, ${y}`; };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const countyOf = z => (z.county_name || '').replace(/ County$/, '');

  // ---------- lookup ----------
  async function load(zip) {
    zip = (zip || '').replace(/\D/g, '').slice(0, 5);
    if (zip.length !== 5) return;
    $('zipInput').value = zip;
    history.replaceState(null, '', '?zip=' + zip);
    let data;
    try {
      const r = await fetch('api.php?zip=' + zip);
      data = await r.json();
      log('api.php response', r.status, data);
      if (!r.ok) throw new Error(data.error || 'Lookup failed');
    } catch (e) {
      $('result').hidden = true; $('empty').hidden = false;
      $('empty').innerHTML = `<p><b>${esc(e.message)}</b></p><p class="muted small">Try another ZIP.</p>`;
      return;
    }
    $('empty').hidden = true; $('result').hidden = false;
    render(data);
  }
  $('zipForm').addEventListener('submit', e => { e.preventDefault(); load($('zipInput').value); });
  const q = new URLSearchParams(location.search).get('zip');
  if (q) load(q);

  // ---------- render ----------
  function render(d) {
    log('render: months', (d.months || []).length, '| county series', d.county ? (d.county.monthly_hours || []).length : 'NONE',
        '| worst events', d.county ? (d.county.worst || []).length : 0, '| causes row', d.causes ? 'yes' : 'NONE');
    const z = d.zip, county = countyOf(z);
    $('hZip').textContent = z.zip;
    $('hPlace').textContent = `${county} County, Texas`;
    const inBase = z.base_market === 'yes';
    $('hChips').innerHTML =
      `<span class="chip ${inBase ? 'base' : 'warn'}">${inBase ? 'Base market' : 'Outside Base market'}</span>` +
      (z.utility ? `<span class="chip">${esc(z.utility)}</span>` : '') +
      (z.home_fit === 'yes' ? `<span class="chip">${fmt(z.addressable_homes)} owner-occupied homes</span>` : '');
    $('hScore').textContent = z.resilience_demand_score == null ? '–' : Math.round(z.resilience_demand_score);

    const events = pickEvents(d);
    renderChart(d, events);
    renderTable(d);
    renderSeason(d);
    renderPoints(d, events);
    renderCauses(d);
    renderBrief(d, events);
  }

  // Named / big outage days for this county, one per month, biggest first
  function pickEvents(d) {
    const worst = (d.county && d.county.worst) || [];
    const seen = new Set(), out = [];
    for (const e of worst.slice().sort((a, b) => b.pct_out - a.pct_out)) {
      const ym = e.date.slice(0, 7);
      if (seen.has(ym) || e.pct_out < 3) continue;
      seen.add(ym);
      out.push({ ...e, ym, label: e.storm || SHORT[e.cause] || cap(e.cause) });
    }
    return out.slice(0, 5);
  }

  // ---------- timeline chart (SVG, one series, labeled events) ----------
  let scaleMode = 'log', lastChart = null;
  document.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => {
    scaleMode = b.dataset.scale;
    document.querySelectorAll('[data-scale]').forEach(x => x.classList.toggle('on', x === b));
    if (lastChart) renderChart(...lastChart);
  }));

  function renderChart(d, events) {
    lastChart = [d, events];
    const months = d.months || [], vals = (d.county && d.county.monthly_hours) || [];
    const el = $('chart');
    if (!months.length) { el.innerHTML = '<p class="muted">No outage timeline available.</p>'; return; }
    const W = 1000, H = 330, L = 46, R = 12, T = 92, B = 28;
    const pw = W - L - R, ph = H - T - B, n = months.length, bw = pw / n;
    const max = Math.max(1, ...vals);
    const x = i => L + i * bw;
    let top, ticks, y;
    if (scaleMode === 'log') {
      // pseudo-log: log10(1 + 10v) keeps 0 at the baseline while spreading small values (0.1 h) and big storms (40 h)
      const g = v => Math.log10(1 + 10 * Math.max(0, v));
      top = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(t => t >= max) || max;
      ticks = [0, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].filter(t => t <= top);
      y = v => T + ph - (g(v) / g(top)) * ph;
    } else {
      const step = niceStep(max / 3); top = Math.ceil(max / step) * step;
      ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
      y = v => T + ph - (v / top) * ph;
    }
    const evByYm = {}; events.forEach(e => evByYm[e.ym] = e);
    $('chartSub').textContent = `${countyOf(d.zip)} County · average hours without power per home · ${months[0].slice(0, 4)}–${months[n - 1].slice(0, 4)}` +
      (scaleMode === 'log' ? ' · log scale' : '');

    let s = `<svg viewBox="0 0 ${W} ${H}" aria-label="Monthly hours without power per home">`;
    s += '<g class="grid">';
    ticks.forEach(v => { s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`; });
    s += '</g><g class="axis">';
    ticks.forEach(v => { s += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`; });
    months.forEach((m, i) => { if (m.endsWith('-01')) s += `<text x="${x(i)}" y="${H - 8}">${m.slice(0, 4)}</text>`; });
    s += '</g>';
    // bars (hit area first so hover can target the bar)
    months.forEach((m, i) => {
      const v = vals[i] || 0, bh = Math.max(v > 0 ? 1 : 0, T + ph - y(v));
      s += `<rect class="hit" data-i="${i}" x="${x(i)}" y="${T}" width="${bw}" height="${ph}"/>`;
      s += `<rect class="bar${evByYm[m] ? ' hot' : ''}" x="${x(i) + 0.6}" y="${T + ph - bh}" width="${Math.max(1, bw - 1.2)}" height="${bh}" rx="1.5"/>`;
    });
    // event pins with staggered label rows so they don't collide
    const pins = events.map(e => ({ ...e, i: months.indexOf(e.ym) })).filter(e => e.i >= 0).sort((a, b) => a.i - b.i);
    const rowsLast = [-1e9, -1e9, -1e9];
    pins.forEach(p => {
      const cx = x(p.i) + bw / 2;
      let row = rowsLast.findIndex(last => cx - last > 150);
      if (row < 0) row = 0;
      rowsLast[row] = cx;
      const ly = 16 + row * 26, anchor = cx < L + 70 ? 'start' : cx > W - R - 70 ? 'end' : 'middle';
      const vy = y(vals[p.i] || 0);
      s += `<g class="pin"><line x1="${cx}" x2="${cx}" y1="${ly + 12}" y2="${vy - 3}"/>
        <text x="${cx}" y="${ly}" text-anchor="${anchor}">${esc(p.label)}</text>
        <text class="sub" x="${cx}" y="${ly + 11}" text-anchor="${anchor}">${monthName(p.ym)} · ${Math.round(p.pct_out)}% out</text></g>`;
    });
    s += '</svg>';
    el.innerHTML = s;

    const tip = $('tip');
    el.querySelectorAll('.hit').forEach(h => {
      const i = +h.dataset.i, bar = h.nextElementSibling;
      h.addEventListener('mousemove', ev => {
        const e = evByYm[months[i]];
        tip.innerHTML = `<b>${monthName(months[i])}</b><br>${(vals[i] || 0).toFixed(1)} hours without power (avg home)` +
          (e ? `<br>${esc(e.label)}: ${Math.round(e.pct_out)}% of homes out on ${dayName(e.date)}` : '');
        tip.hidden = false; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
        bar.classList.add('hover');
      });
      h.addEventListener('mouseleave', () => { tip.hidden = true; bar.classList.remove('hover'); });
    });
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function renderTable(d) {
    const months = d.months || [], vals = (d.county && d.county.monthly_hours) || [], by = {};
    months.forEach((m, i) => { const y = m.slice(0, 4); by[y] = (by[y] || 0) + (vals[i] || 0); });
    $('yearTable').innerHTML = '<table><tr><th>Year</th><th>Hours without power (avg home)</th></tr>' +
      Object.entries(by).map(([y, v]) => `<tr><td>${y}</td><td>${v.toFixed(1)}</td></tr>`).join('') + '</table>';
  }

  // ---------- seasonality: stacked-by-year bars or year x month heatmap ----------
  let seasonMode = 'stack', seasonScale = 'log', lastSeason = null;
  document.querySelectorAll('[data-sscale]').forEach(b => b.addEventListener('click', () => {
    seasonScale = b.dataset.sscale;
    document.querySelectorAll('[data-sscale]').forEach(x => x.classList.toggle('on', x === b));
    if (lastSeason) renderSeason(lastSeason);
  }));
  document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => {
    seasonMode = b.dataset.season;
    document.querySelectorAll('[data-season]').forEach(x => x.classList.toggle('on', x === b));
    if (lastSeason) renderSeason(lastSeason);
  }));
  // sequential Base-green ramp, light (oldest / low) -> dark (newest / high)
  const RAMP = ['#D6F0B4', '#1E4D2B', '#102A17'];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function rampAt(t) {
    t = Math.max(0, Math.min(1, t));
    const seg = t < 0.8 ? [RAMP[0], RAMP[1], t / 0.8] : [RAMP[1], RAMP[2], (t - 0.8) / 0.2];
    const a = hex(seg[0]), b = hex(seg[1]);
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * seg[2])).join(',') + ')';
  }

  function renderSeason(d) {
    lastSeason = d;
    log('renderSeason: mode', seasonMode, '| scale', seasonScale, '| #season element', !!$('season'));
    const ss = $('seasonScale'); if (ss) ss.hidden = seasonMode !== 'stack';   // log/linear only applies to the bars
    const months = d.months || [], vals = (d.county && d.county.monthly_hours) || [];
    const el = $('season');
    if (!months.length) { el.innerHTML = ''; return; }
    const years = [...new Set(months.map(m => m.slice(0, 4)))];
    const grid = {};                                    // grid[year][monthIndex] = hours
    years.forEach(y => grid[y] = Array(12).fill(0));
    months.forEach((m, i) => { grid[m.slice(0, 4)][+m.slice(5) - 1] = vals[i] || 0; });

    // plain-English summary: peak season + most reliable month (not skewed by one storm)
    const tot = Array(12).fill(0), hit = Array(12).fill(0);
    years.forEach(y => grid[y].forEach((v, k) => { tot[k] += v; if (v >= 0.5) hit[k]++; }));
    const all = tot.reduce((a, b) => a + b, 0) || 1;
    let best = 0, bestK = 0;                            // best 3-month window (wrapping)
    for (let k = 0; k < 12; k++) { const w = tot[k] + tot[(k + 1) % 12] + tot[(k + 2) % 12]; if (w > best) { best = w; bestK = k; } }
    const often = hit.map((c, k) => [c, tot[k], k]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
    $('seasonNote').innerHTML = `Peak season: <b>${MON[bestK]}–${MON[(bestK + 2) % 12]}</b> (${Math.round(100 * best / all)}% of outage hours). ` +
      `Most reliable trouble month: <b>${MON[often[2]]}</b>, with a half-hour or more of outages in ${often[0]} of ${years.length} years.`;

    const W = 1000, L = 46, R = 12, T = 12, tip = $('tip');
    let s;
    if (seasonMode === 'stack') {
      const H = 300, B = 26, ph = H - T - B, pw = W - L - R, bw = pw / 12;
      const max = Math.max(1, ...tot);
      let top, ticks, yv;
      if (seasonScale === 'log') {
        // Log: each bar's TOTAL height is on the log axis; its segments split that height by each year's share.
        const g = v => Math.log10(1 + 10 * Math.max(0, v));
        top = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(t => t >= max) || max;
        ticks = [0, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].filter(t => t <= top);
        yv = v => T + ph - (g(v) / g(top)) * ph;
      } else {
        const step = niceStep(max / 4); top = Math.ceil(max / step) * step;
        ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
        yv = v => T + ph - (v / top) * ph;
      }
      s = `<svg viewBox="0 0 ${W} ${H}"><g class="grid">`;
      ticks.forEach(v => { s += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}"/>`; });
      s += '</g><g class="axis">';
      ticks.forEach(v => { s += `<text x="${L - 6}" y="${yv(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`; });
      MON.forEach((m, k) => s += `<text x="${L + k * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${m}</text>`);
      s += '</g>';
      MON.forEach((m, k) => {
        let acc = 0;
        const barTop = yv(tot[k]), barH = T + ph - barTop;          // total bar height on the current scale
        years.forEach((y, yi) => {
          const v = grid[y][k]; if (v <= 0) return;
          const y0 = T + ph - barH * (acc / (tot[k] || 1)), y1 = T + ph - barH * ((acc + v) / (tot[k] || 1)); acc += v;
          s += `<rect class="seg" data-y="${y}" data-k="${k}" x="${L + k * bw + bw * 0.14}" y="${y1}" width="${bw * 0.72}" height="${Math.max(0.5, y0 - y1)}"
                  fill="${rampAt(years.length > 1 ? yi / (years.length - 1) : 1)}"/>`;
        });
      });
      s += '</svg>';
      $('seasonLegend').innerHTML = years.map((y, yi) =>
        `<span><span class="sw" style="background:${rampAt(years.length > 1 ? yi / (years.length - 1) : 1)}"></span>${y}</span>`).join('') +
        (seasonScale === 'log' ? '<span class="muted">· Log scale: bar height = total hours; colors show each year\'s share</span>' : '');
    } else {
      const rowH = 26, H = T + years.length * rowH + 24, cw = (W - L - R) / 12;
      const g = v => Math.log10(1 + 10 * v), gmax = g(Math.max(1, ...vals));
      s = `<svg viewBox="0 0 ${W} ${H}"><g class="axis">`;
      years.forEach((y, yi) => s += `<text x="${L - 6}" y="${T + yi * rowH + rowH / 2 + 4}" text-anchor="end">${y}</text>`);
      MON.forEach((m, k) => s += `<text x="${L + k * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${m}</text>`);
      s += '</g>';
      years.forEach((y, yi) => MON.forEach((m, k) => {
        const v = grid[y][k], t = v > 0 ? g(v) / gmax : 0;
        const fill = v > 0 ? rampAt(0.05 + 0.95 * t) : '#F0EEEB';
        s += `<rect class="cell" data-y="${y}" data-k="${k}" x="${L + k * cw}" y="${T + yi * rowH}" width="${cw}" height="${rowH}" rx="4" fill="${fill}"/>`;
        if (v >= 1) s += `<text class="celltxt" x="${L + k * cw + cw / 2}" y="${T + yi * rowH + rowH / 2 + 4}" text-anchor="middle" fill="${t > 0.45 ? '#fff' : '#292826'}">${v >= 10 ? Math.round(v) : v.toFixed(1)}</text>`;
      }));
      s += '</svg>';
      $('seasonLegend').innerHTML = `Fewer <span class="ramp" style="background:linear-gradient(90deg,${rampAt(0.05)},${rampAt(0.8)},${rampAt(1)})"></span> more hours (log color scale) · ` +
        `<span><span class="sw" style="background:#F0EEEB;border:1px solid #D8D7D5"></span>no notable outages</span> · numbers shown for 1+ hour`;
    }
    el.innerHTML = s;
    log('renderSeason: drew', seasonMode, 'with', years.length, 'years;', el.querySelectorAll('[data-y]').length, 'shapes');
    // hover tooltips (per segment / cell), with the named event when there is one
    const worst = (d.county && d.county.worst) || [];
    el.querySelectorAll('[data-y]').forEach(r => {
      const y = r.dataset.y, k = +r.dataset.k, v = grid[y][k];
      const ev = worst.find(e => e.date.startsWith(`${y}-${String(k + 1).padStart(2, '0')}`));
      r.addEventListener('mousemove', e => {
        tip.innerHTML = `<b>${MON[k]} ${y}</b><br>${v.toFixed(1)} hours without power (avg home)` +
          (ev ? `<br>${esc(ev.storm || cap(ev.cause))}: ${Math.round(ev.pct_out)}% out on ${dayName(ev.date)}` : '');
        tip.hidden = false; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      });
      r.addEventListener('mouseleave', () => tip.hidden = true);
    });
  }

  // ---------- talking points ----------
  function causeShares(d) {
    const c = d.causes || {};
    return Object.keys(CAUSE_LABEL).map(k => [k, c['share_' + k] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  }
  function renderPoints(d, events) {
    const z = d.zip, county = countyOf(z), pts = [];
    const shares = causeShares(d), weather = shares.filter(([k]) => k !== 'none' && k !== 'grid');
    if (z.outage_hours != null)
      pts.push(`Since 2018, homes in ${county} County have averaged about <b>${z.outage_hours.toFixed(0)} hours a year without power</b>.`);
    if (z.event_days != null)
      pts.push(`There are about <b>${Math.round(z.event_days)} days a year</b> when a noticeable share of the county loses power (usually a few hours in one area).`);
    events.slice(0, 2).forEach((e, i) => pts.push(`${i ? 'Also' : 'Worst'}: <b>${esc(e.label)}</b>. On ${dayName(e.date)}, <b>${Math.round(e.pct_out)}% of homes</b> in the county lost power at once.`));
    if (weather.length)
      pts.push(`Most outages here come from <b>${CAUSE_LABEL[weather[0][0]].toLowerCase()}</b> (${Math.round(weather[0][1] * 100)}% of outage hours${weather[1] ? `, then ${CAUSE_LABEL[weather[1][0]].toLowerCase()} at ${Math.round(weather[1][1] * 100)}%` : ''}).`);
    if (z.electric_heat >= 0.4)
      pts.push(`<b>${pct(z.electric_heat)} of homes heat with electricity</b>, so a winter outage means no heat, too.`);
    if (z.base_market === 'yes' && z.ptc_median_1000kwh)
      pts.push(`Typical open-market price here: <b>${z.ptc_median_1000kwh.toFixed(1)}¢/kWh</b> (Power to Choose median at 1,000 kWh).`);
    if (z.base_market !== 'yes')
      pts.push(`Served by <b>${esc(z.utility || 'a non-open-market utility')}</b>, outside Base's current open-market area.`);
    $('points').innerHTML = pts.map(p => `<li>${p}</li>`).join('');
  }

  function renderCauses(d) {
    const shares = causeShares(d);
    $('causes').innerHTML = shares.length ? shares.slice(0, 6).map(([k, v]) =>
      `<div class="cause"><span>${CAUSE_LABEL[k]}</span><div class="t"><div class="f" style="width:${Math.round(v * 100)}%"></div></div><b>${Math.round(v * 100)}%</b></div>`).join('')
      : '<p class="muted">Not enough notable outages to break down.</p>';
  }

  // ---------- campaign brief ----------
  const ANGLES = {
    wind: { name: 'Storm season', why: 'Severe thunderstorms and high winds cause most outages here.',
      head: c => `Storm season hits ${c} County hard. Stay powered through it.`,
      body: 'When wind takes down the lines, a home battery takes over automatically. No generator, no fuel, no noise.' },
    tropical: { name: 'Hurricane season', why: 'Hurricanes and tropical storms drive the biggest outages here.',
      head: (c, e) => e ? `Remember ${e}? Be ready for the next one.` : `Hurricane season is here. Is your home ready?`,
      body: 'Multi-day outages after a storm are the norm here. Automatic whole-home backup keeps the fridge, A/C and Wi-Fi on.' },
    winter: { name: 'Freeze readiness', why: 'Winter storms and ice cause major outages here.',
      head: () => 'The next freeze is coming. Keep your heat on.',
      body: 'Ice brings down lines fast. A home battery keeps heat and water running while crews work.' },
    grid: { name: 'Uri memory', why: 'This area was hit hard when ERCOT ordered rolling blackouts in Winter Storm Uri.',
      head: c => `${c} County remembers February 2021.`,
      body: 'Grid emergencies are rare, but they last. Backup that switches on automatically means you are not waiting on the grid.' },
    heat: { name: 'Summer heat', why: 'Outages here often coincide with extreme heat.',
      head: () => 'Losing A/C in August is not an option.',
      body: 'Keep cooling on when the power goes out during a heat wave.' },
    flood: { name: 'Flood-prone', why: 'Flooding is a meaningful outage cause here.',
      head: () => 'Storms, floods, outages. Stay powered anyway.',
      body: "Base lists its battery as tested for flooding and submersion-rated to 3 feet; confirm claims with Base's current specs." },
    tornado: { name: 'Severe weather', why: 'Tornado outbreaks cause notable outages here.',
      head: () => 'Severe weather knocks out power fast. Be ready.',
      body: 'Automatic backup kicks in the moment the grid goes down.' },
    none: { name: 'Everyday outages', why: 'Many outages here happen without a storm (equipment, animals, accidents).',
      head: () => 'Power goes out even on sunny days.',
      body: 'Frequent short outages add up. Backup that switches on automatically means you barely notice.' },
  };
  function renderBrief(d, events) {
    const z = d.zip, county = countyOf(z), shares = causeShares(d);
    const months = d.months || [], vals = (d.county && d.county.monthly_hours) || [];
    // seasonality: average hours by calendar month, excluding Feb 2021 (Uri) so one event doesn't dominate
    const byM = Array(12).fill(0), cnt = Array(12).fill(0);
    months.forEach((m, i) => { if (m === '2021-02') return; const k = +m.slice(5) - 1; byM[k] += vals[i] || 0; cnt[k]++; });
    const avg = byM.map((v, i) => cnt[i] ? v / cnt[i] : 0);
    const peak = avg.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]).sort((a, b) => a - b);
    const startAds = MON[(peak[0] + 11) % 12];
    const named = events.find(e => e.storm) || events[0];
    const angles = shares.filter(([k, v]) => ANGLES[k] && v >= 0.1).slice(0, 2).map(([k]) => k);
    if (z.electric_heat >= 0.5 && !angles.includes('winter') && !angles.includes('grid')) angles.push('winter');
    if (!angles.length) angles.push('none');

    let h = '<h3>Audience</h3><p>' +
      `${fmt(z.addressable_homes)} owner-occupied single-family homes · median household income $${fmt(z.median_hh_income)} · ` +
      `${pct(z.owner_rate)} owners · ${pct(z.electric_heat)} all-electric heat · ${z.base_market === 'yes' ? 'in Base\'s market (' + esc(z.utility) + ')' : 'outside Base\'s market (' + esc(z.utility || 'unknown') + ')'}</p>`;
    h += '<h3>Why this ZIP</h3><ul>' + (z.top_reasons || '').split('; ').filter(Boolean).map(r => `<li>${esc(r)}</li>`).join('') +
      angles.map(a => `<li>${ANGLES[a].why}</li>`).join('') + '</ul>';
    h += `<h3>Timing</h3><p>Outages here peak in <b>${peak.map(i => MON[i]).join(', ')}</b>. Start campaigns in <b>${startAds}</b>, before the season.` +
      (named ? ` Anniversary hook: <b>${esc(named.label)}</b> (${monthName(named.ym)}).` : '') + '</p>';
    h += '<h3>Draft angles</h3>' + angles.map(a => {
      const A = ANGLES[a];
      return `<div class="draft"><b>${A.name}</b><div>“${esc(A.head(county, named && named.storm))}”</div><div class="small muted">${esc(A.body)}</div></div>`;
    }).join('');
    h += '<p class="small muted">Generated from county outage history, NOAA storm causes, FEMA risk and Census data. Check claims and brand voice with Base before use.</p>';
    $('brief').innerHTML = h;
  }

  // ---------- copy buttons ----------
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const text = $(b.dataset.copy).innerText.trim();
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1500); } catch (e) {}
  }));
})();
