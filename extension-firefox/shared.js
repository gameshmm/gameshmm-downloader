// Versão Firefox — mesma lógica da versão Chrome/Edge (ver /extension), só
// trocando o namespace `chrome.*` pelo `browser.*`.
//
const GDL_PROTOCOL_SCHEME = 'gameshmm-downloader';
const GDL_STORAGE_KEY = 'gdlButtonEnabled';
const GDL_BADGE_ID = 'gdl-download-badge';

let gdlEnabled = true;
let gdlBridgeAlive = false;
let gdlSending = false;

function gdlRemoveBadge() {
  const el = document.getElementById(GDL_BADGE_ID);
  if (el) el.remove();
}

function gdlSendToAppProtocol(url) {
  // Navegação síncrona direta pra protocolo customizado (preserva o gesto do usuário).
  window.location.href = `${GDL_PROTOCOL_SCHEME}://download?url=${encodeURIComponent(url)}`;
}

async function gdlRefreshBridgeStatus() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'gdl-bridge-status' });
    gdlBridgeAlive = !!(res && res.alive);
  } catch {
    gdlBridgeAlive = false;
  }
}

function gdlDisableForever() {
  gdlEnabled = false;
  gdlRemoveBadge();
  try { browser.storage.local.set({ [GDL_STORAGE_KEY]: false }); } catch {}
}

function gdlFlashBadgeState(badge, labelEl, baseLabel, text, state, resetMs = 2000) {
  clearTimeout(badge._gdlTimer);
  labelEl.textContent = text;
  if (state) badge.dataset.state = state;
  else delete badge.dataset.state;
  badge._gdlTimer = setTimeout(() => {
    labelEl.textContent = baseLabel;
    delete badge.dataset.state;
  }, resetMs);
}

// label: texto do botão (varia por site — "Baixar vídeo", "Baixar do Spotify"...).
// getUrlFn: função síncrona chamada só no clique, que devolve a URL a enviar.
function gdlBuildBadge(label, getUrlFn) {
  const badge = document.createElement('div');
  badge.id = GDL_BADGE_ID;
  badge.className = 'gdl-badge';
  badge.dataset.site = (location.hostname.match(/(youtube|tiktok|instagram|twitter|spotify|(?:^|\.)x)\.?/) || [])[1]?.replace(/^\./, '') || '';
  badge.title = 'Baixar com o gameshmm downloader';
  badge.innerHTML = `
    <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    <span class="gdl-badge-label">${label}</span>
    <button type="button" class="gdl-badge-close" title="Remover este botão">✕</button>
  `;
  badge.addEventListener('pointerenter', () => { gdlRefreshBridgeStatus(); });
  badge.addEventListener('click', (e) => {
    if (e.target.closest('.gdl-badge-close')) return;
    if (gdlSending) return;
    const labelEl = badge.querySelector('.gdl-badge-label');
    const url = getUrlFn();

    if (!gdlBridgeAlive) {
      gdlSendToAppProtocol(url);
      gdlFlashBadgeState(badge, labelEl, label, 'Abrindo app...', 'sent', 1800);
      return;
    }

    gdlSending = true;
    clearTimeout(badge._gdlTimer);
    labelEl.textContent = 'Enviando...';
    browser.runtime.sendMessage({ type: 'gdl-bridge-open', url })
      .then((res) => {
        if (res && res.ok) {
          gdlFlashBadgeState(badge, labelEl, label, 'Enviado pro app!', 'sent', 2000);
        } else {
          gdlBridgeAlive = false;
          gdlFlashBadgeState(badge, labelEl, label, 'App fechado — clique de novo', 'warn', 2600);
        }
      })
      .catch(() => {
        gdlBridgeAlive = false;
        gdlFlashBadgeState(badge, labelEl, label, 'App fechado — clique de novo', 'warn', 2600);
      })
      .finally(() => { gdlSending = false; });
  });
  badge.querySelector('.gdl-badge-close').addEventListener('click', (e) => {
    e.stopPropagation();
    gdlDisableForever();
  });
  return badge;
}

function gdlEnsurePositioned(el) {
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  return el;
}

function gdlFindVideoContainer() {
  const video = document.querySelector('video');
  if (!video) return null;
  let el = video.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 160 && rect.height > 90) return el;
    el = el.parentElement;
  }
  return video.parentElement;
}

function gdlUpdateFullscreenVisibility() {
  const el = document.getElementById(GDL_BADGE_ID);
  if (el) el.classList.toggle('gdl-hidden', !!document.fullscreenElement);
}

function gdlInitStorage(onReady) {
  try {
    browser.storage.local.get([GDL_STORAGE_KEY]).then((res) => {
      gdlEnabled = res[GDL_STORAGE_KEY] !== false;
      onReady();
    }).catch(() => onReady());
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(GDL_STORAGE_KEY in changes)) return;
      gdlEnabled = changes[GDL_STORAGE_KEY].newValue !== false;
      onReady();
    });
  } catch {
    onReady();
  }
}

function gdlWatchAndInject(injectFn, { pollMs = 1200 } = {}) {
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; gdlRemoveBadge(); }
    injectFn();
  }, pollMs);
  gdlRefreshBridgeStatus();
  setInterval(gdlRefreshBridgeStatus, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) gdlRefreshBridgeStatus();
  });
  document.addEventListener('fullscreenchange', gdlUpdateFullscreenVisibility);
  let pendingInject = false;
  new MutationObserver(() => {
    if (pendingInject) return;
    pendingInject = true;
    requestAnimationFrame(() => { pendingInject = false; injectFn(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  gdlInitStorage(injectFn);
}
