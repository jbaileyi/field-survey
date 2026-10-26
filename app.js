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
  const defaults = { model: DEFAULT_MODELS[0], models: DEFAULT_MODELS, remember: true, autoCam: false, grid: true, size: 1600, gpsDefault: false, lookup: true };
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
  const SHAPE_A = `{
 "subject":{"title":"short descriptive name for this site","building_type":"e.g. university library, single-family house, theater","stories":"number or description","visible_elevations":"what the photos show"},
 "photo_quality":{"usable":true,"issues":["blur, glare, occlusion, partial view"],"suggested_additional_photos":["specific shots that would raise certainty"]},
 "style_free_name":"your own best style name, decided BEFORE considering the reference list",
 "primary_style":{"name":"the true style name (use a list entry's exact name only when reference_fit is strong)","reference_id":"id of the closest list entry, or null","reference_fit":"strong|partial|none","confidence":0,"reasoning":"2-4 sentences citing visible evidence and, if used, the landmark record"},
 "alternate_styles":[{"name":"","reference_id":null,"confidence":0,"why":""}],
 "era":{"estimated_range":"e.g. 1925-1940","confidence":0,"dating_clues":[""]},
 "features":[{"feature":"","category":"roof|wall|opening|ornament|structure|site|signage","observed_in":"Photo N and where","supports_style":""}],
 "reference_checklist":[{"reference_feature":"one canonical feature of the chosen style","status":"present|partial|absent|not_visible","note":""}],
 "materials":[{"material":"","where":"","notes":""}],
 "architects":[{"name":"","source":"landmark_record|reference_list|inferred","certainty":"low|medium|high","reasoning":""}]
}`;
  const SHAPE_B = `{
 "condition":{"overall":"good|fair|poor|unknown","summary":"","issues":[{"issue":"","severity":"minor|moderate|serious","location":"","recommendation":""}]},
 "alterations":[{"observation":"","likely_period":""}],
 "california_considerations":{"seismic":[""],"fire_and_climate":[""],"regulatory":[""]},
 "significance":{"landmark_potential":"low|moderate|high|unknown","integrity":"high|medium|low|unknown","notes":""},
 "similar_examples":[{"name":"","place":""}],
 "field_checks":["things to verify on site or in records"],
 "caveats":[""]
}`;
  const SHAPE_L = `{"is_known_landmark":false,"name":"official building name","confidence":0,"basis":"what identified it: signage, GPS, distinctive form, user context","location":"campus or city","architects":[""],"year_built":"","documented_style":"style(s) as documented by reliable sources","influences":["named precedents or models, if documented"],"summary":"2-4 sentences of documented history","key_facts":[""],"designations":["e.g. National Register, California Historical Landmark, local landmark"],"notes":"anything you could not verify"}`;
  const DEPTH_A = {
    quick: 'DEPTH: quick. One short sentence per text field. At most 5 features, 4 checklist items, 2 alternates, 3 architects.',
    standard: 'DEPTH: standard. Concise but specific. About 6-10 features, 6-8 checklist items, up to 3 alternates, up to 5 architects.',
    detailed: 'DEPTH: detailed. Thorough: 10-14 features, a checklist covering every canonical feature of the chosen style, up to 4 alternates, up to 8 architects.',
  };
  const DEPTH_B = {
    quick: 'At most 3 issues, 2 items per California list, 2 similar examples, 3 field checks.',
    standard: 'Up to 5 issues, up to 3 items per California list, up to 4 similar examples, up to 5 field checks.',
    detailed: 'Cover every visible issue, give substantive seismic, fire and regulatory notes (up to 5 each), up to 6 similar examples and up to 8 field checks.',
  };
  let refTextCache;
  const refText = () => refTextCache || (refTextCache = REF.map((r) => `[${r.id}]${r.supplement ? ' (app supplement)' : ''} ${r.name} | Features: ${r.features} | Period: ${firstSentence(r.history)} | Architects: ${r.architects.join('; ') || 'n/a'}`).join('\n'));

  const RULES = `Ground every statement in what is visible or in a provided landmark record. If something cannot be seen, mark it not_visible or omit it. Never invent details. Calibrate confidence honestly (0-100). User-supplied context is unverified; say when photos contradict it. Respond with a single JSON object only, no markdown, matching the requested shape exactly.`;
  const SYSTEM_A = `You are an expert architectural historian and field surveyor specializing in California buildings and historic-resource recording.
${RULES}
How to classify:
1. First decide the style from visible evidence and any LANDMARK RECORD, WITHOUT looking at the reference list. Put it in style_free_name.
2. Only then compare with the REFERENCE LIST. reference_fit is "strong" only when the list entry describes the same style family and period; "partial" when it shares some traits but is a different style; "none" otherwise. A wrong match is worse than no match: never pick an entry just because it is the nearest. The list is incomplete and is not a closed set. primary_style.name must be the true style; use the entry's exact name only for a strong fit. The building may be outside California.
3. If a LANDMARK RECORD with confidence of at least 70 is provided, the documented style, architects, dates and influences take priority over generic matching unless the photos clearly contradict it (then say so and lower confidence). Architects from the record use source "landmark_record".
4. Avoid classifying by one trait. Round arches alone do not mean Mission or Spanish styles: those rely on stucco walls, clay tile roofs, curvilinear parapets and bell gables. Romanesque Revival relies on brick or stone masonry, banded or polychrome courses, corbel tables, blind arcading, and heavy round-arched portals and towers. Check material, roof, ornament and massing together.
5. reference_checklist tests canonical features of the style you chose (from the matched entry if the fit is strong or partial, otherwise from your own knowledge of that style).
6. Architect attribution from photos alone is unreliable. Without a landmark record, label candidates "reference_list" or "inferred" and keep certainty "low" unless a distinctive signature is plain. The reference list may contain imperfect attributions; flag doubt.`;
  const SYSTEM_B = `You are a historic-resource field surveyor and building-conditions observer for California buildings.
${RULES}
Condition notes are visual observations to be verified by qualified professionals; never issue structural safety verdicts or legal determinations. California considerations may cover seismic vulnerability patterns (unreinforced masonry, soft-story, unbraced chimneys, parapets, cripple walls, tower or dome connections), wildfire and climate exposure, and regulatory context such as the California Register of Historical Resources and CEQA historic review, framed as things to check. Use the landmark record, when provided, for significance and designations.`;
  const SYSTEM_L = `You identify buildings from photographs and verify facts with Google Search. Never guess or invent: if you cannot confirm a specific documented building, say so. Output a single JSON object only.`;

  const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(userError('Analysis cancelled.', null, { cancelled: true })); }, { once: true }); });
  function userError(message, goto, extra) { const e = new Error(message); e.user = true; e.goto = goto; return Object.assign(e, extra || {}); }
  function mapHttp(status, data, model) {
    const m = ((data && data.error && data.error.message) || '').slice(0, 220);
    const x = { status };
    if (status === 400 && /API key/i.test(m)) return userError('Google rejected the API key. Check it in Settings.', 'settings', x);
    if (status === 400) return userError(`Google rejected the request (400): ${m}`, null, x);
    if (status === 401 || status === 403) return userError('The key was not accepted for this request (permission or restriction). ' + m, 'settings', x);
    if (status === 404) return userError(`Model "${model}" was not found for your key. Open Settings and tap "Load models available to my key".`, 'settings', { ...x, retryable: true });
    if (status === 429) return userError('Rate limit or quota reached. Wait a minute, use Quick depth, or check your plan in Google AI Studio. ' + m, null, x);
    if (status === 413) return userError('The photos are too large. Use fewer photos or a smaller photo size in Settings.', null, x);
    if (status >= 500) return userError(`Google server error ${status} from ${model}: ${m || 'no details'}. Try another model in Settings.`, null, { ...x, retryable: true });
    return userError(`Request failed (${status}). ${m}`, null, x);
  }
  async function gen(model, parts, o) {
    const key = getKey(); if (!key) throw userError('Add your Gemini API key in Settings first.', 'settings');
    const body = { systemInstruction: { parts: [{ text: o.system }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.3, maxOutputTokens: o.maxTokens || 8192 } };
    if (o.json !== false) body.generationConfig.responseMimeType = 'application/json';
    if (o.tools) body.tools = o.tools;
    const retries = o.retries == null ? 2 : o.retries;
    for (let attempt = 0; ; attempt++) {
      let resp;
      try {
        resp = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: o.signal });
      } catch (e) {
        if (e.name === 'AbortError') throw userError('Analysis cancelled.', null, { cancelled: true });
        throw userError(navigator.onLine ? 'Could not reach Google. Check your connection and try again.' : 'You are offline. Analysis needs a connection; your photos are kept.');
      }
      if (resp.ok) return resp.json();
      const data = await resp.json().catch(() => ({}));
      const again = [429, 500, 502, 503, 504].includes(resp.status) && attempt < (resp.status === 429 ? Math.min(1, retries) : retries);
      if (again) { await sleep([2500, 6000][attempt] || 6000, o.signal); continue; }
      throw mapHttp(resp.status, data, model);
    }
  }
  function readCandidate(data) {
    const cand = arr(data.candidates)[0];
    const text = arr(cand && cand.content && cand.content.parts).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
    const sources = arr(cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks).map((c) => c.web).filter((w) => w && /^https:\/\//.test(str(w.uri))).map((w) => ({ title: str(w.title) || str(w.uri), uri: str(w.uri) }));
    return { text, finish: cand && cand.finishReason, sources, blocked: data.promptFeedback && data.promptFeedback.blockReason };
  }
  function needJson(c, label) {
    if (c.blocked) throw userError(`Gemini declined the request (${c.blocked}). Try different photos.`);
    if (!c.text) throw userError(`Gemini returned no content${c.finish ? ' (' + c.finish + ')' : ''} for ${label}. Try again or use fewer photos.`);
    const j = parseJson(c.text);
    if (!j) throw userError(`Gemini replied in an unreadable format for ${label}. Tap Analyze again.`);
    return j;
  }
  function parseJson(t) {
    t = t.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(t); } catch { /* try slice */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* repair */ } }
    return repairJson(t);
  }
  // Recovers a reply that was cut off mid-way by closing open strings and brackets.
  function repairJson(t) {
    const a = t.indexOf('{'); if (a < 0) return null; t = t.slice(a);
    for (let i = 0; i < 300; i++) {
      let inS = false, esc = false; const st = [];
      for (const ch of t) {
        if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; }
        else if (ch === '"') inS = true; else if (ch === '{') st.push('}'); else if (ch === '[') st.push(']'); else if (ch === '}' || ch === ']') st.pop();
      }
      let c = t + (inS ? '"' : ''); c = c.replace(/[,:\s]+$/, '') + st.reverse().join('');
      try { return JSON.parse(c); } catch { const k = t.lastIndexOf(','); if (k <= 0) return null; t = t.slice(0, k); }
    }
    return null;
  }
  async function imageParts(images, n) {
    const out = [];
    for (let i = 0; i < Math.min(images.length, n); i++) {
      out.push({ text: `Photo ${i + 1}:` });
      out.push({ inlineData: { mimeType: 'image/jpeg', data: (await blobToDataURL(images[i].blob)).split(',')[1] } });
    }
    return out;
  }
  const siteContext = (rec) => {
    const c = [];
    if (rec.title) c.push(`Site name given by user: ${rec.title}`);
    if (rec.context) c.push(`User context (unverified): ${rec.context}`);
    if (rec.gps) c.push(`GPS: ${rec.gps.lat}, ${rec.gps.lng} (accuracy ${rec.gps.acc} m)`);
    return c.join('\n');
  };
  function normLandmark(l) {
    if (!l || typeof l !== 'object') return null;
    return { is_known_landmark: l.is_known_landmark === true, name: str(l.name), confidence: clamp(l.confidence, 0, 100), basis: str(l.basis), location: str(l.location), architects: arr(l.architects).map(str), year_built: str(l.year_built), documented_style: str(l.documented_style), influences: arr(l.influences).map(str), summary: str(l.summary), key_facts: arr(l.key_facts).map(str), designations: arr(l.designations).map(str), notes: str(l.notes) };
  }
  const landmarkBlock = (lm) => lm && lm.is_known_landmark && lm.confidence >= 50
    ? `LANDMARK RECORD (identified via web search, confidence ${lm.confidence}%; verify against the photos):\n${JSON.stringify({ name: lm.name, location: lm.location, architects: lm.architects, year_built: lm.year_built, documented_style: lm.documented_style, influences: lm.influences, summary: lm.summary, key_facts: lm.key_facts, designations: lm.designations })}`
    : 'LANDMARK RECORD: none. A lookup did not confirm a specific documented building, so classify from visible evidence alone.';

  async function runPipeline(rec, signal, progress) {
    let landmark = null, sources = [], notice = '';
    if (rec.lookup) {
      progress('Checking whether this is a known landmark');
      try {
        const parts = [{ text: `Identify the building in these photos and gather its documented history.\n${siteContext(rec) || 'No extra context was given.'}\n\nSteps: (1) Decide whether this is a specific, documented building (campus building, civic landmark, church, theater, etc.). Use distinctive form, signage, inscriptions, the GPS position and the user's context; a GPS fix near a known building is strong evidence but the photos must also fit. (2) If so, use Google Search to confirm and collect official name, architect(s), completion years, documented style(s) and influences, notable features, history and designations. (3) If you cannot confirm, set is_known_landmark to false and say what is missing.\n\nReturn ONLY a JSON object in this shape:\n${SHAPE_L}` }, ...(await imageParts(rec.images, 3))];
        const data = await gen(rec.model, parts, { system: SYSTEM_L, tools: [{ googleSearch: {} }], json: false, maxTokens: 4096, retries: 1, signal });
        const c = readCandidate(data); sources = c.sources;
        const j = c.text ? parseJson(c.text) : null; landmark = normLandmark(j);
        if (!landmark) notice = 'Landmark lookup returned nothing usable; style is based on the photos only.';
      } catch (e) {
        if (e.cancelled) throw e;
        notice = 'Landmark lookup was unavailable (' + e.message.slice(0, 120) + '). Style is based on the photos only.';
      }
    }
    progress(rec.depth === 'quick' ? 'Analyzing the photos' : 'Analyzing style and condition');
    const imgs = await imageParts(rec.images, MAX_PHOTOS), lmText = landmarkBlock(landmark), ctx = siteContext(rec);
    const n = rec.images.length;
    const introA = (shape, depth) => ({ text: `Analyze the structure shown in the ${n} attached photo(s).\n${ctx}\n\n${lmText}\n\n${depth}\n\nREFERENCE LIST (id, name, features, period, architects). Not exhaustive:\n${refText()}\n\nReturn JSON in exactly this shape (replace placeholder values; arrays may be empty):\n${shape}` });
    const introB = (depth) => ({ text: `Assess the condition and context of the structure shown in the ${n} attached photo(s).\n${ctx}\n\n${lmText}\n\n${depth}\n\nReturn JSON in exactly this shape (replace placeholder values; arrays may be empty):\n${SHAPE_B}` });
    let A, B = {}, truncated = false;
    if (rec.depth === 'quick') {
      const shape = `Two parts merged into ONE object. Part 1 keys:\n${SHAPE_A}\nPart 2 keys (same top-level object):\n${SHAPE_B}`;
      const c = readCandidate(await gen(rec.model, [introA(shape, DEPTH_A.quick + ' ' + DEPTH_B.quick), ...imgs], { system: SYSTEM_A, maxTokens: 8192, signal }));
      A = needJson(c, 'the analysis'); B = A; truncated = c.finish === 'MAX_TOKENS';
    } else {
      const [ra, rb] = await Promise.allSettled([
        gen(rec.model, [introA(SHAPE_A, DEPTH_A[rec.depth] || DEPTH_A.standard), ...imgs], { system: SYSTEM_A, maxTokens: 8192, signal }),
        gen(rec.model, [introB(DEPTH_B[rec.depth] || DEPTH_B.standard), ...imgs], { system: SYSTEM_B, maxTokens: 6144, signal }),
      ]);
      if (ra.status === 'rejected') throw ra.reason;
      const ca = readCandidate(ra.value); A = needJson(ca, 'the style analysis'); truncated = ca.finish === 'MAX_TOKENS';
      if (rb.status === 'fulfilled') { const cb = readCandidate(rb.value); const j = cb.text ? parseJson(cb.text) : null; if (j) { B = j; truncated = truncated || cb.finish === 'MAX_TOKENS'; } else notice += ' Condition and California notes came back unreadable. Tap Re-analyze to retry.'; }
      else { if (rb.reason && rb.reason.cancelled) throw rb.reason; notice += ' Condition and California notes could not be generated (' + String(rb.reason.message).slice(0, 100) + '). Tap Re-analyze to retry.'; }
    }
    const result = normalize({ ...A, ...B });
    result.landmark = landmark; result.sources = sources; result.notice = notice.trim();
    return { result, truncated };
  }
  function normalize(r) {
    const o = r && typeof r === 'object' ? r : {};
    const ps = o.primary_style || {};
    return {
      subject: o.subject || {}, photo_quality: { usable: o.photo_quality ? o.photo_quality.usable !== false : true, issues: arr(o.photo_quality && o.photo_quality.issues), suggested_additional_photos: arr(o.photo_quality && o.photo_quality.suggested_additional_photos) },
      style_free_name: str(o.style_free_name),
      primary_style: { name: str(ps.name) || 'Unclassified', reference_id: REF_BY_ID[ps.reference_id] ? ps.reference_id : null, reference_fit: ['strong', 'partial', 'none'].includes(ps.reference_fit) ? ps.reference_fit : (REF_BY_ID[ps.reference_id] ? 'partial' : 'none'), confidence: clamp(ps.confidence, 0, 100), reasoning: str(ps.reasoning) },
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
  function pickFallback(cur) {
    const list = (settings.models || []).filter((m) => m !== cur && !/tts|live|embed|audio/i.test(m));
    return list.find((m) => /flash/.test(m) && !/lite|preview/.test(m)) || list.find((m) => /flash/.test(m)) || list[0] || null;
  }
  async function runAnalysis(rec, isRerun) {
    if (!getKey()) { toast('Add your Gemini API key first.'); showTab('settings'); return; }
    state.abort = new AbortController();
    const timer = setTimeout(() => state.abort.abort(), 300000);
    setBusy(true, 'Starting');
    const progress = (t) => setBusy(true, `${t} (${rec.model})`);
    let triedFallback = false;
    try {
      let out;
      for (;;) {
        try { out = await runPipeline(rec, state.abort.signal, progress); break; }
        catch (e) {
          if (e.retryable && !triedFallback) { const fb = pickFallback(rec.model); if (fb) { triedFallback = true; toast(`${rec.model} is failing. Trying ${fb}.`); rec.model = fb; continue; } }
          throw e;
        }
      }
      rec.result = out.result; rec.updatedAt = Date.now(); rec.truncated = !!out.truncated;
      if (!rec.title) rec.title = (out.result.landmark && out.result.landmark.is_known_landmark && out.result.landmark.confidence >= 60 && out.result.landmark.name) || str(out.result.subject.title) || out.result.primary_style.name;
      await DB.put(rec);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      if (isRerun) { renderResult(rec); toast('Analysis updated.'); }
      else { resetSurveyForm(); openResult(rec, true); }
    } catch (e) {
      if (e.cancelled) toast('Analysis cancelled.');
      else if (e.user) { toast(e.message); if (e.goto === 'settings') showTab('settings'); }
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

    const refBox = ref ? h('div', { class: 'refbox' }, ps.reference_fit === 'strong' ? 'Matches reference entry: ' : 'Closest reference entry (partial fit, style identified independently): ', h('button', { onclick: () => openRefSheet(ref) }, ref.name), h('div', { style: 'margin-top:4px;color:var(--muted)' }, 'Seen at: ' + ref.where)) : h('div', { class: 'refbox' }, 'No close match in the reference list, so the style was identified independently.');

    const children = [
      h('button', { class: 'back', onclick: closeTop }, '‹ Back'),
      h('div', { class: 'hero' }, heroImg, strip),
      titleInput,
      h('div', { class: 'rmeta' }, [fmtDate(rec.createdAt), ' · ', rec.model, ' · ', rec.depth, rec.gps ? ' · ' : null, gpsLink]),
      r.notice ? h('div', { class: 'banner' }, r.notice) : null,
      landmarkCard(r),
      !r.photo_quality.usable ? h('div', { class: 'banner' }, h('strong', {}, 'Photo quality limits this result.'), r.photo_quality.issues.join('; ')) : null,
      h('div', { class: 'card' },
        h('div', { class: 'style-card' },
          h('div', { class: 'ring', style: `--p:${ps.confidence}`, role: 'img', 'aria-label': `Confidence ${ps.confidence} percent` }, h('i', {}, ps.confidence + '%')),
          h('div', {}, h('div', { class: 'style-name' }, ps.name), r.style_free_name && r.style_free_name.toLowerCase() !== ps.name.toLowerCase() ? h('div', { class: 'hint', style: 'margin:0 0 4px' }, 'Described as: ' + r.style_free_name) : null, r.era.estimated_range ? tag(r.era.estimated_range, 'sage') : null, r.subject.building_type ? tag(str(r.subject.building_type), 'mute') : null, r.subject.stories ? tag(/^\d+$/.test(str(r.subject.stories).trim()) ? (str(r.subject.stories).trim() === '1' ? '1 story' : str(r.subject.stories).trim() + ' stories') : str(r.subject.stories), 'mute') : null)),
        h('p', { class: 'reason' }, ps.reasoning), refBox,
        r.alternate_styles.length ? h('h3', {}, 'Also consider') : null,
        r.alternate_styles.map((a) => h('div', { class: 'altrow', title: a.why }, h('span', {}, a.name), a.reference_id ? h('button', { class: 'link', onclick: () => openRefSheet(REF_BY_ID[a.reference_id]) }, 'guide') : null, h('span', { class: 'pct' }, a.confidence + '%')))),
      r.reference_checklist.length ? sec('Reference checklist', score == null ? null : score + '% seen', true,
        r.reference_checklist.map((c) => h('div', { class: 'ck ' + str(c.status) }, h('b', {}, { present: '✓', partial: '◐', absent: '✕' }[c.status] || '?'), h('div', {}, h('div', {}, str(c.reference_feature)), c.note ? h('div', { class: 'sub', style: 'color:var(--muted);font-size:.85rem' }, str(c.note)) : null)))) : null,
      r.features.length ? sec('Features observed', String(r.features.length), true, r.features.map((f) => li(str(f.feature), [str(f.observed_in), f.supports_style ? ' · supports ' + str(f.supports_style) : ''].join(''), f.category ? tag(str(f.category), 'mute') : null))) : null,
      r.materials.length ? sec('Materials', String(r.materials.length), false, r.materials.map((m) => li(str(m.material), [str(m.where), m.notes ? ' · ' + str(m.notes) : ''].join('')))) : null,
      (r.era.estimated_range || r.era.dating_clues.length) ? sec('Dating', r.era.estimated_range, false, h('div', { class: 'meter', title: 'Dating confidence' }, h('i', { style: `width:${r.era.confidence}%` })), h('p', { class: 'hint' }, `Dating confidence ${r.era.confidence}%`), bullets(r.era.dating_clues)) : null,
      r.architects.length ? sec('Possible architects', String(r.architects.length), false, h('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Photos alone cannot establish authorship. Verify with permits, historic surveys or local archives.'),
        r.architects.map((a) => li(str(a.name), str(a.reasoning), [tag(a.source === 'landmark_record' ? 'landmark record' : a.source === 'reference_list' ? 'reference list' : 'inferred', a.source === 'landmark_record' ? 'sage' : a.source === 'reference_list' ? 'sage' : 'mute'), tag(str(a.certainty) + ' certainty', a.certainty === 'high' ? 'sage' : a.certainty === 'medium' ? 'warn' : 'mute')]))) : null,
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
        h('button', { class: 'btn small', onclick: () => openDepthSheet(rec) }, 'Re-analyze'),
        h('button', { class: 'btn small danger', onclick: () => deleteOne(rec.id) }, 'Delete')),
      r.caveats.length ? h('p', { class: 'disclaimer' }, r.caveats.join(' ')) : null,
      h('p', { class: 'disclaimer' }, 'AI-assisted observations from photographs. Not a structural, seismic, engineering or legal historic-resource determination. Confirm findings with qualified professionals and primary records.'),
    ];
    root.replaceChildren(...children.filter(Boolean));
    setHero(0);
  }
  function landmarkCard(r) {
    const lm = r.landmark; if (!lm) return null;
    if (!(lm.is_known_landmark && lm.confidence >= 50)) return h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Not matched to a documented landmark, so this classification comes from the photos alone.' + (lm.notes ? ' ' + lm.notes : ''));
    const links = arr(r.sources).slice(0, 6).map((s) => h('a', { href: s.uri, target: '_blank', rel: 'noopener noreferrer', style: 'display:block;color:var(--accent);font-size:.85rem;margin:3px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.title));
    return h('div', { class: 'card' },
      h('h2', {}, 'Identified landmark'),
      h('div', { class: 'style-name' }, lm.name), h('div', { class: 'rmeta', style: 'margin:2px 0 8px' }, [lm.location, lm.year_built ? ' · ' + lm.year_built : '', ` · ${lm.confidence}% sure`].join('')),
      lm.documented_style ? h('div', {}, tag('documented: ' + lm.documented_style, 'sage')) : null,
      lm.architects.length ? h('div', {}, lm.architects.map((a) => tag(a))) : null,
      lm.summary ? h('p', { class: 'reason' }, lm.summary) : null,
      lm.influences.length ? h('p', { class: 'hint' }, 'Influences: ' + lm.influences.join('; ')) : null,
      lm.key_facts.map((f) => h('div', { class: 'li' }, f)),
      lm.designations.length ? h('div', { style: 'margin-top:8px' }, lm.designations.map((d) => tag(d, 'warn'))) : null,
      lm.basis ? h('p', { class: 'hint' }, 'Identified by: ' + lm.basis) : null,
      lm.notes ? h('p', { class: 'hint' }, 'Not verified: ' + lm.notes) : null,
      links.length ? h('div', { style: 'margin-top:8px' }, h('div', { class: 'hint', style: 'margin:0 0 2px' }, 'Sources (Google Search)'), links) : null,
      h('p', { class: 'hint' }, 'History comes from web search through Gemini. Check the sources before citing it.'));
  }
  function openDepthSheet(rec) {
    const go = (d) => { closeTop(); setTimeout(() => { rec.depth = d; runAnalysis(rec, true); }, 60); };
    $('#sheetBody').replaceChildren(h('h2', {}, 'Re-analyze'), h('p', { class: 'hint' }, 'Runs the analysis again on the saved photos and replaces the result. Your notes are kept.'),
      h('div', { class: 'actions', style: 'flex-direction:column' }, h('button', { class: 'btn', onclick: () => go('quick') }, 'Quick'), h('button', { class: 'btn', onclick: () => go('standard') }, 'Standard'), h('button', { class: 'btn primary', onclick: () => go('detailed') }, 'Detailed')),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: rec.lookup !== false, onchange: (e) => { rec.lookup = e.target.checked; } }), h('span', { class: 'knob' }), h('span', { class: 'lbl' }, 'Look up landmark history (web search)')));
    $('#sheet').hidden = false; pushOverlay('sheet', () => { $('#sheet').hidden = true; });
  }
  function reportText(rec) {
    const r = rec.result, ps = r.primary_style, L = [];
    L.push(`${rec.title || ps.name}`, `Surveyed ${fmtDate(rec.createdAt)} with ${rec.model}`);
    if (rec.gps) L.push(`Location: ${rec.gps.lat}, ${rec.gps.lng}`);
    if (r.landmark && r.landmark.is_known_landmark && r.landmark.confidence >= 50) L.push('', `LANDMARK: ${r.landmark.name} (${r.landmark.year_built || 'date n/a'})`, `Architects: ${r.landmark.architects.join(', ') || 'n/a'}`, r.landmark.summary);
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
    $('#sheetBody').replaceChildren(h('h2', {}, r.name), r.supplement ? h('p', { class: 'hint' }, 'Added by the app. Not part of your reference document.') : null, kv('Key features', r.features), kv('History', r.history), kv('Where to see it', r.where),
      r.architects.length ? kv('Significant architects', h('div', { style: 'margin-top:4px' }, r.architects.map((a) => tag(a)))) : null, count ? kv('Your surveys', `${count} saved survey${count > 1 ? 's' : ''} matched to this style.`) : null);
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
    $('#guideCount').textContent = `${list.length} of ${REF.length} styles (${REF.filter((r) => r.supplement).length} added by the app)`;
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
    $('#sSize').value = String(settings.size); $('#sGpsDefault').checked = settings.gpsDefault; $('#sLookup').checked = settings.lookup !== false; fillModels();
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
    $('#fLookup').checked = settings.lookup !== false; $('#fLookup').addEventListener('change', () => { settings.lookup = $('#fLookup').checked; saveSettings(); });
    $('#fGps').checked = settings.gpsDefault; $('#fGps').addEventListener('change', () => { if ($('#fGps').checked) maybeGps(); else { state.gps = null; $('#gpsStatus').hidden = true; } });
    $('#btnAnalyze').addEventListener('click', () => {
      if (!state.staged.length) return;
      const rec = { id: uid(), createdAt: Date.now(), title: $('#fName').value.trim(), context: $('#fContext').value.trim(), notes: '', gps: $('#fGps').checked ? state.gps : null, model: settings.model, depth: $('#fDepth').value, lookup: $('#fLookup').checked, images: state.staged.map((p) => ({ blob: p.blob, thumb: p.thumb })), result: null };
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
    bindPref('#sAutoCam', 'autoCam'); bindPref('#sGrid', 'grid'); bindPref('#sSize', 'size', Number); bindPref('#sGpsDefault', 'gpsDefault'); bindPref('#sLookup', 'lookup');

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
