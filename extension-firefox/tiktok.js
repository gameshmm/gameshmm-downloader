// TikTok: só mostra o botão numa página de vídeo específica (não na home
// nem na busca, onde tem várias prévias de vídeo ao mesmo tempo e não daria
// pra saber qual delas o usuário quer baixar).
(() => {
  function isVideoPage() {
    return /\/@[^/]+\/video\/\d+/.test(location.pathname) || /^\/v\/\d+/.test(location.pathname);
  }

  function inject() {
    if (!gdlEnabled || !isVideoPage()) { gdlRemoveBadge(); return; }
    if (document.getElementById(GDL_BADGE_ID)) return;
    const container = gdlFindVideoContainer();
    if (!container) return; // player ainda não montou — a próxima rodada tenta de novo
    gdlEnsurePositioned(container).appendChild(gdlBuildBadge('Baixar vídeo', () => location.href));
  }

  gdlWatchAndInject(inject);
})();
