/* Waypoint app, part 3: Food, Progress, Learn, Settings, Apple Health import, backup, startup. */
'use strict';

/* ================= FOOD ================= */
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
function defaultMeal() { const h = new Date().getHours(); return h < 10 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 20 ? 'Dinner' : 'Snacks'; }
function renderFood() {
  const k = S.foodDay || todayKey(); const { t, e } = energy();
  setTitle('Food', k === todayKey() ? 'Today' : fmtLong(k));
  const list = S.food.filter((f) => f.date === k);
  const kc = kcalOn(k), pr = proteinOn(k);
  let h = `<div class="row" style="justify-content:space-between;margin:4px 0"><button class="btn ghost sm" data-act="fday" data-d="-1">${ic('back')}</button><b>${fmtShort(k)}</b><button class="btn ghost sm" data-act="fday" data-d="1" ${k >= todayKey() ? 'disabled' : ''}>${ic('chev')}</button></div>`;
  h += `<div class="card"><div class="rings">${ring(kc, t.kcal, 'calories', '')}${ring(pr, t.protein, 'protein', ' g')}</div>
    <p class="small" style="margin:10px 0 0">${kc <= t.kcal ? `${t.kcal - Math.round(kc)} calories left` : `${Math.round(kc) - t.kcal} over`} · ${pr >= t.protein ? 'protein goal met' : `${t.protein - Math.round(pr)} g protein to go (aim for ${t.perMeal} g or more per meal)`}</p></div>`;
  for (const m of MEALS) {
    const items = list.filter((f) => f.meal === m);
    h += `<div class="meal"><h4>${m}<span>${items.length ? `${Math.round(items.reduce((s, f) => s + f.kcal, 0))} kcal · ${Math.round(items.reduce((s, f) => s + (f.protein || 0), 0))} g` : ''}</span></h4>
      ${items.map((f) => `<button class="food" data-act="editfood" data-id="${f.id}"><div class="grow"><div>${esc(f.name)}</div>${f.qty && f.qty !== 1 ? `<div class="muted tiny">${r1(f.qty)} × ${esc(f.serving || 'serving')}</div>` : f.serving ? `<div class="muted tiny">${esc(f.serving)}</div>` : ''}</div><div class="end">${Math.round(f.kcal)} kcal<br>${r1(f.protein || 0)} g</div></button>`).join('')}
      <button class="linkbtn small" data-act="addfood" data-meal="${m}" style="padding:6px 0">${ic('plus')} Add</button></div>`;
  }
  h += `<div class="row" style="margin-top:14px"><button class="btn ghost grow sm" data-act="copyday">Copy yesterday</button></div>
    <div class="card"><h3>How targets are set</h3><div class="kv"><span>Burn estimate</span><span>${e.estimate} kcal/day</span><span>Method</span><span>${e.adaptive ? `adaptive (${e.loggedDays} logged days)` : 'formula until 2 weeks of data'}</span><span>Planned loss</span><span>${t.rate}%/wk ≈ ${t.deficit} kcal/day deficit</span><span>Protein</span><span>${S.profile.proteinPerKg} g/kg of ${S.profile.goalWeight ? 'goal' : 'current'} weight</span></div>
    <p class="muted tiny" style="margin:8px 0 0">Log every day, even rough days; skipped days count as "not logged" and are left out of the estimate.</p></div>`;
  main().innerHTML = h;
}
function recentFoods() {
  const seen = new Map();
  for (const f of [...S.food].sort((a, b) => (a.at < b.at ? 1 : -1))) { const key = f.name.toLowerCase(); if (!seen.has(key)) seen.set(key, f); if (seen.size >= 40) break; }
  return [...seen.values()];
}
async function addFood(k, meal, item, qty = 1) {
  const f = { id: uid(), date: k, meal, at: new Date().toISOString(), name: item.name, serving: item.serving || '', qty,
    kcal: Math.round((item.kcal1 ?? item.kcal) * qty), protein: r1((item.protein1 ?? item.protein ?? 0) * qty), kcal1: item.kcal1 ?? item.kcal, protein1: item.protein1 ?? item.protein ?? 0, barcode: item.barcode || null };
  S.food.push(f); await DB.put('food', f); return f;
}
async function saveFav(item) {
  const ex = S.favs.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
  const fav = { id: ex ? ex.id : uid(), name: item.name, serving: item.serving || '', kcal1: item.kcal1 ?? item.kcal, protein1: item.protein1 ?? item.protein ?? 0, barcode: item.barcode || (ex && ex.barcode) || null, uses: ((ex && ex.uses) || 0) + 1 };
  if (ex) Object.assign(ex, fav); else S.favs.push(fav); await DB.put('favs', fav);
}
function openAddFood(k, meal) {
  let tab = 'recent';
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Done</button><div class="ttl">Add food<small>${fmtShort(k)}</small></div><span style="min-width:64px"></span></header>
    <div class="scroll"><label class="f" style="margin-top:4px">Meal</label>${seg('meal', MEALS.map((m) => [m, m]), meal)}
    <div style="margin-top:10px">${seg('tab', [['recent', 'Recent'], ['saved', 'Saved'], ['quick', 'Quick'], ['search', 'Search'], ['scan', 'Scan']], tab)}</div><div id="ft"></div></div>`);
  const pane = $('#ft', el); const curMeal = () => segVal(el, 'meal');
  const listHtml = (arr) => `<div class="card list">${arr.map((f, i) => `<button data-i="${i}"><div class="grow"><div>${esc(f.name)}</div><div class="sub">${esc(f.serving || '1 serving')}</div></div><span class="end">${Math.round(f.kcal1 ?? f.kcal)} kcal<br>${r1(f.protein1 ?? f.protein ?? 0)} g</span></button>`).join('') || '<p class="muted small">Nothing here yet. Use Quick, Search or Scan; foods you log appear here.</p>'}</div>`;
  let arr = [];
  const draw = () => {
    stopCam();
    if (tab === 'recent') { arr = recentFoods(); pane.innerHTML = listHtml(arr); }
    if (tab === 'saved') { arr = [...S.favs].sort((a, b) => (b.uses || 0) - (a.uses || 0)); pane.innerHTML = listHtml(arr); }
    if (tab === 'quick') pane.innerHTML = `<div class="card"><label class="f">Name</label><input class="field" id="qn" placeholder="e.g. Chicken salad"><div class="row"><div class="grow"><label class="f">Calories</label><input class="field" id="qk" type="number" inputmode="numeric"></div><div class="grow"><label class="f">Protein (g)</label><input class="field" id="qp" type="number" inputmode="decimal"></div></div>
      <label class="f">Serving (optional)</label><input class="field" id="qs" placeholder="e.g. 1 bowl"><label class="row small" style="margin-top:10px"><input type="checkbox" id="qf" checked> Save to Saved foods</label><button class="btn block" style="margin-top:12px" data-a="qadd">Add</button></div>`;
    if (tab === 'search') pane.innerHTML = `<div class="card"><div class="row"><input class="field grow" id="sq" placeholder="Search Open Food Facts" enterkeyhint="search"><button class="btn" data-a="sgo">${ic('search')}</button></div><p class="muted tiny">Needs a connection. Packaged foods mostly; for fresh foods use Quick.</p><div id="sr"></div></div>`;
    if (tab === 'scan') pane.innerHTML = `<div class="card"><video class="cam" id="cam" playsinline muted></video><div class="row" style="margin-top:8px"><button class="btn grow" data-a="camon">${ic('cam')} Scan barcode</button></div>
      <label class="f">Or type the barcode</label><div class="row"><input class="field grow" id="bc" inputmode="numeric" placeholder="UPC / EAN"><button class="btn" data-a="bcgo">Look up</button></div><p class="muted tiny">Looks up Open Food Facts (needs a connection). Saved barcodes work offline.</p><div id="br"></div></div>`;
  };
  const pick = (item) => servingsDialog(item, async (qty, it) => { await addFood(k, curMeal(), it, qty); await saveFav(it); toast(`Added ${it.name}`); render(); });
  wireSeg(el, (n, v) => { if (n === 'tab') { tab = v; draw(); } });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'sq') $('[data-a="sgo"]', el).click(); });
  el.addEventListener('click', async (ev) => {
    const it = ev.target.closest('[data-i]'); if (it && (tab === 'recent' || tab === 'saved')) return pick(arr[+it.dataset.i]);
    const r = ev.target.closest('[data-r]'); if (r) return pick(JSON.parse(r.dataset.r));
    const a = ev.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'x': stopCam(); el.remove(); render(); break;
      case 'qadd': {
        const item = { name: $('#qn', el).value.trim() || 'Food', kcal: num($('#qk', el).value) || 0, protein: num($('#qp', el).value) || 0, serving: $('#qs', el).value.trim() };
        if (!item.kcal && !item.protein) return toast('Enter calories or protein');
        await addFood(k, curMeal(), item, 1); if ($('#qf', el).checked) await saveFav(item); toast(`Added ${item.name}`); draw(); render(); break;
      }
      case 'sgo': searchOFF($('#sq', el).value, $('#sr', el)); break;
      case 'bcgo': lookupBarcode($('#bc', el).value.trim(), $('#br', el)); break;
      case 'camon': scanBarcode($('#cam', el), (code) => { $('#bc', el).value = code; lookupBarcode(code, $('#br', el)); }); break;
    }
  });
  draw();
}
function servingsDialog(item, cb) {
  const k1 = item.kcal1 ?? item.kcal, p1 = item.protein1 ?? item.protein ?? 0;
  const per100 = item.per100;
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">${esc(item.name)}</div><button class="txtbtn r" data-a="ok">Add</button></header>
    <div class="scroll"><div class="card">${per100 ? `<label class="f">Amount</label>${seg('u', [['serv', item.servingG ? `Servings (${item.servingG} g)` : 'Servings'], ['g', 'Grams']], item.servingG ? 'serv' : 'g')}` : ''}
      <label class="f" id="ql">${per100 && !item.servingG ? 'Grams' : `Servings of ${esc(item.serving || '1 serving')}`}</label>
      <div class="row"><button class="btn ghost" data-q="-0.5">−</button><input class="field grow" id="q" type="number" inputmode="decimal" step="0.25" value="${per100 && !item.servingG ? 100 : 1}" style="text-align:center"><button class="btn ghost" data-q="0.5">+</button></div>
      <p class="small" id="qt" style="margin:12px 0 0"></p></div></div>`);
  const calc = () => {
    const q = num($('#q', el).value) || 0; const unit = per100 ? segVal(el, 'u') : 'serv';
    let kcal, pro, qty, it = { ...item };
    if (per100 && unit === 'g') { kcal = (per100.kcal * q) / 100; pro = (per100.protein * q) / 100; it = { ...item, serving: `${q} g`, kcal1: kcal, protein1: pro }; qty = 1; }
    else { kcal = k1 * q; pro = p1 * q; qty = q; }
    $('#qt', el).textContent = `${Math.round(kcal)} kcal · ${r1(pro)} g protein`;
    return { qty, it };
  };
  wireSeg(el, () => { const unit = segVal(el, 'u'); $('#ql', el).textContent = unit === 'g' ? 'Grams' : `Servings of ${item.serving || '1 serving'}`; $('#q', el).value = unit === 'g' ? (item.servingG || 100) : 1; calc(); });
  $('#q', el).addEventListener('input', calc); calc();
  el.addEventListener('click', (ev) => {
    const q = ev.target.closest('[data-q]'); if (q) { const inp = $('#q', el); const step = segVal(el, 'u') === 'g' ? +q.dataset.q * 20 : +q.dataset.q; inp.value = Math.max(0, (num(inp.value) || 0) + step); calc(); return; }
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') el.remove();
    if (a.dataset.a === 'ok') { const { qty, it } = calc(); if (!qty) return; el.remove(); cb(qty, it); }
  });
}
function offItem(p, code) {
  const n = p.nutriments || {}; const name = [p.product_name, Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0]].filter(Boolean).join(' · ') || 'Product';
  const per100 = n['energy-kcal_100g'] !== undefined ? { kcal: +n['energy-kcal_100g'] || 0, protein: +n.proteins_100g || 0 } : null;
  const sq = num(p.serving_quantity);
  let kcal1 = n['energy-kcal_serving'], protein1 = n.proteins_serving;
  if ((kcal1 === undefined || kcal1 === '') && per100 && sq) { kcal1 = (per100.kcal * sq) / 100; protein1 = (per100.protein * sq) / 100; }
  if (kcal1 === undefined && per100) { kcal1 = per100.kcal; protein1 = per100.protein; }
  return { name, barcode: code || p.code || null, serving: p.serving_size || (per100 && !sq ? '100 g' : ''), servingG: sq || null, kcal1: Math.round(+kcal1 || 0), protein1: r1(+protein1 || 0), per100 };
}
async function lookupBarcode(code, out) {
  if (!/^\d{6,14}$/.test(code)) return toast('That does not look like a barcode');
  const fav = S.favs.find((f) => f.barcode === code); if (fav) { out.innerHTML = `<div class="list"><button data-r='${esc(JSON.stringify(fav))}'><div class="grow">${esc(fav.name)}<div class="sub">saved food</div></div><span class="end">${fav.kcal1} kcal</span></button></div>`; return; }
  out.innerHTML = '<p class="muted small">Looking up…</p>';
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,serving_size,serving_quantity,nutriments`);
    const j = await r.json();
    if (!j.product) { out.innerHTML = '<p class="muted small">Not in Open Food Facts. Add it with Quick; it will be saved under this barcode next time.</p>'; return; }
    const it = offItem(j.product, code);
    out.innerHTML = `<div class="list"><button data-r='${esc(JSON.stringify(it))}'><div class="grow">${esc(it.name)}<div class="sub">${esc(it.serving || '')}</div></div><span class="end">${it.kcal1} kcal<br>${it.protein1} g</span></button></div>`;
  } catch (e) { out.innerHTML = '<p class="muted small">No connection. Try again later or use Quick.</p>'; }
}
async function searchOFF(q, out) {
  q = (q || '').trim(); if (!q) return;
  out.innerHTML = '<p class="muted small">Searching…</p>';
  const fields = 'code,product_name,brands,serving_size,serving_quantity,nutriments';
  let hits = null;
  // Open Food Facts full-text search allows cross-origin requests; the US subdomain limits results to products sold in the US
  for (const host of ['us', 'world']) {
    if (hits) break;
    try { const r = await fetch(`https://${host}.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=20&sort_by=unique_scans_n&fields=${fields}`); if (r.ok) hits = (await r.json()).products; } catch (e) { /* busy or offline */ }
  }
  if (!hits) { out.innerHTML = '<p class="muted small">Search is unavailable right now (no connection or the service is busy). Use Quick.</p>'; return; }
  const items = hits.map((p) => offItem(p)).filter((x) => x.kcal1 || x.protein1);
  out.innerHTML = `<div class="list">${items.map((it) => `<button data-r='${esc(JSON.stringify(it))}'><div class="grow">${esc(it.name)}<div class="sub">${esc(it.serving || '')}</div></div><span class="end">${it.kcal1} kcal<br>${it.protein1} g</span></button>`).join('') || '<p class="muted small">No results.</p>'}</div>`;
}
let camStream = null, camStop = null;
function stopCam() { if (camStop) camStop(); camStop = null; if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
function loadScript(src) { return new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function scanBarcode(video, onCode) {
  try {
    stopCam();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = camStream; await video.play();
    let found = false;
    if ('BarcodeDetector' in window) {
      const bd = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const loop = async () => { if (found || !camStream) return; try { const r = await bd.detect(video); if (r.length) { found = true; beep(990, 120); stopCam(); return onCode(r[0].rawValue); } } catch (e) { /* keep trying */ } requestAnimationFrame(loop); };
      loop(); camStop = () => { found = true; };
      return;
    }
    await loadScript('zxing.min.js');
    const hints = new Map(); hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader(); reader.setHints(hints);
    const c = document.createElement('canvas'); const ctx2 = c.getContext('2d', { willReadFrequently: true });
    const iv = setInterval(() => {
      if (found || !camStream || !video.videoWidth) return;
      c.width = video.videoWidth; c.height = video.videoHeight; ctx2.drawImage(video, 0, 0);
      try {
        const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)));
        const res = reader.decodeWithState(bmp);
        if (res) { found = true; clearInterval(iv); beep(990, 120); stopCam(); onCode(res.getText()); }
      } catch (e) { /* no barcode in this frame */ }
    }, 250);
    camStop = () => { found = true; clearInterval(iv); };
  } catch (e) { toast('Camera unavailable. Type the barcode instead.'); }
}
function openEditFood(id) {
  const f = S.food.find((x) => x.id === id); if (!f) return;
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Edit</div><button class="txtbtn r" data-a="save">Save</button></header>
    <div class="scroll"><div class="card"><label class="f">Name</label><input class="field" id="en" value="${esc(f.name)}">
    <div class="row"><div class="grow"><label class="f">Calories</label><input class="field" id="ek" type="number" value="${Math.round(f.kcal)}"></div><div class="grow"><label class="f">Protein (g)</label><input class="field" id="ep" type="number" value="${f.protein}"></div></div>
    <label class="f">Meal</label>${seg('meal', MEALS.map((m) => [m, m]), f.meal)}</div><button class="btn danger block" data-a="del">${ic('trash')} Delete</button></div>`);
  wireSeg(el);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') el.remove();
    if (a.dataset.a === 'save') { Object.assign(f, { name: $('#en', el).value, kcal: num($('#ek', el).value) || 0, protein: num($('#ep', el).value) || 0, meal: segVal(el, 'meal') }); await DB.put('food', f); el.remove(); render(); }
    if (a.dataset.a === 'del') { await DB.del('food', f.id); S.food = S.food.filter((x) => x.id !== f.id); el.remove(); render(); }
  });
}
async function copyYesterday() {
  const k = S.foodDay || todayKey(); const y = addDays(k, -1); const items = S.food.filter((f) => f.date === y);
  if (!items.length) return toast('Nothing logged the day before');
  if (S.food.some((f) => f.date === k) && !confirm('Add the previous day\'s foods to this day too?')) return;
  for (const f of items) { const n = { ...f, id: uid(), date: k, at: new Date().toISOString() }; S.food.push(n); await DB.put('food', n); }
  render(); toast(`Copied ${items.length} items`);
}

/* ================= PROGRESS ================= */
function lineChart(series, opts = {}) {
  const W = 340, H = 170, L = 34, R = 8, T = 10, B = 22;
  const pts = series.flatMap((s) => s.pts); if (!pts.length) return '<p class="muted small">Not enough data yet.</p>';
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = opts.x0 ?? Math.min(...xs), x1 = Math.max(opts.x1 ?? -Infinity, ...xs, x0 + 1);
  let y0 = opts.y0 ?? Math.min(...ys), y1 = opts.y1 ?? Math.max(...ys); if (y1 - y0 < (opts.minSpan || 1)) { const m = (y0 + y1) / 2; y0 = m - (opts.minSpan || 1) / 2; y1 = m + (opts.minSpan || 1) / 2; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 3; i++) { const v = y0 + ((y1 - y0) * i) / 3; g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${opts.yfmt ? opts.yfmt(v) : Math.round(v)}</text>`; }
  if (opts.xlab) for (const [x, lab] of opts.xlab) { const px = X(x); g += `<text x="${px.toFixed(1)}" y="${H - 6}" text-anchor="${px > W - R - 20 ? 'end' : px < L + 20 ? 'start' : 'middle'}">${esc(lab)}</text>`; }
  for (const s of series) {
    if (s.dots) g += s.pts.map((p) => `<circle class="dot" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2"/>`).join('');
    if (!s.dots || s.line) g += `<path class="${s.cls || 'l1'}" d="${s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'chart')}">${g}</svg>`;
}
function barChart(groups, keys, opts = {}) {
  const W = 340, H = 170, L = 30, R = 6, T = 10, B = 22; if (!groups.length) return '<p class="muted small">Not enough data yet.</p>';
  const max = Math.max(opts.min || 1, ...groups.map((g) => keys.reduce((s, k) => s + (g.v[k] || 0), 0)), opts.target || 0);
  const bw = (W - L - R) / groups.length; const Y = (v) => T + (1 - v / max) * (H - T - B);
  let s = '';
  for (let i = 0; i <= 2; i++) { const v = (max * i) / 2; s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`; }
  groups.forEach((g, i) => {
    let acc = 0; const x = L + i * bw + bw * 0.18;
    keys.forEach((k, j) => { const v = g.v[k] || 0; if (!v) return; s += `<rect class="b${j + 1}" x="${x.toFixed(1)}" y="${Y(acc + v).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(Y(acc) - Y(acc + v)).toFixed(1)}" rx="2"/>`; acc += v; });
    if (g.lab) s += `<text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(g.lab)}</text>`;
  });
  if (opts.target) s += `<line class="l2" x1="${L}" x2="${W - R}" y1="${Y(opts.target).toFixed(1)}" y2="${Y(opts.target).toFixed(1)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'chart')}">${s}</svg>`;
}
function renderProgress() {
  setTitle('Progress'); const k = todayKey();
  let h = seg('ptab', [['body', 'Body'], ['train', 'Training'], ['cardio', 'Cardio'], ['tests', 'Tests']], S.progTab);
  const xlabDays = (n) => [[-n, fmtMD(addDays(k, -n))], [Math.round(-n / 2), fmtMD(addDays(k, Math.round(-n / 2)))], [0, 'Today']];
  if (S.progTab === 'body') {
    const { e, t, tr } = energy(); const from = addDays(k, -90);
    const w = Object.values(S.days).filter((d) => d.weight && d.key >= from).map((d) => [diffDays(k, d.key), d.weight]);
    const trp = Object.entries(tr).filter(([d]) => d >= from).map(([d, v]) => [diffDays(k, d), v]);
    const tk = Object.keys(tr).sort(); const now = tk.length ? tr[tk[tk.length - 1]] : null; const m4 = tr[addDays(k, -28)];
    h += `<div class="card"><h3>Weight, 90 days<span class="r">${now ? `${r1(now)} lb trend` : ''}</span></h3>${lineChart([{ pts: w, dots: true }, { pts: trp, cls: 'l1' }], { x0: -90, x1: 0, xlab: xlabDays(90), yfmt: (v) => r1(v), minSpan: 4, label: 'weight' })}
      <div class="legend"><span><i style="background:var(--muted)"></i>daily weigh-in</span><span><i style="background:var(--accent)"></i>trend</span></div>
      ${now && m4 ? `<p class="small">Last 4 weeks: ${r1(now - m4)} lb (${r1(((now - m4) / m4) * 100 / 4)}% per week; plan is −${t.rate}%).</p>` : ''}
      ${S.profile.goalWeight && now ? `<p class="small">To goal: ${r1(now - S.profile.goalWeight)} lb. At the planned rate, about ${Math.max(0, Math.round((now - S.profile.goalWeight) / (now * t.rate / 100)))} weeks.</p>` : ''}</div>`;
    const days14 = [...Array(14)].map((_, i) => addDays(k, i - 13));
    h += `<div class="card"><h3>Calories, 14 days<span class="r">target ${t.kcal}</span></h3>${barChart(days14.map((d) => ({ lab: parseDay(d).getDate(), v: { a: kcalOn(d) } })), ['a'], { target: t.kcal, label: 'calories' })}</div>`;
    h += `<div class="card"><h3>Protein, 14 days<span class="r">target ${t.protein} g</span></h3>${barChart(days14.map((d) => ({ lab: parseDay(d).getDate(), v: { a: proteinOn(d) } })), ['a'], { target: t.protein, label: 'protein' })}</div>`;
    h += `<div class="card"><h3>Energy estimate</h3><div class="kv"><span>Formula (Mifflin-St Jeor × ${S.profile.activity})</span><span>${e.initial}</span><span>From your data</span><span>${e.observed ?? 'needs 10+ logged days over 2+ weeks'}</span><span>Used</span><span>${e.estimate} kcal/day</span><span>Logged days (28)</span><span>${e.loggedDays}</span><span>Weigh-ins (28)</span><span>${e.weighIns}</span></div></div>`;
    const bp = Object.values(S.days).filter((d) => d.checkin && d.key >= addDays(k, -60)).map((d) => [diffDays(k, d.key), d.checkin.back]);
    h += `<div class="card"><h3>Back pain from check-ins, 60 days</h3>${lineChart([{ pts: bp.sort((a, b) => a[0] - b[0]), cls: 'l1', dots: true, line: true }], { x0: -60, x1: 0, y0: 0, y1: 10, xlab: xlabDays(60), label: 'back pain' })}</div>`;
  }
  if (S.progTab === 'train') {
    const weeks = [...Array(12)].map((_, i) => addDays(weekStart(k), (i - 11) * 7));
    const per = weeks.map((w) => { const v = { s: 0, c: 0, m: 0 }; S.sessions.filter((s) => s.status === 'done' && s.date >= w && s.date < addDays(w, 7)).forEach((s) => { v[s.kind === 'strength' ? 's' : s.kind === 'cardio' ? 'c' : 'm'] += s.minutes || 0; }); return { lab: fmtMD(w).split(' ')[1], v }; });
    h += `<div class="card"><h3>Training minutes per week</h3>${barChart(per, ['s', 'c', 'm'], { target: 150, label: 'weekly minutes' })}<div class="legend"><span><i style="background:var(--accent)"></i>strength</span><span><i style="background:var(--gold)"></i>cardio</span><span><i style="background:var(--blue)"></i>mobility</span><span>dashed: 150 min aerobic guideline</span></div></div>`;
    const lifts = EX.filter((e) => e.inc && S.sessions.some((s) => s.blocks && s.blocks.some((b) => b.ex === e.id && b.sets.some((x) => x.done && x.load))));
    const sel = S.liftSel && lifts.find((l) => l.id === S.liftSel) ? S.liftSel : lifts[0] && lifts[0].id;
    if (sel) {
      const pts = S.sessions.filter((s) => s.status === 'done' && s.blocks).flatMap((s) => s.blocks.filter((b) => b.ex === sel).map((b) => { const d = b.sets.filter((x) => x.done && x.load); if (!d.length) return null; const e1 = Math.max(...d.map((x) => num(x.load) * (1 + (num(x.reps) || 1) / 30))); return [diffDays(k, s.date), Math.round(e1)]; })).filter(Boolean).sort((a, b) => a[0] - b[0]);
      h += `<div class="card"><h3>Strength trend</h3><select class="field" data-act="liftsel">${lifts.map((l) => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>${lineChart([{ pts, dots: true, line: true }], { xlab: pts.length ? [[pts[0][0], fmtMD(addDays(k, pts[0][0]))], [0, 'Today']] : [], x1: 0, minSpan: 10, label: 'estimated one-rep max' })}<p class="muted tiny">Estimated one-rep max (Epley formula) from your best set each session. You never need to test a true max.</p></div>`;
    } else h += `<div class="card"><h3>Strength trend</h3><p class="muted small">Log weighted sets to see strength trends.</p></div>`;
    const learned = EX.filter((e) => (S.prog[e.id] || {}).learned).length, tried = EX.filter((e) => (S.prog[e.id] || {}).exposures).length;
    h += `<div class="card"><h3>Movement library</h3><div class="stat3"><div><b>${tried}</b><small>tried</small></div><div><b>${learned}</b><small>technique solid</small></div><div><b>${S.sessions.filter((s) => s.status === 'done' && s.big3 && s.big3.done).length + S.sessions.length * 0}</b><small>Big 3 sessions</small></div></div></div>`;
  }
  if (S.progTab === 'cardio') {
    const weeks = [...Array(12)].map((_, i) => addDays(weekStart(k), (i - 11) * 7));
    const per = weeks.map((w) => { const v = { r: 0, o: 0 }; S.sessions.filter((s) => s.status === 'done' && s.cardio && s.date >= w && s.date < addDays(w, 7)).forEach((s) => { v[RUN_MODES.includes(s.cardio.mode) ? 'r' : 'o'] += s.cardio.minutes || 0; }); return { lab: fmtMD(w).split(' ')[1], v }; });
    h += `<div class="card"><h3>Cardio minutes per week</h3>${barChart(per, ['r', 'o'], { target: 150, label: 'cardio minutes' })}<div class="legend"><span><i style="background:var(--accent)"></i>running</span><span><i style="background:var(--gold)"></i>other cardio</span></div></div>`;
    h += `<div class="card"><div class="kv"><span>Longest run, last 30 days</span><span>${Math.round(longestRun30()) || 0} min</span><span>Next run cap (+10%)</span><span>${longestRun30() ? Math.round(longestRun30() * 1.1) + ' min' : 'n/a'}</span><span>Walk-run stage</span><span>${S.profile.backLevel === 3 ? `${S.profile.runStage + 1} of ${RUN_LADDER.length}` : S.profile.backLevel >= 4 ? 'complete' : 'not started'}</span></div></div>`;
    const rhr = Object.values(S.days).filter((d) => d.rhr && d.key >= addDays(k, -180)).map((d) => [diffDays(k, d.key), d.rhr]).sort((a, b) => a[0] - b[0]);
    const vo2 = Object.values(S.days).filter((d) => d.vo2 && d.key >= addDays(k, -365)).map((d) => [diffDays(k, d.key), d.vo2]).sort((a, b) => a[0] - b[0]);
    h += `<div class="card"><h3>Resting heart rate<span class="r">Apple Health</span></h3>${rhr.length ? lineChart([{ pts: rhr, dots: true, line: true }], { x1: 0, minSpan: 6, label: 'resting heart rate' }) : '<p class="muted small">Import from Apple Health in Settings.</p>'}</div>`;
    h += `<div class="card"><h3>VO2 max estimate<span class="r">Apple Health</span></h3>${vo2.length ? lineChart([{ pts: vo2, dots: true, line: true }], { x1: 0, minSpan: 3, yfmt: (v) => r1(v), label: 'VO2 max' }) : '<p class="muted small">Apple Watch estimates this from outdoor walks and runs. Import it in Settings.</p>'}</div>`;
  }
  if (S.progTab === 'tests') {
    const all = [...S.assess].sort((a, b) => (a.date < b.date ? 1 : -1));
    h += `<div class="card"><h3>Fitness and mobility tests<button class="r linkbtn" data-act="assess">New</button></h3><p class="muted small">Every four weeks. Compare with yourself, not with norms.</p>
      <div class="list">${ASSESS.map((a) => { const v = all.filter((x) => x.vals[a.id] !== undefined && x.vals[a.id] !== ''); const cur = v[0], prev = v[1];
        let delta = ''; if (cur && prev) { const c = tsec(cur.vals[a.id]), p = tsec(prev.vals[a.id]); if (c !== null && p !== null && c !== p) { const good = a.better === 'up' ? c > p : c < p; delta = `<span style="color:var(--${good ? 'green' : 'red'})">${good ? '▲' : '▼'}</span>`; } }
        return `<div><div class="grow">${esc(a.name)}<div class="sub">${cur ? fmtMD(cur.date) : 'not measured'}</div></div><span class="end">${cur ? esc(cur.vals[a.id]) + ' ' + a.unit : '–'} ${delta}${prev ? `<div class="tiny">prev ${esc(prev.vals[a.id])}</div>` : ''}</span></div>`; }).join('')}</div></div>`;
  }
  main().innerHTML = h;
}
const tsec = (v) => { if (v === undefined || v === null || v === '') return null; const s = String(v); if (s.includes(':')) { const [m, x] = s.split(':').map(Number); return m * 60 + x; } return num(s); };
function openAssess() {
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Tests</div><button class="txtbtn r" data-a="save">Save</button></header>
    <div class="scroll"><p class="muted small">Fill in what you can; skip the rest. Warm up first. Skip anything your back or joints object to today.</p>
    ${ASSESS.map((a) => `<div class="card"><b>${esc(a.name)}</b> <span class="muted small">(${a.unit})</span><p class="muted tiny" style="margin:4px 0">${esc(a.how)}</p><input class="field" data-t="${a.id}" ${a.unit === 'mm:ss' ? 'placeholder="7:45"' : 'inputmode="decimal"'}></div>`).join('')}</div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') return el.remove();
    const vals = {}; $$('[data-t]', el).forEach((i) => { if (i.value.trim()) vals[i.dataset.t] = i.value.trim(); });
    if (!Object.keys(vals).length) return toast('Nothing entered');
    const rec = { id: uid(), date: todayKey(), vals }; S.assess.push(rec); await DB.put('assess', rec);
    if (vals.rhr) await saveDay(todayKey(), { rhr: num(vals.rhr) });
    el.remove(); S.view = 'progress'; S.progTab = 'tests'; render();
  });
}

/* ================= LEARN ================= */
const CATS = ['All', 'Core', 'Hinge', 'Glutes', 'Squat', 'Single leg', 'Knee care', 'Hip care', 'Push', 'Pull', 'Shoulder care', 'Carry', 'Mobility', 'Cardio'];
function renderLearn() {
  setTitle('Learn', `${EX.length} movements`);
  let h = `<div class="card list">${GUIDES.map((g) => `<button data-act="guide" data-id="${g.id}">${ic('info')}<div class="grow"><b>${esc(g.t)}</b></div><span class="end">${ic('chev')}</span></button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><input class="field grow" id="lq" placeholder="Search movements" value="${esc(S.learnQ)}"></div>
    <div class="chips" style="overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px">${CATS.map((c) => `<button class="chip ${S.learnCat === c ? 'on' : ''}" data-act="lcat" data-c="${c}" style="white-space:nowrap">${c}</button>`).join('')}</div>
    <div class="chips">${['knee', 'hip', 'shoulder', 'back'].map((j) => `<button class="chip ${S.learnJoint === j ? 'on' : ''}" data-act="ljoint" data-j="${j}">Easy on ${j}</button>`).join('')}</div><div class="card list" id="lres"></div>`;
  main().innerHTML = h; drawLearnList();
}
function drawLearnList() {
  const q = S.learnQ.toLowerCase();
  const list = EX.filter((e) => (S.learnCat === 'All' || e.cat === S.learnCat) && (!q || (e.name + ' ' + e.cat + ' ' + e.why).toLowerCase().includes(q)) && (!S.learnJoint || e.joints[S.learnJoint] === 0));
  const el = $('#lres'); if (!el) return;
  el.innerHTML = list.map((e) => { const st = S.prog[e.id] || {}; return `<button data-act="ex" data-id="${e.id}">${figThumb(e.id)}<div class="grow"><b>${esc(e.name)}</b><div class="sub">${esc(e.cat)}${e.lvl > 1 ? ` · level ${e.lvl}+` : ''}${st.learned ? ' · technique solid' : st.exposures ? ` · done ${st.exposures}×` : ''}</div></div></button>`; }).join('') || '<p class="muted small">No matches.</p>';
  hydrateFigs(el);
}
function openGuide(id) {
  const g = GUIDES.find((x) => x.id === id);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">${esc(g.t)}</div><span style="min-width:64px"></span></header><div class="scroll">${g.b.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`);
  el.addEventListener('click', (ev) => { if (ev.target.closest('[data-a="x"]')) el.remove(); });
}
function openExercise(id) {
  const e = EXM[id]; const st = S.prog[id] || {};
  const chainEntry = Object.entries(CHAINS).find(([, c]) => c.includes(id));
  const logs = S.sessions.filter((s) => s.status === 'done' && s.blocks).flatMap((s) => s.blocks.filter((b) => b.ex === id && b.sets.some((x) => x.done)).map((b) => ({ date: s.date, b }))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const jn = Object.entries(e.joints).map(([j, v]) => `<span class="pill ${v === 0 ? 'g' : v === 1 ? 'y' : 'r'}">${j}: ${['easy', 'some', 'high'][v]}</span>`).join(' ');
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">${esc(e.name)}<small>${esc(e.cat)}</small></div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="bigfig" id="bf"></div>
      <p>${esc(e.why)}</p><div class="row wrap" style="gap:6px">${jn}</div>
      ${e.eq.length ? `<p class="muted small">Equipment: ${esc(e.eq.join(', '))}</p>` : ''}
      <div class="card"><h3>Setup</h3><p class="small" style="margin:0">${esc(e.setup)}</p><h3 style="margin-top:12px">Steps</h3><ol class="steps small">${e.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <div class="card"><h3>Cues</h3><ul class="cues small">${e.cues.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><h3 style="margin-top:10px">Common mistakes</h3><ul class="cues small">${e.faults.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div class="card"><h3>${ic('heart')} Joint notes</h3><p class="small" style="margin:0">${esc(e.jointNote)}</p></div>
      ${chainEntry ? `<div class="card"><h3>Progression</h3><div class="chips">${chainEntry[1].map((c) => `<button class="chip ${c === id ? 'on' : ''}" data-open="${c}">${esc(EXM[c].name)}</button>`).join('<span class="muted">›</span>')}</div></div>` : ''}
      <div class="row" style="margin:10px 0"><button class="btn ghost grow" data-a="form">${ic('cam')} Form check</button><button class="btn ghost grow" data-a="vid">${ic('play')} Find a video</button></div>
      ${!st.learned ? `<button class="btn ghost block" data-a="known">I already know this one well</button>` : '<p class="muted small">Technique marked solid.</p>'}
      ${logs.length ? `<div class="card"><h3>Your history</h3><div class="list small">${logs.map((l) => `<div><span class="grow">${fmtMD(l.date)}</span><span class="end">${l.b.sets.filter((x) => x.done).map((x) => (x.load ? `${x.load}×` : '') + x.reps).join(', ')}${l.b.tech ? ` · tech ${l.b.tech}` : ''}</span></div>`).join('')}</div></div>` : ''}
    </div>`);
  const stop = FIG.mount($('#bf', el), e.fig, { label: e.name });
  if (!e.fig) $('#bf', el).innerHTML = '<div class="muted small" style="display:grid;place-items:center;height:100%;padding:16px;text-align:center">This one is easier to follow from the steps and a video; a side-view figure would not show it well.</div>';
  el.addEventListener('click', async (ev) => {
    const o = ev.target.closest('[data-open]'); if (o && o.dataset.open !== id) { stop(); el.remove(); return openExercise(o.dataset.open); }
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') { stop(); el.remove(); }
    if (a.dataset.a === 'vid') window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(e.name + ' exercise form')}`, '_blank');
    if (a.dataset.a === 'form') openFormCheck(e);
    if (a.dataset.a === 'known') { await saveProg(id, { ...st, learned: true }); a.outerHTML = '<p class="muted small">Technique marked solid.</p>'; }
  });
}
function openFormCheck(e) {
  let rec = null, chunks = [], facing = 'user', stream = null, url = null;
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Form check<small>${esc(e.name)}</small></div><span style="min-width:64px"></span></header>
    <div class="scroll"><video class="cam" id="fv" playsinline muted autoplay></video>
      <div class="row" style="margin-top:8px"><button class="btn grow" data-a="rec">Record</button><button class="btn ghost" data-a="flip">Flip</button><button class="btn ghost hidden" data-a="slow">0.5×</button></div>
      <p class="muted tiny">Prop the phone side-on at hip height, 8 to 10 feet away. The clip stays on screen only; nothing is saved or uploaded.</p>
      <div class="card"><h3>Check against</h3><ul class="cues small">${e.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><h3>Watch for</h3><ul class="cues small">${e.faults.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div></div>`);
  const v = $('#fv', el);
  const start = async () => { try { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); v.srcObject = stream; v.src = ''; v.muted = true; await v.play(); } catch (err) { toast('Camera unavailable'); } };
  start();
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') { if (stream) stream.getTracks().forEach((t) => t.stop()); if (url) URL.revokeObjectURL(url); el.remove(); }
    if (a.dataset.a === 'flip') { facing = facing === 'user' ? 'environment' : 'user'; start(); }
    if (a.dataset.a === 'slow') { v.playbackRate = v.playbackRate === 0.5 ? 1 : 0.5; a.textContent = v.playbackRate === 0.5 ? '1×' : '0.5×'; }
    if (a.dataset.a === 'rec') {
      if (!stream || typeof MediaRecorder === 'undefined') return toast('Recording is not available here');
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      if (!v.srcObject) { start(); a.textContent = 'Record'; $('[data-a="slow"]', el).classList.add('hidden'); return; }
      chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (x) => chunks.push(x.data);
      rec.onstop = () => { const blob = new Blob(chunks, { type: rec.mimeType }); if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob); v.srcObject = null; v.src = url; v.loop = true; v.playbackRate = 0.5; v.play(); a.textContent = 'Retake'; const s = $('[data-a="slow"]', el); s.classList.remove('hidden'); s.textContent = '1×'; };
      rec.start(); a.textContent = 'Stop'; setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 30000);
    }
  });
}

/* ================= SETTINGS, ONBOARDING ================= */
function profileForm(p) {
  const ft = Math.floor((p.heightIn || 70) / 12), inch = Math.round((p.heightIn || 70) % 12);
  return `<label class="f">Name</label><input class="field" name="name" value="${esc(p.name)}">
    <div class="row"><div class="grow"><label class="f">Birth year</label><input class="field" name="birthYear" type="number" inputmode="numeric" value="${p.birthYear || ''}"></div>
    <div class="grow"><label class="f">Sex (for the calorie formula)</label><select class="field" name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></div></div>
    <div class="row"><div class="grow"><label class="f">Height, feet</label><input class="field" name="ft" type="number" inputmode="numeric" value="${ft}"></div><div class="grow"><label class="f">inches</label><input class="field" name="in" type="number" inputmode="numeric" value="${inch}"></div></div>
    <div class="row"><div class="grow"><label class="f">Current weight, lb</label><input class="field" name="startWeight" type="number" inputmode="decimal" value="${p.startWeight || ''}"></div><div class="grow"><label class="f">Goal weight, lb</label><input class="field" name="goalWeight" type="number" inputmode="decimal" value="${p.goalWeight || ''}"></div></div>
    <label class="f">Weekly loss rate</label><select class="field" name="lossRate">${[[0, 'Maintain'], [0.25, '0.25% per week (gentle)'], [0.5, '0.5% per week (recommended)'], [0.75, '0.75% per week'], [1, '1% per week (aggressive)']].map(([v, l]) => `<option value="${v}" ${+p.lossRate === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="f">Protein, grams per kg of goal weight</label><select class="field" name="proteinPerKg">${[1.2, 1.4, 1.6, 1.8, 2.0].map((v) => `<option value="${v}" ${+p.proteinPerKg === v ? 'selected' : ''}>${v} g/kg${v === 1.6 ? ' (default)' : ''}</option>`).join('')}</select>
    <label class="f">Resting heart rate (optional)</label><input class="field" name="rhr" type="number" inputmode="numeric" value="${p.rhr || ''}">`;
}
function readProfileForm(el, p) {
  const g = (n) => $(`[name=${n}]`, el);
  p.name = g('name').value.trim(); p.birthYear = num(g('birthYear').value); p.sex = g('sex').value;
  p.heightIn = (num(g('ft').value) || 5) * 12 + (num(g('in').value) || 0);
  p.startWeight = num(g('startWeight').value); p.goalWeight = num(g('goalWeight').value);
  p.lossRate = +g('lossRate').value; p.proteinPerKg = +g('proteinPerKg').value; p.rhr = num(g('rhr').value);
  return p;
}
function openOnboarding() {
  const p = { ...DEFAULT_PROFILE };
  const el = sheet(`<header><span style="min-width:64px"></span><div class="ttl">Welcome to Waypoint</div><span style="min-width:64px"></span></header>
    <div class="scroll"><p>Waypoint coaches strength, mobility, cardio and eating with one rule above the rest: protect the back, hips, knees and shoulders while you get fitter and leaner. Everything stays on this phone.</p>
    <div class="card">${profileForm(p)}</div>
    <div class="card"><h3>Your back right now</h3>${[1, 2, 3, 4].map((n) => `<label class="row small" style="padding:6px 0;align-items:flex-start"><input type="radio" name="lvl" value="${n}" ${n === 3 ? 'checked' : ''}><span><b>${esc(BACK_LEVELS[n].name)}</b><br><span class="muted">${esc(BACK_LEVELS[n].desc)}</span></span></label>`).join('')}
      <p class="muted tiny">"Mostly fine with occasional twinges" usually fits Level 3. If you are already running pain-free, choose Level 4.</p></div>
    <div class="card"><h3>Cardio you like</h3><div class="chips" id="modes">${[['run', 'Road running'], ['trail', 'Trail running'], ['treadmill', 'Treadmill'], ['row', 'Rowing machine']].map(([v, l]) => `<button class="chip on" data-m="${v}">${l}</button>`).join('')}</div></div>
    <div class="card"><h3>Week plan</h3><p class="small muted" style="margin:0">Mon strength A (hinge) · Tue easy cardio · Wed strength B (upper) · Thu intervals · Fri strength C (squat, knees) · Sat long run or hike · Sun recovery mobility. Change any day in Settings.</p></div>
    <p class="muted tiny">Waypoint is fitness education, not medical advice. If back pain spreads down a leg, or you notice numbness, weakness, or bladder or bowel changes, stop and see a doctor.</p>
    <button class="btn block" data-a="go">Build my plan</button></div>`);
  $('#modes', el).addEventListener('click', (ev) => { const b = ev.target.closest('[data-m]'); if (b) b.classList.toggle('on'); });
  el.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-a="go"]')) return;
    readProfileForm(el, p);
    if (!p.birthYear || !p.startWeight) return toast('Birth year and current weight are needed for the targets');
    p.backLevel = +$('input[name=lvl]:checked', el).value; p.cardioModes = $$('#modes .on', el).map((b) => b.dataset.m);
    p.startDate = todayKey(); p.runStage = 0;
    S.profile = p; await saveProfile();
    await saveDay(todayKey(), { weight: p.startWeight });
    await seedSlots(p.backLevel);
    el.remove(); render(); toast('Plan ready. Start with the morning check-in.');
  });
}
// Starting step in each progression chain by back level (experienced lifters can move up with Swap)
async function seedSlots(level) {
  const start = { 1: {}, 2: { hinge: 'rdl', pushH: 'pushup', pullH: 'dbrow', bridge: 'glutebridge', single: 'splitsquat' }, 3: { hinge: 'rdl', squat: 'gobletsquat', single: 'splitsquat', pushH: 'pushup', pullH: 'dbrow', bridge: 'slbridge', hipcare: 'lateralwalk', knee: 'spanish' }, 4: { hinge: 'rdl', squat: 'gobletsquat', single: 'reverselunge', pushH: 'dbbench', pullH: 'dbrow', bridge: 'hipthrust', hipcare: 'copenhagen_short', knee: 'stepdown' } }[level] || {};
  for (const [slot, ex] of Object.entries(start)) if (!S.prog[`slot:${slot}`]) await saveProg(`slot:${slot}`, { ex });
}
function openSchedule() {
  const p = S.profile; const order = [1, 2, 3, 4, 5, 6, 0];
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Weekly schedule</div><button class="txtbtn r" data-a="save">Save</button></header>
    <div class="scroll"><p class="muted small">Keep a rest or easy day between the three strength sessions when you can, and keep intervals away from the long run.</p><div class="card">
    ${order.map((d) => `<label class="f">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</label><select class="field" data-d="${d}">${Object.entries(TEMPLATES).map(([id, t]) => `<option value="${id}" ${p.week[d] === id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`).join('')}</div>
    <div class="card"><label class="f">Base long-run length (minutes, level 4)</label><input class="field" id="lr" type="number" value="${p.longRunMins}"><p class="muted tiny">Waypoint caps any run at 10% over your longest run of the past 30 days.</p></div></div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') return el.remove();
    $$('[data-d]', el).forEach((s) => { p.week[+s.dataset.d] = s.value; }); p.longRunMins = num($('#lr', el).value) || 45;
    await saveProfile(); el.remove(); render();
  });
}
function openSettings() {
  const p = S.profile;
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Settings</div><button class="txtbtn r" data-a="save">Save</button></header>
    <div class="scroll">
      <div class="sect">Profile and targets</div><div class="card">${profileForm(p)}
        <label class="f">Activity factor for the starting estimate</label><select class="field" name="activity">${[[1.4, '1.4 light'], [1.5, '1.5 moderate (default)'], [1.6, '1.6 active'], [1.7, '1.7 very active']].map(([v, l]) => `<option value="${v}" ${+p.activity === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="f">Max heart rate override (blank = 208 − 0.7 × age)</label><input class="field" name="hrmax" type="number" value="${p.hrMaxOverride || ''}"></div>
      <div class="sect">Training</div><div class="card list">
        <button data-a="schedule"><div class="grow">Weekly schedule</div>${ic('chev')}</button>
        <button data-a="level"><div class="grow">Back readiness</div><span class="end">${esc(BACK_LEVELS[p.backLevel].name.split(':')[0])}</span></button>
        <label><div class="grow">Deload every 6th week</div><input type="checkbox" name="deload" ${p.deload ? 'checked' : ''}></label>
        <label><div class="grow">Voice cues in timers</div><input type="checkbox" name="voice" ${p.voice ? 'checked' : ''}></label>
        <label><div class="grow">Rest after main lifts (s)</div><input class="field" style="width:80px" name="restStrength" type="number" value="${p.restStrength}"></label>
        <label><div class="grow">Rest after other sets (s)</div><input class="field" style="width:80px" name="restOther" type="number" value="${p.restOther}"></label>
        <label><div class="grow">Program start date</div><input class="field" style="width:160px" name="startDate" type="date" value="${p.startDate || ''}"></label></div>
      <div class="sect">Data</div><div class="card list">
        <label><div class="grow">Import from Apple Health<div class="sub">export.xml from the Health app export</div></div><input type="file" accept=".xml,text/xml,application/xml,.zip" id="hk" style="width:120px"></label>
        <button data-a="backup"><div class="grow">Back up now<div class="sub">${S.lastBackup ? `last: ${fmtShort(dayKey(new Date(S.lastBackup)))}` : 'never'}</div></div>${ic('share')}</button>
        <label><div class="grow">Restore from a backup</div><input type="file" accept=".json,application/json" id="rs" style="width:120px"></label>
        <button data-a="csv"><div class="grow">Export spreadsheets (CSV)</div>${ic('share')}</button>
        <button data-a="erase" style="color:var(--danger)"><div class="grow">Erase everything</div></button></div>
      <p class="note muted tiny">Waypoint ${APP_VERSION}. Data is stored only on this device. Fitness education, not medical advice.</p>
    </div>`);
  el.addEventListener('change', async (ev) => {
    if (ev.target.id === 'hk' && ev.target.files[0]) { importHealth(ev.target.files[0]); ev.target.value = ''; }
    if (ev.target.id === 'rs' && ev.target.files[0]) { await restoreBackup(ev.target.files[0]); ev.target.value = ''; }
  });
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'x': el.remove(); break;
      case 'save': {
        readProfileForm(el, p); const g = (n) => $(`[name=${n}]`, el);
        p.activity = +g('activity').value; p.hrMaxOverride = num(g('hrmax').value); p.deload = g('deload').checked; p.voice = g('voice').checked;
        p.restStrength = num(g('restStrength').value) || 90; p.restOther = num(g('restOther').value) || 45; p.startDate = g('startDate').value || p.startDate;
        await saveProfile(); el.remove(); render(); toast('Saved'); break;
      }
      case 'schedule': openSchedule(); break;
      case 'level': openLevelPick(); break;
      case 'backup': doBackup(); break;
      case 'csv': doCSV(); break;
      case 'erase': if (confirm('Erase all Waypoint data on this phone? Back up first if you want to keep it.') && confirm('Really erase everything?')) { for (const s of STORES) await DB.clear(s); location.reload(); } break;
    }
  });
}

/* ================= APPLE HEALTH IMPORT ================= */
// Streams export.xml in slices so a large export does not have to fit in memory at once.
const HK_TYPES = { Running: 'run', Walking: 'walk', Hiking: 'hike', Rowing: 'row', Cycling: 'bike', TraditionalStrengthTraining: 'strength', FunctionalStrengthTraining: 'strength', CoreTraining: 'strength', Yoga: 'mobility', Flexibility: 'mobility', MindAndBody: 'mobility', Cooldown: 'mobility', Elliptical: 'other', StairClimbing: 'other', HighIntensityIntervalTraining: 'other', CrossTraining: 'other', Other: 'other' };
function attrs(tag) { const o = {}; tag.replace(/(\w+)="([^"]*)"/g, (_, k, v) => { o[k] = v; }); return o; }
function hkDate(s) { const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/.exec(s || ''); if (!m) return null; return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5]}:${m[6]}`); }
async function parseHealthXML(file, sinceKey, onProgress) {
  const out = { weights: {}, rhr: {}, vo2: {}, workouts: [] };
  const CH = 4 * 1024 * 1024; const dec = new TextDecoder('utf-8'); let buf = ''; let pos = 0;
  const handleRecord = (tag) => {
    const a = attrs(tag); const d = hkDate(a.startDate); if (!d) return; const k = dayKey(d); if (k < sinceKey) return;
    const v = parseFloat(a.value); if (!Number.isFinite(v)) return;
    if (a.type === 'HKQuantityTypeIdentifierBodyMass') out.weights[k] = a.unit === 'kg' ? v * ENG.LB_PER_KG : v;
    else if (a.type === 'HKQuantityTypeIdentifierRestingHeartRate') out.rhr[k] = v;
    else if (a.type === 'HKQuantityTypeIdentifierVO2Max') out.vo2[k] = v;
  };
  const handleWorkout = (xml) => {
    const open = xml.slice(0, xml.indexOf('>') + 1); const a = attrs(open); const d = hkDate(a.startDate); if (!d) return; const k = dayKey(d); if (k < sinceKey) return;
    const type = (a.workoutActivityType || '').replace('HKWorkoutActivityType', '');
    let minutes = parseFloat(a.duration); if (a.durationUnit === 's' || a.durationUnit === 'sec') minutes /= 60; if (a.durationUnit === 'hr') minutes *= 60;
    let dist = a.totalDistance ? parseFloat(a.totalDistance) : null; let dUnit = a.totalDistanceUnit; let kcal = a.totalEnergyBurned ? parseFloat(a.totalEnergyBurned) : null; let hr = null;
    xml.replace(/<WorkoutStatistics [^>]*>/g, (t) => { const s = attrs(t);
      if (/Distance/.test(s.type) && s.sum) { dist = parseFloat(s.sum); dUnit = s.unit; }
      if (s.type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && s.sum) kcal = parseFloat(s.sum);
      if (s.type === 'HKQuantityTypeIdentifierHeartRate' && s.average) hr = parseFloat(s.average); return t; });
    if (dist !== null) { if (dUnit === 'km') dist /= 1.609344; else if (dUnit === 'm') dist /= 1609.344; }
    const indoor = /HKIndoorWorkout" value="1"/.test(xml);
    let mode = HK_TYPES[type] || 'other'; if (mode === 'run') mode = indoor ? 'treadmill-run' : 'run';
    out.workouts.push({ start: d.toISOString(), date: k, type, mode, minutes: Math.round(minutes), dist: dist !== null ? Math.round(dist * 100) / 100 : null, kcal: kcal !== null ? Math.round(kcal) : null, avgHR: hr !== null ? Math.round(hr) : null, source: a.sourceName || '' });
  };
  while (pos < file.size || buf.length) {
    if (pos < file.size) { const chunk = await file.slice(pos, pos + CH).arrayBuffer(); pos += CH; buf += dec.decode(chunk, { stream: pos < file.size }); onProgress && onProgress(Math.min(1, pos / file.size)); }
    let i = 0;
    for (;;) {
      const r = buf.indexOf('<Record ', i), w = buf.indexOf('<Workout ', i);
      const n = r < 0 ? w : w < 0 ? r : Math.min(r, w);
      if (n < 0) { i = Math.max(i, buf.length - 16); break; }
      if (n === w) {
        const openEnd = buf.indexOf('>', n); if (openEnd < 0) { i = n; break; }
        if (buf[openEnd - 1] === '/') { handleWorkout(buf.slice(n, openEnd + 1)); i = openEnd + 1; continue; }
        const close = buf.indexOf('</Workout>', openEnd); if (close < 0) { i = n; break; }
        handleWorkout(buf.slice(n, close + 10)); i = close + 10;
      } else {
        const end = buf.indexOf('>', n); if (end < 0) { i = n; break; }
        handleRecord(buf.slice(n, end + 1)); i = end + 1;
      }
    }
    buf = buf.slice(i);
    if (pos >= file.size) { if (!/<Record |<Workout /.test(buf)) break; if (buf.length && pos >= file.size && buf.indexOf('>') < 0) break; }
  }
  return out;
}
async function importHealth(file) {
  if (/\.zip$/i.test(file.name)) {
    if (file.size > 150e6) return toast('That zip is large. In the Files app, tap it to unzip, then pick apple_health_export/export.xml.', 7000);
    toast('Opening zip…', 20000);
    try { const zip = await JSZip.loadAsync(file); const f = Object.values(zip.files).find((x) => /export\.xml$/.test(x.name) && !/cda/.test(x.name)); if (!f) return toast('No export.xml in that zip'); const blob = await f.async('blob'); file = new File([blob], 'export.xml'); } catch (e) { return toast('Could not open the zip: ' + e.message, 5000); }
  }
  const since = addDays(todayKey(), -365);
  toast('Reading Apple Health export…', 60000);
  try {
    const r = await parseHealthXML(file, since, (f) => toast(`Reading Apple Health export… ${Math.round(f * 100)}%`, 60000));
    let nW = 0, nR = 0, nV = 0, nWk = 0;
    for (const [k, v] of Object.entries(r.weights)) { if (!(S.days[k] && S.days[k].weight)) { await saveDay(k, { weight: r1(v) }); nW++; } }
    for (const [k, v] of Object.entries(r.rhr)) { if ((S.days[k] || {}).rhr !== v) { await saveDay(k, { rhr: v }); nR++; } }
    for (const [k, v] of Object.entries(r.vo2)) { if ((S.days[k] || {}).vo2 !== v) { await saveDay(k, { vo2: v }); nV++; } }
    const have = new Set(S.sessions.filter((s) => s.hkStart).map((s) => s.hkStart));
    const add = [];
    for (const w of r.workouts) {
      if (have.has(w.start)) continue;
      const kind = w.mode === 'strength' ? 'strength' : w.mode === 'mobility' ? 'mobility' : 'cardio';
      const label = (CARDIO_MODES.find((m) => m[0] === w.mode) || [0, w.type.replace(/([a-z])([A-Z])/g, '$1 $2')])[1];
      add.push({ id: uid(), date: w.date, tpl: 'health', name: `${label} (Watch)`, kind, status: 'done', startedAt: w.start, hkStart: w.start, minutes: w.minutes, source: 'health', cardio: kind === 'cardio' ? { mode: w.mode, minutes: w.minutes, dist: w.dist, avgHR: w.avgHR, kcal: w.kcal } : null, blocks: kind === 'cardio' ? null : [] });
    }
    if (add.length) { await DB.putMany('sessions', add); S.sessions.push(...add); nWk = add.length; }
    await DB.setMeta('lastHealthImport', new Date().toISOString());
    render(); toast(`Imported ${nWk} workouts, ${nW} weigh-ins, ${nR} resting heart rates, ${nV} VO2 max readings (last 12 months).`, 7000);
  } catch (e) { toast('Import failed: ' + e.message, 6000); }
}

/* ================= BACKUP / RESTORE / CSV ================= */
function offerFile(blob, name, detail, onSaved) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const url = URL.createObjectURL(blob);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Ready to save</div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card"><p style="margin:0 0 4px;font-weight:600">${esc(name)}</p><p class="muted small" style="margin:0 0 14px">${esc(detail)} · ${Math.max(1, Math.round(blob.size / 1024))} KB</p>
      ${canShare ? `<button class="btn block" data-a="share">${ic('share')} Save to Files or share…</button>` : ''}
      <a class="btn ghost block" style="text-decoration:none;margin-top:10px" href="${url}" download="${esc(name)}" data-a="dl">Download</a>
      <p class="muted small" style="margin-top:14px">On iPhone, choose <b>Save to Files</b> and pick iCloud Drive or Google Drive so a copy lives off this phone.</p></div></div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') { URL.revokeObjectURL(url); el.remove(); }
    if (a.dataset.a === 'share') { try { await navigator.share({ files: [file], title: name }); onSaved && onSaved(); toast('Saved'); } catch (err) { if (err.name !== 'AbortError') toast('Sharing failed; try Download'); } }
    if (a.dataset.a === 'dl') onSaved && onSaved();
  });
}
async function buildBackup() {
  const data = { app: 'Waypoint', version: APP_VERSION, exported: new Date().toISOString() };
  for (const s of STORES) data[s] = await DB.all(s);
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
async function doBackup() {
  const blob = await buildBackup();
  offerFile(blob, `Waypoint-backup-${todayKey()}.json`, `${S.sessions.length} sessions, ${S.food.length} food entries, ${Object.keys(S.days).length} days`, async () => { S.lastBackup = new Date().toISOString(); await DB.setMeta('lastBackup', S.lastBackup); render(); });
}
async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'Waypoint') return toast('That is not a Waypoint backup');
    if (!confirm(`Restore the backup from ${new Date(data.exported).toLocaleDateString()}? Records in it are merged with what is on this phone; matching records are replaced.`)) return;
    for (const s of STORES) if (Array.isArray(data[s]) && data[s].length) await DB.putMany(s, data[s]);
    await loadAll(); render(); toast('Backup restored');
  } catch (e) { toast('Restore failed: ' + e.message, 5000); }
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
async function doCSV() {
  if (typeof JSZip === 'undefined') return toast('Still loading; try again');
  const zip = new JSZip(); const tr = weightTrend();
  const days = Object.values(S.days).sort((a, b) => (a.key < b.key ? -1 : 1));
  zip.file('daily.csv', toCSV([['date', 'weight_lb', 'trend_lb', 'kcal', 'protein_g', 'back_pain', 'rule24', 'sleep', 'energy', 'soreness', 'achy_joints', 'resting_hr', 'vo2max'],
    ...days.map((d) => [d.key, d.weight || '', tr[d.key] || '', Math.round(kcalOn(d.key)) || '', r1(proteinOn(d.key)) || '', d.checkin ? d.checkin.back : '', d.checkin ? d.checkin.rule24 || '' : '', d.checkin ? d.checkin.sleep : '', d.checkin ? d.checkin.energy : '', d.checkin ? d.checkin.soreness : '', d.checkin ? (d.checkin.joints || []).join(' ') : '', d.rhr || '', d.vo2 || ''])]));
  const sets = [['date', 'session', 'exercise', 'set', 'load_lb', 'reps_or_seconds', 'reps_in_reserve', 'technique', 'pain']];
  for (const s of S.sessions.filter((x) => x.status === 'done' && x.blocks)) for (const b of s.blocks) b.sets.forEach((x, i) => { if (x.done) sets.push([s.date, s.name, EXM[b.ex].name, i + 1, x.load || '', x.reps || '', EXM[b.ex].type === 'reps' ? x.rir : '', b.tech || '', b.pain ?? '']); });
  zip.file('sets.csv', toCSV(sets));
  zip.file('sessions.csv', toCSV([['date', 'name', 'kind', 'minutes', 'mode', 'distance_mi', 'avg_hr', 'effort', 'source'], ...S.sessions.filter((s) => s.status === 'done').sort((a, b) => (a.date < b.date ? -1 : 1)).map((s) => [s.date, s.name, s.kind, s.minutes || '', s.cardio ? s.cardio.mode : '', s.cardio ? s.cardio.dist || '' : '', s.cardio ? s.cardio.avgHR || '' : '', s.rpe || (s.cardio ? s.cardio.feel || '' : ''), s.source || 'app'])]));
  zip.file('food.csv', toCSV([['date', 'meal', 'food', 'servings', 'kcal', 'protein_g'], ...[...S.food].sort((a, b) => (a.date + a.at < b.date + b.at ? -1 : 1)).map((f) => [f.date, f.meal, f.name, f.qty || 1, Math.round(f.kcal), f.protein])]));
  zip.file('tests.csv', toCSV([['date', ...ASSESS.map((a) => `${a.id} (${a.unit})`)], ...S.assess.map((x) => [x.date, ...ASSESS.map((a) => x.vals[a.id] || '')])]));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  offerFile(blob, `Waypoint-export-${todayKey()}.zip`, 'daily, sets, sessions, food and tests as CSV');
}

/* ================= WIRING, STARTUP ================= */
function wire() {
  $$('nav.tabs button').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; main().scrollTop = 0; render(); }));
  $('#btn-settings').addEventListener('click', () => S.profile && openSettings());
  main().addEventListener('input', (ev) => { if (ev.target.id === 'lq') { S.learnQ = ev.target.value; drawLearnList(); } });
  main().addEventListener('change', async (ev) => {
    if (ev.target.matches('[data-act="liftsel"]')) { S.liftSel = ev.target.value; render(); }
    if (ev.target.matches('[data-rtr]')) { const i = +ev.target.dataset.rtr; const set = new Set(S.profile.rtr || []); ev.target.checked ? set.add(i) : set.delete(i); S.profile.rtr = [...set]; await saveProfile(); if (S.profile.rtr.length === RTR_CHECKS.length) toast('Checklist complete. The walk-run ladder is open; finish it, then move to level 4.', 5000); }
  });
  main().addEventListener('click', async (ev) => {
    const sb = ev.target.closest('.seg button'); if (sb && sb.closest('[data-seg="ptab"]')) { S.progTab = sb.dataset.v; return render(); }
    const a = ev.target.closest('[data-act]'); if (!a) return;
    switch (a.dataset.act) {
      case 'checkin': openCheckin(); break;
      case 'start': startDay(a.dataset.day); break;
      case 'swapday': openSwapDay(a.dataset.day); break;
      case 'logcardio': openLogCardio(); break;
      case 'daily': runSegments('Spine and hips daily', dailySegments(), { onDone: async (r) => { if (r.completed || r.stepsDone > 40) { await saveDay(todayKey(), { daily: true }); render(); } } }); break;
      case 'dailydone': { const k = todayKey(); await saveDay(k, { daily: !(S.days[k] || {}).daily }); render(); break; }
      case 'saveweight': { const w = num($('#wt').value); if (!w || w < 70 || w > 600) return toast('Enter a weight in pounds'); await saveDay(todayKey(), { weight: w }); render(); toast('Saved'); break; }
      case 'food': S.view = 'food'; S.foodDay = todayKey(); render(); break;
      case 'day': case 'openday': { const d = a.dataset.day; if (d > todayKey()) { openSwapDay(d); break; } startDay(d); break; }
      case 'backup': doBackup(); break;
      case 'update': if (S.updateReady) S.updateReady.postMessage('skipWaiting'); break;
      case 'level': { const to = +a.dataset.to; if (confirm(`Switch to ${BACK_LEVELS[to].name}?`)) { S.profile.backLevel = to; } else { S.profile.levelDismissed = todayKey(); } await saveProfile(); render(); break; }
      case 'levelpick': openLevelPick(); break;
      case 'schedule': openSchedule(); break;
      case 'assess': openAssess(); break;
      case 'viewsession': viewSession(a.dataset.id); break;
      case 'fday': { const k = addDays(S.foodDay || todayKey(), +a.dataset.d); if (k <= todayKey()) { S.foodDay = k; render(); } break; }
      case 'addfood': openAddFood(S.foodDay || todayKey(), a.dataset.meal || defaultMeal()); break;
      case 'editfood': openEditFood(a.dataset.id); break;
      case 'copyday': copyYesterday(); break;
      case 'guide': openGuide(a.dataset.id); break;
      case 'lcat': S.learnCat = a.dataset.c; render(); break;
      case 'ljoint': S.learnJoint = S.learnJoint === a.dataset.j ? null : a.dataset.j; render(); break;
      case 'ex': openExercise(a.dataset.id); break;
    }
  });
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && todayKey() !== lastDay) { lastDay = todayKey(); S.foodDay = null; render(); } });
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { S.updateReady = w; render(); } });
    if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = reg.waiting; render(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updateReady && !reloaded) { reloaded = true; location.reload(); } });
}
(async function init() {
  try {
    await DB.open(); await loadAll(); wire(); registerSW();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (!S.profile) { setTitle('Waypoint'); openOnboarding(); } else render();
  } catch (err) {
    document.body.innerHTML = `<div class="empty"><h2>Waypoint could not open its storage</h2><p>${esc(err.message)}</p><p>If this is a Private Browsing tab, open Waypoint in a normal tab or from the Home Screen.</p></div>`;
  }
})();
