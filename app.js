'use strict';
(() => {
  /* ---------- constants & helpers ---------- */
  const REF = window.REFERENCE_STYLES || [];
  const REF_BY_ID = Object.fromEntries(REF.map(r => [r.id, r]));
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'];
  const MAX_PHOTOS = 6;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    const add = (n) => {
      if (n == null || n === false) return;
      if (Array.isArray(n)) return n.forEach(add);
      e.append(n.nodeType ? n : document.createTextNode(String(n)));
    };
    kids.forEach(add);
    return e;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (x == null ? '' : String(x));
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const firstSentence = (s) => str(s).split('. ')[0].replace(/\.$/, '');
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataURLToBlob = (u) => {
    const [m, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: (m.match(/:(.*?);/) || [, 'image/jpeg'])[1] });
  };
  const canvasBlob = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q));

  /* ---------- settings & key ---------- */
  const SKEY = 'fs.settings', KKEY = 'fs.key';
  const defaults = { model: DEFAULT_MODELS[0], models: DEFAULT_MODELS, remember: true, autoCam: false, grid: true, size: 1600, gpsDefault: false };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { /* storage blocked */ }
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* ignore */ } };
  function getKey() { try { return localStorage.getItem(KKEY) || sessionStorage.getItem(KKEY) || ''; } catch { return ''; } }
  function setKey(k, remember) {
    try {
      localStorage.removeItem(KKEY); sessionStorage.removeItem(KKEY);
      if (k) (remember ? localStorage : sessionStorage).setItem(KKEY, k);
    } catch { /* ignore */ }
  }

  /* ---------- database ---------- */
  const DB = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('fieldsurvey', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('surveys', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('surveys', mode); let out;
        const rq = fn(t.objectStore('surveys'));
        if (rq) rq.onsuccess = () => (out = rq.result);
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    };
    return {
      all: () => tx('readonly', (s) => s.getAll()), get: (id) => tx('readonly', (s) => s.get(id)),
      put: (r) => tx('readwrite', (s) => s.put(r)), del: (id) => tx('readwrite', (s) => s.delete(id)), clear: () => tx('readwrite', (s) => s.clear()),
    };
  })();

  /* ---------- navigation ---------- */
  const TITLES = { survey: 'Field Survey', history: 'Survey History', guide: 'California Style Guide', settings: 'Settings', result: 'Analysis' };
  const state = { tab: 'survey', staged: [], gps: null, current: null, records: [], filter: null, selecting: false, selected: new Set(), abort: null, histQuery: '', deferredInstall: null };
  const nav = { stack: [] };
  function showView(name) {
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
    $('#screenTitle').textContent = TITLES[name] || 'Field Survey';
    window.scrollTo(0, 0);
  }
  function showTab(tab) {
    clearOverlays();
    state.tab = tab;
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    showView(tab);
    if (tab === 'history') renderHistory();
    if (tab === 'guide') renderGuide();
    if (tab === 'settings') renderSettings();
    if (tab === 'survey') updateBanner();
  }
  function pushOverlay(type, closeFn) { nav.stack.push({ type, closeFn }); history.pushState({ o: nav.stack.length }, ''); }
  function closeTop() { if (nav.stack.length) history.back(); }
  function clearOverlays() {
    const n = nav.stack.length; if (!n) return;
    nav.stack.splice(0).reverse().forEach((i) => i.closeFn());
    history.go(-n);
  }
  window.addEventListener('popstate', () => { const top = nav.stack.pop(); if (top) top.closeFn(); });

  /* ---------- images ---------- */
  async function processImage(blob, maxDim) {
    let bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
    }
    const w = bmp.width || bmp.naturalWidth, hgt = bmp.height || bmp.naturalHeight;
    const draw = (max, q) => {
      const s = Math.min(1, max / Math.max(w, hgt)); const c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(hgt * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return canvasBlob(c, q).then((b) => ({ b, c }));
    };
    const full = await draw(maxDim, 0.85);
    const th = await draw(260, 0.7);
    const thumb = await blobToDataURL(th.b);
    if (bmp.close) bmp.close();
    return { blob: full.b, thumb };
  }
  async function stageFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!list.length) return toast('That file is not an image.');
    for (const f of list) {
      if (state.staged.length >= MAX_PHOTOS) { toast(`Limit is ${MAX_PHOTOS} photos per survey.`); break; }
      try {
        const p = await processImage(f, settings.size);
        state.staged.push({ ...p, url: URL.createObjectURL(p.blob) });
      } catch { toast('Could not read one of the images (unsupported format).'); }
    }
    renderStage(); maybeGps();
  }
  function renderStage() {
    const st = $('#stage'); st.replaceChildren(...state.staged.map((p, i) => h('div', { class: 'thumb' },
      h('img', { src: p.url, alt: `Photo ${i + 1}` }),
      h('button', { 'aria-label': `Remove photo ${i + 1}`, onclick: () => { URL.revokeObjectURL(p.url); state.staged.splice(i, 1); renderStage(); } }, '×'))));
    $('#stageCount').textContent = `${state.staged.length} / ${MAX_PHOTOS}`;
    $('#btnAnalyze').disabled = state.staged.length === 0;
    $('#btnClearStage').hidden = state.staged.length === 0;
    $('#stageHint').hidden = state.staged.length > 0;
  }
  function maybeGps() {
    if (!$('#fGps').checked || state.gps || !state.staged.length || !navigator.geolocation) return;
    const s = $('#gpsStatus'); s.hidden = false; s.textContent = 'Getting location...';
    navigator.geolocation.getCurrentPosition(
      (p) => { state.gps = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }; s.textContent = `Location tagged (${state.gps.lat}, ${state.gps.lng}, ±${state.gps.acc} m)`; },
      () => { s.textContent = 'Location unavailable. Continuing without GPS.'; }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
  }

  /* ---------- camera ---------- */
  const cam = { stream: null, facing: 'environment' };
  async function openCamera(fromGesture = true) {
    if (state.staged.length >= MAX_PHOTOS) return toast(`Limit is ${MAX_PHOTOS} photos per survey.`);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fromGesture ? $('#fileNative').click() : null;
    $('#camera').hidden = false; $('#camGrid').classList.toggle('off', !settings.grid);
    $('#camCount').textContent = `${state.staged.length} / ${MAX_PHOTOS}`;
    pushOverlay('camera', stopCamera);
    try { await startStream(); }
    catch {
      closeTop();
      if (fromGesture) { toast('In-app camera unavailable. Opening the system camera.'); $('#fileNative').click(); }
      else toast('Camera permission was not granted. Tap Take photos to try again.');
    }
  }
  async function startStream() {
    stopStream();
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    const v = $('#camVideo'); v.srcObject = cam.stream; await v.play().catch(() => {});
  }
  function stopStream() { if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop()); cam.stream = null; $('#camVideo').srcObject = null; }
  function stopCamera() { stopStream(); $('#camera').hidden = true; }
  async function shoot() {
    const v = $('#camVideo'); if (!v.videoWidth) return;
    if (state.staged.length >= MAX_PHOTOS) return toast(`Limit is ${MAX_PHOTOS} photos.`);
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const b = await canvasBlob(c, 0.95);
    if (navigator.vibrate) navigator.vibrate(25);
    $('#camVideo').style.opacity = '.35'; setTimeout(() => ($('#camVideo').style.opacity = ''), 90);
    await stageFiles([new File([b], 'capture.jpg', { type: 'image/jpeg' })]);
    $('#camCount').textContent = `${state.staged.length} / ${MAX_PHOTOS}`;
    if (state.staged.length >= MAX_PHOTOS) closeTop();
  }

  /* ---------- Gemini ---------- */
  const SHAPE = `{
 "subject":{"title":"short descriptive name for this site","building_type":"e.g. single-family house, theater, civic building","stories":"number or description","visible_elevations":"what the photos show"},
 "photo_quality":{"usable":true,"issues":["blur, glare, occlusion, partial view"],"suggested_additional_photos":["specific shots that would raise certainty"]},
 "primary_style":{"name":"","reference_id":"id from the reference list, or null","confidence":0,"reasoning":"2-4 sentences citing visible evidence"},
 "alternate_styles":[{"name":"","reference_id":null,"confidence":0,"why":""}],
 "era":{"estimated_range":"e.g. 1925-1940","confidence":0,"dating_clues":[""]},
 "features":[{"feature":"","category":"roof|wall|opening|ornament|structure|site|signage","observed_in":"Photo N and where","supports_style":""}],
 "reference_checklist":[{"reference_feature":"one key feature of the matched reference entry","status":"present|partial|absent|not_visible","note":""}],
 "materials":[{"material":"","where":"","notes":""}],
 "architects":[{"name":"","source":"reference_list|inferred","certainty":"low|medium|high","reasoning":""}],
 "condition":{"overall":"good|fair|poor|unknown","summary":"","issues":[{"issue":"","severity":"minor|moderate|serious","location":"","recommendation":""}]},
 "alterations":[{"observation":"","likely_period":""}],
 "california_considerations":{"seismic":[""],"fire_and_climate":[""],"regulatory":[""]},
 "significance":{"landmark_potential":"low|moderate|high|unknown","integrity":"high|medium|low|unknown","notes":""},
 "similar_examples":[{"name":"","place":""}],
 "field_checks":["things to verify on site or in records"],
 "caveats":[""]
}`;
  const DEPTH = {
    quick: 'DEPTH: quick. Keep every text field to one short sentence. At most 5 features, 4 checklist items, 2 alternates, 3 issues, 3 architects, 2 similar examples.',
    standard: 'DEPTH: standard. Concise but specific. Roughly 6-10 features, 6-8 checklist items, up to 3 alternates, up to 5 issues, up to 5 architects, up to 4 similar examples.',
    detailed: 'DEPTH: detailed. Be thorough: 10-16 features, a checklist covering every key feature of the matched entry, up to 4 alternates, all visible issues, up to 8 architects, up to 6 similar examples, and substantive regulatory and seismic notes.',
  };
  let refTextCache;
  const refText = () => refTextCache || (refTextCache = REF.map((r) => `[${r.id}] ${r.name} | Features: ${r.features} | Period: ${firstSentence(r.history)} | Architects: ${r.architects.join('; ')}`).join('\n'));
  const SYSTEM = `You are an expert architectural historian and field surveyor specializing in California buildings, trained in the practice of historic-resource recording (style, period, character-defining features, materials, integrity, condition).
Rules:
- Ground every statement in what is visible. If something cannot be seen, mark it not_visible or omit it. Never invent details.
- Calibrate confidence honestly (0-100). Mixed or altered buildings deserve lower confidence and alternates.
- A curated REFERENCE LIST of California styles is provided. Prefer matching the building to an entry and return its id in reference_id. If nothing fits well, say so, give the best general style name, and set reference_id to null. The building may be outside California; analyze it anyway.
- reference_checklist must test the matched entry's Key Features one by one against the photos.
- Architect attribution cannot be established from photographs alone. Offer candidates labeled "reference_list" when taken from the matched entry's list, or "inferred" when from your own knowledge, with certainty "low" unless a distinctive signature element is plainly visible. The reference list may contain imperfect attributions; use your own knowledge and flag doubt in reasoning.
- Condition notes are visual observations to be verified by qualified professionals. Do not issue structural safety verdicts or legal determinations. California considerations may cover seismic vulnerability patterns (unreinforced masonry, soft-story, unbraced chimneys, parapets, cripple walls), wildfire and climate exposure, and regulatory context such as the California Register of Historical Resources and the CEQA historic review threshold, framed as things to check.
- User-supplied context is unverified; use it as a hint, and say when the photos contradict it.
- Respond with a single JSON object only, no markdown, matching the requested shape exactly.`;

  function buildParts(rec) {
    const ctx = [];
    if (rec.context) ctx.push(`User context (unverified): ${rec.context}`);
    if (rec.gps) ctx.push(`GPS: ${rec.gps.lat}, ${rec.gps.lng} (accuracy ${rec.gps.acc} m)`);
    const intro = `Analyze the structure shown in the ${rec.images.length} attached photo(s).\n${ctx.join('\n')}\n\n${DEPTH[rec.depth] || DEPTH.standard}\n\nREFERENCE LIST (id, name, features, period, architects):\n${refText()}\n\nReturn JSON in exactly this shape (replace the placeholder values; arrays may be empty):\n${SHAPE}`;
    return [{ text: intro }];
  }
  async function callGemini(rec, signal) {
    const key = getKey(); if (!key) throw userError('Add your Gemini API key in Settings first.', 'settings');
    const parts = buildParts(rec);
    for (let i = 0; i < rec.images.length; i++) {
      parts.push({ text: `Photo ${i + 1}:` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: (await blobToDataURL(rec.images[i].blob)).split(',')[1] } });
    }
    const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 16384 } };
    let resp;
    try {
      resp = await fetch(`${API}/models/${encodeURIComponent(rec.model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw userError('Analysis cancelled.');
      throw userError(navigator.onLine ? 'Could not reach Google. Check your connection and try again.' : 'You are offline. Analysis needs a connection; your photos are kept.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw mapHttp(resp.status, data, rec.model);
    if (data.promptFeedback && data.promptFeedback.blockReason) throw userError(`Gemini declined the request (${data.promptFeedback.blockReason}). Try different photos.`);
    const cand = arr(data.candidates)[0];
    const text = arr(cand && cand.content && cand.content.parts).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
    if (!text) throw userError(`Gemini returned no content${cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''}. Try again or use fewer photos.`);
    const parsed = parseJson(text);
    if (!parsed) throw userError('Gemini replied in an unreadable format. Tap Analyze again.');
    return { result: normalize(parsed), truncated: cand && cand.finishReason === 'MAX_TOKENS' };
  }
  function userError(message, goto) { const e = new Error(message); e.user = true; e.goto = goto; return e; }
  function mapHttp(status, data, model) {
    const m = (data && data.error && data.error.message) || '';
    if (status === 400 && /API key/i.test(m)) return userError('Google rejected the API key. Check it in Settings.', 'settings');
    if (status === 401 || status === 403) return userError('The key was not accepted for this request (permission or restriction). ' + m.slice(0, 140), 'settings');
    if (status === 404) return userError(`Model "${model}" was not found for your key. Open Settings and tap "Load models available to my key".`, 'settings');
    if (status === 429) return userError('Rate limit or quota reached. Wait a minute, try a smaller photo set, or check your plan in Google AI Studio.');
    if (status === 413) return userError('The photos are too large. Use fewer photos or a smaller photo size in Settings.');
    if (status >= 500) return userError('Google had a temporary problem. Try again shortly.');
    return userError(`Request failed (${status}). ${m.slice(0, 160)}`);
  }
  function parseJson(t) {
    t = t.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(t); } catch { /* try slice */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fail */ } }
    return null;
  }
  function normalize(r) {
    const o = r && typeof r === 'object' ? r : {};
    const ps = o.primary_style || {};
    return {
      subject: o.subject || {}, photo_quality: { usable: o.photo_quality ? o.photo_quality.usable !== false : true, issues: arr(o.photo_quality && o.photo_quality.issues), suggested_additional_photos: arr(o.photo_quality && o.photo_quality.suggested_additional_photos) },
      primary_style: { name: str(ps.name) || 'Unclassified', reference_id: REF_BY_ID[ps.reference_id] ? ps.reference_id : null, confidence: clamp(ps.confidence, 0, 100), reasoning: str(ps.reasoning) },
      alternate_styles: arr(o.alternate_styles).map((a) => ({ name: str(a.name), reference_id: REF_BY_ID[a.reference_id] ? a.reference_id : null, confidence: clamp(a.confidence, 0, 100), why: str(a.why) })),
      era: { estimated_range: str(o.era && o.era.estimated_range), confidence: clamp(o.era && o.era.confidence, 0, 100), dating_clues: arr(o.era && o.era.dating_clues) },
      features: arr(o.features), reference_checklist: arr(o.reference_checklist), materials: arr(o.materials), architects: arr(o.architects),
      condition: { overall: str(o.condition && o.condition.overall) || 'unknown', summary: str(o.condition && o.condition.summary), issues: arr(o.condition && o.condition.issues) },
      alterations: arr(o.alterations),
      california_considerations: { seismic: arr(o.california_considerations && o.california_considerations.seismic), fire_and_climate: arr(o.california_considerations && o.california_considerations.fire_and_climate), regulatory: arr(o.california_considerations && o.california_considerations.regulatory) },
      significance: o.significance || {}, similar_examples: arr(o.similar_examples), field_checks: arr(o.field_checks), caveats: arr(o.caveats),
    };
  }

  /* ---------- analyze flow ---------- */
  function setBusy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; }
  async function runAnalysis(rec, isRerun) {
    if (!getKey()) { toast('Add your Gemini API key first.'); showTab('settings'); return; }
    state.abort = new AbortController();
    const timer = setTimeout(() => state.abort.abort(), 170000);
    setBusy(true, `Analyzing ${rec.images.length} photo${rec.images.length > 1 ? 's' : ''} with ${rec.model}`);
    try {
      const { result, truncated } = await callGemini(rec, state.abort.signal);
      rec.result = result; rec.updatedAt = Date.now(); rec.truncated = !!truncated;
      if (!rec.title) rec.title = str(result.subject.title) || result.primary_style.name;
      await DB.put(rec);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      if (isRerun) { renderResult(rec); toast('Analysis updated.'); }
      else { resetSurveyForm(); openResult(rec, true); }
      if (truncated) toast('The response was cut short. Re-analyze with Quick depth if sections look missing.');
    } catch (e) {
      if (e.user) { toast(e.message); if (e.goto === 'settings') showTab('settings'); }
      else { console.error(e); toast('Unexpected error: ' + (e.message || e)); }
    } finally { clearTimeout(timer); setBusy(false); state.abort = null; }
  }
  function resetSurveyForm() {
    state.staged.forEach((p) => URL.revokeObjectURL(p.url)); state.staged = []; state.gps = null;
    ['#fName', '#fContext'].forEach((s) => ($(s).value = '')); $('#gpsStatus').hidden = true; renderStage();
  }

  /* ---------- result view ---------- */
  function openResult(rec, replaceTab) {
    state.current = rec; renderResult(rec);
    showView('result');
    pushOverlay('result', () => { state.current = null; showView(state.tab); if (state.tab === 'history') renderHistory(); });
  }
  const sev = { minor: 'mute', moderate: 'warn', serious: 'bad' };
  const cond = { good: 'sage', fair: 'warn', poor: 'bad', unknown: 'mute' };
  function sec(title, badge, open, ...body) {
    return h('details', { class: 'sec', open: open ? '' : null }, h('summary', {}, title, badge ? h('span', { class: 'badge' }, badge) : null), h('div', { class: 'body' }, body));
  }
  const li = (head, sub, tags) => h('div', { class: 'li' }, h('div', { class: 'h' }, head, tags || null), sub ? h('div', { class: 'sub' }, sub) : null);
  const tag = (t, c) => h('span', { class: 'tag ' + (c || '') }, t);
  const bullets = (a) => a.map((t) => h('div', { class: 'li' }, str(typeof t === 'object' ? JSON.stringify(t) : t)));

  function matchScore(list) {
    const rel = list.filter((c) => ['present', 'partial', 'absent'].includes(c.status));
    if (!rel.length) return null;
    return Math.round((rel.reduce((s, c) => s + (c.status === 'present' ? 1 : c.status === 'partial' ? 0.5 : 0), 0) / rel.length) * 100);
  }
  function renderResult(rec) {
    const r = rec.result, root = $('#view-result'), ps = r.primary_style, ref = REF_BY_ID[ps.reference_id];
    let heroIdx = 0;
    const heroImg = h('img', { class: 'hero-main', alt: 'Survey photo' });
    const strip = h('div', { class: 'hero-strip' });
    const urls = rec.images.map((im) => URL.createObjectURL(im.blob));
    const setHero = (i) => { heroIdx = i; heroImg.src = urls[i]; [...strip.children].forEach((c, j) => c.classList.toggle('on', j === i)); };
    urls.forEach((u, i) => strip.append(h('img', { src: u, alt: `Photo ${i + 1}`, onclick: () => setHero(i) })));
    if (urls.length < 2) strip.hidden = true;

    const score = matchScore(r.reference_checklist);
    const titleInput = h('input', { class: 'rtitle', type: 'text', value: rec.title || '', 'aria-label': 'Survey name', maxlength: '80', style: 'font-family:var(--serif);font-size:1.35rem;font-weight:600;border:0;background:transparent;padding:4px 0;min-height:40px', onchange: async () => { rec.title = titleInput.value.trim() || ps.name; await DB.put(rec); } });
    const gpsLink = rec.gps ? h('a', { href: `https://www.google.com/maps?q=${rec.gps.lat},${rec.gps.lng}`, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent)' }, 'Map') : null;

    const refBox = ref ? h('div', { class: 'refbox' }, 'Matches reference entry: ', h('button', { onclick: () => openRefSheet(ref) }, ref.name), h('div', { style: 'margin-top:4px;color:var(--muted)' }, 'Seen at: ' + ref.where)) : h('div', { class: 'refbox' }, 'No close match in your reference list. Treat the style name as a general classification.');

    const children = [
      h('button', { class: 'back', onclick: closeTop }, '‹ Back'),
      h('div', { class: 'hero' }, heroImg, strip),
      titleInput,
      h('div', { class: 'rmeta' }, [fmtDate(rec.createdAt), ' · ', rec.model, ' · ', rec.depth, rec.gps ? ' · ' : null, gpsLink]),
      !r.photo_quality.usable ? h('div', { class: 'banner' }, h('strong', {}, 'Photo quality limits this result.'), r.photo_quality.issues.join('; ')) : null,
      h('div', { class: 'card' },
        h('div', { class: 'style-card' },
          h('div', { class: 'ring', style: `--p:${ps.confidence}`, role: 'img', 'aria-label': `Confidence ${ps.confidence} percent` }, h('i', {}, ps.confidence + '%')),
          h('div', {}, h('div', { class: 'style-name' }, ps.name), r.era.estimated_range ? tag(r.era.estimated_range, 'sage') : null, r.subject.building_type ? tag(str(r.subject.building_type), 'mute') : null, r.subject.stories ? tag(/^\d+$/.test(str(r.subject.stories).trim()) ? (str(r.subject.stories).trim() === '1' ? '1 story' : str(r.subject.stories).trim() + ' stories') : str(r.subject.stories), 'mute') : null)),
        h('p', { class: 'reason' }, ps.reasoning), refBox,
        r.alternate_styles.length ? h('h3', {}, 'Also consider') : null,
        r.alternate_styles.map((a) => h('div', { class: 'altrow', title: a.why }, h('span', {}, a.name), a.reference_id ? h('button', { class: 'link', onclick: () => openRefSheet(REF_BY_ID[a.reference_id]) }, 'guide') : null, h('span', { class: 'pct' }, a.confidence + '%')))),
      r.reference_checklist.length ? sec('Reference checklist', score == null ? null : score + '% seen', true,
        r.reference_checklist.map((c) => h('div', { class: 'ck ' + str(c.status) }, h('b', {}, { present: '✓', partial: '◐', absent: '✕' }[c.status] || '?'), h('div', {}, h('div', {}, str(c.reference_feature)), c.note ? h('div', { class: 'sub', style: 'color:var(--muted);font-size:.85rem' }, str(c.note)) : null)))) : null,
      r.features.length ? sec('Features observed', String(r.features.length), true, r.features.map((f) => li(str(f.feature), [str(f.observed_in), f.supports_style ? ' · supports ' + str(f.supports_style) : ''].join(''), f.category ? tag(str(f.category), 'mute') : null))) : null,
      r.materials.length ? sec('Materials', String(r.materials.length), false, r.materials.map((m) => li(str(m.material), [str(m.where), m.notes ? ' · ' + str(m.notes) : ''].join('')))) : null,
      (r.era.estimated_range || r.era.dating_clues.length) ? sec('Dating', r.era.estimated_range, false, h('div', { class: 'meter', title: 'Dating confidence' }, h('i', { style: `width:${r.era.confidence}%` })), h('p', { class: 'hint' }, `Dating confidence ${r.era.confidence}%`), bullets(r.era.dating_clues)) : null,
      r.architects.length ? sec('Possible architects', String(r.architects.length), false, h('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Photos alone cannot establish authorship. Verify with permits, historic surveys or local archives.'),
        r.architects.map((a) => li(str(a.name), str(a.reasoning), [tag(a.source === 'reference_list' ? 'reference list' : 'inferred', a.source === 'reference_list' ? 'sage' : 'mute'), tag(str(a.certainty) + ' certainty', a.certainty === 'high' ? 'sage' : a.certainty === 'medium' ? 'warn' : 'mute')]))) : null,
      sec('Condition', r.condition.overall, true, h('div', {}, tag(r.condition.overall, cond[r.condition.overall] || 'mute')), h('p', { class: 'reason' }, r.condition.summary),
        r.condition.issues.map((i) => li(str(i.issue), [str(i.location), i.recommendation ? ' → ' + str(i.recommendation) : ''].join(''), tag(str(i.severity), sev[i.severity] || 'mute')))),
      r.alterations.length ? sec('Likely alterations', String(r.alterations.length), false, r.alterations.map((a) => li(str(a.observation), a.likely_period ? 'Period: ' + str(a.likely_period) : ''))) : null,
      (r.california_considerations.seismic.length + r.california_considerations.fire_and_climate.length + r.california_considerations.regulatory.length) ? sec('California considerations', null, false,
        r.california_considerations.seismic.length ? h('h3', {}, 'Seismic') : null, bullets(r.california_considerations.seismic),
        r.california_considerations.fire_and_climate.length ? h('h3', {}, 'Fire and climate') : null, bullets(r.california_considerations.fire_and_climate),
        r.california_considerations.regulatory.length ? h('h3', {}, 'Regulatory and historic review') : null, bullets(r.california_considerations.regulatory)) : null,
      (r.significance.notes || r.significance.landmark_potential) ? sec('Significance and integrity', null, false, h('div', {}, tag('landmark potential: ' + str(r.significance.landmark_potential || 'unknown'), 'warn'), tag('integrity: ' + str(r.significance.integrity || 'unknown'), 'mute')), h('p', { class: 'reason' }, str(r.significance.notes))) : null,
      (r.similar_examples.length || ref) ? sec('Similar places to visit', null, false, r.similar_examples.map((s) => li(str(s.name), str(s.place))), ref ? h('p', { class: 'hint' }, 'From your reference list: ' + ref.where) : null) : null,
      (r.field_checks.length || r.photo_quality.suggested_additional_photos.length) ? sec('Next steps in the field', null, false,
        r.field_checks.length ? h('h3', {}, 'Verify') : null, bullets(r.field_checks),
        r.photo_quality.suggested_additional_photos.length ? h('h3', {}, 'Photos to add') : null, bullets(r.photo_quality.suggested_additional_photos)) : null,
      sec('Your notes', null, !!rec.notes, h('textarea', { class: 'note-area', rows: '4', placeholder: 'Observations, owner remarks, follow-ups...', value: rec.notes || '', onchange: async (e) => { rec.notes = e.target.value; await DB.put(rec); toast('Notes saved.'); } })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => shareReport(rec) }, 'Share'),
        h('button', { class: 'btn small', onclick: () => copyReport(rec) }, 'Copy'),
        h('button', { class: 'btn small', onclick: () => { $$('details.sec').forEach((d) => (d.open = true)); window.print(); } }, 'Print / PDF'),
        h('button', { class: 'btn small', onclick: () => { rec.depth = $('#fDepth').value; runAnalysis(rec, true); } }, 'Re-analyze'),
        h('button', { class: 'btn small danger', onclick: () => deleteOne(rec.id) }, 'Delete')),
      r.caveats.length ? h('p', { class: 'disclaimer' }, r.caveats.join(' ')) : null,
      h('p', { class: 'disclaimer' }, 'AI-assisted observations from photographs. Not a structural, seismic, engineering or legal historic-resource determination. Confirm findings with qualified professionals and primary records.'),
    ];
    root.replaceChildren(...children.filter(Boolean));
    setHero(0);
  }
  function reportText(rec) {
    const r = rec.result, ps = r.primary_style, L = [];
    L.push(`${rec.title || ps.name}`, `Surveyed ${fmtDate(rec.createdAt)} with ${rec.model}`);
    if (rec.gps) L.push(`Location: ${rec.gps.lat}, ${rec.gps.lng}`);
    L.push('', `STYLE: ${ps.name} (${ps.confidence}% confidence)`, ps.reasoning);
    if (r.era.estimated_range) L.push(`ERA: ${r.era.estimated_range}`);
    if (r.features.length) L.push('', 'FEATURES:', ...r.features.map((f) => `- ${f.feature} (${f.observed_in || ''})`));
    if (r.materials.length) L.push('', 'MATERIALS:', ...r.materials.map((m) => `- ${m.material}: ${m.where || ''}`));
    if (r.architects.length) L.push('', 'POSSIBLE ARCHITECTS (unverified):', ...r.architects.map((a) => `- ${a.name} [${a.source}, ${a.certainty}]`));
    L.push('', `CONDITION: ${r.condition.overall}. ${r.condition.summary}`, ...r.condition.issues.map((i) => `- [${i.severity}] ${i.issue} (${i.location || ''})`));
    if (r.field_checks.length) L.push('', 'VERIFY:', ...r.field_checks.map((t) => `- ${t}`));
    if (rec.notes) L.push('', 'NOTES:', rec.notes);
    L.push('', 'AI-assisted photographic observations; not an engineering or legal determination.');
    return L.join('\n');
  }
  async function shareReport(rec) {
    const text = reportText(rec);
    try { if (navigator.share) { await navigator.share({ title: rec.title, text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    copyReport(rec);
  }
  async function copyReport(rec) { try { await navigator.clipboard.writeText(reportText(rec)); toast('Report copied.'); } catch { toast('Copy is not available here.'); } }
  async function deleteOne(id) {
    if (!confirm('Delete this survey and its photos from this device?')) return;
    await DB.del(id); toast('Survey deleted.');
    closeTop();
  }

  /* ---------- reference sheet ---------- */
  function openRefSheet(r) {
    if (!r) return;
    const count = state.records.filter((x) => x.result && x.result.primary_style.reference_id === r.id).length;
    const kv = (k, v) => h('div', { class: 'kv' }, h('b', {}, k), h('div', {}, v));
    $('#sheetBody').replaceChildren(h('h2', {}, r.name), kv('Key features', r.features), kv('History', r.history), kv('Where to see it', r.where),
      kv('Significant architects', h('div', { style: 'margin-top:4px' }, r.architects.map((a) => tag(a)))), count ? kv('Your surveys', `${count} saved survey${count > 1 ? 's' : ''} matched to this style.`) : null);
    $('#sheet').hidden = false; pushOverlay('sheet', () => { $('#sheet').hidden = true; });
  }

  /* ---------- history ---------- */
  async function loadRecords() { state.records = (await DB.all()).sort((a, b) => b.createdAt - a.createdAt); }
  async function renderHistory() {
    await loadRecords();
    const recs = state.records, box = $('#insights');
    if (!recs.length) {
      box.replaceChildren(); $('#histChips').replaceChildren(); $('#histList').replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No surveys yet'), 'Photograph a building on the Survey tab and the analysis will be saved here.'));
      $('#selectBar').hidden = true; return;
    }
    const counts = {}; recs.forEach((x) => { const n = x.result && x.result.primary_style.name; if (n) counts[n] = (counts[n] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const poor = recs.filter((x) => x.result && ['poor'].includes(x.result.condition.overall)).length;
    box.replaceChildren(
      h('div', { class: 'insights' }, h('div', { class: 'stat' }, h('b', {}, String(recs.length)), h('span', {}, 'surveys')), h('div', { class: 'stat' }, h('b', {}, String(top.length)), h('span', {}, 'styles seen')), h('div', { class: 'stat' }, h('b', {}, String(poor)), h('span', {}, 'in poor condition'))),
      h('div', { class: 'bars' }, h('h3', {}, 'Most surveyed styles'), top.slice(0, 5).map(([n, c]) => h('div', { class: 'bar' }, h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(c / top[0][1]) * 100}%` }), h('div', { class: 'nm' }, n)), h('div', { class: 'n' }, String(c))))));
    $('#histChips').replaceChildren(h('button', { class: 'chip' + (state.filter ? '' : ' on'), onclick: () => { state.filter = null; renderHistory(); } }, 'All'), ...top.slice(0, 8).map(([n]) => h('button', { class: 'chip' + (state.filter === n ? ' on' : ''), onclick: () => { state.filter = n; renderHistory(); } }, n)));
    const q = state.histQuery.toLowerCase();
    const shown = recs.filter((x) => (!state.filter || (x.result && x.result.primary_style.name === state.filter)) && (!q || [x.title, x.notes, x.context, x.result && x.result.primary_style.name].join(' ').toLowerCase().includes(q)));
    $('#histList').replaceChildren(...(shown.length ? shown.map(histCard) : [h('div', { class: 'empty' }, 'No surveys match.')]));
    $('#selectBar').hidden = !state.selecting; $('#selCount').textContent = `${state.selected.size} selected`;
    $('#btnSelect').textContent = state.selecting ? 'Cancel' : 'Select';
  }
  function histCard(x) {
    const ps = x.result ? x.result.primary_style : { name: 'Not analyzed', confidence: 0 };
    const body = [
      state.selecting ? h('input', { class: 'sel', type: 'checkbox', checked: state.selected.has(x.id), 'aria-label': 'Select survey', onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? state.selected.add(x.id) : state.selected.delete(x.id); $('#selCount').textContent = `${state.selected.size} selected`; } }) : null,
      h('img', { src: x.images[0] ? x.images[0].thumb : '', alt: '' }),
      h('div', { class: 'meta' }, h('div', { class: 't' }, x.title || ps.name), h('div', { class: 's' }, `${ps.name} · ${ps.confidence}%`), h('div', { class: 'd' }, `${fmtDate(x.createdAt)} · ${x.images.length} photo${x.images.length > 1 ? 's' : ''}`)),
    ];
    return h('button', { class: 'hcard', onclick: (ev) => { if (state.selecting) { const cb = $('.sel', ev.currentTarget); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } } else openResult(x); } }, body);
  }
  async function bulkDelete() {
    if (!state.selected.size) return toast('Select at least one survey.');
    if (!confirm(`Delete ${state.selected.size} survey(s) and their photos from this device?`)) return;
    for (const id of state.selected) await DB.del(id);
    state.selected.clear(); state.selecting = false; toast('Deleted.'); renderHistory();
  }
  async function exportBackup() {
    await loadRecords(); if (!state.records.length) return toast('Nothing to export yet.');
    const out = [];
    for (const r of state.records) out.push({ ...r, images: await Promise.all(r.images.map(async (i) => ({ data: await blobToDataURL(i.blob), thumb: i.thumb }))) });
    const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'facade-field-survey', version: 1, exportedAt: Date.now(), surveys: out })], { type: 'application/json' }));
    const a = h('a', { href: url, download: `field-survey-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup downloaded. It contains your photos; store it carefully.');
  }
  async function importBackup(file) {
    try {
      const j = JSON.parse(await file.text()); if (j.app !== 'facade-field-survey') throw new Error('bad');
      let n = 0; for (const r of j.surveys) { r.images = await Promise.all(r.images.map(async (i) => ({ blob: await dataURLToBlob(i.data), thumb: i.thumb }))); await DB.put(r); n++; }
      toast(`Imported ${n} survey(s).`); renderHistory();
    } catch { toast('That file is not a valid backup.'); }
  }

  /* ---------- style guide ---------- */
  function renderGuide() {
    const q = $('#guideSearch').value.trim().toLowerCase();
    const list = REF.filter((r) => !q || [r.name, r.features, r.where, r.history, r.architects.join(' ')].join(' ').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    $('#guideCount').textContent = `${list.length} of ${REF.length} styles from your reference document`;
    $('#guideList').replaceChildren(...list.map((r) => h('button', { class: 'gitem', onclick: () => { loadRecords().then(() => openRefSheet(r)); } }, h('div', { class: 'n' }, r.name), h('div', { class: 'f' }, r.features))));
  }

  /* ---------- settings ---------- */
  function fillModels() {
    const sel = $('#sModel'), list = [...new Set([...(settings.models || []), settings.model])];
    sel.replaceChildren(...list.map((m) => h('option', { value: m }, m)));
    sel.value = settings.model; $('#sModelCustom').value = '';
  }
  function renderSettings() {
    $('#sKey').value = getKey(); $('#sKey').type = 'password'; $('#btnShowKey').textContent = 'Show';
    $('#sRemember').checked = settings.remember; $('#sAutoCam').checked = settings.autoCam; $('#sGrid').checked = settings.grid;
    $('#sSize').value = String(settings.size); $('#sGpsDefault').checked = settings.gpsDefault; fillModels();
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { $('#storageStatus').textContent = `Storage used on this device: ${(e.usage / 1048576).toFixed(1)} MB`; });
    const standalone = matchMedia('(display-mode: standalone)').matches;
    $('#installHint').textContent = standalone ? 'You are running the installed app.' : $('#installHint').textContent;
  }
  function setStatus(id, msg, ok) { const s = $(id); s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : ok === false ? 'err' : ''); }
  async function testKey(key) {
    const r = await fetch(`${API}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d.error && d.error.message) || `HTTP ${r.status}`); }
  }
  async function loadModels(key) {
    let tokenParam = '', found = [];
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${API}/models?pageSize=200${tokenParam}`, { headers: { 'x-goog-api-key': key } });
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d.error && d.error.message) || `HTTP ${r.status}`);
      found.push(...arr(d.models)); if (!d.nextPageToken) break; tokenParam = '&pageToken=' + encodeURIComponent(d.nextPageToken);
    }
    return found.filter((m) => arr(m.supportedGenerationMethods).includes('generateContent') && /gemini/i.test(m.name) && !/tts|live|embed|audio|transcribe|imagen|robotics|computer-use|image-generation/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, '')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  /* ---------- misc UI ---------- */
  function updateBanner() { $('#keyBanner').hidden = !!getKey(); }

  function wire() {
    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });
    $('#btnCamera').addEventListener('click', () => openCamera(true));
    $('#btnUpload').addEventListener('click', () => $('#fileUpload').click());
    $('#fileUpload').addEventListener('change', (e) => { stageFiles(e.target.files); e.target.value = ''; });
    $('#fileNative').addEventListener('change', (e) => { stageFiles(e.target.files); e.target.value = ''; });
    $('#btnClearStage').addEventListener('click', () => { state.staged.forEach((p) => URL.revokeObjectURL(p.url)); state.staged = []; renderStage(); });
    $('#fGps').checked = settings.gpsDefault; $('#fGps').addEventListener('change', () => { if ($('#fGps').checked) maybeGps(); else { state.gps = null; $('#gpsStatus').hidden = true; } });
    $('#btnAnalyze').addEventListener('click', () => {
      if (!state.staged.length) return;
      const rec = { id: uid(), createdAt: Date.now(), title: $('#fName').value.trim(), context: $('#fContext').value.trim(), notes: '', gps: $('#fGps').checked ? state.gps : null, model: settings.model, depth: $('#fDepth').value, images: state.staged.map((p) => ({ blob: p.blob, thumb: p.thumb })), result: null };
      runAnalysis(rec, false);
    });
    $('#busyCancel').addEventListener('click', () => state.abort && state.abort.abort());

    $('#camClose').addEventListener('click', closeTop); $('#camDone').addEventListener('click', closeTop);
    $('#camShutter').addEventListener('click', shoot);
    $('#camFlip').addEventListener('click', async () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; try { await startStream(); } catch { toast('Could not switch camera.'); } });
    $('#camNative').addEventListener('click', () => { closeTop(); setTimeout(() => $('#fileNative').click(), 120); });
    $('#sheetClose').addEventListener('click', closeTop);
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeTop(); });

    $('#histSearch').addEventListener('input', (e) => { state.histQuery = e.target.value; renderHistory(); });
    $('#btnSelect').addEventListener('click', () => { state.selecting = !state.selecting; state.selected.clear(); renderHistory(); });
    $('#selCancel').addEventListener('click', () => { state.selecting = false; state.selected.clear(); renderHistory(); });
    $('#selAll').addEventListener('click', () => { state.records.forEach((r) => state.selected.add(r.id)); renderHistory(); });
    $('#selDelete').addEventListener('click', bulkDelete);
    $('#btnDeleteAll').addEventListener('click', async () => { await loadRecords(); if (!state.records.length) return toast('Nothing to delete.'); if (confirm(`Delete all ${state.records.length} surveys and photos from this device? This cannot be undone.`)) { await DB.clear(); toast('All surveys deleted.'); renderHistory(); } });
    $('#btnBackup').addEventListener('click', exportBackup);
    $('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
    $('#fileRestore').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
    $('#guideSearch').addEventListener('input', renderGuide);

    $('#btnShowKey').addEventListener('click', () => { const k = $('#sKey'); const show = k.type === 'password'; k.type = show ? 'text' : 'password'; $('#btnShowKey').textContent = show ? 'Hide' : 'Show'; });
    $('#btnSaveKey').addEventListener('click', async () => {
      const k = $('#sKey').value.trim(); if (!k) return setStatus('#keyStatus', 'Paste a key first.', false);
      settings.remember = $('#sRemember').checked; saveSettings(); setStatus('#keyStatus', 'Testing key...');
      try { await testKey(k); setKey(k, settings.remember); setStatus('#keyStatus', 'Key works and is saved on this device.', true); }
      catch (e) { setStatus('#keyStatus', 'Key test failed: ' + e.message, false); }
    });
    $('#btnRemoveKey').addEventListener('click', () => { setKey('', false); $('#sKey').value = ''; setStatus('#keyStatus', 'Key removed from this device.', true); });
    $('#sRemember').addEventListener('change', () => { settings.remember = $('#sRemember').checked; saveSettings(); const k = getKey(); if (k) setKey(k, settings.remember); });
    $('#sModel').addEventListener('change', () => { settings.model = $('#sModel').value; saveSettings(); });
    $('#sModelCustom').addEventListener('change', () => { const v = $('#sModelCustom').value.trim().replace(/^models\//, ''); if (!v) return; settings.model = v; if (!settings.models.includes(v)) settings.models = [...settings.models, v]; saveSettings(); fillModels(); setStatus('#modelStatus', `Using ${v}.`, true); });
    $('#btnModels').addEventListener('click', async () => {
      const k = $('#sKey').value.trim() || getKey(); if (!k) return setStatus('#modelStatus', 'Add your API key first.', false);
      setStatus('#modelStatus', 'Asking Google...');
      try { const m = await loadModels(k); if (!m.length) throw new Error('No Gemini models returned.'); settings.models = m; if (!m.includes(settings.model)) settings.model = m.find((x) => /flash/.test(x) && !/lite/.test(x)) || m[0]; saveSettings(); fillModels(); setStatus('#modelStatus', `${m.length} models available. Using ${settings.model}.`, true); }
      catch (e) { setStatus('#modelStatus', 'Could not load models: ' + e.message, false); }
    });
    const bindPref = (id, key, conv = (x) => x) => $(id).addEventListener('change', (e) => { settings[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); saveSettings(); });
    bindPref('#sAutoCam', 'autoCam'); bindPref('#sGrid', 'grid'); bindPref('#sSize', 'size', Number); bindPref('#sGpsDefault', 'gpsDefault');

    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; $('#installBtn').hidden = false; });
    $('#installBtn').addEventListener('click', async () => { const d = state.deferredInstall; if (!d) return; d.prompt(); await d.userChoice; state.deferredInstall = null; $('#installBtn').hidden = true; });
    window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed.'); });
    $('#btnShare').addEventListener('click', async () => { const url = location.href.split('#')[0]; try { if (navigator.share) await navigator.share({ title: 'Facade Field Survey', url }); else { await navigator.clipboard.writeText(url); toast('Link copied.'); } } catch { /* cancelled */ } });
    window.addEventListener('online', () => toast('Back online.')); window.addEventListener('offline', () => toast('Offline. History still works; analysis needs a connection.'));
  }

  /* ---------- boot ---------- */
  wire(); renderStage(); showTab('survey');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (settings.autoCam && getKey()) setTimeout(() => openCamera(false), 400);
})();
