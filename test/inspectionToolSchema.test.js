import assert from 'node:assert/strict';
import test from 'node:test';

import { executeClientToolCall } from '../src/services/aiTools.js';

test('inspection lookup reads the app’s stageId, stageName, and PASSED item schema', async () => {
  const result = await executeClientToolCall('get_municipal_inspections', {}, {
    inspectionsData: [{
      stageId: 'framing',
      stageName: 'Framing',
      totalItems: 2,
      isFullyPassed: true,
      items: [{ status: 'PASSED' }, { status: 'PASSED' }]
    }]
  });

  assert.equal(result.stages[0].title, 'Framing');
  assert.equal(result.stages[0].isPassed, true);
  assert.equal(result.stages[0].pendingItemsCount, 0);
});
