import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const svg = readFileSync(new URL('../public/logo-horizontal.svg', import.meta.url), 'utf8');

const getLetterPaths = () => {
  const group = svg.match(/<g class="main"[^>]*>([\s\S]*?)<\/g>/);
  assert.ok(group, 'logo should have a <g class="main"> letter group');
  const paths = [...group[1].matchAll(/<path\b[^>]*>/g)].map(([tag]) => {
    const d = tag.match(/\sd="([^"]*)"/)?.[1] || '';
    const x = Number(tag.match(/translate\(\s*([-\d.]+)/)?.[1]);
    return { d, x };
  });
  return paths.sort((a, b) => a.x - b.x);
};

test('logo wordmark has six letter paths', () => {
  const letters = getLetterPaths();
  assert.equal(letters.length, 6);
  letters.forEach(({ d, x }) => {
    assert.ok(Number.isFinite(x), 'each letter should be positioned with translate(x, y)');
    assert.ok(d.length > 0, 'each letter should have path data');
  });
});

test('logo "D" keeps its inner counter (outer outline + hole)', () => {
  const d = getLetterPaths()[1].d;
  const subpaths = (d.match(/M/g) || []).length;
  assert.ok(subpaths >= 2, `D should have at least 2 subpaths, found ${subpaths}`);
});
