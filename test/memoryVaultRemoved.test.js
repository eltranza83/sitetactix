import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const exists = (p) => existsSync(new URL(p, import.meta.url));

describe('v1.5.0 Field Brain and Memory Vault removed', () => {
  test('the Field Brain and Memory Vault screens are gone', () => {
    assert.equal(exists('../src/components/BuilderBrain.jsx'), false);
    assert.equal(exists('../src/components/MemoryVault.jsx'), false);
  });

  test('the app has no Field Brain menu entry, route or import', () => {
    const app = read('../src/App.jsx');
    assert.doesNotMatch(app, /Field Brain/);
    assert.doesNotMatch(app, /BuilderBrain/);
    assert.doesNotMatch(app, /activeTab === 'brain'/);
  });

  test('the remaining tabs are still there', () => {
    const app = read('../src/App.jsx');
    for (const tab of ['invoices', 'xray', 'dashboard', 'settings']) {
      assert.match(app, new RegExp(`activeTab === '${tab}'`));
    }
  });

  test('the buyer PDF generator is kept for the future Notion link', () => {
    assert.equal(exists('../src/services/buyerHandoverPdfGenerator.js'), true);
  });

  test('Settings engine switch says "New" without (beta)', () => {
    const src = read('../src/components/Settings.jsx');
    assert.doesNotMatch(src, /New \(beta\)/);
  });
});
