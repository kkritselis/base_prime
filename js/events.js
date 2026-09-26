// Livewire BI statewide events page: daily statewide outage timeline + event classifier + cause mix.
// Data (from the pipeline): data/tx_statewide_daily.csv (fetch_data.py), data/tx_statewide_events.csv and
// data/tx_statewide_causes.csv (fetch_events.py).
(() => {
  const VERSION = '2026-09-26h (events page)';
  const log = (...a) => console.log('%c[Livewire]', 'color:#1E4D2B;font-weight:bold', ...a);
  log('events.js loaded, version', VERSION);
  const $ = id => document.getElementById(id);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n == null ? '–' : Math.round(n).toLocaleString();
  const big = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const dname = iso => { const [y, m, d] = iso.split('-'); return `${MON[+m - 1]} ${+d}, ${y}`; };
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  // Well-documented events NOAA doesn't name (matched by event start date)
  const KNOWN = {
    '2024-05-16': 'Houston derecho', '2024-05-28': 'Memorial Day storms', '2023-02-01': 'Central Texas ice storm',
    '2019-06-09': 'Dallas windstorm',
  };
  const SHORT = { 'high winds / severe thunderstorms': 'Windstorm', 'winter storm / ice': 'Winter storm', 'tornado': 'Tornadoes',
    'flooding': 'Flooding', 'extreme heat': 'Heat wave', 'hurricane / tropical storm': 'Tropical storm', 'hail': 'Hail',
    'no storm on record': 'Major outage', 'grid emergency (ERCOT load shed)': 'Grid emergency' };

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const [h, ...rest] = rows.filter(r => r.length > 1 || r[0]);
    return rest.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  }
  const get = url => fetch(url).then(r => r.ok ? r.text() : '').then(t => t ? parseCSV(t) : []).catch(() => []);

  let daily = [], events = [], causes = [], scale = 'log', filter = 'all', selected = null, showAll = false;

  Promise.all([get('data/tx_statewide_daily.csv'), get('data/tx_statewide_events.csv'), get('data/tx_statewide_causes.csv')])
    .then(([d, e, c]) => {
      daily = d.map(r => ({ date: r.date, v: +r.peak_customers_out || 0 })).filter(r => r.date >= '2018-01-01').sort((a, b) => a.date < b.date ? -1 : 1);
      events = e.map(r => {
        const grid = /GRID/.test(r.type);
        const inRange = daily.filter(x => x.date >= r.start && x.date <= r.end);
        const pk = inRange.reduce((m, x) => x.v > m.v ? x : m, { v: 0, date: r.peak_day });
        return { ...r, grid, peak: +r.peak_customers_out || 0, dailyPeak: pk.v, dailyPeakDate: pk.date,
          name: r.storm || KNOWN[r.start] || SHORT[r.main_cause] || cap(r.main_cause) };
      }).sort((a, b) => b.peak - a.peak);
      causes = c.map(r => ({ cause: r.cause, label: r.label, share: +r.share || 0 })).filter(r => r.share > 0.004);
      log('loaded', daily.length, 'days,', events.length, 'events,', causes.length, 'causes');
      renderStats(); renderTimeline(); renderCauses(); renderTakeaways(); renderTable();
    });

  // ---------- headline stats ----------
  function renderStats() {
    const gridEv = events.filter(e => e.grid), local = events.filter(e => !e.grid);
    const gridShare = (causes.find(c => c.cause === 'grid') || {}).share || 0;
    const known = causes.filter(c => c.cause !== 'none').reduce((a, c) => a + c.share, 0);
    const topLocal = local[0];
    $('stats').innerHTML = [
      [gridEv.length === 1 ? '1' : gridEv.length, `grid-wide emergency since 2018 (${gridEv[0] ? esc(gridEv[0].name) : 'none'})`, true],
      [events.length, 'outage events with 100k+ Texans out at once', false],
      [Math.round(100 * (known - gridShare)) + '%', 'of outage hours caused by local weather damage (wind, storms, ice, heat, floods)', false],
      [topLocal ? big(topLocal.peak) : '–', topLocal ? `out in the biggest local event (${esc(topLocal.name)}, ${MON[+topLocal.start.slice(5, 7) - 1]} ${topLocal.start.slice(0, 4)})` : '', false],
    ].map(([v, l, hot]) => `<div class="stat"><div class="v ${hot ? 'hot' : ''}">${v}</div><div class="l">${l}</div></div>`).join('');
  }

  // ---------- timeline ----------
  document.querySelectorAll('[data-tscale]').forEach(b => b.addEventListener('click', () => {
    scale = b.dataset.tscale;
    document.querySelectorAll('[data-tscale]').forEach(x => x.classList.toggle('on', x === b));
    renderTimeline();
  }));
  function renderTimeline() {
    const el = $('timeline'); if (!daily.length) { el.innerHTML = '<p class="muted">No statewide daily data (data/tx_statewide_daily.csv).</p>'; return; }
    const W = 1100, H = 400, L = 56, R = 14, T = 118, B = 26, pw = W - L - R, ph = H - T - B;
    const t0 = Date.parse(daily[0].date), t1 = Date.parse(daily[daily.length - 1].date);
    const x = iso => L + (Date.parse(iso) - t0) / (t1 - t0) * pw;
    const max = Math.max(...daily.map(d => d.v));
    let y, ticks;
    if (scale === 'log') {
      const lo = 1000, g = v => Math.log10(Math.max(lo, v)), top = max * 1.25;
      y = v => T + ph - (g(v) - g(lo)) / (g(top) - g(lo)) * ph;
      ticks = [1e3, 1e4, 1e5, 1e6, 1e7].filter(t => t <= top);
    } else {
      const step = max > 2e6 ? 1e6 : max > 1e6 ? 5e5 : 2e5, top = Math.ceil(max / step) * step;
      y = v => T + ph - v / top * ph;
      ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
    }
    $('tlSub').textContent = `${daily.length.toLocaleString()} days · ${scale === 'log' ? 'log scale' : 'linear scale'}`;
    let s = `<svg viewBox="0 0 ${W} ${H}"><g class="grid">`;
    ticks.forEach(v => s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`);
    s += '</g><g class="axis">';
    ticks.forEach(v => s += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${big(v)}</text>`);
    for (let yr = +daily[0].date.slice(0, 4); yr <= +daily[daily.length - 1].date.slice(0, 4); yr++)
      s += `<text x="${x(yr + '-01-01')}" y="${H - 8}">${yr}</text>`;
    s += '</g>';
    // event bands (behind the line): only the labeled events + the selected one, to keep the chart readable
    const LABELED = 8;
    events.forEach((e, i) => {
      if (i >= LABELED && i !== selected) return;
      const x0 = x(e.start), x1 = Math.max(x0 + 2, x(e.end) + 2);
      s += `<rect class="evband ${e.grid ? 'grid' : 'local'}${selected === i ? ' sel' : ''}" x="${x0}" y="${T}" width="${x1 - x0}" height="${ph}"/>`;
    });
    // area + line
    let path = `M${x(daily[0].date)},${y(daily[0].v)}`;
    daily.forEach(d => path += `L${x(d.date).toFixed(1)},${y(d.v).toFixed(1)}`);
    s += `<path class="area" d="${path}L${x(daily[daily.length - 1].date)},${T + ph}L${x(daily[0].date)},${T + ph}Z"/>`;
    s += `<path class="line" d="${path}"/>`;
    // labeled pins: top 8 events + selected, staggered rows
    const pins = events.slice(0, LABELED).map((e, i) => i);
    if (selected != null && !pins.includes(selected)) pins.push(selected);
    // label placement: 4 rows; put each label in the first row where its text box doesn't overlap another
    const rowsUsed = [[], [], [], []];
    pins.map(i => ({ i, e: events[i], cx: x(events[i].dailyPeakDate || events[i].peak_day) })).sort((a, b) => b.e.peak - a.e.peak).forEach(({ i, e, cx }) => {
      const sub = `${MON[+e.start.slice(5, 7) - 1]} ${e.start.slice(0, 4)} · ${big(e.dailyPeak || e.peak)} out`;
      const w = Math.max(e.name.length * 6.6, sub.length * 5.6) + 10;
      const anchor = cx - w / 2 < L ? 'start' : cx + w / 2 > W - R ? 'end' : 'middle';
      const x0 = anchor === 'start' ? cx : anchor === 'end' ? cx - w : cx - w / 2, x1 = x0 + w;
      let row = rowsUsed.findIndex(r => r.every(([a, b]) => x1 < a || x0 > b));
      if (row < 0) row = rowsUsed.length - 1;
      rowsUsed[row].push([x0, x1]);
      const ly = 16 + row * 25, vy = y(e.dailyPeak || e.peak);
      s += `<g class="pin"><line x1="${cx}" x2="${cx}" y1="${ly + 12}" y2="${vy - 5}"/>
        <text class="${e.grid ? 'grid' : ''}" x="${cx}" y="${ly}" text-anchor="${anchor}">${esc(e.name)}</text>
        <text class="sub" x="${cx}" y="${ly + 11}" text-anchor="${anchor}">${sub}</text></g>
        <circle class="dot ${e.grid ? 'grid' : 'local'}" cx="${cx}" cy="${vy}" r="${selected === i ? 6 : 4.5}"/>`;
    });
    s += `<line class="cross" id="cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`;
    s += `<rect id="hit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    el.innerHTML = s;

    const svg = el.querySelector('svg'), hit = $('hit'), cross = $('cross'), tip = $('tip');
    hit.addEventListener('mousemove', ev => {
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const t = t0 + (p.x - L) / pw * (t1 - t0);
      let lo = 0, hi = daily.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (Date.parse(daily[mid].date) < t) lo = mid + 1; else hi = mid; }
      const d = daily[lo], cx = x(d.date);
      const e = events.find(ev2 => d.date >= ev2.start && d.date <= ev2.end);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = `<b>${dname(d.date)}</b><br>${fmt(d.v)} customers without power` +
        (e ? `<br><b>${esc(e.name)}</b> · ${e.grid ? 'grid-wide' : 'local'} · ${esc(e.main_cause)}` : '');
      tip.hidden = false; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }

  // ---------- causes ----------
  function renderCauses() {
    $('causes').innerHTML = causes.length ? causes.map(c =>
      `<div class="cause"><span>${esc(cap(c.label))}</span><div class="t"><div class="f" style="width:${Math.round(c.share * 100)}%;${c.cause === 'grid' ? 'background:var(--energy)' : ''}"></div></div><b>${Math.round(c.share * 100)}%</b></div>`).join('')
      : '<p class="muted">Run <code>python fetch_events.py</code> to create data/tx_statewide_causes.csv.</p>';
  }
  function renderTakeaways() {
    const wind = causes.find(c => c.cause === 'wind'), grid = causes.find(c => c.cause === 'grid');
    const pts = [];
    if (wind && grid) pts.push(`<b>Wind, not the grid, is the #1 cause.</b> Severe thunderstorms and high winds caused ${Math.round(wind.share * 100)}% of outage hours; the only grid emergency (Uri) caused ${Math.round(grid.share * 100)}%.`);
    pts.push('<b>Local damage needs local backup.</b> More power plants would not have prevented Beryl, the derechos or the ice storms. Crews rebuilding lines take days; a home battery bridges that gap.');
    pts.push('<b>Outages are seasonal and predictable.</b> Spring and early-summer storms dominate most counties, which makes timing campaigns before storm season straightforward (see the sales view for any ZIP).');
    pts.push('<b>The grid-emergency story still matters.</b> Uri is the event people remember, and the one time the grid itself failed. Both kinds of outage end the same way with a Base battery: the lights stay on.');
    $('takeaways').innerHTML = pts.map(p => `<li>${p}</li>`).join('');
  }

  // ---------- table ----------
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('on', x === b));
    renderTable();
  }));
  function renderTable() {
    const all = events.map((e, i) => ({ e, i })).filter(({ e }) => filter === 'all' || (filter === 'grid') === e.grid);
    const rows = showAll ? all : all.slice(0, 20);
    $('events').innerHTML = '<tr><th>Dates</th><th>Event</th><th>Type</th><th>Main cause</th><th class="n">Customers out (peak)</th><th class="n">Counties hit</th></tr>' +
      rows.map(({ e, i }) => `<tr class="ev${selected === i ? ' sel' : ''}" data-i="${i}">
        <td>${dname(e.start)}${e.end !== e.start ? ' – ' + dname(e.end).replace(/, \d{4}$/, e.end.slice(0, 4) === e.start.slice(0, 4) ? '' : ', ' + e.end.slice(0, 4)) : ''}</td>
        <td><b>${esc(e.name)}</b></td>
        <td><span class="tag ${e.grid ? 'grid' : 'local'}">${e.grid ? 'Grid-wide' : 'Local'}</span></td>
        <td>${esc(cap(e.main_cause))}<div class="small muted">${esc(e.cause_mix)}</div></td>
        <td class="n">${fmt(e.peak)}</td><td class="n">${fmt(+e.counties_hit)}</td></tr>`).join('') +
      (all.length > 20 ? `<tr><td colspan="6"><button class="ghost" id="more">${showAll ? 'Show top 20' : `Show all ${all.length} events`}</button></td></tr>` : '');
    const more = $('more'); if (more) more.onclick = () => { showAll = !showAll; renderTable(); };
    $('events').querySelectorAll('tr.ev').forEach(tr => tr.addEventListener('click', () => {
      selected = selected === +tr.dataset.i ? null : +tr.dataset.i;
      renderTimeline(); renderTable();
      $('timeline').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  }
})();
