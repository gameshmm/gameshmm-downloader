const { app, BrowserWindow, ipcMain, dialog, shell, Notification, clipboard, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const ffmpeg = require('ffmpeg-static');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const {
  DUP_IGNORED_PARAMS,
  normalizeUrlForDup,
  isSafeMediaUrl,
  parseSpotifyUrl,
  parseTimeToSeconds,
  sanitizeOutputFilename,
  AUDIO_ONLY_EXTENSIONS,
  CONTAINER_COMPAT,
  SPOT_FMT_MAP,
  SPOT_QUALITY_MAP,
  evaluateDiskSpace,
  sanitizeLangCode,
  extractAudioTracksAndSubs,
  buildAudioSelector,
  buildVideoFormatExpression,
  sanitizeDiagnosticStderr,
  canOfferCompatRetry,
  validateBridgeHeaders,
  computeNextScheduleTimestamp,
} = require('./lib/media-utils');

// Resolve binaries out of asar when running from installed app
const rawYtDlp     = require('youtube-dl-exec/src/constants').YOUTUBE_DL_PATH;
const bundledYtDlp = rawYtDlp.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const bundledFfmpeg = ffmpeg ? ffmpeg.replace('app.asar', 'app.asar.unpacked') : '';
let ffmpegBin      = bundledFfmpeg;
let ffmpegSource   = 'bundled'; // 'bundled' | 'managed' | 'system'

function resolveFfmpegBin() {
  const managedFfmpeg = path.join(app.getPath('userData'), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {
    if (fs.existsSync(managedFfmpeg) && fs.statSync(managedFfmpeg).size > 0) {
      ffmpegBin = managedFfmpeg;
      ffmpegSource = 'managed';
      return;
    }
  } catch {}

  try {
    if (bundledFfmpeg && fs.existsSync(bundledFfmpeg) && fs.statSync(bundledFfmpeg).size > 0) {
      ffmpegBin = bundledFfmpeg;
      ffmpegSource = 'bundled';
      return;
    }
  } catch {}

  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore', windowsHide: true });
    ffmpegBin = 'ffmpeg';
    ffmpegSource = 'system';
    return;
  } catch {}

  ffmpegBin = bundledFfmpeg;
  ffmpegSource = 'bundled';
}

function isFfmpegOk() {
  if (ffmpegSource === 'system') return true;
  try { return fs.existsSync(ffmpegBin) && fs.statSync(ffmpegBin).size > 0; }
  catch { return false; }
}

function getInstalledFfmpegVersion() {
  return new Promise(resolve => {
    try {
      const proc = require('child_process').spawn(ffmpegBin, ['-version'], { windowsHide: true });
      let stdout = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.on('error', () => resolve(null));
      proc.on('close', code => {
        if (code === 0 && stdout) {
          const firstLine = stdout.split('\n')[0].replace(/^ffmpeg\s+version\s+/i, '').trim();
          resolve(firstLine);
        } else {
          resolve(null);
        }
      });
      setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 3000);
    } catch { resolve(null); }
  });
}

// ── yt-dlp: cópia empacotada vs. cópia gerenciada pelo app ────────────────────
// O yt-dlp que vem no instalador fica dentro da pasta de instalação (Program
// Files, normalmente), e `yt-dlp -U` atualiza reescrevendo o próprio .exe —
// escrita que o Windows nega pra um app comum. Era por isso que "Verificar
// Atualização" só funcionava com o app aberto como administrador.
// Agora o app mantém a *sua própria* cópia atualizada em %APPDATA%\<app>\bin e
// dá preferência a ela sempre que existir: atualizar virou baixar a release
// oficial do GitHub numa pasta onde o usuário sempre pode escrever, sem UAC.
const YTDLP_ASSET = process.platform === 'win32' ? 'yt-dlp.exe'
                  : process.platform === 'darwin' ? 'yt-dlp_macos'
                  : 'yt-dlp';
const managedYtDlpDir  = () => path.join(app.getPath('userData'), 'bin');
const managedYtDlpPath = () => path.join(managedYtDlpDir(), YTDLP_ASSET);

// `let` (e não `const`) porque o binário em uso troca em tempo de execução
// assim que o usuário atualiza — todo ponto que roda o yt-dlp lê essa
// variável na hora da chamada.
let ytDlpBin       = bundledYtDlp;
let youtubedl      = require('youtube-dl-exec').create(ytDlpBin);
let ytDlpIsManaged = false;

function resolveYtDlpBin() {
  let target = bundledYtDlp, managed = false;
  try {
    const m = managedYtDlpPath();
    if (fs.statSync(m).size > 0) { target = m; managed = true; }
  } catch {}
  // Sobra de uma atualização anterior (no Windows não dá pra apagar um .exe
  // que ainda estava em uso na hora da troca) — limpa quando der.
  try { fs.unlinkSync(managedYtDlpPath() + '.old'); } catch {}
  ytDlpBin       = target;
  ytDlpIsManaged = managed;
  youtubedl      = require('youtube-dl-exec').create(ytDlpBin);
}

let mainWindow;
const activeProcs = new Map();
const canceledDownloadIds = new Set();
const canceledPlaylistIds = new Set();
const canceledSpotifyIds  = new Set();

// ── Extensão do navegador: protocolo customizado ────────────────────────────────
// O botão "Baixar vídeo" da extensão (ver /extension) abre um link
// gameshmm-downloader://download?url=... em vez de falar com um servidor local
// — o Windows/navegador já cuida de abrir (ou focar, se já estiver aberto) este
// app sozinho. Aqui só precisamos: registrar o protocolo, garantir uma única
// instância do app (pra clicar o botão com o app já aberto não abrir outro do
// zero) e repassar a URL recebida pro renderer, que reaproveita o mesmo fluxo
// de "colar e buscar" já usado pela detecção de link na área de transferência.
//
// O mesmo protocolo também carrega os cookies de login: o popup da extensão
// manda gameshmm-downloader://cookies?data=<json base64> com o que leu via
// chrome.cookies (ver ingestCookiesFromExtension mais abaixo).
const PROTOCOL_SCHEME = 'gameshmm-downloader';

// ── Handoff por arquivo ───────────────────────────────────────────────────────
// Com o app já aberto, clicar na extensão dispara gameshmm-downloader://... e o
// Windows sobe uma *segunda* instância, que deveria repassar o link pra
// primeira. Esse repasse é feito por mensagem entre janelas — e o Windows
// (UIPI) proíbe um processo comum de mandar mensagem pra um processo elevado.
// Resultado: com o app aberto "como administrador", o clique na extensão morria
// em silêncio — nem o download, nem o login/cookies chegavam.
// A saída é não depender dessa mensagem: a instância nova grava o que recebeu
// num arquivo dentro da pasta de dados do usuário (que os dois processos
// enxergam igual, elevado ou não) e sai; a instância principal vigia essa pasta
// e consome. O caminho antigo ('second-instance') vira só um gatilho a mais pra
// ler a pasta na hora, sem carregar dado nenhum — assim nunca processa em
// duplicidade.
const handoffDir = () => path.join(app.getPath('userData'), 'handoff');

function writeHandoff(action) {
  try {
    fs.mkdirSync(handoffDir(), { recursive: true });
    const file = path.join(handoffDir(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    // Escreve num nome temporário e renomeia: o rename é atômico no mesmo
    // volume, então a instância principal (acordada pelo fs.watch, que dispara
    // na *criação* do arquivo) nunca lê um JSON pela metade e descarta o
    // recado como inválido.
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(action), 'utf8');
    fs.renameSync(tmp, file);
    return file;
  } catch { return null; }
}

// Marcador de "existe uma instância viva", usado só pra decidir se um
// lançamento novo deve virar handoff. É necessário porque, entre níveis de
// integridade diferentes, o próprio trava-instância do Electron pode não
// enxergar a instância elevada e deixar a nova achar que é a principal.
const instanceMarkerPath = () => path.join(app.getPath('userData'), 'instance.json');

function isOtherInstanceAlive() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(instanceMarkerPath(), 'utf8'));
    if (!pid || pid === process.pid) return false;
    try { process.kill(pid, 0); return true; }
    // EPERM = o processo existe, só não temos permissão pra sinalizar — que é
    // exatamente o caso do app rodando elevado visto de um processo comum.
    catch (e) { return e && e.code === 'EPERM'; }
  } catch { return false; }
}

function writeInstanceMarker() {
  try { fs.writeFileSync(instanceMarkerPath(), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8'); } catch {}
}
function clearInstanceMarker() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(instanceMarkerPath(), 'utf8'));
    if (pid === process.pid) fs.unlinkSync(instanceMarkerPath());
  } catch {}
}

// Espera curta e bloqueante pra ver se a instância principal consumiu o
// handoff. Roda só neste processo auxiliar de meio segundo de vida, antes de
// qualquer janela existir. Se ninguém consumir, o marcador era de um processo
// morto e este aqui segue como instância principal normalmente.
function waitHandoffConsumed(file, timeoutMs) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(file)) return true;
    Atomics.wait(sleeper, 0, 0, 120);
  }
  return !fs.existsSync(file);
}

const launchAction = extractProtocolAction(process.argv);
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // Já tem uma instância rodando: deixa o recado no arquivo e sai.
  if (launchAction) writeHandoff(launchAction);
  app.quit();
  return;
}

// Pegamos o lock, mas o marcador diz que tem outra instância viva — é o
// cenário "app aberto como administrador". Passa o recado pelo arquivo e sai;
// se ninguém consumir em ~2,5s o marcador estava velho, então segue normal.
if (launchAction && isOtherInstanceAlive()) {
  const file = writeHandoff(launchAction);
  if (file && waitHandoffConsumed(file, 2500)) {
    app.quit();
    return;
  }
  if (file) { try { fs.unlinkSync(file); } catch {} }
}
writeInstanceMarker();

// gameshmm-downloader://<action>?... — action é "download" (padrão/legado,
// sem host explícito também cai aqui) ou "cookies".
function extractProtocolAction(argv) {
  const arg = (argv || []).find(a => a.startsWith(`${PROTOCOL_SCHEME}://`));
  if (!arg) return null;
  try {
    const parsed = new URL(arg);
    if (parsed.hostname === 'cookies') {
      const data = parsed.searchParams.get('data');
      return data ? { type: 'cookies', data } : null;
    }
    const url = parsed.searchParams.get('url');
    // Só http(s). O protocolo é registrado no Windows, então qualquer página
    // pode disparar esse link — sem esse filtro, uma string começando com "-"
    // chegaria ao yt-dlp como opção de linha de comando (--exec e afins), não
    // como endereço. Os pontos que montam os argumentos também passaram a usar
    // "--" antes da URL, mas é melhor barrar já na porta de entrada.
    if (!url || !/^https?:\/\//i.test(url.trim())) return null;
    return { type: 'download', url: url.trim() };
  } catch { return null; }
}

// Se o app foi aberto direto pelo link (não estava rodando ainda), a ação já
// vem no argv de inicialização — guarda até a janela terminar de carregar pra repassar.
const pendingProtocolActions = launchAction ? [launchAction] : [];
const pendingLoginNotifications = [];
let pendingScheduledTrigger = null;
let pendingScheduleExpired = null;

function isMainWindowReady() {
  return mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading();
}

function getDiskFreeBytes(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return { freeBytes: null, checkedPath: null };
  let probe = path.resolve(targetPath);
  for (let i = 0; i < 12; i++) {
    try {
      if (fs.existsSync(probe)) {
        const st = fs.statfsSync(probe);
        if (st && typeof st.bavail !== 'undefined' && typeof st.bsize !== 'undefined') {
          return { freeBytes: Number(st.bavail) * Number(st.bsize), checkedPath: probe };
        }
        return { freeBytes: null, checkedPath: probe };
      }
    } catch {}
    const parent = path.dirname(probe);
    if (!parent || parent === probe) break;
    probe = parent;
  }
  return { freeBytes: null, checkedPath: null };
}

async function confirmDiskSpaceIfLow(savePath, estimatedBytes = 0, interactive = true) {
  const { freeBytes, checkedPath } = getDiskFreeBytes(savePath);
  const evaluation = evaluateDiskSpace(freeBytes, estimatedBytes);
  if (!evaluation.critical) return { proceed: true, evaluation, checkedPath };
  if (!interactive || !mainWindow || mainWindow.isDestroyed()) {
    return { proceed: false, blocked: true, error: evaluation.message, evaluation, checkedPath };
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Pouco espaço em disco',
    message: evaluation.message,
    detail: `Pasta selecionada: ${savePath}\n\nDeseja continuar mesmo assim?`,
    buttons: ['Continuar mesmo assim', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  });
  return { proceed: response === 0, canceledByUser: response !== 0, evaluation, checkedPath };
}

function applyProtocolAction(action) {
  if (!action) return;
  // Carimba "a extensão falou com o app agora" pro card de status em Config.
  try { const s = loadSettings(); s.extensionLastSeen = new Date().toISOString(); saveSettings(s); } catch {}
  if (action.type === 'cookies') {
    ingestCookiesFromExtension(action.data);
    return;
  }
  if (isMainWindowReady()) {
    mainWindow.webContents.send('open-download-url', action.url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    pendingProtocolActions.push(action);
  }
}

function handleProtocolActivation(argv) { applyProtocolAction(extractProtocolAction(argv)); }

// Lê (e apaga) tudo que instâncias novas deixaram na pasta de handoff.
// Recado velho é descartado sem executar: se o app foi fechado antes de
// consumir, ninguém quer ver aquele download começar sozinho dias depois.
const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
function consumeHandoffFiles() {
  let names;
  try { names = fs.readdirSync(handoffDir()); } catch { return; }
  names.filter(n => n.endsWith('.json')).sort().forEach(name => {
    const full = path.join(handoffDir(), name);
    let action = null, fresh = true;
    try { fresh = Date.now() - fs.statSync(full).mtimeMs < HANDOFF_MAX_AGE_MS; } catch {}
    if (fresh) { try { action = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {} }
    try { fs.unlinkSync(full); } catch {}
    if (action && action.type) applyProtocolAction(action);
  });
}

let handoffDebounce = null;
function startHandoffWatcher() {
  try { fs.mkdirSync(handoffDir(), { recursive: true }); } catch {}
  consumeHandoffFiles();
  try {
    fs.watch(handoffDir(), () => {
      clearTimeout(handoffDebounce);
      handoffDebounce = setTimeout(consumeHandoffFiles, 120);
    });
  } catch {}
  // Rede de segurança: fs.watch nem sempre avisa quando quem escreveu o
  // arquivo é um processo de outro nível de integridade.
  setInterval(consumeHandoffFiles, 1500);
}

// O argv da segunda instância é ignorado de propósito — o dado vem sempre pelo
// arquivo de handoff (ver acima). Aqui só aproveitamos o evento pra ler a
// pasta na hora em vez de esperar o próximo ciclo do vigia.
app.on('second-instance', () => consumeHandoffFiles());
// macOS entrega links de protocolo por esse evento em vez do argv.
app.on('open-url', (event, url) => { event.preventDefault(); handleProtocolActivation([url]); });

// Em desenvolvimento (`npm start` / `electron .`) o executável é o próprio
// Electron, então o registro precisa apontar pra ele + o caminho do app;
// empacotado, o exe já é o app e não precisa desse extra.
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const historyPath  = () => path.join(app.getPath('userData'), 'history.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return { defaultFolder: '', lastFolder: '' }; }
}
// Gravar settings/histórico nunca pode derrubar o app: essas funções são
// chamadas de dentro de timers e de handlers de IPC, onde uma exceção não
// tratada (disco cheio, pasta sem permissão, arquivo travado por antivírus)
// encerraria o processo principal em silêncio.
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); return true; }
  catch (e) { console.warn('[settings] não consegui gravar:', e.message); return false; }
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(historyPath(), 'utf8')); }
  catch { return []; }
}
function saveHistory(h) {
  try { fs.writeFileSync(historyPath(), JSON.stringify(h, null, 2)); return true; }
  catch (e) { console.warn('[histórico] não consegui gravar:', e.message); return false; }
}
function addToHistory(entry) {
  const h = loadHistory();
  h.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  if (h.length > 200) h.splice(200);
  saveHistory(h);
}

// ── Detecção de duplicado ────────────────────────────────────────────────────
// normalizeUrlForDup e DUP_IGNORED_PARAMS vêm de ./lib/media-utils.js.

// Procura no histórico um download com sucesso pro mesmo link. Não distingue
// vídeo/áudio/qualidade de propósito — se já baixou esse vídeo antes de
// qualquer jeito, vale avisar; quem decide se quer baixar de novo é o usuário.
function findDuplicateDownload(url) {
  const norm = normalizeUrlForDup(url);
  if (!norm) return null;
  const h = loadHistory();
  return h.find(entry => entry.status === 'success' && entry.url && normalizeUrlForDup(entry.url) === norm) || null;
}

// Heurística pra "o antivírus comeu o yt-dlp/ffmpeg em silêncio": esses são
// os formatos de erro que o child_process do Node lança quando um binário
// foi colocado em quarentena ou a pasta dele teve acesso bloqueado depois de
// já termos confirmado que o arquivo existe — sintoma clássico de Windows
// Defender (ou outro antivírus) barrando a execução.
function isLikelyDefenderBlock(msg = '') {
  return /ENOENT|EPERM|EACCES|Access is denied|cannot find the (file|path) specified|WinError 5|WinError 225/i.test(msg);
}

// Erro que o yt-dlp manda pra vídeo exclusivo de membros do canal (ex: "This
// video is available to this channel's members on level: ... Join this
// channel..."). Não tem "Sign in"/"Private" na mensagem, então precisa de
// checagem própria — ver NEEDS_LOGIN_RE mais abaixo.
function isMembersOnlyError(msg = '') {
  return /members-only|channel'?s? members|join this channel/i.test(msg);
}

function friendlyError(msg = '') {
  if (msg.includes('Could not copy') && msg.includes('cookie database'))
    return 'Feche o navegador completamente para liberar os cookies e tente novamente.';
  if (msg.includes('DPAPI'))
    return 'O Chrome (127+) bloqueia a leitura de cookies por apps externos, mesmo como administrador. Clique em "Conectar" para fazer login direto pelo app, sem depender do Chrome.';
  if (msg.includes('Private video') || msg.includes('This video is private'))
    return 'Vídeo privado. Faça login com uma conta que tenha acesso.';
  if (isMembersOnlyError(msg))
    return getCookieAuth()
      ? 'Vídeo exclusivo para membros do canal. Você já conectou uma conta, mas ela não tem a assinatura desse canal — confirme que é a mesma conta Google inscrita como membro e tente "Conectar" de novo.'
      : 'Vídeo exclusivo para membros do canal. Clique em "Conectar" e faça login com a conta que é membro/assinante desse canal.';
  // Desde meados de 2026 o YouTube passou a exigir resolver um desafio em
  // JavaScript (o parâmetro "n") pra liberar a maioria dos formatos de vídeo.
  // Sem um runtime JS (Deno ou Node 22+) que o yt-dlp consiga usar, quase
  // todo formato "cai" e sobra só imagem — o que aparece pro usuário como
  // "Requested format is not available", sem menção nenhuma ao motivo real.
  // Ver nodeJsRuntimeArgs() mais abaixo e https://github.com/yt-dlp/yt-dlp/wiki/EJS.
  if (msg.includes('Only images are available for download') || /n challenge solving failed/i.test(msg) || /SABR streaming/i.test(msg) || msg.includes('Requested format is not available')) {
    return nodeJsRuntimeArgs().length
      ? 'O YouTube exige resolver um desafio de JavaScript pra liberar os formatos de vídeo, e mesmo com o Node.js detectado no seu PC isso falhou. Tente instalar o Deno (deno.com) — o yt-dlp usa ele automaticamente e costuma ser mais confiável nesse desafio do que o Node — ou atualize o Node.js pra uma versão mais nova.'
      : 'O YouTube passou a exigir resolver um desafio de JavaScript pra liberar a maioria dos formatos de vídeo, e não encontrei nenhum runtime JS instalado no seu PC (Deno ou Node.js 22+). Instale o Deno (deno.com — mais simples, o yt-dlp já usa ele sozinho, sem precisar mexer em nada aqui no app) ou o Node.js 22 ou mais recente (nodejs.org), depois reabra o app e tente de novo.';
  }
  if (msg.includes('Video unavailable'))
    return 'Vídeo indisponível ou removido.';
  if (msg.includes('Sign in') || msg.includes('bot'))
    return 'O site exige login. Clique em "Conectar" para autenticar.';
  if (msg.includes('ERROR: Unsupported URL'))
    return 'URL não suportada. Verifique se o link está correto.';
  if (msg.includes('HTTP Error 404'))
    return 'Conteúdo não encontrado (404). Verifique o link.';
  if (msg.includes('HTTP Error 403'))
    return 'Acesso negado (403) nesse formato. Costuma acontecer em qualidades muito altas (ex: 4K), que o YouTube bloqueia sem um token especial que o yt-dlp não consegue gerar sozinho. Tente uma qualidade menor (ex: 1080p) ou clique em "Conectar" para fazer login.';
  if (isLikelyDefenderBlock(msg))
    return 'Não foi possível executar uma etapa do download (yt-dlp/ffmpeg). Isso pode ser o Windows Defender (ou outro antivírus) bloqueando o programa, ou falta de permissão na pasta de destino. Confira o Histórico de proteção em Segurança do Windows e, se precisar, adicione uma exceção para a pasta do app.';
  return msg;
}

// Mensagens de erro do yt-dlp que indicam "isso resolve (ou pode resolver)
// com login" — vale tentar de novo com os cookies da conta conectada antes
// de desistir. Inclui o caso de vídeo exclusivo de membros (ver
// isMembersOnlyError acima), que não tem "Sign in" nem "Private" na mensagem.
const NEEDS_LOGIN_RE = /Sign in|bot|age|Private|members-only|channel'?s? members|join this channel/i;

function getCookieBrowser() {
  const s = loadSettings();
  return s.cookieBrowser || null;
}

// ── Cookie auth: login via extensão (preferido) vs. navegador instalado (legado) ─
// A extensão do navegador (ver /extension) exporta os cookies de login
// direto da conta Google já autenticada no navegador de verdade do usuário,
// via chrome.cookies — e manda pro app pelo mesmo protocolo customizado já
// usado pro botão de download. Isso tem prioridade sobre o método antigo de
// ler cookies direto do perfil de um navegador instalado, porque evita dois
// problemas de uma vez: o Chrome 127+ não deixa mais nenhum programa externo
// descriptografar seus cookies sozinho (nem como admin — "App-Bound
// Encryption"), e copiar o banco de cookies de outro app é exatamente o
// tipo de coisa que antivírus (Windows Defender incluso) sinalizam como
// comportamento de infostealer. A extensão em si não esbarra em nenhum dos
// dois: ela já roda dentro do navegador com acesso legítimo aos cookies.
//
// (Uma janela de login embutida no próprio Electron foi tentada antes disso
// e removida — o Google bloqueia esse tipo de login com "Esse navegador ou
// app pode não ser seguro", já que detecta o Chromium do Electron como um
// webview embutido não confiável.)
const cookiesFilePath = () => path.join(app.getPath('userData'), 'yt-cookies.txt');

function hasEmbeddedCookies() {
  try { return fs.statSync(cookiesFilePath()).size > 0; } catch { return false; }
}

function getCookieAuth() {
  if (hasEmbeddedCookies()) return { mode: 'file', path: cookiesFilePath() };
  const browser = getCookieBrowser();
  if (browser) return { mode: 'browser', browser };
  return null;
}

// Aplica a autenticação de cookies a um objeto de opções do youtube-dl-exec
// (usado nas chamadas que retornam JSON: get-video-info, get-playlist-info).
function applyCookieOpts(opts) {
  const auth = getCookieAuth();
  if (!auth) return false;
  if (auth.mode === 'file') opts.cookies = auth.path;
  else opts.cookiesFromBrowser = auth.browser;
  return true;
}

// Limite de velocidade opcional (Configurações). Guardado já no formato que o
// yt-dlp entende ("2M", "500K"); vazio = sem limite.
function pushRateLimitArgs(args) {
  const raw = String(loadSettings().limitRate || '').trim();
  if (raw) args.push('--limit-rate', raw);
  return args;
}

// ── Opções de download (aba Configurações) ───────────────────────────────────
// Tudo aqui é lido do settings.json na hora de montar os argumentos, então
// mudar a configuração vale já no próximo download, sem reiniciar o app.

// Template de nome de arquivo. É guardado SEM a extensão (o yt-dlp acrescenta
// via %(ext)s) e passa por uma peneira: nada de barra, ".." ou caminho
// absoluto, senão um template mal escrito conseguiria gravar fora da pasta de
// destino escolhida.
const DEFAULT_OUTPUT_TEMPLATE = '%(title)s';
function outputTemplate() {
  const raw = String(loadSettings().outputTemplate || '').trim();
  if (!raw) return DEFAULT_OUTPUT_TEMPLATE + '.%(ext)s';
  if (/[\\/]/.test(raw) || raw.includes('..') || /^[a-zA-Z]:/.test(raw)) return DEFAULT_OUTPUT_TEMPLATE + '.%(ext)s';
  return raw + '.%(ext)s';
}

// Legendas. "embed" gruda dentro do vídeo (e o yt-dlp apaga os arquivos
// temporários sozinho); "file" salva .srt ao lado do vídeo.
function pushSubtitleArgs(args, s) {
  const mode = s.subsMode || 'off';
  if (mode !== 'embed' && mode !== 'file') return;
  const langs = String(s.subsLangs || '').trim() || 'pt-BR,pt,en';
  if (mode === 'file') args.push('--write-subs', '--convert-subs', 'srt');
  else args.push('--embed-subs');
  if (s.subsAuto !== false) args.push('--write-auto-subs');
  args.push('--sub-langs', langs);
}

// Corta trechos marcados pela comunidade no SponsorBlock. Vale só pro YouTube;
// nos outros sites o yt-dlp simplesmente ignora.
function pushSponsorBlockArgs(args, s) {
  const mode = s.sponsorblock || 'off';
  if (mode === 'sponsor') args.push('--sponsorblock-remove', 'sponsor');
  else if (mode === 'all') args.push('--sponsorblock-remove', 'sponsor,intro,outro,selfpromo,interaction,music_offtopic');
}

// Extras que só fazem sentido em vídeo (o ramo de áudio já embute capa e tags).
function pushVideoExtraArgs(args, s) {
  if (s.embedMetadata !== false) args.push('--embed-metadata');
  if (s.embedChapters !== false) args.push('--embed-chapters');
  if (s.embedThumbnail !== false) args.push('--embed-thumbnail');
  pushSubtitleArgs(args, s);
  pushSponsorBlockArgs(args, s);
}

// Nomes de arquivo seguros no Windows: sem caracteres proibidos e sem estourar
// o limite de caminho com títulos quilométricos (o que fazia o download falhar
// no fim, depois de baixar tudo).
function pushFilenameSafetyArgs(args) {
  args.push('--windows-filenames', '--trim-filenames', '180');
}

// Aplica a autenticação de cookies a um array de argumentos de CLI do yt-dlp
// (usado nos downloads reais, que rodam via spawn direto).
function pushCookieArgs(args) {
  const auth = getCookieAuth();
  if (!auth) return false;
  if (auth.mode === 'file') args.push('--cookies', auth.path);
  else args.push('--cookies-from-browser', auth.browser);
  return true;
}

function isAuthCookieDomain(domain = '') {
  const d = domain.replace(/^\./, '');
  return d === 'google.com' || d.endsWith('.google.com') || d === 'youtube.com' || d.endsWith('.youtube.com');
}

// Converte os cookies (mandados pela extensão via chrome.cookies.getAll, já
// em texto puro — o navegador que os descriptografou de verdade) pro
// formato Netscape que o yt-dlp entende com --cookies.
function cookiesToNetscapeFile(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Gerado pelo gameshmm downloader — não edite manualmente.', ''];
  for (const c of cookies) {
    const domain = c.hostOnly ? c.domain : (c.domain.startsWith('.') ? c.domain : '.' + c.domain);
    const includeSubdomains = c.hostOnly ? 'FALSE' : 'TRUE';
    const cpath = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = (c.session || !c.expirationDate) ? 0 : Math.round(c.expirationDate);
    lines.push([domain, includeSubdomains, cpath, secure, expiry, c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

// Recebe o payload de cookies mandado pela extensão do navegador (via
// gameshmm-downloader://cookies?data=<json base64> ou HTTP bridge /cookies), grava
// em disco no formato Netscape e avisa a janela principal pra atualizar o badge
// de login.
function ingestCookiesFromExtensionPayload(cookies, { focusWindow = true } = {}) {
  if (!Array.isArray(cookies)) {
    const msg = 'Não consegui ler os cookies enviados pela extensão. Tente atualizar a extensão e conectar de novo.';
    notifyLoginResult(false, msg, { focusWindow });
    return { ok: false, error: msg };
  }
  const relevant = cookies.filter(c => c && c.name && c.domain && isAuthCookieDomain(c.domain));
  if (!relevant.length) {
    const msg = 'Nenhum cookie de login do YouTube/Google encontrado. Confirme que você está logado no navegador antes de clicar em "Conectar ao app" na extensão.';
    notifyLoginResult(false, msg, { focusWindow });
    return { ok: false, error: msg };
  }
  try {
    fs.writeFileSync(cookiesFilePath(), cookiesToNetscapeFile(relevant), 'utf8');
  } catch (e) {
    const msg = `Não consegui salvar os cookies de login em disco: ${e.message}`;
    notifyLoginResult(false, msg, { focusWindow });
    return { ok: false, error: msg };
  }
  const loggedIn = relevant.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === 'LOGIN_INFO');
  const err = loggedIn ? null : 'Cookies recebidos, mas não encontrei um login ativo. Confirme que você está logado no YouTube/Google nesse navegador.';
  notifyLoginResult(loggedIn, err, { focusWindow });
  return { ok: loggedIn, error: err };
}

function ingestCookiesFromExtension(base64Data) {
  let cookies;
  try {
    const json = Buffer.from(base64Data, 'base64').toString('utf8');
    cookies = JSON.parse(json);
    if (!Array.isArray(cookies)) throw new Error('payload não é uma lista');
  } catch {
    notifyLoginResult(false, 'Não consegui ler os cookies enviados pela extensão. Tente atualizar a extensão e conectar de novo.');
    return;
  }
  ingestCookiesFromExtensionPayload(cookies, { focusWindow: true });
}

function notifyLoginResult(success, error, { focusWindow = true } = {}) {
  if (!isMainWindowReady()) {
    pendingLoginNotifications.push({ success, error });
    return;
  }
  if (focusWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.webContents.send('login-cookies-received', { success, error });
}

// ── Bridge HTTP local para a extensão do navegador ────────────────────────────
const BRIDGE_PORTS = [47832, 47833, 47834, 47835];
let bridgeServer = null;
let bridgePort = null;

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('Payload muito grande'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendBridgeJson(res, statusCode, payload, corsOrigin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function listenBridgeOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => { server.removeListener('error', onError); resolve(port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function startLocalBridge() {
  if (bridgeServer) return bridgePort;
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ? String(req.headers.origin) : '';
    if (req.method === 'OPTIONS') {
      const check = validateBridgeHeaders({ method: 'POST', origin, headers: { 'x-gdl-extension': '1', 'content-type': 'application/json' } });
      if (!check.ok || !check.corsOrigin) {
        res.writeHead(403);
        res.end();
        return;
      }
      const preflightHeaders = {
        'Access-Control-Allow-Origin': check.corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-GDL-Extension',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      };
      if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
        preflightHeaders['Access-Control-Allow-Private-Network'] = 'true';
      }
      res.writeHead(204, preflightHeaders);
      res.end();
      return;
    }

    const authCheck = validateBridgeHeaders({ method: req.method, origin, headers: req.headers });
    if (!authCheck.ok) {
      sendBridgeJson(res, authCheck.status || 403, { ok: false, error: authCheck.reason }, null);
      return;
    }

    const pathname = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && pathname === '/status') {
      sendBridgeJson(res, 200, {
        ok: true,
        bridge: 'gameshmm-downloader',
        version: app.getVersion(),
        port: bridgePort,
        cookiesConnected: !!getCookieAuth(),
        elevated: isElevated(),
      }, authCheck.corsOrigin);
      return;
    }

    if (req.method === 'POST' && pathname === '/open') {
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const url = typeof body?.url === 'string' ? body.url.trim() : '';
        if (!isSafeMediaUrl(url)) {
          sendBridgeJson(res, 400, { ok: false, error: 'URL inválida' }, authCheck.corsOrigin);
          return;
        }
        applyProtocolAction({ type: 'download', url });
        sendBridgeJson(res, 200, { ok: true }, authCheck.corsOrigin);
      } catch (e) {
        sendBridgeJson(res, e.statusCode || 400, { ok: false, error: e.message }, authCheck.corsOrigin);
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/cookies') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        try { const s = loadSettings(); s.extensionLastSeen = new Date().toISOString(); saveSettings(s); } catch {}
        const result = ingestCookiesFromExtensionPayload(body?.cookies, { focusWindow: false });
        sendBridgeJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          cookiesConnected: !!getCookieAuth(),
          error: result.error || null,
        }, authCheck.corsOrigin);
      } catch (e) {
        sendBridgeJson(res, e.statusCode || 400, { ok: false, error: e.message }, authCheck.corsOrigin);
      }
      return;
    }

    sendBridgeJson(res, 404, { ok: false, error: 'Not found' }, authCheck.corsOrigin);
  });

  for (const port of BRIDGE_PORTS) {
    try {
      await listenBridgeOnPort(server, port);
      bridgeServer = server;
      bridgePort = port;
      return port;
    } catch {}
  }
  try { server.close(); } catch {}
  return null;
}

// ── Browser process info (for cookie-lock errors) ───────────────────────────────
const BROWSER_INFO = {
  chrome:  { label: 'Google Chrome',   process: 'chrome.exe',  unixProcess: 'Google Chrome' },
  edge:    { label: 'Microsoft Edge',  process: 'msedge.exe',  unixProcess: 'Microsoft Edge' },
  firefox: { label: 'Mozilla Firefox', process: 'firefox.exe', unixProcess: 'firefox' },
  brave:   { label: 'Brave',           process: 'brave.exe',   unixProcess: 'Brave Browser' },
  opera:   { label: 'Opera GX',        process: 'opera.exe',   unixProcess: 'Opera' },
};

// Builds a friendly error object. When the error is caused by the configured
// browser's cookie database being locked (browser still running), it also
// reports which browser/process is responsible so the UI can offer to close it.
function buildError(msg = '', context = {}) {
  const technicalDetails = sanitizeDiagnosticStderr(msg);
  const canCompatRetry = canOfferCompatRetry({ stderr: msg, error: msg, ...context });
  const isCookieLock = msg.includes('Could not copy') && msg.includes('cookie database');
  if (isCookieLock) {
    const browserKey = getCookieBrowser();
    const info = BROWSER_INFO[browserKey];
    return {
      error: info
        ? `Feche o ${info.label} completamente para liberar os cookies e tente novamente.`
        : 'Feche o navegador completamente para liberar os cookies e tente novamente.',
      lockedBrowser: browserKey || null,
      lockedBrowserLabel: info ? info.label : null,
      technicalDetails,
      canCompatRetry: false,
    };
  }
  if (isLikelyDefenderBlock(msg)) {
    return {
      error: friendlyError(msg),
      lockedBrowser: null,
      lockedBrowserLabel: null,
      maybeDefenderBlocked: true,
      technicalDetails,
      canCompatRetry: false,
    };
  }
  return {
    error: friendlyError(msg),
    lockedBrowser: null,
    lockedBrowserLabel: null,
    technicalDetails,
    canCompatRetry,
  };
}

function killBrowserProcess(browserKey) {
  const info = BROWSER_INFO[browserKey];
  if (!info) return Promise.resolve({ success: false, error: 'Navegador desconhecido.' });
  return new Promise(resolve => {
    const cmd = process.platform === 'win32'
      ? `taskkill /F /IM ${info.process} /T`
      : `pkill -9 -f "${info.unixProcess}"`;
    require('child_process').exec(cmd, (err, _stdout, stderr) => {
      const notFound = /not found/i.test(stderr || '') || err?.code === 128 || err?.code === 1;
      if (err && !notFound) {
        resolve({ success: false, error: (stderr || err.message || '').trim() });
      } else {
        resolve({ success: true, alreadyClosed: notFound });
      }
    });
  });
}

function killProc(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      require('child_process').exec(`taskkill /F /T /PID ${proc.pid}`, () => {});
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

const { spawn } = require('child_process');

// ── JS runtime pro desafio "n" do YouTube (EJS) ────────────────────────────────
// Desde meados de 2026 o YouTube passou a exigir resolver um desafio em
// JavaScript (o parâmetro "n") pra liberar a maioria dos formatos — sem isso,
// o yt-dlp cai pra "SABR streaming" e sobra só imagem, o que aparece pro
// usuário como "Requested format is not available". O yt-dlp já tenta
// resolver sozinho com Deno se achar um `deno` no PATH (não precisa de flag
// nenhuma pra isso — é o comportamento padrão dele). Se em vez disso o
// usuário tiver instalado Node.js (>= 22, exigido pelo próprio yt-dlp) sem
// Deno, o yt-dlp só usa esse Node se a gente passar --js-runtimes node
// explicitamente — então detectamos isso aqui uma única vez por sessão do
// app e, se achar, aplicamos a flag em toda chamada de yt-dlp.
let cachedNodeJsRuntimeArgs = null;
function nodeJsRuntimeArgs() {
  if (cachedNodeJsRuntimeArgs) return cachedNodeJsRuntimeArgs;
  cachedNodeJsRuntimeArgs = [];
  try {
    const r = require('child_process').spawnSync('node', ['--version'], { windowsHide: true, timeout: 3000 });
    const out = (r.stdout || '').toString().trim(); // ex: "v22.4.0"
    const major = parseInt(out.replace(/^v/, '').split('.')[0], 10);
    if (r.status === 0 && Number.isFinite(major) && major >= 22) cachedNodeJsRuntimeArgs = ['--js-runtimes', 'node'];
  } catch {}
  return cachedNodeJsRuntimeArgs;
}

function spawnDownload(args, downloadId) {
  const proc = spawn(ytDlpBin, [...nodeJsRuntimeArgs(), ...args], { windowsHide: true });
  if (downloadId) activeProcs.set(downloadId, proc);
  return proc;
}

// Mesma detecção, mas pro formato de opções do youtube-dl-exec (usado nas
// chamadas via dumpJson, que não passam pelo spawnDownload acima).
function withNodeJsRuntimeOpt(opts) {
  if (nodeJsRuntimeArgs().length) opts.jsRuntimes = 'node';
  return opts;
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindowLoaded = false;
  mainWindow = new BrowserWindow({
    width: 720, height: 840,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#0f0d1a',
    show: false,
    title: 'gameshmm downloader',
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindowLoaded = false; });
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindowLoaded = true;
    // Em try próprio: esse bloco grava settings, e uma falha nele não pode
    // impedir a fila de protocolo logo abaixo de rodar — que é o caminho
    // de "o app foi aberto pelo clique na extensão".
    try {
      const entries = getChangelogUpdateIfAny();
      if (entries && entries.length) mainWindow.webContents.send('show-changelog', entries);
    } catch (e) { console.warn('[changelog] falhou:', e.message); }
    while (pendingProtocolActions.length) {
      const action = pendingProtocolActions.shift();
      if (!action) continue;
      if (action.type === 'cookies') ingestCookiesFromExtension(action.data);
      else mainWindow.webContents.send('open-download-url', action.url);
    }
    while (pendingLoginNotifications.length) {
      const notif = pendingLoginNotifications.shift();
      mainWindow.webContents.send('login-cookies-received', notif);
    }
    if (pendingScheduledTrigger) {
      const trig = pendingScheduledTrigger;
      pendingScheduledTrigger = null;
      mainWindow.webContents.send('trigger-scheduled-queue', trig);
    }
    if (pendingScheduleExpired) {
      const exp = pendingScheduleExpired;
      pendingScheduleExpired = null;
      mainWindow.webContents.send('queue-schedule-expired', exp);
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Com a bandeja ativada (padrão), fechar a janela só esconde o app em vez
  // de encerrar — ele continua rodando (e monitorando downloads/updates) na
  // bandeja. "Sair" no menu da bandeja, ou qualquer outro caminho real de
  // saída (auto-update reiniciando, etc.), passa por 'before-quit' primeiro
  // e marca appIsQuitting, então esse handler deixa fechar de verdade.
  let traySoftHideNotified = false;
  mainWindow.on('close', (e) => {
    if (appIsQuitting) return;
    if (loadSettings().trayEnabled === false) return;
    e.preventDefault();
    mainWindow.hide();
    if (!traySoftHideNotified) {
      traySoftHideNotified = true;
      if (Notification.isSupported()) {
        new Notification({
          title: 'gameshmm downloader continua rodando',
          body: 'O app ficou na bandeja do sistema — clique no ícone pra abrir de novo, ou "Sair" no menu dele pra fechar de vez.',
        }).show();
      }
    }
  });
}

// ── Bandeja do sistema + atalho global ──────────────────────────────────────
let tray = null;
let appIsQuitting = false;
const GLOBAL_SHORTCUT_ACCELERATOR = 'CommandOrControl+Shift+D';

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Usado tanto pelo menu da bandeja quanto pelo atalho global: mostra o app e,
// se a área de transferência tiver um link, manda pro mesmo canal que a
// extensão do navegador já usa (preenche a URL e busca sozinho).
function pasteAndShow() {
  showMainWindow();
  let text = '';
  try { text = clipboard.readText(); } catch {}
  text = (text || '').trim();
  if (/^https?:\/\//i.test(text) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-download-url', text);
  }
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  } catch (e) {
    console.warn('Não consegui criar o ícone da bandeja:', e.message);
    return;
  }
  tray.setToolTip('gameshmm downloader');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir gameshmm downloader', click: showMainWindow },
    { label: 'Colar link e buscar', click: pasteAndShow },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
  tray.on('click', showMainWindow);
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null; }
}

function applyTraySetting() {
  const settings = loadSettings();
  if (settings.trayEnabled === false) destroyTray(); else createTray();
}

function applyGlobalShortcutSetting() {
  globalShortcut.unregisterAll();
  if (loadSettings().globalShortcutEnabled === false) return;
  try {
    const ok = globalShortcut.register(GLOBAL_SHORTCUT_ACCELERATOR, pasteAndShow);
    // register() só lança em caso de acelerador malformado — se outro
    // programa já estiver usando essa combinação, ele volta `false` em
    // silêncio, então avisamos aqui pra não parecer que o atalho devia
    // funcionar e simplesmente não fez nada.
    if (!ok) console.warn(`Atalho global ${GLOBAL_SHORTCUT_ACCELERATOR} não pôde ser registrado — provavelmente já está em uso por outro programa.`);
  } catch (e) {
    console.warn('Não consegui registrar o atalho global:', e.message);
  }
}

ipcMain.handle('get-global-shortcut', () => GLOBAL_SHORTCUT_ACCELERATOR);

// ── Changelog ─────────────────────────────────────────────────────────────────
// Reads CHANGELOG.md and, only the first time the app is reopened after an
// update (i.e. the installed version differs from the last one the user saw),
// sends the "what's new" notes to the renderer. If the user skipped several
// versions at once (e.g. was on 2.1.0 and updated straight to 2.2.2), every
// version's notes in between are included — not just the newest one — so
// nothing is missed. A brand-new install just records the current version
// silently — there's nothing to show a first-time user.
function semverCompare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function parseAllChangelogEntries() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    const blocks = raw.split(/\n(?=## )/).filter(b => b.startsWith('## '));
    return blocks.map(block => {
      const m = block.match(/^## (\S+)\s*-?\s*(.*)$/m);
      const version = m ? m[1] : '';
      const title = m ? m[2] : '';
      // Itens da lista, mais as linhas de seção em negrito ("**Correções**"),
      // que a janela de novidades mostra como subtítulo — sem elas, um
      // changelog grande virava uma parede de bolinhas sem contexto.
      const notes = block.split('\n').slice(1)
        .map(l => l.trim())
        .filter(l => l.startsWith('-') || l.startsWith('**'))
        .map(l => l.startsWith('-')
          ? { text: l.replace(/^-\s*/, ''), heading: false }
          : { text: l, heading: true });
      return { version, title, notes };
    }).filter(e => e.version);
  } catch {
    return [];
  }
}

function getChangelogUpdateIfAny() {
  const currentVersion = app.getVersion();
  const settings = loadSettings();
  const lastSeen = settings.lastSeenVersion;
  settings.lastSeenVersion = currentVersion;
  saveSettings(settings);
  if (!lastSeen || lastSeen === currentVersion) return null;

  const all = parseAllChangelogEntries();
  // Todas as versões mais novas que a última vista pelo usuário e até a
  // atual (inclusive), da mais nova pra mais antiga.
  const entries = all
    .filter(e => semverCompare(e.version, lastSeen) > 0 && semverCompare(e.version, currentVersion) <= 0)
    .sort((a, b) => semverCompare(b.version, a.version));

  return entries.length ? entries : null;
}

// ── Auto Update ───────────────────────────────────────────────────────────────
// Publishes/reads releases from the public repo configured in package.json ->
// build.publish (gameshmm/gameshmm-downloader). The app checks silently on
// startup, downloads in the background, and installs + restarts itself once
// downloaded (see scheduleAutoInstall below) — autoInstallOnAppQuit is just a
// safety net in case the app quits before that scheduling gets to run.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-status', payload);
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
autoUpdater.on('update-available', (info) => sendUpdateStatus({ status: 'available', version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateStatus({ status: 'not-available' }));
autoUpdater.on('download-progress', (p) => sendUpdateStatus({ status: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus({ status: 'downloaded', version: info.version });
  scheduleAutoInstall();
});
autoUpdater.on('error', (err) => sendUpdateStatus({ status: 'error', error: err?.message || String(err) }));

// Once a downloaded update is ready, install it on its own — no click needed.
// The only thing that holds it off is an in-progress download/conversion
// (activeProcs is the same map used for those), so we don't yank a file out
// from under the user; it just re-checks every 20s until the app is idle.
let autoInstallScheduled = false;
function scheduleAutoInstall() {
  if (autoInstallScheduled) return;
  autoInstallScheduled = true;
  const tryInstall = () => {
    if (activeProcs.size > 0) { setTimeout(tryInstall, 20000); return; }
    sendUpdateStatus({ status: 'installing' });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
  };
  tryInstall();
}

ipcMain.handle('check-for-updates', () => {
  if (!app.isPackaged) return { checked: false, reason: 'dev-mode' };
  autoUpdater.checkForUpdates().catch(err => sendUpdateStatus({ status: 'error', error: err?.message || String(err) }));
  return { checked: true };
});
// isSilent=true, isForceRunAfter=true: install quietly and relaunch automatically,
// instead of popping the full install wizard back up for what should feel instant.
// Kept around as a manual "don't wait for idle, do it now" escape hatch.
ipcMain.handle('install-update-now', () => { autoUpdater.quitAndInstall(true, true); return true; });
ipcMain.handle('get-app-version', () => app.getVersion());

app.whenReady().then(() => {
  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  resolveYtDlpBin();
  resolveFfmpegBin();
  startHandoffWatcher();
  startLocalBridge();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  applyTraySetting();
  applyGlobalShortcutSetting();
  scheduleYtDlpUpdateCheck();
  startQueueScheduler();

  // Only real, packaged installs have update metadata to check against —
  // running via `npm start` would just log a harmless "dev-mode" error.
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => sendUpdateStatus({ status: 'error', error: err?.message || String(err) }));
    }, 3000);
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Cobre TODO caminho de saída (menu da bandeja, auto-update reiniciando,
// Alt+F4 com a bandeja desativada etc.) — sem isso, só o clique em "Sair" do
// menu da bandeja fecharia de verdade; qualquer outro app.quit() cairia no
// handler de 'close' da janela e ficaria preso escondendo em vez de sair.
// yt-dlp e ffmpeg rodam como processos separados e, no Windows, não morrem
// junto com o app. Sem isso, sair pela bandeja (ou o auto-update reiniciando)
// deixava um download escrevendo arquivo na pasta de destino enquanto o
// instalador trocava os arquivos do programa.
function killAllChildProcesses() {
  for (const [key, proc] of activeProcs) { killProc(proc); activeProcs.delete(key); }
}
app.on('before-quit', () => { appIsQuitting = true; killAllChildProcesses(); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInstanceMarker();
  if (queueScheduleTimer) { clearInterval(queueScheduleTimer); queueScheduleTimer = null; }
  if (bridgeServer) { try { bridgeServer.close(); } catch {} bridgeServer = null; }
});

// ── Login ─────────────────────────────────────────────────────────────────────
ipcMain.handle('check-login', () => !!getCookieAuth());

// Via preferida: login pela extensão do navegador. O app não faz nada aqui
// além de guiar o usuário — a extensão manda os cookies via protocolo
// customizado (ver ingestCookiesFromExtension) de forma assíncrona, sem
// relação direta com esta chamada.
ipcMain.handle('login-youtube', async () => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Conectar ao YouTube',
    message: 'Conecte pela extensão do navegador',
    detail: 'Faça login no YouTube/Google no seu navegador normalmente e procure o botão roxo "Conectar ao app", fixo no canto inferior direito de qualquer página do youtube.com. Clique nele.\n\nSe ainda não tiver a extensão instalada, veja o passo a passo em Configurações → Extensão do navegador.',
    buttons: ['Abrir o YouTube', 'Fechar'],
    defaultId: 0,
    cancelId: 1,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  }).then(({ response }) => { if (response === 0) shell.openExternal('https://www.youtube.com'); });
  return null; // conexão real chega depois, de forma assíncrona, via evento 'login-cookies-received'
});

// Zera tanto os cookies recebidos da extensão quanto a configuração legada
// de navegador, pra voltar o badge pra "Desconectado".
ipcMain.handle('logout-youtube', () => {
  try { fs.unlinkSync(cookiesFilePath()); } catch {}
  const s = loadSettings();
  delete s.cookieBrowser;
  saveSettings(s);
  return true;
});

// Via legada (fallback): lê os cookies direto do perfil de um navegador
// instalado. Mantida pro caso do usuário não usar a extensão — mas sujeita
// ao App-Bound Encryption do Chrome 127+ e a falsos-positivos de antivírus,
// por isso não é mais a opção padrão.
ipcMain.handle('login-youtube-browser', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Conectar via navegador instalado',
    message: 'Selecione o navegador onde você está logado no YouTube:',
    detail: 'O app vai ler os cookies do navegador instalado no seu PC.\nVocê precisa estar logado no YouTube neste navegador.\nEsse método pode ser bloqueado pelo Chrome (127+) ou por antivírus — prefira o botão "Conectar" sempre que possível.',
    buttons: ['Chrome', 'Edge', 'Firefox', 'Brave', 'Opera GX', 'Cancelar'],
    defaultId: 2,
    cancelId: 5,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  });
  if (response === 5) return false;
  const browser = ['chrome', 'edge', 'firefox', 'brave', 'opera'][response];
  const s = loadSettings();
  s.cookieBrowser = browser;
  saveSettings(s);
  return true;
});

// Force-closes the browser whose cookie database is locking a download, so the
// user doesn't have to hunt for the process themselves.
ipcMain.handle('kill-browser-process', (_, browserKey) => killBrowserProcess(browserKey));

// Abre a tela de Segurança do Windows (proteção contra vírus e ameaças), pra
// o usuário conferir o histórico de proteção quando suspeitarmos que o
// Defender bloqueou o yt-dlp/ffmpeg.
ipcMain.handle('open-windows-security', async () => {
  try { await shell.openExternal('windowsdefender://'); return true; }
  catch {
    try { await shell.openExternal('ms-settings:windowsdefender'); return true; }
    catch { return false; }
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => {
  // Mescla com o que já está em disco em vez de substituir: campos que o
  // próprio main escreve sozinho (lastSeenVersion, extensionLastSeen,
  // cookieBrowser) não podem sumir só porque a tela de Configurações salvou.
  saveSettings({ ...loadSettings(), ...(s || {}) });
  applyTraySetting();
  applyGlobalShortcutSetting();
  return true;
});
ipcMain.handle('choose-folder', async () => {
  // Abre na última pasta usada (ou na Pasta Padrão), igual os outros diálogos
  // do app — antes esse aqui abria em lugar nenhum e obrigava a navegar tudo
  // de novo a cada fila iniciada.
  const s = loadSettings();
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: s.lastFolder || s.defaultFolder || undefined,
  });
  if (canceled || !filePaths[0]) return null;
  const cur = loadSettings(); cur.lastFolder = filePaths[0]; saveSettings(cur);
  return filePaths[0];
});

// ── History ───────────────────────────────────────────────────────────────────
ipcMain.handle('get-history', () => loadHistory());
ipcMain.handle('clear-history', () => { saveHistory([]); return true; });

// Chamado pelo renderer bem antes de disparar um download único (não entra no
// fluxo automático da fila/playlist, pra não travar um lote inteiro esperando
// clique num diálogo por cada item repetido). Se achar um download de sucesso
// pro mesmo link, pergunta antes de seguir.
ipcMain.handle('check-duplicate-download', async (_, url) => {
  const match = findDuplicateDownload(url);
  if (!match) return { duplicate: false, proceed: true };
  const dateStr = match.date ? new Date(match.date).toLocaleString('pt-BR') : '';
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Vídeo já baixado antes',
    message: `Você já baixou "${match.title || url}" com sucesso.`,
    detail: `${dateStr ? `Em ${dateStr}, ` : ''}salvo em:\n${match.folder || '(pasta não registrada)'}\n\nQuer baixar de novo mesmo assim?`,
    buttons: ['Baixar de novo', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  });
  return { duplicate: true, proceed: response === 0, match: { title: match.title, date: match.date, folder: match.folder } };
});

// ── Utils ─────────────────────────────────────────────────────────────────────
ipcMain.handle('open-folder', (_, folder) => shell.openPath(folder));

// The /extension folder ships as an extraResource (see package.json ->
// build.extraResources) instead of inside app.asar, since it needs to be a
// real folder on disk for Chrome/Edge's "Carregar sem compactação" to point
// at — asar is a virtual archive, not something the browser can read.
function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, 'extension');
}
ipcMain.handle('open-extension-folder', () => shell.openPath(extensionDir()));

// /extension-firefox is a separate build of the same extension, adapted to
// the browser.* (Promise-based) API instead of chrome.* — see its README.md
// for why it's a separate folder instead of one manifest for both browsers
// (Firefox's Manifest V3 background page needs "scripts" instead of
// "service_worker", plus a browser_specific_settings.gecko block). Same
// extraResource treatment as /extension, for the same reason (Firefox's
// "Carregar extensão temporária..." needs a real folder on disk, not
// something inside app.asar).
function extensionFirefoxDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension-firefox')
    : path.join(__dirname, 'extension-firefox');
}
ipcMain.handle('open-extension-firefox-folder', () => shell.openPath(extensionFirefoxDir()));
// Renderer polls this to detect newly-copied supported links (clipboard has
// no native "changed" event in Electron) — read-only, nothing is logged or
// sent anywhere; the comparison against the last-seen value happens locally
// in renderer.js and the user can turn it off in Configurações.
ipcMain.handle('read-clipboard-text', () => { try { return clipboard.readText(); } catch { return ''; } });
// Progresso na barra de tarefas (ícone do Windows). Só visual; ignora erro se a janela já fechou.
ipcMain.handle('set-taskbar-progress', (_e, v) => {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(typeof v === 'number' && v >= 0 ? Math.min(v, 1) : -1); } catch {}
});
ipcMain.handle('cancel-download', (_, id) => {
  if (id) {
    canceledDownloadIds.add(id);
    canceledPlaylistIds.add(id);
  }
  const p = activeProcs.get(id);
  if (p) { killProc(p); activeProcs.delete(id); }
  const subKeys = [...activeProcs.keys()].filter(k => k.startsWith(`${id}_`));
  for (const key of subKeys) { killProc(activeProcs.get(key)); activeProcs.delete(key); }
  return true;
});

// ── Update yt-dlp ─────────────────────────────────────────────────────────────
// Antes isso era `yt-dlp -U`, que atualiza reescrevendo o próprio .exe dentro
// da pasta de instalação — o Windows nega essa escrita pra um app comum, então
// a atualização só dava certo com o app aberto como administrador (e falhava,
// sempre, fora disso). Agora o app baixa a release oficial do GitHub pra
// %APPDATA%\<app>\bin e passa a usar essa cópia: pasta do próprio usuário,
// nenhuma permissão especial envolvida.

// GET com redirecionamento — o link de download "latest" do GitHub sempre
// redireciona pro CDN de objetos, então seguir é obrigatório aqui.
function httpsGetFollow(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) { reject(new Error('redirecionamentos demais')); return; }
    const req = https.get(url, { headers: { 'User-Agent': 'gameshmm-downloader' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        httpsGetFollow(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`o servidor respondeu ${res.statusCode}`)); return; }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('tempo esgotado ao falar com o GitHub')));
  });
}

async function installLatestYtDlp(onLog) {
  const dir = managedYtDlpDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = managedYtDlpPath();
  // Mantém a extensão .exe no arquivo temporário: no Windows o binário
  // recém-baixado é executado (--version) antes de virar o oficial.
  const tmp  = path.join(dir, `tmp-${YTDLP_ASSET}`);
  const url  = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`;

  onLog(`Baixando a última versão do yt-dlp (${YTDLP_ASSET})...\n`);
  const res   = await httpsGetFollow(url);
  const total = Number(res.headers['content-length'] || 0);

  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      let got = 0, lastShown = -1;
      const fail = (err) => { out.destroy(); res.destroy(); reject(err); };
      res.on('data', chunk => {
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (total && pct >= lastShown + 10) { lastShown = pct - (pct % 10); onLog(`  ${lastShown}%\n`); }
      });
      res.on('error', fail);
      out.on('error', fail);
      out.on('finish', resolve);
      res.pipe(out);
    });
  } catch (e) {
    // Não deixa um .exe pela metade na pasta (nem o descritor aberto) quando o
    // download é interrompido no meio ou o disco enche.
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch {} }

  // Confere que o arquivo baixado realmente roda antes de promover a oficial —
  // um download truncado ou bloqueado por antivírus não pode virar o binário
  // em uso do app.
  onLog('Conferindo o arquivo baixado...\n');
  const version = await new Promise((resolve, reject) => {
    const proc = spawn(tmp, ['--version'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => reject(new Error('o arquivo baixado não executou (antivírus pode ter bloqueado)')));
    proc.on('close', code => (code === 0 && out.trim())
      ? resolve(out.trim())
      : reject(new Error('o arquivo baixado não executou corretamente')));
  });

  // No Windows não dá pra sobrescrever um .exe que ainda esteja em uso, então
  // o antigo sai de cena renomeado e é removido na próxima abertura do app.
  try { if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}.old`); } catch {}
  fs.renameSync(tmp, dest);
  try { fs.unlinkSync(`${dest}.old`); } catch {}

  resolveYtDlpBin();
  onLog(`\nPronto — yt-dlp ${version} instalado.\n`);
  return version;
}

ipcMain.handle('update-ytdlp', async (event) => {
  const log = txt => { try { event.sender.send('update-log', txt); } catch {} };
  try {
    const version = await installLatestYtDlp(log);
    return { success: true, version };
  } catch (e) {
    log(`\nNão deu certo: ${e.message}\n`);
    return { success: false, error: e.message };
  }
});

// ── Checagem automática de yt-dlp desatualizado ────────────────────────────────
// O botão "Verificar Atualização" acima já resolve o problema quando o usuário
// lembra de clicar, mas boa parte dos erros esquisitos do YouTube (403, "Sign
// in to confirm...", formatos sumindo) é só o yt-dlp atrasado em relação a uma
// mudança recente do YouTube. Isso roda sozinho em segundo plano — só *avisa*
// (não atualiza sem perguntar) comparando a versão instalada com a última
// release pública do yt-dlp no GitHub.
function getInstalledYtDlpVersion() {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpBin, ['--version'], { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(err || `yt-dlp --version saiu com código ${code}`));
    });
  });
}

function fetchLatestYtDlpVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'gameshmm-downloader' },
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub respondeu ${res.statusCode}`)); return; }
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.tag_name) throw new Error('resposta sem tag_name');
          resolve(json.tag_name.trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout consultando o GitHub')));
  });
}

// Versão do yt-dlp segue o formato AAAA.MM.DD (às vezes com um ".N" de patch
// no fim) — comparação de string funciona pra essa data zero-padded, mas
// comparar campo a campo evita depender de sempre ter o mesmo número de
// dígitos em cada parte.
function isYtDlpVersionNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkYtDlpUpdate() {
  try {
    const [current, latest] = await Promise.all([getInstalledYtDlpVersion(), fetchLatestYtDlpVersion()]);
    return { success: true, current, latest, outdated: isYtDlpVersionNewer(latest, current) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
ipcMain.handle('check-ytdlp-version', () => checkYtDlpUpdate());

// ── Modo administrador ────────────────────────────────────────────────────────
// Rodar como administrador não traz vantagem nenhuma pro app e atrapalha a
// extensão (ver handoff lá em cima) — vale avisar o usuário e oferecer um
// caminho de volta.
let cachedElevated = null;
function isElevated() {
  if (cachedElevated !== null) return cachedElevated;
  if (process.platform !== 'win32') { cachedElevated = false; return false; }
  try {
    // `fltmc` é um utilitário padrão do Windows que só executa elevado —
    // barato e confiável como teste, sem depender de nenhuma dependência nova.
    const r = require('child_process').spawnSync('fltmc', ['filters'], { windowsHide: true });
    cachedElevated = r.status === 0;
  } catch { cachedElevated = false; }
  return cachedElevated;
}

// Tudo que o card "Status do sistema" (aba Config) mostra numa chamada só.
ipcMain.handle('get-runtime-info', async () => {
  const settings = loadSettings();
  resolveFfmpegBin();
  const diskTarget = settings.defaultFolder || settings.lastFolder || app.getPath('downloads') || app.getPath('userData');
  const diskInfo = getDiskFreeBytes(diskTarget);
  const info = {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    elevated: isElevated(),
    userDataPath: app.getPath('userData'),
    ytdlpPath: ytDlpBin,
    ytdlpManaged: ytDlpIsManaged,
    ytdlpOk: fs.existsSync(ytDlpBin),
    ffmpegOk: isFfmpegOk(),
    ffmpegPath: ffmpegBin,
    ffmpegSource: ffmpegSource,
    ffmpegVersion: null,
    cookiesConnected: !!getCookieAuth(),
    cookiesUpdatedAt: null,
    extensionLastSeen: settings.extensionLastSeen || null,
    bridgePort,
    diskFreeBytes: diskInfo.freeBytes,
    diskPath: diskInfo.checkedPath,
    ytdlpVersion: null,
  };
  try { info.cookiesUpdatedAt = fs.statSync(cookiesFilePath()).mtime.toISOString(); } catch {}
  try { info.ytdlpVersion = await getInstalledYtDlpVersion(); } catch {}
  try { info.ffmpegVersion = await getInstalledFfmpegVersion(); } catch {}
  return info;
});

ipcMain.handle('check-disk-space', (_, { targetPath, estimatedBytes } = {}) => {
  const { freeBytes, checkedPath } = getDiskFreeBytes(targetPath || app.getPath('downloads'));
  return { freeBytes, checkedPath, ...evaluateDiskSpace(freeBytes, estimatedBytes || 0) };
});

ipcMain.handle('write-clipboard-text', (_, text) => {
  try { clipboard.writeText(String(text || '')); return true; }
  catch { return false; }
});

ipcMain.handle('execute-power-action', async (_, action) => {
  if (action === 'shutdown') {
    if (process.platform === 'win32') {
      require('child_process').exec('shutdown /s /t 60 /c "gameshmm downloader: Fila concluida. Desligando o computador em 60 segundos (digite shutdown /a no Prompt de Comando para cancelar)."', () => {});
      return { success: true, message: 'Desligamento agendado em 60s' };
    }
  } else if (action === 'sleep') {
    if (process.platform === 'win32') {
      require('child_process').execFile(
        'powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null'],
        { windowsHide: true },
        () => {}
      );
      return { success: true, message: 'Computador suspenso' };
    }
  }
  return { success: false };
});

// Reabre o app sem privilégio de administrador. O truque é pedir pro
// explorer.exe abrir — ele roda no nível normal do usuário, e o processo que
// ele lança herda esse nível (não existe um "descer de elevação" direto).
ipcMain.handle('relaunch-unelevated', () => {
  if (process.platform !== 'win32') return { success: false, error: 'Disponível só no Windows.' };
  if (!app.isPackaged) return { success: false, error: 'Disponível só no app instalado.' };
  try {
    require('child_process')
      .spawn('explorer.exe', [process.execPath], { detached: true, stdio: 'ignore', windowsHide: true })
      .unref();
    appIsQuitting = true;
    setTimeout(() => app.quit(), 500);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── Fila salva em disco ───────────────────────────────────────────────────────
// Antes a fila vivia só na memória do renderer: fechar o app (ou minimizar pra
// bandeja e reabrir depois de um restart) perdia tudo que estava esperando.
const queueFilePath = () => path.join(app.getPath('userData'), 'queue.json');
ipcMain.handle('get-queue', () => {
  try {
    const items = JSON.parse(fs.readFileSync(queueFilePath(), 'utf8'));
    return Array.isArray(items) ? items : [];
  } catch { return []; }
});
ipcMain.handle('save-queue', (_, items) => {
  try { fs.writeFileSync(queueFilePath(), JSON.stringify(Array.isArray(items) ? items : [])); return true; }
  catch { return false; }
});

// ── Agendamento da fila ("Baixar mais tarde") ────────────────────────────────
let queueScheduleTimer = null;
const SCHEDULE_GRACE_MS = 15 * 60 * 1000;

function checkQueueSchedule() {
  const s = loadSettings();
  const sched = s.queueSchedule;
  if (!sched || !sched.targetAt) return;
  const lateMs = Date.now() - Number(sched.targetAt);
  if (lateMs < 0) return;

  delete s.queueSchedule;
  saveSettings(s);

  if (lateMs <= SCHEDULE_GRACE_MS) {
    const payload = { folder: sched.folder, time: sched.time };
    showMainWindow();
    if (isMainWindowReady()) {
      mainWindow.webContents.send('trigger-scheduled-queue', payload);
    } else {
      pendingScheduledTrigger = payload;
    }
  } else {
    const payload = { time: sched.time };
    if (isMainWindowReady()) {
      mainWindow.webContents.send('queue-schedule-expired', payload);
    } else {
      pendingScheduleExpired = payload;
    }
  }
}

function startQueueScheduler() {
  checkQueueSchedule();
  if (queueScheduleTimer) clearInterval(queueScheduleTimer);
  queueScheduleTimer = setInterval(checkQueueSchedule, 10000);
}

ipcMain.handle('get-queue-schedule', () => {
  checkQueueSchedule();
  return loadSettings().queueSchedule || null;
});

ipcMain.handle('set-queue-schedule', async (_, payload) => {
  if (!payload || !payload.time) {
    const s = loadSettings();
    delete s.queueSchedule;
    saveSettings(s);
    return { ok: true, schedule: null };
  }
  const computed = computeNextScheduleTimestamp(payload.time);
  if (!computed) return { ok: false, error: 'Horário inválido — escolha um horário no formato HH:MM.' };

  let folder = payload.folder;
  if (!folder) {
    const settings = loadSettings();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Pasta de destino para a fila agendada',
      properties: ['openDirectory'],
      defaultPath: settings.lastFolder || settings.defaultFolder || undefined,
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    folder = filePaths[0];
  }

  const schedule = { ...computed, folder };
  const cur = loadSettings();
  cur.lastFolder = folder;
  cur.queueSchedule = schedule;
  saveSettings(cur);
  return { ok: true, schedule };
});

// Checa uma vez pouco depois de abrir (pra não competir com o carregamento da
// janela) e depois a cada 24h enquanto o app ficar aberto (ex: rodando na
// bandeja). Se der erro (sem internet, GitHub fora do ar, etc.) fica quieto —
// não é crítico o bastante pra incomodar o usuário com isso toda hora.
function scheduleYtDlpUpdateCheck() {
  const run = async () => {
    const status = await checkYtDlpUpdate();
    if (status.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ytdlp-update-status', status);
    }
  };
  setTimeout(run, 8000);
  setInterval(run, 24 * 60 * 60 * 1000);
}

// isSafeMediaUrl vem de ./lib/media-utils.js
const BAD_URL = { success: false, error: 'Endereço inválido — cole um link começando com http:// ou https://.' };

// ── Get Formats ───────────────────────────────────────────────────────────────
ipcMain.handle('get-formats', async (_, { url }) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  try {
    // Mesmo fallback do get-video-info: sem isso, "ver formatos" falhava em
    // vídeo com restrição de idade mesmo com a conta já conectada.
    const opts = withNodeJsRuntimeOpt({ dumpJson: true, noWarnings: true, noPlaylist: true });
    let info;
    try {
      info = await youtubedl(url, opts);
    } catch (err) {
      const msg = err.message || '';
      if (!NEEDS_LOGIN_RE.test(msg) || !applyCookieOpts(opts)) throw err;
      info = await youtubedl(url, opts);
    }
    function vcodecFamily(vcodec) {
      if (!vcodec || vcodec === 'none') return '';
      if (/^(avc1|h264)/i.test(vcodec)) return 'H.264';
      if (/^(vp9|vp09)/i.test(vcodec)) return 'VP9';
      if (/^(av01|av1)/i.test(vcodec)) return 'AV1';
      if (/^(hevc|h265|hev1)/i.test(vcodec)) return 'H.265';
      return vcodec.split('.')[0] || '';
    }
    const seen = new Set();
    const formats = (info.formats || [])
      .filter(f => f.vcodec !== 'none' && f.height)
      .sort((a, b) => ((b.height || 0) - (a.height || 0)) || ((b.fps || 0) - (a.fps || 0)) || ((b.tbr || 0) - (a.tbr || 0)))
      .filter(f => {
        const key = `${f.height}_${vcodecFamily(f.vcodec)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(f => ({
        id: f.format_id,
        ext: f.ext,
        height: f.height,
        fps: f.fps,
        vcodec: vcodecFamily(f.vcodec),
        hasAudio: !!(f.acodec && f.acodec !== 'none'),
        note: f.format_note,
        size: f.filesize || f.filesize_approx || null
      }));
    // Tamanho do melhor áudio (m4a de preferência): entra na estimativa do arquivo final.
    const audios = (info.formats || []).filter(f => f.acodec && f.acodec !== 'none' && f.vcodec === 'none' && (f.filesize || f.filesize_approx));
    const bestAudio = audios.filter(f => f.ext === 'm4a').sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || audios.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    const tracksAndSubs = extractAudioTracksAndSubs(info);
    return {
      success: true,
      formats,
      audioSize: bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx) : null,
      ...tracksAndSubs,
    };
  } catch (e) { return { success: false, ...buildError(e.message) }; }
});

// ── Get Video Info ────────────────────────────────────────────────────────────
ipcMain.handle('get-video-info', async (_, data) => {
  try {
    const url = typeof data === 'string' ? data : data.url;
    if (!isSafeMediaUrl(url)) return BAD_URL;
    const opts = withNodeJsRuntimeOpt({ dumpJson: true, noWarnings: true, noPlaylist: true });
    try {
      const info = await youtubedl(url, opts);
      return { success: true, title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader || info.channel || '', viewCount: info.view_count ?? null, usedCookies: false };
    } catch (err) {
      const msg = err.message || '';
      if (NEEDS_LOGIN_RE.test(msg)) {
        if (!applyCookieOpts(opts)) return { success: false, error: 'Conteúdo requer login. Clique em "Conectar".' };
        const info = await youtubedl(url, opts);
        return { success: true, title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader || info.channel || '', viewCount: info.view_count ?? null, usedCookies: true };
      }
      throw err;
    }
  } catch (e) { return { success: false, ...buildError(e.message) }; }
});

// ── Get Playlist Info ─────────────────────────────────────────────────────────
ipcMain.handle('get-playlist-info', async (_, data) => {
  try {
    const url = typeof data === 'string' ? data : data.url;
    if (!isSafeMediaUrl(url)) return BAD_URL;
    const opts = withNodeJsRuntimeOpt({ dumpSingleJson: true, noWarnings: true, flatPlaylist: true, yesPlaylist: true });
    // Cada item vem com o essencial pra mostrar uma lista marcável na UI
    // (índice original na playlist, título, duração se o extractor mandar) —
    // nada pesado, o modo flat-playlist não baixa dados extras por vídeo.
    const toItems = (entries) => entries.map((e, i) => ({
      index: i + 1,
      title: e.title || e.id || `Vídeo ${i + 1}`,
      duration: typeof e.duration === 'number' ? e.duration : null,
    }));
    try {
      const info = await youtubedl(url, opts);
      const entries = Array.isArray(info.entries) ? info.entries : [];
      return { success: true, title: info.title, count: entries.length, usedCookies: false, items: toItems(entries) };
    } catch (err) {
      const msg = err.message || '';
      if (NEEDS_LOGIN_RE.test(msg)) {
        if (!applyCookieOpts(opts)) return { success: false, error: 'Playlist requer login. Clique em "Conectar".' };
        const info = await youtubedl(url, opts);
        const entries = Array.isArray(info.entries) ? info.entries : [];
        return { success: true, title: info.title, count: entries.length, usedCookies: true, items: toItems(entries) };
      }
      throw err;
    }
  } catch (e) { return { success: false, ...buildError(e.message) }; }
});

ipcMain.handle('expand-queue-items', async (_, { url } = {}) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  try {
    const sp = parseSpotifyUrl(url);
    if (sp && (sp.type === 'album' || sp.type === 'playlist')) {
      const data = await getSpotifyTracks(url);
      const items = (data.tracks || [])
        .filter(t => t && t.id)
        .map(t => ({
          url: `https://open.spotify.com/track/${t.id}`,
          title: t.artists ? `${t.artists} - ${t.title}` : t.title,
          isSpotify: true,
        }))
        .filter(it => isSafeMediaUrl(it.url));
      if (!items.length) return { success: false, error: 'Não foi possível obter links individuais dessas faixas do Spotify.' };
      return { success: true, sourceTitle: data.name || '', items };
    }
    const opts = withNodeJsRuntimeOpt({ dumpSingleJson: true, noWarnings: true, flatPlaylist: true, yesPlaylist: true });
    let info;
    try {
      info = await youtubedl(url, opts);
    } catch (err) {
      const msg = err.message || '';
      if (!NEEDS_LOGIN_RE.test(msg) || !applyCookieOpts(opts)) throw err;
      info = await youtubedl(url, opts);
    }
    const entries = (info.entries || []).filter(e => e && (e.id || e.url || e.webpage_url));
    const items = entries
      .map((e, i) => ({
        url: e.webpage_url || (e.url && /^https?:\/\//i.test(e.url) ? e.url : (e.id ? `https://www.youtube.com/watch?v=${e.id}` : '')),
        title: e.title || e.id || `Vídeo ${i + 1}`,
        isSpotify: false,
      }))
      .filter(it => isSafeMediaUrl(it.url));
    if (!items.length) return { success: false, error: 'Nenhum item encontrado para expandir.' };
    return { success: true, sourceTitle: info.title || '', items };
  } catch (e) {
    return { success: false, ...buildError(e.message) };
  }
});

// ── Download Video ────────────────────────────────────────────────────────────
ipcMain.handle('download-video', async (event, { url, format, quality, useCookies, savePath: provided, downloadId, formatId, formatHasAudio, title, accelerate, container, audioBitrate, videoCodec, audioLang, estimatedBytes, silentGlobalProgress }) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  try {
    let savePath = provided;
    if (!savePath) {
      const settings = loadSettings();
      const def = settings.lastFolder || settings.defaultFolder || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Pasta de destino', defaultPath: def, properties: ['openDirectory'] });
      if (canceled || !filePaths[0]) return { success: false, canceled: true, error: 'Download cancelado.' };
      savePath = filePaths[0];
      const s = loadSettings(); s.lastFolder = savePath; saveSettings(s);
    }

    const diskCheck = await confirmDiskSpaceIfLow(savePath, estimatedBytes || 0, !silentGlobalProgress);
    if (!diskCheck.proceed) {
      return {
        success: false,
        canceled: !!diskCheck.canceledByUser,
        error: diskCheck.error || 'Espaço em disco insuficiente.',
        diskSpaceInsufficient: true,
      };
    }

    const ffmpegPath = ffmpegBin;

    // Monta os argumentos do yt-dlp para uma tentativa. `fmtOverride` só é
    // usado na segunda tentativa (fallback de 403 — ver mais abaixo), pra
    // trocar o filtro de formato sem duplicar toda a lógica de
    // --output/--merge-output-format/cookies/aceleração.
    const dlSettings = loadSettings();
    const outTemplate = outputTemplate();
    // Contêiner do vídeo: mp4 (padrão, toca em qualquer lugar) ou mkv (sem limite de codec:
    // deixa o yt-dlp pegar VP9/AV1 na resolução máxima).
    const outContainer = container === 'mkv' ? 'mkv' : 'mp4';
    const effectiveCodec = (videoCodec && videoCodec !== 'auto')
      ? videoCodec
      : (dlSettings.defaultVideoCodec && dlSettings.defaultVideoCodec !== 'auto' ? dlSettings.defaultVideoCodec : 'auto');
    const cleanAudioLang = sanitizeLangCode(audioLang || '');
    const audioPref = buildAudioSelector({ outContainer, audioLang: cleanAudioLang });

    const buildArgs = (fmtOverride, forceCookies) => {
      // "--" fecha a lista de opções: tudo depois dele é tratado como endereço,
      // nunca como flag. Junto com a validação em extractProtocolAction, fecha
      // a porta pra uma URL maliciosa virar opção do yt-dlp.
      const args = ['--no-warnings', '--no-playlist', '--paths', savePath, '--ffmpeg-location', ffmpegPath, '--newline'];
      if (useCookies || forceCookies) pushCookieArgs(args);
      if (fmtOverride) {
        args.push('--format', fmtOverride, '--output', outTemplate, '--merge-output-format', outContainer);
        if (effectiveCodec !== 'auto') {
          args.push('-S', `vcodec:${effectiveCodec}`);
        }
        pushVideoExtraArgs(args, dlSettings);
      } else if (formatId) {
        const exactFmt = formatHasAudio === true ? formatId : `${formatId}+(${audioPref})/${formatId}+bestaudio/${formatId}`;
        args.push('--format', exactFmt, '--output', outTemplate, '--merge-output-format', outContainer);
        pushVideoExtraArgs(args, dlSettings);
      } else if (format === 'audio') {
        if (cleanAudioLang) {
          args.push('--format', buildAudioSelector({ outContainer: 'mkv', audioLang: cleanAudioLang }));
        }
        // --embed-thumbnail writes the video's own thumbnail as MP3 cover art
        // (via ffmpeg's ID3 APIC frame) and --embed-metadata sets title/artist
        // tags, so the file shows up properly in music players.
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', [128, 192, 256, 320].includes(Number(audioBitrate)) ? `${Number(audioBitrate)}K` : '0', '--embed-thumbnail', '--embed-metadata', '--output', outTemplate);
        pushSponsorBlockArgs(args, dlSettings);
      } else {
        const fmt = buildVideoFormatExpression({ quality, outContainer, effectiveCodec, audioLang: cleanAudioLang });
        if (effectiveCodec !== 'auto') {
          args.push('-S', `vcodec:${effectiveCodec}`);
        }
        args.push('--format', fmt, '--output', outTemplate, '--merge-output-format', outContainer);
        pushVideoExtraArgs(args, dlSettings);
      }
      if (accelerate !== false) args.push('--concurrent-fragments', '4');
      pushRateLimitArgs(args);
      pushFilenameSafetyArgs(args);
      args.push('--', url);
      return args;
    };

    if (!silentGlobalProgress) event.sender.send('download-progress', 'Iniciando download...');
    if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'start' });
    let videoTitle = title || url;

    // Roda uma tentativa de download e resolve com o resultado bruto (código
    // de saída + stderr acumulado), sem decidir ainda se foi sucesso — quem
    // chama decide se tenta de novo (ver fallback de 403 logo abaixo).
    const runAttempt = (args) => new Promise(resolve => {
      let settled = false;
      const settle = (payload) => {
        if (settled) return;
        settled = true;
        if (downloadId) activeProcs.delete(downloadId);
        resolve(payload);
      };
      const proc = spawnDownload(args, downloadId);
      let stderr = '';

      proc.stdout.on('data', d => {
        const line = d.toString();
        const pct   = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        const speed = line.match(/at\s+([\d.]+[KMG]iB\/s)/);
        const eta   = line.match(/ETA\s+([\d:]+)/);
        if (pct) {
          const speedStr = speed?.[1] ? ` · ${speed[1]}` : '';
          const etaStr   = eta?.[1]   ? ` · ETA ${eta[1]}` : '';
          const size     = line.match(/of\s+~?\s*([\d.]+[KMG]iB)/)?.[1] || '';
          const sizeStr  = size ? ` · de ${size}` : '';
          const payload  = { type: 'progress', percent: parseFloat(pct[1]), speed: speed?.[1] || '', eta: eta?.[1] || '', size };
          if (!silentGlobalProgress) event.sender.send('download-progress', `Baixando: ${pct[1]}%${speedStr}${etaStr}${sizeStr}`);
          if (downloadId) event.sender.send(`download-progress-${downloadId}`, payload);
        } else if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
          const convLabel = format === 'audio' ? 'Convertendo para MP3...' : 'Processando vídeo...';
          if (!silentGlobalProgress) event.sender.send('download-progress', convLabel);
          if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'converting', label: convLabel });
        } else if (line.includes('[Merger]')) {
          if (!silentGlobalProgress) event.sender.send('download-progress', 'Mesclando vídeo...');
          if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'merging', label: 'Mesclando vídeo...' });
        }
        const dest = line.match(/\[download\] Destination: .+[\\/](.+)\.\w+$/);
        if (dest && (!title || videoTitle === url)) videoTitle = dest[1].replace(/\.f\d+$/, '');
      });
      proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-12000); });
      proc.on('error', err => settle({ code: null, stderr, procError: err.message }));
      proc.on('close', code => settle({ code, stderr, procError: null }));
    });

    const isCanceled = () => !!(downloadId && canceledDownloadIds.has(downloadId));
    let result = await runAttempt(buildArgs());

    const got403 = () => result.code !== 0 && !result.procError && /HTTP Error 403/.test(result.stderr || '');
    const gotNeedsLogin = () => result.code !== 0 && !result.procError && NEEDS_LOGIN_RE.test(result.stderr || '');
    let usedFallback = false;
    let usedCookieRetry = false;
    if (!isCanceled() && (got403() || gotNeedsLogin()) && !formatId && format !== 'audio') {
      if (!useCookies && getCookieAuth()) {
        usedCookieRetry = true;
        if (!silentGlobalProgress) event.sender.send('download-progress', 'Conteúdo bloqueado — tentando com sua conta conectada...');
        if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'progress', percent: 0, speed: '', eta: '', label: 'Tentando de novo com login...' });
        result = await runAttempt(buildArgs(null, true));
      }
      const currentHeight = (quality === 'best' || !quality) ? Infinity : Number(quality);
      if (!isCanceled() && got403() && !(currentHeight <= 1080)) {
        usedFallback = true;
        if (!silentGlobalProgress) event.sender.send('download-progress', 'Qualidade máxima bloqueada (403) — tentando em 1080p...');
        if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'progress', percent: 0, speed: '', eta: '', label: 'Tentando em qualidade menor (1080p)...' });
        const fallbackFmt = buildVideoFormatExpression({ quality: '1080', outContainer, effectiveCodec: 'auto', audioLang: cleanAudioLang });
        result = await runAttempt(buildArgs(fallbackFmt, true));
      }
    }

    if (isCanceled()) {
      return { success: false, canceled: true, error: 'Download cancelado.' };
    }

    const ok = result.code === 0;
    if (!result.procError) {
      try {
        addToHistory({ title: videoTitle, url, format: formatId || format, quality, folder: savePath, date: new Date().toISOString(), status: ok ? 'success' : 'error' });
      } catch (e) { console.warn('[histórico] não registrei o download:', e.message); }
    }
    if (ok) {
      if (Notification.isSupported()) new Notification({ title: 'gameshmm downloader', body: `✅ ${videoTitle}` }).show();
      if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'done', folder: savePath });
      return { success: true, folder: savePath, usedFallbackQuality: usedFallback, usedCookieRetry };
    } else if (result.procError) {
      const procInfo = buildError(result.procError, { format, container: outContainer, videoCodec: effectiveCodec });
      if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'error', ...procInfo });
      return { success: false, ...procInfo };
    } else {
      const errInfo = result.stderr
        ? buildError(result.stderr, { format, container: outContainer, videoCodec: effectiveCodec })
        : { error: `Erro (código ${result.code})`, lockedBrowser: null, lockedBrowserLabel: null, technicalDetails: '', canCompatRetry: canOfferCompatRetry({ error: String(result.code), format, container: outContainer, videoCodec: effectiveCodec }) };
      if (usedFallback) errInfo.error = `${errInfo.error} (mesmo em 1080p e com login)`;
      else if (usedCookieRetry) errInfo.error = `${errInfo.error} (mesmo com login)`;
      if (downloadId) event.sender.send(`download-progress-${downloadId}`, { type: 'error', ...errInfo });
      return { success: false, ...errInfo };
    }
  } catch (e) { return { success: false, error: e.message }; }
  finally {
    if (downloadId) canceledDownloadIds.delete(downloadId);
  }
});

// ── Download Playlist ─────────────────────────────────────────────────────────
ipcMain.handle('download-playlist', async (event, { url, format, quality, useCookies, downloadId, concurrency = 3, selectedIndexes, accelerate, videoCodec, container, savePath: provided, silentGlobalProgress }) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  const isCanceled = () => !!(downloadId && canceledPlaylistIds.has(downloadId));
  try {
    let savePath = provided;
    if (!savePath) {
      const settings = loadSettings();
      const def = settings.lastFolder || settings.defaultFolder || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Pasta de destino', defaultPath: def, properties: ['openDirectory'] });
      if (canceled || !filePaths[0]) return { success: false, canceled: true, error: 'Download cancelado.' };
      savePath = filePaths[0];
      const s = loadSettings(); s.lastFolder = savePath; saveSettings(s);
    }

    const diskCheck = await confirmDiskSpaceIfLow(savePath, 0, !silentGlobalProgress);
    if (!diskCheck.proceed) {
      return { success: false, canceled: !!diskCheck.canceledByUser, error: diskCheck.error || 'Espaço em disco insuficiente.' };
    }

    if (downloadId) activeProcs.set(downloadId, { pid: null });
    const emitPlProgress = (payload) => {
      if (!silentGlobalProgress) event.sender.send('playlist-progress', payload);
      if (downloadId && silentGlobalProgress && payload) {
        if (payload.phase === 'downloading' && payload.total > 0) {
          const approx = Math.round(((payload.completed + (payload.percent || 0) / 100) / payload.total) * 100);
          event.sender.send(`download-progress-${downloadId}`, {
            type: 'progress',
            percent: Math.min(99, approx),
            speed: payload.speed || '',
            eta: `${payload.completed}/${payload.total}`,
          });
        } else if (payload.phase === 'converting') {
          event.sender.send(`download-progress-${downloadId}`, { type: 'converting', label: payload.label || 'Processando...' });
        } else if (payload.phase === 'merging') {
          event.sender.send(`download-progress-${downloadId}`, { type: 'merging', label: 'Mesclando...' });
        }
      }
    };

    emitPlProgress({ completed: 0, total: 0, title: 'Obtendo lista de vídeos...', percent: 0, phase: 'fetching' });
    const fetchOpts = withNodeJsRuntimeOpt({ dumpSingleJson: true, noWarnings: true, flatPlaylist: true, yesPlaylist: true, ignoreErrors: true });
    let cookieAuth = useCookies ? getCookieAuth() : null;
    if (useCookies) applyCookieOpts(fetchOpts);
    let entries;
    try {
      let info;
      try {
        info = await youtubedl(url, fetchOpts);
      } catch (err) {
        const msg = err.message || '';
        if (!useCookies && NEEDS_LOGIN_RE.test(msg) && applyCookieOpts(fetchOpts)) {
          cookieAuth = getCookieAuth();
          info = await youtubedl(url, fetchOpts);
        } else {
          throw err;
        }
      }
      entries = (info.entries || []).filter(e => e && (e.id || e.url));
    } catch (err) {
      if (isCanceled()) return { success: false, canceled: true, error: 'Download cancelado.' };
      return { success: false, ...buildError(err.message) };
    }
    if (isCanceled()) return { success: false, canceled: true, error: 'Download cancelado.' };

    // Guarda a posição original (1-based) antes de filtrar, pra manter o
    // número certo no prefixo do nome do arquivo mesmo quando só parte da
    // playlist foi selecionada (ex: pular o 3 e o 7 não deveria renumerar
    // os que sobraram pra 1,2,3...).
    entries = entries.map((e, i) => ({ ...e, __originalIndex: i + 1 }));
    if (Array.isArray(selectedIndexes) && selectedIndexes.length) {
      const wanted = new Set(selectedIndexes);
      entries = entries.filter(e => wanted.has(e.__originalIndex));
    }
    if (!entries.length) return { success: false, error: 'Nenhum vídeo encontrado na playlist.' };

    const total = entries.length;
    const ffmpegPath = ffmpegBin;

    const plSettings = loadSettings();
    const outContainer = container === 'mkv' ? 'mkv' : 'mp4';
    const effectiveCodec = (videoCodec && videoCodec !== 'auto')
      ? videoCodec
      : (plSettings.defaultVideoCodec && plSettings.defaultVideoCodec !== 'auto' ? plSettings.defaultVideoCodec : 'auto');
    const audioPref = outContainer === 'mp4' ? 'bestaudio[ext=m4a]/bestaudio' : 'bestaudio';
    // Mesmo template configurado pelo usuário, com o número da posição na
    // frente pra playlist continuar na ordem certa dentro da pasta.
    const plTemplate = String(outputTemplate());

    const getItemArgs = (item, fmtOverride) => {
      const prefix = String(item.index).padStart(2, '0') + ' - ' + plTemplate;
      if (format === 'audio' && !fmtOverride) {
        const a = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--embed-metadata', '--output', prefix];
        pushSponsorBlockArgs(a, plSettings);
        return a;
      }
      const capH = quality === 'best' || !quality ? '' : `[height<=${quality}]`;
      let fmt;
      const plSort = [];
      if (fmtOverride) {
        fmt = fmtOverride;
        if (effectiveCodec !== 'auto') plSort.push('-S', `vcodec:${effectiveCodec}`);
      } else if (effectiveCodec === 'h264') {
        fmt = `bestvideo[vcodec^=avc1]${capH}+${audioPref}/bestvideo[vcodec^=h264]${capH}+${audioPref}/bestvideo[ext=mp4]${capH}+bestaudio[ext=m4a]/bestvideo${capH}+${audioPref}/best[ext=mp4]${capH}/best${capH}/best`;
        plSort.push('-S', 'vcodec:h264');
      } else if (effectiveCodec === 'vp9') {
        fmt = `bestvideo[vcodec^=vp9]${capH}+${audioPref}/bestvideo[vcodec^=vp09]${capH}+${audioPref}/bestvideo${capH}+${audioPref}/best${capH}/best`;
        plSort.push('-S', 'vcodec:vp9');
      } else if (effectiveCodec === 'av1') {
        fmt = `bestvideo[vcodec^=av01]${capH}+${audioPref}/bestvideo${capH}+${audioPref}/best${capH}/best`;
        plSort.push('-S', 'vcodec:av1');
      } else {
        fmt = outContainer === 'mkv'
          ? `bestvideo${capH}+bestaudio/best${capH}/best`
          : `bestvideo[ext=mp4]${capH}+bestaudio[ext=m4a]/bestvideo${capH}+${audioPref}/best[ext=mp4]${capH}/best${capH}/best`;
      }
      const v = ['--format', fmt, ...plSort, '--output', prefix, '--merge-output-format', outContainer];
      pushVideoExtraArgs(v, plSettings);
      return v;
    };

    let completed = 0, errors = 0, lastProcError = null, lastStderr = '';
    const videoQueue = entries.map((e) => ({
      url: e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
      index: e.__originalIndex,
      title: e.title || e.id || `Vídeo ${e.__originalIndex}`
    }));

    emitPlProgress({
      completed: 0, total, title: `Iniciando ${Math.min(concurrency, total)} em paralelo...`, percent: 0, phase: 'start'
    });

    // Uma tentativa de um item da playlist. Resolve com { code, stderr } — quem
    // chama decide se tenta de novo. Antes isso era baseado em callbacks e o
    // par de handlers 'error' + 'close' (que o Node dispara os DOIS quando o
    // spawn falha) chamava processNext() duas vezes: o worker consumia dois
    // itens ao mesmo tempo, contava erro em dobro e, com o yt-dlp em
    // quarentena pelo antivírus, drenava a playlist inteira em silêncio.
    const runPlaylistAttempt = (item, itemId, fmtOverride, forceCookies) => new Promise(resolveAttempt => {
      const args = [
        '--no-warnings', '--no-playlist',
        '--paths', savePath, '--ffmpeg-location', ffmpegPath,
        '--newline',
        ...getItemArgs(item, fmtOverride)
      ];
      if (accelerate !== false) args.push('--concurrent-fragments', '4');
      pushRateLimitArgs(args);
      pushFilenameSafetyArgs(args);
      const auth = (cookieAuth || forceCookies) ? (cookieAuth || getCookieAuth()) : null;
      if (auth) args.push(...(auth.mode === 'file' ? ['--cookies', auth.path] : ['--cookies-from-browser', auth.browser]));
      args.push('--', item.url);

      let settled = false;
      let stderr = '';
      const settle = (payload) => { if (settled) return; settled = true; activeProcs.delete(itemId); resolveAttempt(payload); };

      const proc = spawnDownload(args, itemId);
      proc.stdout.on('data', d => {
        const line = d.toString();
        const pct   = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        const speed = line.match(/at\s+([\d.]+[KMG]iB\/s)/);
        const eta   = line.match(/ETA\s+([\d:]+)/);
        if (pct) {
          emitPlProgress({
            completed, total, title: item.title, percent: +pct[1],
            speed: speed?.[1] || '', eta: eta?.[1] || '',
            index: item.index, phase: 'downloading'
          });
        } else if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
          const convLabel = format === 'audio' ? 'Convertendo MP3...' : 'Processando vídeo...';
          emitPlProgress({ completed, total, title: item.title, percent: 95, speed: '', eta: '', index: item.index, phase: 'converting', label: convLabel });
        } else if (line.includes('[Merger]')) {
          emitPlProgress({ completed, total, title: item.title, percent: 97, speed: '', eta: '', index: item.index, phase: 'merging' });
        }
      });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => settle({ code: null, stderr, procError: err.message }));
      proc.on('close', code => settle({ code, stderr, procError: null }));
    });

    const runWorker = async () => {
      while (videoQueue.length && !isCanceled()) {
        const item = videoQueue.shift();
        const itemId = `${downloadId}_${item.index}`;

        emitPlProgress({
          completed, total, title: item.title, percent: 0, speed: '', eta: '', index: item.index, phase: 'downloading'
        });

        let result = await runPlaylistAttempt(item, itemId);
        if (isCanceled()) break;

        // Mesmo fallback de 403 que o download único já tinha: primeiro tenta
        // de novo com a conta conectada, depois cai pra 1080p. Antes a playlist
        // simplesmente marcava o item como "ignorado" na primeira negativa.
        const is403 = () => result.code !== 0 && !result.procError && /HTTP Error 403/.test(result.stderr || '');
        const needsLoginErr = () => result.code !== 0 && !result.procError && NEEDS_LOGIN_RE.test(result.stderr || '');
        if ((is403() || needsLoginErr()) && format !== 'audio' && !isCanceled()) {
          if (!cookieAuth && getCookieAuth()) {
            emitPlProgress({ completed, total, title: `${item.title} — tentando com seu login...`, percent: 0, index: item.index, phase: 'downloading' });
            result = await runPlaylistAttempt(item, itemId, null, true);
          }
          if (isCanceled()) break;
          const height = (quality === 'best' || !quality) ? Infinity : Number(quality);
          if (is403() && !(height <= 1080)) {
            emitPlProgress({ completed, total, title: `${item.title} — tentando em 1080p...`, percent: 0, index: item.index, phase: 'downloading' });
            const fallbackFmt = outContainer === 'mp4'
              ? 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio[ext=m4a]/best[height<=1080]/best'
              : 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
            result = await runPlaylistAttempt(item, itemId, fallbackFmt, true);
          }
        }
        if (isCanceled()) break;

        const ok = result.code === 0;
        if (ok) completed++; else errors++;
        if (!ok && result.procError) lastProcError = result.procError;
        if (!ok && result.stderr) lastStderr = result.stderr;
        emitPlProgress({
          completed, total, title: item.title, percent: 100, index: item.index,
          phase: ok ? 'done' : 'skipped'
        });
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, runWorker));

    if (isCanceled()) {
      return { success: false, canceled: true, error: 'Download cancelado.' };
    }

    const summary = errors > 0 ? `${completed} baixados · ${errors} ignorados` : `${completed} vídeos concluídos`;
    try {
      addToHistory({ title: `Playlist (${summary})`, url, format, quality, folder: savePath, date: new Date().toISOString(), status: completed > 0 ? 'success' : 'error' });
    } catch (e) { console.warn('[histórico] não registrei a playlist:', e.message); }

    if (completed > 0) {
      if (Notification.isSupported()) new Notification({ title: 'gameshmm downloader', body: `✅ Playlist — ${summary}` }).show();
      return { success: true, downloaded: completed, skipped: errors, folder: savePath };
    }
    // Se nem um item conseguiu nem começar, o motivo real é o erro de spawn —
    // vale explicar (antivírus, yt-dlp sumido) em vez de um "nenhum vídeo".
    if (lastProcError) return { success: false, ...buildError(lastProcError) };
    if (lastStderr) {
      const errInfo = buildError(lastStderr, { format, container: outContainer, videoCodec: effectiveCodec });
      return { success: false, ...errInfo };
    }
    return { success: false, error: 'Nenhum vídeo foi baixado com sucesso.' };
  } catch (e) { return { success: false, error: e.message }; }
  finally {
    if (downloadId) {
      activeProcs.delete(downloadId);
      canceledPlaylistIds.delete(downloadId);
    }
  }
});

// ── Converter ─────────────────────────────────────────────────────────────────
// AUDIO_ONLY_EXTENSIONS vem de ./lib/media-utils.js.

ipcMain.handle('choose-media-file', async (_e, droppedPath) => {
  let filePath;
  if (typeof droppedPath === 'string' && droppedPath) {
    // Arquivo arrastado pra dentro da janela: confere que existe e que é um arquivo (não pasta).
    try {
      if (!fs.statSync(droppedPath).isFile()) return { canceled: true, error: 'Solte um arquivo, não uma pasta.' };
    } catch { return { canceled: true, error: 'Não consegui ler esse arquivo.' }; }
    filePath = droppedPath;
  } else {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar arquivo',
      properties: ['openFile'],
      filters: [
        { name: 'Vídeo e Áudio', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    filePath = filePaths[0];
  }
  const info = await probeMediaInfo(filePath);
  const isAudioOnly = AUDIO_ONLY_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || !!(info && !info.video && info.audio);
  return { canceled: false, filePath, fileName: path.basename(filePath), isAudioOnly, info };
});

const AUDIO_CONVERT_MAP = {
  mp3:  { codec: 'libmp3lame', ext: 'mp3',  lossy: true },
  aac:  { codec: 'aac',        ext: 'm4a',  lossy: true },
  ogg:  { codec: 'libvorbis',  ext: 'ogg',  lossy: true },
  wav:  { codec: 'pcm_s16le',  ext: 'wav',  lossy: false },
  flac: { codec: 'flac',       ext: 'flac', lossy: false },
};
const VIDEO_CODEC_MAP = { copy: 'copy', h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9', av1: 'libaom-av1' };
const AUDIO_CODEC_MAP = { copy: 'copy', aac: 'aac', mp3: 'libmp3lame', opus: 'libopus' };
// CONTAINER_COMPAT vem de ./lib/media-utils.js.
// Maps our codec picker values to their hardware-encoder equivalent per GPU
// vendor. Used automatically whenever available — no user toggle. Tried in
// this order: Nvidia (NVENC) first — most consistently reliable in the
// ffmpeg-static build — then AMD (AMF), then Intel (QSV). If the chosen GPU
// encoder fails at runtime, convert-media below retries once on CPU.
const GPU_VENDOR_PRIORITY = ['nvenc', 'amf', 'qsv'];
const GPU_ENCODER_MAP = {
  h264: { nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
  h265: { nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
  av1:  { nvenc: 'av1_nvenc',  amf: 'av1_amf',  qsv: 'av1_qsv'  },
};
const ALL_GPU_ENCODERS = [...new Set(Object.values(GPU_ENCODER_MAP).flatMap(v => Object.values(v)))];

// Tries to encode one throwaway frame with the given encoder. If there's no
// compatible GPU/driver for it, ffmpeg fails fast with a non-zero exit code —
// that's the only reliable way to tell "compiled in" apart from "actually usable".
// The test frame is 256x256: AV1 hardware encoders (NVENC on Ada Lovelace,
// AMF, QSV) enforce a minimum encode resolution around 128x128 — a smaller
// probe frame made AV1 fail this check even on GPUs that support it fine.
function probeEncoder(encoderName) {
  return new Promise(resolve => {
    let done = false;
    let stderr = '';
    let timer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ok && stderr.trim()) console.log(`[gpu-probe] ${encoderName} indisponível: ${stderr.trim().split('\n').pop()}`);
      resolve(ok);
    };
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-frames:v', '1', '-c:v', encoderName, '-f', 'null', '-'];
    let proc;
    try { proc = spawn(ffmpegBin, args, { windowsHide: true }); }
    catch { finish(false); return; }
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('error', () => finish(false));
    proc.on('close', code => finish(code === 0));
    timer = setTimeout(() => { try { proc.kill(); } catch {} finish(false); }, 6000);
  });
}

let gpuProbeCache = null;
function detectGpuEncoders() {
  if (gpuProbeCache) return Promise.resolve(gpuProbeCache);
  return Promise.all(ALL_GPU_ENCODERS.map(name => probeEncoder(name).then(ok => [name, ok])))
    .then(pairs => {
      gpuProbeCache = Object.fromEntries(pairs);
      return gpuProbeCache;
    });
}
ipcMain.handle('detect-gpu-encoders', () => detectGpuEncoders());

// Given our codec picker value (h264/h265/av1) and the probe results, returns
// the best available hardware encoder name, or null if none work here.
function pickGpuEncoder(codecKey, probe) {
  const candidates = GPU_ENCODER_MAP[codecKey];
  if (!candidates || !probe) return null;
  for (const vendor of GPU_VENDOR_PRIORITY) {
    const name = candidates[vendor];
    if (name && probe[name]) return name;
  }
  return null;
}

// The "Qualidade" dropdown is a semantic level (alta/padrão/menor), not a raw
// CRF number — CRF/CQ scales mean very different things per codec. CRF 23 on
// H.264 is a normal, fairly compact encode; the *same number* on VP9 or AV1
// is a much higher-quality (much lower-compression) setting on those codecs'
// own scales, which was producing bigger AV1 files than the H.264 source.
// These tables give each codec family its own CRF/CQ numbers that land at
// roughly the same perceived quality for a given level.
const QUALITY_CRF = {
  h264: { high: 18, default: 23, low: 28 },
  h265: { high: 20, default: 24, low: 29 },
  vp9:  { high: 26, default: 32, low: 40 },
  av1:  { high: 24, default: 30, low: 38 },
};
function resolveCrf(family, quality) {
  const levels = QUALITY_CRF[family] || QUALITY_CRF.h264;
  if (quality === 'high' || quality === 'default' || quality === 'low') return levels[quality];
  // Numeric value (older format / defensive fallback) — use as-is.
  return quality ? Number(quality) : levels.default;
}

// Builds the -c:v/-c:a portion of the ffmpeg args for a given resolved encoder.
// codecKey is our picker value (h264/h265/vp9/av1) — used to resolve the
// right CRF/CQ scale for `vcodec`, which may be the CPU encoder or a GPU
// equivalent (h264_nvenc, av1_amf, etc.) of that same codec.
// When targetVideoBitrate (bits/sec) is given, we're in "target file size"
// mode: aim for that average bitrate instead of a fixed quality level, and
// use a known 128k audio bitrate (instead of 192k) so the size math upstream
// stays accurate.
function buildVideoCodecArgs(vcodec, acodec, quality, targetVideoBitrate, codecKey) {
  const args = ['-c:v', vcodec];
  if (vcodec !== 'copy') {
    const family = codecKey || (vcodec === 'libvpx-vp9' ? 'vp9' : vcodec === 'libaom-av1' || vcodec.startsWith('av1_') ? 'av1' : vcodec === 'libx265' || vcodec === 'hevc_nvenc' || vcodec === 'hevc_amf' || vcodec === 'hevc_qsv' ? 'h265' : 'h264');
    if (targetVideoBitrate) {
      const br = String(Math.round(targetVideoBitrate));
      const maxrate = String(Math.round(targetVideoBitrate * 1.45));
      if (vcodec === 'libaom-av1') args.push('-b:v', br, '-cpu-used', '4', '-row-mt', '1');
      else if (vcodec.endsWith('_nvenc')) args.push('-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', br, '-maxrate', maxrate);
      else if (vcodec.endsWith('_amf')) args.push('-rc', 'vbr', '-b:v', br);
      else if (vcodec.endsWith('_qsv')) args.push('-b:v', br);
      else args.push('-preset', 'medium', '-b:v', br, '-maxrate', maxrate, '-bufsize', String(Math.round(targetVideoBitrate * 2))); // libx264/libx265/libvpx-vp9
    } else {
      const q = String(resolveCrf(family, quality));
      if (vcodec === 'libvpx-vp9') args.push('-b:v', '0', '-crf', q);
      // libaom-av1 is very slow at its default speed; -cpu-used trades quality
      // for speed (0=slowest/best, 8=fastest) and row-mt parallelizes rows.
      else if (vcodec === 'libaom-av1') args.push('-b:v', '0', '-crf', q, '-cpu-used', '4', '-row-mt', '1');
      // NVENC (Nvidia): -cq is the closest equivalent to -crf; -rc vbr + -b:v 0
      // lets quality float instead of targeting a fixed bitrate.
      else if (vcodec.endsWith('_nvenc')) args.push('-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', q, '-b:v', '0');
      // AMF (AMD): constant-QP mode is the simplest broadly-compatible option.
      else if (vcodec.endsWith('_amf')) args.push('-rc', 'cqp', '-qp_i', q, '-qp_p', q);
      // QSV (Intel): global_quality behaves like a CRF/CQ value on most setups.
      else if (vcodec.endsWith('_qsv')) args.push('-global_quality', q);
      else args.push('-preset', 'medium', '-crf', q);
    }
  }
  args.push('-c:a', acodec);
  if (acodec !== 'copy') args.push('-b:a', targetVideoBitrate ? '128k' : '192k');
  return args;
}

// parseTimeToSeconds vem de ./lib/media-utils.js.

// Runs `ffmpeg -i <file>` with no output — it errors out (no output
// specified) but not before printing the input's metadata, including
// "Duration: HH:MM:SS.ms", to stderr. Cheaper than shipping ffprobe too.
function probeDuration(inputPath) {
  return new Promise(resolve => {
    let stderr = '';
    let done = false;
    let timer = null;
    const finish = (dur) => { if (done) return; done = true; clearTimeout(timer); resolve(dur); };
    let proc;
    try { proc = spawn(ffmpegBin, ['-hide_banner', '-i', inputPath], { windowsHide: true }); }
    catch { finish(null); return; }
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('error', () => finish(null));
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      finish(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null);
    });
    timer = setTimeout(() => { try { proc.kill(); } catch {} finish(null); }, 8000);
  });
}

// Same trick as probeDuration, but pulls out everything the Converter tab
// shows the user before converting: container format, duration, overall
// bitrate, video codec/resolution/fps/bitrate, audio codec/sample-rate/
// channels/bitrate, and file size. No ffprobe binary needed — `ffmpeg -i`
// prints all of this to stderr before failing (no output was requested).
function probeMediaInfo(inputPath) {
  return new Promise(resolve => {
    let stderr = '';
    let done = false;
    let timer = null;
    const finish = (info) => { if (done) return; done = true; clearTimeout(timer); resolve(info); };
    let proc;
    try { proc = spawn(ffmpegBin, ['-hide_banner', '-i', inputPath], { windowsHide: true }); }
    catch { finish(null); return; }
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('error', () => finish(null));
    proc.on('close', () => finish(parseMediaInfo(stderr, inputPath)));
    timer = setTimeout(() => { try { proc.kill(); } catch {} finish(null); }, 8000);
  });
}

function parseMediaInfo(stderr, inputPath) {
  try {
    const formatMatch = stderr.match(/Input #0,\s*([^,]+),/);
    const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    const overallBitrateMatch = stderr.match(/Duration:.*bitrate:\s*(\d+)\s*kb\/s/);
    const duration = durMatch ? (+durMatch[1]) * 3600 + (+durMatch[2]) * 60 + parseFloat(durMatch[3]) : null;

    let video = null, audio = null;
    for (const line of stderr.split('\n')) {
      if (!/Stream #/.test(line)) continue;
      // Cover art embedded in an audio file (MP3s with album art, which this
      // app itself embeds) shows up as a fake "Video" stream — skip it.
      if (/attached pic/.test(line)) continue;
      if (!video && /:\s*Video:/.test(line)) {
        const codecMatch = line.match(/Video:\s*([a-zA-Z0-9_]+)/);
        const resMatch = line.match(/\b(\d{2,5})x(\d{2,5})\b/);
        const fpsMatch = line.match(/([\d.]+)\s*fps/);
        const brMatch = line.match(/(\d+)\s*kb\/s/);
        video = {
          codec: codecMatch ? codecMatch[1] : null,
          width: resMatch ? +resMatch[1] : null,
          height: resMatch ? +resMatch[2] : null,
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : null,
          bitrate: brMatch ? +brMatch[1] : null,
        };
      } else if (!audio && /:\s*Audio:/.test(line)) {
        const codecMatch = line.match(/Audio:\s*([a-zA-Z0-9_]+)/);
        const rateMatch = line.match(/(\d+)\s*Hz/);
        const chMatch = line.match(/Hz,\s*([a-zA-Z0-9. ]+?),/);
        const brMatch = line.match(/(\d+)\s*kb\/s/);
        audio = {
          codec: codecMatch ? codecMatch[1] : null,
          sampleRate: rateMatch ? +rateMatch[1] : null,
          channels: chMatch ? chMatch[1].trim() : null,
          bitrate: brMatch ? +brMatch[1] : null,
        };
      }
    }

    let sizeBytes = null;
    try { sizeBytes = fs.statSync(inputPath).size; } catch {}

    if (!formatMatch && !video && !audio) return null;
    // ffmpeg's demuxer name is a comma-separated list of compatible formats
    // (e.g. "mov,mp4,m4a,3gp,3g2,mj2" for any MP4-family file) — not useful
    // to show as-is. The file's own extension is what the user recognizes.
    const ext = path.extname(inputPath).replace(/^\./, '').toUpperCase();
    return {
      format: ext || (formatMatch ? formatMatch[1].trim() : null),
      duration,
      overallBitrate: overallBitrateMatch ? +overallBitrateMatch[1] : null,
      sizeBytes,
      video,
      audio,
    };
  } catch {
    return null;
  }
}

// Runs one ffmpeg pass, streaming progress to the renderer. Resolves with the
// exit code and a tail of stderr (used for both progress % and error messages).
function runConvert(args, convertId, event, expectedDuration = null) {
  return new Promise(resolve => {
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      if (convertId) activeProcs.delete(convertId);
      resolve(payload);
    };
    const proc = spawn(ffmpegBin, args, { windowsHide: true });
    if (convertId) activeProcs.set(convertId, proc);
    let stderrTail = '';
    let duration = null;

    proc.stderr.on('data', d => {
      const line = d.toString();
      stderrTail = (stderrTail + line).slice(-4000);
      if (duration === null) {
        const dm = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (dm) duration = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]);
      }
      const tm = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (tm) {
        const cur = (+tm[1]) * 3600 + (+tm[2]) * 60 + parseFloat(tm[3]);
        const denom = expectedDuration || duration;
        const pct = denom ? Math.min(99, (cur / denom) * 100) : 0;
        event.sender.send('convert-progress', { type: 'progress', percent: pct });
      }
    });

    proc.on('error', err => settle({ code: -1, stderrTail: err.message }));
    proc.on('close', code => settle({ code, stderrTail }));
  });
}

// Cancel requests for a convert job land here (see preload.js) so we can tell
// a real GPU failure apart from "the user hit cancel" before deciding to retry.
const canceledConvertIds = new Set();
ipcMain.handle('cancel-convert', (_, id) => {
  const p = activeProcs.get(id);
  if (p) { killProc(p); activeProcs.delete(id); }
  if (id) canceledConvertIds.add(id);
  return true;
});

ipcMain.handle('convert-media', async (event, opts) => {
  const { inputPath, outputKind, container, videoCodec, audioCodec, audioFormat, quality, bitrate, trimStart, trimEnd, targetSizeMB, savePath: provided, convertId } = opts || {};
  try {
    if (!inputPath || !fs.existsSync(inputPath)) return { success: false, error: 'Arquivo de entrada não encontrado.' };
    if (outputKind === 'video' && AUDIO_ONLY_EXTENSIONS.has(path.extname(inputPath).toLowerCase())) {
      return { success: false, error: 'Esse arquivo é de áudio e não tem imagem — não é possível convertê-lo para vídeo. Escolha "Áudio" como saída.' };
    }
    const rawTrimStart = String(trimStart || '').trim();
    const rawTrimEnd   = String(trimEnd || '').trim();
    const startSec = rawTrimStart ? parseTimeToSeconds(rawTrimStart) : null;
    const endSec   = rawTrimEnd   ? parseTimeToSeconds(rawTrimEnd)   : null;
    if (rawTrimStart && startSec === null) {
      return { success: false, error: 'Tempo inicial de corte inválido (use HH:MM:SS, MM:SS ou segundos).' };
    }
    if (rawTrimEnd && endSec === null) {
      return { success: false, error: 'Tempo final de corte inválido (use HH:MM:SS, MM:SS ou segundos).' };
    }
    if (startSec != null && endSec != null && endSec <= startSec) {
      return { success: false, error: 'O tempo final do corte deve ser maior que o tempo inicial.' };
    }

    const outContainer = outputKind === 'audio' ? null : (container || 'mp4').toLowerCase();
    const compat = outContainer ? (CONTAINER_COMPAT[outContainer] || CONTAINER_COMPAT.mp4) : null;
    if (compat) {
      const vc = videoCodec || 'copy';
      const ac = audioCodec || 'copy';
      if (!compat.video.has(vc)) {
        return { success: false, error: `O contêiner ${outContainer.toUpperCase()} não suporta o codec de vídeo "${vc.toUpperCase()}".` };
      }
      if (!compat.audio.has(ac)) {
        return { success: false, error: `O contêiner ${outContainer.toUpperCase()} não suporta o codec de áudio "${ac.toUpperCase()}".` };
      }
    }
    if (targetSizeMB && outputKind === 'video' && videoCodec === 'copy') {
      return { success: false, error: 'Pra usar tamanho-alvo é preciso escolher um codec de vídeo real (H.264/H.265/VP9/AV1) — "Manter original" não recodifica, então não dá pra controlar o tamanho.' };
    }
    if (targetSizeMB && outputKind === 'audio' && ['wav', 'flac'].includes(audioFormat)) {
      return { success: false, error: 'WAV e FLAC são sem perdas e não usam bitrate ajustável — tamanho-alvo só funciona com MP3, AAC ou OGG.' };
    }

    let fullDuration = null;
    if (targetSizeMB || startSec != null || endSec != null) {
      fullDuration = await probeDuration(inputPath);
      if (targetSizeMB && !fullDuration) {
        return { success: false, error: 'Não consegui detectar a duração do arquivo pra calcular o tamanho-alvo.' };
      }
      if (fullDuration && startSec != null && startSec >= fullDuration) {
        return { success: false, error: 'O início do corte é maior ou igual à duração do arquivo.' };
      }
    }

    let savePath = provided;
    if (!savePath) {
      const settings = loadSettings();
      const def = settings.lastFolder || settings.defaultFolder || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Pasta de destino', defaultPath: def, properties: ['openDirectory'] });
      if (canceled || !filePaths[0]) return { success: false, canceled: true, error: 'Conversão cancelada.' };
      savePath = filePaths[0];
      const s = loadSettings(); s.lastFolder = savePath; saveSettings(s);
    }

    let estConvertBytes = 0;
    try {
      const srcSize = fs.statSync(inputPath).size;
      estConvertBytes = targetSizeMB ? Math.round(targetSizeMB * 1024 * 1024) : (outputKind === 'audio' ? Math.round(srcSize * 0.25) : srcSize);
    } catch {}
    const convDiskCheck = await confirmDiskSpaceIfLow(savePath, estConvertBytes, true);
    if (!convDiskCheck.proceed) {
      return { success: false, canceled: true, error: 'Conversão cancelada.' };
    }

    let outExt, cpuVcodec, gpuVcodec, acodec;
    if (outputKind === 'audio') {
      outExt = (AUDIO_CONVERT_MAP[audioFormat] || AUDIO_CONVERT_MAP.mp3).ext;
    } else {
      cpuVcodec = VIDEO_CODEC_MAP[videoCodec] || 'copy';
      acodec = AUDIO_CODEC_MAP[audioCodec] || 'copy';
      // Target-size mode needs a predictable audio bitrate to budget against —
      // "keep original" audio has an unknown size, so force a real codec.
      if (targetSizeMB && acodec === 'copy') {
        const defAudio = compat ? compat.defaultAudio : 'aac';
        acodec = AUDIO_CODEC_MAP[defAudio] || 'aac';
      }
      outExt = outContainer || 'mp4';
      // Silently prefer whichever GPU vendor is actually usable on this
      // machine (Nvidia NVENC, then AMD AMF, then Intel QSV) — no prompt, no
      // setting, just use it if a probe confirms it works.
      if (GPU_ENCODER_MAP[videoCodec]) {
        const gpu = await detectGpuEncoders();
        gpuVcodec = pickGpuEncoder(videoCodec, gpu);
      }
    }

    // Duração efetiva do trecho a gerar (para progresso % do corte e cálculo do tamanho-alvo).
    const effectiveStart = startSec || 0;
    const effectiveEnd = endSec != null
      ? (fullDuration ? Math.min(endSec, fullDuration) : endSec)
      : fullDuration;
    const clipDuration = effectiveEnd != null ? Math.max(0.1, effectiveEnd - effectiveStart) : null;

    let targetVideoBitrate = null;
    let targetAudioBitrate = null;
    if (targetSizeMB) {
      const effectiveDuration = Math.max(1, clipDuration || fullDuration);
      const targetBits = targetSizeMB * 8 * 1024 * 1024 * 0.98; // ~2% headroom for container overhead
      if (outputKind === 'audio') {
        targetAudioBitrate = Math.max(32000, Math.floor(targetBits / effectiveDuration));
      } else {
        const audioBudget = acodec !== 'copy' ? 128000 : 0;
        targetVideoBitrate = Math.max(100000, Math.floor(targetBits / effectiveDuration) - audioBudget);
      }
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    let outPath = path.join(savePath, `${baseName}-convertido.${outExt}`);
    let n = 1;
    while (fs.existsSync(outPath)) { outPath = path.join(savePath, `${baseName}-convertido-${n++}.${outExt}`); }

    const buildArgs = (vcodec) => {
      const args = ['-y'];
      if (startSec != null && startSec > 0) args.push('-ss', String(startSec));
      args.push('-i', inputPath);
      if (endSec != null) args.push('-t', String(Math.max(0.1, endSec - (startSec || 0))));
      if (outputKind === 'audio') {
        const info = AUDIO_CONVERT_MAP[audioFormat] || AUDIO_CONVERT_MAP.mp3;
        args.push('-vn', '-c:a', info.codec);
        if (targetAudioBitrate) args.push('-b:a', String(targetAudioBitrate));
        else if (info.lossy) args.push('-b:a', bitrate || '192k');
      } else {
        args.push(...buildVideoCodecArgs(vcodec, acodec, quality, targetVideoBitrate, videoCodec));
      }
      args.push(outPath);
      return args;
    };

    event.sender.send('convert-progress', { type: 'start' });

    let result = await runConvert(buildArgs(gpuVcodec || cpuVcodec), convertId, event, clipDuration);

    // GPU attempt failed at runtime (busy, driver hiccup, session without a
    // display, etc.) despite the earlier probe passing — fall back to CPU
    // transparently, unless the user cancelled in the meantime.
    if (result.code !== 0 && gpuVcodec && !(convertId && canceledConvertIds.has(convertId))) {
      event.sender.send('convert-progress', { type: 'start', message: 'GPU não respondeu, tentando novamente com CPU...' });
      result = await runConvert(buildArgs(cpuVcodec), convertId, event, clipDuration);
    }

    if (convertId && canceledConvertIds.has(convertId)) {
      try { if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
      return { success: false, canceled: true, error: 'Conversão cancelada.' };
    }

    if (result.code === 0) {
      event.sender.send('convert-progress', { type: 'done', outPath, folder: savePath });
      return { success: true, outPath, folder: savePath };
    }
    // Falhou (ou foi cancelado): o ffmpeg pode ter deixado um arquivo de
    // saída parcial/corrompido (sem moov atom etc.) — apagar para não
    // confundir o usuário depois, caso ele tente abrir/converter esse
    // arquivo quebrado mais tarde.
    try { if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}

    const technicalDetails = sanitizeDiagnosticStderr(result.stderrTail || '');
    const tailLines = technicalDetails.split('\n').filter(Boolean).slice(-4).join('\n');
    const errMsg = tailLines || `Erro na conversão (código ${result.code})`;
    event.sender.send('convert-progress', { type: 'error', error: errMsg, technicalDetails });
    return { success: false, error: errMsg, technicalDetails };
  } catch (e) { return { success: false, error: e.message }; }
  finally {
    if (convertId) canceledConvertIds.delete(convertId);
  }
});

// ── Spotify ───────────────────────────────────────────────────────────────────

const SPOT_CLIENT_ID     = Buffer.from('YWZkNjM1YzE3NWMxNGViNTljMDgxMGMwMzIyNTNhNjk=', 'base64').toString();
const SPOT_CLIENT_SECRET = Buffer.from('YWEzMjA2MjlhN2I3NDQwY2I3OWMwZWI4YmE0OWRhMWU=', 'base64').toString();

let _spotToken = null, _spotTokenExp = 0;

async function getSpotifyToken() {
  if (_spotToken && Date.now() < _spotTokenExp - 30000) return _spotToken;
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const auth  = Buffer.from(`${SPOT_CLIENT_ID}:${SPOT_CLIENT_SECRET}`).toString('base64');
    const req = https.request({
      hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode < 400 && j.access_token) {
            _spotToken = j.access_token;
            _spotTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
            resolve(_spotToken);
          } else {
            reject(new Error(`Token inválido (${res.statusCode}): ${j.error_description || j.error || data}`));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout ao obter token')); });
    req.write(body);
    req.end();
  });
}

async function spotifyApiGet(endpoint, retried = false) {
  const token = await getSpotifyToken();
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.spotify.com/v1${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        if (res.statusCode === 401 && !retried) {
          _spotToken = null;
          _spotTokenExp = 0;
          spotifyApiGet(endpoint, true).then(resolve, reject);
          return;
        }
        try {
          const j = JSON.parse(data);
          if (res.statusCode === 401) _spotToken = null;
          if (res.statusCode >= 400 || j.error) {
            reject(new Error(j.error?.message || `Spotify API HTTP ${res.statusCode}`));
            return;
          }
          resolve(j);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// parseSpotifyUrl vem de ./lib/media-utils.js.

async function getSpotifyTracks(url) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('URL do Spotify inválida');
  if (parsed.type === 'unsupported') {
    throw new Error('Podcasts/episódios do Spotify não são suportados — use um link de música, álbum ou playlist.');
  }

  if (parsed.type === 'track') {
    const t = await spotifyApiGet(`/tracks/${parsed.id}`);
    const thumbnail = t.album?.images?.[0]?.url || '';
    return {
      name: t.name, type: 'track',
      artist: t.artists?.map(a => a.name).join(', ') || '',
      thumbnail,
      tracks: [{ id: t.id || parsed.id, title: t.name, artists: t.artists?.map(a => a.name).join(', ') || '', duration: t.duration_ms, thumbnail }]
    };
  }
  if (parsed.type === 'album') {
    const a = await spotifyApiGet(`/albums/${parsed.id}`);
    const thumbnail = a.images?.[0]?.url || '';
    let items = a.tracks?.items || [];
    let next = a.tracks?.next;
    while (next) {
      const page = await spotifyApiGet(next.replace('https://api.spotify.com/v1', ''));
      items = [...items, ...(page.items || [])];
      next = page.next;
    }
    return {
      name: a.name, type: 'album',
      artist: a.artists?.map(ar => ar.name).join(', ') || '',
      thumbnail,
      tracks: items.filter(t => t?.name).map(t => ({ id: t.id || null, title: t.name, artists: t.artists?.map(ar => ar.name).join(', ') || '', duration: t.duration_ms, thumbnail }))
    };
  }
  const pl = await spotifyApiGet(`/playlists/${parsed.id}`);
  let items = pl.tracks?.items || [];
  let next = pl.tracks?.next;
  while (next) {
    const page = await spotifyApiGet(next.replace('https://api.spotify.com/v1', ''));
    items = [...items, ...(page.items || [])];
    next = page.next;
  }
  return {
    name: pl.name, type: 'playlist',
    artist: pl.owner?.display_name || '',
    thumbnail: pl.images?.[0]?.url || '',
    // Playlists can mix tracks from many different albums, so each track
    // carries its own album art instead of reusing the playlist's cover —
    // falls back to the playlist cover only if a track is missing one.
    tracks: items.filter(i => i?.track).map(i => ({
      id: i.track.id || null,
      title: i.track.name,
      artists: i.track.artists?.map(a => a.name).join(', ') || '',
      duration: i.track.duration_ms,
      thumbnail: i.track.album?.images?.[0]?.url || pl.images?.[0]?.url || ''
    }))
  };
}

ipcMain.handle('spotify-get-info', async (_, { url }) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  const parsed = parseSpotifyUrl(url);
  if (!parsed) return { success: false, error: 'Link do Spotify inválido — use um link de música, álbum ou playlist.' };
  if (parsed.type === 'unsupported') {
    return { success: false, error: 'Podcasts/episódios do Spotify não são suportados — use um link de música, álbum ou playlist.' };
  }
  try {
    if (parsed.type === 'track') {
      const t = await spotifyApiGet(`/tracks/${parsed.id}`);
      return {
        success: true,
        name: t.name,
        type: 'track',
        artist: t.artists?.map(a => a.name).join(', ') || '',
        thumbnail: t.album?.images?.[0]?.url || '',
        count: 1,
      };
    }
    if (parsed.type === 'album') {
      const a = await spotifyApiGet(`/albums/${parsed.id}`);
      return {
        success: true,
        name: a.name,
        type: 'album',
        artist: a.artists?.map(ar => ar.name).join(', ') || '',
        thumbnail: a.images?.[0]?.url || '',
        count: a.tracks?.total || 1,
      };
    }
    const pl = await spotifyApiGet(`/playlists/${parsed.id}?fields=name,owner(display_name),images,tracks(total)`);
    return {
      success: true,
      name: pl.name,
      type: 'playlist',
      artist: pl.owner?.display_name || '',
      thumbnail: pl.images?.[0]?.url || '',
      count: pl.tracks?.total || 1,
    };
  } catch {
    // Fallback pra oembed caso a Web API falhe temporariamente.
    const cleanUrl = url.split('?')[0];
    return new Promise(resolve => {
      const req = https.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
          if (res.statusCode >= 400) {
            res.resume();
            resolve({ success: false, error: `Spotify respondeu HTTP ${res.statusCode}.` });
            return;
          }
          let data = '';
          res.on('data', d => { data += d; });
          res.on('end', () => {
            try {
              const j = JSON.parse(data);
              resolve({ success: true, name: j.title || cleanUrl, type: parsed.type, artist: '', thumbnail: j.thumbnail_url || '', count: 1 });
            } catch { resolve({ success: false, error: 'Erro ao parsear resposta do Spotify.' }); }
          });
        });
      req.on('error', e => resolve({ success: false, error: `Erro de rede: ${e.message}` }));
      req.setTimeout(12000, () => { req.destroy(); resolve({ success: false, error: 'Timeout ao buscar info.' }); });
    });
  }
});

// Downloads `thumbnailUrl` to a temp file and re-muxes it into audioPath as
// cover art (via ffmpeg, no re-encode). Unlike yt-dlp's --embed-thumbnail
// (which would embed the YouTube search result's own thumbnail — often the
// wrong image for a plain audio search), this uses the real Spotify album
// art we already have the URL for. Failures here are non-fatal: the song
// itself already downloaded fine, it just won't have cover art.
function embedAlbumArt(audioPath, ext, thumbnailUrl, ffmpegPath) {
  return new Promise(resolve => {
    if (!thumbnailUrl || ext === 'ogg') return resolve(false);
    const tmpImg = path.join(os.tmpdir(), `cover_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    const cleanupImg = () => fs.unlink(tmpImg, () => {});

    const req = https.get(thumbnailUrl, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const file = fs.createWriteStream(tmpImg);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const tmpOut = audioPath + `.cover.tmp.${ext}`;
          const args = [
            '-y', '-i', audioPath, '-i', tmpImg,
            '-map', '0:a', '-map', '1:0', '-c', 'copy',
          ];
          if (ext === 'mp3') args.push('-id3v2_version', '3');
          args.push(
            '-metadata:s:v', 'title=Album cover',
            '-metadata:s:v', 'comment=Cover (front)',
            '-disposition:v:0', 'attached_pic',
            tmpOut,
          );
          let proc;
          try { proc = spawn(ffmpegPath, args, { windowsHide: true }); }
          catch { cleanupImg(); return resolve(false); }
          proc.on('error', () => { cleanupImg(); resolve(false); });
          proc.on('close', code => {
            cleanupImg();
            if (code !== 0) { fs.unlink(tmpOut, () => {}); return resolve(false); }
            fs.rename(tmpOut, audioPath, err => resolve(!err));
          });
        });
      });
      file.on('error', () => { cleanupImg(); resolve(false); });
    });
    req.on('error', () => { cleanupImg(); resolve(false); });
    req.setTimeout(15000, () => { req.destroy(); cleanupImg(); resolve(false); });
  });
}

// SPOT_FMT_MAP e SPOT_QUALITY_MAP vêm de ./lib/media-utils.js.

function downloadSpotifyTrack(track, savePath, ffmpegPath, downloadId, index, { format, quality }, isCanceledFn, onProgress) {
  return new Promise(resolve => {
    const fmtSpec = SPOT_FMT_MAP[format] || SPOT_FMT_MAP.mp3;
    const ytQuality = fmtSpec.ext === 'flac' ? '0' : (SPOT_QUALITY_MAP[quality] || '320K');
    const rawLabel = track.artists ? `${track.artists} - ${track.title}` : (track.title || `track_${index + 1}`);
    const safeName = sanitizeOutputFilename(rawLabel, `track_${index + 1}`);
    const outputTemplate = path.join(savePath, safeName + '.%(ext)s');
    const outputPath = path.join(savePath, `${safeName}.${fmtSpec.ext}`);
    const queryText = track.artists ? `${track.artists} ${track.title} audio` : `${track.title} audio`;
    const query = `ytsearch1:${queryText}`;

    const args = [
      '--no-warnings',
      '-x', '--audio-format', fmtSpec.ytFmt, '--audio-quality', ytQuality,
      '--embed-metadata',
      '--output', outputTemplate,
      '--ffmpeg-location', ffmpegPath,
      '--newline', '--no-playlist',
    ];
    pushRateLimitArgs(args);
    pushFilenameSafetyArgs(args);
    args.push('--', query);

    const procKey = downloadId ? `${downloadId}_track_${index}` : null;
    const proc = spawnDownload(args, procKey);

    let done = false, stderr = '';
    const settle = (ok, errText = '') => {
      if (done) return;
      done = true;
      if (procKey) activeProcs.delete(procKey);
      resolve({ ok, stderr: errText });
    };

    proc.stdout.on('data', d => {
      const line = d.toString();
      const match = line.match(/\[download\]\s+(\d+\.?\d*)%.*?at\s+([\d.\w]+\/s).*?ETA\s+([\d:]+)/);
      if (match) {
        onProgress({ phase: 'downloading', percent: parseFloat(match[1]), speed: match[2], eta: match[3] });
      } else {
        const pct = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (pct) onProgress({ phase: 'downloading', percent: parseFloat(pct[1]), speed: '', eta: '' });
      }
      if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
        onProgress({ phase: 'converting', percent: 95, speed: '', eta: '' });
      }
    });
    proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-8000); });
    proc.on('close', async code => {
      if (done) return;
      if (procKey) activeProcs.delete(procKey);
      const ok = !isCanceledFn() && code === 0 && !stderr.toLowerCase().includes('error:');
      if (ok && track.thumbnail && fs.existsSync(outputPath)) {
        await embedAlbumArt(outputPath, fmtSpec.ext, track.thumbnail, ffmpegPath);
      }
      settle(ok, stderr);
    });
    proc.on('error', err => settle(false, err?.message || ''));
  });
}

ipcMain.handle('spotify-download', async (event, { url, format, quality, downloadId, savePath: provided, silentGlobalProgress }) => {
  if (!isSafeMediaUrl(url)) return BAD_URL;
  const isCanceled = () => !!(downloadId && canceledSpotifyIds.has(downloadId));
  const outFormat  = SPOT_FMT_MAP[format] ? format : 'mp3';
  const outQuality = outFormat === 'flac' ? 'lossless' : (SPOT_QUALITY_MAP[quality] ? quality : '320k');
  try {
    const settings = loadSettings();
    let savePath = provided;
    if (!savePath) {
      const def = settings.lastFolder || settings.defaultFolder || undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Pasta de destino', defaultPath: def, properties: ['openDirectory'] });
      if (canceled || !filePaths[0]) return { success: false, canceled: true, error: 'Download cancelado.' };
      savePath = filePaths[0];
      const s = loadSettings(); s.lastFolder = savePath; saveSettings(s);
    }

    const diskCheck = await confirmDiskSpaceIfLow(savePath, 0, !silentGlobalProgress);
    if (!diskCheck.proceed) {
      return { success: false, canceled: !!diskCheck.canceledByUser, error: diskCheck.error || 'Espaço em disco insuficiente.' };
    }

    if (downloadId) activeProcs.set(downloadId, { pid: null });
    if (!silentGlobalProgress) {
      event.sender.send('spotify-progress', { type: 'start' });
      event.sender.send('spotify-progress', { type: 'progress', percent: 5, label: 'Buscando informações...' });
    }

    let spotData;
    try {
      spotData = await getSpotifyTracks(url);
    } catch(e) {
      if (isCanceled()) return { success: false, canceled: true, error: 'Download cancelado.' };
      return { success: false, error: `Erro na API do Spotify: ${e.message}` };
    }
    if (isCanceled()) return { success: false, canceled: true, error: 'Download cancelado.' };

    const tracks = spotData.tracks.map((t, i) => ({ ...t, index: i }));
    const total  = tracks.length;
    if (!total) return { success: false, error: 'Nenhuma música encontrada nesse link do Spotify.' };
    const ffmpegPath = ffmpegBin;

    if (!silentGlobalProgress) {
      event.sender.send('spotify-progress', { type: 'progress', percent: 10, label: `${total} música(s) encontrada(s)` });
    }

    let downloaded = 0, errors = 0, lastTrackStderr = '';
    const concurrency = Math.max(1, parseInt(settings.concurrentDownloads) || 3);

    const runWorker = async () => {
      while (tracks.length && !isCanceled()) {
        const track = tracks.shift();
        const displayName = track.artists ? `${track.artists} - ${track.title}` : track.title;
        if (!silentGlobalProgress) event.sender.send('spotify-log', `Baixando: ${displayName}`);

        const { ok, stderr } = await downloadSpotifyTrack(
          track, savePath, ffmpegPath, downloadId, track.index,
          { format: outFormat, quality: outQuality },
          isCanceled,
          data => {
            if (!silentGlobalProgress) {
              event.sender.send('spotify-progress', {
                type: 'track-progress', index: track.index,
                phase: data.phase, percent: data.percent,
                speed: data.speed, eta: data.eta,
                title: displayName
              });
            } else if (downloadId && total === 1) {
              if (data.phase === 'downloading') {
                event.sender.send(`download-progress-${downloadId}`, { type: 'progress', percent: data.percent || 0, speed: data.speed || '', eta: data.eta || '' });
              } else if (data.phase === 'converting') {
                event.sender.send(`download-progress-${downloadId}`, { type: 'converting', label: `Convertendo ${outFormat.toUpperCase()}...` });
              }
            }
          }
        );

        if (isCanceled()) break;

        if (ok) {
          downloaded++;
        } else {
          errors++;
          if (stderr) lastTrackStderr = stderr;
          if (!silentGlobalProgress) event.sender.send('spotify-log', `Falhou: ${track.title}`);
        }

        if (!silentGlobalProgress) {
          event.sender.send('spotify-progress', { type: 'track-progress', index: track.index, phase: 'done' });
          const pct = 10 + Math.round(((downloaded + errors) / total) * 90);
          event.sender.send('spotify-progress', {
            type: 'progress',
            percent: Math.min(100, pct),
            label: `Concluídos: ${downloaded} de ${total}${errors ? ` · ${errors} falha(s)` : ''}`
          });
        } else if (downloadId && total > 1) {
          event.sender.send(`download-progress-${downloadId}`, {
            type: 'progress',
            percent: Math.round(((downloaded + errors) / total) * 100),
            speed: '',
            eta: `${downloaded}/${total}`
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, runWorker));

    if (isCanceled()) {
      return { success: false, canceled: true, error: 'Download cancelado.' };
    }

    const label = total > 1 ? `${downloaded}/${total}` : 'concluído';
    try {
      addToHistory({
        title: `Spotify: ${spotData.name}`,
        url, format: outFormat, quality: outQuality,
        folder: savePath, date: new Date().toISOString(),
        status: downloaded > 0 ? 'success' : 'error'
      });
    } catch (e) { console.warn('[histórico] não registrei Spotify:', e.message); }

    if (downloaded > 0) {
      if (Notification.isSupported()) new Notification({ title: 'gameshmm downloader', body: `✅ Spotify — ${label}` }).show();
      if (!silentGlobalProgress) event.sender.send('spotify-progress', { type: 'done', folder: savePath, downloaded, total });
      return { success: true, folder: savePath, downloaded, total };
    } else {
      const errMsg = 'Nenhuma música foi baixada. Verifique a conexão.';
      const technicalDetails = sanitizeDiagnosticStderr(lastTrackStderr);
      if (!silentGlobalProgress) event.sender.send('spotify-progress', { type: 'error', label: errMsg });
      return { success: false, error: errMsg, technicalDetails };
    }
  } catch(e) { return { success: false, error: e.message }; }
  finally {
    if (downloadId) {
      activeProcs.delete(downloadId);
      canceledSpotifyIds.delete(downloadId);
    }
  }
});

ipcMain.handle('cancel-spotify', (_, id) => {
  if (id) canceledSpotifyIds.add(id);
  const p = activeProcs.get(id);
  if (p) { killProc(p); activeProcs.delete(id); }
  const subKeys = [...activeProcs.keys()].filter(k => k.startsWith(`${id}_track_`));
  for (const key of subKeys) { killProc(activeProcs.get(key)); activeProcs.delete(key); }
  return true;
});
