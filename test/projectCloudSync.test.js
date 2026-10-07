import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectsConfigBlob
} from '../src/services/projectCloudSync.js';

test('createProjectsConfigBlob serializes project config as formatted JSON', async () => {
  const blob = createProjectsConfigBlob([{
    id: 'project-1',
    name: 'Lot 1',
    appsScriptUrl: 'https://script.example',
    appsScriptSecret: 'secret'
  }]);

  assert.equal(blob.type, 'application/json');
  assert.equal(
    await blob.text(),
    '[\n  {\n    "id": "project-1",\n    "name": "Lot 1"\n  }\n]'
  );
});
