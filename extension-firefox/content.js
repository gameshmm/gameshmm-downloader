// Versão Firefox — mesma lógica da versão Chrome/Edge (ver /extension), só
// trocando o namespace `chrome.*` (callback) pelo `browser.*` (Promise), que
// é o nativo do Firefox.
//
// Injeta um botão pequeno (estilo "baixar este vídeo" do IDM) no canto do
// player do YouTube. Clicar nele abre um link gameshmm-downloader://, que o
// sistema operacional entrega direto pro app (abre ele se estiver fechado,
// ou só foca se já estiver aberto) — sem precisar de servidor local nem
// instalar nada além da extensão. Removível: o "✕" no próprio botão desativa
// a extensão pra sempre (até reativar no popup), e o popup tem o mesmo
// controle.
(() => {
  const PROTOCOL_SCHEME = 'gameshmm-downloader';
  const STORAGE_KEY = 'gdlButtonEnabled';
  const BADGE_ID = 'gdl-download-badge';

  let enabled = true; // valor real vem do storage assim que carrega, abaixo

  function getVideoUrl() {
    const params = new URLSearchParams(location.search);
    const id = params.get('v');
    // Canônico quando dá (link mais limpo pro app baixar), com fallback pra
    // URL atual inteira (cobre /shorts/, embeds etc.).
    return id ? `https://www.youtube.com/watch?v=${id}` : location.href;
  }

  function isWatchPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  }

  function removeBadge() {
    const el = document.getElementById(BADGE_ID);
    if (el) el.remove();
  }

  function sendToApp() {
    const url = `${PROTOCOL_SCHEME}://download?url=${encodeURIComponent(getVideoUrl())}`;
    // Navegar pra um esquema não-http faz o navegador abrir o app registrado
    // sem sair da página do YouTube (ele intercepta antes de navegar). No
    // Firefox, na primeira vez, aparece uma caixa de confirmação perguntando
    // se pode abrir o app — marcar "lembrar minha escolha" evita perguntar
    // de novo depois.
    window.location.href = url;
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

    badge.innerHTML = `
      <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <span class="gdl-badge-label">Baixar este vídeo</span>
      <button type="button" class="gdl-badge-close" title="Remover este botão">✕</button>
    `;

    badge.addEventListener('click', (e) => {
      if (e.target.closest('.gdl-badge-close')) return;
      sendToApp();
    });
    badge.querySelector('.gdl-badge-close').addEventListener('click', (e) => {
      e.stopPropagation();
      disableForever();
    });

    return badge;
  }

  function injectBadge() {
    if (!enabled || !isWatchPage()) { removeBadge(); return; }
    if (document.getElementById(BADGE_ID)) return; // já injetado pra esse vídeo

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return; // player ainda não montou — o observer abaixo tenta de novo

    player.appendChild(buildBadge());
  }

  function updateFullscreenVisibility() {
    const el = document.getElementById(BADGE_ID);
    if (!el) return;
    el.classList.toggle('gdl-hidden', !!document.fullscreenElement);
  }

  // YouTube é uma SPA — trocar de vídeo não recarrega a página. Reagimos ao
  // evento que o próprio YouTube dispara ao terminar uma navegação interna,
  // com um polling leve como rede de segurança caso o evento não dispare.
  document.addEventListener('yt-navigate-finish', () => { removeBadge(); injectBadge(); });
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; removeBadge(); injectBadge(); }
  }, 1000);

  document.addEventListener('fullscreenchange', updateFullscreenVisibility);

  const observer = new MutationObserver(() => injectBadge());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  try {
    browser.storage.local.get([STORAGE_KEY]).then((res) => {
      enabled = res[STORAGE_KEY] !== false; // padrão: ativado
      injectBadge();
    }).catch(() => injectBadge());
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(STORAGE_KEY in changes)) return;
      enabled = changes[STORAGE_KEY].newValue !== false;
      if (enabled) injectBadge(); else removeBadge();
    });
  } catch {
    injectBadge(); // storage indisponível por algum motivo — segue com o padrão
  }

  // ── Login: botão "Conectar ao app" fixo no canto da página ────────────────
  // Precisa ser um clique de verdade AQUI na página (não no popup da
  // extensão) — mesmo comportamento confirmado na versão Chrome: o navegador
  // só libera a navegação pro protocolo customizado (gameshmm-downloader://)
  // quando ela nasce de um gesto real do usuário no próprio documento que
  // está navegando.
  //
  // Segunda pegadinha, também confirmada na versão Chrome (e que vale aqui
  // por precaução): mesmo com o clique acontecendo aqui na página, um
  // simples `await` entre o clique e o window.location.href (pra buscar os
  // cookies no background) pode já ser o suficiente pro navegador não
  // considerar mais a navegação como resultado direto do clique, e aí barrar
  // o handoff em silêncio. Por isso os cookies são buscados com ANTECEDÊNCIA
  // (atualizados a cada poucos segundos em segundo plano) e ficam guardados
  // em cache: no momento do clique, tudo que roda é pegar esse valor já
  // pronto e navegar, sem nenhum await no meio.
  const LOGIN_BADGE_ID = 'gdl-login-badge';
  const LOGIN_CONNECTED_KEY = 'gdlLoginConnected';
  let cachedLoginData = null; // base64 pronto pra usar, ou null se ainda não tem cookie de login
  // A extensão não tem canal de volta pra saber o status real do app — isso
  // é só a MELHOR SUPOSIÇÃO (assumimos sucesso assim que o clique dispara a
  // navegação). Se desconectar no app, o botão "Mostrar de novo" no popup
  // da extensão limpa essa marcação.
  let loginConnected = false;

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
  refreshLoginCookiesCache();
  setInterval(refreshLoginCookiesCache, 4000);

  function buildLoginBadge() {
    const badge = document.createElement('div');
    badge.id = LOGIN_BADGE_ID;
    badge.className = 'gdl-badge gdl-badge-floating gdl-login-badge';
    badge.title = 'Conectar o login do YouTube/Google ao gameshmm downloader';
    badge.innerHTML = `
      <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="gdl-badge-label">Conectar ao app</span>
    `;
    // Handler SÍNCRONO de propósito — nada de async/await aqui dentro.
    badge.addEventListener('click', () => {
      const label = badge.querySelector('.gdl-badge-label');
      const originalText = label.textContent;
      if (!cachedLoginData) {
        label.textContent = 'Faça login e aguarde...';
        refreshLoginCookiesCache();
        setTimeout(() => { label.textContent = originalText; }, 2500);
        return;
      }
      const url = `${PROTOCOL_SCHEME}://cookies?data=${encodeURIComponent(cachedLoginData)}`;
      // Mesmo truque do botão de download, agora 100% síncrono a partir do
      // clique — é isso que faz o navegador liberar o handoff externo.
      window.location.href = url;
      label.textContent = 'Conectando...';
      loginConnected = true;
      try { browser.storage.local.set({ [LOGIN_CONNECTED_KEY]: true }); } catch {}
      removeLoginBadgeSoon();
    });
    return badge;
  }

  // Some o botão logo após o clique (sem sumir na hora, pra dar tempo do
  // usuário ver o "Conectando..."), e não injeta de novo enquanto
  // loginConnected for true.
  function removeLoginBadgeSoon() {
    setTimeout(() => { const el = document.getElementById(LOGIN_BADGE_ID); if (el) el.remove(); }, 1500);
  }

  function injectLoginBadge() {
    if (loginConnected) { const el = document.getElementById(LOGIN_BADGE_ID); if (el) el.remove(); return; }
    if (document.getElementById(LOGIN_BADGE_ID)) return; // já injetado
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
    injectLoginBadge(); // storage indisponível por algum motivo — segue com o padrão
  }
  // Some SPAs do YouTube removem/recriam <body> em navegações internas raras
  // — o observer já ativo acima também cobre a recriação desse badge.
  const loginObserver = new MutationObserver(() => injectLoginBadge());
  loginObserver.observe(document.documentElement, { childList: true, subtree: false });
})();
