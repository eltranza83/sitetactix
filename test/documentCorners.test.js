import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDetectedCorners, parseTextDirection, rotationForTextDirection } from '../src/services/documentCorners.js';
import { generateDocumentCorners, DOCUMENT_CORNERS_PROMPT } from '../api/_lib/document-corners.js';

const goodCorners = [
  { x: 200, y: 100 },
  { x: 800, y: 120 },
  { x: 780, y: 900 },
  { x: 220, y: 880 }
];

describe('parseDetectedCorners', () => {
  test('turns four clockwise corners into 0-1 points', () => {
    const points = parseDetectedCorners({ found: true, corners: goodCorners });
    assert.equal(points.length, 4);
    assert.deepEqual(points[0], { x: 0.2, y: 0.1 });
    assert.deepEqual(points[2], { x: 0.78, y: 0.9 });
  });

  test('a sideways document still works when its first corner is not the photo\'s top-left', () => {
    // Same paper, rotated a quarter turn: still clockwise, just starting at another corner
    const rotated = [goodCorners[3], goodCorners[0], goodCorners[1], goodCorners[2]];
    assert.equal(parseDetectedCorners({ found: true, corners: rotated }).length, 4);
  });

  test('rejects not-found, wrong counts and junk', () => {
    assert.equal(parseDetectedCorners(null), null);
    assert.equal(parseDetectedCorners({ found: false, corners: goodCorners }), null);
    assert.equal(parseDetectedCorners({ found: true, corners: goodCorners.slice(0, 3) }), null);
    assert.equal(parseDetectedCorners({ found: true, corners: [...goodCorners.slice(0, 3), { x: 'a', y: 5 }] }), null);
  });

  test('rejects counter-clockwise, twisted and tiny shapes', () => {
    assert.equal(parseDetectedCorners({ found: true, corners: [...goodCorners].reverse() }), null);
    const twisted = [goodCorners[0], goodCorners[2], goodCorners[1], goodCorners[3]];
    assert.equal(parseDetectedCorners({ found: true, corners: twisted }), null);
    const tiny = [{ x: 500, y: 500 }, { x: 560, y: 500 }, { x: 560, y: 560 }, { x: 500, y: 560 }];
    assert.equal(parseDetectedCorners({ found: true, corners: tiny }), null);
  });

  test('keeps points inside the photo', () => {
    const points = parseDetectedCorners({
      found: true,
      corners: [{ x: -20, y: -20 }, { x: 1100, y: 0 }, { x: 1100, y: 1100 }, { x: 0, y: 1000 }]
    });
    assert.ok(points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  });
});

describe('generateDocumentCorners', () => {
  const reply = (body) => async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: typeof body === 'string' ? body : JSON.stringify(body) }] } }] })
  });

  test('returns what the model found', async () => {
    const result = await generateDocumentCorners({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      apiKey: 'test-key',
      fetchImpl: reply({ found: true, corners: goodCorners })
    });
    assert.equal(result.found, true);
    assert.equal(result.corners.length, 4);
  });

  test('an unreadable answer means "not found", not an error', async () => {
    const result = await generateDocumentCorners({
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      apiKey: 'test-key',
      fetchImpl: reply('not json at all')
    });
    assert.deepEqual(result, { found: false, textDirection: 'upright', corners: [] });
  });

  test('the key goes in the header, never in the URL', async () => {
    let seen = null;
    await generateDocumentCorners({
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      apiKey: 'SECRET_TEST_KEY',
      fetchImpl: async (url, options) => {
        seen = { url, options };
        return reply({ found: false, corners: [] })();
      }
    });
    assert.ok(!String(seen.url).includes('SECRET_TEST_KEY'));
    assert.equal(seen.options.headers['x-goog-api-key'], 'SECRET_TEST_KEY');
  });

  test('the prompt asks for the document\'s own top-left so sideways photos come out upright', () => {
    assert.ok(DOCUMENT_CORNERS_PROMPT.includes('reads_top_to_bottom'));
    assert.ok(DOCUMENT_CORNERS_PROMPT.includes('clockwise'));
  });
});

describe('turning a sideways photo upright', () => {
  test('text that reads top-to-bottom is turned back a quarter turn counter-clockwise', () => {
    assert.equal(rotationForTextDirection('reads_top_to_bottom'), 270);
    assert.equal(rotationForTextDirection('reads_bottom_to_top'), 90);
    assert.equal(rotationForTextDirection('upside_down'), 180);
    assert.equal(rotationForTextDirection('upright'), 0);
  });

  test('anything unexpected counts as upright and is not rotated', () => {
    assert.equal(parseTextDirection({ textDirection: 'sideways?' }), 'upright');
    assert.equal(parseTextDirection(null), 'upright');
    assert.equal(rotationForTextDirection(undefined), 0);
  });

  test('the model answer is passed through', async () => {
    const result = await generateDocumentCorners({
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      apiKey: 'test-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, textDirection: 'reads_top_to_bottom', corners: goodCorners }) }] } }] })
      })
    });
    assert.equal(result.textDirection, 'reads_top_to_bottom');
    assert.equal(parseTextDirection(result), 'reads_top_to_bottom');
  });
});
