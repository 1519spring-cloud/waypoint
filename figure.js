/* Waypoint figure renderer: a side-view stick figure animated between keyframes.
   Angles are absolute degrees measured from straight DOWN; positive turns toward the figure's front (+x).
   dir(a) = (sin a, cos a) in SVG coordinates (y grows downward). Torso angle runs hip -> neck, so 180 = upright. */
'use strict';
const FIG = (() => {
  const L = { T: 30, TH: 24, SH: 23, UA: 17, FA: 15, FOOT: 7, HEAD: 6, NECK: 10 };
  const rad = (a) => (a * Math.PI) / 180;
  const dir = (a, len) => [Math.sin(rad(a)) * len, Math.cos(rad(a)) * len];
  const add = (p, v) => [p[0] + v[0], p[1] + v[1]];
  const KEYS = ['t', 'tn', 'sn', 'tf', 'sf', 'an', 'fn', 'af', 'ff', 'c', 'h'];
  const DEF = { t: 180, tn: 0, sn: 0, tf: 0, sf: 0, an: 0, fn: 0, af: 0, ff: 0, c: 0, h: 0 };

  function joints(p) {
    const q = { ...DEF, ...p };
    const hip = [0, 0];
    const neck = add(hip, dir(q.t, L.T));
    const head = add(neck, dir(q.t + q.h, L.NECK));
    const kneeN = add(hip, dir(q.tn, L.TH)), ankleN = add(kneeN, dir(q.sn, L.SH));
    const kneeF = add(hip, dir(q.tf, L.TH)), ankleF = add(kneeF, dir(q.sf, L.SH));
    const toeN = add(ankleN, dir(q.fN ?? q.sn + 90, L.FOOT)), toeF = add(ankleF, dir(q.fF ?? q.sf + 90, L.FOOT));
    const sh = add(hip, dir(q.t, L.T - 3));
    const elbN = add(sh, dir(q.an, L.UA)), wriN = add(elbN, dir(q.fn, L.FA));
    const elbF = add(sh, dir(q.af, L.UA)), wriF = add(elbF, dir(q.ff, L.FA));
    return { hip, neck, head, kneeN, ankleN, kneeF, ankleF, toeN, toeF, sh, elbN, wriN, elbF, wriF, q };
  }

  // place the figure: pin a joint to a point, otherwise ground the lowest joint at y=0 and put `anchor` at x=0
  function place(j, frame, fig) {
    let dx, dy;
    const pin = frame.pin || fig.pin;
    if (pin) { const p = j[pin.j]; dx = pin.x - p[0]; dy = pin.y - p[1]; }
    else {
      const pts = ['hip', 'neck', 'kneeN', 'ankleN', 'kneeF', 'ankleF', 'toeN', 'toeF', 'elbN', 'wriN', 'elbF', 'wriF', 'head'].map((k) => j[k]);
      const maxY = Math.max(...pts.map((p) => p[1]));
      const a = j[frame.anchor || fig.anchor || 'ankleN'];
      dx = (fig.ax || 0) - a[0]; dy = -maxY;
    }
    const out = {};
    for (const k in j) if (Array.isArray(j[k])) out[k] = [j[k][0] + dx, j[k][1] + dy];
    out.q = j.q; return out;
  }

  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  function lerpFrame(a, b, k) {
    const o = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[key] ?? DEF[key], vb = b[key] ?? DEF[key];
      if (typeof va === 'number' && typeof vb === 'number') o[key] = va + (vb - va) * k;
      else o[key] = k < 0.5 ? a[key] : b[key];
    }
    return o;
  }

  function seg(p1, p2, cls) { return `<line class="${cls}" x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}"/>`; }

  function propSvg(pr, J) {
    switch (pr.k) {
      case 'bench': return `<rect class="prop" x="${pr.x}" y="${pr.y}" width="${pr.w}" height="4" rx="1.5"/><line class="prop-l" x1="${pr.x + 4}" y1="${pr.y + 4}" x2="${pr.x + 4}" y2="4"/><line class="prop-l" x1="${pr.x + pr.w - 4}" y1="${pr.y + 4}" x2="${pr.x + pr.w - 4}" y2="4"/>`;
      case 'box': return `<rect class="prop" x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${4 - pr.y}" rx="1.5"/>`;
      case 'wall': return `<line class="prop-l" x1="${pr.x}" y1="4" x2="${pr.x}" y2="${pr.top || -70}"/>`;
      case 'db': return [pr.side !== 'F' && J.wriN, pr.side !== 'N' && J.wriF].filter(Boolean).map((w) => `<rect class="db" x="${(w[0] - 5).toFixed(1)}" y="${(w[1] - 2.2).toFixed(1)}" width="10" height="4.4" rx="1.6"/>`).join('');
      case 'kb': { const w = J.wriN; return `<circle class="db" cx="${w[0].toFixed(1)}" cy="${(w[1] + 3).toFixed(1)}" r="4.2"/>`; }
      case 'dbhip': { const h = J.hip; return `<rect class="db" x="${(h[0] - 5).toFixed(1)}" y="${(h[1] - 6.5).toFixed(1)}" width="10" height="4.4" rx="1.6"/>`; }
      case 'band': { const w = pr.from === 'knee' ? J.kneeN : J.wriN; return `<line class="band" x1="${w[0].toFixed(1)}" y1="${w[1].toFixed(1)}" x2="${pr.x}" y2="${pr.y}"/><circle class="prop" cx="${pr.x}" cy="${pr.y}" r="1.6"/>`; }
      case 'dowel': { const a = add(J.hip, [-3.5, 3]); const v = [J.head[0] - J.hip[0], J.head[1] - J.hip[1]]; const b = add(J.hip, [v[0] * 1.12 - 3.5, v[1] * 1.12]); const n = Math.hypot(v[0], v[1]); const off = [(-v[1] / n) * -4, (v[0] / n) * -4]; return `<line class="dowel" x1="${(a[0] + off[0]).toFixed(1)}" y1="${(a[1] + off[1]).toFixed(1)}" x2="${(b[0] + off[0]).toFixed(1)}" y2="${(b[1] + off[1]).toFixed(1)}"/>`; }
      case 'rail': return `<line class="prop-l" x1="${pr.x1}" y1="${pr.y}" x2="${pr.x2}" y2="${pr.y}"/><line class="prop-l" x1="${pr.x2}" y1="${pr.y}" x2="${pr.x2 + 4}" y2="${pr.y - 12}"/>`;
      default: return '';
    }
  }

  function draw(J, fig) {
    const q = J.q;
    // torso as a curve so a rounded or neutral spine is visible
    const mid = [(J.hip[0] + J.neck[0]) / 2, (J.hip[1] + J.neck[1]) / 2];
    const v = [J.neck[0] - J.hip[0], J.neck[1] - J.hip[1]]; const n = Math.hypot(v[0], v[1]) || 1;
    const perp = [v[1] / n, -v[0] / n];
    const ctl = [mid[0] + perp[0] * (q.c || 0) * 2, mid[1] + perp[1] * (q.c || 0) * 2];
    let s = '';
    const props = [...(fig.props || []), ...(q.props || [])];
    s += props.filter((p) => ['bench', 'box', 'wall', 'rail'].includes(p.k)).map((p) => propSvg(p, J)).join('');
    s += seg(J.hip, J.kneeF, 'far') + seg(J.kneeF, J.ankleF, 'far') + seg(J.ankleF, J.toeF, 'far ft');
    s += seg(J.sh, J.elbF, 'far') + seg(J.elbF, J.wriF, 'far');
    s += `<path class="torso" d="M${J.hip[0].toFixed(1)} ${J.hip[1].toFixed(1)} Q${ctl[0].toFixed(1)} ${ctl[1].toFixed(1)} ${J.neck[0].toFixed(1)} ${J.neck[1].toFixed(1)}"/>`;
    s += `<circle class="head" cx="${J.head[0].toFixed(1)}" cy="${J.head[1].toFixed(1)}" r="${L.HEAD}"/>`;
    s += seg(J.hip, J.kneeN, 'near') + seg(J.kneeN, J.ankleN, 'near') + seg(J.ankleN, J.toeN, 'near ft');
    s += props.filter((p) => !['bench', 'box', 'wall', 'rail'].includes(p.k)).map((p) => propSvg(p, J)).join('');
    s += seg(J.sh, J.elbN, 'near arm') + seg(J.elbN, J.wriN, 'near arm');
    return s;
  }

  function bbox(fig) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < fig.frames.length; i++) {
      for (let k = 0; k <= 4; k++) {
        const f = lerpFrame(fig.frames[i], fig.frames[(i + 1) % fig.frames.length], k / 4);
        const J = place(joints(f), f, fig);
        for (const key in J) if (Array.isArray(J[key])) { const [x, y] = J[key]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
    }
    for (const p of fig.props || []) {
      if (p.x !== undefined) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + (p.w || 0)); }
      if (p.x1 !== undefined) { x0 = Math.min(x0, p.x1); x1 = Math.max(x1, p.x2 + 4); }
      if (p.y !== undefined) y0 = Math.min(y0, p.y - 12);
      if (p.top !== undefined) y0 = Math.min(y0, p.top);
    }
    y1 = Math.max(y1, 4);
    const pad = 9; return [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2];
  }

  // Render into an element. Returns a stop() function.
  function mount(el, fig, opts = {}) {
    if (!fig || !fig.frames) { el.innerHTML = ''; return () => {}; }
    const [bx, by, bw, bh] = bbox(fig);
    const W = Math.max(bw, bh * 1.35), X = bx - (W - bw) / 2;
    el.innerHTML = `<svg class="fig" viewBox="${X.toFixed(1)} ${by.toFixed(1)} ${W.toFixed(1)} ${bh.toFixed(1)}" role="img" aria-label="${opts.label || 'Movement demo'}">
      <line class="ground" x1="${X}" y1="4.5" x2="${X + W}" y2="4.5"/><g class="body"></g></svg>`;
    const g = el.querySelector('g.body');
    const frames = fig.frames; const hold = fig.hold || frames.map(() => 700); const move = fig.move || 1100;
    if (frames.length === 1 || opts.still) { const f = frames[opts.frame || 0]; g.innerHTML = draw(place(joints(f), f, fig), fig); return () => {}; }
    const cycle = frames.reduce((n, _, i) => n + hold[i] + move, 0);
    let raf, t0 = null, stopped = false;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (ts) => {
      if (stopped) return;
      if (t0 === null) t0 = ts;
      let t = (ts - t0) % cycle, i = 0;
      while (t > hold[i] + move) { t -= hold[i] + move; i++; }
      const a = frames[i], b = frames[(i + 1) % frames.length];
      const k = t <= hold[i] ? 0 : ease((t - hold[i]) / move);
      const f = lerpFrame(a, b, k);
      g.innerHTML = draw(place(joints(f), f, fig), fig);
      if (!el.isConnected) { stopped = true; return; }
      raf = requestAnimationFrame(tick);
    };
    if (reduce) { const f = frames[frames.length - 1]; g.innerHTML = draw(place(joints(f), f, fig), fig); return () => {}; }
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }
  return { mount, joints, place, draw, bbox };
})();
