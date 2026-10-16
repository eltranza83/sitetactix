// The REAL public/sw.js run in a simulated browser, plus guards for two navigation bug types.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ORIGIN = 'https://sitetactix.example';

function loadServiceWorker({ online, cached = {} }) {
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} }
  };
  const context = {
    self,
    URL,
    Response,
    console: { log: () => {} },
    caches: {
      open: async () => ({ addAll: async () => {} }),
      keys: async () => [],
      match: async (request) => cached[request.url]
    },
    fetch: async (request) => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(`network:${request.url}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('public/sw.js'), 'utf8'), context);

  return function request(url, { method = 'GET', mode = 'cors' } = {}) {
    let responded = null;
    listeners.fetch({
      request: { url, method, mode },
      respondWith: (promise) => { responded = Promise.resolve(promise); }
    });
    return responded;
  };
}

describe('service worker (real public/sw.js)', () => {
  test('Google, fonts and /api requests are left to the browser', () => {
    const request = loadServiceWorker({ online: true });
    assert.equal(request('https://fonts.gstatic.com/s/manrope.woff2'), null);
    assert.equal(request('https://www.googleapis.com/drive/v3/files'), null);
    assert.equal(request('https://firestore.googleapis.com/v1/x'), null);
    assert.equal(request(`${ORIGIN}/api/extract-document`), null);
    assert.equal(request(`${ORIGIN}/api/x`, { method: 'POST' }), null);
  });

  test('the app\'s own files come from the network when online', async () => {
    const request = loadServiceWorker({ online: true });
    const response = await request(`${ORIGIN}/assets/index.js`);
    assert.equal(await response.text(), `network:${ORIGIN}/assets/index.js`);
  });

  test('offline: a saved file is served, an unsaved one fails cleanly (no crash)', async () => {
    const saved = new Response('cached logo');
    const request = loadServiceWorker({ online: false, cached: { [`${ORIGIN}/logo.svg`]: saved } });

    assert.equal(await (await request(`${ORIGIN}/logo.svg`)).text(), 'cached logo');
    const missing = await request(`${ORIGIN}/assets/missing.js`);
    assert.ok(missing instanceof Response, 'must answer with a Response, never undefined');
    assert.equal(missing.type, 'error');
  });
});

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('navigation guards', () => {
  const files = sourceFiles(path.resolve('src'));

  test('every tab switch names a tab that exists', () => {
    const tabs = ['invoices', 'xray', 'dashboard', 'settings'];
    const bad = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, tab] of text.matchAll(/setActiveTab\('([^']+)'\)/g)) {
        if (!tabs.includes(tab)) bad.push(`${path.basename(file)}: ${tab}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the active project is only saved through persistActiveProject (which keeps its id)', () => {
    const bad = files
      .filter(file => !file.endsWith('appStorage.js'))
      .filter(file => /localStorage\.setItem\(\s*'jobscan_active_project'/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.basename(file));
    assert.deepEqual(bad, []);
  });

  test('the project menu closes on outside taps using classes that exist in the header', () => {
    const app = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
    const selector = app.match(/closest\?\.\('([^']+)'\)/)?.[1];
    assert.ok(selector, 'outside-tap handler not found');
    for (const className of selector.split(',').map(s => s.trim().replace(/^\./, ''))) {
      assert.ok(app.includes(`className="${className}"`), `${className} is not rendered in App.jsx`);
    }
  });
});
