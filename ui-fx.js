// ui-fx.js — camada visual (não mexe na lógica do app).
//  • indicador deslizante das abas + transição entre abas (View Transitions)
//  • cor da plataforma (--ph) e cor da marca (--h)
//  • brilho "spotlight" nos cards
//  • Config → Aparência (salva em localStorage: só preferência visual)
//  • progresso na barra de tarefas do Windows (via electronAPI.setTaskbarProgress, se existir)
(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage: só não lembra */ } },
  };

  /* ── Preferências ─────────────────────────────────────────────── */
  const DEFAULT_H = 300;
  const prefs = {
    hue:    Number(store.get('gdl.hue', DEFAULT_H)) || DEFAULT_H,
    plat:   store.get('gdl.plat', '1') !== '0',
    reduce: store.get('gdl.reduce', '0') === '1',
    bg:     store.get('gdl.bg', '1') !== '0',
  };
  const prefersReduced = () => prefs.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Matiz: caminha sempre pelo caminho mais curto (sem "volta ao arco-íris") ── */
  const PLAT_HUE = {
    youtube: 25, 'youtube-playlist': 25, spotify: 150, tiktok: 355, instagram: 8, twitter: 245,
    facebook: 255, twitch: 295, soundcloud: 45, vimeo: 215, reddit: 38, dailymotion: 262,
  };
  let cur = prefs.hue;       // valor acumulado (pode passar de 360 — oklch aceita)
  let platHue = null;
  let onDownloadTab = true;   // a cor da plataforma só tinge a aba Download (é onde o link vive)
  function applyHue() {
    const target = prefs.plat && platHue != null && onDownloadTab ? platHue : prefs.hue;
    const delta = ((target - cur + 540) % 360) - 180;
    cur += delta;
    root.style.setProperty('--ph', String(cur));
  }
  function setBrand(h) {
    prefs.hue = h; store.set('gdl.hue', h);
    root.style.setProperty('--h', String(h));
    applyHue();
  }
  root.style.setProperty('--h', String(prefs.hue));
  root.style.setProperty('--ph', String(prefs.hue));

  const urlInput = $('#url-input');
  let lastUrl = null;
  function readPlatform() {
    if (!urlInput || urlInput.value === lastUrl) return;
    lastUrl = urlInput.value;
    let type = null;
    try { type = typeof detectSource === 'function' ? detectSource(lastUrl.trim())?.type : null; } catch { type = null; }
    const h = type ? PLAT_HUE[type] : undefined;
    const next = h == null ? null : h;
    if (next !== platHue) { platHue = next; applyHue(); }
  }
  if (urlInput) {
    urlInput.addEventListener('input', readPlatform);
    // o app também preenche o campo por código (extensão, colar e buscar): confere de leve
    setInterval(() => { if (!document.hidden) readPlatform(); }, 600);
  }

  /* ── Abas: indicador ──────────────────────────────────────────── */
  const tabs = $('.tabs');
  if (tabs) {
    const ind = document.createElement('span');
    ind.className = 'tab-ind'; ind.setAttribute('aria-hidden', 'true');
    tabs.prepend(ind);
    let first = true;
    const place = () => {
      const a = tabs.querySelector('.tab.active');
      if (!a) return;
      const isDl = a.dataset.tab === 'download';
      if (isDl !== onDownloadTab) { onDownloadTab = isDl; applyHue(); }
      if (first) ind.style.transition = 'none';
      tabs.style.setProperty('--ix', a.offsetLeft + 'px');
      tabs.style.setProperty('--iw', a.offsetWidth + 'px');
      if (!tabs.classList.contains('has-ind')) tabs.classList.add('has-ind');   // (add() repetido dispararia o MutationObserver em loop)
      if (first) { void ind.offsetWidth; ind.style.transition = ''; first = false; }
    };
    place();
    new MutationObserver(place).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(place);
      ro.observe(tabs); tabs.querySelectorAll('.tab').forEach(t => ro.observe(t));
    } else addEventListener('resize', place);
    document.fonts?.ready.then(place);

    // Transição direcional entre abas — só pra cliques reais do usuário
    // (cliques programáticos do app continuam síncronos, como antes).
    let passing = false;
    document.addEventListener('click', (e) => {
      const b = e.target.closest?.('.tab');
      if (!b || passing || !e.isTrusted || !document.startViewTransition || prefersReduced()) return;
      if (b.classList.contains('active')) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const all = [...tabs.querySelectorAll('.tab')];
      root.style.setProperty('--dir', all.indexOf(b) > all.findIndex(t => t.classList.contains('active')) ? 1 : -1);
      document.startViewTransition(() => {
        passing = true;
        try { b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } finally { passing = false; }
      });
    }, true);
  }

  /* ── Spotlight dos cards ──────────────────────────────────────── */
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ── Config → Aparência ───────────────────────────────────────── */
  const bgEl = $('#ui-bg-anim'), platEl = $('#ui-plat-tint'), redEl = $('#ui-reduce'), sw = $('#ui-swatches');
  function applyFlags() {
    root.toggleAttribute('data-reduce', prefs.reduce);
    if (prefs.bg && !prefs.reduce) root.removeAttribute('data-bg'); else root.setAttribute('data-bg', 'off');
  }
  applyFlags();
  if (platEl) { platEl.checked = prefs.plat; platEl.addEventListener('change', () => { prefs.plat = platEl.checked; store.set('gdl.plat', prefs.plat ? '1' : '0'); applyHue(); }); }
  if (bgEl)   { bgEl.checked = prefs.bg;     bgEl.addEventListener('change',   () => { prefs.bg = bgEl.checked;     store.set('gdl.bg',   prefs.bg ? '1' : '0');   applyFlags(); }); }
  if (redEl)  { redEl.checked = prefs.reduce; redEl.addEventListener('change', () => { prefs.reduce = redEl.checked; store.set('gdl.reduce', prefs.reduce ? '1' : '0'); applyFlags(); }); }
  if (sw) {
    const paint = () => sw.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.h) === prefs.hue)));
    sw.addEventListener('click', (e) => { const b = e.target.closest('.swatch'); if (b) { setBrand(Number(b.dataset.h)); paint(); } });
    paint();
  }

  /* ── Aba Download ─────────────────────────────────────────────── */
  const api = window.electronAPI || {};
  const byId = (id) => document.getElementById(id);
  const gdl = () => window.__gdl || {};   // estado do renderer.js (somente leitura)

  // Plataformas: faixa contínua; passar o mouse tinge a página, clicar mostra como é o link
  const marq = $('.marq'), track = byId('marq-track');
  if (marq && track) {
    track.querySelectorAll('.plat').forEach(b => b.style.setProperty('--pl', b.dataset.ph));
    [...track.children].forEach(n => { const c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; track.appendChild(c); });
    marq.classList.add('on');
    const idle = () => !urlInput || !urlInput.value.trim();
    track.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.plat'); if (!b || !idle()) return;
      platHue = Number(b.dataset.ph); applyHue();
    });
    track.addEventListener('pointerout', (e) => {
      if (!e.target.closest('.plat') || !idle()) return;
      platHue = null; lastUrl = null; applyHue(); readPlatform();
    });
    track.addEventListener('click', (e) => {
      const b = e.target.closest('.plat'); if (!b || !urlInput) return;
      urlInput.placeholder = b.dataset.ex;
      const note = byId('marq-note'); if (note) note.textContent = `${b.textContent.trim()}: cole um link no formato ${b.dataset.ex}`;
      urlInput.focus();
    });
  }

  // Estado vazio: some quando há busca ou resultado na tela
  const emptyEl = byId('dl-empty');
  const panels = ['loader', 'video-preview', 'playlist-preview', 'spotify-preview'].map(byId).filter(Boolean);
  const syncEmpty = () => { if (emptyEl) emptyEl.hidden = panels.some(p => !p.classList.contains('hidden')); };
  const mo = new MutationObserver(syncEmpty);
  panels.forEach(p => mo.observe(p, { attributes: true, attributeFilter: ['class'] }));
  syncEmpty();

  // Colar em qualquer lugar da janela (fora de campos de texto) preenche o link e já busca
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.closest?.('input, textarea, select, [contenteditable]'))) return;
    const pane = byId('tab-download');
    if (!pane || pane.classList.contains('hidden') || !urlInput) return;
    const text = ((e.clipboardData || window.clipboardData)?.getData('text') || '').trim();
    if (!/^https?:\/\/\S+$/i.test(text)) return;
    if (gdl().busy) return;   // não derruba o download em andamento
    e.preventDefault();
    urlInput.value = text; urlInput.dispatchEvent(new Event('input'));
    byId('btn-fetch')?.click();
  });

  // Barra "link na área de transferência" (o renderer avisa por evento quando a aba Download está aberta)
  const clipBar = byId('clip-bar'), clipUrl = byId('clip-url'), clipGo = byId('clip-go');
  if (clipBar && clipUrl && clipGo) {
    let clipOpen = null, clipTimer = 0;
    const hideClip = () => { clipBar.classList.add('hidden'); clipOpen = null; clearTimeout(clipTimer); };
    window.addEventListener('gdl-clip', (e) => {
      const d = e.detail || {};
      clipUrl.textContent = String(d.url || '').replace(/^https?:\/\/(www\.)?/i, '');
      clipUrl.title = d.url || '';
      clipOpen = d.open || null;
      clipBar.classList.remove('hidden');
      clearTimeout(clipTimer); clipTimer = setTimeout(hideClip, 45000);
    });
    clipGo.addEventListener('click', () => { const f = clipOpen; hideClip(); if (f) f(); });
    urlInput?.addEventListener('input', () => { if (urlInput.value.trim()) hideClip(); });
    byId('btn-fetch')?.addEventListener('click', hideClip);
  }

  // Qualidade: slider de degraus que comanda o <select id="quality"> (que continua sendo a fonte da verdade)
  const range = byId('quality-range'), qSel = byId('quality'), ticksEl = byId('q-ticks'), qVal = byId('q-val'), dlLabel = byId('btn-download-label'), contSel = byId('dl-container');
  const STD = [360, 480, 720, 1080, 1440, 2160];
  const hTxt = (h) => (h >= 2160 ? '4K' : h + 'p');
  const fmtsOf = () => { const f = gdl().formats; return Array.isArray(f) ? f : []; };
  const isAudio = () => !!document.querySelector('input[name="fmt"][value="audio"]:checked');
  let steps = [];

  function buildSteps() {
    if (!range || !qSel) return;
    // Um degrau pra CADA resolução que o vídeo realmente tem (144p, 240p, 360p... até a maior);
    // o último vale "Máxima" (valor 'best'). Sem a lista de formatos ainda, usa os degraus padrão.
    const hs = [...new Set(fmtsOf().map(f => f.height).filter(Boolean))].sort((a, b) => a - b);
    if (hs.length) steps = hs.map((h, i) => ({ v: i === hs.length - 1 ? 'best' : String(h), h, t: hTxt(h), best: i === hs.length - 1 }));
    else { steps = STD.filter(h => h <= 1080).map(h => ({ v: String(h), h, t: hTxt(h) })); steps.push({ v: 'best', h: Infinity, t: 'Máx', best: true }); }
    // o <select> escondido precisa ter uma opção pra cada valor (o app lê o valor dele ao baixar)
    steps.forEach(st => { if (![...qSel.options].some(o => o.value === st.v)) { const o = document.createElement('option'); o.value = st.v; o.textContent = hTxt(st.h); qSel.appendChild(o); } });
    range.max = String(steps.length - 1);
    ticksEl.replaceChildren(...steps.map(st => { const el = document.createElement('span'); el.textContent = st.t; return el; }));
    let i = steps.findIndex(st => st.v === qSel.value);
    if (i < 0) { i = steps.length - 1; qSel.value = 'best'; }
    range.value = String(i);
    paintQuality();
  }

  function estimate(step, chosen) {
    const fm = fmtsOf(); if (!fm.length) return 0;
    const f = chosen || (step.best ? fm[0] : fm.find(x => x.height <= step.h));
    if (!f || !f.size) return 0;
    return f.size + (Number(gdl().audioSize) || 0);
  }

  // Qualidade do áudio (MP3): 128 / 192 / 256 / 320 kbps
  const aqRange = byId('audio-quality-range'), aqVal = byId('aq-val'), aqGroup = byId('audio-quality-group');
  const durSecs = () => { const t = (byId('video-duration')?.textContent || '').trim(); if (!/^\d+(:\d+){1,2}$/.test(t)) return 0; return t.split(':').reduce((a, n) => a * 60 + Number(n), 0); };
  const aqK = () => Number(aqRange?.value) || 320;
  function audioInfo() { const d = durSecs(); return `${aqK()} kbps` + (d ? ` · ~${fmtBytes(aqK() * 125 * d)}` : ''); }
  function paintAq() {
    if (!aqRange) return;
    const k = aqK(), i = Math.max(0, Math.min(3, Math.round((k - 128) / 64)));
    aqRange.style.setProperty('--fill', String(i / 3 * 100));
    aqGroup.querySelectorAll('.ticks span').forEach((sp, n) => sp.classList.toggle('on', n === i));
    if (aqVal) aqVal.textContent = audioInfo();
  }
  function syncAq() { if (!aqGroup) return; aqGroup.classList.toggle('hidden', !isAudio()); paintAq(); }
  if (aqRange) {
    try { const v = Number(localStorage.getItem('gdl.abr')); if ([128, 192, 256, 320].includes(v)) aqRange.value = String(v); } catch { /* sem storage */ }
    aqRange.addEventListener('input', () => { try { localStorage.setItem('gdl.abr', aqRange.value); } catch { /* ok */ } paintAq(); paintQuality(); });
  }

  function paintQuality() {
    if (aqGroup) { paintAq(); aqGroup.classList.toggle('hidden', !isAudio()); }
    if (!range || !steps.length) return;
    const i = Math.min(Number(range.value) || 0, steps.length - 1), step = steps[i];
    range.style.setProperty('--fill', steps.length > 1 ? String(i / (steps.length - 1) * 100) : '100');
    [...ticksEl.children].forEach((el, k) => el.classList.toggle('on', k === i));
    const fm = fmtsOf(), maxH = fm.reduce((m, f) => Math.max(m, f.height || 0), 0);
    const chosenId = gdl().selectedFormatId;
    const chosen = chosenId ? fm.find(f => f.id === chosenId) : null;
    const h = chosen ? chosen.height : step.best ? (maxH || 0) : Math.min(step.h, maxH || step.h);
    const size = estimate(step, chosen);
    const head = chosen ? hTxt(chosen.height) : step.best ? (maxH ? `Máx · ${hTxt(maxH)}` : 'Máxima') : step.t;
    const sz = size ? `~${fmtBytes(size)}` : '';
    if (qVal) qVal.textContent = [head, sz].filter(Boolean).join(' · ');
    if (dlLabel) {
      dlLabel.replaceChildren();
      if (isAudio()) {
        dlLabel.append('Baixar MP3');
        const m = document.createElement('span'); m.className = 'mono'; m.textContent = ' · ' + (audioInfo() || ''); dlLabel.append(m);
        return;
      }
      dlLabel.append('Baixar ' + (contSel?.value || 'mp4').toUpperCase());
      const rest = [h ? hTxt(h) : (step.best ? 'Máx' : step.t), sz].filter(Boolean).join(' · ');
      const m = document.createElement('span'); m.className = 'mono'; m.textContent = ' · ' + rest; dlLabel.append(m);
    }
  }

  if (range && qSel) {
    buildSteps();
    range.addEventListener('input', () => {
      const s = steps[Number(range.value)]; if (!s) return;
      qSel.value = s.v; qSel.dispatchEvent(new Event('change'));   // o renderer.js descarta formato manual etc.
      paintQuality();
    });
    qSel.addEventListener('quality-sync', () => { const i = steps.findIndex(s => s.v === qSel.value); range.value = String(i < 0 ? steps.length - 1 : i); paintQuality(); });
    document.getElementsByName('fmt').forEach(r => r.addEventListener('change', paintQuality));
    const qg = byId('quality-group'); if (qg) new MutationObserver(paintQuality).observe(qg, { attributes: true, attributeFilter: ['class'] });
    const vd = byId('video-duration'); if (vd) new MutationObserver(paintQuality).observe(vd, { childList: true, characterData: true, subtree: true });
    contSel?.addEventListener('change', paintQuality);
    const rebuild = () => { buildSteps(); syncToggleRows(); };
    const bf = byId('btn-formats');
    if (bf) new MutationObserver(rebuild).observe(bf, { attributes: true, attributeFilter: ['class', 'disabled', 'title'] });
    const fl = byId('fmt-label'); if (fl) new MutationObserver(paintQuality).observe(fl, { attributes: true, attributeFilter: ['class'] });
    const vp = byId('video-preview'); if (vp) new MutationObserver(() => { if (!vp.classList.contains('hidden')) { rebuild(); loadCfg(); } }).observe(vp, { attributes: true, attributeFilter: ['class'] });
  }

  // Legendas / SponsorBlock: espelham as opções de Config (valem também para o próximo download)
  const subsEl = byId('dl-subs'), sbEl = byId('dl-sponsor');
  let cfg = {};
  function syncToggleRows() {
    const row = sbEl && sbEl.closest('.row');
    if (row) row.classList.toggle('hidden', gdl().source?.type !== 'youtube');
  }
  async function loadCfg() {
    if (!api.getSettings) return;
    try { cfg = (await api.getSettings()) || {}; } catch { return; }
    if (subsEl) subsEl.checked = (cfg.subsMode || 'off') !== 'off';
    if (sbEl) sbEl.checked = (cfg.sponsorblock || 'off') !== 'off';
  }
  async function saveCfg(patch) {
    if (!api.getSettings || !api.saveSettings) return;
    try {
      const cur = (await api.getSettings()) || {};
      await api.saveSettings({ ...cur, ...patch });
      cfg = { ...cur, ...patch };
      if (typeof loadSettingsUI === 'function') loadSettingsUI();   // mantém a aba Config igual
    } catch { /* sem salvar: o próximo download usa o que já estava */ }
  }
  subsEl?.addEventListener('change', () => saveCfg({ subsMode: subsEl.checked ? (['embed', 'file'].includes(cfg.subsMode) ? cfg.subsMode : 'embed') : 'off' }));
  sbEl?.addEventListener('change', () => saveCfg({ sponsorblock: sbEl.checked ? ((cfg.sponsorblock && cfg.sponsorblock !== 'off') ? cfg.sponsorblock : 'sponsor') : 'off' }));
  byId('btn-save-settings')?.addEventListener('click', () => setTimeout(loadCfg, 600));
  loadCfg();

  // Perfis de download: combinações prontas de formato / qualidade / contêiner / áudio (/ legendas)
  // Os padrões são fixos; os do usuário ficam em settings.downloadProfiles (mesmo settings.json do resto).
  const profEl = byId('dl-profile-chips'), profHint = byId('dl-profile-hint');
  if (profEl) {
    const DEFAULT_PROFILES = [
      { id: 'd-fhd', name: 'Full HD MP4', fmt: 'video', quality: '1080', container: 'mp4', builtin: true },
      { id: 'd-max', name: 'Máxima MKV', fmt: 'video', quality: 'best', container: 'mkv', builtin: true },
      { id: 'd-720', name: '720p leve', fmt: 'video', quality: '720', container: 'mp4', builtin: true },
      { id: 'd-mp3', name: 'MP3 320k', fmt: 'audio', abr: 320, builtin: true },
    ];
    let userProfiles = [], activeProf = null, applying = false;
    const contTxt = (c) => String(c || 'mp4').toUpperCase();
    const profSummary = (p) => {
      let t = p.fmt === 'audio' ? `MP3 · ${p.abr || 320} kbps` : `${p.quality === 'best' ? 'Máxima' : hTxt(Number(p.quality))} · ${contTxt(p.container)}`;
      if (p.subs) t += ' · legendas';
      if (p.sponsor) t += ' · sem patrocínios';
      return t;
    };
    const profUid = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const cleanProfile = (p) => {
      if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) return null;
      const out = { id: typeof p.id === 'string' && p.id ? p.id : profUid(), name: p.name.trim().slice(0, 28), fmt: p.fmt === 'audio' ? 'audio' : 'video' };
      if (out.fmt === 'audio') out.abr = [128, 192, 256, 320].includes(Number(p.abr)) ? Number(p.abr) : 320;
      else { out.quality = p.quality === 'best' || /^\d{3,4}$/.test(String(p.quality)) ? String(p.quality) : 'best'; out.container = p.container === 'mkv' ? 'mkv' : 'mp4'; }
      if (typeof p.subs === 'boolean') out.subs = p.subs;
      if (typeof p.sponsor === 'boolean') out.sponsor = p.sponsor;
      return out;
    };

    function renderProfiles() {
      const mkIcon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + id); s.appendChild(u); return s; };
      const nodes = [...DEFAULT_PROFILES, ...userProfiles].map(p => {
        const wrap = document.createElement('span'); wrap.className = 'pwrap' + (p.builtin ? '' : ' user'); wrap.dataset.id = p.id;
        if (p.id === activeProf) wrap.dataset.active = '';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pchip'; b.dataset.profile = p.id;
        b.title = profSummary(p); b.setAttribute('aria-pressed', p.id === activeProf ? 'true' : 'false');
        const sp = document.createElement('span'); sp.textContent = p.name;
        b.append(mkIcon(p.fmt === 'audio' ? 'music' : 'video'), sp);
        wrap.append(b);
        if (!p.builtin) {
          const x = document.createElement('button'); x.type = 'button'; x.className = 'pdel'; x.dataset.del = p.id;
          x.title = 'Apagar perfil'; x.setAttribute('aria-label', 'Apagar perfil ' + p.name); x.append(mkIcon('x')); wrap.append(x);
        }
        return wrap;
      });
      const add = document.createElement('button'); add.type = 'button'; add.className = 'pchip padd'; add.id = 'dl-profile-save';
      add.title = 'Guardar as opções atuais como um perfil'; add.append(mkIcon('plus'), Object.assign(document.createElement('span'), { textContent: 'Salvar atual' }));
      profEl.replaceChildren(...nodes, add);
      const act = [...DEFAULT_PROFILES, ...userProfiles].find(p => p.id === activeProf);
      if (profHint) profHint.textContent = act ? profSummary(act) : '';
    }

    async function loadProfiles() {
      if (!api.getSettings) return;
      try { const s = (await api.getSettings()) || {}; userProfiles = (Array.isArray(s.downloadProfiles) ? s.downloadProfiles : []).map(cleanProfile).filter(Boolean); } catch { return; }
      renderProfiles();
    }
    async function saveProfiles() {
      if (!api.getSettings || !api.saveSettings) return false;
      try { const cur = (await api.getSettings()) || {}; await api.saveSettings({ ...cur, downloadProfiles: userProfiles }); return true; } catch { return false; }
    }
    const say = (msg, type, dur, action) => { if (typeof showToast === 'function') showToast(msg, type || 'info', dur || 3500, action || null); };

    function applyProfile(p) {
      applying = true;
      try {
        const radio = document.querySelector(`input[name="fmt"][value="${p.fmt}"]`);
        if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
        if (p.fmt === 'audio') {
          if (aqRange && p.abr) { aqRange.value = String(p.abr); aqRange.dispatchEvent(new Event('input', { bubbles: true })); }
        } else {
          if (qSel && steps.length) {
            const target = p.quality === 'best' ? Infinity : Number(p.quality);
            // maior degrau que não passa do alvo; se o vídeo não tem tudo isso, cai pra maior que existe
            const idx = p.quality === 'best' ? steps.length - 1 : Math.max(0, steps.reduce((a, st, k) => (st.h <= target ? k : a), -1));
            qSel.value = steps[idx].v; qSel.dispatchEvent(new Event('change'));
            if (range) range.value = String(idx);
          }
          if (contSel && p.container && [...contSel.options].some(o => o.value === p.container)) { contSel.value = p.container; contSel.dispatchEvent(new Event('change')); }
        }
        if (subsEl && typeof p.subs === 'boolean' && subsEl.checked !== p.subs) { subsEl.checked = p.subs; subsEl.dispatchEvent(new Event('change')); }
        if (sbEl && typeof p.sponsor === 'boolean' && gdl().source?.type === 'youtube' && sbEl.checked !== p.sponsor) { sbEl.checked = p.sponsor; sbEl.dispatchEvent(new Event('change')); }
        paintQuality();
      } finally { applying = false; }
      activeProf = p.id; renderProfiles();
    }

    function currentProfile(name) {
      const p = { id: profUid(), name, fmt: isAudio() ? 'audio' : 'video' };
      if (p.fmt === 'audio') p.abr = aqK();
      else { p.quality = qSel?.value || 'best'; p.container = contSel?.value || 'mp4'; }
      if (p.fmt === 'video') {   // legendas/patrocínios só fazem sentido em vídeo
        if (subsEl) p.subs = !!subsEl.checked;
        if (sbEl && gdl().source?.type === 'youtube') p.sponsor = !!sbEl.checked;
      }
      return p;
    }

    async function saveCurrentProfile() {
      if (typeof askText !== 'function') return;
      const raw = await askText({ title: 'Salvar perfil', message: 'Guarda o formato, a qualidade, o contêiner e as legendas que estão marcados agora.', placeholder: 'ex: Gameplay 1080p', okLabel: 'Salvar' });
      const name = (raw || '').trim().slice(0, 28);
      if (!name) return;
      if (DEFAULT_PROFILES.some(d => d.name.toLowerCase() === name.toLowerCase())) { say('Esse nome já é de um perfil padrão — escolha outro.', 'warning'); return; }
      const p = currentProfile(name);
      const at = userProfiles.findIndex(u => u.name.toLowerCase() === name.toLowerCase());
      if (at >= 0) { p.id = userProfiles[at].id; userProfiles[at] = p; } else userProfiles.push(p);
      activeProf = p.id; renderProfiles();
      const ok = await saveProfiles();
      say(ok ? (at >= 0 ? `Perfil "${name}" atualizado.` : `Perfil "${name}" salvo.`) : 'Não consegui gravar o perfil no disco — ele vale só até fechar o app.', ok ? 'success' : 'warning', 2800);
    }

    async function deleteProfile(id) {
      const at = userProfiles.findIndex(u => u.id === id); if (at < 0) return;
      const [gone] = userProfiles.splice(at, 1);
      if (activeProf === id) activeProf = null;
      renderProfiles(); await saveProfiles();
      say(`Perfil "${gone.name}" apagado.`, 'info', 6000, { label: 'Desfazer', onClick: async () => { userProfiles.splice(Math.min(at, userProfiles.length), 0, gone); renderProfiles(); await saveProfiles(); } });
    }

    profEl.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]'); if (del) { deleteProfile(del.dataset.del); return; }
      if (e.target.closest('#dl-profile-save')) { saveCurrentProfile(); return; }
      const chip = e.target.closest('[data-profile]'); if (!chip) return;
      const p = [...DEFAULT_PROFILES, ...userProfiles].find(x => x.id === chip.dataset.profile); if (p) applyProfile(p);
    });
    // mexeu em qualquer controle à mão → o perfil marcado deixa de valer
    const drop = () => { if (!applying && activeProf) { activeProf = null; renderProfiles(); } };
    document.getElementsByName('fmt').forEach(r => r.addEventListener('change', drop));
    range?.addEventListener('input', drop); contSel?.addEventListener('change', drop); aqRange?.addEventListener('input', drop);
    subsEl?.addEventListener('change', drop); sbEl?.addEventListener('change', drop); qSel?.addEventListener('quality-sync', drop);
    const vpp = byId('video-preview'); if (vpp) new MutationObserver(() => { if (vpp.classList.contains('hidden')) drop(); }).observe(vpp, { attributes: true, attributeFilter: ['class'] });
    renderProfiles(); loadProfiles();
    byId('btn-save-settings')?.addEventListener('click', () => setTimeout(loadProfiles, 600));
  }

  // Progresso grande: porcentagem + estado (baixando / concluído / erro) a partir da barra do app
  function bindProg(barId, boxId, pctId, stateId, busyWord, textId) {
    const bar = byId(barId), box = byId(boxId), pctEl = byId(pctId), stEl = byId(stateId), txEl = textId ? byId(textId) : null;
    if (!(bar && box && pctEl && stEl)) return;
    const paint = () => {
      const st = bar.getAttribute('style') || '', w = Math.max(0, Math.min(100, parseFloat(bar.style.width) || 0)), tx = txEl ? txEl.textContent : '';
      let state = 'busy', label = w > 0 ? busyWord : 'Preparando';
      if (/Mesclando/.test(tx)) label = 'Mesclando';
      else if (/Convertendo/.test(tx) && busyWord !== 'Convertendo') label = 'Convertendo';
      if (/--danger|ef4444/.test(st)) { state = 'error'; label = /cancelad/i.test(tx) ? 'Cancelado' : 'Erro'; }
      else if (/--success/.test(st)) { state = 'done'; label = 'Concluído'; }
      if (box.dataset.state !== state) box.dataset.state = state;
      const p = String(Math.round(w)); if (pctEl.textContent !== p) pctEl.textContent = p;
      if (stEl.textContent !== label) stEl.textContent = label;
    };
    new MutationObserver(paint).observe(bar, { attributes: true, attributeFilter: ['style'] });
    if (txEl) new MutationObserver(paint).observe(txEl, { childList: true, characterData: true, subtree: true });
    paint();
  }
  bindProg('dl-bar', 'dl-status', 'dl-pct', 'dl-state', 'Baixando', 'dl-text');
  bindProg('conv-bar', 'conv-status', 'conv-pct', 'conv-state', 'Convertendo', 'conv-text');

  // Fluxo igual ao da demonstração: baixando/convertendo → só o progresso; concluído → tela de "concluído"
  function runFlow({ host, box, bar, done, doneFile, describe, openBtn, againBtn, cancelBig, cancelBtn, onAgain, onRun }) {
    if (!(host && box && bar && done)) return;
    let prev = '';
    const paint = () => {
      const st = bar.getAttribute('style') || '', hid = box.classList.contains('hidden');
      const run = hid ? '' : /--success/.test(st) ? 'done' : /--danger|ef4444/.test(st) ? '' : 'busy';
      if (run !== prev) {
        if (run) host.dataset.run = run; else delete host.dataset.run;
        if (run === 'busy') onRun && onRun('start');
        if (run === 'done' && doneFile) doneFile.textContent = describe();
        done.hidden = run !== 'done';
        prev = run;
      }
      if (run === 'busy') onRun && onRun('tick');
    };
    new MutationObserver(paint).observe(bar, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(paint).observe(box, { attributes: true, attributeFilter: ['class'] });
    cancelBig?.addEventListener('click', () => cancelBtn?.click());
    openBtn?.addEventListener('click', () => byId(openBtn.dataset.target)?.click());
    againBtn?.addEventListener('click', () => { bar.style.width = '0%'; bar.style.background = ''; box.classList.add('hidden'); onAgain && onAgain(); });
    paint();
  }
  const folderName = (p) => { const t = String(p || '').replace(/[\\/]+$/, ''); return t.split(/[\\/]/).pop() || t; };
  const dlBtnOpen = byId('dl-done-open'); if (dlBtnOpen) dlBtnOpen.dataset.target = 'btn-open-folder';
  runFlow({
    host: byId('video-preview'), box: byId('dl-status'), bar: byId('dl-bar'), done: byId('dl-done'), doneFile: byId('dl-done-file'),
    describe: () => { const d = (dlLabel?.textContent || '').replace(/^Baixar\s*/, ''); const f = typeof lastSavedFolder !== 'undefined' ? folderName(lastSavedFolder) : ''; return d + (f ? ` — salvo em ${f}` : ''); },
    openBtn: dlBtnOpen, againBtn: byId('dl-done-again'), cancelBig: byId('dl-cancel-big'), cancelBtn: byId('btn-cancel'),
    onAgain: () => {
      if (urlInput) { urlInput.value = ''; urlInput.dispatchEvent(new Event('input', { bubbles: true })); }
      try { if (typeof resetDownloadState === 'function') resetDownloadState(); if (typeof hidePreviews === 'function') hidePreviews(); } catch { /* ok */ }
      urlInput?.focus();
    },
  });

  /* ═══ Conversor ═══════════════════════════════════════════════════ */
  const convOpts = byId('conv-options');
  if (convOpts) {
    const gd = () => window.__gdl || {};
    const vcodec = byId('conv-vcodec'), acodec = byId('conv-acodec'), qSel2 = byId('conv-quality'), brSel = byId('conv-bitrate');
    const afmt = byId('conv-audioformat'), target = byId('conv-target-size'), tStart = byId('conv-trim-start'), tEnd = byId('conv-trim-end');
    const qGroup = byId('conv-quality-group'), aOpts = byId('conv-audio-opts'), sizeNote = byId('conv-size-note');
    const range = byId('conv-bitrate-range'), brVal = byId('conv-bitrate-val');
    const BR = ['128k', '192k', '256k', '320k'];

    // Qualidade (seg) <-> select escondido
    const qRadios = [...convOpts.querySelectorAll('input[name="conv-q"]')];
    qRadios.forEach(r => r.addEventListener('change', () => { if (r.checked && qSel2.value !== r.value) { qSel2.value = r.value; qSel2.dispatchEvent(new Event('change', { bubbles: true })); } }));
    const pullQ = () => qRadios.forEach(r => { r.checked = r.value === qSel2.value; });
    // Bitrate (slider) <-> select escondido
    const paintBr = () => {
      const i = Math.max(0, BR.indexOf(brSel.value)), v = BR[i];
      range.value = String(i); range.style.setProperty('--fill', String(i / 3 * 100));
      brVal.textContent = v.replace('k', ' kbps');
      range.parentNode.querySelectorAll('.ticks span').forEach((sp, k) => sp.classList.toggle('on', k === i));
    };
    range.addEventListener('input', () => { brSel.value = BR[Number(range.value)]; brSel.dispatchEvent(new Event('change', { bubbles: true })); paintBr(); });

    // Estimativa da saída (aproximada, só pra dar noção de tamanho)
    const secs = (t) => { t = (t || '').trim(); if (!t) return null; const p = t.split(':').map(Number); if (p.some(n => !isFinite(n) || n < 0) || p.length > 3) return null; return p.reduce((a, n) => a * 60 + n, 0); };
    const fmtSize = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(b >= 1.05e8 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    const EFF = { h264: 1, avc1: 1, h265: .6, hevc: .6, vp9: .65, av1: .5, mpeg4: 1.6, mpeg2video: 2.2, vp8: 1.4 };
    const estEl = byId('conv-est'), estNote = byId('conv-est-note');
    let curDur = 0, curBytes = 0;   // último cálculo (usado nos cartões do progresso)
    function estimate() {
      const info = gd().convInfo, tgt = parseFloat(target.value) || 0;
      const audio = document.querySelector('input[name="conv-kind"]:checked')?.value === 'audio';
      sizeNote.classList.toggle('hidden', !(tgt > 0));
      qGroup.classList.toggle('off', tgt > 0 || (!audio && vcodec.value === 'copy'));
      aOpts.classList.toggle('off', tgt > 0);
      let out = '—', note = 'escolha um arquivo';
      if (info && info.duration) {
        let dur = info.duration; const a = secs(tStart.value) || 0, b = secs(tEnd.value);
        dur = Math.max(1, Math.min(b != null && b > a ? b : dur, info.duration) - a);
        const frac = dur / info.duration;
        let bytes = null;
        if (tgt > 0) { bytes = tgt * 1048576; note = 'tamanho alvo'; }
        else if (audio) {
          const f = afmt.value, kbps = f === 'wav' ? 1411 : f === 'flac' ? 800 : parseInt(brSel.value, 10) || 192;
          bytes = kbps * 125 * dur; note = (f === 'wav' || f === 'flac') ? 'sem perdas · ' + f.toUpperCase() : `${kbps} kbps · ${f.toUpperCase()}`;
        } else if (info.sizeBytes) {
          const src = EFF[(info.video?.codec || '').toLowerCase()] || 1.2, dst = EFF[vcodec.value] || 1;
          const q = vcodec.value === 'copy' ? 1 : ({ high: 1.6, default: 1, low: .6 }[qSel2.value] || 1);
          bytes = vcodec.value === 'copy' ? info.sizeBytes * frac : info.sizeBytes * frac * (dst / src) * q;
          note = 'aproximado';
        }
        curDur = dur; curBytes = bytes || 0;
        if (bytes) out = '≈ ' + fmtSize(bytes);
      }
      estEl.textContent = out; estNote.textContent = note;
    }
    const syncAll = () => { pullQ(); paintBr(); estimate(); };
    convOpts.addEventListener('input', estimate); convOpts.addEventListener('change', estimate);
    document.addEventListener('gdl-sync', syncAll); document.addEventListener('gdl-conv-file', syncAll);
    // o app troca a visibilidade dos grupos por classe: reavalia quando isso muda
    new MutationObserver(estimate).observe(convOpts, { attributes: true, subtree: true, attributeFilter: ['class'] });
    syncAll();

    // Progresso da conversão: cartões (velocidade / restante / saída) e tela de "concluído"
    const cvBar = byId('conv-bar'), cvSpd = byId('conv-spd'), cvEta = byId('conv-eta'), cvOut = byId('conv-out');
    let cvT0 = 0;
    const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), r = sec % 60, z = (n) => String(n).padStart(2, '0'); return h ? `${h}:${z(m)}:${z(r)}` : `${z(m)}:${z(r)}`; };
    const setT = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
    runFlow({
      host: convOpts, box: byId('conv-status'), bar: cvBar, done: byId('conv-done'), doneFile: byId('conv-done-file'),
      describe: () => { const f = typeof lastConvFolder !== 'undefined' ? folderName(lastConvFolder) : '', o = estEl.textContent; return [byId('conv-file-name').value, o && o !== '—' ? o.replace('≈ ', '~') : ''].filter(Boolean).join(' · ') + (f ? ` — salvo em ${f}` : ''); },
      openBtn: (() => { const b = byId('conv-done-open'); if (b) b.dataset.target = 'btn-conv-open-folder'; return b; })(),
      againBtn: byId('conv-done-again'), cancelBig: byId('conv-cancel-big'), cancelBtn: byId('btn-conv-cancel'),
      onRun: (ev) => {
        const p = Math.max(0, Math.min(1, (parseFloat(cvBar.style.width) || 0) / 100));
        if (ev === 'start') { cvT0 = performance.now(); setT(cvSpd, '—'); setT(cvEta, '—'); setT(cvOut, '—'); return; }
        const el = (performance.now() - cvT0) / 1000;
        if (p > 0.02 && el > 1) { setT(cvEta, mmss(el * (1 - p) / p)); if (curDur) setT(cvSpd, (curDur * p / el).toFixed(1).replace('.', ',') + '×'); }
        if (curBytes) setT(cvOut, fmtSize(curBytes * p));
      },
    });


    // Arrastar um arquivo pra dentro da janela (ou sobre a área do conversor)
    const dz = byId('btn-conv-pick');
    const isFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    let depth = 0;
    const setOver = (on) => dz && dz.classList.toggle('over', on);
    window.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; depth++; if (!byId('tab-converter')?.classList.contains('hidden')) setOver(true); });
    window.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); });
    window.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('drop', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth = 0; setOver(false);          // sem isso o Electron abriria o arquivo no lugar do app
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      const p = f && api.pathForFile ? api.pathForFile(f) : '';
      if (!p) return;
      const tab = document.querySelector('.tab[data-tab="converter"]');
      if (tab && !tab.classList.contains('active')) tab.click();
      gd().openConv?.(p);
    });
  }

  /* ═══ Config ══════════════════════════════════════════════════════ */
  // Sub-navegação: rola até a seção e marca a que está à vista
  const subnav = byId('cf-nav');
  if (subnav) {
    const subs = [...subnav.querySelectorAll('.sub')];
    const targets = subs.map(b => byId(b.dataset.go));
    subnav.addEventListener('click', (e) => {
      const b = e.target.closest('.sub'); if (!b) return;
      const t = byId(b.dataset.go); if (t) t.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
    });
    const mark = (id) => subs.forEach(b => b.classList.toggle('on', b.dataset.go === id));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => {
        const vis = ents.filter(x => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) mark(vis.target.id);
      }, { rootMargin: '-90px 0px -60% 0px' });
      targets.forEach(t => t && io.observe(t));
    }
    mark('cf-sys');
  }

  // Cor de destaque: slider de matiz + bolinhas
  const hueEl = byId('ui-hue'), hueVal = byId('ui-hue-val'), hueReset = byId('ui-hue-reset');
  if (hueEl) {
    const NAMES = [[300, 'Roxo (padrão)'], [335, 'Rosa'], [250, 'Azul'], [155, 'Verde'], [50, 'Laranja']];
    const paintHue = () => {
      const h = Math.round(prefs.hue % 360);
      hueEl.value = String(h);
      const hit = NAMES.find(([v]) => Math.abs(v - h) <= 2);
      if (hueVal) hueVal.textContent = hit ? hit[1] : `Personalizada · ${h}°`;
      hueReset?.classList.toggle('hidden', h === DEFAULT_H);
      sw?.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.h) === h)));
    };
    hueEl.addEventListener('input', () => { setBrand(Number(hueEl.value)); paintHue(); });
    sw?.addEventListener('click', () => setTimeout(paintHue, 0));
    hueReset?.addEventListener('click', () => { setBrand(DEFAULT_H); paintHue(); });
    paintHue();
  }

  // Extensão: alterna Chromium / Firefox e copia os endereços ao clicar
  const extSeg = byId('ext-seg');
  if (extSeg) {
    const paintExt = () => {
      const ff = extSeg.querySelector('input[value="firefox"]')?.checked;
      byId('ext-chromium').hidden = !!ff; byId('ext-firefox').hidden = !ff;
    };
    extSeg.addEventListener('change', paintExt); paintExt();
  }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest?.('code[data-copy]'); if (!c) return;
    try { await navigator.clipboard.writeText(c.dataset.copy); const old = c.textContent; c.textContent = 'copiado!'; setTimeout(() => { c.textContent = old; }, 900); } catch { /* sem permissão: ignora */ }
  });

  // Barra "alterações não salvas": compara os campos de Downloads/Opções com o que veio salvo
  const savebar = byId('savebar');
  if (savebar) {
    const fields = [...document.querySelectorAll('#cf-dl input, #cf-dl select, #cf-opt input, #cf-opt select')];
    const read = () => fields.map(f => f.type === 'checkbox' ? (f.checked ? '1' : '0') : f.value).join('\u0001');
    let base = read();
    const check = () => savebar.classList.toggle('on', read() !== base);
    fields.forEach(f => { f.addEventListener('input', check); f.addEventListener('change', check); });
    window.addEventListener('gdl-settings-loaded', () => { base = read(); check(); });
    // vale também pra um preenchimento que chegue depois (carregamento assíncrono)
    setTimeout(() => { if (!savebar.classList.contains('on')) base = read(); }, 1500);
  }

  /* ── Progresso na barra de tarefas (Windows) ──────────────────── */
  const send = window.electronAPI && window.electronAPI.setTaskbarProgress;
  if (send) {
    const bars = [['#dl-bar', '#dl-status'], ['#pl-bar', '#pl-status'], ['#queue-bar', '#queue-status'], ['#conv-bar', '#conv-status'], ['#spotify-dl-bar', '#spotify-dl-status']]
      .map(([b, s]) => [$(b), $(s)]).filter(([b, s]) => b && s);
    let lastSent = -2;
    const tick = () => {
      let best = -1;
      for (const [bar, box] of bars) {
        if (box.classList.contains('hidden')) continue;
        const st = bar.getAttribute('style') || '';
        if (/--success|--danger|ef4444/.test(st)) continue;                 // concluído ou com erro
        const p = parseFloat(bar.style.width);
        if (p > 0 && p < 100) best = Math.max(best, p / 100);
      }
      const v = best < 0 ? -1 : Math.round(best * 100) / 100;
      if (v !== lastSent) { lastSent = v; try { send(v); } catch { /* janela fechando */ } }
    };
    const mo = new MutationObserver(tick);
    for (const [bar, box] of bars) { mo.observe(bar, { attributes: true, attributeFilter: ['style'] }); mo.observe(box, { attributes: true, attributeFilter: ['class'] }); }
  }
})();
