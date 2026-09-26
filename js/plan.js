// Livewire BI marketing plan: turns the ZIP scores + county outage history into segments, a campaign calendar,
// a target list with a built-in holdout test, and message drafts.
// Data: data/tx_zip_final.csv (build_scores.py), data/tx_county_causes.csv + data/tx_county_events.json (fetch_events.py),
//       data/tx_county_duration.csv (fetch_duration.py), data/tx_statewide_events.csv (fetch_events.py).
(() => {
  const VERSION = '2026-09-26m (marketing plan)';
  const log = (...a) => console.log('%c[Livewire]', 'color:#1E4D2B;font-weight:bold', ...a);
  log('plan.js loaded, version', VERSION);
  const $ = id => document.getElementById(id);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString();
  const big = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const num = v => v === '' || v == null ? null : +v;
  const LS_KEY = 'livewire.selectedUtilities.v1';          // same key the map's utility filter saves to
  const KNOWN = { '2024-05-16': 'Houston derecho', '2024-05-28': 'Memorial Day storms', '2023-02-01': 'Central Texas ice storm',
    '2019-06-09': 'Dallas windstorm' };

  // Outage causes -> marketing segment (grid emergencies are a hook, not a season, so they don't pick the segment)
  const GROUP = { tropical: 'hurricane', flood: 'hurricane', wind: 'storm', tornado: 'storm', hail: 'storm', lightning: 'storm',
    wildfire: 'storm', winter: 'freeze', heat: 'heat', none: 'reliability' };
  const SEG = {
    storm: { name: 'Storm season', color: '#1E4D2B', who: 'Severe thunderstorms and high winds cause most outage hours here.',
      head: c => `Storm season hits ${c} hard. Stay powered through it.`,
      body: 'When wind takes down the lines, a home battery takes over automatically. No generator, no fuel, no noise.' },
    hurricane: { name: 'Hurricane season', color: '#ED6C30', who: 'Hurricanes, tropical storms and their flooding drive the biggest outages here.',
      head: (c, e) => e ? `Remember ${e}? Be ready for the next one.` : 'Hurricane season is here. Is your home ready?',
      body: 'Multi-day outages after a storm are the norm here. Automatic whole-home backup keeps the fridge, A/C and Wi-Fi on.' },
    freeze: { name: 'Freeze readiness', color: '#3E7CB1', who: 'Ice storms and winter weather cause the most outage hours here.',
      head: () => 'The next freeze is coming. Keep your heat on.',
      body: 'Ice brings down lines fast. A home battery keeps heat and water running while crews work.' },
    heat: { name: 'Summer heat', color: '#B8860B', who: 'Outages here cluster in extreme heat.',
      head: () => 'Losing A/C in August is not an option.',
      body: 'Keep cooling on when the power goes out during a heat wave.' },
    reliability: { name: 'Everyday outages', color: '#77A45A', who: 'Many outages here happen with no storm at all (equipment, animals, accidents).',
      head: () => 'Power goes out even on sunny days.',
      body: 'Frequent short outages add up. Backup that switches on automatically means you barely notice.' },
  };
  const ORDER = ['storm', 'hurricane', 'freeze', 'heat', 'reliability'];
  const shortUtil = u => {
    const U = (u || '').toUpperCase();
    if (U.includes('CENTERPOINT')) return 'CenterPoint'; if (U.includes('ONCOR')) return 'Oncor';
    if (U.includes('AEP TEXAS CENTRAL')) return 'AEP Central'; if (U.includes('AEP TEXAS NORTH')) return 'AEP North';
    if (U.includes('TEXAS-NEW MEXICO')) return 'TNMP'; return u || '–';
  };
  const county = r => (r.county_name || '').replace(/ County$/, '');

  let ZIPS = [], CAUSE = {}, EV = { months: [], counties: {} }, DUR = {}, STATE_EVENTS = [];
  let scope = 'sel', minScore = 65, showAll = false, current = null;

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

  // ---------- which utilities ----------
  function selectedUtilities() {
    const base = new Set(ZIPS.filter(r => r.base_market === 'yes').map(r => r.utility || '(unknown)'));
    if (scope === 'base') return { set: base, saved: false };
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(s)) return { set: new Set(s), saved: true };
    } catch (e) {}
    return { set: base, saved: false };
  }

  // ---------- segment per county ----------
  function countySegment(fips) {
    const c = CAUSE[fips]; if (!c) return { seg: 'reliability', shares: {} };
    const g = {}; const shares = {};
    Object.keys(c).filter(k => k.startsWith('share_')).forEach(k => {
      const cause = k.slice(6), v = +c[k] || 0; shares[cause] = v;
      if (GROUP[cause]) g[GROUP[cause]] = (g[GROUP[cause]] || 0) + v;
    });
    const seg = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
    return { seg: seg && seg[1] > 0 ? seg[0] : 'reliability', shares };
  }

  // How often each calendar month is a BAD outage month for this county: share of years in which that month was in the
  // county's top quarter of months (Feb 2021 / Uri excluded). Counting years, not averaging hours, keeps one huge event
  // (Beryl, the 2023 ice storm) from deciding the season on its own; big events are shown separately as anniversaries.
  const monthCache = {};
  function countyMonths(fips) {
    if (monthCache[fips]) return monthCache[fips];
    const c = EV.counties[fips]; const hit = Array(12).fill(0), n = Array(12).fill(0);
    if (!c) return (monthCache[fips] = hit);
    const vals = []; EV.months.forEach((m, i) => { if (m !== '2021-02') vals.push(c.monthly_hours[i] || 0); });
    const q = vals.slice().sort((a, b) => a - b)[Math.floor(0.75 * vals.length)];
    EV.months.forEach((m, i) => { if (m === '2021-02') return; const k = +m.slice(5) - 1; n[k]++; if ((c.monthly_hours[i] || 0) > q) hit[k]++; });
    return (monthCache[fips] = hit.map((v, i) => n[i] ? v / n[i] : 0));
  }

  // label a county's worst event with a storm name, if it has one
  function eventLabel(e) {
    if (e.storm) return e.storm;
    const se = STATE_EVENTS.find(s => KNOWN[s.start] && e.date >= s.start && e.date <= s.end);
    return se ? KNOWN[se.start] : '';
  }

  // ---------- build the plan ----------
  function build() {
    const { set, saved } = selectedUtilities();
    const inScope = r => set.has(r.utility || '(unknown)');
    const targets = ZIPS.filter(r => r.home_fit === 'yes' && inScope(r) && (r._s ?? -1) >= minScore)
      .sort((a, b) => b._s - a._s);
    $('scopeNote').textContent = scope === 'base'
      ? `${set.size} utilities Base sells in today`
      : saved ? `${set.size} utilities checked on the map's By utility tab` : `No selection saved on the map yet, using Base today (${set.size})`;

    const segs = {};
    targets.forEach(r => {
      const { seg, shares } = countySegment(r.county_fips);
      r._seg = seg; r._shares = shares;
      const S = segs[seg] || (segs[seg] = { key: seg, zips: [], homes: 0, weight: 0, counties: {}, months: Array(12).fill(0),
        restore: [], outage: 0, outageW: 0, events: {}, hooks: { tropical: 0, grid: 0, winter: 0 } });
      const h = r.addressable_homes || 0;
      S.zips.push(r); S.homes += h; S.weight += h * r._s;
      S.counties[county(r)] = (S.counties[county(r)] || 0) + h;
      countyMonths(r.county_fips).forEach((v, i) => S.months[i] += v * h);
      const d = DUR[r.county_fips];
      if (d && +d.major_outages >= 3 && d.median_restore_hours !== '') S.restore.push([+d.median_restore_hours, h, +d.p90_restore_hours]);
      if (r.outage_hours != null) { S.outage += r.outage_hours * h; S.outageW += h; }
      ['tropical', 'grid', 'winter'].forEach(k => S.hooks[k] += (shares[k] || 0) * h);
      const c = EV.counties[r.county_fips];
      (c ? c.worst : []).forEach(e => { const L = eventLabel(e); if (L) {
        const E = S.events[L] || (S.events[L] = { label: L, date: e.date, homes: 0 }); E.homes += h; } });
    });
    const totalW = Object.values(segs).reduce((s, S) => s + S.weight, 0) || 1;
    const list = ORDER.filter(k => segs[k]).map(k => {
      const S = segs[k];
      S.share = S.months.map(v => v / (S.homes || 1));        // homes-weighted share of years with a bad outage month
      const ranked = S.share.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      S.peak = ranked.slice(0, 3).map(x => x[1]).sort((a, b) => a - b);
      S.top = ranked[0][1];
      S.launch = (S.top + 11) % 12;
      S.effort = S.weight / totalW;
      S.restore.sort((a, b) => a[0] - b[0]);
      let acc = 0; const half = S.restore.reduce((s, x) => s + x[1], 0) / 2;
      S.medRestore = null; for (const x of S.restore) { acc += x[1]; if (acc >= half) { S.medRestore = x[0]; break; } }
      S.outageAvg = S.outageW ? S.outage / S.outageW : null;
      S.anniv = Object.values(S.events).filter(e => e.label !== 'Winter Storm Uri').sort((a, b) => b.homes - a.homes).slice(0, 2);
      // signature push: the month before the segment's biggest named event, if it isn't next to the season push
      S.sig = null;
      if (S.anniv[0]) { const m = (+S.anniv[0].date.slice(5, 7) + 10) % 12, d = Math.min((m - S.launch + 12) % 12, (S.launch - m + 12) % 12);
        if (d > 1) S.sig = { month: m, label: S.anniv[0].label, event: +S.anniv[0].date.slice(5, 7) - 1 }; }
      S.uriShare = S.hooks.grid / (S.homes || 1);
      S.topCounties = Object.entries(S.counties).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
      return S;
    });

    // test groups: alternate within each segment, best first
    list.forEach(S => S.zips.forEach((r, i) => r._group = i % 2 ? 'Holdout' : 'Campaign'));
    current = { targets, list };
    render();
  }

  // ---------- render ----------
  function render() {
    const { targets, list } = current;
    const homes = targets.reduce((s, r) => s + (r.addressable_homes || 0), 0);
    const first = list.slice().sort((a, b) => b.effort - a.effort)[0];
    const nextLaunch = list.length ? nextMonth(list.flatMap(S => [S.launch].concat(S.sig ? [S.sig.month] : []))) : null;
    $('stats').innerHTML = [
      [fmt(targets.length), 'target ZIPs'],
      [big(homes), 'owner-occupied single-family homes'],
      [list.length, list.length === 1 ? 'segment' : 'segments'],
      [nextLaunch == null ? '–' : MONTH[nextLaunch], 'next campaign push', true],
    ].map(([v, l, hot]) => `<div class="stat"><div class="v${hot ? ' hot' : ''}">${v}</div><div class="l">${l}</div></div>`).join('');

    if (!targets.length) {
      $('summary').innerHTML = '<li>No ZIPs match. Lower the minimum score or select more utilities on the map.</li>';
      ['segs', 'cal', 'targets', 'measure'].forEach(id => $(id).innerHTML = ''); $('more').hidden = true; return;
    }

    // summary
    const bySize = list.slice().sort((a, b) => b.homes - a.homes);
    const s = [];
    s.push(`<b>${fmt(targets.length)} ZIPs, ${big(homes)} homes</b> in ${list.length} segment${list.length > 1 ? 's' : ''}. ` +
      bySize.map(S => `${SEG[S.key].name} ${Math.round(100 * S.homes / homes)}%`).join(' · ') + '.');
    s.push(`<b>Lead with ${SEG[first.key].name.toLowerCase()}</b> (${Math.round(first.effort * 100)}% of suggested effort): ` +
      `${first.topCounties.slice(0, 3).join(', ')}. Season push in <b>${MONTH[first.launch]}</b>: ${MON[first.top]} brings a bad outage month in ` +
      `${Math.round(100 * first.share[first.top])}% of years.` + (first.sig ? ` Signature push in <b>${MONTH[first.sig.month]}</b> before the ${esc(first.sig.label)} anniversary.` : ''));
    const may = list.filter(S => S.top === 4).length;
    if (may === list.length && list.length > 1) s.push('<b>May is the one month every segment shares.</b> A statewide April campaign reaches all of them before it.');
    if (first.medRestore != null) s.push(`<b>Proof point:</b> in ${SEG[first.key].name.toLowerCase()} ZIPs, the typical major outage takes <b>${first.medRestore.toFixed(0)} hours</b> to restore` +
      (first.outageAvg != null ? `, and homes average <b>${first.outageAvg.toFixed(1)} outage hours a year</b>.` : '.'));
    const uri = list.filter(S => S.uriShare >= 0.25).map(S => SEG[S.key].name.toLowerCase());
    const and = a => a.length < 2 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    if (uri.length) s.push(`<b>Uri memory</b> is a secondary hook in ${and(uri)} areas (a quarter or more of their outage hours came from Winter Storm Uri). Run it in January, before the February anniversary.`);
    s.push('<b>Always on:</b> storm-triggered ads when National Weather Service alerts hit target ZIPs, and a check-in to any customer whose battery carried them through an outage.');
    $('summary').innerHTML = s.map(x => `<li>${x}</li>`).join('');

    // segment cards
    $('segs').innerHTML = list.map(S => {
      const A = SEG[S.key], ev = S.anniv[0];
      const c1 = S.topCounties[0] ? S.topCounties[0] + ' County' : 'your area';
      const hooks = [];
      if (S.key !== 'hurricane' && S.hooks.tropical / S.homes >= 0.15) hooks.push('hurricane season');
      if (S.uriShare >= 0.2) hooks.push('Uri memory (Feb)');
      if (S.key !== 'freeze' && S.hooks.winter / S.homes >= 0.1) hooks.push('freeze readiness');
      return `<article class="seg card" style="--c:${A.color}">
        <div class="seg-top"><h3>${A.name}</h3><span class="effort" title="Suggested share of effort: homes × score">${Math.round(S.effort * 100)}%</span></div>
        <div class="bar"><div style="width:${Math.max(2, Math.round(S.effort * 100))}%"></div></div>
        <div class="kv"><b>${fmt(S.zips.length)}</b> ZIPs · <b>${big(S.homes)}</b> homes</div>
        <div class="small muted">${esc(S.topCounties.join(', '))}</div>
        <p class="why">${A.who}</p>
        <dl>
          <dt>Outage season</dt><dd>${S.peak.map(i => MON[i]).join(', ')}</dd>
          <dt>Season push</dt><dd><b>${MONTH[S.launch]}</b></dd>
          ${S.sig ? `<dt>Signature push</dt><dd><b>${MONTH[S.sig.month]}</b> (before ${esc(S.sig.label)})</dd>` : ''}
          <dt>Typical restore</dt><dd>${S.medRestore != null ? S.medRestore.toFixed(0) + ' h after a major outage' : '–'}</dd>
          <dt>Outage hours</dt><dd>${S.outageAvg != null ? S.outageAvg.toFixed(1) + ' per home per year' : '–'}</dd>
          ${S.anniv.length ? `<dt>Anniversaries</dt><dd>${S.anniv.map(e => esc(e.label) + ' (' + MON[+e.date.slice(5, 7) - 1] + ' ' + e.date.slice(0, 4) + ')').join(', ')}</dd>` : ''}
          ${hooks.length ? `<dt>Also works</dt><dd>${hooks.join(', ')}</dd>` : ''}
        </dl>
        <div class="draft"><div class="small muted">Draft headline</div><b>“${esc(A.head(c1, ev && ev.label))}”</b><div class="small">${esc(A.body)}</div></div>
      </article>`;
    }).join('');

    renderCalendar(list);

    // target list
    const rows = targets.slice(0, showAll ? targets.length : 25);
    $('targets').innerHTML = '<tr><th>ZIP</th><th>County</th><th>Utility</th><th>Segment</th><th class="n">Score</th><th class="n">Homes</th><th>Pushes</th><th>Test group</th></tr>' +
      rows.map(r => { const S = list.find(x => x.key === r._seg);
        return `<tr><td><a href="rep.html?zip=${r.zip}" target="_blank">${r.zip}</a></td><td>${esc(county(r))}</td><td>${esc(shortUtil(r.utility))}</td>
        <td><span class="dot" style="background:${SEG[r._seg].color}"></span>${SEG[r._seg].name}</td><td class="n"><b>${r._s.toFixed(1)}</b></td>
        <td class="n">${fmt(r.addressable_homes)}</td><td>${MON[S.launch]}${S.sig ? ' · ' + MON[S.sig.month] : ''}</td><td><span class="grp ${r._group === 'Holdout' ? 'hold' : ''}">${r._group}</span></td></tr>`; }).join('');
    $('more').hidden = targets.length <= 25;
    $('more').textContent = showAll ? 'Show top 25' : `Show all ${targets.length}`;

    // measurement
    const camp = targets.filter(r => r._group === 'Campaign'), hold = targets.filter(r => r._group === 'Holdout');
    const h = a => a.reduce((s, r) => s + (r.addressable_homes || 0), 0);
    const avg = a => a.length ? a.reduce((s, r) => s + r._s, 0) / a.length : 0;
    $('measure').innerHTML = [
      `<b>Holdout test built in:</b> ${camp.length} campaign ZIPs (${big(h(camp))} homes, avg score ${avg(camp).toFixed(1)}) vs ${hold.length} holdout ZIPs (${big(h(hold))} homes, avg score ${avg(hold).toFixed(1)}). Same segments, similar scores; the difference in sign-ups is what marketing added.`,
      '<b>Also tests the score:</b> if higher-scoring holdout ZIPs sign up faster on their own, the score predicts demand.',
      '<b>Track per ZIP:</b> site visits, quote requests, sign-ups per 1,000 homes, cost per sign-up.',
      '<b>Rotate:</b> after one season, flip the groups so every ZIP gets the campaign.',
    ].map(x => `<li>${x}</li>`).join('');
  }

  function nextMonth(ms) {
    const now = new Date().getMonth();
    return ms.map(m => [(m - now + 12) % 12, m]).sort((a, b) => a[0] - b[0])[0][1];
  }

  function renderCalendar(list) {
    const now = new Date().getMonth();
    let h = '<div class="cal"><div class="cal-row head"><div class="cal-name"></div>' +
      MON.map((m, i) => `<div class="cal-cell${i === now ? ' now' : ''}">${m}</div>`).join('') + '</div>';
    list.forEach(S => {
      const mx = Math.max(...S.share);
      const ann = new Set(S.anniv.map(e => +e.date.slice(5, 7) - 1));
      const pushes = new Set([S.launch].concat(S.sig ? [S.sig.month] : []));
      h += `<div class="cal-row"><div class="cal-name"><span class="dot" style="background:${SEG[S.key].color}"></span>${SEG[S.key].name}</div>` +
        S.share.map((v, i) => {
          const a = mx ? v / mx : 0, pk = S.peak.includes(i);
          const tip = `${SEG[S.key].name} · ${MONTH[i]}: a bad outage month in ${Math.round(v * 100)}% of years` +
            (i === S.launch ? ' · SEASON PUSH' : '') + (S.sig && i === S.sig.month ? ' · SIGNATURE PUSH (' + S.sig.label + ')' : '') + (ann.has(i) ? ' · anniversary: ' + S.anniv.filter(e => +e.date.slice(5, 7) - 1 === i).map(e => e.label).join(', ') : '');
          return `<div class="cal-cell" data-tip="${esc(tip)}" style="background:rgba(30,77,43,${(0.08 + 0.8 * a).toFixed(2)});color:${a > .5 ? '#fff' : 'var(--terminal)'}">` +
            `${pushes.has(i) ? '<span class="mark launch">▲</span>' : ''}${ann.has(i) ? '<span class="mark anniv">★</span>' : ''}${pk ? '<i>' + Math.round(v * 100) + '%</i>' : ''}</div>`;
        }).join('') + '</div>';
    });
    // statewide hooks
    h += '<div class="cal-row hooks"><div class="cal-name">Statewide hooks</div>' + MON.map((m, i) => {
      const t = { 0: 'Uri anniversary push (Feb 15, 2021)', 4: 'Hurricane season opens Jun 1', 9: 'Winter readiness' }[i];
      return `<div class="cal-cell hook"${t ? ` data-tip="${esc(t)}"` : ''}>${t ? '<span>' + (i === 0 ? 'Uri' : i === 4 ? 'Hurr. prep' : 'Winter') + '</span>' : ''}</div>`;
    }).join('') + '</div></div>';
    $('cal').innerHTML = h;
  }

  // ---------- export ----------
  function exportCSV() {
    if (!current) return;
    const { targets, list } = current;
    const cols = ['zip', 'county', 'utility', 'segment', 'score', 'addressable_homes', 'season_push', 'signature_push', 'outage_season', 'test_group', 'draft_headline', 'sales_view'];
    const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    const lines = [cols.join(',')].concat(targets.map(r => {
      const S = list.find(x => x.key === r._seg), A = SEG[r._seg], ev = S.anniv[0];
      return [r.zip, county(r), shortUtil(r.utility), A.name, r._s.toFixed(1), r.addressable_homes || 0, MONTH[S.launch], S.sig ? MONTH[S.sig.month] + ' (' + S.sig.label + ')' : '',
        S.peak.map(i => MON[i]).join(' '), r._group, A.head(county(r) + ' County', ev && ev.label),
        location.href.replace(/plan\.html.*$/, '') + 'rep.html?zip=' + r.zip].map(q).join(',');
    }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `livewire_marketing_plan_min${minScore}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- wiring ----------
  document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
    scope = b.dataset.scope; document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b)); build();
  }));
  $('min').addEventListener('input', e => { minScore = +e.target.value; $('minVal').textContent = minScore; build(); });
  $('more').addEventListener('click', () => { showAll = !showAll; render(); });
  $('export').addEventListener('click', exportCSV);
  const tip = $('tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - 270) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });

  // ---------- market signals: permits + news ----------
  function spearman(a, b) {                                   // rank correlation with average ranks for ties
    const rk = v => { const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = Array(v.length);
      for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
        for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
    const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  function addUtility(u) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
    const set = new Set(Array.isArray(saved) ? saved : ZIPS.filter(r => r.base_market === 'yes').map(r => r.utility || '(unknown)'));
    set.add(u); try { localStorage.setItem(LS_KEY, JSON.stringify([...set])); } catch (e) {}
    scope = 'sel'; document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x.dataset.scope === 'sel'));
    build(); renderPermits(PERMITS);
  }
  let PERMITS = null;
  function renderPermits(p) {
    const el = $('permits');
    if (!p || p.error || !p.months) { el.innerHTML = `<p class="small muted">${esc((p && p.error) || 'Permit data unavailable.')}</p>`; return; }
    PERMITS = p;
    const byZip = Object.fromEntries(ZIPS.map(r => [r.zip, r]));
    // months: from the first month with permits to now, zeros filled
    const have = Object.fromEntries(p.months.map(m => [m.m, m.n]));
    const first = p.months.length ? p.months[0].m : null, now = new Date(), cur = now.toISOString().slice(0, 7);
    const ms = []; if (first) { let [y, m] = first.split('-').map(Number);
      while (`${y}-${String(m).padStart(2, '0')}` <= cur && ms.length < 36) { ms.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } }
    const W = 520, H = 170, pad = 22, bw = (W - 2 * pad) / Math.max(ms.length, 1), mx = Math.max(1, ...ms.map(m => have[m] || 0));
    const bars = ms.map((m, i) => { const v = have[m] || 0, h = (H - 44) * v / mx, x = pad + i * bw, y = H - 22 - h;
      return `<rect class="b${m === cur ? ' cur' : ''}" x="${(x + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" data-tip="${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}: ${v} battery permits${m === cur ? ' (month to date)' : ''}"/>` +
        (v ? `<text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${v}</text>` : '') +
        (ms.length <= 12 || i % 3 === 0 || m === cur ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${MON[+m.slice(5) - 1]}${m.endsWith('-01') || i === 0 ? " '" + m.slice(2, 4) : ''}</text>` : '');
    }).join('');
    // ZIP comparison: installs per 1,000 owned homes vs Livewire score and home value, within the city's utility
    const zrows = p.zips.map(z => ({ ...z, r: byZip[z.z] })).filter(z => z.r);
    const util = p.utility, uz = ZIPS.filter(r => r.utility === util && (r.addressable_homes || 0) > 300);
    const cnt = Object.fromEntries(p.zips.map(z => [z.z, z.n]));
    const rate = uz.map(r => 1000 * (cnt[r.zip] || 0) / r.addressable_homes);
    const rhoScore = uz.length > 8 ? spearman(uz.map(r => r._s), rate) : null;
    const rhoValue = uz.length > 8 ? spearman(uz.map(r => +r.median_home_value || 0), rate) : null;
    const medScore = (() => { const v = zrows.slice(0, 10).map(z => z.r._s).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; })();
    const { set } = selectedUtilities(), inPlan = set.has(util);
    const last = p.months[p.months.length - 1];
    let ins = '';
    if (!inPlan) ins += `<div class="insight warn"><b>New market:</b> Base is installing in ${esc(util)} territory, which isn't in this plan's utilities yet.` +
      `<button class="ghost" id="addUtil">Add ${esc(util)} to the plan</button></div>`;
    if (rhoScore != null) ins += `<div class="insight"><b>Ground-truth check:</b> across ${uz.length} ${esc(util)} ZIPs, installs per home so far follow ` +
      `<b>home value</b> (rank correlation ${rhoValue.toFixed(2)}) more than the Livewire score (${rhoScore.toFixed(2)}). ` +
      `The top 10 install ZIPs have a median score of ${medScore != null ? medScore.toFixed(0) : '–'}. Early adopters in a new market skew affluent, ` +
      `and outage history is county-level, so the score can't separate ZIPs inside one county. Worth re-checking as the rollout spreads.</div>`;
    el.innerHTML = `<div class="perm-top"><div>
        <div class="perm-stats">
          <div><b>${fmt(p.total)}</b><span>battery permits</span></div>
          <div class="hot"><b>${p.last30 != null ? fmt(p.last30) : '–'}</b><span>in the last 30 days</span></div>
          <div><b>${fmt(p.zips.length)}</b><span>ZIPs</span></div>
          <div><b>${last ? MON[+last.m.slice(5) - 1] + ' ' + last.m.slice(0, 4) : '–'}</b><span>latest month</span></div>
        </div>
        <div id="permChart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Base Power battery permits by month">${bars}</svg></div>
        ${ins}
      </div><div>
        <table id="permZips"><tr><th>ZIP</th><th class="n">Installs</th><th class="n">Per 1k homes</th><th class="n">Score</th><th class="n">Home value</th></tr>` +
      zrows.slice(0, 10).map(z => `<tr><td><a href="rep.html?zip=${z.z}" target="_blank">${z.z}</a></td><td class="n"><b>${z.n}</b></td>` +
        `<td class="n">${z.r.addressable_homes ? (1000 * z.n / z.r.addressable_homes).toFixed(1) : '–'}</td><td class="n">${z.r._s.toFixed(0)}</td>` +
        `<td class="n">${z.r.median_home_value ? '$' + big(+z.r.median_home_value) : '–'}</td></tr>`).join('') +
      `</table><p class="small muted">Residential "auxiliary power" permits with Base Power as contractor. Counts by ZIP and month only; ` +
      `no addresses. Refreshed from the city twice a day.</p></div></div>`;
    const b = $('addUtil'); if (b) b.addEventListener('click', () => addUtility(util));
  }
  function renderNews(n) {
    const el = $('news');
    if (!n || !n.items) { el.innerHTML = '<p class="small muted">Headlines unavailable right now.</p>'; return; }
    $('newsMeta').textContent = `${n.feeds_ok} of ${n.feeds} publisher feeds`;
    el.innerHTML = n.items.length ? n.items.slice(0, 6).map(i => `<div class="news-item"><div class="meta">${esc(i.date)} · ${esc(i.source)}</div>` +
      `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${i.summary ? `<p>${esc(i.summary)}</p>` : ''}</div>`).join('')
      : '<p class="small muted">No recent articles mention Base Power.</p>';
  }
  function loadSignals() {
    fetch('permits.php').then(r => r.json()).catch(() => null).then(renderPermits);
    fetch('news.php').then(r => r.json()).catch(() => null).then(renderNews);
  }

  Promise.all([get('data/tx_zip_final.csv'), get('data/tx_county_causes.csv'), get('data/tx_county_duration.csv'),
    get('data/tx_statewide_events.csv'), fetch('data/tx_county_events.json').then(r => r.ok ? r.json() : null).catch(() => null)])
    .then(([z, c, d, se, ev]) => {
      ZIPS = z.map(r => Object.assign(r, { _s: num(r.resilience_demand_score), addressable_homes: num(r.addressable_homes),
        outage_hours: num(r.outage_hours) })).filter(r => r._s != null);
      c.forEach(r => CAUSE[r.county_fips] = r);
      d.forEach(r => DUR[r.county_fips] = r);
      STATE_EVENTS = se; if (ev) EV = ev;
      log('loaded', ZIPS.length, 'ZIPs,', c.length, 'counties');
      if (!ZIPS.length) { $('summary').innerHTML = '<li>Data not ready: data/tx_zip_final.csv is missing.</li>'; return; }
      build();
      loadSignals();
    });
})();
