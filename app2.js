/* Waypoint app, part 2: session player, cardio, Train tab. */
'use strict';

/* ---------- start a day's session ---------- */
function startDay(k, tplId) {
  tplId = tplId || tplFor(k); const tpl = TEMPLATES[tplId];
  if (tpl.kind === 'cardio') return openCardio(k, tplId);
  let s = S.sessions.find((x) => x.date === k && x.status === 'active' && x.tpl === tplId);
  if (!s) {
    const b = ENG.buildSession(tplId, ctxFor(k));
    s = { id: uid(), date: k, tpl: tplId, name: b.name, kind: b.kind, status: 'active', startedAt: new Date().toISOString(), notes: b.notes, deload: b.deload,
      big3: null, blocks: [] };
    for (const blk of b.blocks) {
      if (blk.big3) { s.big3 = { pyramid: blk.pyramid, done: false }; continue; }
      const ex = EXM[blk.ex]; const st = S.prog[blk.ex] || {}; const last = lastLog(blk.ex);
      const lastLoad = st.load || (last ? Math.max(0, ...last.b.sets.map((x) => Number(x.load) || 0)) : 0) || '';
      s.blocks.push({ ex: blk.ex, slot: blk.slot, target: blk.target, learning: !st.learned, tech: null, pain: null,
        sets: [...Array(blk.sets)].map(() => ({ load: ex.inc || ex.type === 'carry' ? lastLoad : '', reps: '', rir: 2, done: false })) });
    }
  }
  S.active = s; openPlayer(s);
}

function targetText(b) {
  const ex = EXM[b.ex]; const [lo, hi] = b.target; const u = ex.type === 'hold' ? ' s' : ex.type === 'carry' ? ' yd' : '';
  return `${b.sets.length} × ${lo === hi ? lo : `${lo}–${hi}`}${u}${ex.uni ? ' each side' : ''}`;
}
function blockHtml(b, i) {
  const ex = EXM[b.ex]; const st = S.prog[b.ex] || {}; const last = lastLog(b.ex);
  const loadCol = ex.inc || ex.type === 'carry';
  const unit = ex.type === 'hold' ? 'sec' : ex.type === 'carry' ? 'yd' : 'reps';
  const lastTxt = last ? `Last ${fmtMD(last.date)}: ${last.b.sets.filter((x) => x.done).map((x) => (loadCol && x.load ? `${x.load}×` : '') + (x.reps || '–')).join(', ')}` : 'First time';
  let h = `<div class="card exb" data-b="${i}"><div class="head">${figThumb(b.ex)}<div class="grow"><div class="t">${esc(ex.name)} ${b.learning ? '<span class="pill new">Learning</span>' : ''}</div>
    <div class="muted small">${targetText(b)}${st.load && loadCol ? ` · suggested ${st.load} lb` : ''}</div><div class="muted tiny">${esc(lastTxt)}</div></div>
    <button class="iconbtn" data-a="swap" data-b="${i}" aria-label="Swap exercise">${ic('swap')}</button></div>`;
  if (b.learning && !st.exposures) h += `<div class="banner" style="margin:8px 0 0">New movement: watch the demo and read the cues, then do one light practice set first.<button data-a="learn" data-b="${i}">Guide</button></div>`;
  h += `<div class="sets"><div class="set hdr"><span>#</span><span>${loadCol ? 'lb' : ''}</span><span>${unit}</span><span>${ex.type === 'reps' ? 'in reserve' : ''}</span><span></span></div>`;
  b.sets.forEach((x, j) => {
    h += `<div class="set" data-s="${j}"><span class="n">${j + 1}</span>
      ${loadCol ? `<input type="number" inputmode="decimal" data-k="load" value="${esc(x.load)}" placeholder="lb">` : '<span class="muted small" style="text-align:center">body</span>'}
      <input type="number" inputmode="numeric" data-k="reps" value="${esc(x.reps)}" placeholder="${b.target[1]}">
      ${ex.type === 'reps' ? `<select data-k="rir">${[0, 1, 2, 3, 4].map((v) => `<option value="${v}" ${+x.rir === v ? 'selected' : ''}>${v === 4 ? '4+' : v}</option>`).join('')}</select>` : '<span></span>'}
      <button class="ck ${x.done ? 'on' : ''}" data-a="done" aria-label="Set done">${ic('check')}</button></div>`;
  });
  h += `</div><div class="row" style="margin-top:4px"><button class="linkbtn small" data-a="addset" data-b="${i}">${ic('plus')} Set</button>${ex.type === 'hold' ? `<button class="linkbtn small" data-a="hold" data-b="${i}" style="margin-left:auto">${ic('play')} Hold timer</button>` : ''}</div>`;
  h += `<div style="margin-top:8px"><div class="muted tiny">Technique (be honest)</div><div class="rate" data-r="tech">${[1, 2, 3, 4, 5].map((v) => `<button data-v="${v}" class="${b.tech === v ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="muted tiny" style="margin-top:6px">Pain in the working joint or back (0 to 10)</div><div class="rate" data-r="pain">${[0, 1, 2, 3, 4, 5, 6].map((v) => `<button data-v="${v}" class="${b.pain === v ? 'on' : ''}">${v === 6 ? '6+' : v}</button>`).join('')}</div></div>`;
  if (b.msg) h += `<div class="progmsg">${esc(b.msg)}</div>`;
  return h + '</div>';
}

function openPlayer(s) {
  const r = readyFor(s.date);
  const el = sheet(`<header><button class="txtbtn l" data-a="close">Close</button><div class="ttl">${esc(s.name)}<small>${fmtShort(s.date)}</small></div><button class="txtbtn r" data-a="finish">Finish</button></header>
    <div class="scroll" id="pl"></div>`);
  const draw = () => {
    let h = '';
    if (r && r.level !== 'green') h += `<div class="card ready ${r.level}"><b>${esc(r.title)}</b><p class="small" style="margin:4px 0 0">${esc(r.note)}</p></div>`;
    for (const n of s.notes || []) h += `<p class="muted small">${esc(n)}</p>`;
    if (s.big3) {
      const p = s.big3.pyramid;
      h += `<div class="card"><h3>McGill Big 3 <span class="r">${p.reps.join('/')} holds × ${p.hold} s</span></h3><div class="row" style="gap:6px">${['curlup', p.side, 'birddog'].map((id) => `<div style="flex:1;height:58px;background:var(--surface2);border-radius:10px" data-fig="${id}" data-open="${id}"></div>`).join('')}</div>
        <p class="muted small" style="margin:6px 0">Curl-up, side plank each side, bird dog each side. Descending pyramid, about 11 minutes with rests. Builds endurance, not max effort.</p>
        <div class="row"><button class="btn ghost grow" data-a="big3run">${ic('play')} Guided with voice</button><button class="btn ${s.big3.done ? '' : 'ghost'}" data-a="big3done">${ic('check')} ${s.big3.done ? 'Done' : 'Mark done'}</button></div></div>`;
    }
    s.blocks.forEach((b, i) => { h += blockHtml(b, i); });
    h += `<button class="btn block" data-a="finish" style="margin-top:12px">Finish session</button>`;
    $('#pl', el).innerHTML = h; hydrateFigs(el);
  };
  const persist = () => saveSession(s);
  draw();
  el.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-k]'); if (!inp) return;
    const bi = +inp.closest('[data-b]').dataset.b, si = +inp.closest('[data-s]').dataset.s; const b = s.blocks[bi];
    b.sets[si][inp.dataset.k] = inp.dataset.k === 'rir' ? +inp.value : inp.value;
    if (inp.dataset.k === 'load') for (let j = si + 1; j < b.sets.length; j++) if (!b.sets[j].done) { b.sets[j].load = inp.value; const o = $(`[data-b="${bi}"] [data-s="${j}"] [data-k="load"]`, el); if (o) o.value = inp.value; }
    persist();
  });
  el.addEventListener('change', (ev) => { if (ev.target.matches('select[data-k]')) ev.target.dispatchEvent(new Event('input', { bubbles: true })); });
  el.addEventListener('click', async (ev) => {
    const fo = ev.target.closest('[data-open]'); if (fo) return openExercise(fo.dataset.open);
    const fg = ev.target.closest('.figwrap[data-fig]'); if (fg) return openExercise(fg.dataset.fig);
    const rt = ev.target.closest('.rate button');
    if (rt) { const bi = +rt.closest('[data-b]').dataset.b; s.blocks[bi][rt.closest('.rate').dataset.r] = +rt.dataset.v; $$('button', rt.parentElement).forEach((x) => x.classList.toggle('on', x === rt)); persist(); return; }
    const a = ev.target.closest('[data-a]'); if (!a) return;
    const bi = a.dataset.b !== undefined ? +a.dataset.b : +((a.closest('[data-b]') || {}).dataset || {}).b;
    switch (a.dataset.a) {
      case 'close': stopRest(); await persist(); el.remove(); render(); break;
      case 'done': {
        const si = +a.closest('[data-s]').dataset.s; const b = s.blocks[bi]; const x = b.sets[si]; const ex = EXM[b.ex];
        x.done = !x.done; if (x.done && !x.reps) { x.reps = String(b.target[1]); $(`[data-b="${bi}"] [data-s="${si}"] [data-k="reps"]`, el).value = x.reps; }
        a.classList.toggle('on', x.done); persist();
        if (x.done) { const rest = ex.inc && ['hinge', 'squat', 'single', 'pushH', 'pullH', 'bridge'].includes(b.slot) ? S.profile.restStrength : S.profile.restOther; restTimer(ex.uni && ex.type !== 'carry' ? Math.round(rest * 0.6) : rest); }
        break;
      }
      case 'addset': { const b = s.blocks[bi]; const lastSet = b.sets[b.sets.length - 1] || {}; b.sets.push({ load: lastSet.load || '', reps: '', rir: 2, done: false }); persist(); draw(); break; }
      case 'swap': openSwap(s.blocks[bi], s, () => { persist(); draw(); }); break;
      case 'learn': openExercise(s.blocks[bi].ex); break;
      case 'hold': { const b = s.blocks[bi]; const ex = EXM[b.ex]; const secs = b.target[0]; const segs = []; b.sets.forEach((_, j) => { if (ex.uni) { segs.push({ label: `${ex.name}: left, set ${j + 1}`, sec: secs, hold: true, fig: b.ex, say: 'Left side, hold' }); segs.push({ label: 'Switch sides', sec: 6, say: 'Switch' }); segs.push({ label: `${ex.name}: right, set ${j + 1}`, sec: secs, hold: true, fig: b.ex, say: 'Right side, hold' }); } else segs.push({ label: `${ex.name}, set ${j + 1}`, sec: secs, hold: true, fig: b.ex, say: 'Hold' }); if (j < b.sets.length - 1) segs.push({ label: 'Rest', sec: 30, say: 'Rest' }); });
        runSegments(ex.name, segs, { onDone: (r) => { if (r.completed) { b.sets.forEach((x) => { x.done = true; x.reps = x.reps || String(secs); }); persist(); draw(); } } }); break; }
      case 'big3run': runSegments('McGill Big 3', big3Segments(s.big3.pyramid), { onDone: (r) => { if (r.completed || r.stepsDone > 20) { s.big3.done = true; persist(); draw(); } } }); break;
      case 'big3done': s.big3.done = !s.big3.done; persist(); draw(); break;
      case 'finish': finishSession(s, el); break;
    }
  });
}

function openSwap(b, s, cb) {
  const cur = EXM[b.ex]; const chain = CHAINS[b.slot] || [];
  const same = EX.filter((e) => e.id !== b.ex && (chain.includes(e.id) || e.cat === cur.cat) && e.type !== 'time' && e.lvl <= S.profile.backLevel);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Swap ${esc(cur.name)}</div><span style="min-width:64px"></span></header>
    <div class="scroll"><p class="muted small">Easier or harder steps in the same slot, or the same movement type. Your choice becomes the default for this slot.</p><div class="card list">
    ${same.map((e) => `<button data-id="${e.id}">${figThumb(e.id)}<div class="grow"><b>${esc(e.name)}</b><div class="sub">${esc(e.cat)}${chain.includes(e.id) ? ` · step ${chain.indexOf(e.id) + 1} of ${chain.length}` : ''}</div></div></button>`).join('') || '<p class="muted">No alternatives at your current back level.</p>'}</div></div>`);
  hydrateFigs(el);
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-a="x"]')) return el.remove();
    const o = ev.target.closest('[data-id]'); if (!o) return;
    const id = o.dataset.id; const ex = EXM[id];
    b.ex = id; b.learning = !(S.prog[id] || {}).learned; b.msg = '';
    if (ex.type === 'hold') b.target = ex.secs || [20, 30]; else if (ex.type === 'carry') b.target = ex.dist || [30, 40]; else if (ex.reps) b.target = ex.reps;
    const st = S.prog[id] || {}; b.sets.forEach((x) => { x.load = ex.inc || ex.type === 'carry' ? (st.load || '') : ''; x.done = false; x.reps = ''; });
    if (CHAINS[b.slot] && CHAINS[b.slot].includes(id)) await saveProg(`slot:${b.slot}`, { ex: id });
    el.remove(); cb();
  });
}

async function finishSession(s, playerEl) {
  stopRest();
  const any = s.blocks.some((b) => b.sets.some((x) => x.done)) || (s.big3 && s.big3.done);
  if (!any && !confirm('No sets are checked off. Finish anyway?')) return;
  const hold24 = (S.days[s.date] || {}).checkin && S.days[s.date].checkin.rule24 === 'worse';
  const msgs = [];
  for (const b of s.blocks) {
    const ex = EXM[b.ex]; if (!b.sets.some((x) => x.done)) continue;
    const sets = b.sets.map((x) => ({ ...x, reps: num(x.reps), load: num(x.load) }));
    const res = ENG.progress(S.prog[b.ex] || {}, ex, { sets, tech: b.tech || 3, pain: b.pain || 0 }, b.target, { key: s.date, hold24 });
    b.msg = res.msg; await saveProg(b.ex, res.st);
    if (res.st.learned && b.learning) msgs.push(`${ex.name}: technique is solid, no longer in Learning.`);
    if (res.readyNext && CHAINS[b.slot]) {
      const ch = CHAINS[b.slot]; const i = ch.indexOf(b.ex); const nx = ch[i + 1];
      if (nx && EXM[nx].lvl <= S.profile.backLevel) { await saveProg(`slot:${b.slot}`, { ex: nx }); msgs.push(`${ex.name} mastered. Next time: ${EXM[nx].name} (new movement).`); continue; }
    }
    if (b.pain >= 4 && CHAINS[b.slot]) {
      const ch = CHAINS[b.slot]; const i = ch.indexOf(b.ex);
      if (i > 0) { await saveProg(`slot:${b.slot}`, { ex: ch[i - 1] }); msgs.push(`${ex.name} hurt (${b.pain}/10). Next time: ${EXM[ch[i - 1]].name}.`); continue; }
    }
    if (res.msg) msgs.push(`${ex.name}: ${res.msg}`);
  }
  if (s.big3 && s.big3.done) {
    const b3 = S.prog.big3 || {}; const n = (b3.count || 0) + 1; const base = b3.base || 5;
    await saveProg('big3', { ...b3, count: n, base: n % 8 === 0 && base < 8 ? base + 1 : base });
    if (n % 8 === 0 && base < 8) msgs.push(`Big 3 is getting easy: the pyramid goes up to ${base + 1}/${base - 1}/${base - 3}. McGill adds reps, not longer holds.`);
  }
  s.status = 'done'; s.finishedAt = new Date().toISOString();
  s.minutes = Math.max(1, Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 60000));
  await saveSession(s); S.active = null;
  playerEl.remove();
  const el = sheet(`<header><span style="min-width:64px"></span><div class="ttl">Session done</div><button class="txtbtn r" data-a="x">Close</button></header>
    <div class="scroll"><div class="card"><h3>${ic('check')} ${esc(s.name)}</h3><p class="muted small">${s.minutes} minute${s.minutes === 1 ? '' : 's'} · ${s.blocks.reduce((n, b) => n + b.sets.filter((x) => x.done).length, 0)} sets${s.big3 && s.big3.done ? ' · Big 3' : ''}</p></div>
    ${msgs.length ? `<div class="card"><h3>Next time</h3><ul class="cues">${msgs.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h3>How hard was the whole session?</h3>${seg('rpe', [[4, 'Easy'], [6, 'Moderate'], [8, 'Hard'], [10, 'Max']], s.rpe || 6)}
      <p class="muted tiny">Tomorrow morning's check-in asks how your back feels compared with today. That answer decides whether weights go up.</p></div></div>`);
  wireSeg(el, async (n, v) => { s.rpe = +v; await saveSession(s); });
  el.addEventListener('click', (ev) => { if (ev.target.closest('[data-a="x"]')) { el.remove(); render(); } });
}

/* ---------- cardio ---------- */
const CARDIO_MODES = [['run', 'Road run'], ['trail', 'Trail run'], ['treadmill-run', 'Treadmill run'], ['walk', 'Walk / incline walk'], ['hike', 'Hike'], ['row', 'Rowing machine'], ['bike', 'Bike'], ['other', 'Other']];
function openCardio(k, tplId) {
  const tpl = TEMPLATES[tplId]; const c = ENG.cardioPlan(tpl.cardio, ctxFor(k));
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">${esc(tpl.name)}<small>${fmtShort(k)}</small></div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card"><h3>${esc(c.title)}<span class="r">about ${c.mins} min</span></h3><p class="small">${esc(c.note)}</p>
      ${c.options.length ? `<ul class="cues">${c.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      ${c.segments ? `<div class="list small">${compress(c.segments).map((g) => `<div><span class="grow">${esc(g.label)}</span><span class="end">${g.n > 1 ? `${g.n} × ` : ''}${mmss(g.sec)}</span></div>`).join('')}</div>` : ''}
      <div class="kv" style="margin-top:10px"><span>Max heart rate (est.)</span><span>${c.zones.max} bpm</span><span>Zone 2</span><span>${c.zones.z2[0]}–${c.zones.z2[1]} bpm</span><span>Hard intervals</span><span>${c.zones.hard[0]}–${c.zones.hard[1]} bpm</span></div>
      <button class="btn block" style="margin-top:12px" data-a="go">${ic('play')} ${c.segments ? 'Start guided timer' : 'Start timer'}</button></div>
      <div class="card"><h3>Log it</h3><p class="muted tiny" style="margin:0 0 6px">Did it with the Apple Watch? You can still log it here, or import it later from Settings.</p>${cardioForm({ minutes: c.mins, mode: tpl.cardio === 'intervals' ? 'row' : S.profile.backLevel >= 4 ? 'run' : 'walk' }, c)}</div></div>`);
  wireSeg(el);
  let segsDone = null;
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') { el.remove(); render(); }
    if (a.dataset.a === 'go') {
      const segs = c.segments || [{ label: c.title, sec: c.mins * 60, zone: tpl.cardio === 'intervals' ? 'hard' : 'z2' }];
      runSegments(c.title, segs, { zones: c.zones, onDone: (r) => { segsDone = r; const m = $('[name=minutes]', el); if (m && r.completed) m.value = c.mins; toast(r.completed ? 'Done. Log it below.' : 'Stopped. Log what you did below.'); } });
    }
    if (a.dataset.a === 'save') {
      const d = readCardioForm(el); if (!d) return;
      const sObj = { id: uid(), date: k, tpl: tplId, name: tpl.name, kind: 'cardio', status: 'done', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), cardio: { ...d, plan: c.title, completedSegments: segsDone ? segsDone.completed : null, ladder: !!c.ladder }, minutes: d.minutes, source: 'app' };
      const msgs = [];
      if (c.ladder && d.feel === 'easy' && (d.pain || 0) <= 2 && S.profile.runStage < RUN_LADDER.length - 1) { S.profile.runStage += 1; sObj.cardio.advanced = true; await saveProfile(); msgs.push(`Walk-run moves to stage ${S.profile.runStage + 1}. If your back is worse tomorrow morning, it steps back.`); }
      if (c.ladder && S.profile.runStage === RUN_LADDER.length - 1 && d.feel === 'easy') msgs.push('You finished the walk-run ladder. When the return-to-run checklist is complete, move to back level 4 in Train.');
      const spike = spikeWarning(d, k); if (spike) msgs.push(spike);
      await saveSession(sObj); el.remove(); render();
      toast(msgs.length ? msgs.join(' ') : 'Logged', msgs.length ? 6000 : 2000);
    }
  });
}
function compress(segs) {
  const base = segs.map((s) => ({ label: s.label.replace(/ \d+ of \d+$/, ''), sec: s.sec }));
  const out = []; let i = 0;
  while (i < base.length) {
    const a = base[i], b = base[i + 1]; let n = 1;
    if (b) { while (base[i + 2 * n] && base[i + 2 * n].label === a.label && base[i + 2 * n].sec === a.sec) n++; }
    if (n > 1 && b) { const tail = base[i + 2 * n - 1]; const pairs = tail && tail.label === b.label ? n : n - 1; if (pairs > 1) { out.push({ label: `${a.label} ${mmss(a.sec)} + ${b.label.toLowerCase()} ${mmss(b.sec)}`, sec: a.sec + b.sec, n: pairs }); i += pairs * 2; continue; } }
    out.push({ label: a.label, sec: a.sec, n: 1 }); i++;
  }
  return out;
}
function cardioForm(def, plan) {
  return `<label class="f">Activity</label><select class="field" name="mode">${CARDIO_MODES.map(([v, l]) => `<option value="${v}" ${v === def.mode ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="row"><div class="grow"><label class="f">Minutes</label><input class="field" name="minutes" type="number" inputmode="numeric" value="${def.minutes || ''}"></div>
    <div class="grow"><label class="f">Distance (mi)</label><input class="field" name="dist" type="number" inputmode="decimal" step="0.01" value="${def.dist || ''}"></div></div>
    <div class="row"><div class="grow"><label class="f">Avg heart rate</label><input class="field" name="hr" type="number" inputmode="numeric" value="${def.hr || ''}"></div>
    <div class="grow"><label class="f">Back or joint pain (0-10)</label><input class="field" name="pain" type="number" inputmode="numeric" min="0" max="10" value="${def.pain ?? 0}"></div></div>
    ${plan && plan.ladder ? `<label class="f">How did the run parts feel?</label>${seg('feel', [['easy', 'Easy'], ['ok', 'OK'], ['hard', 'Hard']], 'ok')}` : `<label class="f">Effort</label>${seg('feel', [['easy', 'Easy'], ['ok', 'Moderate'], ['hard', 'Hard']], 'ok')}`}
    <label class="f">Date</label><input class="field" name="date" type="date" value="${def.date || ''}">
    <button class="btn block" style="margin-top:12px" data-a="save">Save</button>`;
}
function readCardioForm(el) {
  const g = (n) => $(`[name=${n}]`, el); const minutes = num(g('minutes').value);
  if (!minutes) { toast('Enter the minutes'); return null; }
  return { mode: g('mode').value, minutes, dist: num(g('dist').value), avgHR: num(g('hr').value), pain: num(g('pain').value) || 0, feel: segVal(el, 'feel'), date: g('date') ? g('date').value : '' };
}
function spikeWarning(d, k) {
  if (!RUN_MODES.includes(d.mode)) return '';
  const longest = longestRun30(addDays(k, -1));
  if (longest && d.minutes > longest * 1.1) return `Heads-up: this run was ${Math.round((d.minutes / longest - 1) * 100)}% longer than your longest in the last 30 days (${Math.round(longest)} min). Big single-run jumps are the injury risk to watch; keep the next few runs shorter.`;
  return '';
}
function openLogCardio() {
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Log activity</div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card">${cardioForm({ minutes: 30, mode: 'walk', date: todayKey() })}</div></div>`);
  wireSeg(el);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') return el.remove();
    if (a.dataset.a === 'save') {
      const d = readCardioForm(el); if (!d) return; const k = d.date || todayKey();
      const label = (CARDIO_MODES.find((m) => m[0] === d.mode) || [0, 'Activity'])[1];
      await saveSession({ id: uid(), date: k, tpl: 'extra', name: label, kind: 'cardio', status: 'done', startedAt: new Date().toISOString(), cardio: d, minutes: d.minutes, source: 'app' });
      const w = spikeWarning(d, k); el.remove(); render(); toast(w || 'Logged', w ? 6000 : 2000);
    }
  });
}
function openSwapDay(k) {
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Session for ${fmtShort(k)}</div><span style="min-width:64px"></span></header>
    <div class="scroll"><p class="muted small">Pick what to do on this day. The rest of the week stays as scheduled.</p><div class="card list">
    ${Object.entries(TEMPLATES).map(([id, t]) => `<button data-t="${id}"><div class="grow"><b>${esc(t.name)}</b><div class="sub">${t.mins ? `about ${t.mins} min` : ''}</div></div>${tplFor(k) === id ? '<span class="end">current</span>' : ''}</button>`).join('')}
    </div>${(S.days[k] || {}).tplOverride ? '<button class="btn ghost block" data-a="reset">Back to the schedule</button>' : ''}</div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (a && a.dataset.a === 'x') return el.remove();
    if (a && a.dataset.a === 'reset') { await saveDay(k, { tplOverride: null }); el.remove(); return render(); }
    const t = ev.target.closest('[data-t]'); if (!t) return;
    await saveDay(k, { tplOverride: t.dataset.t }); el.remove(); render();
  });
}

/* ---------- Train tab ---------- */
function renderTrain() {
  const k = todayKey(); const p = S.profile; setTitle('Train', `Week ${ENG.weekNum(p, k)}${ENG.isDeload(p, k) ? ' · deload' : ''}`);
  const lv = BACK_LEVELS[p.backLevel];
  let h = `<div class="card"><h3>${ic('heart')} Back readiness<button class="r linkbtn" data-act="levelpick">Change</button></h3><b>${esc(lv.name)}</b><p class="muted small" style="margin:4px 0">${esc(lv.desc)}</p>`;
  if (p.backLevel === 3) {
    const n = (p.rtr || []).length;
    h += `<p class="small" style="margin:8px 0 4px"><b>Return-to-run checklist</b> (${n} of ${RTR_CHECKS.length}) · walk-run stage ${p.runStage + 1} of ${RUN_LADDER.length}</p>
      ${RTR_CHECKS.map((c, i) => `<label class="row small" style="padding:4px 0"><input type="checkbox" data-rtr="${i}" ${(p.rtr || []).includes(i) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
      <p class="muted tiny">Common clinical return-to-run screens, not a diagnosis. If the back is still sore, a physical therapist visit first is worth it.</p>`;
  }
  h += `</div><div class="sect">This week</div><div class="card list">`;
  const ws = weekStart(k);
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i); const t = TEMPLATES[tplFor(d)]; const done = sessionsOn(d);
    h += `<button data-act="openday" data-day="${d}"><div style="width:44px" class="${d === k ? 'linkbtn' : ''}"><b>${DOW[parseDay(d).getDay()]}</b><div class="sub">${fmtMD(d)}</div></div><div class="grow"><b>${esc(t.name)}</b><div class="sub">${done.length ? `Done: ${done.map((s) => esc(s.name) + (s.minutes ? ` (${s.minutes} min)` : '')).join(', ')}` : t.mins ? `about ${t.mins} min` : ''}</div></div>${done.length ? `<span class="end" style="color:var(--green)">${ic('check')}</span>` : `<span class="end">${ic('chev')}</span>`}</button>`;
  }
  h += `</div><div class="row"><button class="btn ghost grow" data-act="logcardio">${ic('plus')} Log activity</button><button class="btn ghost grow" data-act="schedule">Edit schedule</button></div>`;
  const hist = S.sessions.filter((s) => s.status === 'done').sort((a, b) => (a.date + (a.finishedAt || '') < b.date + (b.finishedAt || '') ? 1 : -1)).slice(0, 25);
  h += `<div class="sect">History</div><div class="card list">${hist.map((s) => `<button data-act="viewsession" data-id="${s.id}"><div class="grow"><b>${esc(s.name)}</b><div class="sub">${fmtShort(s.date)}${s.source === 'health' ? ' · Apple Health' : ''}</div></div><span class="end">${s.minutes ? `${s.minutes} min` : ''}${s.cardio && s.cardio.dist ? ` · ${s.cardio.dist} mi` : ''}</span></button>`).join('') || '<p class="muted small">Nothing yet.</p>'}</div>`;
  main().innerHTML = h;
}
function viewSession(id) {
  const s = S.sessions.find((x) => x.id === id); if (!s) return;
  let body = `<p class="muted small">${fmtLong(s.date)}${s.minutes ? ` · ${s.minutes} min` : ''}${s.rpe ? ` · effort ${s.rpe}/10` : ''}</p>`;
  if (s.cardio) { const c = s.cardio; body += `<div class="card kv"><span>Activity</span><span>${esc((CARDIO_MODES.find((m) => m[0] === c.mode) || [0, c.mode])[1])}</span>${c.dist ? `<span>Distance</span><span>${c.dist} mi</span>` : ''}${c.avgHR ? `<span>Avg HR</span><span>${c.avgHR} bpm</span>` : ''}${c.kcal ? `<span>Active energy</span><span>${c.kcal} kcal</span>` : ''}${c.plan ? `<span>Plan</span><span>${esc(c.plan)}</span>` : ''}</div>`; }
  if (s.big3) body += `<p>${s.big3.done ? ic('check') : ''} McGill Big 3 ${s.big3.done ? 'done' : 'skipped'}</p>`;
  for (const b of s.blocks || []) { const ex = EXM[b.ex]; body += `<div class="card"><b>${esc(ex.name)}</b><div class="small">${b.sets.filter((x) => x.done).map((x) => (x.load ? `${x.load} lb × ` : '') + x.reps).join(' · ') || 'no sets'}</div><div class="muted tiny">${b.tech ? `Technique ${b.tech}/5` : ''}${b.pain ? ` · pain ${b.pain}/10` : ''}</div>${b.msg ? `<div class="progmsg">${esc(b.msg)}</div>` : ''}</div>`; }
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">${esc(s.name)}</div><button class="txtbtn r" data-a="del" style="color:var(--danger)">Delete</button></header><div class="scroll">${body}</div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') el.remove();
    if (a.dataset.a === 'del' && confirm('Delete this session?')) { await DB.del('sessions', s.id); S.sessions = S.sessions.filter((x) => x.id !== s.id); el.remove(); render(); }
  });
}
function openLevelPick() {
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Back readiness level</div><span style="min-width:64px"></span></header>
    <div class="scroll"><p class="muted small">This sets which exercises and how much impact Waypoint programs. Move up when the back has been calm for two weeks; step back after two "worse" mornings in a week.</p><div class="card list">
    ${[1, 2, 3, 4].map((n) => `<button data-l="${n}"><div class="grow"><b>${esc(BACK_LEVELS[n].name)}</b><div class="sub">${esc(BACK_LEVELS[n].desc)}</div></div>${S.profile.backLevel === n ? `<span class="end">${ic('check')}</span>` : ''}</button>`).join('')}</div></div>`);
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-a="x"]')) return el.remove();
    const b = ev.target.closest('[data-l]'); if (!b) return; S.profile.backLevel = +b.dataset.l; await saveProfile(); el.remove(); render(); toast(BACK_LEVELS[S.profile.backLevel].name);
  });
}
