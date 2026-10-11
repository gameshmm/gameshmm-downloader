// Versão Firefox — usa o namespace `browser.*` (baseado em Promise), que é o
// nativo do Firefox, em vez do `chrome.*` (baseado em callback) usado na
// versão Chrome/Edge desta mesma extensão (ver /extension). O resto da
// lógica é idêntica — só a forma de chamar a API muda.
//
// Background script em segundo plano — junto com o popup, é o único lugar
// que tem acesso à API browser.cookies (content scripts, que rodam dentro da
// página de verdade, não têm essa API). O botão "Conectar ao app" mora na
// própria página do YouTube (ver content.js) porque só um clique de verdade
// no DOM da página conta como gesto do usuário pro Firefox liberar o
// protocolo customizado gameshmm-downloader:// — um clique no popup da
// extensão, repassado por mensagem pro content script, não conta (mesmo
// comportamento confirmado na versão Chrome). Por isso dividimos em duas
// etapas: o clique acontece na página, que pede os cookies aqui (rápido, é
// tudo local) e só então navega, ainda dentro da mesma janela de gesto do
// usuário.
// google.com sozinho já acumula dezenas de cookies (anúncios, consentimento,
// analytics, outros serviços Google como Drive/Mail se a pessoa usa) que não
// têm nada a ver com login — mandar todos inflava o link pra ~44KB numa
// conta real, o que pode estourar algum limite no caminho até o Windows. Só
// os cookies de sessão/autenticação de verdade (nome contém "SID", ou é
// LOGIN_INFO) bastam pro yt-dlp reconhecer o login.
const AUTH_COOKIE_NAME_RE = /SID|LOGIN_INFO/i;

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'gdl-get-login-cookies') return; // não é pra nós, deixa outro listener responder

  // Retornar uma Promise (em vez de usar sendResponse + return true, estilo
  // chrome.*) é como o listener assíncrono funciona no namespace browser.*.
  return (async () => {
    try {
      const [googleCookies, youtubeCookies] = await Promise.all([
        browser.cookies.getAll({ domain: 'google.com' }),
        browser.cookies.getAll({ domain: 'youtube.com' }),
      ]);
      const all = [...googleCookies, ...youtubeCookies].filter(c => AUTH_COOKIE_NAME_RE.test(c.name));
      const seen = new Set();
      const unique = all.filter(c => {
        const key = `${c.domain}|${c.path}|${c.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ok: true, cookies: unique };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  })();
});
