'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...cls) => cls.forEach((c) => set.add(c)),
    remove: (...cls) => cls.forEach((c) => set.delete(c)),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) { set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) set.add(c); else set.delete(c);
      return !!force;
    },
    contains: (c) => set.has(c),
  };
}

function makeEl(id = '', { initialClasses = [] } = {}) {
  const attrs = new Map();
  const listeners = new Map();
  const styleMap = {};
  const style = new Proxy(styleMap, {
    get(target, prop) {
      if (prop === 'setProperty') return (k, v) => { target[k] = String(v); };
      return target[prop] ?? '';
    },
    set(target, prop, val) {
      target[prop] = String(val);
      return true;
    },
  });
  return {
    id,
    tagName: 'DIV',
    dataset: {},
    style,
    classList: makeClassList(initialClasses),
    children: [],
    options: [],
    value: '',
    checked: false,
    hidden: false,
    textContent: '',
    offsetLeft: 0,
    offsetWidth: 80,
    parentNode: null,
    parentElement: null,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    prepend: () => {},
    append: () => {},
    replaceChildren: (...nodes) => nodes,
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    dispatchEvent: (ev) => {
      for (const fn of listeners.get(ev.type) || []) fn(ev);
      return true;
    },
    setAttribute: (k, v) => {
      attrs.set(k, String(v));
      if (k === 'style') {
        const w = String(v).match(/width:\s*([\d.]+)%/);
        if (w) style.width = w[1] + '%';
      }
    },
    getAttribute: (k) => {
      if (k === 'style') {
        const parts = [];
        if (style.width) parts.push(`width: ${style.width}`);
        if (style.background) parts.push(`background: ${style.background}`);
        return parts.join('; ');
      }
      return attrs.get(k) ?? null;
    },
    toggleAttribute: (k, f) => { if (f) attrs.set(k, ''); else attrs.delete(k); },
    removeAttribute: (k) => attrs.delete(k),
    focus: () => {},
    click: () => {},
  };
}

describe('ui-fx.js browser harness integration', () => {
  it('loads lib/media-utils and ui-fx cleanly and tracks progress states', () => {
    const elements = new Map([
      ['dl-bar', makeEl('dl-bar')],
      ['dl-status', makeEl('dl-status')],
      ['dl-pct', makeEl('dl-pct')],
      ['dl-state', makeEl('dl-state')],
      ['dl-text', makeEl('dl-text')],
      ['conv-bar', makeEl('conv-bar')],
      ['conv-status', makeEl('conv-status')],
      ['conv-pct', makeEl('conv-pct')],
      ['conv-state', makeEl('conv-state')],
      ['conv-text', makeEl('conv-text')],
      ['dl-empty', makeEl('dl-empty')],
      ['url-input', makeEl('url-input')],
    ]);

    const observers = [];
    class StubMutationObserver {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() {}
      triggerAll() { this.cb([]); }
    }

    const storageBacking = new Map();
    const docEl = makeEl('html');
    const doc = {
      documentElement: docEl,
      hidden: false,
      fonts: { ready: Promise.resolve() },
      getElementById: (id) => elements.get(id) || null,
      getElementsByName: () => [],
      querySelector: (sel) => (sel.startsWith('#') ? elements.get(sel.slice(1)) || null : null),
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      createElementNS: () => makeEl(),
      addEventListener: () => {},
    };

    const sandbox = {
      window: null,
      document: doc,
      URL,
      URLSearchParams,
      localStorage: {
        getItem: (k) => (storageBacking.has(k) ? storageBacking.get(k) : null),
        setItem: (k, v) => storageBacking.set(k, String(v)),
      },
      matchMedia: () => ({ matches: false }),
      MutationObserver: StubMutationObserver,
      Event: class Event { constructor(t) { this.type = t; } },
      MouseEvent: class MouseEvent { constructor(t) { this.type = t; } },
      performance: { now: () => 1000 },
      setInterval: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      addEventListener: () => {},
      console,
    };
    sandbox.window = sandbox;

    const muSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'media-utils.js'), 'utf8');
    const fxSrc = fs.readFileSync(path.join(__dirname, '..', 'ui-fx.js'), 'utf8');
    vm.runInNewContext(muSrc, sandbox, { filename: 'lib/media-utils.js' });
    sandbox.detectSource = sandbox.window.__gdlMedia.detectSource;
    vm.runInNewContext(fxSrc, sandbox, { filename: 'ui-fx.js' });

    assert.equal(sandbox.window.__gdlMedia.detectSource('https://youtu.be/abc').type, 'youtube');

    const dlBar = elements.get('dl-bar');
    const dlBox = elements.get('dl-status');
    const dlState = elements.get('dl-state');
    const dlPct = elements.get('dl-pct');

    dlBar.style.width = '64%';
    observers.filter((o) => o.target === dlBar).forEach((o) => o.triggerAll());
    assert.equal(dlBox.dataset.state, 'busy');
    assert.equal(dlPct.textContent, '64');
    assert.equal(dlState.textContent, 'Baixando');

    dlBar.style.width = '100%';
    dlBar.style.background = 'var(--danger)';
    observers.filter((o) => o.target === dlBar).forEach((o) => o.triggerAll());
    assert.equal(dlBox.dataset.state, 'error');
    assert.equal(dlState.textContent, 'Erro');

    dlBar.style.background = 'var(--success)';
    observers.filter((o) => o.target === dlBar).forEach((o) => o.triggerAll());
    assert.equal(dlBox.dataset.state, 'done');
    assert.equal(dlState.textContent, 'Concluído');
  });
});
