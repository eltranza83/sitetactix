// v1.14.12: a failed read of the saved X-Ray pins or punch list must never look like an empty list
// (the next save would write over everything). Real Drive code on the fake Drive.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDrive } from './fakeDrive.js';
import { ensureXRayFolder } from '../src/services/googleDrive.js';
import { loadIssuesVault } from '../src/services/issuesDrive.js';
import { loadBlueprintVault } from '../src/services/blueprintDrive.js';

const savedIssues = { issues: [{ id: 'i1', title: 'Missing nail plate' }, { id: 'i2', title: 'Move stub-out' }], contacts: {} };
const savedPins = { blueprintFileId: 'plan', blueprintFileName: 'plan.png', pins: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] };
const contentReads = ({ method, search }) => method === 'GET' && String(search).includes('alt=media');

describe('saved lists in Drive are never read as empty by mistake', () => {
  let drive;
  let xRay;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    drive = createFakeDrive();
    globalThis.fetch = drive.fetch;
    xRay = await ensureXRayFolder('token', 'lot3');
    drive.add({ id: 'issues', name: 'issues_data.json', mimeType: 'application/json', parents: [xRay], content: JSON.stringify(savedIssues) });
    drive.add({ id: 'pins', name: 'blueprint_data.json', mimeType: 'application/json', parents: [xRay], content: JSON.stringify(savedPins) });
    drive.add({ id: 'plan', name: 'plan.png', mimeType: 'image/png', parents: [xRay], content: 'png bytes' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('normal loads return everything saved', async () => {
    assert.equal((await loadIssuesVault('token', 'lot3')).issues.length, 2);
    const plan = await loadBlueprintVault('token', 'lot3');
    assert.equal(plan.pins.length, 3);
    assert.ok(plan.blueprintBlob);
  });

  test('a failed punch list read stops instead of returning an empty list', async () => {
    drive.failRequests(contentReads);
    await assert.rejects(loadIssuesVault('token', 'lot3'));
  });

  test('a failed pin list read stops instead of returning no pins', async () => {
    drive.failRequests(({ method, path, search }) => contentReads({ method, search }) && path.endsWith('/pins'));
    await assert.rejects(loadBlueprintVault('token', 'lot3'));
  });

  test('a floor plan picture that fails to download stops the load too (pins are not thrown away)', async () => {
    drive.failRequests(({ method, path, search }) => contentReads({ method, search }) && path.endsWith('/plan'));
    await assert.rejects(loadBlueprintVault('token', 'lot3'));
  });

  test('a damaged list file stops with a clear message, never as empty', async () => {
    drive.files.get('issues').content = '{"issues": [ {"id": "i1"';
    await assert.rejects(loadIssuesVault('token', 'lot3'), /could not be read, so nothing was changed/);
  });

  test('an empty file (nothing saved yet) is fine', async () => {
    drive.files.get('issues').content = '';
    assert.deepEqual((await loadIssuesVault('token', 'lot3')).issues, []);
  });
});

test('every action that changes pins or the floor plan waits for a real load first', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/hooks/useBlueprintPinboard.js', import.meta.url), 'utf8');
  for (const action of ['handleUploadBlueprint', 'handleSavePin', 'handleDeletePin', 'handleResetBlueprint']) {
    const start = source.indexOf(`const ${action} = async`);
    assert.ok(start >= 0, `${action} not found`);
    const body = source.slice(start, source.indexOf('\n  };', start));
    assert.match(body, /if \(blockedUntilLoaded\(\)\) return;/, `${action} must check blockedUntilLoaded`);
  }
});

test('punch list saves go to the file just read, never a remembered one', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/hooks/useIssues.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /issuesDataFileId\b(?!: )/, 'no remembered punch list file id');
  assert.match(source, /const currentFileId = fileId;/);
});
