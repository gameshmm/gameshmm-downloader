'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mu = require('../lib/media-utils');

describe('lib/media-utils', () => {
  it('detects supported platforms and playlists accurately', () => {
    assert.equal(mu.detectSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.type, 'youtube');
    assert.equal(mu.detectSource('https://youtu.be/dQw4w9WgXcQ')?.type, 'youtube');
    assert.equal(mu.detectSource('https://www.youtube.com/playlist?list=PL12345')?.type, 'youtube-playlist');
    assert.equal(mu.detectSource('https://www.youtube.com/watch?v=abc&list=PL12345')?.type, 'youtube-playlist');
    assert.equal(mu.detectSource('https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT')?.type, 'spotify');
    assert.equal(mu.detectSource('https://www.tiktok.com/@user/video/123456')?.type, 'tiktok');
    assert.equal(mu.detectSource('https://www.instagram.com/reel/Cx123/')?.type, 'instagram');
    assert.equal(mu.detectSource('https://x.com/user/status/99999')?.type, 'twitter');
    assert.equal(mu.detectSource('https://example.org/video.mp4')?.type, 'universal');
    assert.equal(mu.detectSource('not-a-url'), null);
    assert.equal(mu.detectSource(''), null);
  });

  it('validates safe http(s) URLs and rejects flag injection or local schemes', () => {
    assert.equal(mu.isSafeMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(mu.isSafeMediaUrl('http://localhost:8080/video.mp4'), true);
    assert.equal(mu.isSafeMediaUrl('file:///C:/Windows/win.ini'), false);
    assert.equal(mu.isSafeMediaUrl('javascript:alert(1)'), false);
    assert.equal(mu.isSafeMediaUrl('--exec=calc.exe'), false);
    assert.equal(mu.isSafeMediaUrl(''), false);
    assert.equal(mu.isSafeMediaUrl(null), false);
  });

  it('normalizes URLs for duplicate detection while stripping tracking params', () => {
    const a = mu.normalizeUrlForDup('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123&utm_source=share');
    const b = mu.normalizeUrlForDup('https://youtu.be/dQw4w9WgXcQ?t=42&fbclid=xyz');
    const c = mu.normalizeUrlForDup('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(a, c);
    assert.ok(b.includes('youtu.be/dqw4w9wgxcq'));
    assert.ok(!b.includes('fbclid'));
  });

  it('parses Spotify URLs including localized intl prefixes', () => {
    assert.deepEqual(
      mu.parseSpotifyUrl('https://open.spotify.com/intl-pt/album/1A2B3C?si=xyz'),
      { type: 'album', id: '1A2B3C' }
    );
    assert.deepEqual(
      mu.parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
      { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' }
    );
    assert.equal(mu.parseSpotifyUrl('https://www.youtube.com/watch?v=123'), null);
  });

  it('parses valid timestamps and rejects malformed ones', () => {
    assert.equal(mu.parseTimeToSeconds('0'), 0);
    assert.equal(mu.parseTimeToSeconds('90.5'), 90.5);
    assert.equal(mu.parseTimeToSeconds('01:30'), 90);
    assert.equal(mu.parseTimeToSeconds('01:02:03'), 3723);
    assert.equal(mu.parseTimeToSeconds(''), null);
    assert.equal(mu.parseTimeToSeconds('-5'), null);
    assert.equal(mu.parseTimeToSeconds('1:2:3:4'), null);
    assert.equal(mu.parseTimeToSeconds('abc'), null);
  });

  it('sanitizes output filenames safely against path traversal and Windows reserved names', () => {
    const trav = mu.sanitizeOutputFilename('../../secret:name?.mp4');
    assert.equal(trav, '.._.._secret_name_.mp4');
    assert.ok(!trav.includes('/'));
    assert.ok(!trav.includes('\\'));
    assert.equal(mu.sanitizeOutputFilename('...', 'arquivo_convertido'), 'arquivo_convertido');
    assert.equal(mu.sanitizeOutputFilename('CON'), '_CON');
    assert.equal(mu.sanitizeOutputFilename(''), 'arquivo');
    assert.ok(mu.sanitizeOutputFilename('a'.repeat(300)).length <= 160);
  });

  it('evaluates disk space thresholds accurately', () => {
    const unknown = mu.evaluateDiskSpace(null, 0);
    assert.equal(unknown.ok, true);
    assert.equal(unknown.unknown, true);

    const lowFloor = mu.evaluateDiskSpace(80 * 1024 * 1024, 0);
    assert.equal(lowFloor.ok, false);
    assert.equal(lowFloor.critical, true);
    assert.match(lowFloor.message, /Pouquíssimo espaço/);

    const lowEstimate = mu.evaluateDiskSpace(500 * 1024 * 1024, 500 * 1024 * 1024);
    assert.equal(lowEstimate.ok, false);
    assert.equal(lowEstimate.critical, true);
    assert.match(lowEstimate.message, /Espaço livre insuficiente/);

    const warnOnly = mu.evaluateDiskSpace(350 * 1024 * 1024, 100 * 1024 * 1024);
    assert.equal(warnOnly.ok, true);
    assert.equal(warnOnly.warnOnly, true);

    const plenty = mu.evaluateDiskSpace(20 * 1024 * 1024 * 1024, 500 * 1024 * 1024);
    assert.equal(plenty.ok, true);
    assert.equal(plenty.warnOnly, false);
    assert.equal(plenty.critical, false);
  });

  it('extracts audio languages & subtitles and builds strict yt-dlp selectors', () => {
    assert.equal(mu.sanitizeLangCode('pt-BR'), 'pt-BR');
    assert.equal(mu.sanitizeLangCode('auto'), '');
    assert.equal(mu.sanitizeLangCode('pt;rm -rf /'), '');

    const meta = mu.extractAudioTracksAndSubs({
      formats: [
        { acodec: 'mp4a.40.2', language: 'en', format_note: 'English dubbed', language_preference: -1 },
        { acodec: 'mp4a.40.2', language: 'pt-BR', format_note: 'Portuguese (Brazil) original', language_preference: 10 },
        { acodec: 'none', vcodec: 'avc1', language: 'fr' },
      ],
      subtitles: { 'pt-BR': [{ ext: 'vtt' }], live_chat: [{ ext: 'json' }] },
      automatic_captions: { en: [{ ext: 'vtt' }] },
    });
    assert.equal(meta.audioTracks.length, 2);
    assert.equal(meta.audioTracks[0].code, 'pt-BR');
    assert.match(meta.audioTracks[0].label, /original/);
    assert.match(meta.audioTracks[1].label, /dublado/);
    assert.equal(meta.hasHumanSubs, true);
    assert.equal(meta.hasAutoSubs, true);
    assert.deepEqual(meta.subLanguages, ['pt-BR', 'en']);

    const sel = mu.buildAudioSelector({ outContainer: 'mp4', audioLang: 'pt-BR' });
    assert.ok(sel.startsWith('bestaudio[language=pt-BR][ext=m4a]/bestaudio[language^=pt][ext=m4a]/'));

    const expr = mu.buildVideoFormatExpression({ quality: '1080', outContainer: 'mp4', effectiveCodec: 'h264', audioLang: 'pt-BR' });
    assert.ok(expr.includes('bestvideo[vcodec^=avc1][height<=1080]+('));
    assert.ok(expr.includes('best[height<=1080][language=pt-BR]'));
  });

  it('sanitizes secrets from diagnostic stderr and classifies compatibility retries', () => {
    const clean = mu.sanitizeDiagnosticStderr(
      '[download] 42.1% of 100MiB\nCookie: SID=secretvalue123; __Secure-1PSID=abc\nAuthorization: Bearer topsecret\nERROR: HTTP Error 403: Forbidden'
    );
    assert.ok(!clean.includes('secretvalue123'));
    assert.ok(!clean.includes('topsecret'));
    assert.ok(!clean.includes('42.1%'));
    assert.match(clean, /\[oculto\]/);
    assert.match(clean, /HTTP Error 403/);

    assert.equal(mu.canOfferCompatRetry({ stderr: 'HTTP Error 403', format: 'video', container: 'mp4', videoCodec: 'av1' }), true);
    assert.equal(mu.canOfferCompatRetry({ stderr: 'HTTP Error 403', format: 'audio', container: 'mp4', videoCodec: 'auto' }), false);
    assert.equal(mu.canOfferCompatRetry({ stderr: 'Only images are available for download', format: 'video', container: 'mp4', videoCodec: 'auto' }), false);
  });

  it('validates loopback bridge origin and extension headers strictly', () => {
    assert.equal(mu.isAllowedBridgeOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
    assert.equal(mu.isAllowedBridgeOrigin('moz-extension://12345678-1234-1234-1234-123456789abc'), true);
    assert.equal(mu.isAllowedBridgeOrigin('https://evil.com'), false);
    assert.equal(mu.isAllowedBridgeOrigin('http://127.0.0.1:8080'), false);

    assert.equal(mu.validateBridgeHeaders({ method: 'GET', origin: 'https://evil.com', headers: { 'x-gdl-extension': '1' } }).status, 403);
    assert.equal(mu.validateBridgeHeaders({ method: 'POST', origin: 'chrome-extension://abcdef', headers: { 'content-type': 'application/json' } }).status, 403);
    assert.equal(mu.validateBridgeHeaders({ method: 'POST', origin: 'chrome-extension://abcdef', headers: { 'x-gdl-extension': '1', 'content-type': 'text/plain' } }).status, 415);
    assert.equal(mu.validateBridgeHeaders({ method: 'POST', origin: 'chrome-extension://abcdef', headers: { 'x-gdl-extension': '1', 'content-type': 'application/json' } }).ok, true);
  });

  it('computes next schedule timestamp and human countdown strings', () => {
    const base = new Date(2026, 10, 8, 14, 0, 0, 0).getTime();
    const sameDay = mu.computeNextScheduleTimestamp('22:30', base);
    assert.equal(sameDay.tomorrow, false);
    assert.equal(sameDay.time, '22:30');
    assert.ok(sameDay.targetAt > base);

    const nextDay = mu.computeNextScheduleTimestamp('08:15', base);
    assert.equal(nextDay.tomorrow, true);
    assert.equal(nextDay.time, '08:15');
    assert.ok(nextDay.targetAt > base + 12 * 3600 * 1000);

    assert.equal(mu.computeNextScheduleTimestamp('99:99', base), null);
    assert.equal(mu.formatCountdownMs(2 * 3600 * 1000 + 15 * 60 * 1000), 'em 2h 15min');
    assert.equal(mu.formatCountdownMs(45 * 60 * 1000), 'em 45min');
    assert.equal(mu.formatCountdownMs(12 * 1000), 'em 12s');
  });
});
