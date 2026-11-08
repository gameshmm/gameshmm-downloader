// Service worker em segundo plano — junto com o popup, é o único lugar que
// tem acesso à API chrome.cookies e às chamadas diretas pra bridge HTTP local.
// Canal principal quando o app está aberto: bridge HTTP local em 127.0.0.1
// (portas 47832..47835), com feedback real de entrega e status de login.
// Fallback quando o app está fechado: protocolo gameshmm-downloader:// clicado
// diretamente na página dentro do gesto síncrono do usuário.
const AUTH_COOKIE_NAME_RE = /SID|LOGIN_INFO/i;
const BRIDGE_PORTS = [47832, 47833, 47834, 47835];
const LOGIN_CONNECTED_KEY = 'gdlLoginConnected';

let lastKnownPort = null;

async function syncLoginConnectedStorage(cookiesConnected) {
  if (typeof cookiesConnected !== 'boolean') return;
  try {
    const cur = await new Promise((resolve) => chrome.storage.local.get([LOGIN_CONNECTED_KEY], (r) => resolve(r || {})));
    const next = !!cookiesConnected;
    if (Boolean(cur?.[LOGIN_CONNECTED_KEY]) !== next) {
      await new Promise((resolve) => chrome.storage.local.set({ [LOGIN_CONNECTED_KEY]: next }, resolve));
    }
  } catch {}
}

async function getAuthCookies() {
  const [googleCookies, youtubeCookies] = await Promise.all([
    chrome.cookies.getAll({ domain: 'google.com' }),
    chrome.cookies.getAll({ domain: 'youtube.com' }),
  ]);
  const all = [...googleCookies, ...youtubeCookies].filter(c => AUTH_COOKIE_NAME_RE.test(c.name));
  const seen = new Set();
  return all.filter(c => {
    const key = `${c.domain}|${c.path}|${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 550) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function checkBridgePort(port) {
  try {
    const res = await fetchJsonWithTimeout(`http://127.0.0.1:${port}/status`, {
      method: 'GET',
      headers: { 'X-GDL-Extension': '1' },
    }, 500);
    if (res.ok && res.data && res.data.bridge === 'gameshmm-downloader') {
      return {
        alive: true,
        port,
        cookiesConnected: !!res.data.cookiesConnected,
        version: res.data.version || '',
        elevated: !!res.data.elevated,
      };
    }
  } catch {}
  return null;
}

async function probeBridge() {
  if (lastKnownPort) {
    const hit = await checkBridgePort(lastKnownPort);
    if (hit) {
      await syncLoginConnectedStorage(hit.cookiesConnected);
      return hit;
    }
    lastKnownPort = null;
  }

  const results = await Promise.all(BRIDGE_PORTS.map(checkBridgePort));
  const found = results.find(Boolean);
  if (found) {
    lastKnownPort = found.port;
    await syncLoginConnectedStorage(found.cookiesConnected);
    return found;
  }
  return { alive: false, port: null, cookiesConnected: false, version: '', elevated: false };
}

async function postToBridge(route, payload) {
  let port = lastKnownPort;
  if (!port) {
    const st = await probeBridge();
    if (!st.alive) return { ok: false, offline: true, error: 'App não está aberto no momento.' };
    port = st.port;
  }

  const attempt = async (targetPort) => {
    return fetchJsonWithTimeout(`http://127.0.0.1:${targetPort}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GDL-Extension': '1',
      },
      body: JSON.stringify(payload || {}),
    }, 3000);
  };

  try {
    const r = await attempt(port);
    if (r.data && typeof r.data.cookiesConnected === 'boolean') {
      await syncLoginConnectedStorage(r.data.cookiesConnected);
    }
    return {
      ok: r.ok && (!r.data || r.data.ok !== false),
      port,
      status: r.status,
      ...(r.data || {}),
    };
  } catch {
    lastKnownPort = null;
    const retrySt = await probeBridge();
    if (!retrySt.alive) return { ok: false, offline: true, error: 'Conexão com o app perdida.' };
    try {
      const r2 = await attempt(retrySt.port);
      if (r2.data && typeof r2.data.cookiesConnected === 'boolean') {
        await syncLoginConnectedStorage(r2.data.cookiesConnected);
      }
      return {
        ok: r2.ok && (!r2.data || r2.data.ok !== false),
        port: retrySt.port,
        status: r2.status,
        ...(r2.data || {}),
      };
    } catch (e) {
      lastKnownPort = null;
      return { ok: false, offline: true, error: e?.message || 'Falha ao falar com o app.' };
    }
  }
}

async function handleMessage(msg) {
  if (msg.type === 'gdl-get-login-cookies') {
    try {
      const cookies = await getAuthCookies();
      return { ok: true, cookies };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  if (msg.type === 'gdl-bridge-status') {
    const bridge = await probeBridge();
    let hasCookies = false;
    if (msg.includeCookiesCheck) {
      try {
        const cookies = await getAuthCookies();
        hasCookies = cookies.length > 0;
      } catch {}
    }
    return { ok: true, ...bridge, hasCookies };
  }

  if (msg.type === 'gdl-bridge-open') {
    const url = typeof msg.url === 'string' ? msg.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL inválida.' };
    }
    return postToBridge('/open', { url });
  }

  if (msg.type === 'gdl-bridge-cookies') {
    try {
      const cookies = await getAuthCookies();
      if (!cookies.length) {
        return {
          ok: false,
          noCookies: true,
          error: 'Nenhum cookie de login do YouTube/Google encontrado neste navegador.',
        };
      }
      return postToBridge('/cookies', { cookies });
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  return { ok: false, error: 'Mensagem desconhecida.' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('gdl-')) return false;
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});
