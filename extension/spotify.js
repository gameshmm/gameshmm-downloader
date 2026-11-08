// Spotify Web Player: é só áudio (sem elemento <video> pra ancorar em cima),
// então o badge flutua fixo no canto da tela em vez de dentro de um player.
// O app já sabe lidar com link do Spotify (busca a música/álbum/playlist
// sozinho) — só precisa receber a URL, igual aos outros sites.
(() => {
  function isTrackPage() {
    // O Spotify Web Player prefixa a URL com o idioma (ex: /intl-pt/album/...)
    // dependendo da região/idioma do navegador — o prefixo é opcional aqui
    // pra cobrir os dois casos.
    return /^\/(?:intl-[^/]+\/)?(track|album|playlist)\//.test(location.pathname);
  }

  function inject() {
    if (!gdlEnabled || !isTrackPage()) { gdlRemoveBadge(); return; }
    if (document.getElementById(GDL_BADGE_ID)) return;
    const badge = gdlBuildBadge('Baixar do Spotify', () => location.href);
    badge.classList.add('gdl-badge-floating');
    document.body.appendChild(badge);
  }

  gdlWatchAndInject(inject);
})();
