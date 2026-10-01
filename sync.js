/* Waypoint part 4: Apple Health relay. An iPhone Shortcut copies the last week of Health readings and workouts into a
   secret GitHub gist; Waypoint reads that gist (no token needed) and merges it in.
   Strava has no free API (a paid subscription has been required since June 2026), so Strava is reached through Apple Health:
   Strava writes its activities into Health, and Watch workouts flow from Health to Strava on their own.
   Runs only while Waypoint is open: at launch, when it returns to the foreground, and every 30 minutes. */
'use strict';
const WSYNC = (() => {
  const GIST_FILE = 'waypoint-health.txt';
  const AUTO_GAP = 10 * 60 * 1000; // automatic checks at most every 10 minutes
  const st = { gist: null, ignore: [], lastRun: 0, busy: false, err: '' };

  const r2 = (x) => Math.round(x * 100) / 100;
  const ago = (iso) => {
    if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} hr ago`;
    return fmtShort(dayKey(new Date(iso)));
  };
  async function rawPut(s) { const i = S.sessions.findIndex((x) => x.id === s.id); if (i >= 0) S.sessions[i] = s; else S.sessions.push(s); await DB.put('sessions', s); }
  const modeOf = (s) => (s.cardio ? s.cardio.mode : s.kind);
  const family = (m) => ({ run: 'run', trail: 'run', 'treadmill-run': 'run', walk: 'walk', hike: 'walk', row: 'row', bike: 'bike', strength: 'strength', mobility: 'mobility' }[m] || 'other');
  const closeMins = (a, b) => !a || !b || Math.abs(a - b) <= Math.max(8, 0.25 * Math.max(a, b));

  /* ---------- parsing the relay file ---------- */
  function parseDate(v) { const t = String(v || '').trim(); let d = new Date(t); if (isNaN(d)) d = new Date(t.replace(/\s+at\s+/i, ' ')); return isNaN(d) ? null : d; }
  const numIn = (v) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(v || '').replace(/,(?=\d{3}\b)/g, '')); return m ? parseFloat(m[0].replace(',', '.')) : null; };
  // Workout type text from Shortcuts ("Running", "Traditional Strength Training", "HKWorkoutActivityTypeRowing", ...) -> Waypoint mode
  function workoutMode(t) {
    t = String(t || '').toLowerCase().replace(/hkworkoutactivitytype/, '');
    if (/trail/.test(t)) return 'trail';
    if (/run/.test(t)) return 'run';
    if (/hik/.test(t)) return 'hike';
    if (/walk/.test(t)) return 'walk';
    if (/row/.test(t)) return 'row';
    if (/cycl|bik|ride/.test(t)) return 'bike';
    if (/strength|core|weight/.test(t)) return 'strength';
    if (/yoga|flexib|mind|cooldown|pilates|stretch/.test(t)) return 'mobility';
    return 'other';
  }
  function distMiles(v) {
    const n = numIn(v); if (n === null || n <= 0) return null; const t = String(v).toLowerCase();
    if (/km|kilomet/.test(t)) return r2(n / 1.609344);
    if (/\d\s*m\b|meter|metre/.test(t)) return r2(n / 1609.344);
    if (/yd|yard/.test(t)) return r2(n / 1760);
    return r2(n);
  }
  function parseRelay(text) {
    const out = { weights: {}, bf: {}, rhr: {}, vo2: {}, workouts: [], newest: null };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const p = raw.split(/\s*[|\t;]\s*/); if (p.length < 3) continue;
      const tag = p[0].trim().toLowerCase();
      const type = /^k$|workout/.test(tag) ? 'k' : /^w$|weight|body ?mass/.test(tag) ? 'w' : /^f$|fat/.test(tag) ? 'f' : /^r$|resting/.test(tag) ? 'r' : /^v$|vo2/.test(tag) ? 'v' : null;
      if (!type) continue;
      const d = parseDate(p[1]); if (!d) continue; const k = dayKey(d); const at = d.toISOString();
      if (type === 'k') {
        // K|start|end|type|distance|active energy
        const end = parseDate(p[2]); if (!end || end <= d) continue;
        const minutes = Math.max(1, Math.round((end - d) / 60000)); if (minutes > 24 * 60) continue;
        const kc = numIn(p[5]);
        out.workouts.push({ start: at, date: k, minutes, type: (p[3] || '').trim(), mode: workoutMode(p[3]), dist: distMiles(p[4]), kcal: kc !== null ? Math.round(kc) : null });
      } else {
        let v = numIn(p[2]); if (v === null) continue; const unit = (p[3] || '').trim().toLowerCase();
        if (type === 'w') { if (unit === 'kg') v *= ENG.LB_PER_KG; if (v < 70 || v > 600) continue; if (!out.weights[k] || out.weights[k].at < at) out.weights[k] = { v: r1(v), at }; }
        if (type === 'f') { if (v <= 1) v = Math.round(v * 1000) / 10; if (v < 2 || v > 70) continue; if (!out.bf[k] || out.bf[k].at < at) out.bf[k] = { v: r1(v), at }; }
        if (type === 'r') { if (v < 25 || v > 150) continue; out.rhr[k] = { v: Math.round(v), at }; }
        if (type === 'v') { if (v < 10 || v > 90) continue; out.vo2[k] = { v: r1(v), at }; }
      }
      if (!out.newest || out.newest < at) out.newest = at;
    }
    return out;
  }

  /* ---------- merging workouts ---------- */
  async function mergeWorkouts(list) {
    const ignore = new Set(st.ignore); let added = 0, linked = 0;
    for (const w of list.sort((a, b) => (a.start < b.start ? -1 : 1))) {
      const t = new Date(w.start);
      // Already here (an earlier relay run, the export import, or a second copy that Strava wrote back into Health)?
      if (ignore.has(w.start) || S.sessions.some((s) => s.hkStart && Math.abs(new Date(s.hkStart) - t) <= 5 * 60000)) continue;
      const kind = w.mode === 'strength' ? 'strength' : w.mode === 'mobility' ? 'mobility' : 'cardio';
      // A session logged by hand in Waypoint for the same workout: link it rather than add a second one.
      const hit = S.sessions.find((s) => !s.hkStart && s.status === 'done' && s.date === w.date && (s.source || 'app') === 'app'
        && family(modeOf(s)) === family(w.mode) && (kind === 'strength' || closeMins(s.minutes, w.minutes)));
      if (hit) {
        hit.hkStart = w.start;
        if (hit.cardio) { if (!hit.cardio.dist && w.dist) hit.cardio.dist = w.dist; if (!hit.cardio.kcal && w.kcal) hit.cardio.kcal = w.kcal; }
        await rawPut(hit); linked++; continue;
      }
      const typeName = String(w.type || '').replace(/^HKWorkoutActivityType/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      const label = w.mode === 'other' ? (typeName || 'Workout') : (CARDIO_MODES.find((m) => m[0] === w.mode) || [0, kind === 'strength' ? 'Strength training' : 'Mobility'])[1];
      await rawPut({ id: uid(), date: w.date, tpl: 'health', name: `${label} (Watch)`, kind, status: 'done', startedAt: w.start, hkStart: w.start, minutes: w.minutes, source: 'health',
        cardio: kind === 'cardio' ? { mode: w.mode, minutes: w.minutes, dist: w.dist, avgHR: null, kcal: w.kcal } : null, blocks: kind === 'cardio' ? null : [] });
      added++;
    }
    return { added, linked };
  }

  /* ---------- fetching ---------- */
  const gistId = (v) => { const m = /([0-9a-f]{20,40})\/?$/i.exec(String(v || '').trim().replace(/[#?].*$/, '')); return m ? m[1] : ''; };
  async function pullHealth() {
    const g = st.gist; const res = await fetch(`https://api.github.com/gists/${g.id}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.status === 404) throw new Error('The Health gist was not found. Check the gist link in Settings.');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests for now; Waypoint will try again later.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the Health gist`);
    const j = await res.json(); const f = (j.files || {})[GIST_FILE] || Object.values(j.files || {})[0]; if (!f) return { readings: 0, added: 0, linked: 0 };
    let text = f.content; if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    const r = parseRelay(text); let n = 0;
    for (const [k, x] of Object.entries(r.weights)) { const d = S.days[k] || {}; if (!d.weight || (d.wSrc === 'health' && d.weight !== x.v)) { await saveDay(k, { weight: x.v, wSrc: 'health' }); n++; } }
    for (const [k, x] of Object.entries(r.bf)) { const d = S.days[k] || {}; if (!d.bf || (d.bfSrc === 'health' && d.bf !== x.v)) { await saveDay(k, { bf: x.v, bfSrc: 'health' }); n++; } }
    for (const [k, x] of Object.entries(r.rhr)) if ((S.days[k] || {}).rhr !== x.v) { await saveDay(k, { rhr: x.v }); n++; }
    for (const [k, x] of Object.entries(r.vo2)) if ((S.days[k] || {}).vo2 !== x.v) { await saveDay(k, { vo2: x.v }); n++; }
    const w = await mergeWorkouts(r.workouts);
    Object.assign(g, { lastFetch: new Date().toISOString(), gistUpdated: j.updated_at || null, newest: r.newest || g.newest || null }); await DB.setMeta('gist', g);
    return { readings: n, ...w };
  }

  async function syncAll(force) {
    if (st.busy || !navigator.onLine || !(st.gist && st.gist.id)) return false;
    if (!force && Date.now() - st.lastRun < AUTO_GAP) return false;
    st.busy = true; st.lastRun = Date.now(); let r = null;
    try { r = await pullHealth(); st.err = ''; } catch (e) { st.err = e.message; }
    await DB.setMeta('syncLast', { at: new Date().toISOString(), err: st.err }); st.busy = false;
    const msg = []; if (r) { if (r.added) msg.push(`${r.added} workout${r.added > 1 ? 's' : ''}`); if (r.linked) msg.push(`${r.linked} linked to your logs`); if (r.readings) msg.push(`${r.readings} reading${r.readings > 1 ? 's' : ''}`); }
    if (r && (r.added || r.linked || r.readings)) render();
    if (force) toast(st.err ? `Health sync problem: ${st.err}` : msg.length ? `From Apple Health: ${msg.join(', ')}` : 'Apple Health: nothing new', st.err ? 7000 : 2500);
    else if (msg.length) toast(`From Apple Health: ${msg.join(', ')}`);
    return true;
  }

  async function boot() {
    st.gist = await DB.meta('gist', null); st.ignore = await DB.meta('healthIgnore', []);
    const last = await DB.meta('syncLast', null); if (last) st.err = last.err || '';
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(false).catch(() => {}); });
    window.addEventListener('online', () => syncAll(false).catch(() => {}));
    setInterval(() => { if (!document.hidden) syncAll(false).catch(() => {}); }, 30 * 60 * 1000);
    syncAll(false).catch(() => {});
  }
  // Deleting a relayed workout keeps the next relay run from bringing it back.
  async function forget(s) { if (s && s.hkStart && s.source === 'health') { st.ignore = [...new Set([...st.ignore, s.hkStart])].slice(-500); await DB.setMeta('healthIgnore', st.ignore); } }

  /* ---------- Settings sheet ---------- */
  function openSettingsSheet() {
    const g = st.gist || {};
    const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Apple Health sync</div><span style="min-width:64px"></span></header>
      <div class="scroll">
      <div class="card"><h3>Apple Health${g.id ? '<span class="r">on</span>' : ''}</h3>
        <p class="small" style="margin-top:0">An iPhone Shortcut copies the last week of workouts, weight, body fat, resting heart rate and VO2 max from Apple Health into a private GitHub gist. Waypoint reads it whenever it opens. A workout you also logged by hand here is linked to the Watch recording, not added twice.</p>
        ${g.id ? `<div class="kv"><span>Newest reading</span><span>${esc(ago(g.newest))}</span><span>Shortcut last ran</span><span>${esc(ago(g.gistUpdated))}</span><span>Checked</span><span>${esc(ago(g.lastFetch))}</span></div>` : ''}
        <label class="f">Gist link</label><input class="field" id="gid" autocomplete="off" placeholder="https://gist.github.com/…" value="${esc(g.url || '')}">
        <div class="row" style="margin-top:10px"><button class="btn grow" data-a="gsave">${g.id ? 'Save and check now' : 'Save'}</button>${g.id ? '<button class="btn ghost" data-a="goff">Turn off</button>' : ''}</div>
        <details style="margin-top:12px"><summary class="small"><b>Shortcut setup steps</b></summary>${SHORTCUT_STEPS}</details></div>
      <div class="card"><h3>Strava</h3>
        <p class="small" style="margin:0 0 6px">Strava's API now requires a paid Strava subscription, so Waypoint reaches Strava through Apple Health instead:</p>
        <ul class="cues small"><li>In the Strava app, turn on its Apple Health connection: sending activities to Health, and automatic uploads. Strava activities then arrive here through the Shortcut above.</li>
        <li>Strava accepts only workouts recorded in Apple's own Workout app. To put a Waypoint session on Strava, start the matching Watch workout (Strength Training, Indoor Run, Indoor Rower) when you start it. Waypoint links the two.</li></ul></div>
      <p class="note muted tiny">${st.err ? `<span style="color:var(--danger)">Last problem: ${esc(st.err)}</span><br>` : ''}Sync runs while Waypoint is open: at launch, when you switch back to it, and every 30 minutes. iPhone does not let web apps sync in the background, and Health can't be read while the iPhone is locked.</p></div>`);
    const reopen = () => { el.remove(); openSettingsSheet(); };
    el.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'x') { el.remove(); render(); }
      if (a.dataset.a === 'gsave') { const v = $('#gid', el).value.trim(); const id = gistId(v); if (!id) return toast('Paste the gist link from the address bar');
        st.gist = { ...(st.gist || {}), id, url: v }; await DB.setMeta('gist', st.gist); await syncAll(true); reopen(); }
      if (a.dataset.a === 'goff') { st.gist = null; await DB.setMeta('gist', null); reopen(); }
    });
  }
  const SHORTCUT_STEPS = `<ol class="small" style="padding-left:18px">
    <li><b>Wyze app:</b> make sure it shares weight and body fat with Apple Health.</li>
    <li><b>Token:</b> on github.com, open Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token. Name it Waypoint Health, set an expiration, and under Account permissions set <b>Gists</b> to Read and write. Nothing else. Copy the token.</li>
    <li><b>Gist:</b> on gist.github.com, create a <b>secret</b> gist. File name <b>${GIST_FILE}</b>, content: start. Copy the page's address and paste it above as the Gist link.</li>
    <li><b>Shortcut:</b> in the Shortcuts app, make a new shortcut named Waypoint Health.
      <ol type="a" style="padding-left:18px">
        <li><b>Find Health Samples</b> where Type is Workouts and Start Date is in the last 7 days.</li>
        <li><b>Repeat with Each</b> item. Inside it, add a <b>Text</b> action reading <code>K|Start Date|End Date|Workout Activity Type|Distance|Active Energy</code>. Each name after K| is a property of Repeat Item: tap Repeat Item to pick it, and set both dates' format to ISO 8601. Then <b>Add to Variable</b> named Lines.</li>
        <li>Add the same pair for Weight, with the text <code>W|Start Date|Value|Unit</code> (Start Date in ISO 8601), adding to Lines.</li>
        <li>Repeat that for Body Fat Percentage (<code>F|</code>), Resting Heart Rate (<code>R|</code>) and VO2 Max (<code>V|</code>).</li>
        <li><b>Combine Text</b>: Lines, with New Lines.</li>
        <li><b>Get Contents of URL</b>: <code>https://api.github.com/gists/</code> followed by your gist's ID (the long code at the end of its address). Method PATCH. Headers: Authorization = <code>Bearer</code>, a space, then your token; Accept = <code>application/vnd.github+json</code>. Request Body JSON: key <b>files</b> (Dictionary) › key <b>${GIST_FILE}</b> (Dictionary) › key <b>content</b> (Text) = Combined Text.</li></ol></li>
    <li><b>Automation:</b> in Shortcuts › Automation, add App › Wyze › Is Closed › Run Immediately › Waypoint Health. Add the same for the Fitness app (and Strava) so workouts arrive after you look at them, plus a daily one at a time the phone is usually unlocked.</li>
    <li>Run the shortcut once by hand and allow Health access when asked. Settings here then shows the newest reading.</li></ol>`;

  return { boot, syncAll, openSettingsSheet, forget, parseRelay, workoutMode, gistId, _st: st };
})();
