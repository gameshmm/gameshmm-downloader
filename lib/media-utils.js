// Shared media, formatting, validation, and diagnostic helpers used across
// main.js (CommonJS), renderer.js (window.__gdlMedia), and automated tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root && typeof root === 'object') {
    root.__gdlMedia = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SOURCES = {
    youtube:           { label: 'YouTube',     color: '#ff4444', bg: 'rgba(255,68,68,0.1)',   border: 'rgba(255,68,68,0.3)' },
    'youtube-playlist':{ label: 'YT Playlist', color: '#ff4444', bg: 'rgba(255,68,68,0.1)',   border: 'rgba(255,68,68,0.3)' },
    spotify:           { label: 'Spotify',     color: '#1DB954', bg: 'rgba(29,185,84,0.1)',   border: 'rgba(29,185,84,0.3)' },
    tiktok:            { label: 'TikTok',      color: '#ff2d55', bg: 'rgba(255,45,85,0.1)',   border: 'rgba(255,45,85,0.3)' },
    instagram:         { label: 'Instagram',   color: '#e1306c', bg: 'rgba(225,48,108,0.1)',  border: 'rgba(225,48,108,0.3)' },
    twitter:           { label: 'X · Twitter', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.3)' },
    facebook:          { label: 'Facebook',    color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
    twitch:            { label: 'Twitch',      color: '#9146ff', bg: 'rgba(145,70,255,0.1)',  border: 'rgba(145,70,255,0.3)' },
    soundcloud:        { label: 'SoundCloud',  color: '#ff5500', bg: 'rgba(255,85,0,0.1)',    border: 'rgba(255,85,0,0.3)' },
    vimeo:             { label: 'Vimeo',       color: '#1ab7ea', bg: 'rgba(26,183,234,0.1)',  border: 'rgba(26,183,234,0.3)' },
    reddit:            { label: 'Reddit',      color: '#ff4500', bg: 'rgba(255,69,0,0.1)',    border: 'rgba(255,69,0,0.3)' },
    dailymotion:       { label: 'Dailymotion', color: '#0066ff', bg: 'rgba(0,102,255,0.1)',   border: 'rgba(0,102,255,0.3)' },
    universal:         { label: 'Universal',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)',  border: 'rgba(139,92,246,0.3)' },
  };

  const SRC_HUE = {
    youtube: 25,
    'youtube-playlist': 25,
    spotify: 150,
    tiktok: 355,
    instagram: 8,
    twitter: 245,
    facebook: 255,
    twitch: 295,
    soundcloud: 45,
    vimeo: 215,
    reddit: 38,
    dailymotion: 262,
  };

  function detectSource(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, '').toLowerCase();
      if (h === 'youtu.be' || h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
        const list = u.searchParams.get('list');
        if (list && !list.startsWith('RD') && !list.startsWith('FL') && !list.startsWith('LL')) {
          return { type: 'youtube-playlist', ...SOURCES['youtube-playlist'] };
        }
        return { type: 'youtube', ...SOURCES.youtube };
      }
      if (h === 'open.spotify.com' || h.endsWith('.spotify.com')) return { type: 'spotify', ...SOURCES.spotify };
      if (h.endsWith('tiktok.com') || h === 'vm.tiktok.com') return { type: 'tiktok', ...SOURCES.tiktok };
      if (h.endsWith('instagram.com')) return { type: 'instagram', ...SOURCES.instagram };
      if (h.endsWith('twitter.com') || h === 'x.com' || h.endsWith('.x.com') || h === 't.co') return { type: 'twitter', ...SOURCES.twitter };
      if (h.endsWith('facebook.com') || h === 'fb.watch' || h === 'fb.com') return { type: 'facebook', ...SOURCES.facebook };
      if (h.endsWith('twitch.tv') || h === 'clips.twitch.tv') return { type: 'twitch', ...SOURCES.twitch };
      if (h.endsWith('soundcloud.com')) return { type: 'soundcloud', ...SOURCES.soundcloud };
      if (h.endsWith('vimeo.com')) return { type: 'vimeo', ...SOURCES.vimeo };
      if (h.endsWith('reddit.com') || h === 'v.redd.it') return { type: 'reddit', ...SOURCES.reddit };
      if (h.endsWith('dailymotion.com') || h === 'dai.ly') return { type: 'dailymotion', ...SOURCES.dailymotion };
      return { type: 'universal', ...SOURCES.universal };
    } catch {
      return null;
    }
  }

  const DUP_IGNORED_PARAMS = ['si', 'feature', 'pp', 'ref', 'ref_src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'igshid', 'igsh', 'fbclid', 'gclid'];

  function normalizeUrlForDup(url = '') {
    try {
      const u = new URL(String(url).trim());
      u.hash = '';
      DUP_IGNORED_PARAMS.forEach(p => u.searchParams.delete(p));
      let s = u.toString();
      if (s.endsWith('/')) s = s.slice(0, -1);
      return s.toLowerCase();
    } catch {
      return String(url || '').trim().toLowerCase();
    }
  }

  function isSafeMediaUrl(u) {
    return typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());
  }

  function parseSpotifyUrl(url) {
    const clean = String(url || '').split('?')[0];
    const m = clean.match(/spotify\.com\/(?:intl-[^/]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    if (m[1] === 'episode' || m[1] === 'show') return { type: 'unsupported', kind: m[1], id: m[2] };
    return { type: m[1], id: m[2] };
  }

  function parseTimeToSeconds(str) {
    if (str == null || str === '') return null;
    const s = String(str).trim();
    if (!s) return null;
    const rawParts = s.split(':');
    if (rawParts.length > 3 || rawParts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
    const parts = rawParts.map(Number);
    if (parts.some(n => !Number.isFinite(n) || n < 0)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function sanitizeOutputFilename(rawName, fallback = 'arquivo') {
    let safeName = String(rawName || '')
      .replace(/[<>:"|?*\/\\]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140)
      .replace(/[. ]+$/, '');
    if (!safeName) safeName = String(fallback || 'arquivo');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(safeName)) {
      safeName = '_' + safeName;
    }
    return safeName;
  }

  const AUDIO_FORMATS = new Set(['audio', 'mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac', 'opus']);
  const AUDIO_ONLY_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma']);

  const CONTAINER_COMPAT = {
    mp4:  { video: new Set(['copy', 'h264', 'h265', 'vp9', 'av1']), audio: new Set(['copy', 'aac', 'mp3', 'opus']), defVideo: 'h264', defAudio: 'aac',  defaultAudio: 'aac' },
    mkv:  { video: new Set(['copy', 'h264', 'h265', 'vp9', 'av1']), audio: new Set(['copy', 'aac', 'mp3', 'opus']), defVideo: 'h264', defAudio: 'aac',  defaultAudio: 'aac' },
    webm: { video: new Set(['copy', 'vp9', 'av1']),                 audio: new Set(['copy', 'opus']),                 defVideo: 'vp9',  defAudio: 'opus', defaultAudio: 'opus' },
    avi:  { video: new Set(['copy', 'h264', 'h265', 'vp9', 'av1']), audio: new Set(['copy', 'aac', 'mp3']),          defVideo: 'h264', defAudio: 'mp3',  defaultAudio: 'mp3' },
    mov:  { video: new Set(['copy', 'h264', 'h265']),               audio: new Set(['copy', 'aac', 'mp3']),          defVideo: 'h264', defAudio: 'aac',  defaultAudio: 'aac' },
  };

  const SPOT_FMT_MAP = {
    mp3:  { ytFmt: 'mp3',    ext: 'mp3' },
    m4a:  { ytFmt: 'm4a',    ext: 'm4a' },
    flac: { ytFmt: 'flac',   ext: 'flac' },
    ogg:  { ytFmt: 'vorbis', ext: 'ogg' },
  };
  const SPOT_QUALITY_MAP = { '320k': '320K', '256k': '256K', '192k': '192K', '128k': '128K' };

  function fmtSizeShort(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
    return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
  }

  function evaluateDiskSpace(freeBytes, estimatedBytes = 0) {
    if (typeof freeBytes !== 'number' || !Number.isFinite(freeBytes) || freeBytes < 0) {
      return { ok: true, unknown: true, critical: false, warnOnly: false, freeBytes: null, estimatedBytes: 0, requiredBytes: 0, message: '' };
    }
    const MIN_FLOOR = 150 * 1024 * 1024;
    const LOW_WARN  = 600 * 1024 * 1024;
    const est = (typeof estimatedBytes === 'number' && Number.isFinite(estimatedBytes) && estimatedBytes > 0) ? estimatedBytes : 0;
    const requiredBytes = est > 0 ? Math.round(est * 1.25) + 100 * 1024 * 1024 : MIN_FLOOR;

    if (freeBytes < requiredBytes) {
      const msg = est > 0
        ? `Espaço livre insuficiente no disco: restam ${fmtSizeShort(freeBytes)}, mas esta operação precisa de cerca de ${fmtSizeShort(requiredBytes)} (incluindo margem temporária).`
        : `Pouquíssimo espaço livre no disco (${fmtSizeShort(freeBytes)} disponíveis). Recomendado ter pelo menos ${fmtSizeShort(MIN_FLOOR)} livres.`;
      return { ok: false, critical: true, warnOnly: false, freeBytes, estimatedBytes: est, requiredBytes, message: msg };
    }
    if (freeBytes < LOW_WARN) {
      return {
        ok: true,
        critical: false,
        warnOnly: true,
        freeBytes,
        estimatedBytes: est,
        requiredBytes,
        message: `Espaço em disco baixo: apenas ${fmtSizeShort(freeBytes)} livres no destino.`,
      };
    }
    return { ok: true, critical: false, warnOnly: false, freeBytes, estimatedBytes: est, requiredBytes, message: '' };
  }

  function sanitizeLangCode(lang) {
    if (typeof lang !== 'string') return '';
    const trimmed = lang.trim();
    if (!trimmed || trimmed.toLowerCase() === 'auto') return '';
    return /^[A-Za-z0-9_-]{1,24}$/.test(trimmed) ? trimmed : '';
  }

  let langDisplayNames = null;
  function formatLangLabel(code) {
    const clean = sanitizeLangCode(code);
    if (!clean) return String(code || '');
    if (clean.toLowerCase() === 'und') return 'Não especificado';
    try {
      if (!langDisplayNames && typeof Intl !== 'undefined' && Intl.DisplayNames) {
        langDisplayNames = new Intl.DisplayNames(['pt-BR', 'pt', 'en'], { type: 'language' });
      }
      if (langDisplayNames) {
        const display = langDisplayNames.of(clean);
        if (display && display.toLowerCase() !== clean.toLowerCase()) {
          return display.charAt(0).toUpperCase() + display.slice(1) + ` (${clean})`;
        }
      }
    } catch {}
    return clean.toUpperCase();
  }

  function extractAudioTracksAndSubs(info) {
    const src = info && typeof info === 'object' ? info : {};
    const formats = Array.isArray(src.formats) ? src.formats : [];
    const trackMap = new Map();

    for (const f of formats) {
      if (!f || !f.acodec || f.acodec === 'none') continue;
      const code = sanitizeLangCode(f.language || '');
      if (!code) continue;
      const key = code.toLowerCase();
      const note = String(f.format_note || f.format || '');
      const isOriginal = /original/i.test(note) || (typeof f.language_preference === 'number' && f.language_preference > 0);
      const isDubbed = /dubbed|dublado/i.test(note);
      const isDesc = /descriptive|audio\s*description/i.test(note);
      const prev = trackMap.get(key);
      if (!prev) {
        trackMap.set(key, {
          code,
          label: formatLangLabel(code),
          isOriginal,
          isDubbed,
          isDescriptive: isDesc,
          preference: typeof f.language_preference === 'number' ? f.language_preference : 0,
        });
      } else {
        if (isOriginal) prev.isOriginal = true;
        if (isDubbed) prev.isDubbed = true;
        if (typeof f.language_preference === 'number' && f.language_preference > prev.preference) {
          prev.preference = f.language_preference;
        }
      }
    }

    const audioTracks = [...trackMap.values()]
      .sort((a, b) => (b.preference - a.preference) || (b.isOriginal ? 1 : 0) - (a.isOriginal ? 1 : 0) || a.label.localeCompare(b.label, 'pt-BR'))
      .map(t => {
        const tags = [];
        if (t.isOriginal) tags.push('original');
        else if (t.isDubbed) tags.push('dublado');
        if (t.isDescriptive) tags.push('audiodescrição');
        return {
          code: t.code,
          label: tags.length ? `${t.label} [${tags.join(', ')}]` : t.label,
          isOriginal: t.isOriginal,
        };
      });

    const manualSubs = src.subtitles && typeof src.subtitles === 'object'
      ? Object.keys(src.subtitles).filter(k => k !== 'live_chat' && Array.isArray(src.subtitles[k]) && src.subtitles[k].length > 0)
      : [];
    const autoSubs = src.automatic_captions && typeof src.automatic_captions === 'object'
      ? Object.keys(src.automatic_captions).filter(k => Array.isArray(src.automatic_captions[k]) && src.automatic_captions[k].length > 0)
      : [];
    const subSet = new Set([...manualSubs, ...autoSubs]);

    return {
      audioTracks,
      hasHumanSubs: manualSubs.length > 0,
      hasAutoSubs: autoSubs.length > 0,
      hasSubs: subSet.size > 0,
      subLanguages: [...subSet],
    };
  }

  function buildAudioSelector({ outContainer = 'mp4', audioLang = 'auto' } = {}) {
    const lang = sanitizeLangCode(audioLang);
    if (!lang) {
      return outContainer === 'mp4' ? 'bestaudio[ext=m4a]/bestaudio' : 'bestaudio';
    }
    const baseLang = lang.split('-')[0];
    const parts = [];
    if (outContainer === 'mp4') {
      parts.push(`bestaudio[language=${lang}][ext=m4a]`);
      if (baseLang && baseLang !== lang) parts.push(`bestaudio[language^=${baseLang}][ext=m4a]`);
    }
    parts.push(`bestaudio[language=${lang}]`);
    if (baseLang && baseLang !== lang) parts.push(`bestaudio[language^=${baseLang}]`);
    if (outContainer === 'mp4') parts.push('bestaudio[ext=m4a]');
    parts.push('bestaudio');
    return parts.join('/');
  }

  function buildVideoFormatExpression({ quality = 'best', outContainer = 'mp4', effectiveCodec = 'auto', audioLang = 'auto' } = {}) {
    const capH = quality === 'best' || !quality ? '' : `[height<=${quality}]`;
    const audioPref = buildAudioSelector({ outContainer, audioLang });
    const lang = sanitizeLangCode(audioLang);
    const singleFallback = lang
      ? `best${capH}[language=${lang}]/best[ext=mp4]${capH}/best${capH}/best`
      : (outContainer === 'mp4' ? `best[ext=mp4]${capH}/best${capH}/best` : `best${capH}/best`);

    if (effectiveCodec === 'h264') {
      return `bestvideo[vcodec^=avc1]${capH}+(${audioPref})/bestvideo[vcodec^=h264]${capH}+(${audioPref})/bestvideo[ext=mp4]${capH}+(${audioPref})/bestvideo${capH}+(${audioPref})/${singleFallback}`;
    }
    if (effectiveCodec === 'vp9') {
      return `bestvideo[vcodec^=vp9]${capH}+(${audioPref})/bestvideo[vcodec^=vp09]${capH}+(${audioPref})/bestvideo${capH}+(${audioPref})/${singleFallback}`;
    }
    if (effectiveCodec === 'av1') {
      return `bestvideo[vcodec^=av01]${capH}+(${audioPref})/bestvideo${capH}+(${audioPref})/${singleFallback}`;
    }
    return outContainer === 'mkv'
      ? `bestvideo${capH}+(${audioPref})/${singleFallback}`
      : `bestvideo[ext=mp4]${capH}+(${audioPref})/bestvideo${capH}+(${audioPref})/${singleFallback}`;
  }

  function sanitizeDiagnosticStderr(raw, maxLines = 18, maxChars = 2400) {
    if (!raw) return '';
    const cleaned = String(raw)
      .replace(/\r[^\n]*/g, '')
      .replace(/(Cookie|Authorization|Set-Cookie)\s*:\s*[^\r\n]+/gi, '$1: [oculto]')
      .replace(/((?:__Secure-)?[0-9A-Z_]*SID|LOGIN_INFO)=[^;\s]+/gi, '$1=[oculto]');
    const lines = cleaned
      .split('\n')
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0 && !/^\[download\]\s+\d+(?:\.\d+)?%/.test(l));
    let tail = lines.slice(-maxLines).join('\n');
    if (tail.length > maxChars) tail = '…' + tail.slice(-(maxChars - 1));
    return tail;
  }

  function canOfferCompatRetry({ stderr = '', error = '', format = 'video', container = 'mp4', videoCodec = 'auto' } = {}) {
    if (format === 'audio') return false;
    const text = `${stderr}\n${error}`;
    if (/Only images are available|n challenge solving failed|SABR streaming|Private video|Video unavailable|Unsupported URL|Espaço livre insuficiente/i.test(text)) {
      return false;
    }
    const alreadyCompat = container === 'mp4' && videoCodec === 'h264';
    if (!alreadyCompat && /HTTP Error 403|Requested format is not available|ffmpeg|codec|mux|merge|mkv|av01|vp9/i.test(text)) {
      return true;
    }
    if (/HTTP Error 403|Requested format is not available/i.test(text)) return true;
    return false;
  }

  const EXTENSION_ORIGIN_RE = /^(chrome|moz|edge)-extension:\/\/[a-z0-9-]+$/i;
  function isAllowedBridgeOrigin(origin) {
    if (!origin) return false;
    return EXTENSION_ORIGIN_RE.test(String(origin).trim());
  }

  function validateBridgeHeaders({ method = 'GET', origin = '', headers = {} } = {}) {
    const normOrigin = origin ? String(origin).trim() : '';
    if (normOrigin && !isAllowedBridgeOrigin(normOrigin)) {
      return { ok: false, status: 403, reason: 'forbidden-origin' };
    }
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers || {})) {
      lowerHeaders[String(k).toLowerCase()] = String(v);
    }
    const hasExtHeader = lowerHeaders['x-gdl-extension'] === '1';
    if (String(method).toUpperCase() !== 'GET') {
      if (!hasExtHeader) return { ok: false, status: 403, reason: 'missing-extension-header' };
      const ct = (lowerHeaders['content-type'] || '').toLowerCase();
      if (!ct.startsWith('application/json')) return { ok: false, status: 415, reason: 'invalid-content-type' };
    } else if (!normOrigin && !hasExtHeader) {
      // Allow GET /status only when sent with extension header or extension origin
      return { ok: false, status: 403, reason: 'missing-extension-header' };
    }
    return { ok: true, corsOrigin: normOrigin || null };
  }

  function computeNextScheduleTimestamp(timeStr, nowMs = Date.now()) {
    const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const now = new Date(nowMs);
    const target = new Date(nowMs);
    target.setHours(hour, minute, 0, 0);
    let tomorrow = false;
    if (target.getTime() <= now.getTime() + 1000) {
      target.setDate(target.getDate() + 1);
      tomorrow = true;
    }
    return {
      targetAt: target.getTime(),
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      tomorrow,
    };
  }

  function formatCountdownMs(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `em ${h}h ${m}min`;
    if (m > 0) return `em ${m}min`;
    return `em ${s}s`;
  }

  return {
    SOURCES,
    SRC_HUE,
    detectSource,
    DUP_IGNORED_PARAMS,
    normalizeUrlForDup,
    isSafeMediaUrl,
    parseSpotifyUrl,
    parseTimeToSeconds,
    sanitizeOutputFilename,
    AUDIO_FORMATS,
    AUDIO_ONLY_EXTENSIONS,
    CONTAINER_COMPAT,
    SPOT_FMT_MAP,
    SPOT_QUALITY_MAP,
    fmtSizeShort,
    evaluateDiskSpace,
    sanitizeLangCode,
    formatLangLabel,
    extractAudioTracksAndSubs,
    buildAudioSelector,
    buildVideoFormatExpression,
    sanitizeDiagnosticStderr,
    canOfferCompatRetry,
    isAllowedBridgeOrigin,
    validateBridgeHeaders,
    computeNextScheduleTimestamp,
    formatCountdownMs,
  };
});
