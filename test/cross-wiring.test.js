'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Repository wiring, IPC parity, CRLF & extension consistency', () => {
  it('configures package.json build.files and npm test properly', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts.test && pkg.scripts.test.includes('node --test'));
    assert.ok(Array.isArray(pkg.build.files) && pkg.build.files.includes('lib/**'));
  });

  it('uses CRLF consistently across app, test, and extension source files', () => {
    const crlfFiles = [
      'main.js',
      'preload.js',
      'renderer.js',
      'ui-fx.js',
      'index.html',
      'index.css',
      'lib/media-utils.js',
      'extension/manifest.json',
      'extension/background.js',
      'extension/shared.js',
      'extension/content.js',
      'extension/content.css',
      'extension/popup.html',
      'extension/popup.js',
      'extension-firefox/manifest.json',
      'extension-firefox/background.js',
      'extension-firefox/shared.js',
      'extension-firefox/content.js',
      'extension-firefox/content.css',
      'extension-firefox/popup.html',
      'extension-firefox/popup.js',
      'test/media-utils.test.js',
      'test/loopback-security.test.js',
      'test/ffmpeg-integration.test.js',
      'test/ui-fx.test.js',
      'test/cross-wiring.test.js',
    ];
    for (const rel of crlfFiles) {
      const txt = read(rel);
      const loneLf = txt.replace(/\r\n/g, '').includes('\n');
      assert.equal(loneLf, false, `File ${rel} contains bare LF line endings`);
    }
  });

  it('wires every static DOM id lookup in renderer.js and ui-fx.js to index.html', () => {
    const html = read('index.html');
    const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

    const missing = [];
    for (const rel of ['renderer.js', 'ui-fx.js']) {
      const src = read(rel);
      for (const m of src.matchAll(/(?:getElementById|byId)\(\s*'([a-z0-9-]+)'\s*\)/gi)) {
        if (!htmlIds.has(m[1])) missing.push(`${rel}:#${m[1]}`);
      }
      for (const m of src.matchAll(/\$\(\s*'#([a-z0-9-]+)'\s*\)/gi)) {
        if (!htmlIds.has(m[1])) missing.push(`${rel}:#${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('defines every static SVG icon symbol used in index.html, renderer.js, and ui-fx.js', () => {
    const html = read('index.html');
    const symbols = new Set([...html.matchAll(/<symbol\s+id="i-([^"]+)"/g)].map((m) => m[1]));

    const missing = [];
    for (const m of html.matchAll(/href="#i-([a-z0-9-]+)"/g)) {
      if (!symbols.has(m[1])) missing.push(`index.html:i-${m[1]}`);
    }
    for (const m of read('renderer.js').matchAll(/ICO\(\s*'([a-z0-9-]+)'/g)) {
      if (!symbols.has(m[1])) missing.push(`renderer.js:i-${m[1]}`);
    }
    for (const m of read('ui-fx.js').matchAll(/mkIcon\(\s*'([a-z0-9-]+)'/g)) {
      if (!symbols.has(m[1])) missing.push(`ui-fx.js:i-${m[1]}`);
    }
    assert.deepEqual(missing, []);
  });

  it('matches every IPC channel exposed in preload.js to handlers/events in main.js', () => {
    const preload = read('preload.js');
    const main = read('main.js');

    const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));
    const sent = new Set([...main.matchAll(/(?:webContents|event\.sender)\.send\(\s*'([^']+)'/g)].map((m) => m[1]));

    const missingInvoke = [];
    for (const m of preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) {
      if (!handled.has(m[1])) missingInvoke.push(m[1]);
    }
    const missingEvents = [];
    for (const m of preload.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)) {
      if (!sent.has(m[1])) missingEvents.push(m[1]);
    }
    assert.deepEqual(missingInvoke, []);
    assert.deepEqual(missingEvents, []);
  });

  it('keeps Chrome and Firefox extension manifests and loopback contracts in sync', () => {
    const extChrome = JSON.parse(read('extension/manifest.json'));
    const extFx = JSON.parse(read('extension-firefox/manifest.json'));

    assert.equal(extChrome.version, extFx.version);
    assert.ok(extChrome.permissions.includes('activeTab'));
    assert.ok(extFx.permissions.includes('activeTab'));
    assert.ok(extChrome.host_permissions.includes('http://127.0.0.1/*'));
    assert.ok(extFx.host_permissions.includes('http://127.0.0.1/*'));
    assert.ok(extFx.browser_specific_settings?.gecko?.id);

    const bgChrome = read('extension/background.js');
    const bgFx = read('extension-firefox/background.js');
    const main = read('main.js');
    for (const src of [bgChrome, bgFx, main]) {
      assert.ok(src.includes('47832'));
      assert.ok(src.includes('47835'));
    }
    assert.ok(bgChrome.includes("'X-GDL-Extension': '1'"));
    assert.ok(bgFx.includes("'X-GDL-Extension': '1'"));
  });
});
