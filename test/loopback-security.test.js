'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateBridgeHeaders, isSafeMediaUrl } = require('../lib/media-utils');

describe('Loopback bridge HTTP security boundary', () => {
  let server;
  let baseUrl;
  const receivedUrls = [];

  before(async () => {
    server = http.createServer((req, res) => {
      const origin = req.headers.origin ? String(req.headers.origin) : '';
      if (req.method === 'OPTIONS') {
        const check = validateBridgeHeaders({ method: 'POST', origin, headers: { 'x-gdl-extension': '1', 'content-type': 'application/json' } });
        if (!check.ok || !check.corsOrigin) {
          res.writeHead(403);
          res.end();
          return;
        }
        const headers = {
          'Access-Control-Allow-Origin': check.corsOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-GDL-Extension',
          Vary: 'Origin',
        };
        if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
          headers['Access-Control-Allow-Private-Network'] = 'true';
        }
        res.writeHead(204, headers);
        res.end();
        return;
      }

      const auth = validateBridgeHeaders({ method: req.method, origin, headers: req.headers });
      if (!auth.ok) {
        res.writeHead(auth.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: auth.reason }));
        return;
      }

      const send = (status, body) => {
        const h = { 'Content-Type': 'application/json' };
        if (auth.corsOrigin) h['Access-Control-Allow-Origin'] = auth.corsOrigin;
        res.writeHead(status, h);
        res.end(JSON.stringify(body));
      };

      if (req.method === 'GET' && req.url === '/status') {
        return send(200, { ok: true, bridge: 'gameshmm-downloader' });
      }

      if (req.method === 'POST' && req.url === '/open') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const url = typeof body.url === 'string' ? body.url.trim() : '';
            if (!isSafeMediaUrl(url)) return send(400, { ok: false, error: 'URL inválida' });
            receivedUrls.push(url);
            return send(200, { ok: true });
          } catch {
            return send(400, { ok: false, error: 'JSON inválido' });
          }
        });
        return;
      }

      send(404, { ok: false });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects arbitrary web origins on OPTIONS, GET, and POST', async () => {
    const optRes = await fetch(`${baseUrl}/open`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    assert.equal(optRes.status, 403);
    assert.equal(optRes.headers.get('access-control-allow-origin'), null);

    const getRes = await fetch(`${baseUrl}/status`, {
      headers: { Origin: 'https://evil.example', 'X-GDL-Extension': '1' },
    });
    assert.equal(getRes.status, 403);
  });

  it('requires X-GDL-Extension header and application/json Content-Type on POST', async () => {
    const noHeader = await fetch(`${baseUrl}/open`, {
      method: 'POST',
      headers: { Origin: 'chrome-extension://abcdefghijklmnop', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    assert.equal(noHeader.status, 403);

    const wrongCt = await fetch(`${baseUrl}/open`, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://abcdefghijklmnop',
        'X-GDL-Extension': '1',
        'Content-Type': 'text/plain',
      },
      body: '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}',
    });
    assert.equal(wrongCt.status, 415);
  });

  it('rejects non-http(s) URLs and yt-dlp CLI flag injection payloads', async () => {
    for (const bad of ['file:///C:/Windows/win.ini', '--exec=calc', 'javascript:alert(1)']) {
      const r = await fetch(`${baseUrl}/open`, {
        method: 'POST',
        headers: {
          Origin: 'moz-extension://12345678-1234-1234-1234-123456789abc',
          'X-GDL-Extension': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: bad }),
      });
      assert.equal(r.status, 400);
    }
    assert.equal(receivedUrls.length, 0);
  });

  it('allows valid Chrome/Firefox extension preflights and opens safe media URLs', async () => {
    const preflight = await fetch(`${baseUrl}/open`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'moz-extension://12345678-1234-1234-1234-123456789abc',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'moz-extension://12345678-1234-1234-1234-123456789abc');
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

    const okRes = await fetch(`${baseUrl}/open`, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://abcdefghijklmnop',
        'X-GDL-Extension': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
    assert.deepEqual(receivedUrls, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  });
});
