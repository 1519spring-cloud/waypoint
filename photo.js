/* Waypoint photo food estimator (1.7.0).
   Takes or picks a photo, shrinks it on the phone, and asks Claude (Anthropic API, called straight from the
   phone with Hilary's own key) for an itemized calorie and protein estimate. The key lives only in this
   phone's storage (meta 'anthropicKey') and is left out of backups. Nothing else leaves the phone. */
'use strict';
const PHOTO = (() => {
  const MODEL = 'claude-sonnet-5-5';
  const PRICE = { in: 2, out: 10 }; // US dollars per million tokens, Claude Sonnet 5.5 (platform.claude.com pricing, checked 2026-10-04)
  const MAX_EDGE = 1280;
  const KEY = 'anthropicKey';

  const getKey = () => DB.meta(KEY, '');
  const setKey = (v) => DB.setMeta(KEY, v);

  async function shrink(file) {
    let src;
    try { src = await createImageBitmap(file); } catch (_) {
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read that photo')); im.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, s = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.85);
    return { url, b64: url.split(',')[1], w: c.width, h: c.height };
  }

  // Structured outputs (output_config.format, json_schema). Sonnet 5.5 rejects forced tool_choice ("any"/"tool"),
  // so the fixed JSON shape comes from the schema instead (platform.claude.com structured-outputs, checked 2026-10-04).
  const SCHEMA = {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string', description: 'Short food name, e.g. "Grilled chicken thigh"' },
        portion: { type: 'string', description: 'Household measure as seen, e.g. "1 cup", "2 slices", "about 5 oz"' },
        grams: { type: 'number' },
        kcal: { type: 'number' },
        protein_g: { type: 'number' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      }, required: ['name', 'portion', 'grams', 'kcal', 'protein_g', 'confidence'], additionalProperties: false } },
      not_food: { type: 'boolean', description: 'True if the photo shows no food' },
      notes: { type: 'string', description: 'One or two plain sentences: what drove the estimate and what would change it most (hidden oil, sauce, portion depth). American English.' },
    },
    required: ['items', 'not_food', 'notes'],
    additionalProperties: false,
  };

  function prompt(ctx) {
    let t = 'Estimate the calories and protein in this meal photo for a food log. List each distinct food separately. ' +
      'Judge portions from the plate, bowl, utensils and hands; count visible cooking fats, sauces, dressings and cheese. ' +
      'Use USDA-style values. Round kcal to the nearest 5 and protein to the nearest gram. If unsure between two sizes, pick the middle and say so in notes. ' +
      'If a packaged item with a label is visible, use the label.';
    if (ctx.menu && ctx.menu.length) t += `\n\nOn the family's dinner menu today (per-portion values from the recipe): ${ctx.menu.map((r) => `${r.name}: ${Math.round(r.kcal)} kcal, ${r1(r.protein)} g protein`).join('; ')}. If the photo shows one of these, use those values scaled to the portion seen.`;
    if (ctx.note) t += `\n\nThe eater adds: ${ctx.note}`;
    if (ctx.meal) t += `\n\nMeal: ${ctx.meal}.`;
    return t;
  }

  const HEADERS = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  function parseJSON(t) {
    if (!t) return null;
    try { return JSON.parse(t); } catch (_) { /* fall through */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
  }
  async function call(key, body) {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: HEADERS(key), body: JSON.stringify(body) });
    return { res, j: await res.json().catch(() => ({})) };
  }
  async function estimate(img, ctx) {
    const key = await getKey(); if (!key) throw new Error('Add your Anthropic API key in Settings first.');
    if (!navigator.onLine) throw new Error('Photo estimates need a connection.');
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.b64 } },
      { type: 'text', text: prompt(ctx) },
    ];
    let { res, j } = await call(key, { model: MODEL, max_tokens: 1500, output_config: { format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content }] });
    let m = (j.error && j.error.message) || '';
    // If the API ever rejects the schema request, fall back once to plain JSON by instruction.
    if (res.status === 400 && /output_config|json_schema|schema|format/i.test(m)) {
      const plain = [content[0], { type: 'text', text: prompt(ctx) + '\n\nReply with only a JSON object, no other text, with keys: items (array of {name, portion, grams, kcal, protein_g, confidence: "low"|"medium"|"high"}), not_food (boolean), notes (string).' }];
      ({ res, j } = await call(key, { model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: plain }] }));
      m = (j.error && j.error.message) || '';
    }
    if (!res.ok) {
      m = m || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('The API key was refused. Check it in Settings.');
      if (/credit balance/i.test(m)) throw new Error('Your Anthropic account is out of credit. Add credit at console.anthropic.com, Billing.');
      if (res.status === 529 || res.status === 503) throw new Error('Claude is busy right now. Try again in a minute.');
      throw new Error(m);
    }
    const out = parseJSON(((j.content || []).find((c) => c.type === 'text') || {}).text);
    if (!out || !Array.isArray(out.items)) throw new Error(j.stop_reason === 'refusal' ? 'Claude declined to estimate that photo.' : 'No estimate came back. Try again.');
    const u = j.usage || {}; const cost = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6;
    const spent = (await DB.meta('photoSpend', { n: 0, usd: 0 })); spent.n++; spent.usd += cost; await DB.setMeta('photoSpend', spent);
    return { ...out, cost };
  }

  async function testKey(key) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return 'Key works.';
    if (res.status === 401) return 'That key was refused.';
    return (j.error && j.error.message) || `HTTP ${res.status}`;
  }

  /* ---------- the photo sheet ---------- */
  async function open(k, meal, onAdded) {
    const hasKey = !!(await getKey());
    let img = null, est = null, eat = 1, busy = false;
    const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Photo estimate<small>${esc(meal)} · ${fmtShort(k)}</small></div><span style="min-width:64px"></span></header><div class="scroll" id="pb"></div>`);
    const draw = () => {
      const box = $('#pb', el);
      if (!hasKey) { box.innerHTML = `<div class="card"><p class="small" style="margin-top:0">Photo estimates use Claude through your own Anthropic API key, about a cent per photo. Add the key in Settings, Sync, Photo estimates.</p><button class="btn block" data-a="keyset">Set up the key</button></div>`; return; }
      let h = `<div class="card"><label class="btn block" style="display:flex;justify-content:center;gap:8px">${ic('cam')} ${img ? 'Retake or choose another' : 'Take or choose a photo'}<input type="file" accept="image/*" id="pf" hidden></label>
        ${img ? `<img src="${img.url}" alt="" style="width:100%;border-radius:12px;margin-top:10px;display:block">` : ''}
        <label class="f">Anything the photo won't show (optional)</label><input class="field" id="pn" placeholder="e.g. fried in butter, second helping, half eaten" value="${esc(($('#pn', el) || {}).value || '')}">
        <button class="btn block" data-a="go" style="margin-top:12px" ${img && !busy ? '' : 'disabled'}>${busy ? 'Estimating, about 10 seconds…' : 'Estimate'}</button></div>`;
      if (est && est.not_food) h += `<div class="card"><p class="small" style="margin:0">Claude doesn't see food in that photo. ${esc(est.notes || '')}</p></div>`;
      else if (est) {
        const inc = est.items.filter((i) => i.on);
        const tk = inc.reduce((s, i) => s + (+i.kcal || 0), 0) * eat, tp = inc.reduce((s, i) => s + (+i.protein_g || 0), 0) * eat;
        h += `<div class="sect">Estimate</div><div class="card list">${est.items.map((i, n) => `<div data-n="${n}" style="align-items:flex-start">
            <input type="checkbox" data-on ${i.on ? 'checked' : ''} style="width:22px;height:22px;margin-top:4px;flex:none">
            <div class="grow"><div>${esc(i.name)} ${i.confidence === 'low' ? '<span class="pill y">rough</span>' : ''}</div><div class="sub">${esc(i.portion)}${i.grams ? ` · ${Math.round(i.grams)} g` : ''}</div></div>
            <input class="field" data-g="kcal" type="number" inputmode="numeric" value="${Math.round(i.kcal)}" style="width:74px" aria-label="kcal">
            <input class="field" data-g="protein_g" type="number" inputmode="decimal" value="${r1(i.protein_g)}" style="width:58px" aria-label="protein grams"></div>`).join('')}
          <p class="tiny muted" style="margin:6px 0 0;text-align:right">kcal · protein g (edit if you know better)</p></div>
          ${est.notes ? `<p class="small muted" style="margin:8px 4px">${esc(est.notes)}</p>` : ''}
          <div class="card"><label class="f" style="margin-top:0">How much of it did you eat?</label>${seg('eat', [['1', 'All'], ['0.75', '3/4'], ['0.5', 'Half'], ['0.25', '1/4']], String(eat))}
          <p class="small" style="margin:12px 0 0"><b>${Math.round(tk)} kcal · ${r1(tp)} g protein</b></p>
          <button class="btn block" data-a="add" style="margin-top:12px" ${inc.length ? '' : 'disabled'}>Add ${inc.length} item${inc.length === 1 ? '' : 's'} to ${esc(meal)}</button>
          <p class="tiny muted" style="margin:8px 0 0">Photo estimates are often 20 to 30% off, mostly from hidden oil and portion depth. This one cost about ${(est.cost * 100).toFixed(1)}¢.</p></div>`;
      }
      box.innerHTML = h;
    };
    draw();
    wireSeg(el, (n, v) => { if (n === 'eat') { eat = +v; draw(); } });
    el.addEventListener('change', async (ev) => {
      if (ev.target.id === 'pf' && ev.target.files[0]) {
        try { img = await shrink(ev.target.files[0]); est = null; draw(); } catch (e) { toast(e.message, 4000); }
      }
      if (ev.target.matches('[data-on]')) { est.items[+ev.target.closest('[data-n]').dataset.n].on = ev.target.checked; draw(); }
    });
    el.addEventListener('input', (ev) => {
      const g = ev.target.dataset.g; if (!g) return;
      est.items[+ev.target.closest('[data-n]').dataset.n][g] = num(ev.target.value) || 0;
      const inc = est.items.filter((i) => i.on); const b = $('.card p.small b', el);
      if (b) b.textContent = `${Math.round(inc.reduce((s, i) => s + i.kcal, 0) * eat)} kcal · ${r1(inc.reduce((s, i) => s + i.protein_g, 0) * eat)} g protein`;
    });
    el.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]'); if (!a) return;
      switch (a.dataset.a) {
        case 'x': el.remove(); break;
        case 'keyset': el.remove(); openKeySheet(); break;
        case 'go': {
          if (!img || busy) return; busy = true; draw();
          try {
            const r = await estimate(img, { note: ($('#pn', el) || {}).value || '', meal, menu: meal === 'Dinner' && typeof menuFor === 'function' ? menuFor(k) : [] });
            est = { ...r, items: (r.items || []).map((i) => ({ ...i, kcal: +i.kcal || 0, protein_g: +i.protein_g || 0, on: true })) }; eat = 1;
          } catch (e) { toast(e.message, 5000); }
          busy = false; draw(); break;
        }
        case 'add': {
          const inc = est.items.filter((i) => i.on); if (!inc.length) return;
          for (const i of inc) await addFood(k, meal, { name: i.name, serving: `${i.portion}${eat !== 1 ? ` × ${eat}` : ''} (photo estimate)`, kcal: i.kcal * eat, protein: i.protein_g * eat }, 1);
          toast(`Added ${inc.length} item${inc.length === 1 ? '' : 's'} from the photo`); el.remove(); onAdded && onAdded(); break;
        }
      }
    });
  }

  async function openKeySheet() {
    const key = await getKey(); const sp = await DB.meta('photoSpend', { n: 0, usd: 0 });
    const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Photo estimates</div><span style="min-width:64px"></span></header><div class="scroll">
      <div class="card"><p class="small" style="margin-top:0">Food > Add > Quick > Estimate from a photo sends the photo, shrunk on the phone, to Claude (Sonnet 5.5) and gets back an itemized calorie and protein estimate. It uses your own Anthropic API key, billed by Anthropic at about a cent per photo. The key is stored only on this phone and is left out of backups.</p>
        ${sp.n ? `<div class="kv"><span>Photos estimated</span><span>${sp.n}</span><span>Approximate cost so far</span><span>$${sp.usd.toFixed(2)}</span></div>` : ''}
        <label class="f">Anthropic API key</label><input class="field" id="ak" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(key)}">
        <div class="row" style="margin-top:10px"><button class="btn grow" data-a="save">Save</button><button class="btn ghost grow" data-a="test">Test</button>${key ? '<button class="btn ghost" data-a="del" style="color:var(--danger)">Remove</button>' : ''}</div>
        <p class="small" id="kt" style="margin:10px 0 0"></p></div>
      <div class="card"><h3>Getting a key</h3><ol class="small" style="padding-left:18px;margin:0">
        <li>On a computer, go to console.anthropic.com and sign in (or create an account; it is separate from a Claude Max subscription).</li>
        <li>Billing: add prepaid credit. $5 covers several hundred photos.</li>
        <li>Optional: Limits: set a monthly spend limit, such as $5.</li>
        <li>API Keys: Create Key, name it Waypoint, copy it.</li>
        <li>Send the key to the iPhone (AirDrop a note, or paste through Universal Clipboard), then paste it above and tap Save, then Test.</li></ol></div></div>`);
    el.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]'); if (!a) return; const v = $('#ak', el).value.trim(); const out = $('#kt', el);
      if (a.dataset.a === 'x') el.remove();
      if (a.dataset.a === 'save') { if (!/^sk-ant-/.test(v)) { out.textContent = 'That does not look like an Anthropic key (it starts with sk-ant-).'; return; } await setKey(v); out.textContent = 'Saved. Tap Test to check it.'; }
      if (a.dataset.a === 'test') { if (!v) return; out.textContent = 'Testing…'; try { out.textContent = await testKey(v); } catch (e) { out.textContent = navigator.onLine ? `Could not reach Anthropic: ${e.message}` : 'No connection.'; } }
      if (a.dataset.a === 'del') { await setKey(''); el.remove(); toast('Key removed'); }
    });
  }

  return { open, openKeySheet, shrink, estimate, KEY, MODEL };
})();
