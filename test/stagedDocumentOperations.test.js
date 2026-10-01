import test from 'node:test';
import assert from 'node:assert/strict';

import {
  removeDraftById,
  removeDraftsById,
  updateDraftById,
  addDraft,
  saveDraftEdits,
  adjustDraftTimer,
  resetDraftTimer,
  updateDraftField
} from '../src/services/stagedDocumentOperations.js';

test('1. removeDraftById removes the specified draft without modifying other items', () => {
  const initial = [
    { id: 'draft_1', name: 'Invoice 1' },
    { id: 'draft_2', name: 'Invoice 2' },
    { id: 'draft_3', name: 'Invoice 3' }
  ];

  const result = removeDraftById(initial, 'draft_2');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(d => d.id), ['draft_1', 'draft_3']);
  assert.equal(initial.length, 3, 'Original list should be immutable');
});

test('2. Sequential removeDraftById calls simulate functional updater removing multiple drafts', () => {
  const initial = [
    { id: 'draft_closet_rods', name: 'Closet Rods' },
    { id: 'draft_fence', name: 'Fence Materials' },
    { id: 'draft_paint', name: 'Paint' }
  ];

  // Simulating functional updates in a loop: state = updater(state)
  let state = initial;
  state = removeDraftById(state, 'draft_closet_rods');
  state = removeDraftById(state, 'draft_fence');

  assert.equal(state.length, 1);
  assert.equal(state[0].id, 'draft_paint');
});

test('3. removeDraftsById removes multiple drafts in a single batch operation', () => {
  const initial = [
    { id: 'draft_1', name: 'Closet Rods' },
    { id: 'draft_2', name: 'Fence Materials' },
    { id: 'draft_3', name: 'Paint' }
  ];

  const result = removeDraftsById(initial, ['draft_1', 'draft_2']);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'draft_3');
});

test('4. Sequential updateDraftById calls preserve all driveFileIds and metadata', () => {
  const initial = [
    { id: 'draft_1', name: 'Closet Rods', driveFileId: null },
    { id: 'draft_2', name: 'Fence Materials', driveFileId: null }
  ];

  let state = initial;
  state = updateDraftById(state, 'draft_1', { driveFileId: 'drive_file_123', driveFileLink: 'https://drive.google.com/123' });
  state = updateDraftById(state, 'draft_2', { driveFileId: 'drive_file_456', driveFileLink: 'https://drive.google.com/456' });

  assert.equal(state.length, 2);
  assert.equal(state[0].driveFileId, 'drive_file_123');
  assert.equal(state[0].driveFileLink, 'https://drive.google.com/123');
  assert.equal(state[1].driveFileId, 'drive_file_456');
  assert.equal(state[1].driveFileLink, 'https://drive.google.com/456');
});

test('5. addDraft prepends new draft cleanly to the top of list', () => {
  const initial = [{ id: 'draft_old' }];
  const newDraft = { id: 'draft_new' };

  const result = addDraft(initial, newDraft);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'draft_new');
  assert.equal(result[1].id, 'draft_old');
});

test('6. saveDraftEdits updates metadata and base64 images for matching draft', () => {
  const initial = [
    { id: 'd1', metadata: { amount: 100 }, mainImageBase64: 'img1', secondaryImageBase64: null }
  ];

  const result = saveDraftEdits(initial, 'd1', {
    metadata: { amount: 250 },
    mainImageBase64: 'img1_updated',
    secondaryImageBase64: 'img2_new'
  });

  assert.equal(result[0].metadata.amount, 250);
  assert.equal(result[0].mainImageBase64, 'img1_updated');
  assert.equal(result[0].secondaryImageBase64, 'img2_new');
});

test('7. Timer helpers and updateDraftField update targets correctly', () => {
  const initial = [
    { id: 'd1', timerDuration: 60000, createdAt: 1000, metadata: { vendor: 'Old Vendor' } }
  ];

  // Adjust timer by +5 minutes
  const adjusted = adjustDraftTimer(initial, 'd1', 5);
  assert.equal(adjusted[0].timerDuration, 60000 + (5 * 60 * 1000));

  // Reset timer
  const reset = resetDraftTimer(initial, 'd1');
  assert.equal(reset[0].timerDuration, 3600000);
  assert.ok(reset[0].createdAt > 1000);

  // Update draft field
  const updatedField = updateDraftField(initial, 'd1', 'vendor', '84 Lumber');
  assert.equal(updatedField[0].metadata.vendor, '84 Lumber');
});
