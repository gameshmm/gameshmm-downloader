// X/Twitter: só na página de detalhe de um post (".../status/123...") —
// no feed tem vários posts com vídeo na tela ao mesmo tempo, então não dá
// pra saber qual deles o botão deveria baixar.
(() => {
  function isStatusPage() {
    return /^\/[^/]+\/status\/\d+/.test(location.pathname);
  }

  function canonicalUrl() {
    const m = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    return m ? `https://x.com/${m[1]}/status/${m[2]}` : location.href;
  }

  function inject() {
    if (!gdlEnabled || !isStatusPage() || !document.querySelector('video')) { gdlRemoveBadge(); return; }
    if (document.getElementById(GDL_BADGE_ID)) return;
    const container = gdlFindVideoContainer();
    if (!container) return;
    gdlEnsurePositioned(container).appendChild(gdlBuildBadge('Baixar vídeo', canonicalUrl));
  }

  gdlWatchAndInject(inject);
})();
