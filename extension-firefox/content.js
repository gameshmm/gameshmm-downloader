// Versão Firefox — usa `browser.*` (Promise) em vez de `chrome.*`.
//
// Injeta o botão no player do YouTube e o botão de conectar login.
// Quando o desktop app está aberto, envia pela bridge HTTP local em 127.0.0.1
// com confirmação real ("Enviado pro app!" / "Conectado ao app!"). Quando o app
// está fechado, usa gameshmm-downloader:// de forma 100% síncrona no clique
// para preservar o gesto do usuário no navegador.
(() => {
  const PROTOCOL_SCHEME = 'gameshmm-downloader';
  const STORAGE_KEY = 'gdlButtonEnabled';
  const BADGE_ID = 'gdl-download-badge';
  const LOGIN_BADGE_ID = 'gdl-login-badge';
  const LOGIN_CONNECTED_KEY = 'gdlLoginConnected';

  let enabled = true;
  let bridgeStatus = { alive: false, port: null, cookiesConnected: false };
  let sendingVideo = false;
  let cachedLoginData = null;
  let loginConnected = false;
  let sendingLogin = false;

  function getVideoUrl() {
    const params = new URLSearchParams(location.search);
    const id = params.get('v');
    return id ? `https://www.youtube.com/watch?v=${id}` : location.href;
  }

  function isWatchPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/shorts/') || location.pathname.startsWith('/live/');
  }

  function removeBadge() {
    const el = document.getElementById(BADGE_ID);
    if (el) el.remove();
  }

  function flashBadge(badge, labelEl, baseLabel, text, state, resetMs = 2000) {
    clearTimeout(badge._gdlTimer);
    labelEl.textContent = text;
    if (state) badge.dataset.state = state;
    else delete badge.dataset.state;
    badge._gdlTimer = setTimeout(() => {
      labelEl.textContent = baseLabel;
      delete badge.dataset.state;
    }, resetMs);
  }

  function disableForever() {
    enabled = false;
    removeBadge();
    try { browser.storage.local.set({ [STORAGE_KEY]: false }); } catch {}
  }

  function buildBadge() {
    const badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.className = 'gdl-badge';
    badge.title = 'Baixar este vídeo com o gameshmm downloader';
    const baseLabel = 'Baixar este vídeo';

    badge.innerHTML = `
      <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <span class="gdl-badge-label">${baseLabel}</span>
      <button type="button" class="gdl-badge-close" title="Remover este botão">✕</button>
    `;

    badge.addEventListener('pointerenter', () => { refreshBridgeState(); });
    badge.addEventListener('click', (e) => {
      if (e.target.closest('.gdl-badge-close')) return;
      if (sendingVideo) return;
      const labelEl = badge.querySelector('.gdl-badge-label');
      const videoUrl = getVideoUrl();

      if (!bridgeStatus.alive) {
        window.location.href = `${PROTOCOL_SCHEME}://download?url=${encodeURIComponent(videoUrl)}`;
        flashBadge(badge, labelEl, baseLabel, 'Abrindo app...', 'sent', 1800);
        return;
      }

      sendingVideo = true;
      clearTimeout(badge._gdlTimer);
      labelEl.textContent = 'Enviando...';
      browser.runtime.sendMessage({ type: 'gdl-bridge-open', url: videoUrl })
        .then((res) => {
          if (res && res.ok) {
            flashBadge(badge, labelEl, baseLabel, 'Enviado pro app!', 'sent', 2000);
          } else {
            bridgeStatus.alive = false;
            flashBadge(badge, labelEl, baseLabel, 'App fechado — clique de novo', 'warn', 2600);
          }
        })
        .catch(() => {
          bridgeStatus.alive = false;
          flashBadge(badge, labelEl, baseLabel, 'App fechado — clique de novo', 'warn', 2600);
        })
        .finally(() => { sendingVideo = false; });
    });

    badge.querySelector('.gdl-badge-close').addEventListener('click', (e) => {
      e.stopPropagation();
      disableForever();
    });

    return badge;
  }

  function injectBadge() {
    if (!enabled || !isWatchPage()) { removeBadge(); return; }
    if (document.getElementById(BADGE_ID)) return;

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return;

    player.appendChild(buildBadge());
  }

  function updateFullscreenVisibility() {
    const el = document.getElementById(BADGE_ID);
    if (!el) return;
    el.classList.toggle('gdl-hidden', !!document.fullscreenElement);
  }

  document.addEventListener('yt-navigate-finish', () => { removeBadge(); injectBadge(); });
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; removeBadge(); injectBadge(); }
  }, 1000);

  document.addEventListener('fullscreenchange', updateFullscreenVisibility);

  let pendingBadgeCheck = false;
  const observer = new MutationObserver(() => {
    if (pendingBadgeCheck) return;
    pendingBadgeCheck = true;
    requestAnimationFrame(() => { pendingBadgeCheck = false; injectBadge(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  try {
    browser.storage.local.get([STORAGE_KEY]).then((res) => {
      enabled = res[STORAGE_KEY] !== false;
      injectBadge();
    }).catch(() => injectBadge());
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(STORAGE_KEY in changes)) return;
      enabled = changes[STORAGE_KEY].newValue !== false;
      if (enabled) injectBadge(); else removeBadge();
    });
  } catch {
    injectBadge();
  }

  // ── Login e sincronia com bridge local ────────────────────────────────────
  function toBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function refreshLoginCookiesCache() {
    try {
      const res = await browser.runtime.sendMessage({ type: 'gdl-get-login-cookies' });
      cachedLoginData = (res && res.ok && res.cookies?.length) ? toBase64Utf8(JSON.stringify(res.cookies)) : null;
    } catch {
      cachedLoginData = null;
    }
  }

  async function refreshBridgeState() {
    try {
      const res = await browser.runtime.sendMessage({ type: 'gdl-bridge-status' });
      if (res && res.alive) {
        bridgeStatus = { alive: true, port: res.port, cookiesConnected: !!res.cookiesConnected };
        loginConnected = !!res.cookiesConnected;
        injectLoginBadge();
      } else {
        bridgeStatus = { alive: false, port: null, cookiesConnected: false };
      }
    } catch {
      bridgeStatus = { alive: false, port: null, cookiesConnected: false };
    }
  }

  refreshLoginCookiesCache();
  refreshBridgeState();
  setInterval(refreshLoginCookiesCache, 4000);
  setInterval(refreshBridgeState, 4500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshLoginCookiesCache();
      refreshBridgeState();
    }
  });

  function removeLoginBadgeSoon() {
    setTimeout(() => { const el = document.getElementById(LOGIN_BADGE_ID); if (el) el.remove(); }, 1500);
  }

  function buildLoginBadge() {
    const badge = document.createElement('div');
    badge.id = LOGIN_BADGE_ID;
    badge.className = 'gdl-badge gdl-badge-floating gdl-login-badge';
    badge.title = 'Conectar o login do YouTube/Google ao gameshmm downloader';
    const baseLabel = 'Conectar ao app';
    badge.innerHTML = `
      <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="gdl-badge-label">${baseLabel}</span>
    `;
    badge.addEventListener('pointerenter', () => { refreshBridgeState(); refreshLoginCookiesCache(); });
    badge.addEventListener('click', () => {
      if (sendingLogin) return;
      const label = badge.querySelector('.gdl-badge-label');
      if (!cachedLoginData) {
        label.textContent = 'Faça login e aguarde...';
        refreshLoginCookiesCache();
        setTimeout(() => { label.textContent = baseLabel; }, 2500);
        return;
      }

      if (!bridgeStatus.alive) {
        const url = `${PROTOCOL_SCHEME}://cookies?data=${encodeURIComponent(cachedLoginData)}`;
        window.location.href = url;
        label.textContent = 'Conectando...';
        loginConnected = true;
        try { browser.storage.local.set({ [LOGIN_CONNECTED_KEY]: true }); } catch {}
        removeLoginBadgeSoon();
        return;
      }

      sendingLogin = true;
      label.textContent = 'Conectando...';
      browser.runtime.sendMessage({ type: 'gdl-bridge-cookies' })
        .then((res) => {
          if (res && res.ok) {
            label.textContent = 'Conectado ao app!';
            badge.dataset.state = 'sent';
            loginConnected = true;
            try { browser.storage.local.set({ [LOGIN_CONNECTED_KEY]: true }); } catch {}
            removeLoginBadgeSoon();
          } else if (res && res.offline) {
            bridgeStatus.alive = false;
            flashBadge(badge, label, baseLabel, 'App fechado — clique de novo', 'warn', 2600);
          } else {
            flashBadge(badge, label, baseLabel, 'Faça login e tente de novo', 'warn', 2600);
          }
        })
        .catch(() => {
          bridgeStatus.alive = false;
          flashBadge(badge, label, baseLabel, 'App fechado — clique de novo', 'warn', 2600);
        })
        .finally(() => { sendingLogin = false; });
    });
    return badge;
  }

  function injectLoginBadge() {
    if (loginConnected) { const el = document.getElementById(LOGIN_BADGE_ID); if (el) el.remove(); return; }
    if (document.getElementById(LOGIN_BADGE_ID)) return;
    document.body.appendChild(buildLoginBadge());
  }

  try {
    browser.storage.local.get([LOGIN_CONNECTED_KEY]).then((res) => {
      loginConnected = !!res[LOGIN_CONNECTED_KEY];
      injectLoginBadge();
    }).catch(() => injectLoginBadge());
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(LOGIN_CONNECTED_KEY in changes)) return;
      loginConnected = !!changes[LOGIN_CONNECTED_KEY].newValue;
      injectLoginBadge();
    });
  } catch {
    injectLoginBadge();
  }
  const loginObserver = new MutationObserver(() => injectLoginBadge());
  loginObserver.observe(document.documentElement, { childList: true, subtree: false });
})();
