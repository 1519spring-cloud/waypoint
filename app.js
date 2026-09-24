/* Waypoint app, part 1: core, storage, Today, check-in, session player, timers, cardio, Train. */
'use strict';
const APP_VERSION = '1.0.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
const uid = () => [...crypto.getRandomValues(new Uint8Array(10))].map((x) => x.toString(16).padStart(2, '0')).join('');
const { dayKey, parseDay, addDays, diffDays, weekStart } = ENG;
const todayKey = () => dayKey(new Date());
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtLong = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtMD = (k) => parseDay(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const r1 = (x) => Math.round(x * 10) / 10;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- IndexedDB ---------- */
const STORES = ['meta', 'days', 'sessions', 'food', 'favs', 'prog', 'assess'];
const KEYS = { meta: 'key', days: 'key', sessions: 'id', food: 'id', favs: 'id', prog: 'id', assess: 'id' };
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('waypoint', 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KEYS[s] }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(s) { return this.req(this.store(s).getAll()); },
  get(s, k) { return this.req(this.store(s).get(k)); },
  put(s, v) { return this.req(this.store(s, 'readwrite').put(v)); },
  del(s, k) { return this.req(this.store(s, 'readwrite').delete(k)); },
  clear(s) { return this.req(this.store(s, 'readwrite').clear()); },
  async putMany(s, arr) { const tx = this.db.transaction(s, 'readwrite'); const st = tx.objectStore(s); arr.forEach((v) => st.put(v)); return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
  async meta(k, def) { const r = await this.get('meta', k); return r ? r.value : def; },
  setMeta(k, v) { return this.put('meta', { key: k, value: v }); },
};

/* ---------- state ---------- */
const S = {
  profile: null, days: {}, sessions: [], food: [], favs: [], prog: {}, assess: [],
  view: 'today', foodDay: null, progTab: 'body', learnCat: 'All', learnQ: '', lastBackup: null, updateReady: null, active: null,
};
const DEFAULT_PROFILE = {
  name: '', birthYear: null, sex: 'male', heightIn: 70, startWeight: null, goalWeight: null, lossRate: 0.5, proteinPerKg: 1.6, activity: 1.5,
  backLevel: 3, runStage: 0, longRunMins: 45, cardioModes: ['run', 'trail', 'treadmill', 'row'], week: DEFAULT_WEEK.slice(),
  startDate: null, deload: true, voice: true, restStrength: 90, restOther: 45, hrMaxOverride: null, rtr: [],
};
async function loadAll() {
  S.profile = await DB.meta('profile', null);
  if (S.profile) S.profile = { ...DEFAULT_PROFILE, ...S.profile };
  S.days = Object.fromEntries((await DB.all('days')).map((d) => [d.key, d]));
  S.sessions = await DB.all('sessions');
  S.food = await DB.all('food');
  S.favs = await DB.all('favs');
  S.prog = Object.fromEntries((await DB.all('prog')).map((p) => [p.id, p]));
  S.assess = await DB.all('assess');
  S.lastBackup = await DB.meta('lastBackup', null);
}
const saveProfile = () => DB.setMeta('profile', S.profile);
async function saveDay(k, patch) { const d = { key: k, ...(S.days[k] || {}), ...patch }; S.days[k] = d; await DB.put('days', d); return d; }
async function saveSession(s) { const i = S.sessions.findIndex((x) => x.id === s.id); if (i >= 0) S.sessions[i] = s; else S.sessions.push(s); await DB.put('sessions', s); }
async function saveProg(id, st) { S.prog[id] = { ...st, id }; await DB.put('prog', S.prog[id]); }

/* ---------- derived data ---------- */
const sessionsOn = (k) => S.sessions.filter((s) => s.date === k && s.status === 'done');
const intakeByDay = () => { const m = {}; for (const f of S.food) m[f.date] = (m[f.date] || 0) + (f.kcal || 0); return m; };
const proteinOn = (k) => S.food.filter((f) => f.date === k).reduce((s, f) => s + (f.protein || 0), 0);
const kcalOn = (k) => S.food.filter((f) => f.date === k).reduce((s, f) => s + (f.kcal || 0), 0);
function weightTrend() { return ENG.trend(S.days, null, todayKey()); }
function energy() {
  const tr = weightTrend(); const p = S.profile;
  const e = ENG.expenditure({ ...p, startWeight: p.startWeight }, tr, intakeByDay(), todayKey());
  return { e, t: ENG.targets(p, e), tr };
}
function tplFor(k) {
  const d = S.days[k]; if (d && d.tplOverride) return d.tplOverride;
  return S.profile.week[parseDay(k).getDay()];
}
const RUN_MODES = ['run', 'trail', 'treadmill-run'];
function runsSince(k) { return S.sessions.filter((s) => s.status === 'done' && s.date >= k && s.cardio && RUN_MODES.includes(s.cardio.mode)); }
function longestRun30(before = todayKey()) { return Math.max(0, ...runsSince(addDays(before, -30)).filter((s) => s.date < before || s.date === before).map((s) => s.cardio.minutes || 0)); }
function loadedRecently(k) { return [addDays(k, -1), addDays(k, -2)].some((d) => S.sessions.some((s) => s.date === d && s.status === 'done' && (s.kind === 'strength' || (s.cardio && RUN_MODES.includes(s.cardio.mode))))); }
function readyFor(k) { const c = (S.days[k] || {}).checkin; if (!c) return null; const r = ENG.readiness(c); r.joints = c.joints || []; return r; }
function ctxFor(k) {
  return { profile: S.profile, prog: S.prog, ready: readyFor(k), checkin: (S.days[k] || {}).checkin, key: k,
    longestRun30: longestRun30(k), intervalsDone: S.sessions.filter((s) => s.status === 'done' && s.tpl === 'intervals' && s.cardio && s.cardio.completedSegments).length };
}
function lastLog(exId) {
  const done = S.sessions.filter((s) => s.status === 'done' && s.blocks).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const s of done) { const b = s.blocks.find((x) => x.ex === exId && x.sets && x.sets.some((y) => y.done)); if (b) return { date: s.date, b }; }
  return null;
}

/* ---------- sound, speech, wake lock ---------- */
let actx = null;
function beep(freq = 880, ms = 160, n = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain(); const t = actx.currentTime + i * (ms / 1000 + 0.08);
      o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
    }
  } catch (e) { /* no audio */ }
}
function say(t) { if (!S.profile || !S.profile.voice || !('speechSynthesis' in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 1.02; speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
let wakeLock = null;
async function keepAwake(on) {
  try { if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) { /* unsupported */ }
}

/* ---------- small UI helpers ---------- */
function sheet(html) { const el = document.createElement('div'); el.className = 'sheet'; el.innerHTML = html; document.body.appendChild(el); return el; }
const main = () => $('#main');
function setTitle(t, sub = '') { $('#view-title').textContent = t; $('#view-sub').textContent = sub; }
function seg(name, opts, val) { return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`; }
function wireSeg(root, onChange) {
  root.addEventListener('click', (ev) => { const b = ev.target.closest('.seg button'); if (!b) return; const s = b.closest('.seg'); $$('button', s).forEach((x) => x.classList.toggle('on', x === b)); onChange && onChange(s.dataset.seg, b.dataset.v); });
}
const segVal = (root, name) => { const b = $(`.seg[data-seg="${name}"] button.on`, root); return b ? b.dataset.v : null; };
function ring(val, target, label, unit, cls = '') {
  const pct = target ? Math.min(1, val / target) : 0; const R = 24, C = 2 * Math.PI * R;
  return `<div class="ring ${cls}"><svg viewBox="0 0 58 58"><circle cx="29" cy="29" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="7"/>
    <circle cx="29" cy="29" r="${R}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 29 29)"/></svg>
    <div><b>${Math.round(val)}<span class="muted small"> / ${target}${unit}</span></b><span class="muted small">${label}</span></div></div>`;
}
function figThumb(id) { return `<div class="figwrap" data-fig="${id}"></div>`; }
function hydrateFigs(root, still = true) { $$('[data-fig]', root).forEach((el) => { const e = EXM[el.dataset.fig]; if (e && e.fig) FIG.mount(el, e.fig, { still, frame: e.fig.frames.length - 1, label: e.name }); else el.innerHTML = `<div class="muted tiny" style="display:grid;place-items:center;height:100%">${esc(e ? e.cat : '')}</div>`; }); }

/* ================= RENDER ================= */
function render() {
  $$('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  if (!S.profile) return;
  ({ today: renderToday, train: renderTrain, food: renderFood, progress: renderProgress, learn: renderLearn })[S.view]();
}

/* ---------- Today ---------- */
function banners() {
  let h = '';
  if (S.updateReady) h += `<div class="banner">A new version of Waypoint is ready.<button data-act="update">Reload</button></div>`;
  const last = S.lastBackup ? diffDays(dayKey(new Date(S.lastBackup)), todayKey()) : null;
  const hasData = S.sessions.length + S.food.length + Object.keys(S.days).length > 5;
  if (hasData && (last === null || last > 14)) h += `<div class="banner">${last === null ? 'No backup yet.' : `Last backup ${last} days ago.`} Your data lives only on this phone.<button data-act="backup">Back up</button></div>`;
  const sug = levelSuggestion(); if (sug) h += `<div class="banner">${esc(sug.text)}<button data-act="level" data-to="${sug.to}">${sug.to > S.profile.backLevel ? 'Level up' : 'Step back'}</button></div>`;
  const lastA = S.assess.map((a) => a.date).sort().pop();
  if (S.profile.startDate && (!lastA ? diffDays(S.profile.startDate, todayKey()) >= 3 : diffDays(lastA, todayKey()) >= 28)) h += `<div class="banner">${lastA ? 'Four weeks since your last check of' : 'Record a baseline for'} strength, mobility and balance.<button data-act="assess">Start</button></div>`;
  return h;
}
function levelSuggestion() {
  const p = S.profile, k = todayKey();
  const recent = [...Array(14)].map((_, i) => S.days[addDays(k, -i)]).filter((d) => d && d.checkin);
  const worse7 = recent.filter((d) => d.key >= addDays(k, -6) && d.checkin.rule24 === 'worse').length;
  if (worse7 >= 2 && p.backLevel > 1) return { to: p.backLevel - 1, text: 'Two mornings this week your back was worse than the day before. Step back one level for a week or two.' };
  if (p.backLevel < 4 && recent.length >= 10 && recent.every((d) => d.checkin.rule24 !== 'worse' && (d.checkin.back || 0) <= 2)) {
    if (p.backLevel === 3 && (p.rtr || []).length < RTR_CHECKS.length) return null;
    if (p.levelDismissed && diffDays(p.levelDismissed, k) < 14) return null;
    return { to: p.backLevel + 1, text: `Two weeks with a calm back. Ready for ${BACK_LEVELS[p.backLevel + 1].name}?` };
  }
  return null;
}
function weekStrip(k) {
  const ws = weekStart(k); let h = '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i); const t = tplFor(d); const done = sessionsOn(d).length > 0;
    const cls = [d === k ? 'today' : ''].join(' ');
    h += `<button class="${cls}" data-act="day" data-day="${d}">${DOW[parseDay(d).getDay()]}<b>${parseDay(d).getDate()}</b><i class="dot ${done ? 'done' : t === 'rest' ? 'rest' : ''}"></i></button>`;
  }
  return h + '</div>';
}
function planCard(k) {
  const tplId = tplFor(k); const tpl = TEMPLATES[tplId]; const done = sessionsOn(k);
  const active = S.sessions.find((s) => s.date === k && s.status === 'active');
  let h = `<div class="card"><h3>${ic(tpl.kind === 'cardio' ? 'run' : tpl.kind === 'rest' ? 'sun' : 'dumbbell')} ${esc(tpl.name)}<span class="r">${ENG.isDeload(S.profile, k) ? 'Deload week' : `Week ${ENG.weekNum(S.profile, k)}`}</span></h3>`;
  if (tpl.kind === 'rest') h += `<p class="muted small" style="margin:4px 0">Rest. A walk and the daily mobility routine are plenty.</p>`;
  else if (tpl.kind === 'cardio') {
    const c = ENG.cardioPlan(tpl.cardio, ctxFor(k));
    h += `<p style="margin:4px 0"><b>${esc(c.title)}</b> · about ${c.mins} min</p><p class="muted small" style="margin:4px 0">${esc(c.note)}</p>`;
  } else {
    const s = ENG.buildSession(tplId, ctxFor(k));
    h += `<div class="chips">${s.blocks.map((b) => b.big3 ? '<span class="chip">Big 3</span>' : `<span class="chip">${esc(EXM[b.ex].name)}${b.learning && !(S.prog[b.ex] || {}).exposures ? ' <span class="pill new">New</span>' : ''}</span>`).join('')}</div>`;
    h += `<p class="muted small" style="margin:4px 0">About ${tpl.mins} minutes.</p>`;
  }
  if (done.length) h += `<p class="small" style="color:var(--green);margin:6px 0">${ic('check')} Done: ${done.map((s) => esc(s.name)).join(', ')}</p>`;
  if (tpl.kind !== 'rest') h += `<button class="btn block" data-act="start" data-day="${k}" style="margin-top:8px">${ic('play')} ${active ? 'Resume' : done.length ? 'Do it again' : 'Start'}</button>`;
  h += `<div class="row" style="justify-content:space-between;margin-top:10px"><button class="linkbtn small" data-act="swapday" data-day="${k}">${ic('swap')} Different session</button><button class="linkbtn small" data-act="logcardio">${ic('plus')} Log other activity</button></div>`;
  return h + '</div>';
}
function renderToday() {
  const k = todayKey(); setTitle('Today', fmtLong(k));
  const d = S.days[k] || {}; const r = readyFor(k); const { e, t, tr } = energy();
  let h = banners();
  if (!d.checkin) h += `<div class="card ready"><h3>${ic('heart')} Morning check-in</h3><p class="muted small" style="margin:2px 0 10px">Thirty seconds: sleep, energy, back and joints. Today's plan adjusts to it.</p><button class="btn block" data-act="checkin">Check in</button></div>`;
  else h += `<div class="card ready ${r.level}"><h3>${esc(r.title)}<button class="r linkbtn" data-act="checkin">Edit</button></h3>${r.note ? `<p class="small" style="margin:2px 0">${esc(r.note)}</p>` : ''}${r.level === 'stop' ? `<button class="btn ghost sm" data-act="guide" data-id="redflags">Read the red flags</button>` : ''}</div>`;
  h += weekStrip(k);
  h += planCard(k);
  const dailyDone = d.daily;
  h += `<div class="card"><h3>${ic('sun')} Spine and hips daily<span class="r">about 18 min</span></h3><p class="muted small" style="margin:2px 0 8px">McGill Big 3 plus six mobility drills. On strength days the Big 3 is already in the session.</p>
    <div class="row"><button class="btn ghost grow" data-act="daily">${ic('play')} Start</button><button class="btn ${dailyDone ? '' : 'ghost'}" data-act="dailydone">${ic('check')} ${dailyDone ? 'Done' : 'Mark done'}</button></div></div>`;
  const keys = Object.keys(tr).sort(); const trendNow = keys.length ? tr[keys[keys.length - 1]] : null;
  const wk = keys.length > 7 ? tr[keys[keys.length - 1]] - tr[keys[keys.length - 8]] : null;
  h += `<div class="card"><h3>${ic('scale')} Weigh-in<span class="r">${trendNow ? `trend ${r1(trendNow)} lb${wk !== null ? ` · ${wk <= 0 ? '' : '+'}${r1(wk)} lb/wk` : ''}` : ''}</span></h3>
    <div class="row"><input class="field grow" id="wt" type="number" inputmode="decimal" step="0.1" placeholder="Weight, lb" value="${d.weight || ''}"><button class="btn" data-act="saveweight">Save</button></div>
    <p class="muted tiny" style="margin:6px 0 0">Same time daily, after the bathroom, before eating. The trend line smooths out water swings.</p></div>`;
  h += `<div class="card"><h3>${ic('food')} Food today<button class="r linkbtn" data-act="food">Log</button></h3><div class="rings">${ring(kcalOn(k), t.kcal, 'calories', '')}${ring(proteinOn(k), t.protein, 'protein', ' g')}</div>
    <p class="muted tiny" style="margin:8px 0 0">${e.adaptive ? `Burn estimate ${e.estimate} kcal/day from your own intake and weight trend.` : `Starting estimate ${e.estimate} kcal/day; it adapts after about two weeks of logging and weigh-ins.`}</p></div>`;
  main().innerHTML = h;
}

/* ---------- check-in ---------- */
function openCheckin() {
  const k = todayKey(); const c = (S.days[k] || {}).checkin || { sleep: 2, energy: 2, soreness: 1, back: 0, joints: [], redFlags: [] };
  const ask24 = loadedRecently(k) || c.rule24;
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Morning check-in</div><button class="txtbtn r" data-a="save">Save</button></header>
    <div class="scroll">
      <label class="f">Sleep last night</label>${seg('sleep', [[1, 'Poor'], [2, 'OK'], [3, 'Good']], c.sleep)}
      <label class="f">Energy</label>${seg('energy', [[1, 'Low'], [2, 'OK'], [3, 'High']], c.energy)}
      <label class="f">Muscle soreness</label>${seg('soreness', [[1, 'None'], [2, 'Some'], [3, 'A lot']], c.soreness)}
      <label class="f">Low back right now: <b id="bv">${c.back}</b> / 10</label><input class="slider" id="back" type="range" min="0" max="10" value="${c.back}">
      <div class="row tiny muted" style="justify-content:space-between"><span>0 none</span><span>3 noticeable</span><span>6+ hard to ignore</span></div>
      ${ask24 ? `<label class="f">Compared with yesterday morning, your back is</label>${seg('rule24', [['better', 'Better'], ['same', 'Same'], ['worse', 'Worse']], c.rule24 || 'same')}<p class="muted tiny">The 24-hour rule: judge the last session by how you feel this morning.</p>` : ''}
      <label class="f">Any joint achy today?</label><div class="chips" id="joints">${['hip', 'knee', 'shoulder'].map((j) => `<button class="chip ${c.joints.includes(j) ? 'on' : ''}" data-j="${j}">${j[0].toUpperCase() + j.slice(1)}</button>`).join('')}</div>
      <label class="f">Weight (optional)</label><input class="field" id="cw" type="number" inputmode="decimal" step="0.1" placeholder="lb" value="${(S.days[k] || {}).weight || ''}">
      <div class="card" style="margin-top:16px"><h3 style="font-size:15px">Any of these? <span class="r tiny">rare, but they matter</span></h3>
        ${RED_FLAGS.map((f, i) => `<label class="row small" style="padding:6px 0"><input type="checkbox" data-rf="${i}" ${c.redFlags.includes(i) ? 'checked' : ''}> ${esc(f)}</label>`).join('')}</div>
    </div>`);
  wireSeg(el);
  $('#back', el).addEventListener('input', (ev) => { $('#bv', el).textContent = ev.target.value; });
  $('#joints', el).addEventListener('click', (ev) => { const b = ev.target.closest('[data-j]'); if (b) b.classList.toggle('on'); });
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') el.remove();
    if (a.dataset.a === 'save') {
      const n = { sleep: +segVal(el, 'sleep'), energy: +segVal(el, 'energy'), soreness: +segVal(el, 'soreness'), back: +$('#back', el).value,
        joints: $$('#joints .on', el).map((b) => b.dataset.j), redFlags: $$('[data-rf]', el).filter((x) => x.checked).map((x) => +x.dataset.rf), at: new Date().toISOString() };
      if (ask24) n.rule24 = segVal(el, 'rule24');
      const patch = { checkin: n }; const w = num($('#cw', el).value); if (w) patch.weight = w;
      await saveDay(k, patch);
      if (n.rule24 === 'worse') await apply24Worse(k);
      el.remove(); render();
      const r = ENG.readiness(n); toast(r.title);
    }
  });
}
// 24-hour rule: last loaded session's back-heavy lifts repeat their weights next time, and a walk-run stage steps back
async function apply24Worse(k) {
  const last = S.sessions.filter((s) => s.status === 'done' && s.date < k).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last) return;
  if (last.blocks) for (const b of last.blocks) {
    const ex = EXM[b.ex]; if (!ex || ex.joints.back < 1 || !S.prog[b.ex]) continue;
    const used = Math.max(0, ...(b.sets || []).filter((x) => x.done).map((x) => Number(x.load) || 0));
    if (used) await saveProg(b.ex, { ...S.prog[b.ex], load: used, held24: k });
  }
  if (last.cardio && last.cardio.ladder && S.profile.runStage > 0 && last.cardio.advanced) { S.profile.runStage -= 1; await saveProfile(); toast('Walk-run stage stepped back one (24-hour rule).'); }
}

/* ---------- timer bar (rest) ---------- */
const TB = { end: 0, int: null };
function restTimer(sec, label = 'Rest') {
  clearInterval(TB.int); let el = $('#timerbar');
  if (!el) { el = document.createElement('div'); el.id = 'timerbar'; document.body.appendChild(el); }
  TB.end = Date.now() + sec * 1000;
  el.innerHTML = `<div class="grow"><div class="tiny" style="opacity:.7">${esc(label)}</div><b id="tbv">${mmss(sec)}</b></div><button data-t="-15">−15</button><button data-t="15">+15</button><button data-t="x">Skip</button>`;
  el.onclick = (ev) => { const b = ev.target.closest('[data-t]'); if (!b) return; if (b.dataset.t === 'x') return stopRest(); TB.end += +b.dataset.t * 1000; };
  TB.int = setInterval(() => {
    const left = (TB.end - Date.now()) / 1000; const v = $('#tbv'); if (v) v.textContent = mmss(left);
    if (left <= 3.2 && left > 2.8) beep(660, 90);
    if (left <= 0) { beep(990, 220, 2); stopRest(); }
  }, 200);
}
function stopRest() { clearInterval(TB.int); const el = $('#timerbar'); if (el) el.remove(); }

/* ---------- guided segment runner (Big 3 holds, intervals, walk-run) ---------- */
function runSegments(title, segs, opts = {}) {
  let i = 0, left = segs[0].sec, paused = false, last = Date.now(), finished = false;
  const total = segs.reduce((s, x) => s + x.sec, 0);
  const z = opts.zones;
  keepAwake(true);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">End</button><div class="ttl">${esc(title)}<small id="rn-step"></small></div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="runner" id="rn"><div class="lab" id="rn-lab"></div><div class="big" id="rn-t"></div><div class="zone" id="rn-z"></div></div>
      <div class="bigfig hidden" id="rn-fig"></div>
      <div class="bar"><i id="rn-bar" style="width:0"></i></div><p class="muted small" id="rn-next" style="text-align:center"></p>
      <div class="row" style="justify-content:center;gap:14px;margin-top:10px">
        <button class="btn ghost" data-a="prev">${ic('back')}</button><button class="btn" data-a="pause" id="rn-pp" style="min-width:120px">${ic('pause')} Pause</button><button class="btn ghost" data-a="next">${ic('chev')}</button></div>
      <p class="muted tiny" style="text-align:center;margin-top:16px">Keep this screen open; the phone may pause timers when the screen locks. Voice cues can be turned off in Settings.</p></div>`);
  let stopFig = () => {};
  const show = (announce) => {
    const s = segs[i]; if (!s) return;
    $('#rn-lab', el).textContent = s.label; $('#rn-step', el).textContent = `Step ${i + 1} of ${segs.length} · ${mmss(segs.slice(i).reduce((n, x) => n + x.sec, 0))} left`;
    const zt = z && s.zone ? (s.zone === 'hard' ? `Target ${z.hard[0]} to ${z.hard[1]} bpm` : s.zone === 'z2' ? `Zone 2: ${z.z2[0]} to ${z.z2[1]} bpm` : `Easy: under ${z.z2[0]} bpm`) : (s.sub || '');
    $('#rn-z', el).textContent = zt; $('#rn', el).className = `runner ${s.zone || ''}`;
    const nx = segs[i + 1]; $('#rn-next', el).textContent = nx ? `Next: ${nx.label} (${mmss(nx.sec)})` : 'Last step';
    const fe = $('#rn-fig', el);
    if (s.fig && EXM[s.fig] && EXM[s.fig].fig) { fe.classList.remove('hidden'); stopFig(); stopFig = FIG.mount(fe, EXM[s.fig].fig, { still: true, frame: EXM[s.fig].fig.frames.length - 1 }); } else fe.classList.add('hidden');
    if (announce) { beep(s.zone === 'hard' || s.hold ? 990 : 660, 180, 2); say(s.say || s.label); }
  };
  const tick = () => {
    if (finished) return;
    const now = Date.now(); if (!paused) left -= (now - last) / 1000; last = now;
    if (left <= 3.05 && left > 0 && Math.abs(left - Math.round(left)) < 0.06 && segs[i].sec >= 8) beep(520, 70);
    if (left <= 0) { i++; if (i >= segs.length) return done(); left = segs[i].sec; show(true); }
    $('#rn-t', el).textContent = mmss(left);
    const elapsed = segs.slice(0, i).reduce((s, x) => s + x.sec, 0) + (segs[i].sec - left);
    $('#rn-bar', el).style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
  };
  const iv = setInterval(tick, 100);
  const done = (early) => { finished = true; clearInterval(iv); keepAwake(false); stopFig(); if (!early) { beep(880, 250, 3); say('Done. Nice work.'); } el.remove(); opts.onDone && opts.onDone({ completed: !early, stepsDone: i }); };
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') done(true);
    if (a.dataset.a === 'pause') { paused = !paused; a.innerHTML = paused ? `${ic('play')} Resume` : `${ic('pause')} Pause`; }
    if (a.dataset.a === 'next') { left = 0; }
    if (a.dataset.a === 'prev') { i = Math.max(0, i - 1); left = segs[i].sec; show(false); }
  });
  beep(660, 60); show(true);
}
function big3Segments(pyr) {
  const segs = [{ label: 'Get ready: curl-up', sec: 8, sub: 'On your back, one knee bent, hands under the low back', fig: 'curlup', say: 'Big three. First, the curl-up. Get set.' }];
  const holdRest = (label, fig, sayTxt) => [{ label, sec: pyr.hold, hold: true, fig, say: sayTxt || 'Hold' }, { label: 'Relax', sec: 3, fig, say: 'Relax' }];
  pyr.reps.forEach((n, si) => {
    for (let r = 0; r < n; r++) segs.push(...holdRest(`Curl-up hold ${r + 1} of ${n}`, 'curlup'));
    if (si === 0) segs.push({ label: 'Switch legs', sec: 5, sub: 'Bend the other knee', fig: 'curlup', say: 'Switch legs' });
    if (si < pyr.reps.length - 1) segs.push({ label: 'Rest', sec: 15, say: 'Rest' });
  });
  const sp = pyr.side;
  segs.push({ label: `Get ready: ${EXM[sp].name.toLowerCase()}`, sec: 8, fig: sp, say: `Now the ${EXM[sp].name}. Start on your left side.` });
  pyr.reps.forEach((n, si) => {
    for (const side of ['left', 'right']) { for (let r = 0; r < n; r++) segs.push(...holdRest(`Side plank ${side} ${r + 1} of ${n}`, sp)); segs.push({ label: side === 'left' ? 'Roll to the right side' : 'Rest', sec: side === 'left' ? 6 : 12, say: side === 'left' ? 'Other side' : 'Rest' }); }
  });
  segs.push({ label: 'Get ready: bird dog', sec: 8, fig: 'birddog', say: 'Last one, the bird dog. Right arm, left leg first.' });
  pyr.reps.forEach((n, si) => {
    for (let r = 0; r < n; r++) { segs.push({ label: `Bird dog, right arm ${r + 1} of ${n}`, sec: pyr.hold, hold: true, fig: 'birddog', say: 'Reach' }); segs.push({ label: `Bird dog, left arm ${r + 1} of ${n}`, sec: pyr.hold, hold: true, fig: 'birddog', say: 'Switch' }); }
    if (si < pyr.reps.length - 1) segs.push({ label: 'Rest', sec: 12, say: 'Rest' });
  });
  return segs;
}
function dailySegments() {
  const segs = big3Segments(ENG.big3Pyramid(S.prog, S.profile.backLevel));
  const plan = [['catcamel', 45, 'Slow cycles, mid-range'], ['hipflexor', 40, 'Left side: tuck, then shift', 'L'], ['hipflexor', 40, 'Right side', 'R'], ['ninety90', 60, 'Slow switches side to side'], ['openbook', 45, 'Left side, knees together', 'L'], ['openbook', 45, 'Right side', 'R'], ['kneetowall', 40, 'Left ankle'], ['kneetowall', 40, 'Right ankle'], ['wallslide', 45, 'Slow, ribs down']];
  for (const [id, sec, sub] of plan) segs.push({ label: EXM[id].name, sec, sub, fig: id, say: `${EXM[id].name}. ${sub}` });
  return segs;
}
