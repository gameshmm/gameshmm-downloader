const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Video / Playlist info
  getVideoInfo:    (o) => ipcRenderer.invoke('get-video-info', o),
  getPlaylistInfo: (o) => ipcRenderer.invoke('get-playlist-info', o),
  getFormats:      (o) => ipcRenderer.invoke('get-formats', o),

  // Downloads
  downloadVideo:    (o) => ipcRenderer.invoke('download-video', o),
  downloadPlaylist: (o) => ipcRenderer.invoke('download-playlist', o),
  cancelDownload:   (id) => ipcRenderer.invoke('cancel-download', id),
  // Progresso do download na barra de tarefas (0–1; -1 remove)
  setTaskbarProgress: (v) => ipcRenderer.invoke('set-taskbar-progress', v),

  // Progress events
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, v) => cb(v)),
  onPlaylistProgress: (cb) => ipcRenderer.on('playlist-progress',  (_, d) => cb(d)),
  onUpdateLog:        (cb) => ipcRenderer.on('update-log',         (_, t) => cb(t)),
  // Per-download progress (for parallel queue)
  onDownloadProgressById: (id, cb) => { const ch = `download-progress-${id}`; ipcRenderer.on(ch, (_, d) => cb(d)); },
  removeDownloadProgressById: (id) => ipcRenderer.removeAllListeners(`download-progress-${id}`),

  // Login
  loginYoutube:            () => ipcRenderer.invoke('login-youtube'),
  loginYoutubeBrowser:     () => ipcRenderer.invoke('login-youtube-browser'),
  logoutYoutube:           () => ipcRenderer.invoke('logout-youtube'),
  checkLogin:              () => ipcRenderer.invoke('check-login'),
  // Cookies mandados pela extensão do navegador chegam de forma assíncrona
  // (protocolo customizado), não como resposta direta de loginYoutube().
  onLoginCookiesReceived:  (cb) => ipcRenderer.on('login-cookies-received', (_, d) => cb(d)),

  // Browser lock (cookie database in use)
  killBrowserProcess: (browser) => ipcRenderer.invoke('kill-browser-process', browser),

  // Windows Defender / antivirus troubleshooting
  openWindowsSecurity: () => ipcRenderer.invoke('open-windows-security'),

  // Converter
  chooseMediaFile:   (droppedPath) => ipcRenderer.invoke('choose-media-file', droppedPath),
  // Caminho real de um arquivo arrastado pra janela (File.path não existe mais no Electron novo)
  pathForFile:       (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  convertMedia:      (o) => ipcRenderer.invoke('convert-media', o),
  cancelConvert:     (id) => ipcRenderer.invoke('cancel-convert', id),
  onConvertProgress: (cb) => ipcRenderer.on('convert-progress', (_, d) => cb(d)),
  detectGpuEncoders: () => ipcRenderer.invoke('detect-gpu-encoders'),

  // Auto update
  checkForUpdates:  () => ipcRenderer.invoke('check-for-updates'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  onUpdateStatus:   (cb) => ipcRenderer.on('app-update-status', (_, d) => cb(d)),
  getAppVersion:    () => ipcRenderer.invoke('get-app-version'),
  onShowChangelog:  (cb) => ipcRenderer.on('show-changelog', (_, d) => cb(d)),

  // Settings
  getSettings:  () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),

  // History
  getHistory:   () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Utils
  openFolder:        (p) => ipcRenderer.invoke('open-folder', p),
  updateYtdlp:       () => ipcRenderer.invoke('update-ytdlp'),
  readClipboardText: () => ipcRenderer.invoke('read-clipboard-text'),

  // Status do sistema (aba Config) + sair do modo administrador
  getRuntimeInfo:      () => ipcRenderer.invoke('get-runtime-info'),
  relaunchUnelevated:  () => ipcRenderer.invoke('relaunch-unelevated'),

  // Fila salva em disco entre sessões
  getQueue:  () => ipcRenderer.invoke('get-queue'),
  saveQueue: (items) => ipcRenderer.invoke('save-queue', items),

  // Checagem automática de yt-dlp desatualizado
  checkYtdlpVersion:   () => ipcRenderer.invoke('check-ytdlp-version'),
  onYtdlpUpdateStatus: (cb) => ipcRenderer.on('ytdlp-update-status', (_, d) => cb(d)),

  // Detecção de duplicado (link já baixado com sucesso antes)
  checkDuplicateDownload: (url) => ipcRenderer.invoke('check-duplicate-download', url),

  // Extensão do navegador (botão "Baixar vídeo" -> link gameshmm-downloader://)
  onOpenDownloadUrl:     (cb) => ipcRenderer.on('open-download-url', (_, url) => cb(url)),
  openExtensionFolder:   () => ipcRenderer.invoke('open-extension-folder'),
  openExtensionFirefoxFolder: () => ipcRenderer.invoke('open-extension-firefox-folder'),

  // Bandeja do sistema + atalho global
  getGlobalShortcut: () => ipcRenderer.invoke('get-global-shortcut'),

  // Spotify
  spotifyGetInfo:     (o) => ipcRenderer.invoke('spotify-get-info', o),
  spotifyDownload:    (o) => ipcRenderer.invoke('spotify-download', o),
  cancelSpotify:      (id) => ipcRenderer.invoke('cancel-spotify', id),
  onSpotifyProgress:  (cb) => ipcRenderer.on('spotify-progress', (_, d) => cb(d)),
  onSpotifyLog:       (cb) => ipcRenderer.on('spotify-log', (_, t) => cb(t)),

  // Energia & Área de transferência
  executePowerAction: (action) => ipcRenderer.invoke('execute-power-action', action),
  writeClipboardText: (text) => ipcRenderer.invoke('write-clipboard-text', text),
});
