// Helpers comuns aos sites além do YouTube (que tem seu próprio content.js
// mais específico, com sua lógica própria de SPA). Carregado antes do script
// de cada site (ver manifest.json) — como o Chrome injeta os arquivos "js"
// de um mesmo content_scripts em sequência, no mesmo contexto, essas
// funções/variáveis ficam disponíveis direto pro script do site, sem
// precisar de import/export.
const GDL_PROTOCOL_SCHEME = 'gameshmm-downloader';
const GDL_STORAGE_KEY = 'gdlButtonEnabled';
const GDL_BADGE_ID = 'gdl-download-badge';

let gdlEnabled = true; // valor real vem do storage assim que carrega (gdlInitStorage)

function gdlRemoveBadge() {
  const el = document.getElementById(GDL_BADGE_ID);
  if (el) el.remove();
}

function gdlSendToApp(url) {
  // Navegar pra um esquema não-http faz o navegador abrir o app registrado
  // sem sair da página atual (ele intercepta antes de navegar de verdade).
  window.location.href = `${GDL_PROTOCOL_SCHEME}://download?url=${encodeURIComponent(url)}`;
}

function gdlDisableForever() {
  gdlEnabled = false;
  gdlRemoveBadge();
  try { chrome.storage.local.set({ [GDL_STORAGE_KEY]: false }); } catch {}
}

// label: texto do botão (varia por site — "Baixar vídeo", "Baixar do Spotify"...).
// getUrlFn: função síncrona chamada só no clique, que devolve a URL a enviar.
function gdlBuildBadge(label, getUrlFn) {
  const badge = document.createElement('div');
  badge.id = GDL_BADGE_ID;
  badge.className = 'gdl-badge';
  // cor do botão por site (ver content.css): youtube, tiktok, instagram, twitter/x, spotify
  badge.dataset.site = (location.hostname.match(/(youtube|tiktok|instagram|twitter|spotify|(?:^|\.)x)\.?/) || [])[1]?.replace(/^\./, '') || '';
  badge.title = 'Baixar com o gameshmm downloader';
  badge.innerHTML = `
    <svg class="gdl-badge-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    <span class="gdl-badge-label">${label}</span>
    <button type="button" class="gdl-badge-close" title="Remover este botão">✕</button>
  `;
  badge.addEventListener('click', (e) => {
    if (e.target.closest('.gdl-badge-close')) return;
    gdlSendToApp(getUrlFn());
  });
  badge.querySelector('.gdl-badge-close').addEventListener('click', (e) => {
    e.stopPropagation();
    gdlDisableForever();
  });
  return badge;
}

// Só liga position:relative se o elemento ainda não tiver nenhum posicionamento
// — não mexe em nada que o próprio site já tenha definido.
function gdlEnsurePositioned(el) {
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  return el;
}

// Acha um contêiner razoável pra ancorar o badge: sobe a partir do <video>
// até achar um elemento grande o suficiente (evita cair num <div> interno
// minúsculo). Evita depender de nomes de classe do site, que em sites como
// Instagram/X mudam com frequência.
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

// Lê o estado ligado/desligado do storage e reage a mudanças feitas no popup
// (ou pelo "✕" do badge em outra aba). onReady roda toda vez que o estado é
// (re)carregado, pra quem chamou decidir se injeta ou remove o badge.
function gdlInitStorage(onReady) {
  try {
    chrome.storage.local.get([GDL_STORAGE_KEY], (res) => {
      gdlEnabled = res[GDL_STORAGE_KEY] !== false; // padrão: ativado
      onReady();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(GDL_STORAGE_KEY in changes)) return;
      gdlEnabled = changes[GDL_STORAGE_KEY].newValue !== false;
      onReady();
    });
  } catch {
    onReady(); // storage indisponível por algum motivo — segue com o padrão
  }
}

// Rotina comum de "SPA": reinjeta ao trocar de URL (a maioria desses sites
// não recarrega a página ao navegar) e observa mudanças no DOM como rede de
// segurança. injectFn deve ser idempotente (não duplicar o badge).
function gdlWatchAndInject(injectFn, { pollMs = 1200 } = {}) {
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; gdlRemoveBadge(); }
    injectFn();
  }, pollMs);
  document.addEventListener('fullscreenchange', gdlUpdateFullscreenVisibility);
  new MutationObserver(() => injectFn()).observe(document.documentElement, { childList: true, subtree: true });
  gdlInitStorage(injectFn);
}
