// ── Platform detection (compartilhado em lib/media-utils.js) ───────────────────
const {
  SOURCES,
  SRC_HUE,
  detectSource,
  CONTAINER_COMPAT: CONV_CONTAINER_COMPAT,
  AUDIO_FORMATS,
  fmtSizeShort,
  formatCountdownMs,
} = window.__gdlMedia;
function srcHue(url) { const t = detectSource(url)?.type; return SRC_HUE[t] != null ? SRC_HUE[t] : 300; }
const ICO = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// ── Toast notifications ───────────────────────────────────────────────────────
// `action`, when provided, is { label, onClick } and renders a small button
// inside the toast (e.g. "Encerrar Chrome") that runs onClick when clicked.
function showToast(msg, type = 'info', duration = 4500, action = null) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  // O texto do toast vem de mensagens cruas do yt-dlp/ffmpeg e de títulos de
  // vídeo — um "<" ou "&" cortava o aviso pela metade.
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><div class="toast-body"><span class="toast-msg">${escapeHtml(msg)}</span></div><button class="toast-close" aria-label="Fechar aviso">✕</button>`;

  const dismiss = () => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 320); };
  // Erros do yt-dlp ficam 9-11s na tela e antes não tinham como dispensar.
  toast.querySelector('.toast-close').addEventListener('click', dismiss);

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = action.pendingLabel || 'Aguarde...';
      try { await action.onClick(); } finally { dismiss(); }
    });
    toast.querySelector('.toast-body').appendChild(btn);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });
  setTimeout(dismiss, duration);
}

// Shows an error toast; if the error came from a locked browser cookie
// database, adds a button to force-close that browser process.
function showErrorToast(result) {
  if (!result) return;
  if (result.lockedBrowser) {
    const label = result.lockedBrowserLabel || 'navegador';
    showToast(result.error, 'error', 9000, {
      label: `Encerrar ${label}`,
      pendingLabel: 'Encerrando...',
      onClick: async () => {
        const r = await window.electronAPI.killBrowserProcess(result.lockedBrowser);
        if (r?.success) showToast(`${label} encerrado. Tente novamente.`, 'success', 4000);
        else showToast(r?.error || `Não foi possível encerrar o ${label}. Feche-o manualmente.`, 'error');
      }
    });
  } else if (result.maybeDefenderBlocked) {
    showToast(result.error, 'error', 11000, {
      label: 'Abrir Segurança do Windows',
      onClick: async () => { await window.electronAPI.openWindowsSecurity(); }
    });
  } else {
    showToast(result.error, 'error');
  }
}

async function copyDiagnosticText(text) {
  if (!text) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else if (window.electronAPI?.writeClipboardText) await window.electronAPI.writeClipboardText(text);
    showToast('Diagnóstico copiado!', 'success', 2200);
  } catch {
    showToast('Não foi possível copiar o diagnóstico.', 'error', 2500);
  }
}

function clearDiagnosticBox(prefix) {
  const box = document.getElementById(`${prefix}-diag`);
  const pre = document.getElementById(`${prefix}-diag-pre`);
  const det = document.getElementById(`${prefix}-diag-details`);
  const copyBtn = document.getElementById(`${prefix}-diag-copy`);
  const retryBtn = prefix === 'dl' ? document.getElementById('btn-dl-compat-retry') : null;
  if (pre) pre.textContent = '';
  if (det) { det.open = false; det.classList.add('hidden'); }
  if (copyBtn) copyBtn.classList.add('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');
  if (box) box.classList.add('hidden');
}

function showDiagnosticBox(prefix, result) {
  const box = document.getElementById(`${prefix}-diag`);
  if (!box) return;
  const pre = document.getElementById(`${prefix}-diag-pre`);
  const det = document.getElementById(`${prefix}-diag-details`);
  const copyBtn = document.getElementById(`${prefix}-diag-copy`);
  const retryBtn = prefix === 'dl' ? document.getElementById('btn-dl-compat-retry') : null;
  const tech = result?.technicalDetails ? String(result.technicalDetails).trim() : '';
  const canRetry = !!(retryBtn && result?.canCompatRetry);

  if (!tech && !canRetry) {
    clearDiagnosticBox(prefix);
    return;
  }
  if (pre) pre.textContent = tech;
  if (det) {
    det.open = false;
    det.classList.toggle('hidden', !tech);
  }
  if (copyBtn) {
    copyBtn.classList.toggle('hidden', !tech);
    copyBtn.onclick = () => copyDiagnosticText(tech || result?.error || '');
  }
  if (retryBtn) {
    retryBtn.classList.toggle('hidden', !canRetry);
  }
  box.classList.remove('hidden');
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentUrl = '';
let lastUsedCookies = false;
let isPlaylist = false;
let plItems = [];               // itens da última playlist buscada (index, title, duration)
let plSelectedIndexes = new Set(); // quais desses o usuário marcou pra baixar
let isSpotify = false;
let currentSource = null;
let selectedFormatId = null;
let selectedFormatHasAudio = false;
const canceledUiIds = new Set();
let currentFormats = [];
let currentAudioSize = 0;          // bytes do melhor áudio (estimativa de tamanho na aba Download)
let lastSavedFolder = '';
let activeDownloadId = null;
let activePlaylistId = null;
let activeSpotifyId = null;
// Leitura do estado atual pra camada visual (ui-fx.js) — só getters, nada é alterado por aqui.
window.__gdl = {
  get formats() { return currentFormats; },
  get audioSize() { return currentAudioSize; },
  get selectedFormatId() { return selectedFormatId; },
  get source() { return currentSource; },
  get busy() { return !!(activeDownloadId || activePlaylistId || activeSpotifyId); },
};
let lastSpotifyFolder = '';
let downloadQueue = [];
let queueRunning  = false;
let queuePaused   = false;
let queueCanceled = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`; }

// Títulos de vídeo vêm de fora e entram em innerHTML — um título com "<" ou "&"
// quebrava o item na tela (e, no limite, deixava injetar marcação).
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtSeconds(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtBytes(b) {
  if (!b) return '?';
  if (b > 1e9) return `${(b/1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b/1e6).toFixed(0)} MB`;
  return `${(b/1e3).toFixed(0)} KB`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function getRadio(name) {
  for (const r of document.getElementsByName(name)) { if (r.checked) return r.value; }
  return 'video';
}
function setProgress(bar, text, pct, msg) {
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = msg;
}
function resetBar(bar, text) {
  if (bar) { bar.style.width = '0%'; bar.style.background = ''; }   // '' = volta pro visual padrão da barra (CSS)
  if (text) text.textContent = '';
}

// ── Source chip ───────────────────────────────────────────────────────────────
const sourceChip = document.getElementById('source-chip');

function updateSourceChip(src) {
  if (!sourceChip) return;
  if (!src) { sourceChip.classList.add('hidden'); return; }
  sourceChip.textContent = src.label;
  sourceChip.style.color = src.color;
  sourceChip.style.background = src.bg;
  sourceChip.style.borderColor = src.border;
  sourceChip.classList.remove('hidden');
}

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'history') renderHistory();
    if (btn.dataset.tab === 'settings') { loadSettingsUI(); refreshRuntimeStatus(); }
    // Volta o cursor pro campo de link: era um clique obrigatório a cada
    // ida e volta entre as abas.
    if (btn.dataset.tab === 'download') setTimeout(() => urlInput?.focus(), 40);
  });
});

// ── Format radio toggles ──────────────────────────────────────────────────────
document.getElementsByName('fmt').forEach(r => r.addEventListener('change', e => {
  document.getElementById('quality-group').classList.toggle('hidden', e.target.value === 'audio');
}));
document.getElementsByName('pl-fmt').forEach(r => r.addEventListener('change', e => {
  document.getElementById('pl-quality-group').classList.toggle('hidden', e.target.value === 'audio');
}));

// ── URL input / real-time detection ──────────────────────────────────────────
const urlInput    = document.getElementById('url-input');
const btnFetch    = document.getElementById('btn-fetch');
const loader      = document.getElementById('loader');
const loaderText  = document.getElementById('loader-text');
const videoPreview    = document.getElementById('video-preview');
const playlistPreview = document.getElementById('playlist-preview');

let _srcChipTimer;
urlInput.addEventListener('input', e => {
  clearTimeout(_srcChipTimer);
  _srcChipTimer = setTimeout(() => {
    updateSourceChip(detectSource(e.target.value.trim()));
  }, 120);
});

urlInput.addEventListener('paste', e => {
  setTimeout(() => updateSourceChip(detectSource(urlInput.value.trim())), 0);
});

function hidePreviews() {
  videoPreview.classList.add('hidden');
  playlistPreview.classList.add('hidden');
  document.getElementById('spotify-preview').classList.add('hidden');
}

// ── Playlist: marcar quais vídeos baixar ────────────────────────────────────
function formatPlDuration(sec) {
  if (sec == null) return '';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updatePlSelectedCounter() {
  const counter = document.getElementById('pl-selected-counter');
  if (counter) counter.textContent = `${plSelectedIndexes.size} de ${plItems.length} selecionados`;
}

function renderPlaylistItems(items) {
  plItems = items || [];
  plSelectedIndexes = new Set(plItems.map(it => it.index)); // tudo marcado por padrão

  const wrap = document.getElementById('pl-items-wrap');
  const list = document.getElementById('pl-items-list');
  if (!wrap || !list) return;

  if (!plItems.length) { wrap.classList.add('hidden'); return; }

  list.innerHTML = '';
  plItems.forEach(item => {
    const row = document.createElement('label');
    row.className = 'pl-item-row';
    row.innerHTML = `
      <input type="checkbox" checked data-idx="${item.index}">
      <span class="pl-item-index">${item.index}.</span>
      <span class="pl-item-title">${item.title.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span>
      <span class="pl-item-duration">${formatPlDuration(item.duration)}</span>`;
    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) plSelectedIndexes.add(item.index);
      else plSelectedIndexes.delete(item.index);
      updatePlSelectedCounter();
    });
    list.appendChild(row);
  });

  updatePlSelectedCounter();
  wrap.classList.remove('hidden');
}

document.getElementById('pl-select-all')?.addEventListener('click', () => {
  plSelectedIndexes = new Set(plItems.map(it => it.index));
  document.querySelectorAll('#pl-items-list input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  updatePlSelectedCounter();
});
document.getElementById('pl-select-none')?.addEventListener('click', () => {
  plSelectedIndexes.clear();
  document.querySelectorAll('#pl-items-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updatePlSelectedCounter();
});

// Zera tudo que sobrou do link anterior. Sem isso, buscar um vídeo novo depois
// de baixar um mostrava o card já com a barra verde "Download concluído!" e o
// botão "Abrir Pasta" — que abria a pasta do vídeo *anterior*. E a lista de
// formatos continuava sendo a do vídeo antigo, então "Usar Formato" mandava um
// id que não existia no vídeo atual e o download falhava.
function populateAudioTracks(tracks) {
  const grp = document.getElementById('audio-track-group');
  const sel = document.getElementById('dl-audiolang');
  const cnt = document.getElementById('audio-track-count');
  if (!grp || !sel) return;
  sel.innerHTML = '<option value="auto">Automático (padrão do vídeo)</option>';
  if (!Array.isArray(tracks) || tracks.length < 2) {
    grp.classList.add('hidden');
    if (cnt) cnt.textContent = '';
    return;
  }
  tracks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.code;
    opt.textContent = t.label;
    sel.appendChild(opt);
  });
  if (cnt) cnt.textContent = `${tracks.length} idiomas disponíveis`;
  grp.classList.remove('hidden');
}

function updateSubsAvailabilityHint(info) {
  const hint = document.getElementById('dl-subs-hint');
  if (!hint) return;
  if (info?.hasHumanSubs) {
    const sample = (info.subLanguages || []).slice(0, 6).join(', ');
    const more = (info.subLanguages || []).length > 6 ? '…' : '';
    hint.textContent = `Legendas manuais disponíveis (${sample}${more}) · idiomas em Config`;
  } else if (info?.hasAutoSubs) {
    hint.textContent = 'Apenas legendas automáticas disponíveis · ative "automáticas" em Config';
  } else if (info && info.success) {
    hint.textContent = 'Nenhuma legenda detectada neste vídeo';
  } else {
    hint.textContent = 'Baixa e embute quando existirem · idiomas em Config';
  }
}

function getEstimatedDownloadBytes() {
  const fmt = getRadio('fmt');
  if (fmt === 'audio') {
    const durText = (document.getElementById('video-duration')?.textContent || '').trim();
    const parts = /^\d+(:\d+){1,2}$/.test(durText) ? durText.split(':').map(Number) : null;
    const secs = parts ? parts.reduce((a, n) => a * 60 + n, 0) : 0;
    const kbps = Number(document.getElementById('audio-quality-range')?.value) || 320;
    return secs > 0 ? kbps * 125 * secs : 0;
  }
  if (!currentFormats.length) return 0;
  if (selectedFormatId) {
    const exact = currentFormats.find(f => f.id === selectedFormatId);
    if (exact?.size) return exact.size + (exact.hasAudio ? 0 : (currentAudioSize || 0));
  }
  const q = document.getElementById('quality')?.value || 'best';
  const chosen = q === 'best'
    ? currentFormats[0]
    : (currentFormats.find(f => f.height <= Number(q)) || currentFormats[currentFormats.length - 1]);
  return chosen?.size ? chosen.size + (chosen.hasAudio ? 0 : (currentAudioSize || 0)) : 0;
}

function resetDownloadState() {
  currentFormats = [];
  currentAudioSize = 0;
  selectedFormatId = null;
  selectedFormatHasAudio = false;
  lastSavedFolder = '';
  lastPlaylistFolder = '';
  document.getElementById('fmt-label').classList.add('hidden');
  dlStatus.classList.add('hidden');
  plStatus.classList.add('hidden');
  btnOpenFolder.classList.add('hidden');
  btnOpenFolderPl.classList.add('hidden');
  resetBar(dlBar, dlText);
  resetBar(plBar, plText);
  clearDiagnosticBox('dl');
  clearDiagnosticBox('spotify');
  populateAudioTracks([]);
  updateSubsAvailabilityHint(null);
  plActiveSlots.clear();
  renderPlSlots();
  updateFormatsButton();
}

// O botão "ver formatos" só faz sentido no YouTube — é o único lugar onde a
// lista é buscada (o prefetch em fetchInfo). Nos outros sites ele ficava
// visível e sempre caía no aviso "formatos ainda não carregados", que nunca
// iam carregar.
function updateFormatsButton() {
  const btn = document.getElementById('btn-formats');
  if (!btn) return;
  const supported = currentSource?.type === 'youtube';
  btn.classList.toggle('hidden', !supported);
  btn.disabled = !currentFormats.length;
  btn.title = currentFormats.length ? 'Escolher resolução exata' : 'Carregando as resoluções disponíveis...';
}

async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showToast('Cole um link começando com http:// ou https://.', 'warning');
    return;
  }
  currentUrl = url;
  currentSource = detectSource(url);
  resetDownloadState();
  hidePreviews();
  loader.classList.remove('hidden');

  // ── Spotify ───────────────────────────────────────────────────────────────
  if (currentSource?.type === 'spotify') {
    isSpotify = true;
    isPlaylist = false;
    loaderText.textContent = 'Buscando no Spotify...';
    const info = await window.electronAPI.spotifyGetInfo({ url });
    if (currentUrl !== url) return;
    loader.classList.add('hidden');
    if (!info.success) { showErrorToast(info); return; }

    const thumb = document.getElementById('spotify-thumb');
    if (info.thumbnail) { thumb.src = info.thumbnail; thumb.style.display = ''; }
    else { thumb.style.display = 'none'; }
    document.getElementById('spotify-name').textContent   = info.name;
    document.getElementById('spotify-artist').textContent = info.artist || '';
    const countEl = document.getElementById('spotify-count');
    if (info.count > 1) { countEl.textContent = `${info.count} músicas`; countEl.style.display = ''; }
    else { countEl.style.display = 'none'; }
    const typeLabels = { track: 'Música', album: 'Álbum', playlist: 'Playlist' };
    document.getElementById('spotify-type-chip').textContent = typeLabels[info.type] || 'Spotify';
    document.getElementById('spotify-dl-status').classList.add('hidden');
    document.getElementById('btn-spotify-open').classList.add('hidden');
    document.getElementById('spotify-log').classList.add('hidden');
    document.getElementById('spotify-log').textContent = '';
    document.getElementById('btn-spotify-cancel').classList.add('hidden');
    document.getElementById('btn-spotify-dl').disabled = false;
    if (typeof syncSpotifyBitrate === 'function') syncSpotifyBitrate();
    document.getElementById('spotify-preview').classList.remove('hidden');
    return;
  }

  // ── YouTube playlist ──────────────────────────────────────────────────────
  isSpotify = false;
  isPlaylist = currentSource?.type === 'youtube-playlist';
  loaderText.textContent = isPlaylist ? 'Buscando playlist...' : `Buscando em ${currentSource?.label || 'yt-dlp'}...`;

  if (isPlaylist) {
    const info = await window.electronAPI.getPlaylistInfo({ url });
    if (currentUrl !== url) return;
    loader.classList.add('hidden');
    if (!info.success) { showErrorToast(info); return; }
    lastUsedCookies = info.usedCookies || false;
    if (!info.count) {
      // No entries — treat as single video
      isPlaylist = false;
      const vinfo = await window.electronAPI.getVideoInfo({ url });
      if (currentUrl !== url) return;
      if (vinfo.success) {
        lastUsedCookies = vinfo.usedCookies || false;
        showVideoPreview(vinfo);
      } else { showErrorToast(vinfo); }
      return;
    }
    document.getElementById('playlist-title').textContent = info.title || 'Playlist';
    document.getElementById('playlist-count').textContent = `${info.count} vídeos`;
    renderPlaylistItems(info.items || []);
    playlistPreview.classList.remove('hidden');
    return;
  }

  // ── Single video (YouTube, TikTok, Instagram, X, Twitch, etc.) ───────────
  const info = await window.electronAPI.getVideoInfo({ url });
  if (currentUrl !== url) return;
  loader.classList.add('hidden');
  if (info.success) {
    lastUsedCookies = info.usedCookies || false;
    showVideoPreview(info);
    // Prefetch formats in background (only useful for YouTube)
    if (currentSource?.type === 'youtube') {
      const fetchedFor = currentUrl;
      window.electronAPI.getFormats({ url }).then(r => {
        // Só aplica se ainda for o mesmo link — numa busca rápida atrás da
        // outra, a resposta antiga chegando depois sobrescreveria a nova.
        if (currentUrl !== fetchedFor) return;
        if (r.success) {
          currentFormats = r.formats;
          currentAudioSize = r.audioSize || 0;
          populateAudioTracks(r.audioTracks || []);
          updateSubsAvailabilityHint(r);
        }
        updateFormatsButton();
      }).catch(() => {});
    }
    updateFormatsButton();
    // For audio-only sources, pre-select MP3
    if (currentSource?.type === 'soundcloud') {
      const audioRadio = document.querySelector('input[name="fmt"][value="audio"]');
      if (audioRadio) { audioRadio.checked = true; document.getElementById('quality-group').classList.add('hidden'); }
    }
  } else {
    showErrorToast(info);
  }
}

function showVideoPreview(info) {
  document.getElementById('video-title').textContent = info.title;
  document.getElementById('video-duration').textContent = fmtSeconds(info.duration);
  const byEl = document.getElementById('video-by');
  if (byEl) {
    const bits = [];
    if (info.uploader) bits.push(info.uploader);
    if (typeof info.viewCount === 'number') bits.push(new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(info.viewCount) + ' visualizações');
    byEl.textContent = bits.join(' · ');
    byEl.classList.toggle('hidden', !bits.length);
  }
  const thumb = Array.isArray(info.thumbnail) ? info.thumbnail.at(-1).url : info.thumbnail;
  document.getElementById('video-thumbnail').src = thumb || '';

  // Platform chip
  const chipEl = document.getElementById('video-source-chip');
  if (chipEl && currentSource) {
    chipEl.textContent = currentSource.label;
    chipEl.style.color = currentSource.color;
    chipEl.style.background = currentSource.bg;
    chipEl.style.borderColor = currentSource.border;
    chipEl.className = 'chip';
  } else if (chipEl) {
    chipEl.textContent = 'Vídeo';
    chipEl.style.cssText = '';
    chipEl.className = 'chip';
  }
  videoPreview.classList.remove('hidden');
}

btnFetch.addEventListener('click', fetchInfo);
urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') fetchInfo(); });

// ── Modais ────────────────────────────────────────────────────────────────────
// Esc, clique fora e devolução do foco pra quem abriu. Nenhum dos modais tinha
// nada disso: abriam com o foco preso atrás do overlay e só saíam clicando no ✕.
const modalStack = [];
function openModal(el, focusEl) {
  if (!el || !el.classList.contains('hidden')) return;
  modalStack.push({ el, returnFocus: document.activeElement });
  el.classList.remove('hidden');
  (focusEl || el.querySelector('input, button, select, textarea'))?.focus?.();
}
function closeModal(el) {
  if (!el) return;
  const i = modalStack.findIndex(m => m.el === el);
  const entry = i >= 0 ? modalStack.splice(i, 1)[0] : null;
  el.classList.add('hidden');
  entry?.returnFocus?.focus?.();
  el.dispatchEvent(new CustomEvent('modal-closed'));
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !modalStack.length) return;
  closeModal(modalStack[modalStack.length - 1].el);
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(ov); });
});

// Substituto do window.prompt(), que o Electron não implementa — era por isso
// que "Salvar preset" no conversor não fazia absolutamente nada.
function askText({ title = 'Digite', message = '', value = '', okLabel = 'Salvar', placeholder = '' } = {}) {
  return new Promise(resolve => {
    const el     = document.getElementById('ask-modal');
    const input  = document.getElementById('ask-input');
    const okBtn  = document.getElementById('ask-ok');
    const cnlBtn = document.getElementById('ask-cancel');
    const xBtn   = document.getElementById('ask-close');
    document.getElementById('ask-modal-title').textContent = title;
    document.getElementById('ask-message').textContent = message;
    okBtn.textContent = okLabel;
    input.value = value;
    input.placeholder = placeholder;

    let settled = false;
    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cnlBtn.removeEventListener('click', onCancel);
      xBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      el.removeEventListener('modal-closed', onClosed);
    };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!el.classList.contains('hidden')) closeModal(el);
      resolve(val);
    };
    function onOk()     { finish(input.value.trim() || null); }
    function onCancel() { finish(null); }
    function onClosed() { finish(null); }
    function onKey(e)   { if (e.key === 'Enter') { e.preventDefault(); onOk(); } }

    okBtn.addEventListener('click', onOk);
    cnlBtn.addEventListener('click', onCancel);
    xBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    el.addEventListener('modal-closed', onClosed);
    openModal(el, input);
    input.select();
  });
}

// ── Format modal ──────────────────────────────────────────────────────────────
const modal       = document.getElementById('formats-modal');
const formatsList = document.getElementById('formats-list');
const btnUseFormat= document.getElementById('btn-use-format');
let chosenFmtId   = null;

document.getElementById('btn-formats').addEventListener('click', () => {
  if (!currentFormats.length) { showToast('As resoluções ainda estão carregando — tente de novo em um instante.', 'warning'); return; }
  formatsList.innerHTML = '';
  chosenFmtId = null;
  btnUseFormat.disabled = true;

  currentFormats.forEach(f => {
    const row = document.createElement('label');
    row.className = 'format-row';
    const codecBadge = f.vcodec ? `<span class="dim" style="font-size:0.75rem;padding:2px 6px;border-radius:6px;background:oklch(1 0 0 / .08)">${f.vcodec}</span>` : '';
    row.innerHTML = `
      <input type="radio" name="fmt-pick" value="${f.id}">
      <strong>${f.height}p</strong>
      <span class="dim">${f.ext.toUpperCase()} · ${f.fps || 30}fps</span>
      ${codecBadge}
      <span class="format-size">${fmtBytes(f.size)}</span>`;
    row.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('.format-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      chosenFmtId = f.id;
      btnUseFormat.disabled = false;
    });
    formatsList.appendChild(row);
  });
  openModal(modal, formatsList.querySelector('input'));
});

document.getElementById('modal-close').addEventListener('click', () => closeModal(modal));
document.getElementById('btn-cancel-format').addEventListener('click', () => closeModal(modal));
btnUseFormat.addEventListener('click', () => {
  if (!chosenFmtId) return;
  selectedFormatId = chosenFmtId;
  const fmt = currentFormats.find(f => f.id === chosenFmtId);
  selectedFormatHasAudio = !!(fmt && fmt.hasAudio);
  const label = document.getElementById('fmt-label');
  label.textContent = fmt ? `${fmt.height}p ${fmt.ext.toUpperCase()}${fmt.vcodec ? ' · ' + fmt.vcodec : ''}` : chosenFmtId;
  label.classList.remove('hidden');
  document.getElementById('quality').value = 'best';
  document.getElementById('quality').dispatchEvent(new Event('quality-sync'));
  closeModal(modal);
});

// Mexer na Qualidade (ou trocar pra MP3) descarta a resolução escolhida à mão:
// antes o formatId continuava valendo em silêncio e o seletor de qualidade
// virava um botão sem efeito nenhum.
function clearChosenFormat(reason) {
  if (!selectedFormatId) return;
  selectedFormatId = null;
  selectedFormatHasAudio = false;
  document.getElementById('fmt-label').classList.add('hidden');
  if (reason) showToast(reason, 'info', 2600);
}
document.getElementById('quality').addEventListener('change', () => clearChosenFormat('Voltei pra qualidade automática — a resolução escolhida à mão foi descartada.'));
document.getElementById('dl-vcodec')?.addEventListener('change', (e) => {
  e.target.dataset.userChanged = 'true';
  clearChosenFormat('Codec alterado — a resolução específica escolhida à mão foi descartada.');
});
document.getElementsByName('fmt').forEach(r => r.addEventListener('change', () => clearChosenFormat(null)));

// ── Single download ───────────────────────────────────────────────────────────
const btnDownload  = document.getElementById('btn-download');
const btnCancel    = document.getElementById('btn-cancel');
const dlStatus     = document.getElementById('dl-status');
const dlBar        = document.getElementById('dl-bar');
const dlText       = document.getElementById('dl-text');
const btnOpenFolder= document.getElementById('btn-open-folder');

btnDownload.addEventListener('click', async () => {
  if (!currentUrl || activeDownloadId || btnDownload.disabled) return;
  btnDownload.disabled = true;

  try {
    // Avisa se esse link já foi baixado com sucesso antes (o diálogo é nativo e
    // roda no processo principal — ver 'check-duplicate-download' no main.js).
    const dup = await window.electronAPI.checkDuplicateDownload(currentUrl);
    if (dup?.duplicate && !dup.proceed) {
      btnDownload.disabled = false;
      return;
    }
  } catch { /* segue mesmo se a checagem de duplicado falhar */ }

  const dlId = uid();
  activeDownloadId = dlId;
  _dlSpeed = makeEma(0.2);
  _dlEta   = makeEma(0.15);

  btnCancel.disabled = false;
  btnCancel.classList.remove('hidden');
  btnOpenFolder.classList.add('hidden');
  clearDiagnosticBox('dl');
  dlStatus.classList.remove('hidden');
  resetBar(dlBar, dlText);
  dlText.textContent = 'Preparando...';
  ['dl-spd', 'dl-eta', 'dl-got'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });

  // try/finally: se o IPC rejeitar (exceção no processo principal, janela
  // recarregada), o botão precisa voltar ao normal de qualquer jeito — antes
  // ele ficava desabilitado pra sempre, com "Cancelar" apontando pra um id
  // morto, e só reiniciando o app pra sair disso.
  let result;
  try {
    result = await window.electronAPI.downloadVideo({
      url: currentUrl,
      format: getRadio('fmt'),
      quality: document.getElementById('quality').value,
      container: document.getElementById('dl-container')?.value || 'mp4',
      videoCodec: document.getElementById('dl-vcodec')?.value || 'auto',
      audioBitrate: Number(document.getElementById('audio-quality-range')?.value) || 0,
      audioLang: document.getElementById('dl-audiolang')?.value || 'auto',
      estimatedBytes: getEstimatedDownloadBytes(),
      useCookies: lastUsedCookies,
      downloadId: dlId,
      formatId: selectedFormatId,
      formatHasAudio: selectedFormatHasAudio,
      title: document.getElementById('video-title').textContent
    });
  } catch (e) {
    result = { success: false, error: e?.message || 'Falha inesperada ao falar com o app.' };
  } finally {
    if (activeDownloadId === dlId) {
      activeDownloadId = null;
      btnDownload.disabled = false;
      btnCancel.disabled = false;
      btnCancel.classList.add('hidden');
    }
  }

  if (canceledUiIds.delete(dlId)) return;
  if (activeDownloadId && activeDownloadId !== dlId) return;

  if (result?.canceled) {
    dlStatus.classList.add('hidden');
    resetBar(dlBar, dlText);
    return;
  }

  if (result.success) {
    dlBar.style.width = '100%';
    dlBar.style.background = 'linear-gradient(90deg, var(--success), #34d399)';
    dlText.textContent = 'Download concluído!';
    lastSavedFolder = result.folder;
    btnOpenFolder.classList.remove('hidden');
    showToast('Download concluído com sucesso!', 'success');
  } else {
    dlBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
    dlText.textContent = result.error;
    showDiagnosticBox('dl', result);
    showErrorToast(result);
  }
});

document.getElementById('btn-dl-compat-retry')?.addEventListener('click', () => {
  if (!currentUrl || activeDownloadId) return;
  const videoRadio = document.querySelector('input[name="fmt"][value="video"]');
  if (videoRadio) { videoRadio.checked = true; videoRadio.dispatchEvent(new Event('change', { bubbles: true })); }
  const cont = document.getElementById('dl-container');
  if (cont) { cont.value = 'mp4'; cont.dispatchEvent(new Event('change', { bubbles: true })); }
  const vcodec = document.getElementById('dl-vcodec');
  if (vcodec) { vcodec.value = 'h264'; vcodec.dataset.userChanged = 'true'; }
  const qSel = document.getElementById('quality');
  if (qSel) {
    const targetQ = [...qSel.options].some(o => o.value === '1080') ? '1080' : 'best';
    qSel.value = targetQ;
    qSel.dispatchEvent(new Event('quality-sync'));
  }
  clearChosenFormat(null);
  btnDownload.click();
});

btnCancel.addEventListener('click', async () => {
  if (!activeDownloadId) return;
  const idToCancel = activeDownloadId;
  canceledUiIds.add(idToCancel);
  btnCancel.disabled = true;
  try {
    await window.electronAPI.cancelDownload(idToCancel);
  } finally {
    if (activeDownloadId === idToCancel) activeDownloadId = null;
    btnCancel.disabled = false;
    btnCancel.classList.add('hidden');
    dlBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
    dlText.textContent = 'Download cancelado.';
    btnDownload.disabled = false;
    showToast('Download cancelado.', 'warning');
  }
});

btnOpenFolder.addEventListener('click', () => { if (lastSavedFolder) window.electronAPI.openFolder(lastSavedFolder); });

// ── Playlist download ─────────────────────────────────────────────────────────
const btnDlPlaylist   = document.getElementById('btn-dl-playlist');
const btnCancelPl     = document.getElementById('btn-cancel-pl');
const plStatus        = document.getElementById('pl-status');
const plBar           = document.getElementById('pl-bar');
const plText          = document.getElementById('pl-text');
const plLabel         = document.getElementById('pl-label');
const plCounter       = document.getElementById('pl-counter');
const btnOpenFolderPl = document.getElementById('btn-open-folder-pl');
let lastPlaylistFolder = '';

btnDlPlaylist.addEventListener('click', async () => {
  if (!currentUrl || activePlaylistId || btnDlPlaylist.disabled) return;
  if (plItems.length && plSelectedIndexes.size === 0) {
    showToast('Marque pelo menos um vídeo da playlist pra baixar.', 'warning');
    return;
  }
  const dlId = uid();
  activePlaylistId = dlId;

  btnDlPlaylist.disabled = true;
  btnCancelPl.disabled = false;
  btnCancelPl.classList.remove('hidden');
  btnOpenFolderPl.classList.add('hidden');
  plStatus.classList.remove('hidden');
  resetBar(plBar, plText);
  plLabel.textContent = 'Aguardando pasta...';
  plCounter.textContent = '';

  // Só manda selectedIndexes se o usuário desmarcou algo — se está tudo
  // marcado (o padrão), deixa undefined pra baixar a playlist inteira sem
  // precisar bater a lista item a item no main.js.
  const allSelected = plItems.length > 0 && plSelectedIndexes.size === plItems.length;
  let result;
  try {
    result = await window.electronAPI.downloadPlaylist({
      url: currentUrl,
      format: getRadio('pl-fmt'),
      quality: document.getElementById('pl-quality').value,
      videoCodec: document.getElementById('dl-vcodec')?.value || 'auto',
      useCookies: lastUsedCookies,
      downloadId: dlId,
      concurrency: parseInt(document.getElementById('pl-concurrency')?.value || '3', 10),
      selectedIndexes: (plItems.length && !allSelected) ? Array.from(plSelectedIndexes) : undefined,
    });
  } catch (e) {
    result = { success: false, error: e?.message || 'Falha inesperada ao falar com o app.' };
  } finally {
    if (activePlaylistId === dlId) {
      activePlaylistId = null;
      btnDlPlaylist.disabled = false;
      btnCancelPl.disabled = false;
      btnCancelPl.classList.add('hidden');
    }
  }

  if (canceledUiIds.delete(dlId)) return;
  if (activePlaylistId && activePlaylistId !== dlId) return;

  if (result?.canceled) {
    plStatus.classList.add('hidden');
    resetBar(plBar, plText);
    plLabel.textContent = '';
    plCounter.textContent = '';
    return;
  }

  if (result.success) {
    plBar.style.width = '100%';
    plBar.style.background = 'linear-gradient(90deg, var(--success), #34d399)';
    const skippedNote = result.skipped > 0 ? ` · ${result.skipped} ignorados` : '';
    plText.textContent = `${result.downloaded} vídeos baixados!${skippedNote}`;
    plLabel.textContent = 'Concluído';
    plCounter.textContent = '';
    lastPlaylistFolder = result.folder;
    btnOpenFolderPl.classList.remove('hidden');
    showToast(`Playlist concluída — ${result.downloaded} vídeos!`, 'success');
  } else {
    plBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
    plText.textContent = result.error;
    showErrorToast(result);
  }
});

btnCancelPl.addEventListener('click', async () => {
  if (!activePlaylistId) return;
  const idToCancel = activePlaylistId;
  canceledUiIds.add(idToCancel);
  btnCancelPl.disabled = true;
  plActiveSlots.clear();
  renderPlSlots();
  try {
    await window.electronAPI.cancelDownload(idToCancel);
  } finally {
    if (activePlaylistId === idToCancel) activePlaylistId = null;
    btnCancelPl.disabled = false;
    btnCancelPl.classList.add('hidden');
    plBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
    plText.textContent = 'Download cancelado.';
    plLabel.textContent = '';
    btnDlPlaylist.disabled = false;
    showToast('Playlist cancelada.', 'warning');
  }
});

btnOpenFolderPl.addEventListener('click', () => { if (lastPlaylistFolder) window.electronAPI.openFolder(lastPlaylistFolder); });

// ── EMA smoothing ─────────────────────────────────────────────────────────────
function parseSpeedMib(s) {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*([KMG])iB\/s/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] === 'K' ? v / 1024 : m[2] === 'G' ? v * 1024 : v;
}
function fmtSpeed(mib) {
  if (mib >= 512) return `${(mib / 1024).toFixed(2)} GiB/s`;
  if (mib >= 0.5) return `${mib.toFixed(2)} MiB/s`;
  return `${(mib * 1024).toFixed(0)} KiB/s`;
}
function parseEtaSec(s) {
  if (!s) return null;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0);
}
function fmtEta(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function makeEma(alpha) {
  let v = null;
  return raw => { if (raw === null) return null; v = v === null ? raw : alpha * raw + (1 - alpha) * v; return v; };
}

let _dlSpeed = makeEma(0.2), _dlEta = makeEma(0.15);

// ── Progress events ───────────────────────────────────────────────────────────
window.electronAPI.onDownloadProgress(status => {
  // O main emite esse canal global pra TODO download, inclusive os da fila.
  // Sem esse filtro, rodar a fila fazia a barra do card de vídeo único pular
  // entre percentuais de arquivos diferentes.
  if (!activeDownloadId) return;
  const pct      = status.match(/(\d+\.?\d*)%/);
  const rawSpeed = status.match(/([\d.]+[KMG]iB\/s)/)?.[1];
  const rawEta   = status.match(/ETA\s+([\d:]+)/)?.[1];
  if (pct) {
    const sp = _dlSpeed(parseSpeedMib(rawSpeed));
    const et = _dlEta(parseEtaSec(rawEta));
    const p = parseFloat(pct[1]);
    // Linha de baixo do estado = título do vídeo; velocidade / restante / baixado vão nos cartões
    setProgress(dlBar, dlText, p, document.getElementById('video-title')?.textContent || '');
    const setStat = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
    setStat('dl-spd', sp !== null ? fmtSpeed(sp) : '—');
    setStat('dl-eta', et !== null ? fmtEta(et) : '—');
    const sz = status.match(/de\s+~?([\d.]+)\s*([KMG])iB/);
    if (sz) {
      const total = parseFloat(sz[1]) * Math.pow(1024, 'KMG'.indexOf(sz[2]) + 1);
      setStat('dl-got', `${fmtBytes(total * p / 100)} / ${fmtBytes(total)}`);
    }
  } else if (status.includes('Convertendo')) {
    setProgress(dlBar, dlText, 95, status);
  } else if (status.includes('Mesclando')) {
    setProgress(dlBar, dlText, 97, status);
  } else {
    dlText.textContent = status;
  }
});

// ── Playlist parallel slots ───────────────────────────────────────────────────
const plActiveSlots = new Map();
const plSlotsEl = document.getElementById('pl-slots');

function renderPlSlots() {
  if (!plSlotsEl) return;
  plSlotsEl.innerHTML = '';
  for (const [, slot] of plActiveSlots) {
    const el = document.createElement('div');
    el.className = 'pl-slot';
    const parts = [slot.percent.toFixed(1) + '%'];
    if (slot.speed) parts.push(slot.speed);
    if (slot.eta)   parts.push(/^\d+:\d+/.test(slot.eta) ? 'ETA ' + slot.eta : slot.eta);
    el.innerHTML = `
      <div class="pl-slot-info">
        <span class="pl-slot-title">${escapeHtml(slot.title)}</span>
        <span class="pl-slot-meta">${parts.join(' · ')}</span>
      </div>
      <div class="pl-slot-bar-wrap"><div class="pl-slot-bar" style="width:${slot.percent}%"></div></div>`;
    plSlotsEl.appendChild(el);
  }
}

window.electronAPI.onPlaylistProgress(({ completed, total, title, percent, phase, speed, eta, index, label }) => {
  const done = completed !== undefined ? completed : 0;
  if (total > 0) {
    plBar.style.width = `${Math.min((done / total) * 100, 99)}%`;
    plCounter.textContent = `${done} / ${total}`;
  }

  if (phase === 'fetching') {
    plLabel.textContent = 'Obtendo lista...';
    plText.textContent = '';
    plActiveSlots.clear();
    renderPlSlots();
  } else if (phase === 'start') {
    plLabel.textContent = title || 'Iniciando...';
    plActiveSlots.clear();
    renderPlSlots();
  } else if (phase === 'downloading') {
    if (total > 0) plLabel.textContent = `${done} / ${total} concluídos`;
    const prev = plActiveSlots.get(index) || {};
    const speedEma = prev._speedEma || makeEma(0.2);
    const etaEma   = prev._etaEma   || makeEma(0.15);
    const sp = speedEma(parseSpeedMib(speed));
    const et = etaEma(parseEtaSec(eta));
    plActiveSlots.set(index, {
      title, percent: percent || prev.percent || 0,
      speed: sp !== null ? fmtSpeed(sp) : '',
      eta:   et !== null ? fmtEta(et)   : '',
      _speedEma: speedEma, _etaEma: etaEma
    });
    renderPlSlots();
  } else if (phase === 'converting') {
    const prev = plActiveSlots.get(index) || { title };
    plActiveSlots.set(index, { title: prev.title, percent: 95, speed: '', eta: label || 'Processando...' });
    renderPlSlots();
  } else if (phase === 'merging') {
    const prev = plActiveSlots.get(index) || { title };
    plActiveSlots.set(index, { title: prev.title, percent: 97, speed: '', eta: 'Mesclando...' });
    renderPlSlots();
  } else if (phase === 'done' || phase === 'skipped') {
    plActiveSlots.delete(index);
    renderPlSlots();
    plText.textContent = phase === 'done' ? `Concluído: ${title}` : `Ignorado: ${title}`;
  }
});

// ── Queue ─────────────────────────────────────────────────────────────────────
const queueList        = document.getElementById('queue-list');
const queueEmpty       = document.getElementById('queue-empty');
const queueBadge       = document.getElementById('queue-badge');
const btnStartQueue    = document.getElementById('btn-start-queue');
const btnClearQueue    = document.getElementById('btn-clear-queue');
const queueStatus      = document.getElementById('queue-status');
const queueBar         = document.getElementById('queue-bar');
const queueText        = document.getElementById('queue-text');
const concurrencySelect= document.getElementById('queue-concurrency');

const btnPauseQueue  = document.getElementById('btn-pause-queue');
const btnCancelQueue = document.getElementById('btn-cancel-queue');
const btnRetryErrors = document.getElementById('btn-retry-errors');

const QUEUE_STATUS_LABEL = { pending: 'na fila', downloading: 'baixando', done: 'concluído', error: 'erro' };
const QUEUE_STATUS_CLASS = { pending: 'status-pending', downloading: 'status-downloading', done: 'status-done', error: 'status-error' };

// ── Fila salva em disco ──────────────────────────────────────────────────────
// Antes a fila só existia na memória da janela: fechar o app perdia tudo que
// estava esperando pra baixar. Agora ela volta como estava na próxima abertura.
let persistQueueTimer = null;
function persistQueue() {
  if (!window.electronAPI.saveQueue) return;
  clearTimeout(persistQueueTimer);
  persistQueueTimer = setTimeout(() => {
    const snapshot = downloadQueue.map(i => ({
      id: i.id, url: i.url, title: i.title, format: i.format, quality: i.quality,
      container: i.container, videoCodec: i.videoCodec, audioLang: i.audioLang,
      isSpotify: i.isSpotify, spFormat: i.spFormat, spQuality: i.spQuality,
      defaultFmt: i.defaultFmt, error: i.error, technicalDetails: i.technicalDetails,
      isPlaylist: i.isPlaylist, playlistCount: i.playlistCount,
      // Um item que estava baixando quando o app fechou volta como pendente.
      status: i.status === 'downloading' ? 'pending' : i.status,
    }));
    window.electronAPI.saveQueue(snapshot).catch(() => {});
  }, 300);
}

async function restoreQueue() {
  if (!window.electronAPI.getQueue) return;
  let saved = [];
  try { saved = await window.electronAPI.getQueue(); } catch { return; }
  if (!Array.isArray(saved) || !saved.length) return;
  downloadQueue = saved
    .filter(i => i && i.url)
    .map(i => ({ ...i, id: i.id || uid(), percent: 0, speed: '', eta: '' }));
  renderQueue();
  // Playlist que fechou o app antes da consulta de nome/quantidade terminar
  // (ou que veio de uma versão antiga que não buscava isso) tenta de novo.
  downloadQueue
    .filter(i => i.isPlaylist && i.status === 'pending' && (!i.title || i.title === i.url))
    .forEach(i => fetchQueuePlaylistMeta(i.id, i.url));
  downloadQueue
    .filter(i => (i.isSpotify || detectSource(i.url)?.type === 'spotify') && i.status === 'pending' && (!i.title || i.title === i.url))
    .forEach(i => { i.isSpotify = true; fetchQueueSpotifyMeta(i.id, i.url); });
  const pending = downloadQueue.filter(i => i.status === 'pending').length;
  if (pending) showToast(`Fila restaurada — ${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}.`, 'info', 3500);
}

// Marcação de um item, usada tanto no render completo quanto na atualização
// de um item só (antes era o mesmo bloco duplicado nos dois lugares, e só um
// deles recebia as mudanças).
function queueItemMetaText(item) {
  const live = item.status === 'downloading'
    ? `${item.speed ? ` · ${item.speed}` : ''}${item.eta ? ` · ${/^\d+:\d+/.test(item.eta) ? 'ETA ' + item.eta : item.eta}` : ''}`
    : '';
  if (item.isSpotify || detectSource(item.url)?.type === 'spotify') {
    const fmt = (item.spFormat || (['mp3', 'flac', 'm4a', 'ogg'].includes(String(item.format || '').toLowerCase()) ? item.format : 'mp3')).toUpperCase();
    const q = fmt === 'FLAC' ? 'sem perdas' : (item.spQuality || (item.quality && item.quality !== 'best' ? item.quality : '320k'));
    const cnt = item.playlistCount > 1 ? `${item.playlistCount} faixas · ` : '';
    return `Spotify · ${cnt}${fmt} · ${q}${live}`;
  }
  const cont = (item.container || 'mp4').toUpperCase();
  const fmtLabel = item.format === 'audio' ? 'MP3' : `${cont} · ${item.quality === 'best' ? 'Máxima' : item.quality + 'p'}`;
  const plLabel = item.isPlaylist
    ? (item.playlistCount ? `Playlist · ${item.playlistCount} vídeos · ` : 'Playlist · ')
    : '';
  return plLabel + fmtLabel + live;
}

// Link de playlist entra na fila só com a URL crua — sem nome nem quantidade
// de vídeos, já que addLinksToQueue não faz nenhuma consulta antes de
// enfileirar (é rápido de propósito, pra colar um monte de link de uma vez
// não travar a UI). Busca esses dados em segundo plano assim que o item é
// adicionado; se o item já saiu da fila (removido/baixado) quando a resposta
// chegar, ignora.
function fetchQueuePlaylistMeta(id, url) {
  window.electronAPI.getPlaylistInfo({ url }).then(info => {
    const item = downloadQueue.find(i => i.id === id);
    if (!item || item.status !== 'pending') return;
    if (info?.success) {
      item.title = info.title || item.title;
      item.playlistCount = info.count || null;
      renderQueue();
    }
  }).catch(() => {});
}

function fetchQueueSpotifyMeta(id, url) {
  window.electronAPI.spotifyGetInfo({ url }).then(info => {
    const item = downloadQueue.find(i => i.id === id);
    if (!item || item.status !== 'pending') return;
    if (info?.success) {
      item.title = info.artist ? `${info.artist} — ${info.name}` : (info.name || item.title);
      item.playlistCount = info.count > 1 ? info.count : null;
      renderQueue();
    }
  }).catch(() => {});
}

function queuePillHtml(item) {
  const pct = item.percent != null ? item.percent : 0;
  return `<i></i>${item.status === 'downloading' ? Math.round(pct) + '%' : (QUEUE_STATUS_LABEL[item.status] || item.status)}`;
}
function queueSelOpts(list, selected) {
  return list.map(([val, label]) =>
    `<option value="${escapeHtml(val)}"${String(val) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function queueItemControlsHtml(item) {
  const isSp = item.isSpotify || detectSource(item.url)?.type === 'spotify';
  const canExpand = item.isPlaylist || (isSp && (item.playlistCount > 1 || /\/(album|playlist)\//i.test(item.url)));
  const expandBtn = canExpand
    ? `<button type="button" class="btn-ghost btn-sm btn-expand-item" data-id="${item.id}"${item.expanding ? ' disabled' : ''} title="Expandir em itens individuais na fila">${item.expanding ? 'Expandindo...' : 'Expandir itens'}</button>`
    : '';
  if (isSp) {
    const spFmt = item.spFormat || (['mp3', 'flac', 'm4a', 'ogg'].includes(String(item.format || '').toLowerCase()) ? item.format : 'mp3');
    const spQuality = item.spQuality || '320k';
    return `<div class="qi-controls">
      <select class="qi-sel" data-id="${item.id}" data-prop="spFormat" aria-label="Formato Spotify">${queueSelOpts([['mp3','MP3'],['flac','FLAC'],['m4a','M4A'],['ogg','OGG']], spFmt)}</select>
      <select class="qi-sel" data-id="${item.id}" data-prop="spQuality"${spFmt === 'flac' ? ' disabled' : ''} aria-label="Bitrate Spotify">${queueSelOpts([['320k','320k'],['256k','256k'],['192k','192k'],['128k','128k']], spQuality)}</select>
      ${expandBtn}
    </div>`;
  }
  const fmt = item.format === 'audio' ? 'audio' : 'video';
  const cont = item.container || 'mp4';
  const q = item.quality || 'best';
  return `<div class="qi-controls">
    <select class="qi-sel" data-id="${item.id}" data-prop="format" aria-label="Formato">${queueSelOpts([['video','Vídeo'],['audio','MP3']], fmt)}</select>
    ${fmt !== 'audio' ? `<select class="qi-sel" data-id="${item.id}" data-prop="container" aria-label="Contêiner">${queueSelOpts([['mp4','MP4'],['mkv','MKV']], cont)}</select>` : ''}
    ${fmt !== 'audio' ? `<select class="qi-sel" data-id="${item.id}" data-prop="quality" aria-label="Qualidade">${queueSelOpts([['best','Máxima'],['2160','4K'],['1440','1440p'],['1080','1080p'],['720','720p'],['480','480p'],['360','360p']], q)}</select>` : ''}
    ${expandBtn}
  </div>`;
}

function queueItemBody(item) {
  const pct = item.percent != null ? item.percent : 0;
  const canEdit = item.status === 'pending' && !queueRunning;
  return `
    ${canEdit ? `<span class="queue-drag" title="Arraste pra reordenar" aria-hidden="true">${ICO('grip')}</span>` : ''}
    <div class="mini" style="--ah:${srcHue(item.url)}" aria-hidden="true"></div>
    <div class="queue-item-info">
      <div class="queue-item-url">${escapeHtml(item.title || item.url)}</div>
      <div class="queue-item-meta">${escapeHtml(queueItemMetaText(item))}</div>
      ${canEdit ? queueItemControlsHtml(item) : ''}
      ${item.status === 'error' && item.error ? `<div class="queue-item-error">${escapeHtml(item.error)}</div>` : ''}
      ${item.status === 'error' && item.technicalDetails ? `<details class="qi-diag"><summary>Log técnico</summary><pre class="diag-pre mono">${escapeHtml(item.technicalDetails)}</pre></details>` : ''}
      ${item.status === 'downloading' ? `<div class="qi-bar-wrap"><div class="qi-bar" style="width:${pct}%"></div></div>` : ''}
    </div>
    <span class="queue-item-status spill ${QUEUE_STATUS_CLASS[item.status] || 'status-pending'}">${queuePillHtml(item)}</span>
    ${item.status === 'error' && !queueRunning ? `<button class="btn-queue-act btn-retry-item" data-id="${item.id}" title="Tentar de novo" aria-label="Tentar de novo">${ICO('refresh')}</button>` : ''}
    ${canEdit ? `<button class="btn-queue-act btn-remove-item" data-id="${item.id}" title="Remover" aria-label="Remover">${ICO('x')}</button>` : ''}`;
}

// Reordenar arrastando — só vale pros itens que ainda não começaram.
let queueDragId = null;
function attachQueueDnd(el, item) {
  if (queueRunning || item.status !== 'pending') return;
  el.draggable = true;
  el.addEventListener('pointerdown', e => {
    el.draggable = !e.target.closest('select, button, input, details, summary, .qi-controls, .qi-diag');
  });
  el.addEventListener('pointerup', () => {
    el.draggable = true;
  });
  el.addEventListener('dragstart', e => {
    if (e.target && e.target !== el && e.target.closest?.('select, button, input, details, summary, .qi-controls, .qi-diag')) {
      e.preventDefault();
      return;
    }
    queueDragId = item.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.id); } catch {}
  });
  el.addEventListener('dragend', () => {
    queueDragId = null;
    el.classList.remove('dragging');
    queueList.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
  });
  el.addEventListener('dragover', e => {
    if (!queueDragId || queueDragId === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop-target');
    if (!queueDragId || queueDragId === item.id) return;
    const from = downloadQueue.findIndex(i => i.id === queueDragId);
    const to   = downloadQueue.findIndex(i => i.id === item.id);
    if (from < 0 || to < 0) return;
    const [moved] = downloadQueue.splice(from, 1);
    downloadQueue.splice(to, 0, moved);
    renderQueue();
  });
}

function refreshQueueControls() {
  const pending = downloadQueue.filter(i => i.status === 'pending').length;
  const errors  = downloadQueue.filter(i => i.status === 'error').length;
  btnStartQueue.disabled = queueRunning || pending === 0;
  btnClearQueue.disabled = queueRunning;
  btnPauseQueue.classList.toggle('hidden', !queueRunning);
  btnCancelQueue.classList.toggle('hidden', !queueRunning);
  btnPauseQueue.innerHTML = queuePaused
    ? `${ICO('play')} Retomar`
    : `${ICO('pause')} Pausar`;
  btnRetryErrors.classList.toggle('hidden', queueRunning || errors === 0);
  if (errors) btnRetryErrors.lastChild.textContent = ` Repetir ${errors} falha${errors > 1 ? 's' : ''}`;
}

function renderQueue() {
  queueList.innerHTML = '';
  // Conta só o que ainda falta: com o total, o badge continuava marcando "20"
  // depois de uma fila de 20 terminar, como se houvesse 20 coisas pendentes.
  const waiting = downloadQueue.filter(i => i.status === 'pending' || i.status === 'downloading').length;
  queueEmpty.classList.toggle('hidden', downloadQueue.length !== 0);
  queueBadge.classList.toggle('hidden', waiting === 0);
  queueBadge.textContent = waiting;
  downloadQueue.forEach(item => {
    const el = document.createElement('div');
    el.className = `queue-item qi-${item.status}`;
    el.id = `qi-${item.id}`;
    el.innerHTML = queueItemBody(item);
    attachQueueDnd(el, item);
    queueList.appendChild(el);
  });
  refreshQueueControls();
  persistQueue();
}

function updateQueueItem(id, patch) {
  const item = downloadQueue.find(i => i.id === id);
  if (!item) return;
  const statusChanged = patch.status && patch.status !== item.status;
  Object.assign(item, patch);
  const el = document.getElementById(`qi-${id}`);
  if (!el || statusChanged) { renderQueue(); persistQueue(); return; }

  // Só os nós que mudaram. Reescrever o innerHTML a cada evento de progresso
  // (vários por segundo, vezes a concorrência) destruía e recriava a barra,
  // então a transição CSS nunca rodava e o preenchimento pulava aos saltos.
  const pct = item.percent != null ? item.percent : 0;
  const bar = el.querySelector('.qi-bar');
  if (bar) bar.style.width = `${pct}%`;
  const meta = el.querySelector('.queue-item-meta');
  if (meta) meta.textContent = queueItemMetaText(item);
  const st = el.querySelector('.queue-item-status');
  if (st) st.innerHTML = queuePillHtml(item);
}

// Listeners delegados pra lista inteira (controles inline, expandir, repetir e remover).
queueList.addEventListener('change', (e) => {
  const sel = e.target.closest('.qi-sel');
  if (!sel || queueRunning) return;
  const item = downloadQueue.find(i => i.id === sel.dataset.id);
  if (!item || item.status !== 'pending') return;
  const prop = sel.dataset.prop;
  item[prop] = sel.value;
  item.defaultFmt = false;
  if (prop === 'format' && !item.container) item.container = 'mp4';
  renderQueue();
});

queueList.addEventListener('click', async (e) => {
  const remove = e.target.closest('.btn-remove-item');
  if (remove) {
    downloadQueue = downloadQueue.filter(i => i.id !== remove.dataset.id);
    renderQueue();
    return;
  }
  const retry = e.target.closest('.btn-retry-item');
  if (retry) {
    const item = downloadQueue.find(i => i.id === retry.dataset.id);
    if (!item) return;
    Object.assign(item, { status: 'pending', error: '', technicalDetails: '', percent: 0, speed: '', eta: '' });
    renderQueue();
    return;
  }
  const expandBtn = e.target.closest('.btn-expand-item');
  if (expandBtn && !queueRunning && window.electronAPI.expandQueueItems) {
    const item = downloadQueue.find(i => i.id === expandBtn.dataset.id);
    if (!item || item.status !== 'pending' || item.expanding) return;
    item.expanding = true;
    renderQueue();
    let res;
    try {
      res = await window.electronAPI.expandQueueItems({ url: item.url });
    } catch (err) {
      res = { success: false, error: err?.message || 'Falha ao expandir itens.' };
    }
    const idx = downloadQueue.findIndex(i => i.id === item.id);
    if (idx < 0 || queueRunning) return;
    delete item.expanding;
    if (!res?.success || !Array.isArray(res.items) || !res.items.length) {
      renderQueue();
      showErrorToast(res || { error: 'Não foi possível expandir os itens.' });
      return;
    }
    const existing = new Set(downloadQueue.filter(x => x.id !== item.id).map(x => x.url));
    const expanded = [];
    for (const entry of res.items) {
      if (!entry?.url || existing.has(entry.url)) continue;
      existing.add(entry.url);
      expanded.push({
        id: uid(),
        url: entry.url,
        title: entry.title || entry.url,
        format: item.format || 'video',
        quality: item.quality || 'best',
        container: item.container || 'mp4',
        videoCodec: item.videoCodec || 'auto',
        audioLang: item.audioLang || 'auto',
        isSpotify: !!entry.isSpotify,
        spFormat: item.spFormat || 'mp3',
        spQuality: item.spQuality || '320k',
        defaultFmt: false,
        status: 'pending',
        isPlaylist: false,
      });
    }
    if (!expanded.length) {
      renderQueue();
      showToast('Todos os itens desse link já estavam na fila.', 'info', 3000);
      return;
    }
    downloadQueue.splice(idx, 1, ...expanded);
    renderQueue();
    showToast(`${expanded.length} itens expandidos na fila!`, 'success', 3200);
  }
});

// Um caminho só pra tudo que entra na fila (botão "+", Enter e colar em lote),
// já ignorando link repetido — dois itens com a mesma URL baixariam o mesmo
// arquivo ao mesmo tempo e escreveriam por cima um do outro.
function addLinksToQueue(raw) {
  const links = String(raw || '').split(/[\s,]+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
  if (!links.length) return 0;
  const existing = new Set(downloadQueue.map(i => i.url));
  let added = 0, dups = 0;
  links.forEach(url => {
    if (existing.has(url)) { dups++; return; }
    existing.add(url);
    const item = { id: uid(), url, format: getRadio('q-fmt'), quality: document.getElementById('q-quality').value, status: 'pending', defaultFmt: true };
    const srcType = detectSource(url)?.type;
    if (srcType === 'youtube-playlist') {
      item.isPlaylist = true;
      fetchQueuePlaylistMeta(item.id, url);
    } else if (srcType === 'spotify') {
      item.isSpotify = true;
      item.spFormat = 'mp3';
      item.spQuality = '320k';
      fetchQueueSpotifyMeta(item.id, url);
    }
    downloadQueue.push(item);
    added++;
  });
  if (added) renderQueue();
  if (added && dups)      showToast(`${added} adicionado(s) — ${dups} já estava(m) na fila.`, 'info', 3200);
  else if (added > 1)     showToast(`${added} links adicionados à fila.`, 'success', 2800);
  else if (added === 1)   showToast('Link adicionado à fila.', 'info', 2000);
  else if (dups)          showToast('Esse link já está na fila.', 'warning', 2600);
  return added;
}

const queueUrlInput = document.getElementById('queue-url');
document.getElementById('btn-add-to-queue').addEventListener('click', () => {
  if (addLinksToQueue(queueUrlInput.value)) queueUrlInput.value = '';
});
// Enter adiciona (Shift+Enter continua quebrando linha, pro caso de colar
// vários na mão). Antes, apertar Enter aqui simplesmente não fazia nada.
queueUrlInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  if (addLinksToQueue(queueUrlInput.value)) queueUrlInput.value = '';
});

// Colar vários links de uma vez (um por linha, ou separados por espaço/vírgula)
// já joga todos na fila direto, sem precisar clicar "+" um por um.
queueUrlInput.addEventListener('paste', (e) => {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const links = text.split(/[\s,]+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
  if (links.length < 2) return; // um link só (ou nenhum) — deixa colar normal no campo
  e.preventDefault();
  addLinksToQueue(text);
  queueUrlInput.value = '';
});

// Um item colado/adicionado antes de você escolher MP3 (ou mudar a
// qualidade) ficava "preso" no formato que estava selecionado no momento
// em que foi colado — então trocar pra MP3 depois de colar vários links
// não tinha efeito nos que já estavam na fila, e eles baixavam em MP4
// mesmo com MP3 selecionado na hora de iniciar. Itens adicionados por aqui
// (colar/"+") acompanham a seleção atual até começarem a baixar; um item
// adicionado a partir da pré-visualização de um vídeo específico (aba
// principal, botão "Adicionar à fila") mantém o formato escolhido ali e
// não é afetado por essa sincronização.
function syncPendingQueueDefaults() {
  const fmt = getRadio('q-fmt');
  const quality = document.getElementById('q-quality').value;
  let changed = false;
  downloadQueue.forEach(item => {
    if (item.status === 'pending' && item.defaultFmt) {
      if (item.format !== fmt || item.quality !== quality) changed = true;
      item.format = fmt;
      item.quality = quality;
    }
  });
  if (changed) renderQueue();
}
document.querySelectorAll('input[name="q-fmt"]').forEach(r => r.addEventListener('change', syncPendingQueueDefaults));
document.getElementById('q-quality').addEventListener('change', syncPendingQueueDefaults);

document.getElementById('btn-add-queue').addEventListener('click', () => {
  if (!currentUrl) return;
  downloadQueue.push({
    id: uid(), url: currentUrl, format: getRadio('fmt'),
    quality: document.getElementById('quality').value,
    container: document.getElementById('dl-container')?.value || 'mp4',
    videoCodec: document.getElementById('dl-vcodec')?.value || 'auto',
    audioLang: document.getElementById('dl-audiolang')?.value || 'auto',
    title: document.getElementById('video-title').textContent, status: 'pending'
  });
  renderQueue();
  showToast('Adicionado à fila!', 'info', 2000);
  document.querySelector('.tab[data-tab="queue"]').click();
});

btnClearQueue.addEventListener('click', () => {
  if (queueRunning || !downloadQueue.length) return;
  // A fila é salva em disco e pode ter sido montada ao longo do dia — um
  // clique errado aqui destruía tudo sem confirmação e sem volta.
  const n = downloadQueue.length;
  if (!confirm(`Limpar a fila inteira (${n} ${n === 1 ? 'item' : 'itens'})?`)) return;
  const backup = downloadQueue.slice();
  downloadQueue = [];
  renderQueue();
  queueStatus.classList.add('hidden');
  showToast(`Fila limpa (${n} ${n === 1 ? 'item' : 'itens'}).`, 'info', 9000, {
    label: 'Desfazer',
    pendingLabel: 'Restaurando...',
    onClick: () => { downloadQueue = backup; renderQueue(); showToast('Fila restaurada.', 'success', 2200); },
  });
});

// Cancelar de verdade: interrompe o que está baixando e descarta o resto.
// Antes, uma fila iniciada por engano não tinha saída a não ser fechar o app —
// "Pausar" só segura os próximos e "Limpar" fica desabilitado enquanto roda.
btnCancelQueue.addEventListener('click', async () => {
  if (!queueRunning) return;
  if (!confirm('Cancelar a fila? Os downloads em andamento são interrompidos e os que ainda não começaram saem da fila.')) return;
  queueCanceled = true;
  queuePaused = false;
  const running = downloadQueue.filter(i => i.status === 'downloading');
  await Promise.all(running.map(i => {
    const fn = (i.isSpotify || detectSource(i.url)?.type === 'spotify')
      ? window.electronAPI.cancelSpotify
      : window.electronAPI.cancelDownload;
    return fn(i.id).catch(() => {});
  }));
  downloadQueue.forEach(i => {
    if (i.status === 'pending' || i.status === 'downloading') {
      Object.assign(i, { status: 'error', error: 'Cancelado', percent: 0, speed: '', eta: '' });
    }
  });
  renderQueue();
  showToast('Fila cancelada.', 'warning', 3000);
});

// Pausar não interrompe o que já está baixando (cortar no meio jogaria fora o
// progresso do arquivo) — segura só os próximos da fila.
btnPauseQueue.addEventListener('click', () => {
  if (!queueRunning) return;
  queuePaused = !queuePaused;
  refreshQueueControls();
  showToast(queuePaused
    ? 'Fila pausada — os downloads em andamento terminam e os próximos ficam esperando.'
    : 'Fila retomada.', queuePaused ? 'warning' : 'info', 3500);
});

btnRetryErrors.addEventListener('click', () => {
  if (queueRunning) return;
  let n = 0;
  downloadQueue.forEach(item => {
    if (item.status !== 'error') return;
    Object.assign(item, { status: 'pending', error: '', percent: 0, speed: '', eta: '' });
    n++;
  });
  if (!n) return;
  renderQueue();
  showToast(`${n} ${n === 1 ? 'item voltou' : 'itens voltaram'} pra fila — clique em "Iniciar Fila".`, 'info', 3500);
});

// Enquanto pausada, os workers ficam parados aqui entre um item e outro.
function waitWhileQueuePaused() {
  if (!queuePaused) return Promise.resolve();
  return new Promise(resolve => {
    const tick = () => ((queuePaused && !queueCanceled) ? setTimeout(tick, 300) : resolve());
    tick();
  });
}

async function runQueueWorker(pending, folder, doneRef) {
  while (true) {
    await waitWhileQueuePaused();
    if (queueCanceled) break;
    const item = pending.shift();
    if (!item) break;
    if (item.status !== 'pending') continue;
    const dlId = item.id;
    updateQueueItem(dlId, { status: 'downloading', percent: 0 });

    window.electronAPI.onDownloadProgressById(dlId, (data) => {
      if (data.type === 'progress') {
        updateQueueItem(dlId, { percent: data.percent, speed: data.speed, eta: data.eta });
      } else if (data.type === 'converting') {
        updateQueueItem(dlId, { percent: 95, speed: '', eta: data.label || 'Convertendo...' });
      } else if (data.type === 'merging') {
        updateQueueItem(dlId, { percent: 97, speed: '', eta: data.label || 'Mesclando...' });
      }
    });

    try {
      const srcType = detectSource(item.url)?.type;
      let result;
      if (item.isSpotify || srcType === 'spotify') {
        const spFmt = item.spFormat || (['mp3', 'flac', 'm4a', 'ogg'].includes(String(item.format || '').toLowerCase()) ? item.format : 'mp3');
        result = await window.electronAPI.spotifyDownload({
          url: item.url,
          format: spFmt,
          quality: item.spQuality || item.quality || '320k',
          downloadId: dlId,
          savePath: folder,
          silentGlobalProgress: true,
        });
      } else if (item.isPlaylist || srcType === 'youtube-playlist') {
        result = await window.electronAPI.downloadPlaylist({
          url: item.url,
          format: item.format,
          quality: item.quality,
          container: item.container || 'mp4',
          videoCodec: item.videoCodec || 'auto',
          useCookies: lastUsedCookies,
          downloadId: dlId,
          concurrency: 2,
          accelerate: true,
          savePath: folder,
          silentGlobalProgress: true,
        });
      } else {
        result = await window.electronAPI.downloadVideo({
          url: item.url,
          format: item.format,
          quality: item.quality,
          container: item.container || 'mp4',
          videoCodec: item.videoCodec || 'auto',
          audioLang: item.audioLang || 'auto',
          useCookies: lastUsedCookies,
          downloadId: dlId,
          savePath: folder,
          accelerate: true,
          title: item.title,
          silentGlobalProgress: true,
        });
      }
      if (!result?.success && !queueCanceled) doneRef.errors++;
      updateQueueItem(dlId, {
        status: result?.success ? 'done' : 'error',
        percent: result?.success ? 100 : 0, speed: '', eta: '',
        error: result?.success ? '' : (result?.error || 'Falhou'),
        technicalDetails: result?.success ? '' : (result?.technicalDetails || ''),
      });
    } catch (e) {
      if (!queueCanceled) doneRef.errors++;
      updateQueueItem(dlId, { status: 'error', percent: 0, speed: '', eta: '', error: e.message });
    } finally {
      window.electronAPI.removeDownloadProgressById(dlId);
      doneRef.count++;
      // O total é o do lote iniciado — antes usava downloadQueue.length, que
      // conta também itens já concluídos de rodadas anteriores e fazia a barra
      // parar em 40% numa fila que terminou inteira.
      setProgress(queueBar, null, (doneRef.count / doneRef.total) * 100, '');
      queueText.textContent = `${doneRef.count} / ${doneRef.total} concluídos${queuePaused ? ' · pausada' : ''}`;
    }
  }
}

let activeQueueSchedule = null;
let scheduleTickTimer = null;

function renderQueueSchedule() {
  const timeInput = document.getElementById('queue-schedule-time');
  const btnSched  = document.getElementById('btn-schedule-queue');
  const btnCancel = document.getElementById('btn-cancel-schedule');
  const statusEl  = document.getElementById('queue-schedule-status');
  if (!timeInput || !btnSched || !btnCancel || !statusEl) return;

  if (scheduleTickTimer) { clearInterval(scheduleTickTimer); scheduleTickTimer = null; }

  if (!activeQueueSchedule) {
    btnSched.innerHTML = `${ICO('clock')} Agendar fila`;
    btnCancel.classList.add('hidden');
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
    if (!timeInput.value) {
      const def = new Date(Date.now() + 30 * 60 * 1000);
      timeInput.value = `${String(def.getHours()).padStart(2, '0')}:${String(def.getMinutes()).padStart(2, '0')}`;
    }
    return;
  }

  timeInput.value = activeQueueSchedule.time || '';
  btnSched.innerHTML = `${ICO('clock')} Atualizar horário`;
  btnCancel.classList.remove('hidden');
  statusEl.classList.remove('hidden');

  const updateText = () => {
    if (!activeQueueSchedule) return;
    const leftMs = Math.max(0, Number(activeQueueSchedule.targetAt) - Date.now());
    const dayNote = activeQueueSchedule.tomorrow ? ' (amanhã)' : '';
    const folderTail = String(activeQueueSchedule.folder || '').split(/[\\/]/).filter(Boolean).pop() || activeQueueSchedule.folder;
    statusEl.textContent = `Agendada para ${activeQueueSchedule.time}${dayNote} · começa ${formatCountdownMs(leftMs)} · pasta: ${folderTail}`;
  };
  updateText();
  scheduleTickTimer = setInterval(updateText, 1000);
}

async function startQueueWithFolder(providedFolder = null, { isScheduled = false } = {}) {
  if (queueRunning) return false;
  const pending = downloadQueue.filter(i => i.status === 'pending');
  if (!pending.length) return false;

  queueRunning = true;
  queuePaused = false;
  queueCanceled = false;
  refreshQueueControls();
  queueStatus.classList.remove('hidden');
  resetBar(queueBar, queueText);
  queueText.textContent = providedFolder ? 'Preparando fila...' : 'Aguardando pasta...';

  const folder = providedFolder || await window.electronAPI.chooseFolder();
  if (!folder) {
    queueRunning = false;
    refreshQueueControls();
    queueStatus.classList.add('hidden');
    return false;
  }

  if (window.electronAPI.checkDiskSpace) {
    try {
      const disk = await window.electronAPI.checkDiskSpace({ targetPath: folder, estimatedBytes: 0 });
      if (disk?.critical && !isScheduled) {
        if (!confirm(`${disk.message}\n\nPasta: ${folder}\n\nDeseja iniciar a fila mesmo assim?`)) {
          queueRunning = false;
          refreshQueueControls();
          queueStatus.classList.add('hidden');
          return false;
        }
      } else if (disk?.warnOnly || (disk?.critical && isScheduled)) {
        showToast(disk.message, 'warning', 6000);
      }
    } catch {}
  }

  if (!isScheduled && activeQueueSchedule && window.electronAPI.setQueueSchedule) {
    activeQueueSchedule = null;
    window.electronAPI.setQueueSchedule(null).catch(() => {});
    renderQueueSchedule();
  }

  const concurrency = parseInt(concurrencySelect?.value || '2', 10);
  const doneRef = { count: 0, total: pending.length, errors: 0 };
  queueText.textContent = `0 / ${pending.length} concluídos — ${concurrency} paralelos`;
  renderQueue();

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () =>
    runQueueWorker(pending, folder, doneRef)
  );
  await Promise.all(workers);

  const wasCanceled = queueCanceled;
  queueRunning = false;
  queuePaused = false;
  queueCanceled = false;

  if (wasCanceled) {
    queueBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
    queueText.textContent = 'Fila cancelada.';
    renderQueue();
    return true;
  }

  queueBar.style.width = '100%';
  queueBar.style.background = 'linear-gradient(90deg, var(--success), #34d399)';
  const errors = doneRef.errors || 0;
  const ok     = Math.max(0, doneRef.total - errors);
  queueText.textContent = errors
    ? `${ok} baixados · ${errors} com erro — use "Repetir falhas" pra tentar de novo`
    : `Todos os ${doneRef.total} downloads concluídos!`;
  showToast(errors ? `Fila concluída com ${errors} erro(s).` : `Fila concluída — ${doneRef.total} downloads!`, errors ? 'warning' : 'success');
  renderQueue();

  const queueOnFinish = document.getElementById('queue-on-finish');
  if (queueOnFinish && queueOnFinish.value !== 'none' && ok > 0 && !wasCanceled) {
    const action = queueOnFinish.value;
    const actionLabel = action === 'shutdown'
      ? 'O computador será desligado em 6 segundos.'
      : 'O computador será suspenso em 6 segundos.';
    let powerCanceled = false;
    const timer = setTimeout(() => {
      if (!powerCanceled) window.electronAPI.executePowerAction(action);
    }, 6000);
    showToast(actionLabel, 'warning', 6200, {
      label: 'Cancelar ação',
      pendingLabel: 'Cancelado',
      onClick: () => {
        powerCanceled = true;
        clearTimeout(timer);
        showToast('Ação de energia cancelada.', 'info', 2500);
      }
    });
  }
  return true;
}

btnStartQueue.addEventListener('click', () => startQueueWithFolder());

document.getElementById('btn-schedule-queue')?.addEventListener('click', async () => {
  if (queueRunning || !window.electronAPI.setQueueSchedule) return;
  if (!downloadQueue.some(i => i.status === 'pending')) {
    showToast('Adicione pelo menos um item pendente à fila antes de agendar.', 'warning', 3500);
    return;
  }
  const time = document.getElementById('queue-schedule-time')?.value;
  if (!time) {
    showToast('Escolha um horário para agendar.', 'warning', 3000);
    return;
  }
  const res = await window.electronAPI.setQueueSchedule({ time });
  if (res?.canceled) return;
  if (!res?.ok) {
    showToast(res?.error || 'Não foi possível agendar.', 'error', 4000);
    return;
  }
  activeQueueSchedule = res.schedule;
  renderQueueSchedule();
  showToast(`Fila agendada para as ${res.schedule.time}!`, 'success', 3500);
});

document.getElementById('btn-cancel-schedule')?.addEventListener('click', async () => {
  if (!window.electronAPI.setQueueSchedule) return;
  await window.electronAPI.setQueueSchedule(null);
  activeQueueSchedule = null;
  renderQueueSchedule();
  showToast('Agendamento cancelado.', 'info', 2500);
});

if (window.electronAPI.onTriggerScheduledQueue) {
  window.electronAPI.onTriggerScheduledQueue(async ({ folder, time }) => {
    activeQueueSchedule = null;
    renderQueueSchedule();
    if (!queueRunning && downloadQueue.some(i => i.status === 'pending')) {
      document.querySelector('.tab[data-tab="queue"]')?.click();
      showToast(`Horário agendado (${time}) chegou — iniciando a fila!`, 'info', 4500);
      await startQueueWithFolder(folder, { isScheduled: true });
    } else if (!queueRunning) {
      showToast(`Horário agendado (${time}) chegou, mas não há itens pendentes na fila.`, 'warning', 5000);
    }
  });
}

if (window.electronAPI.onQueueScheduleExpired) {
  window.electronAPI.onQueueScheduleExpired(({ time }) => {
    activeQueueSchedule = null;
    renderQueueSchedule();
    showToast(`O agendamento das ${time} expirou enquanto o app estava fechado.`, 'warning', 6000);
  });
}

renderQueue();
restoreQueue();
window.electronAPI.getQueueSchedule?.().then(s => { activeQueueSchedule = s; renderQueueSchedule(); }).catch(() => { renderQueueSchedule(); });

// ── History ───────────────────────────────────────────────────────────────────
let allHistory = [];
const historySearchInput  = document.getElementById('history-search');
const historyStatusFilter = document.getElementById('history-status-filter');
const historyTypeFilter   = document.getElementById('history-type-filter');
const historySourceFilter = document.getElementById('history-source-filter');

// A origem (YouTube/Spotify/TikTok...) não fica salva no histórico — reusa o
// mesmo detectSource() já usado no resto do app pra descobrir a partir da URL.
function historyItemSourceLabel(item) {
  const src = detectSource(item.url);
  if (!src) return 'Outro';
  if (src.type === 'youtube-playlist') return SOURCES.youtube.label;
  return src.label;
}

function populateHistorySourceFilter(history) {
  const labels = [...new Set(history.map(historyItemSourceLabel))].sort();
  const current = historySourceFilter.value;
  historySourceFilter.innerHTML = '<option value="">Todas as origens</option>';
  labels.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    historySourceFilter.appendChild(opt);
  });
  if (labels.includes(current)) historySourceFilter.value = current;
}

function renderHistoryItems(list) {
  const historyList  = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');

  historyList.innerHTML = '';
  const cnt = document.getElementById('history-count');
  if (cnt) cnt.textContent = allHistory.length ? `${allHistory.length} download${allHistory.length > 1 ? 's' : ''} registrado${allHistory.length > 1 ? 's' : ''}${list.length !== allHistory.length ? ` · ${list.length} no filtro` : ''}` : 'Nada registrado ainda';
  const clr = document.getElementById('btn-clear-history');
  if (clr) clr.classList.toggle('hidden', allHistory.length === 0);
  if (list.length === 0) {
    historyEmpty.querySelector('p').textContent = allHistory.length === 0
      ? 'Nenhum download registrado ainda'
      : 'Nenhum resultado pra esse filtro';
    historyEmpty.classList.remove('hidden');
    return;
  }
  historyEmpty.classList.add('hidden');

  list.forEach(item => {
    const el = document.createElement('div');
    el.className = `history-item${item.status === 'success' ? '' : ' qi-error'}`;
    const rawFmt = String(item.format || '').toLowerCase();
    const isAudio = AUDIO_FORMATS.has(rawFmt);
    const kind = isAudio
      ? `${rawFmt === 'audio' ? 'MP3' : rawFmt.toUpperCase()}${item.quality && !['best', 'lossless'].includes(item.quality) ? ' ' + item.quality : ''}`
      : `MP4${item.quality && item.quality !== 'best' ? ' ' + item.quality + 'p' : ''}`;
    el.innerHTML = `
      <div class="mini${isAudio ? ' sq' : ''}" style="--ah:${srcHue(item.url)}" aria-hidden="true"></div>
      <div class="history-info">
        <div class="history-title">${escapeHtml(item.title || item.url)}</div>
        <div class="history-meta">${escapeHtml(historyItemSourceLabel(item))} · ${kind} · ${fmtDate(item.date)}</div>
      </div>
      ${item.status === 'success' ? '' : '<span class="spill err"><i></i>Erro</span>'}
      <button class="history-open history-copy" title="Copiar link original" aria-label="Copiar link original">${ICO('copy')}</button>
      <button class="history-open history-requeue" title="${item.status === 'success' ? 'Baixar de novo (manda pra fila)' : 'Tentar de novo (manda pra fila)'}" aria-label="Mandar pra fila">${ICO('refresh')}</button>
      ${item.folder ? `<button class="history-open history-folder" title="Abrir pasta" aria-label="Abrir pasta">${ICO('folder')}</button>` : ''}`;
    // Reenfileirar serve tanto pra repetir um download que falhou quanto pra
    // baixar de novo algo que já deu certo (outra pasta, arquivo apagado...).
    el.querySelector('.history-requeue').addEventListener('click', () => {
      const srcType = detectSource(item.url)?.type;
      const spFmt = ['mp3', 'flac', 'm4a', 'ogg'].includes(rawFmt) ? rawFmt : 'mp3';
      downloadQueue.push({
        id: uid(), url: item.url, title: item.title,
        format: isAudio ? 'audio' : 'video',
        quality: item.quality || 'best',
        isPlaylist: srcType === 'youtube-playlist',
        isSpotify: srcType === 'spotify',
        spFormat: srcType === 'spotify' ? spFmt : undefined,
        spQuality: srcType === 'spotify' ? (item.quality || '320k') : undefined,
        status: 'pending',
      });
      renderQueue();
      document.querySelector('.tab[data-tab="queue"]').click();
      showToast('Mandado pra fila — é só clicar em "Iniciar Fila".', 'info', 3500);
    });
    el.querySelector('.history-copy')?.addEventListener('click', async () => {
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(item.url);
        else await window.electronAPI.writeClipboardText(item.url);
        showToast('Link copiado para a área de transferência!', 'success', 2500);
      } catch {
        showToast('Não foi possível copiar o link.', 'error', 2500);
      }
    });
    if (item.folder) {
      el.querySelector('.history-folder')?.addEventListener('click', () => window.electronAPI.openFolder(item.folder));
    }
    historyList.appendChild(el);
  });
}

function applyHistoryFilters() {
  const q = historySearchInput.value.trim().toLowerCase();
  const status = historyStatusFilter.value;
  const source = historySourceFilter.value;
  const type = historyTypeFilter ? historyTypeFilter.value : '';
  const filtered = allHistory.filter(item => {
    if (q && !((item.title || '').toLowerCase().includes(q) || (item.url || '').toLowerCase().includes(q))) return false;
    if (status && item.status !== status) return false;
    if (source && historyItemSourceLabel(item) !== source) return false;
    const isAudio = AUDIO_FORMATS.has(String(item.format || '').toLowerCase());
    if (type === 'audio' && !isAudio) return false;
    if (type === 'video' && isAudio) return false;
    return true;
  });
  renderHistoryItems(filtered);
}

async function renderHistory() {
  allHistory = await window.electronAPI.getHistory();
  populateHistorySourceFilter(allHistory);
  applyHistoryFilters();
}

historySearchInput.addEventListener('input', applyHistoryFilters);
historyStatusFilter.addEventListener('change', applyHistoryFilters);
if (historyTypeFilter) historyTypeFilter.addEventListener('change', applyHistoryFilters);
historySourceFilter.addEventListener('change', applyHistoryFilters);

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  if (!confirm('Apagar todo o histórico?')) return;
  await window.electronAPI.clearHistory();
  renderHistory();
  showToast('Histórico apagado.', 'info', 2500);
});

// ── Settings ──────────────────────────────────────────────────────────────────
const settingsFolderInput = document.getElementById('settings-folder');
const settingsClipboardWatch = document.getElementById('settings-clipboard-watch');
const settingsTray = document.getElementById('settings-tray');
const settingsGlobalShortcut = document.getElementById('settings-global-shortcut');
const settingsLimitRate = document.getElementById('settings-limit-rate');
const settingsLimitUnit = document.getElementById('settings-limit-unit');
const settingsSubsMode      = document.getElementById('settings-subs-mode');
const settingsSubsLangs     = document.getElementById('settings-subs-langs');
const settingsSubsAuto      = document.getElementById('settings-subs-auto');
const settingsSubsExtra     = document.getElementById('settings-subs-extra');
const settingsSubsAutoRow   = document.getElementById('settings-subs-auto-row');
const settingsSponsorblock  = document.getElementById('settings-sponsorblock');
const settingsEmbedChapters = document.getElementById('settings-embed-chapters');
const settingsEmbedThumbnail = document.getElementById('settings-embed-thumbnail');
const settingsOutputTemplate= document.getElementById('settings-output-template');

// Idioma e "legendas automáticas" só fazem sentido com legendas ligadas.
function syncSubsRows() {
  const on = settingsSubsMode.value !== 'off';
  const rev = document.getElementById('settings-subs-reveal');
  if (rev) rev.classList.toggle('open', on);
  else { settingsSubsExtra.classList.toggle('hidden', !on); settingsSubsAutoRow.classList.toggle('hidden', !on); }
}
settingsSubsMode.addEventListener('change', syncSubsRows);
let clipboardWatchEnabled = true;

// O limite fica salvo já no formato do yt-dlp ("2M", "500K"); na tela ele é
// separado em número + unidade pra não obrigar ninguém a decorar isso.
function parseLimitRate(raw) {
  const m = String(raw || '').trim().match(/^([\d.]+)\s*([KM])$/i);
  if (!m) return { value: '', unit: 'M' };
  return { value: m[1], unit: m[2].toUpperCase() };
}
function buildLimitRate() {
  const n = parseFloat(settingsLimitRate.value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n}${settingsLimitUnit.value}`;
}

async function loadSettingsUI() {
  const s = await window.electronAPI.getSettings();
  settingsFolderInput.value = s.defaultFolder || '';
  clipboardWatchEnabled = s.clipboardWatch !== false; // default on
  settingsClipboardWatch.checked = clipboardWatchEnabled;
  settingsTray.checked = s.trayEnabled !== false; // default on
  settingsGlobalShortcut.checked = s.globalShortcutEnabled !== false; // default on
  const limit = parseLimitRate(s.limitRate);
  settingsLimitRate.value = limit.value;
  settingsLimitUnit.value = limit.unit;

  settingsSubsMode.value = s.subsMode || 'off';
  settingsSubsLangs.value = s.subsLangs || '';
  settingsSubsAuto.checked = s.subsAuto !== false;
  settingsSponsorblock.value = s.sponsorblock || 'off';
  settingsEmbedChapters.checked = s.embedChapters !== false;
  if (settingsEmbedThumbnail) settingsEmbedThumbnail.checked = s.embedThumbnail !== false;
  const settingsVideoCodec = document.getElementById('settings-video-codec');
  if (settingsVideoCodec) settingsVideoCodec.value = s.defaultVideoCodec || 'auto';
  const dlVcodec = document.getElementById('dl-vcodec');
  if (dlVcodec && !dlVcodec.dataset.userChanged) dlVcodec.value = s.defaultVideoCodec || 'auto';
  // Um template salvo que não esteja na lista (versão futura, edição manual do
  // settings.json) vira uma opção a mais em vez de sumir da tela.
  const tpl = s.outputTemplate || '%(title)s';
  if (![...settingsOutputTemplate.options].some(o => o.value === tpl)) {
    const opt = document.createElement('option');
    opt.value = tpl; opt.textContent = tpl;
    settingsOutputTemplate.appendChild(opt);
  }
  settingsOutputTemplate.value = tpl;
  syncSubsRows();
  window.dispatchEvent(new Event('gdl-settings-loaded'));
}

if (window.electronAPI.getGlobalShortcut) {
  window.electronAPI.getGlobalShortcut().then(accel => {
    const label = document.getElementById('settings-shortcut-label');
    if (label && accel) label.textContent = `(${accel.replace('CommandOrControl', 'Ctrl')})`;
  }).catch(() => {});
}

document.getElementById('btn-pick-folder').addEventListener('click', async () => {
  const folder = await window.electronAPI.chooseFolder();
  if (folder) { settingsFolderInput.value = folder; settingsFolderInput.dispatchEvent(new Event('input', { bubbles: true })); }
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  // Merge into the existing settings instead of replacing the whole file —
  // saveSettings used to be called with only { defaultFolder }, which wiped
  // out cookieBrowser (breaking "Conectar") and everything else stored here.
  const current = await window.electronAPI.getSettings();
  clipboardWatchEnabled = settingsClipboardWatch.checked;
  await window.electronAPI.saveSettings({
    ...current,
    defaultFolder: settingsFolderInput.value,
    clipboardWatch: clipboardWatchEnabled,
    trayEnabled: settingsTray.checked,
    globalShortcutEnabled: settingsGlobalShortcut.checked,
    limitRate: buildLimitRate(),
    subsMode: settingsSubsMode.value,
    subsLangs: settingsSubsLangs.value.trim(),
    subsAuto: settingsSubsAuto.checked,
    sponsorblock: settingsSponsorblock.value,
    embedChapters: settingsEmbedChapters.checked,
    embedThumbnail: settingsEmbedThumbnail ? settingsEmbedThumbnail.checked : true,
    defaultVideoCodec: document.getElementById('settings-video-codec')?.value || 'auto',
    embedMetadata: settingsEmbedChapters.checked,
    outputTemplate: settingsOutputTemplate.value,
  });
  const btn = document.getElementById('btn-save-settings');
  const orig = btn.textContent;
  btn.textContent = 'Salvo!';
  showToast('Configurações salvas.', 'success', 2000);
  window.dispatchEvent(new Event('gdl-settings-loaded'));
  setTimeout(() => { btn.textContent = orig; }, 2000);
});

const btnOpenExtensionFolder = document.getElementById('btn-open-extension-folder');
if (btnOpenExtensionFolder) {
  btnOpenExtensionFolder.addEventListener('click', async () => {
    const err = await window.electronAPI.openExtensionFolder();
    // shell.openPath resolves with '' on success and an error string on failure.
    if (err) showToast('Não consegui abrir a pasta da extensão: ' + err, 'error');
  });
}

const btnOpenExtensionFolderFirefox = document.getElementById('btn-open-extension-folder-firefox');
if (btnOpenExtensionFolderFirefox) {
  btnOpenExtensionFolderFirefox.addEventListener('click', async () => {
    const err = await window.electronAPI.openExtensionFirefoxFolder();
    if (err) showToast('Não consegui abrir a pasta da extensão: ' + err, 'error');
  });
}

const btnUpdate = document.getElementById('btn-update-ytdlp');
const updateLog = document.getElementById('update-log');
const ytdlpVersionLine = document.getElementById('ytdlp-version-line');

// Registrado uma vez só: antes isso ficava dentro do clique, então a segunda
// tentativa escrevia cada linha do log duas vezes, a terceira três...
window.electronAPI.onUpdateLog(txt => {
  updateLog.textContent += txt;
  updateLog.scrollTop = updateLog.scrollHeight;
});

btnUpdate.addEventListener('click', async () => {
  const originalHtml = btnUpdate.innerHTML;
  btnUpdate.disabled = true;
  btnUpdate.textContent = 'Atualizando...';
  updateLog.classList.remove('hidden');
  updateLog.textContent = '';

  const result = await window.electronAPI.updateYtdlp();

  btnUpdate.disabled = false;
  btnUpdate.innerHTML = originalHtml;
  if (result.success) {
    showToast(`yt-dlp atualizado${result.version ? ` para ${result.version}` : ''}!`, 'success');
    applyYtdlpUpdateStatus(null);
  } else {
    showToast(`Não consegui atualizar o yt-dlp: ${result.error || 'erro desconhecido'}`, 'error', 8000);
  }
  refreshRuntimeStatus();
});

// ── Status do sistema ─────────────────────────────────────────────────────────
// Um lugar só pra responder "está tudo no lugar?" sem precisar abrir log nenhum:
// versão do yt-dlp em uso (e de onde ela vem), ffmpeg, login, extensão — e o
// aviso de modo administrador, que é justamente o que costuma quebrar a
// extensão sem dar erro visível.
const statusGrid        = document.getElementById('status-grid');
const statusUserData    = document.getElementById('status-userdata');
const adminWarning      = document.getElementById('admin-warning');
const btnRefreshStatus  = document.getElementById('btn-refresh-status');
const btnRelaunchNormal = document.getElementById('btn-relaunch-normal');

function statusRowHtml(state, label, value) {
  return `<div class="status-row">
    <span class="status-dot ${state}"></span>
    <span class="status-label">${escapeHtml(label)}</span>
    <span class="status-value">${escapeHtml(value)}</span>
  </div>`;
}

function fmtRelative(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'agora há pouco';
  if (mins < 60) return `há ${mins} min`;
  if (mins < 60 * 24) return `há ${Math.floor(mins / 60)} h`;
  return `em ${d.toLocaleDateString('pt-BR')}`;
}

let lastRuntimeInfo = null;

async function refreshRuntimeStatus() {
  if (!window.electronAPI.getRuntimeInfo || !statusGrid) return;
  statusGrid.innerHTML = statusRowHtml('loading', 'Checando...', '');
  let info;
  try { info = await window.electronAPI.getRuntimeInfo(); }
  catch (e) { statusGrid.innerHTML = statusRowHtml('bad', 'Status', 'não consegui checar'); return; }
  lastRuntimeInfo = info;

  const rows = [];
  rows.push(statusRowHtml(
    info.ytdlpOk && info.ytdlpVersion ? 'ok' : 'bad',
    'yt-dlp',
    info.ytdlpVersion
      ? `${info.ytdlpVersion} · ${info.ytdlpManaged ? 'cópia atualizada pelo app' : 'cópia que veio no instalador'}`
      : 'não respondeu — pode ter sido bloqueado pelo antivírus'
  ));
  rows.push(statusRowHtml(
    info.ffmpegOk ? 'ok' : 'bad',
    'ffmpeg',
    info.ffmpegOk
      ? `${info.ffmpegVersion ? info.ffmpegVersion + ' · ' : ''}${info.ffmpegSource === 'system' ? 'versão do sistema (PATH)' : info.ffmpegSource === 'managed' ? 'cópia personalizada' : 'embutido no app'}`
      : 'não encontrado — pode ter sido bloqueado pelo antivírus'
  ));
  rows.push(statusRowHtml(
    info.cookiesConnected ? 'ok' : 'warn',
    'Login do YouTube',
    info.cookiesConnected
      ? `conectado${fmtRelative(info.cookiesUpdatedAt) ? ` · ${fmtRelative(info.cookiesUpdatedAt)}` : ''}`
      : 'desconectado (só é preciso pra vídeos restritos)'
  ));
  rows.push(statusRowHtml(
    info.extensionLastSeen ? 'ok' : 'warn',
    'Extensão do navegador',
    info.extensionLastSeen ? `falou com o app ${fmtRelative(info.extensionLastSeen)}` : 'nunca falou com o app'
  ));
  rows.push(statusRowHtml(
    info.bridgePort ? 'ok' : 'warn',
    'Bridge local da extensão',
    info.bridgePort ? `ativa em 127.0.0.1:${info.bridgePort}` : 'inativa (usando protocolo do navegador)'
  ));
  rows.push(statusRowHtml(
    info.diskFreeBytes == null ? 'warn' : info.diskFreeBytes < 500 * 1024 * 1024 ? 'bad' : info.diskFreeBytes < 2 * 1024 * 1024 * 1024 ? 'warn' : 'ok',
    'Espaço livre no destino',
    info.diskFreeBytes != null
      ? `${fmtSizeShort(info.diskFreeBytes)} disponíveis${info.diskPath ? ` (${info.diskPath})` : ''}`
      : 'não foi possível verificar'
  ));
  rows.push(statusRowHtml('ok', 'Versão do app', info.appVersion + (info.packaged ? '' : ' (modo desenvolvimento)')));
  statusGrid.innerHTML = rows.join('');

  statusUserData.textContent = `Dados do app: ${info.userDataPath}`;
  adminWarning.classList.toggle('hidden', !info.elevated);
  btnRelaunchNormal.classList.toggle('hidden', !info.packaged);

  if (ytdlpVersionLine) {
    ytdlpVersionLine.textContent = info.ytdlpVersion
      ? `Instalado: yt-dlp ${info.ytdlpVersion} — ${info.ytdlpManaged ? 'cópia mantida pelo app (atualiza sem administrador)' : 'cópia que veio no instalador'}.`
      : 'Não consegui ler a versão instalada do yt-dlp.';
  }
}

if (btnRefreshStatus) btnRefreshStatus.addEventListener('click', refreshRuntimeStatus);

if (btnRelaunchNormal) {
  btnRelaunchNormal.addEventListener('click', async () => {
    btnRelaunchNormal.disabled = true;
    btnRelaunchNormal.textContent = 'Reabrindo...';
    const r = await window.electronAPI.relaunchUnelevated();
    if (!r || !r.success) {
      btnRelaunchNormal.disabled = false;
      btnRelaunchNormal.textContent = 'Reabrir normal';
      showToast(`Não consegui reabrir sozinho: ${(r && r.error) || 'erro desconhecido'}. Feche o app e abra pelo atalho normal (sem "executar como administrador").`, 'error', 9000);
    }
  });
}

refreshRuntimeStatus();

// ── Checagem automática de yt-dlp desatualizado ─────────────────────────────
// O main process checa em segundo plano (ao abrir o app e a cada 24h) e manda
// o resultado aqui — só precisamos mostrar o aviso quando tiver novidade.
const settingsBadge = document.getElementById('settings-badge');
const ytdlpNote      = document.getElementById('ytdlp-update-note');

function applyYtdlpUpdateStatus(status) {
  if (!status || !status.success || !status.outdated) {
    settingsBadge.classList.add('hidden');
    ytdlpNote.classList.add('hidden');
    return;
  }
  settingsBadge.classList.remove('hidden');
  ytdlpNote.classList.remove('hidden');
  ytdlpNote.textContent = `Nova versão do yt-dlp disponível (${status.latest}) — você tem ${status.current}. Clique em "Verificar Atualização" abaixo; a atualização é baixada pra pasta do app e não pede administrador.`;
}
window.electronAPI.onYtdlpUpdateStatus(applyYtdlpUpdateStatus);

loadSettingsUI();

// O app abria sempre exigindo um clique no campo antes de colar o link.
setTimeout(() => urlInput?.focus(), 60);

// ── Login ─────────────────────────────────────────────────────────────────────
// "Conectar" mostra instruções pra usar a extensão do navegador (login
// real, no navegador de verdade — sem esbarrar no bloqueio do Chrome 127+
// nem em falsos-positivos de antivírus). A extensão manda os cookies de
// volta de forma assíncrona (ver onLoginCookiesReceived), então essa não é
// uma ação com resposta imediata. "Outro método" volta pro fluxo antigo de
// ler cookies direto de um navegador instalado, como fallback.
const btnLogin     = document.getElementById('btn-login');
const btnLoginAlt  = document.getElementById('btn-login-alt');
const btnLogout    = document.getElementById('btn-logout');
const loginStatus  = document.getElementById('login-status');

async function updateLogin() {
  const ok = await window.electronAPI.checkLogin();
  loginStatus.innerHTML = ok
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Conectado`
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Desconectado`;
  loginStatus.className = `login-badge ${ok ? 'green' : 'red'}`;
  btnLogin.textContent  = ok ? 'Reconectar' : 'Conectar';
  btnLogout.classList.toggle('hidden', !ok);
}

btnLogin.addEventListener('click', async () => {
  btnLogin.disabled = true;
  await window.electronAPI.loginYoutube(); // só mostra instruções; a conexão em si chega depois via evento
  btnLogin.disabled = false;
});

// Disparado quando a extensão manda cookies pelo protocolo customizado —
// pode acontecer bem depois do clique em "Conectar" (o usuário ainda
// precisa logar no navegador e clicar em "Conectar ao app" na extensão).
window.electronAPI.onLoginCookiesReceived(async ({ success, error }) => {
  await updateLogin();
  if (success) showToast('Conectado ao YouTube.', 'success', 3000);
  else showToast(error || 'Não foi possível conectar.', 'error', 7000);
});

if (btnLoginAlt) {
  btnLoginAlt.addEventListener('click', async () => {
    btnLoginAlt.disabled = true;
    const ok = await window.electronAPI.loginYoutubeBrowser();
    await updateLogin();
    btnLoginAlt.disabled = false;
    if (ok) showToast('Conectado via navegador instalado.', 'success', 3000);
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    await window.electronAPI.logoutYoutube();
    await updateLogin();
    btnLogout.disabled = false;
    showToast('Desconectado.', 'success', 2500);
  });
}

updateLogin();

// ── Spotify progress ──────────────────────────────────────────────────────────
function syncSpotifyBitrate() {
  const br = document.getElementById('sp-bitrate');
  if (!br) return;
  const lossless = getRadio('sp-fmt') === 'flac';
  br.disabled = lossless;
  br.title = lossless ? 'FLAC é sem perdas (não usa seletor de bitrate)' : '';
}
document.getElementsByName('sp-fmt').forEach(r => r.addEventListener('change', syncSpotifyBitrate));
syncSpotifyBitrate();

document.getElementById('btn-spotify-dl').addEventListener('click', async () => {
  const btnDl   = document.getElementById('btn-spotify-dl');
  const btnCnl  = document.getElementById('btn-spotify-cancel');
  if (!currentUrl || activeSpotifyId || btnDl.disabled) return;
  const spId = uid();
  activeSpotifyId = spId;
  const status  = document.getElementById('spotify-dl-status');
  const bar     = document.getElementById('spotify-dl-bar');
  const text    = document.getElementById('spotify-dl-text');
  const log     = document.getElementById('spotify-log');
  const btnOpen = document.getElementById('btn-spotify-open');

  clearDiagnosticBox('spotify');
  btnDl.disabled = true;
  btnCnl.disabled = false;
  btnCnl.classList.remove('hidden');
  btnOpen.classList.add('hidden');
  status.classList.remove('hidden');
  log.classList.remove('hidden');
  log.textContent = '';
  bar.style.width = '0%';
  bar.style.background = 'linear-gradient(90deg, #1DB954, #1ed760)';
  text.textContent = 'Preparando...';

  let result;
  try {
    result = await window.electronAPI.spotifyDownload({
      url: currentUrl,
      format:  getRadio('sp-fmt'),
      quality: document.getElementById('sp-bitrate').value,
      downloadId: spId
    });
  } catch (e) {
    result = { success: false, error: e?.message || 'Falha inesperada ao falar com o app.' };
  } finally {
    if (activeSpotifyId === spId) {
      activeSpotifyId = null;
      btnDl.disabled = false;
      btnCnl.disabled = false;
      btnCnl.classList.add('hidden');
    }
  }

  if (canceledUiIds.delete(spId)) return;
  if (activeSpotifyId && activeSpotifyId !== spId) return;

  if (result?.canceled) {
    status.classList.add('hidden');
    log.classList.add('hidden');
    bar.style.width = '0%';
    bar.style.background = '';
    text.textContent = '';
    return;
  }

  if (result.success) {
    bar.style.width = '100%';
    text.textContent = result.total > 1
      ? `${result.downloaded} de ${result.total} músicas baixadas!`
      : 'Download concluído!';
    lastSpotifyFolder = result.folder;
    btnOpen.classList.remove('hidden');
    showToast(`Spotify concluído — ${result.downloaded} música(s)!`, 'success');
  } else {
    bar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    text.textContent = result.error;
    showDiagnosticBox('spotify', result);
    showToast(result.error, 'error');
  }
});

document.getElementById('btn-spotify-cancel').addEventListener('click', async () => {
  if (!activeSpotifyId) return;
  const idToCancel = activeSpotifyId;
  canceledUiIds.add(idToCancel);
  const btnCnl = document.getElementById('btn-spotify-cancel');
  btnCnl.disabled = true;
  spotActiveSlots.clear();
  renderSpotSlots();
  try {
    await window.electronAPI.cancelSpotify(idToCancel);
  } finally {
    if (activeSpotifyId === idToCancel) activeSpotifyId = null;
    btnCnl.disabled = false;
    const bar  = document.getElementById('spotify-dl-bar');
    const text = document.getElementById('spotify-dl-text');
    bar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    text.textContent = 'Download cancelado.';
    document.getElementById('btn-spotify-dl').disabled = false;
    btnCnl.classList.add('hidden');
    showToast('Download do Spotify cancelado.', 'warning');
  }
});

document.getElementById('btn-spotify-open').addEventListener('click', () => {
  if (lastSpotifyFolder) window.electronAPI.openFolder(lastSpotifyFolder);
});

const spotActiveSlots = new Map();
function renderSpotSlots() {
  const el = document.getElementById('spotify-slots');
  if (!el) return;
  el.innerHTML = '';
  for (const [, slot] of spotActiveSlots) {
    const div = document.createElement('div');
    div.className = 'pl-slot';
    const parts = [slot.percent.toFixed(1) + '%'];
    if (slot.speed) parts.push(slot.speed);
    if (slot.eta)   parts.push(/^\d+:\d+/.test(slot.eta) ? 'ETA ' + slot.eta : slot.eta);
    div.innerHTML = `
      <div class="pl-slot-info">
        <span class="pl-slot-title">${escapeHtml(slot.title)}</span>
        <span class="pl-slot-meta">${parts.join(' · ')}</span>
      </div>
      <div class="pl-slot-bar-wrap"><div class="pl-slot-bar" style="width:${slot.percent}%"></div></div>`;
    el.appendChild(div);
  }
}

window.electronAPI.onSpotifyProgress(({ type, percent, label, downloaded, total, index, phase, speed, eta, title }) => {
  const bar  = document.getElementById('spotify-dl-bar');
  const text = document.getElementById('spotify-dl-text');
  if (!bar || !text) return;

  if (type === 'start') {
    bar.style.width = '0%'; text.textContent = 'Iniciando...';
    spotActiveSlots.clear(); renderSpotSlots();
  } else if (type === 'progress') {
    if (percent !== undefined) bar.style.width = `${percent}%`;
    text.textContent = label || `${downloaded || 0} / ${total || '?'}`;
  } else if (type === 'track-progress' && index !== undefined) {
    if (phase === 'downloading') {
      const prev = spotActiveSlots.get(index) || {};
      const speedEma = prev._speedEma || makeEma(0.2);
      const etaEma   = prev._etaEma   || makeEma(0.15);
      const sp = speedEma(parseSpeedMib(speed));
      const et = etaEma(parseEtaSec(eta));
      spotActiveSlots.set(index, {
        title, percent: percent || prev.percent || 0,
        speed: sp !== null ? fmtSpeed(sp) : '',
        eta:   et !== null ? fmtEta(et)   : '',
        _speedEma: speedEma, _etaEma: etaEma
      });
      renderSpotSlots();
    } else if (phase === 'converting') {
      const prev = spotActiveSlots.get(index) || { title };
      spotActiveSlots.set(index, { title: prev.title, percent: 95, speed: '', eta: 'Convertendo...' });
      renderSpotSlots();
    } else if (phase === 'done') {
      spotActiveSlots.delete(index); renderSpotSlots();
    }
  } else if (type === 'done') {
    bar.style.width = '100%'; spotActiveSlots.clear(); renderSpotSlots();
  }
});

window.electronAPI.onSpotifyLog(line => {
  const log = document.getElementById('spotify-log');
  if (log) { log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; }
});

// ── Converter ─────────────────────────────────────────────────────────────────
let convFilePath = null;
let convId = null;
let lastConvFolder = '';

const convFileNameInput = document.getElementById('conv-file-name');
const btnConvPick       = document.getElementById('btn-conv-pick');
const convOptions       = document.getElementById('conv-options');
const convContainerGrp  = document.getElementById('conv-container-group');
const convAudioFmtGrp   = document.getElementById('conv-audioformat-group');
const convVideoOpts     = document.getElementById('conv-video-opts');
const convAudioOpts     = document.getElementById('conv-audio-opts');
const convAudioFormatSel= document.getElementById('conv-audioformat');
const btnConvert        = document.getElementById('btn-convert');
const btnConvCancel     = document.getElementById('btn-conv-cancel');
const convStatus        = document.getElementById('conv-status');
const convBar           = document.getElementById('conv-bar');
const convText          = document.getElementById('conv-text');
const btnConvOpenFolder = document.getElementById('btn-conv-open-folder');

const convKindVideoOption = document.getElementById('conv-kind-video-option');
const convKindVideoRadio  = document.querySelector('input[name="conv-kind"][value="video"]');
const convKindAudioRadio  = document.querySelector('input[name="conv-kind"][value="audio"]');
const convAudioOnlyHint   = document.getElementById('conv-audio-only-hint');

// Friendly labels for the raw codec names ffmpeg reports (e.g. "h264" -> "H.264").
// Anything not in this list just gets shown uppercased as-is.
const CODEC_LABELS = {
  h264: 'H.264', avc1: 'H.264', hevc: 'H.265/HEVC', h265: 'H.265/HEVC',
  vp9: 'VP9', vp8: 'VP8', av1: 'AV1', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2',
  mjpeg: 'MJPEG', theora: 'Theora', prores: 'ProRes', wmv3: 'WMV', msmpeg4v3: 'MPEG-4',
  aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC',
  pcm_s16le: 'PCM', pcm_s24le: 'PCM', pcm_f32le: 'PCM', ac3: 'AC3', eac3: 'E-AC3', wmav2: 'WMA',
};
const codecLabel = (c) => c ? (CODEC_LABELS[c.toLowerCase()] || c.toUpperCase()) : null;

function formatConvDuration(sec) {
  if (sec == null) return null;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function formatConvSize(bytes) {
  if (bytes == null) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Shows the picked file's codec/format/resolution/duration/size as chips, so
// the user knows what they're actually converting before hitting go.
function renderConvFileInfo(info) {
  const box = document.getElementById('conv-file-info');
  if (!box) return;
  box.innerHTML = '';
  const chips = [];
  if (info) {
    if (info.format) chips.push(info.format);
    if (info.video) {
      let v = codecLabel(info.video.codec) || 'Vídeo';
      if (info.video.width && info.video.height) v += ` ${info.video.width}×${info.video.height}`;
      if (info.video.fps) v += ` ${Math.round(info.video.fps)}fps`;
      chips.push(v);
    }
    if (info.audio) {
      let a = codecLabel(info.audio.codec) || 'Áudio';
      if (info.audio.sampleRate) a += ` ${(info.audio.sampleRate / 1000).toFixed(1).replace('.0', '')}kHz`;
      if (info.audio.channels) a += ` ${info.audio.channels}`;
      chips.push(a);
    }
    const dur = formatConvDuration(info.duration);
    if (dur) chips.push(dur);
    const size = formatConvSize(info.sizeBytes);
    if (size) chips.push(size);
  }
  if (!chips.length) { box.classList.add('hidden'); return; }
  chips.forEach(text => {
    const span = document.createElement('span');
    span.className = 'fchip';
    span.textContent = text;
    box.appendChild(span);
  });
  box.classList.remove('hidden');
}

let convInfo = null;   // info do arquivo escolhido (a camada visual usa pra estimar a saída)
if (window.__gdl) Object.defineProperty(window.__gdl, 'convInfo', { get: () => convInfo, configurable: true });

// Aplica na tela o arquivo escolhido (pelo seletor ou arrastado pra dentro da janela).
function applyConvFile(res) {
  convFilePath = res.filePath;
  convInfo = res.info || null;
  convFileNameInput.value = res.fileName;
  const dz = document.getElementById('btn-conv-pick');
  dz.classList.add('has');
  const dzH = document.getElementById('conv-dz-h'), dzP = document.getElementById('conv-dz-p');
  if (dzH) dzH.textContent = res.fileName;
  if (dzP) dzP.textContent = 'Clique ou solte outro arquivo para trocar';
  clearDiagnosticBox('conv');
  convOptions.classList.remove('hidden');
  convStatus.classList.add('hidden');
  btnConvOpenFolder.classList.add('hidden');
  // Corte e tamanho-alvo ficavam do arquivo anterior: um corte
  // "00:00:10 → 00:02:00" definido pra um vídeo de 5 min era aplicado em
  // silêncio ao próximo, de 30 s, e o resultado saía vazio.
  document.getElementById('conv-trim-start').value = '';
  document.getElementById('conv-trim-end').value = '';
  document.getElementById('conv-target-size').value = '';
  renderConvFileInfo(res.info);

  // A file with no video stream (mp3, wav, flac...) can't be turned into a
  // video — ffmpeg would just error out. Force "Áudio" and hide the option.
  if (res.isAudioOnly) {
    convKindVideoOption.classList.add('hidden');
    convKindVideoRadio.disabled = true;
    convAudioOnlyHint.classList.remove('hidden');
    if (!convKindAudioRadio.checked) {
      convKindAudioRadio.checked = true;
      convKindAudioRadio.dispatchEvent(new Event('change'));
    }
  } else {
    convKindVideoOption.classList.remove('hidden');
    convKindVideoRadio.disabled = false;
    convAudioOnlyHint.classList.add('hidden');
  }
  document.dispatchEvent(new Event('gdl-conv-file'));
}

// `dropped` = caminho de um arquivo arrastado; sem ele abre o seletor do sistema.
async function pickConvFile(dropped) {
  let res;
  try { res = await window.electronAPI.chooseMediaFile(dropped || undefined); }
  catch (e) { showToast('Não consegui abrir o arquivo.', 'error'); return; }
  if (!res || res.canceled) { if (res && res.error) showToast(res.error, 'warning'); return; }
  applyConvFile(res);
}
if (window.__gdl) window.__gdl.openConv = pickConvFile;

if (btnConvPick) {
  btnConvPick.addEventListener('click', () => pickConvFile());
  btnConvPick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickConvFile(); }
  });

  document.querySelectorAll('input[name="conv-kind"]').forEach(r => {
    r.addEventListener('change', e => {
      const isAudio = e.target.value === 'audio';
      convContainerGrp.classList.toggle('hidden', isAudio);
      convVideoOpts.classList.toggle('hidden', isAudio);
      convAudioFmtGrp.classList.toggle('hidden', !isAudio);
      convAudioOpts.classList.toggle('hidden', !isAudio || ['wav', 'flac'].includes(convAudioFormatSel.value));
    });
  });

  convAudioFormatSel.addEventListener('change', () => {
    convAudioOpts.classList.toggle('hidden', ['wav', 'flac'].includes(convAudioFormatSel.value));
  });

  const convContainerSel = document.getElementById('conv-container');
  const convVcodecSel    = document.getElementById('conv-vcodec');
  const convAcodecSel    = document.getElementById('conv-acodec');
  const convVcodecHint   = document.getElementById('conv-vcodec-hint');
  const VCODEC_HINTS = {
    av1: 'AV1 comprime melhor que todos os outros, mas a codificação pode ser bem mais lenta — um vídeo longo pode levar bastante tempo.',
    vp9: 'VP9 funciona melhor dentro do contêiner WebM; em outros formatos pode não abrir em alguns players.',
  };
  function syncConverterCodecOptions(notify = false) {
    const cont = convContainerSel?.value || 'mp4';
    const compat = CONV_CONTAINER_COMPAT[cont] || CONV_CONTAINER_COMPAT.mp4;
    let adjusted = false;
    [...convVcodecSel.options].forEach(o => { o.disabled = !compat.video.has(o.value); });
    [...convAcodecSel.options].forEach(o => { o.disabled = !compat.audio.has(o.value); });
    if (!compat.video.has(convVcodecSel.value)) {
      convVcodecSel.value = compat.defVideo;
      adjusted = true;
    }
    if (!compat.audio.has(convAcodecSel.value)) {
      convAcodecSel.value = compat.defAudio;
      adjusted = true;
    }
    const hint = VCODEC_HINTS[convVcodecSel.value];
    convVcodecHint.textContent = hint || '';
    convVcodecHint.classList.toggle('hidden', !hint);
    if (typeof updateGpuHint === 'function') updateGpuHint();
    if (notify && adjusted) {
      showToast(`${cont.toUpperCase()} não suporta um dos codecs selecionados — ajustei para uma combinação compatível.`, 'info', 3000);
    }
  }
  convContainerSel?.addEventListener('change', () => syncConverterCodecOptions(true));
  convVcodecSel.addEventListener('change', () => {
    const hint = VCODEC_HINTS[convVcodecSel.value];
    convVcodecHint.textContent = hint || '';
    convVcodecHint.classList.toggle('hidden', !hint);
    updateGpuHint();
  });

  // ── GPU (aceleração por hardware) ─────────────────────────────────────────
  // No toggle to ask the user: main.js already tries the best available GPU
  // encoder first (Nvidia NVENC, then AMD AMF, then Intel QSV) whenever the
  // picked codec has one, and quietly falls back to CPU if none work or the
  // attempt fails. This just informs, lazily probing (a few short ffmpeg test
  // encodes) the first time the Converter tab is opened.
  const GPU_VENDOR_PRIORITY = ['nvenc', 'amf', 'qsv'];
  const GPU_VENDOR_LABEL    = { nvenc: 'GPU Nvidia (NVENC)', amf: 'GPU AMD (AMF)', qsv: 'GPU Intel (QSV)' };
  const GPU_CODEC_MAP = {
    h264: { nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
    h265: { nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
    av1:  { nvenc: 'av1_nvenc',  amf: 'av1_amf',  qsv: 'av1_qsv'  },
  };
  const convGpuHint = document.getElementById('conv-gpu-hint');
  let gpuEncoders = null;
  let gpuDetectPromise = null;

  function ensureGpuDetected() {
    if (gpuDetectPromise) return gpuDetectPromise;
    gpuDetectPromise = window.electronAPI.detectGpuEncoders()
      .then(res => { gpuEncoders = res; updateGpuHint(); return res; })
      .catch(() => { gpuEncoders = {}; updateGpuHint(); return gpuEncoders; });
    return gpuDetectPromise;
  }

  function updateGpuHint() {
    const candidates = GPU_CODEC_MAP[convVcodecSel.value];
    if (!candidates) { convGpuHint.classList.add('hidden'); return; }
    let text, ok = false;
    if (!gpuEncoders) {
      text = 'Verificando aceleração por GPU...';
    } else {
      const foundVendor = GPU_VENDOR_PRIORITY.find(v => gpuEncoders[candidates[v]]);
      ok = !!foundVendor;
      text = foundVendor
        ? `${GPU_VENDOR_LABEL[foundVendor]} detectada — será usada automaticamente para converter mais rápido.`
        : 'Nenhuma GPU compatível encontrada (só Nvidia/AMD/Intel com codificação por hardware) — a conversão vai usar o processador.';
    }
    convGpuHint.innerHTML = `<span class="tile">${ICO('zap')}</span><span></span>`;
    convGpuHint.lastChild.textContent = text;
    convGpuHint.classList.toggle('none', !ok);
    convGpuHint.classList.remove('hidden');
  }

  const converterTabBtn = document.querySelector('.tab[data-tab="converter"]');
  if (converterTabBtn) converterTabBtn.addEventListener('click', ensureGpuDetected);
  syncConverterCodecOptions(false);
  updateGpuHint();

  // ── Presets do conversor ────────────────────────────────────────────────
  // Salva a combinação de formato/codec/qualidade atual com um nome, pra não
  // reconfigurar tudo de novo toda vez (ex: "Instagram Story", "Podcast
  // MP3"). Guardado em Configurações (settings.json), sem IPC novo — reusa
  // getSettings/saveSettings que já existem. Trim e tamanho-alvo ficam de
  // fora de propósito: são específicos de cada arquivo, não um "estilo".
  const convPresetSelect = document.getElementById('conv-preset-select');
  const btnPresetSave    = document.getElementById('btn-conv-preset-save');
  const btnPresetDelete  = document.getElementById('btn-conv-preset-delete');
  let converterPresets = [];

  function currentPresetPayload() {
    return {
      outputKind: getRadio('conv-kind'),
      container: document.getElementById('conv-container').value,
      videoCodec: convVcodecSel.value,
      audioCodec: document.getElementById('conv-acodec').value,
      audioFormat: convAudioFormatSel.value,
      quality: document.getElementById('conv-quality').value,
      bitrate: document.getElementById('conv-bitrate').value,
    };
  }

  function populatePresetSelect() {
    convPresetSelect.innerHTML = '<option value="">Preset: nenhum (configurar manualmente)</option>';
    converterPresets.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name;
      convPresetSelect.appendChild(opt);
    });
  }

  async function loadConverterPresets() {
    const s = await window.electronAPI.getSettings();
    converterPresets = Array.isArray(s.converterPresets) ? s.converterPresets : [];
    populatePresetSelect();
  }
  loadConverterPresets();

  async function saveConverterPresets() {
    const current = await window.electronAPI.getSettings();
    await window.electronAPI.saveSettings({ ...current, converterPresets });
  }

  function applyPreset(preset) {
    if (preset.outputKind === 'video' && convKindVideoRadio.disabled) {
      showToast('Esse preset é de vídeo, mas o arquivo escolhido é só áudio — mantive a opção de áudio.', 'warning');
    } else if (preset.outputKind) {
      const radio = document.querySelector(`input[name="conv-kind"][value="${preset.outputKind}"]`);
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
    }
    if (preset.container) document.getElementById('conv-container').value = preset.container;
    if (preset.videoCodec) convVcodecSel.value = preset.videoCodec;
    if (preset.audioCodec) document.getElementById('conv-acodec').value = preset.audioCodec;
    if (preset.audioFormat) { convAudioFormatSel.value = preset.audioFormat; convAudioFormatSel.dispatchEvent(new Event('change')); }
    if (preset.quality) document.getElementById('conv-quality').value = preset.quality;
    if (preset.bitrate) document.getElementById('conv-bitrate').value = preset.bitrate;
    syncConverterCodecOptions(true);
    document.dispatchEvent(new Event('gdl-sync'));   // seg/slider refletem os selects
  }

  convPresetSelect.addEventListener('change', () => {
    const idx = convPresetSelect.value;
    btnPresetDelete.classList.toggle('hidden', idx === '');
    if (idx === '') return;
    const preset = converterPresets[Number(idx)];
    if (preset) applyPreset(preset);
  });

  btnPresetSave.addEventListener('click', async () => {
    const name = (await askText({
      title: 'Salvar preset',
      message: 'Dê um nome pra essa combinação de formato, codec e qualidade.',
      placeholder: 'ex: Instagram Story, Podcast MP3',
      okLabel: 'Salvar',
    }) || '').trim();
    if (!name) return;
    const payload = { name, ...currentPresetPayload() };
    const existingIdx = converterPresets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    if (existingIdx >= 0) {
      if (!confirm(`Já existe um preset chamado "${name}". Substituir?`)) return;
      converterPresets[existingIdx] = payload;
    } else {
      converterPresets.push(payload);
    }
    await saveConverterPresets();
    populatePresetSelect();
    convPresetSelect.value = String(converterPresets.findIndex(p => p.name === name));
    btnPresetDelete.classList.remove('hidden');
    showToast(`Preset "${name}" salvo.`, 'success', 2500);
  });

  btnPresetDelete.addEventListener('click', async () => {
    const idx = Number(convPresetSelect.value);
    if (Number.isNaN(idx) || !converterPresets[idx]) return;
    const name = converterPresets[idx].name;
    if (!confirm(`Apagar o preset "${name}"?`)) return;
    converterPresets.splice(idx, 1);
    await saveConverterPresets();
    populatePresetSelect();
    btnPresetDelete.classList.add('hidden');
  });

  btnConvert.addEventListener('click', async () => {
    if (!convFilePath || convId || btnConvert.disabled) return;
    const id = uid();
    convId = id;

    clearDiagnosticBox('conv');
    btnConvert.disabled = true;
    btnConvCancel.disabled = false;
    btnConvCancel.classList.remove('hidden');
    btnConvOpenFolder.classList.add('hidden');
    convStatus.classList.remove('hidden');
    resetBar(convBar, convText);
    convText.textContent = 'Preparando...';

    let result;
    try {
      result = await window.electronAPI.convertMedia({
        inputPath: convFilePath,
        outputKind: getRadio('conv-kind'),
        container: document.getElementById('conv-container').value,
        videoCodec: document.getElementById('conv-vcodec').value,
        audioCodec: document.getElementById('conv-acodec').value,
        quality: document.getElementById('conv-quality').value,
        audioFormat: convAudioFormatSel.value,
        bitrate: document.getElementById('conv-bitrate').value,
        trimStart: document.getElementById('conv-trim-start').value.trim(),
        trimEnd: document.getElementById('conv-trim-end').value.trim(),
        targetSizeMB: parseFloat(document.getElementById('conv-target-size').value) || null,
        convertId: id
      });
    } catch (e) {
      result = { success: false, error: e?.message || 'Falha inesperada ao falar com o app.' };
    } finally {
      if (convId === id) {
        convId = null;
        btnConvert.disabled = false;
        btnConvCancel.disabled = false;
        btnConvCancel.classList.add('hidden');
      }
    }

    if (canceledUiIds.delete(id)) return;
    if (convId && convId !== id) return;

    if (result?.canceled) {
      convStatus.classList.add('hidden');
      resetBar(convBar, convText);
      return;
    }

    if (result.success) {
      convBar.style.width = '100%';
      convBar.style.background = 'linear-gradient(90deg, var(--success), #34d399)';
      convText.textContent = 'Conversão concluída!';
      lastConvFolder = result.folder;
      btnConvOpenFolder.classList.remove('hidden');
      showToast('Conversão concluída com sucesso!', 'success');
    } else {
      convBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
      convText.textContent = result.error;
      showDiagnosticBox('conv', result);
      showErrorToast(result);
    }
  });

  btnConvCancel.addEventListener('click', async () => {
    if (!convId) return;
    const idToCancel = convId;
    canceledUiIds.add(idToCancel);
    btnConvCancel.disabled = true;
    try {
      await window.electronAPI.cancelConvert(idToCancel);
    } finally {
      if (convId === idToCancel) convId = null;
      btnConvCancel.disabled = false;
      btnConvCancel.classList.add('hidden');
      convBar.style.background = 'linear-gradient(90deg, var(--danger), #f87171)';
      convText.textContent = 'Conversão cancelada.';
      btnConvert.disabled = false;
      showToast('Conversão cancelada.', 'warning');
    }
  });

  btnConvOpenFolder.addEventListener('click', () => { if (lastConvFolder) window.electronAPI.openFolder(lastConvFolder); });

  window.electronAPI.onConvertProgress(({ type, percent, message }) => {
    if (type === 'progress' && typeof percent === 'number') {
      setProgress(convBar, convText, Math.max(1, percent), convFileNameInput.value);
    } else if (type === 'start') {
      if (message) resetBar(convBar, convText);
      convText.textContent = message || 'Convertendo...';
    }
  });
}

// Shows the real running version (from package.json via app.getVersion()) instead
// of a hardcoded string that would drift out of sync on every release.
if (window.electronAPI.getAppVersion) {
  window.electronAPI.getAppVersion().then(v => {
    const el = document.getElementById('app-version-label');
    if (el && v) el.textContent = `v${v} · Powered by yt-dlp`;
  }).catch(() => {});
}

// ── Auto update ───────────────────────────────────────────────────────────────
// Fully automatic: the app checks, downloads, and — once nothing is actively
// downloading/converting — installs and restarts on its own. These toasts are
// just status updates; the "instalar agora" action is an optional shortcut to
// skip the idle wait, not something required to make the update happen.
if (window.electronAPI.onUpdateStatus) {
  window.electronAPI.onUpdateStatus(({ status, version, error }) => {
    if (status === 'available') {
      showToast(`Nova versão ${version} disponível. Baixando em segundo plano...`, 'info', 5000);
    } else if (status === 'downloaded') {
      showToast(`Versão ${version} pronta. Vai reiniciar e instalar sozinho assim que não houver downloads/conversões em andamento.`, 'success', 15000, {
        label: 'Instalar agora',
        onClick: () => window.electronAPI.installUpdateNow()
      });
    } else if (status === 'installing') {
      showToast('Reiniciando para instalar a atualização...', 'info', 4000);
    } else if (status === 'error') {
      console.warn('Erro ao verificar atualizações:', error);
    }
  });
}

// ── Changelog modal ───────────────────────────────────────────────────────────
// O CHANGELOG.md é markdown, então **negrito** e `código` apareciam com os
// asteriscos/crases na tela. Monta o texto em nós de verdade (nada de
// innerHTML) pra destacar sem abrir espaço pra marcação vinda do arquivo.
function appendChangelogText(el, text) {
  String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach(part => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      el.appendChild(b);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const c = document.createElement('code');
      c.textContent = part.slice(1, -1);
      el.appendChild(c);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

// Shown once, the first time the app is reopened after updating to a new
// version (main.js decides when to fire this — never on a fresh install).
if (window.electronAPI.onShowChangelog) {
  const changelogModal   = document.getElementById('changelog-modal');
  const changelogVersion = document.getElementById('changelog-version');
  const changelogList    = document.getElementById('changelog-list');

  const closeChangelog = () => closeModal(changelogModal);
  document.getElementById('changelog-close').addEventListener('click', closeChangelog);
  document.getElementById('btn-changelog-ok').addEventListener('click', closeChangelog);

  window.electronAPI.onShowChangelog((payload) => {
    // main.js sends an array (mais nova primeiro) quando o usuário pulou
    // várias versões de uma vez; mantém compatibilidade com um objeto único.
    const entries = Array.isArray(payload) ? payload : [payload];
    if (!entries.length) return;

    changelogVersion.textContent = entries.length > 1
      ? `v${entries[entries.length - 1].version} → v${entries[0].version}`
      : `v${entries[0].version}`;

    changelogList.innerHTML = '';
    entries.forEach((entry, i) => {
      const h = document.createElement('p');
      h.style.cssText = `font-weight:700;font-size:0.85rem;padding:${i === 0 ? '0.2rem' : '0.9rem'} 0.5rem 0.4rem`;
      h.textContent = entries.length > 1
        ? `v${entry.version}${entry.title ? ' — ' + entry.title : ''}`
        : (entry.title || `v${entry.version}`);
      changelogList.appendChild(h);
      (entry.notes || []).forEach(note => {
        // O main manda { text, heading }; versões antigas mandavam string pura.
        const text = typeof note === 'string' ? note : (note?.text || '');
        const isHeading = typeof note === 'object' && !!note?.heading;
        const p = document.createElement('p');
        p.className = isHeading ? 'changelog-heading' : 'changelog-item';
        // O item é um flex container (marcador + texto) — todo o texto vai
        // dentro de um span só, senão cada trecho em negrito viraria uma
        // "coluna" separada em vez de continuar a mesma frase.
        const body = document.createElement('span');
        appendChangelogText(body, text);
        p.appendChild(body);
        changelogList.appendChild(p);
      });
    });
    openModal(changelogModal, document.getElementById('btn-changelog-ok'));
  });
}

// ── Vindo da extensão do navegador ──────────────────────────────────────────────
// O botão "Baixar vídeo" da extensão do YouTube abre um link
// gameshmm-downloader://..., que main.js recebe e repassa aqui — troca pra
// aba Download, preenche o link e já busca as informações (mesmo fluxo do
// "Colar e buscar" da detecção de clipboard, só que sem precisar do toast já
// que aqui foi um clique explícito do usuário no próprio vídeo).
if (window.electronAPI.onOpenDownloadUrl) {
  window.electronAPI.onOpenDownloadUrl((url) => {
    if (!url) return;
    // Já tem download rodando (vídeo, playlist ou Spotify)? fetchInfo() chama
    // resetDownloadState(), que esconde o card e zera a barra do download em
    // andamento — a barra parecia travar, o botão ficava desabilitado e o
    // "concluído" nunca aparecia. Então, com algo em andamento, o link vai pra
    // fila e a tela atual fica intacta.
    if (activeDownloadId || activePlaylistId || activeSpotifyId) {
      // addLinksToQueue já avisa (adicionado / já estava na fila).
      if (addLinksToQueue(url)) showToast('Download em andamento — o novo link ficou na fila.', 'info', 3500);
      return;
    }
    const downloadTab = document.querySelector('.tab[data-tab="download"]');
    if (downloadTab && !downloadTab.classList.contains('active')) downloadTab.click();
    urlInput.value = url;
    fetchInfo();
  });
}

// ── Clipboard link detection ──────────────────────────────────────────────────
// Polls the clipboard (Electron has no native "changed" event for it) for a
// newly copied URL from a recognized source, and offers to paste + fetch it.
// Only fires for known media sources on an actual change — not for whatever
// was already in the clipboard when the app started, not for the link
// that's already in the field, and not for unrelated/unrecognized URLs.
// Purely local: nothing read here is sent anywhere. Toggle in Configurações.
if (window.electronAPI.readClipboardText) {
  let lastClipboardText = null; // null until the first read seeds it (see below)

  async function checkClipboardForLink() {
    if (!clipboardWatchEnabled) return;
    let text;
    try { text = await window.electronAPI.readClipboardText(); } catch { return; }
    if (typeof text !== 'string') return;
    const trimmed = text.trim();

    if (lastClipboardText === null) { lastClipboardText = trimmed; return; }
    if (trimmed === lastClipboardText) return;
    lastClipboardText = trimmed;

    if (!/^https?:\/\//i.test(trimmed)) return;
    if (trimmed === urlInput.value.trim()) return;
    const src = detectSource(trimmed);
    if (!src || src.type === 'universal') return;

    const openClip = () => {
      if (activeDownloadId || activePlaylistId || activeSpotifyId) {
        if (addLinksToQueue(trimmed)) showToast('Download em andamento — link copiado adicionado à fila.', 'info', 3500);
        return;
      }
      const downloadTab = document.querySelector('.tab[data-tab="download"]');
      if (downloadTab && !downloadTab.classList.contains('active')) downloadTab.click();
      urlInput.value = trimmed;
      urlInput.dispatchEvent(new Event('input'));
      fetchInfo();
    };
    // Na aba Download o aviso vira uma barra logo abaixo do campo; nas outras, o toast de sempre.
    const clipBar = document.getElementById('clip-bar');
    if (clipBar && document.getElementById('tab-download') && !document.getElementById('tab-download').classList.contains('hidden')) {
      window.dispatchEvent(new CustomEvent('gdl-clip', { detail: { url: trimmed, label: src.label, open: openClip } }));
      return;
    }
    showToast(`Link do ${src.label} copiado.`, 'info', 8000, {
      label: (activeDownloadId || activePlaylistId || activeSpotifyId) ? 'Mandar pra fila' : 'Colar e buscar',
      onClick: openClip
    });
  }

  setInterval(checkClipboardForLink, 1500);
}
