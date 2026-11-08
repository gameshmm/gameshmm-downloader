const STORAGE_KEY = 'gdlButtonEnabled';
const toggle = document.getElementById('toggle');
const bridgePill = document.getElementById('bridge-pill');
const bridgeText = document.getElementById('bridge-text');
const btnSendTab = document.getElementById('btn-send-tab');
const tabHint = document.getElementById('tab-hint');
const loginStatus = document.getElementById('login-status');
const btnConnectLogin = document.getElementById('btn-connect-login');
const loginHint = document.getElementById('login-hint');
const btnResetLogin = document.getElementById('btn-reset-login');

browser.storage.local.get([STORAGE_KEY]).then((res) => { toggle.checked = res[STORAGE_KEY] !== false; });

toggle.addEventListener('change', () => {
  browser.storage.local.set({ [STORAGE_KEY]: toggle.checked });
});

async function getActiveHttpTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && /^https?:\/\//i.test(tab.url || '')) return tab;
  } catch {}
  return null;
}

let currentBridge = { alive: false, port: null, cookiesConnected: false, version: '' };
let currentTab = null;

function renderBridgeAndActions() {
  if (currentBridge.alive) {
    bridgePill.className = 'bridge-pill online';
    const ver = currentBridge.version ? ` • v${currentBridge.version}` : '';
    bridgeText.textContent = `App conectado (porta ${currentBridge.port}${ver})`;
  } else {
    bridgePill.className = 'bridge-pill offline';
    bridgeText.textContent = 'App fechado (modo protocolo)';
  }

  if (currentBridge.alive && currentTab) {
    btnSendTab.disabled = false;
    btnSendTab.textContent = 'Mandar página atual pro app';
    try {
      const u = new URL(currentTab.url);
      tabHint.textContent = `Pronto para enviar: ${u.hostname}`;
    } catch {
      tabHint.textContent = 'Envia o link da aba atual direto pro app.';
    }
  } else if (!currentTab) {
    btnSendTab.disabled = true;
    btnSendTab.textContent = 'Mandar página atual pro app';
    tabHint.textContent = 'Abra uma página http(s) para enviar o link pro app.';
  } else {
    btnSendTab.disabled = true;
    btnSendTab.textContent = 'Abra o app p/ enviar esta aba';
    tabHint.textContent = 'Com o app fechado, clique no botão injetado no player do vídeo.';
  }

  if (currentBridge.alive) {
    btnConnectLogin.classList.remove('hidden');
    if (currentBridge.cookiesConnected) {
      loginStatus.textContent = 'YouTube conectado no app ✓';
      loginStatus.className = 'login-status ok';
      btnConnectLogin.textContent = 'Atualizar login no app';
    } else {
      loginStatus.textContent = 'YouTube ainda não conectado no app';
      loginStatus.className = 'login-status';
      btnConnectLogin.textContent = 'Conectar YouTube ao app';
    }
    loginHint.textContent = 'Envia os cookies de autenticação deste navegador direto para o app pela bridge local.';
  } else {
    btnConnectLogin.classList.add('hidden');
    loginStatus.textContent = 'Modo protocolo (app fechado)';
    loginStatus.className = 'login-status';
    loginHint.innerHTML = 'Abra o app para conectar por aqui, ou vá em <b>youtube.com</b> e clique em <b>"Conectar ao app"</b>.';
  }
}

async function refreshPopupState() {
  const [tab, st] = await Promise.all([
    getActiveHttpTab(),
    browser.runtime.sendMessage({ type: 'gdl-bridge-status' }).catch(() => ({ alive: false })),
  ]);
  currentTab = tab;
  currentBridge = st && st.alive ? st : { alive: false, port: null, cookiesConnected: false, version: '' };
  renderBridgeAndActions();
}

btnSendTab.addEventListener('click', async () => {
  if (!currentTab || !currentBridge.alive) return;
  btnSendTab.disabled = true;
  btnSendTab.textContent = 'Enviando...';
  try {
    const res = await browser.runtime.sendMessage({ type: 'gdl-bridge-open', url: currentTab.url });
    if (res && res.ok) {
      btnSendTab.textContent = 'Enviado pro app ✓';
      tabHint.textContent = 'O app já recebeu o link!';
      setTimeout(refreshPopupState, 1800);
    } else {
      btnSendTab.textContent = 'Falha ao enviar';
      tabHint.textContent = res?.error || 'Não foi possível enviar ao app.';
      setTimeout(refreshPopupState, 2000);
    }
  } catch {
    setTimeout(refreshPopupState, 1500);
  }
});

btnConnectLogin.addEventListener('click', async () => {
  if (!currentBridge.alive) return;
  btnConnectLogin.disabled = true;
  btnConnectLogin.textContent = 'Conectando...';
  try {
    const res = await browser.runtime.sendMessage({ type: 'gdl-bridge-cookies' });
    if (res && res.ok) {
      btnConnectLogin.textContent = 'Conectado ✓';
      await refreshPopupState();
    } else {
      loginStatus.textContent = res?.error || 'Não foi possível conectar.';
      loginStatus.className = 'login-status';
      btnConnectLogin.textContent = 'Tentar novamente';
    }
  } finally {
    btnConnectLogin.disabled = false;
  }
});

if (btnResetLogin) {
  btnResetLogin.addEventListener('click', () => {
    browser.storage.local.set({ gdlLoginConnected: false });
    btnResetLogin.textContent = 'Pronto! Botão reativado no YouTube.';
    setTimeout(() => { btnResetLogin.textContent = 'Desconectei no app — mostrar o botão de novo'; }, 2000);
  });
}

refreshPopupState();
setInterval(refreshPopupState, 2500);
