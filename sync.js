/* Waypoint part 4: two-way Strava sync and the Apple Health relay (iPhone Shortcut -> private GitHub gist -> Waypoint).
   Runs only while Waypoint is open: on launch, when it comes back to the foreground, every 30 minutes, and after a session is saved.
   Strava credentials live only in this phone's IndexedDB ('strava' meta key) and are left out of backups. */
'use strict';
const WSYNC = (() => {
  const API = 'https://www.strava.com/api/v3';
  const OAUTH = 'https://www.strava.com/oauth';
  const SCOPE = 'read,activity:read_all,activity:write';
  const GIST_FILE = 'waypoint-health.txt';
  const AUTO_GAP = 10 * 60 * 1000;        // automatic syncs at most every 10 minutes
  const CARDIO_WAIT = 3 * 3600 * 1000;    // hand-logged cardio waits 3 hours for the Watch's own upload before Waypoint posts it
  const PUSH_RETRY = 24 * 3600 * 1000;    // an upload whose answer never came back is not retried for a day (the pull usually links it first)
  const st = { strava: null, gist: null, ignore: [], lastRun: 0, busy: false, err: '' };

  /* ---------- small helpers ---------- */
  const callbackUrl = () => location.origin + location.pathname;
  const r2 = (x) => Math.round(x * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ago = (iso) => {
    if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} hr ago`;
    return fmtShort(dayKey(new Date(iso)));
  };
  async function rawPut(s) { const i = S.sessions.findIndex((x) => x.id === s.id); if (i >= 0) S.sessions[i] = s; else S.sessions.push(s); await DB.put('sessions', s); }
  const saveStrava = () => DB.setMeta('strava', st.strava);

  /* ---------- activity type mapping ---------- */
  // Strava sport_type -> Waypoint kind and cardio mode
  function fromStrava(a) {
    const t = a.sport_type || a.type || 'Workout';
    if (t === 'Run') return { kind: 'cardio', mode: a.trainer ? 'treadmill-run' : 'run' };
    if (t === 'VirtualRun') return { kind: 'cardio', mode: 'treadmill-run' };
    if (t === 'TrailRun') return { kind: 'cardio', mode: 'trail' };
    if (t === 'Walk') return { kind: 'cardio', mode: 'walk' };
    if (t === 'Hike') return { kind: 'cardio', mode: 'hike' };
    if (t === 'Rowing' || t === 'VirtualRow') return { kind: 'cardio', mode: 'row' };
    if (/Ride$|^Velomobile$|^Handcycle$/.test(t)) return { kind: 'cardio', mode: 'bike' };
    if (t === 'WeightTraining') return { kind: 'strength', mode: 'strength' };
    if (t === 'Yoga' || t === 'Pilates') return { kind: 'mobility', mode: 'mobility' };
    return { kind: 'cardio', mode: 'other' };
  }
  // Waypoint session -> Strava sport_type and trainer flag
  function toStrava(s) {
    if (s.kind === 'strength') return { sport_type: 'WeightTraining', trainer: 0 };
    if (s.kind === 'mobility') return { sport_type: 'Workout', trainer: 0 };
    const [sport_type, trainer] = { run: ['Run', 0], trail: ['TrailRun', 0], 'treadmill-run': ['Run', 1], walk: ['Walk', 0], hike: ['Hike', 0], row: ['Rowing', 1], bike: ['Ride', 0] }[(s.cardio || {}).mode] || ['Workout', 0];
    return { sport_type, trainer };
  }
  const modeOf = (s) => (s.cardio ? s.cardio.mode : s.kind);
  const family = (m) => ({ run: 'run', trail: 'run', 'treadmill-run': 'run', walk: 'walk', hike: 'walk', row: 'row', bike: 'bike', strength: 'strength', mobility: 'mobility' }[m] || 'other');
  const closeMins = (a, b) => !a || !b || Math.abs(a - b) <= Math.max(8, 0.25 * Math.max(a, b));

  /* ---------- Strava auth ---------- */
  function connect() {
    const c = st.strava || {};
    if (!c.clientId || !c.clientSecret) return toast('Enter the Client ID and Client Secret first');
    c.state = uid(); st.strava = c; saveStrava().then(() => {
      location.href = `${OAUTH}/authorize?client_id=${encodeURIComponent(c.clientId)}&redirect_uri=${encodeURIComponent(callbackUrl())}&response_type=code&approval_prompt=auto&scope=${SCOPE}&state=${c.state}`;
    });
  }
  async function tokenRequest(body) {
    const c = st.strava;
    const res = await fetch(`${OAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((j.errors && j.errors[0] && `${j.errors[0].field} ${j.errors[0].code}`) || j.message || `Strava answered ${res.status}`); e.status = res.status; throw e; }
    return j;
  }
  async function exchange(code, scope) {
    const j = await tokenRequest({ code: code.trim(), grant_type: 'authorization_code' });
    const c = st.strava;
    Object.assign(c, { access: j.access_token, refresh: j.refresh_token, expiresAt: j.expires_at, scope: scope || c.scope || '',
      athlete: j.athlete ? { id: j.athlete.id, first: j.athlete.firstname || '', last: j.athlete.lastname || '' } : c.athlete || null,
      since: c.since || todayKey(), push: c.push !== false, lastPull: c.lastPull || null, needsReconnect: false, connectedAt: new Date().toISOString() });
    delete c.state; await saveStrava();
  }
  async function accessToken(force) {
    const c = st.strava;
    if (!force && c.access && c.expiresAt * 1000 - Date.now() > 3600 * 1000) return c.access;
    try {
      const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh });
      c.access = j.access_token; c.refresh = j.refresh_token; c.expiresAt = j.expires_at; await saveStrava();
      return c.access;
    } catch (e) {
      if (e.status === 400 || e.status === 401) { c.needsReconnect = true; await saveStrava(); throw new Error('Strava access was revoked or expired. Reconnect in Settings.'); }
      throw e;
    }
  }
  async function api(path, opts = {}, retried) {
    const tok = await accessToken(false);
    const res = await fetch(API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok}` } });
    if (res.status === 401 && !retried) { await accessToken(true); return api(path, opts, true); }
    if (res.status === 429) throw new Error('Strava rate limit reached; it will try again later.');
    const j = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error((j && j.message) || `Strava answered ${res.status}`); e.status = res.status; e.body = j; throw e; }
    return j;
  }
  const connected = () => !!(st.strava && st.strava.refresh && !st.strava.needsReconnect);

  // OAuth return: ?code=...&scope=...&state=...  (or ?error=access_denied)
  async function handleReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', callbackUrl());
    if (q.get('error')) return toast('Strava connection was cancelled');
    const code = q.get('code'), scope = q.get('scope') || '';
    const c = st.strava;
    if (!c || !c.clientSecret || (c.state && q.get('state') !== c.state)) {
      // The return landed in a browser that is not the Home Screen copy of Waypoint (separate storage). Hand the code over by copy and paste.
      const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Strava code</div><span style="min-width:64px"></span></header>
        <div class="scroll"><div class="card"><p class="small">Strava sent its approval to this browser, not to the Waypoint on your Home Screen. Copy this code, open Waypoint from the Home Screen, and paste it in <b>Settings › Strava and Apple Health › Paste a Strava code</b>. It works once and expires within minutes.</p>
        <input class="field" readonly value="${esc(code)}" id="sc"><button class="btn block" style="margin-top:10px" data-a="copy">Copy code</button></div></div>`);
      el.addEventListener('click', async (ev) => { const a = ev.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'x') el.remove();
        if (a.dataset.a === 'copy') { try { await navigator.clipboard.writeText(code); toast('Copied'); } catch (e) { $('#sc', el).select(); toast('Select the code and copy it'); } } });
      return;
    }
    if (!/activity:read/.test(scope)) toast('Strava did not grant activity access; Waypoint can\'t read your activities. Connect again and leave the boxes checked.', 7000);
    try { await exchange(code, scope); toast('Strava connected. Syncing…'); await syncAll(true); }
    catch (e) { toast(`Strava connection failed: ${e.message}`, 7000); }
  }
  async function disconnect() {
    try { if (st.strava && st.strava.access) await fetch(`${OAUTH}/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken(false)}` } }); } catch (e) { /* revoking is best effort */ }
    const c = st.strava || {}; st.strava = { clientId: c.clientId || '', clientSecret: c.clientSecret || '' }; await saveStrava();
  }

  /* ---------- Strava pull ---------- */
  async function pull() {
    const c = st.strava; const ignore = new Set(st.ignore);
    const after = c.lastPull ? Math.floor(new Date(c.lastPull) / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 365 * 86400;
    const started = new Date().toISOString(); let added = 0, linked = 0;
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/athlete/activities?after=${after}&per_page=200&page=${page}`);
      if (!Array.isArray(list) || !list.length) break;
      for (const a of list) {
        if (ignore.has(a.id) || S.sessions.some((s) => s.stravaId === a.id)) continue;
        const m = fromStrava(a); const start = new Date(a.start_date); const date = (a.start_date_local || a.start_date).slice(0, 10);
        const minutes = Math.max(1, Math.round((a.moving_time || a.elapsed_time || 60) / 60));
        const dist = a.distance ? r2(a.distance / 1609.344) : null; const hr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
        const kcal = a.calories ? Math.round(a.calories) : null;
        const pool = S.sessions.filter((s) => !s.stravaId && s.status === 'done' && s.date === date);
        const hit = pool.find((s) => s.hkStart && Math.abs(new Date(s.hkStart) - start) <= 5 * 60000)
          || pool.find((s) => s.source !== 'health' && family(modeOf(s)) === family(m.mode) && (m.kind === 'strength' || closeMins(s.minutes, minutes)));
        if (hit) {
          hit.stravaId = a.id; delete hit.stravaPushAt;
          if (hit.cardio) { if (!hit.cardio.dist && dist) hit.cardio.dist = dist; if (!hit.cardio.avgHR && hr) hit.cardio.avgHR = hr; if (!hit.cardio.kcal && kcal) hit.cardio.kcal = kcal; }
          await rawPut(hit); linked++;
        } else {
          await rawPut({ id: uid(), date, tpl: 'strava', name: a.name || (CARDIO_MODES.find((x) => x[0] === m.mode) || [0, 'Activity'])[1], kind: m.kind, status: 'done',
            startedAt: a.start_date, stravaId: a.id, minutes, source: 'strava',
            cardio: m.kind === 'cardio' ? { mode: m.mode, minutes, dist, avgHR: hr, kcal } : null, blocks: m.kind === 'cardio' ? null : [] });
          added++;
        }
      }
      if (list.length < 200) break;
    }
    c.lastPull = started; await saveStrava();
    return { added, linked };
  }

  /* ---------- Strava push ---------- */
  function strengthText(s) {
    const lines = [];
    if (s.big3 && s.big3.done) lines.push('McGill Big 3');
    for (const b of s.blocks || []) {
      const ex = EXM[b.ex]; if (!ex) continue; const sets = (b.sets || []).filter((x) => x.done); if (!sets.length) continue;
      const unit = ex.type === 'hold' || ex.type === 'time' ? ' s' : '';
      const same = sets.every((x) => x.load === sets[0].load && x.reps === sets[0].reps);
      lines.push(same ? `${ex.name}: ${sets.length} × ${sets[0].reps}${unit}${sets[0].load ? ` @ ${sets[0].load} lb` : ''}`
        : `${ex.name}: ${sets.map((x) => `${x.load ? `${x.load} lb × ` : ''}${x.reps}${unit}`).join(', ')}`);
    }
    if (s.rpe) lines.push(`Session effort ${s.rpe}/10`);
    return lines;
  }
  function startFor(s) {
    if (s.kind !== 'cardio' && s.startedAt) return localISO(new Date(s.startedAt));
    const logged = new Date(s.finishedAt || s.startedAt);
    if (s.startedAt && dayKey(logged) === s.date) return localISO(new Date(logged - (s.minutes || 0) * 60000));
    return `${s.date}T12:00:00`;
  }
  function eligible(s, now) {
    if (s.status !== 'done' || s.stravaId || s.stravaSkip || (s.source || 'app') !== 'app') return false;
    if (s.date < st.strava.since || !s.minutes) return false;
    if (s.stravaPushAt && now - new Date(s.stravaPushAt) < PUSH_RETRY) return false;
    if (s.kind === 'strength') return !!s.finishedAt;
    if (s.kind === 'mobility') return true;
    if (s.kind === 'cardio') return now - new Date(s.finishedAt || s.startedAt || 0) >= CARDIO_WAIT;
    return false;
  }
  async function push() {
    const c = st.strava; if (c.push === false || !/activity:write/.test(c.scope || '')) return 0;
    const now = Date.now(); let n = 0;
    for (const s of S.sessions.filter((x) => eligible(x, now)).slice(0, 10)) {
      const t = toStrava(s); const desc = [...(s.kind === 'strength' ? strengthText(s) : []), 'Logged in Waypoint'].join('\n');
      const body = new URLSearchParams({ name: s.name || 'Workout', sport_type: t.sport_type, start_date_local: startFor(s), elapsed_time: String(Math.round(s.minutes * 60)), description: desc, trainer: String(t.trainer) });
      if (s.cardio && s.cardio.dist) body.set('distance', String(Math.round(s.cardio.dist * 1609.344)));
      s.stravaPushAt = new Date().toISOString(); await rawPut(s);
      try {
        const res = await api('/activities', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        s.stravaId = res.id; s.stravaPushed = true; delete s.stravaPushAt; await rawPut(s); n++;
      } catch (e) {
        if (e.status) { delete s.stravaPushAt; if (e.status === 400 || e.status === 409) s.stravaSkip = e.message; await rawPut(s); }
        throw e;
      }
    }
    return n;
  }

  /* ---------- Apple Health relay: a Shortcut writes recent samples to a private gist; Waypoint reads it ---------- */
  const gistId = (v) => { const m = /([0-9a-f]{20,40})\/?$/i.exec(String(v || '').trim().replace(/[#?].*$/, '')); return m ? m[1] : ''; };
  function parseRelay(text) {
    const out = { weights: {}, bf: {}, rhr: {}, vo2: {}, newest: null };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const parts = raw.split(/\s*[|\t;]\s*/); if (parts.length < 3) continue;
      const tag = parts[0].trim().toLowerCase();
      const type = /^w|weight|body ?mass/.test(tag) ? 'w' : /^f|fat/.test(tag) ? 'f' : /^r|resting/.test(tag) ? 'r' : /^v|vo2/.test(tag) ? 'v' : null;
      if (!type) continue;
      let d = new Date(parts[1].trim()); if (isNaN(d)) d = new Date(parts[1].replace(/\s+at\s+/i, ' ').trim()); if (isNaN(d)) continue;
      let v = parseFloat(String(parts[2]).replace(/[^\d.\-]/g, '')); if (!Number.isFinite(v)) continue;
      const unit = (parts[3] || '').trim().toLowerCase(); const k = dayKey(d); const at = d.toISOString();
      if (type === 'w') { if (unit === 'kg') v *= ENG.LB_PER_KG; if (v < 70 || v > 600) continue; if (!out.weights[k] || out.weights[k].at < at) out.weights[k] = { v: r1(v), at }; }
      if (type === 'f') { if (v <= 1) v = Math.round(v * 1000) / 10; if (v < 2 || v > 70) continue; if (!out.bf[k] || out.bf[k].at < at) out.bf[k] = { v: r1(v), at }; }
      if (type === 'r') { if (v < 25 || v > 150) continue; out.rhr[k] = { v: Math.round(v), at }; }
      if (type === 'v') { if (v < 10 || v > 90) continue; out.vo2[k] = { v: r1(v), at }; }
      if (!out.newest || out.newest < at) out.newest = at;
    }
    return out;
  }
  async function pullHealth() {
    const g = st.gist; const res = await fetch(`https://api.github.com/gists/${g.id}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.status === 404) throw new Error('The Health gist was not found. Check the gist link in Settings.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the Health gist`);
    const j = await res.json(); const f = (j.files || {})[GIST_FILE] || Object.values(j.files || {})[0]; if (!f) return { n: 0 };
    let text = f.content; if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    const r = parseRelay(text); let n = 0;
    for (const [k, x] of Object.entries(r.weights)) { const d = S.days[k] || {}; if (!d.weight || (d.wSrc === 'health' && d.weight !== x.v)) { await saveDay(k, { weight: x.v, wSrc: 'health' }); n++; } }
    for (const [k, x] of Object.entries(r.bf)) { const d = S.days[k] || {}; if (!d.bf || (d.bfSrc === 'health' && d.bf !== x.v)) { await saveDay(k, { bf: x.v, bfSrc: 'health' }); n++; } }
    for (const [k, x] of Object.entries(r.rhr)) if ((S.days[k] || {}).rhr !== x.v) { await saveDay(k, { rhr: x.v }); n++; }
    for (const [k, x] of Object.entries(r.vo2)) if ((S.days[k] || {}).vo2 !== x.v) { await saveDay(k, { vo2: x.v }); n++; }
    Object.assign(g, { lastFetch: new Date().toISOString(), gistUpdated: j.updated_at || null, newest: r.newest || g.newest || null }); await DB.setMeta('gist', g);
    return { n };
  }

  /* ---------- orchestration ---------- */
  async function syncAll(force) {
    if (st.busy || !navigator.onLine) return false;
    if (!force && Date.now() - st.lastRun < AUTO_GAP) return false;
    if (!connected() && !(st.gist && st.gist.id)) return false;
    st.busy = true; st.lastRun = Date.now(); const errs = []; let changed = 0; const msg = [];
    if (connected()) {
      try { const p = await pull(); changed += p.added + p.linked; if (p.added) msg.push(`${p.added} from Strava`); } catch (e) { errs.push(e.message); }
      try { const n = await push(); changed += n; if (n) msg.push(`${n} posted to Strava`); } catch (e) { errs.push(e.message); }
    }
    if (st.gist && st.gist.id) { try { const h = await pullHealth(); changed += h.n; if (h.n) msg.push(`${h.n} Health readings`); } catch (e) { errs.push(e.message); } }
    st.err = errs.join(' '); await DB.setMeta('syncLast', { at: new Date().toISOString(), err: st.err });
    st.busy = false;
    if (changed) render();
    if (force) toast(st.err ? `Sync problem: ${st.err}` : msg.length ? `Synced: ${msg.join(', ')}` : 'Synced; nothing new', st.err ? 7000 : 2500);
    else if (msg.length) toast(`Synced: ${msg.join(', ')}`);
    return true;
  }
  let soonTimer = null;

  async function boot() {
    st.strava = await DB.meta('strava', null); st.gist = await DB.meta('gist', null); st.ignore = await DB.meta('stravaIgnore', []);
    const last = await DB.meta('syncLast', null); if (last) st.err = last.err || '';
    // A saved session triggers a push soon after (quiet unless something happened).
    const orig = saveSession;
    saveSession = async (s) => { await orig(s); if (connected() && s && s.status === 'done' && !s.stravaId) { clearTimeout(soonTimer); soonTimer = setTimeout(() => { st.lastRun = 0; syncAll(false).catch(() => {}); }, 45000); } };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(false).catch(() => {}); });
    window.addEventListener('online', () => syncAll(false).catch(() => {}));
    setInterval(() => { if (!document.hidden) syncAll(false).catch(() => {}); }, 30 * 60 * 1000);
    await handleReturn();
    syncAll(false).catch(() => {});
  }
  async function forget(s) { if (s && s.stravaId && s.source === 'strava') { st.ignore = [...new Set([...st.ignore, s.stravaId])].slice(-500); await DB.setMeta('stravaIgnore', st.ignore); } }

  /* ---------- Settings sheet ---------- */
  function openSettingsSheet() {
    const c = st.strava || {}; const g = st.gist || {};
    const who = c.athlete ? `${c.athlete.first} ${c.athlete.last}`.trim() : '';
    const site = callbackUrl();
    const stravaCard = connected()
      ? `<div class="card"><h3>Strava<span class="r">connected</span></h3>
          <div class="kv">${who ? `<span>Account</span><span>${esc(who)}</span>` : ''}<span>Last pull</span><span>${esc(ago(c.lastPull))}</span><span>Posting starts with</span><span>${esc(fmtShort(c.since))}</span></div>
          <label class="row small" style="padding:10px 0 4px"><input type="checkbox" id="spush" ${c.push !== false ? 'checked' : ''}> Post Waypoint sessions to Strava</label>
          <p class="muted tiny" style="margin:0">Strength and mobility post right after you finish. Cardio you log by hand waits three hours; if the Watch's own recording reaches Strava first, Waypoint links to it instead of posting a second copy. Posts use your Strava default privacy.</p>
          ${/activity:write/.test(c.scope || '') ? '' : '<p class="small" style="color:var(--danger)">Strava did not grant permission to post. Disconnect and connect again with every box checked.</p>'}
          <div class="row" style="margin-top:10px"><button class="btn grow" data-a="sync">Sync now</button><button class="btn ghost" data-a="disc">Disconnect</button></div></div>`
      : `<div class="card"><h3>Strava${c.needsReconnect ? '<span class="r" style="color:var(--danger)">reconnect needed</span>' : ''}</h3>
          <ol class="small" style="padding-left:18px;margin:0 0 8px">
            <li>On strava.com, open <b>Settings › My API Application</b> (strava.com/settings/api) and create an app. Category: Training. Website: <b>${esc(site)}</b>. Authorization Callback Domain: <b>${esc(location.host)}</b>.</li>
            <li>Paste its Client ID and Client Secret here. They stay on this phone and are left out of backups.</li>
            <li>Tap Connect and approve every box.</li></ol>
          <label class="f">Client ID</label><input class="field" id="scid" inputmode="numeric" autocomplete="off" value="${esc(c.clientId || '')}">
          <label class="f">Client Secret</label><input class="field" id="scs" type="password" autocomplete="off" value="${esc(c.clientSecret || '')}">
          <button class="btn block" style="margin-top:12px" data-a="conn">Connect to Strava</button>
          <details style="margin-top:12px"><summary class="small">Paste a Strava code</summary>
            <p class="muted tiny">Only if the Strava approval opened in Safari and showed you a code.</p>
            <input class="field" id="scode" autocomplete="off"><button class="btn ghost block" style="margin-top:8px" data-a="code">Use code</button></details></div>`;
    const healthCard = `<div class="card"><h3>Apple Health${g.id ? '<span class="r">on</span>' : ''}</h3>
        <p class="small" style="margin-top:0">Workouts reach Waypoint through Strava: in the Strava app, turn on its Apple Health connection so Watch workouts upload automatically. Weight, body fat, resting heart rate and VO2 max come from an iPhone Shortcut that copies the last week of readings into a private GitHub gist.</p>
        ${g.id ? `<div class="kv"><span>Newest reading</span><span>${esc(ago(g.newest))}</span><span>Shortcut last ran</span><span>${esc(ago(g.gistUpdated))}</span><span>Checked</span><span>${esc(ago(g.lastFetch))}</span></div>` : ''}
        <label class="f">Gist link</label><input class="field" id="gid" autocomplete="off" placeholder="https://gist.github.com/…" value="${esc(g.url || '')}">
        <div class="row" style="margin-top:10px"><button class="btn grow" data-a="gsave">${g.id ? 'Save and check' : 'Save'}</button>${g.id ? '<button class="btn ghost" data-a="goff">Turn off</button>' : ''}</div>
        <details style="margin-top:12px"><summary class="small"><b>Shortcut setup steps</b></summary>${SHORTCUT_STEPS}</details></div>`;
    const status = `<p class="note muted tiny">${st.err ? `<span style="color:var(--danger)">Last problem: ${esc(st.err)}</span><br>` : ''}Sync runs while Waypoint is open: at launch, when you switch back to it, every 30 minutes, and after you save a session. iPhone does not let web apps sync in the background.</p>`;
    const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Strava and Apple Health</div><span style="min-width:64px"></span></header>
      <div class="scroll">${stravaCard}${healthCard}${status}</div>`);
    const reopen = () => { el.remove(); openSettingsSheet(); };
    el.addEventListener('change', async (ev) => { if (ev.target.id === 'spush') { st.strava.push = ev.target.checked; await saveStrava(); toast(ev.target.checked ? 'Posting to Strava is on' : 'Posting to Strava is off'); } });
    el.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]'); if (!a) return;
      switch (a.dataset.a) {
        case 'x': el.remove(); render(); break;
        case 'conn': { const id = $('#scid', el).value.trim(), sec = $('#scs', el).value.trim(); if (!/^\d+$/.test(id) || sec.length < 20) return toast('Check the Client ID (digits) and the Client Secret (long code)');
          st.strava = { ...(st.strava || {}), clientId: id, clientSecret: sec }; await saveStrava(); connect(); break; }
        case 'code': { const code = $('#scode', el).value.trim(); const id = $('#scid', el).value.trim(), sec = $('#scs', el).value.trim(); if (!code) return toast('Paste the code first');
          st.strava = { ...(st.strava || {}), clientId: id || (st.strava || {}).clientId, clientSecret: sec || (st.strava || {}).clientSecret };
          if (!st.strava.clientId || !st.strava.clientSecret) return toast('Enter the Client ID and Client Secret too');
          try { await exchange(code, 'read,activity:read_all,activity:write'); toast('Strava connected. Syncing…'); reopen(); await syncAll(true); reopen(); } catch (e) { toast(`That code did not work: ${e.message}`, 6000); } break; }
        case 'sync': a.disabled = true; await syncAll(true); reopen(); break;
        case 'disc': if (confirm('Disconnect Strava? Sessions already synced stay in Waypoint.')) { await disconnect(); reopen(); } break;
        case 'gsave': { const v = $('#gid', el).value.trim(); const id = gistId(v); if (!id) return toast('Paste the gist link from the address bar');
          st.gist = { ...(st.gist || {}), id, url: v }; await DB.setMeta('gist', st.gist); await syncAll(true); reopen(); break; }
        case 'goff': st.gist = null; await DB.setMeta('gist', null); reopen(); break;
      }
    });
  }
  const SHORTCUT_STEPS = `<ol class="small" style="padding-left:18px">
    <li><b>Wyze app:</b> make sure it shares weight and body fat with Apple Health.</li>
    <li><b>Token:</b> on github.com, open Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token. Name it Waypoint Health, set an expiration, and under Account permissions set <b>Gists</b> to Read and write. Nothing else. Copy the token.</li>
    <li><b>Gist:</b> on gist.github.com, create a <b>secret</b> gist. File name <b>${GIST_FILE}</b>, content: start. Copy the page's address and paste it above as the Gist link.</li>
    <li><b>Shortcut:</b> in the Shortcuts app, make a new shortcut named Waypoint Health.
      <ol type="a" style="padding-left:18px">
        <li><b>Find Health Samples</b> where Type is Weight and Start Date is in the last 7 days.</li>
        <li><b>Repeat with Each</b> item in Health Samples. Inside it, add a <b>Text</b> action reading <code>W|Start Date|Value|Unit</code>, where Start Date, Value and Unit are the Repeat Item's properties (tap Repeat Item to pick each one; set Start Date's format to ISO 8601). Then <b>Add to Variable</b> named Lines.</li>
        <li>Repeat steps a and b for Body Fat Percentage (text starts with <code>F|</code>), Resting Heart Rate (<code>R|</code>) and VO2 Max (<code>V|</code>), adding to the same Lines variable.</li>
        <li><b>Combine Text</b>: Lines, with New Lines.</li>
        <li><b>Get Contents of URL</b>: <code>https://api.github.com/gists/</code> followed by your gist's ID (the long code at the end of its address). Method PATCH. Headers: Authorization = <code>Bearer</code>, a space, then your token; Accept = <code>application/vnd.github+json</code>. Request Body JSON: key <b>files</b> (Dictionary) › key <b>${GIST_FILE}</b> (Dictionary) › key <b>content</b> (Text) = Combined Text.</li></ol></li>
    <li><b>Automation:</b> in Shortcuts › Automation, add one for App › Wyze › Is Closed › Run Immediately › Waypoint Health. Add a second for a daily time when the phone is usually unlocked. Health data can't be read while the iPhone is locked.</li>
    <li>Run the shortcut once by hand and allow Health access when asked. Within a minute, Settings here shows the newest reading.</li></ol>`;

  return { boot, syncAll, openSettingsSheet, forget, parseRelay, fromStrava, toStrava, strengthText, startFor, gistId, _st: st };
})();
