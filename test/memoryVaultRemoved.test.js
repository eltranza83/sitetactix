import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('v1.4.9 Memory Vault screen removed', () => {
  test('Field Brain has no Memory Vault tab, import or count', () => {
    const src = read('../src/components/BuilderBrain.jsx');
    assert.doesNotMatch(src, /MemoryVault/);
    assert.doesNotMatch(src, /Memory Vault/);
    assert.doesNotMatch(src, /memoryVaultCount/);
    assert.doesNotMatch(src, /setActiveSubTab\('vault'\)/);
  });

  test('the Memory Vault component file is gone', () => {
    assert.equal(existsSync(new URL('../src/components/MemoryVault.jsx', import.meta.url)), false);
  });

  test('the other Field Brain tabs are still there', () => {
    const src = read('../src/components/BuilderBrain.jsx');
    assert.match(src, /Finishes & Specs/);
    assert.match(src, /Phase Inspections/);
    assert.match(src, /setActiveSubTab\('specs'\)/);
  });

  test('Settings engine switch says "New" without (beta)', () => {
    const src = read('../src/components/Settings.jsx');
    assert.doesNotMatch(src, /New \(beta\)/);
    assert.match(src, /\bNew\b/);
  });
});
