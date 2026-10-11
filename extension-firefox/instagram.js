// Instagram: só em reels/posts/IGTV individuais (/reel/, /p/, /tv/) — não no
// feed, onde vários vídeos podem estar visíveis/tocando ao mesmo tempo.
(() => {
  function isMediaPage() {
    return /^\/(reel|p|tv)\/[^/]+\/?/.test(location.pathname);
  }

  function inject() {
    if (!gdlEnabled || !isMediaPage() || !document.querySelector('video')) { gdlRemoveBadge(); return; }
    if (document.getElementById(GDL_BADGE_ID)) return;
    const container = gdlFindVideoContainer();
    if (!container) return;
    gdlEnsurePositioned(container).appendChild(gdlBuildBadge('Baixar vídeo', () => location.href));
  }

  gdlWatchAndInject(inject);
})();
