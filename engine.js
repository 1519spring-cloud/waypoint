/* Waypoint engine: dates, heart-rate zones, weight trend, adaptive energy expenditure,
   session building and progression. No DOM access, so it can be unit-tested in Node. */
'use strict';
const ENG = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const diffDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  const weekStart = (k) => { const d = parseDay(k); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return dayKey(d); }; // Monday
  const LB_PER_KG = 2.20462;

  /* ---------- heart rate ---------- */
  const age = (p, today) => (p.birthYear ? parseDay(today).getFullYear() - p.birthYear : 60);
  const hrMax = (p, today) => p.hrMaxOverride || Math.round(208 - 0.7 * age(p, today)); // Tanaka 2001
  function zones(p, today) {
    const m = hrMax(p, today);
    return { max: m, z2: [Math.round(m * 0.6), Math.round(m * 0.7)], hard: [Math.round(m * 0.85), Math.round(m * 0.95)], easy: [Math.round(m * 0.5), Math.round(m * 0.65)] };
  }

  /* ---------- weight trend (exponential moving average, 10% per day) ---------- */
  function trend(days, fromKey, toKey) {
    // days: map key -> {weight}
    const keys = Object.keys(days).filter((k) => days[k] && days[k].weight).sort();
    if (!keys.length) return {};
    const start = fromKey && fromKey > keys[0] ? keys[0] : keys[0];
    const end = toKey || keys[keys.length - 1];
    const out = {}; let t = days[keys[0]].weight;
    for (let k = start; k <= end; k = addDays(k, 1)) {
      const w = days[k] && days[k].weight;
      if (w) t = t + 0.1 * (w - t);
      out[k] = Math.round(t * 100) / 100;
    }
    return out;
  }

  /* ---------- energy ---------- */
  function bmr(p, weightLb, today) {
    const kg = weightLb / LB_PER_KG, cm = (p.heightIn || 70) * 2.54;
    return 10 * kg + 6.25 * cm - 5 * age(p, today) + (p.sex === 'female' ? -161 : 5); // Mifflin-St Jeor
  }
  // intakeByDay: key -> kcal ; tr: trend map
  function expenditure(p, tr, intakeByDay, today) {
    const keys = Object.keys(tr).sort();
    const wNow = keys.length ? tr[keys[keys.length - 1]] : p.startWeight || 200;
    const initial = Math.round(bmr(p, wNow, today) * (p.activity || 1.5));
    const from = addDays(today, -28), to = addDays(today, -1);
    const win = [];
    for (let k = from; k <= to; k = addDays(k, 1)) if ((intakeByDay[k] || 0) >= 800) win.push(k);
    const weighIns = keys.filter((k) => k >= from && k <= to).length;
    let observed = null, w = 0;
    if (win.length >= 10 && tr[win[0]] !== undefined && tr[win[win.length - 1]] !== undefined) {
      const span = Math.max(7, diffDays(win[0], win[win.length - 1]));
      if (span >= 13) {
        const avg = win.reduce((s, k) => s + intakeByDay[k], 0) / win.length;
        const dW = tr[win[win.length - 1]] - tr[win[0]];
        observed = Math.round(avg - (dW * 3500) / span);
        w = Math.min(1, win.length / 21);
      }
    }
    let est = observed === null ? initial : Math.round(initial * (1 - w) + observed * w);
    est = Math.max(initial * 0.65, Math.min(initial * 1.35, est));
    return { initial, observed, estimate: Math.round(est), loggedDays: win.length, weighIns, adaptive: observed !== null, weight: wNow };
  }
  function targets(p, exp) {
    const rate = p.lossRate ?? 0.5; // % body weight per week
    const deficit = Math.round((rate / 100) * exp.weight * 3500 / 7);
    const floor = p.sex === 'female' ? 1200 : 1500;
    const kcal = Math.max(floor, Math.round((exp.estimate - deficit) / 10) * 10);
    const refLb = p.goalWeight || exp.weight;
    const protein = Math.round((p.proteinPerKg || 1.6) * (refLb / LB_PER_KG));
    return { kcal, protein, deficit, perMeal: Math.max(30, Math.round(protein / 4)), rate };
  }

  /* ---------- readiness ---------- */
  function readiness(c, lastLoadedYesterday) {
    if (!c) return null;
    if (c.redFlags && c.redFlags.length) return { level: 'stop', title: 'Stop: red flag reported', note: 'Skip training and get checked by a doctor promptly. Groin numbness or bladder or bowel changes: emergency room.' };
    const reasons = []; let score = 0;
    if (c.back >= 6) { score += 3; reasons.push(`back pain ${c.back}/10`); }
    else if (c.back >= 4) { score += 2; reasons.push(`back pain ${c.back}/10`); }
    else if (c.back >= 3) { score += 1; reasons.push(`back pain ${c.back}/10`); }
    if (c.rule24 === 'worse') { score += 2; reasons.push('back worse than yesterday morning (24-hour rule)'); }
    if (c.sleep === 1) { score += 1; reasons.push('poor sleep'); }
    if (c.energy === 1) { score += 1; reasons.push('low energy'); }
    if (c.soreness === 3) { score += 1; reasons.push('very sore'); }
    const joints = c.joints || [];
    let level = score >= 3 ? 'red' : score >= 1 || joints.length ? 'yellow' : 'green';
    const jointsOnly = level === 'yellow' && score === 0;
    const title = { green: 'Green: train as planned', yellow: 'Yellow: train, but adjusted', red: 'Red: recovery day' }[level];
    const notes = [];
    if (level === 'yellow' && !jointsOnly) notes.push('One fewer set on the main lifts and leave 2 or more reps in reserve. Intervals become Zone 2.');
    if (level === 'red') notes.push('Swap today for a walk, the Big 3 and gentle mobility. Loaded hinging, carrying and running wait until tomorrow.');
    if (joints.length) notes.push(`Achy ${joints.join(', ')}: exercises that load ${joints.length > 1 ? 'those joints' : 'that joint'} are swapped for gentler versions.`);
    if (c.rule24 === 'worse') notes.push('24-hour rule: the next loaded session repeats your last weights instead of adding.');
    return { level, title: jointsOnly ? 'Yellow: train, with swaps' : title, note: notes.join(' '), reasons, jointsOnly };
  }

  /* ---------- sessions ---------- */
  function isDeload(p, key) {
    if (!p.startDate || p.deload === false) return false;
    const w = Math.floor(diffDays(weekStart(p.startDate), weekStart(key)) / 7) + 1;
    return w > 0 && w % 6 === 0;
  }
  function weekNum(p, key) { return p.startDate ? Math.floor(diffDays(weekStart(p.startDate), weekStart(key)) / 7) + 1 : 1; }

  // pick the exercise for a slot: stored choice, else first chain step allowed at this back level
  function pickForSlot(slot, prog, level, joints, back) {
    const chain = CHAINS[slot];
    if (!chain) return EXM[slot] ? slot : null;
    let id = (prog[`slot:${slot}`] && prog[`slot:${slot}`].ex) || chain[0];
    if (!chain.includes(id)) id = chain[0];
    while (EXM[id].lvl > level) { const i = chain.indexOf(id); if (i <= 0) break; id = chain[i - 1]; }
    for (const j of joints || []) { const s = SWAPS[j] && SWAPS[j][id]; if (s) id = s; }
    if (back) { const s = SWAPS.back[id]; if (s) id = s; }
    return id;
  }

  function buildSession(tplId, ctx) {
    // ctx: { profile, prog, ready (readiness), key, history }
    const tpl = TEMPLATES[tplId]; if (!tpl) return null;
    const p = ctx.profile, level = p.backLevel || 2, deload = isDeload(p, ctx.key);
    const r = ctx.ready ? ctx.ready.level : 'green';
    const joints = ctx.ready && ctx.ready.joints ? ctx.ready.joints : (ctx.checkin && ctx.checkin.joints) || [];
    const backFlag = r === 'red' || (ctx.checkin && ctx.checkin.rule24 === 'worse');
    const s = { tpl: tplId, name: tpl.name, kind: tpl.kind, mins: tpl.mins, deload, blocks: [], notes: [] };
    if (deload) s.notes.push('Deload week: fewer sets and easier cardio so the body can absorb the last five weeks.');
    if (tpl.kind === 'strength' || tpl.kind === 'mobility') {
      if (tpl.big3) s.blocks.push({ big3: true, pyramid: big3Pyramid(ctx.prog, level) });
      for (const [slot, sets, lo, hi] of tpl.items) {
        const id = pickForSlot(slot, ctx.prog, level, joints, backFlag);
        if (!id) continue;
        const ex = EXM[id]; const st = ctx.prog[id] || {};
        let n = sets; if (deload) n = Math.max(1, sets - 1); if (r === 'yellow' && !(ctx.ready && ctx.ready.jointsOnly) && tpl.kind === 'strength') n = Math.max(1, n - (sets >= 3 ? 1 : 0));
        const target = ex.type === 'hold' ? (ex.secs || [lo, hi]) : ex.type === 'carry' ? (ex.dist || [lo, hi]) : (ex.reps && slot === id ? ex.reps : [lo, hi]);
        s.blocks.push({ slot, ex: id, sets: n, target, load: st.load || null, learning: (st.learned ? false : true), repsGoal: st.repsGoal || null });
      }
    }
    return s;
  }

  function big3Pyramid(prog, level) {
    const st = prog['big3'] || {};
    const base = st.base || (level <= 1 ? 5 : 5);
    return { reps: [base, Math.max(1, base - 2), Math.max(1, base - 4)], hold: 10, side: level >= 2 && (prog['sideplank'] || {}).learned ? 'sideplank' : (level >= 2 ? 'sideplank' : 'sideplank_knee') };
  }

  /* Progression after an exercise is logged.
     res: { sets:[{reps, load, rir, done}], tech: 1-5, pain: 0-10 }, target:[lo,hi], ex */
  function progress(st, ex, res, target, opts = {}) {
    const n = { ...st };
    n.exposures = (st.exposures || 0) + 1;
    n.lastDate = opts.key;
    const done = res.sets.filter((x) => x.done);
    if (!done.length) return { st: n, msg: '' };
    const tech = res.tech || 3, pain = res.pain || 0;
    n.techHistory = [...(st.techHistory || []).slice(-4), tech];
    const goodTech = n.techHistory.slice(-2).filter((t) => t >= 4).length;
    if (!n.learned && goodTech >= 2) n.learned = true;
    const inc = ex.inc || 5;
    const lo = target[0], hi = target[1];
    let msg = '';
    if (ex.type === 'reps' && ex.inc) {
      const loads = done.map((x) => Number(x.load) || 0);
      const L = Math.max(...loads);
      if (L > 0) n.load = L;
      const allTop = done.every((x) => (x.reps || 0) >= hi);
      const rirOk = done.every((x) => (x.rir ?? 2) >= 1);
      const missed = done.filter((x) => (x.reps || 0) < lo - 1).length >= 2;
      if (pain >= 4) { n.load = L ? roundTo(L * 0.8, inc) : L; msg = `Pain ${pain}/10: next time ${n.load || 'lighter'} lb, or swap to an easier version.`; n.painFlag = opts.key; }
      else if (opts.hold24) msg = 'Holding weight this time (24-hour rule).';
      else if (allTop && rirOk && tech >= 4 && L > 0 && !n.learned) msg = `Good sets. Same ${L} lb next time while the movement is still in Learning (two sessions rated 4 or 5).`;
      else if (allTop && rirOk && tech >= 4 && L > 0) { n.load = L + inc; msg = `Hit the top of the range: next time ${n.load} lb.`; }
      else if (missed && L > 0) { n.load = roundTo(L * 0.9, inc); msg = `Reps fell short: next time ${n.load} lb.`; }
      else if (L > 0) msg = `Same weight next time (${L} lb); aim for more reps.`;
    } else if (ex.type === 'reps') {
      const allTop = done.every((x) => (x.reps || 0) >= hi);
      n.topStreak = allTop && tech >= 4 && pain < 3 ? (st.topStreak || 0) + 1 : 0;
      if (pain >= 4) msg = `Pain ${pain}/10: step back to an easier version next time.`;
      else if (n.topStreak >= 2) msg = 'Ready for the next variation.';
      else if (allTop) msg = 'Top of the range. One more session like this and the next variation unlocks.';
    } else if (ex.type === 'hold') {
      const allTop = done.every((x) => (x.reps || 0) >= hi);
      n.topStreak = allTop && tech >= 4 && pain < 3 ? (st.topStreak || 0) + 1 : 0;
      if (n.topStreak >= 2) msg = 'Holds are solid. Ready for the next variation.';
    } else if (ex.type === 'carry') {
      const loads = done.map((x) => Number(x.load) || 0); const L = Math.max(...loads);
      if (L > 0) n.load = L;
      if (pain >= 4) { n.load = roundTo(L * 0.8, inc); msg = `Pain ${pain}/10: lighter next time.`; }
      else if (tech >= 4 && done.length >= 2 && L > 0 && !opts.hold24) { n.load = L + inc; msg = `Solid carries: next time ${n.load} lb.`; }
    }
    return { st: n, msg, readyNext: (n.topStreak || 0) >= 2 };
  }
  const roundTo = (x, inc) => Math.max(inc, Math.round(x / inc) * inc);

  /* ---------- cardio ---------- */
  function cardioPlan(kind, ctx) {
    const p = ctx.profile, level = p.backLevel || 2, z = zones(p, ctx.key), r = ctx.ready ? ctx.ready.level : 'green';
    const deload = isDeload(p, ctx.key);
    const longest = ctx.longestRun30 || 0; // minutes
    const modes = p.cardioModes || ['run', 'trail', 'treadmill', 'row'];
    const out = { kind, zones: z, segments: null, options: [], note: '' };
    const ladder = RUN_LADDER[Math.min(p.runStage || 0, RUN_LADDER.length - 1)];
    const ladderSegs = () => { const s = [{ label: 'Warm-up walk', sec: 300, zone: 'easy' }]; for (let i = 0; i < ladder.reps; i++) { s.push({ label: `Run ${i + 1} of ${ladder.reps}`, sec: ladder.run, zone: 'z2' }); if (ladder.walk) s.push({ label: 'Walk', sec: ladder.walk, zone: 'easy' }); } s.push({ label: 'Cool-down walk', sec: 300, zone: 'easy' }); return s; };
    if (r === 'red') { out.title = 'Recovery walk'; out.mins = 25; out.options = ['Easy walk, flat, conversational']; out.note = 'Readiness is red: walking only today.'; return out; }
    if (kind === 'z2') {
      if (level <= 2) { out.title = 'Zone 2: incline walk or easy row'; out.mins = deload ? 25 : 35; out.options = ['Incline treadmill walk 6 to 12%', 'Rower, steady, conversational', 'Brisk outdoor walk with hills']; }
      else if (level === 3) { out.title = `Walk-run, stage ${(p.runStage || 0) + 1} of ${RUN_LADDER.length}`; out.segments = ladderSegs(); out.mins = Math.round(out.segments.reduce((s, x) => s + x.sec, 0) / 60); out.options = ['Treadmill at 1% or a flat road or trail']; out.ladder = true; }
      else { out.title = 'Easy run, Zone 2'; out.mins = deload ? 25 : 35; out.options = modes.filter((m) => m !== 'row').map((m) => ({ run: 'Road run', trail: 'Trail run (easy terrain)', treadmill: 'Treadmill at 1%' }[m])).filter(Boolean); if (modes.includes('row')) out.options.push('Or rower, steady'); }
      out.note = out.note || `Keep heart rate ${z.z2[0]} to ${z.z2[1]} bpm. You should be able to talk in full sentences.`;
    } else if (kind === 'intervals') {
      const done = ctx.intervalsDone || 0;
      if (level <= 1) { out.title = 'Zone 2 incline walk'; out.mins = 30; out.options = ['Incline treadmill walk']; out.note = `Level 1: no hard intervals yet. Heart rate ${z.z2[0]} to ${z.z2[1]}.`; return out; }
      const work = level === 2 ? 2 : done < 2 ? 2 : done < 4 ? 3 : 4;
      const reps = deload ? 3 : 4;
      const eased = r === 'yellow' && !(ctx.ready && ctx.ready.jointsOnly);
      const zone = eased ? 'z2' : 'hard';
      const segs = [{ label: 'Warm-up', sec: 600, zone: 'easy' }];
      for (let i = 0; i < reps; i++) { segs.push({ label: `Hard ${i + 1} of ${reps}`, sec: work * 60, zone }); segs.push({ label: 'Easy', sec: 180, zone: 'easy' }); }
      segs.push({ label: 'Cool-down', sec: 300, zone: 'easy' });
      out.title = eased ? `Intervals eased to Zone 2 (${reps} x ${work} min steady)` : `${reps} x ${work} min intervals`;
      out.segments = segs; out.mins = Math.round(segs.reduce((s, x) => s + x.sec, 0) / 60);
      out.options = level >= 4 ? ['Rower (easiest on joints)', 'Incline treadmill run or power walk', 'Hill repeats outdoors'] : ['Rower (easiest on joints)', 'Incline treadmill power walk'];
      out.note = zone === 'hard' ? `Hard pieces ${z.hard[0]} to ${z.hard[1]} bpm, hard but steady: you could say a few words. Easy pieces: let it fall to about ${Math.round(z.max * 0.7)}.` : `Readiness is yellow: keep the work pieces at ${z.z2[0]} to ${z.z2[1]} bpm.`;
      out.work = work;
    } else if (kind === 'long') {
      if (level <= 2) { out.title = 'Long walk or hike'; out.mins = deload ? 45 : 60; out.options = ['Trail hike', 'Long brisk walk with hills']; out.note = 'Carry a light pack if the back feels good; add weight over weeks.'; }
      else if (level === 3) { out.title = 'Walk-run plus a walk'; out.segments = ladderSegs(); out.mins = Math.round(out.segments.reduce((s, x) => s + x.sec, 0) / 60) + 15; out.options = ['Walk-run on flat trail, then 15 minutes of walking']; out.ladder = true; }
      else {
        const base = p.longRunMins || 45;
        let mins = deload ? Math.round(base * 0.8) : base;
        if (longest && mins > Math.round(longest * 1.1)) { mins = Math.max(20, Math.round(longest * 1.1)); out.capped = true; }
        out.title = 'Long easy run or trail run'; out.mins = mins; out.options = ['Trail run', 'Road run', 'Hike with hills (counts too)'];
        out.note = `Easy effort, ${z.z2[0]} to ${z.z2[1]} bpm. Walk the steep uphills.` + (out.capped ? ` Capped at ${mins} min: no more than 10% longer than your longest run in the last 30 days (${Math.round(longest)} min).` : '');
      }
    }
    return out;
  }

  return { pad, dayKey, parseDay, addDays, diffDays, weekStart, weekNum, age, hrMax, zones, trend, bmr, expenditure, targets, readiness, buildSession, pickForSlot, progress, cardioPlan, isDeload, big3Pyramid, LB_PER_KG };
})();
if (typeof module !== 'undefined') module.exports = ENG;
