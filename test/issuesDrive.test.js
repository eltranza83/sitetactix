import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createSerialSyncRunner,
  filterRemainingOfflineQueue,
  mergeIssues,
  removeLegacyCachedIssuePhotos,
  uploadQueuedIssuePhotos
} from '../src/services/issuesDrive.js';

test('mergeIssues applies CREATE operations correctly', () => {
  const remoteIssues = [];
  const offlineOps = [
    {
      type: 'CREATE',
      id: 'issue_1',
      payload: {
        title: 'Leak under sink',
        category: 'Mechanicals_&_Utilities',
        priority: 'high',
        status: 'open',
        phoneNumber: '5550100',
        floorPlanX: 42.5,
        floorPlanY: 18.25
      },
      timestamp: 1720720485923
    }
  ];

  const merged = mergeIssues(remoteIssues, offlineOps);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'issue_1');
  assert.equal(merged[0].title, 'Leak under sink');
  assert.equal(merged[0].status, 'open');
  assert.equal(merged[0].floorPlanX, 42.5);
  assert.equal(merged[0].floorPlanY, 18.25);
  assert.equal(merged[0].deletedAt, null);
  assert.ok(merged[0].createdAt);
  assert.ok(merged[0].updatedAt);
});

test('mergeIssues applies UPDATE_STATUS operations to existing issues', () => {
  const remoteIssues = [
    {
      id: 'issue_1',
      title: 'Leak under sink',
      category: 'Mechanicals_&_Utilities',
      priority: 'high',
      status: 'open',
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
      deletedAt: null
    }
  ];

  const offlineOps = [
    {
      type: 'UPDATE_STATUS',
      id: 'issue_1',
      payload: { status: 'in_progress' },
      timestamp: 1720720500000
    }
  ];

  const merged = mergeIssues(remoteIssues, offlineOps);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'in_progress');
  assert.equal(merged[0].updatedAt, new Date(1720720500000).toISOString());
});

test('mergeIssues applies UPDATE operations while preserving issue identity', () => {
  const remoteIssues = [
    {
      id: 'issue_1',
      title: 'Leak under sink',
      category: 'Mechanicals_&_Utilities',
      priority: 'high',
      status: 'open',
      floorPlanX: 42.5,
      floorPlanY: 18.25,
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
      deletedAt: null
    }
  ];

  const offlineOps = [
    {
      type: 'UPDATE',
      id: 'issue_1',
      payload: {
        title: 'Leak under kitchen sink',
        category: 'Mechanicals_&_Utilities',
        tradePhase: 'Plumbing Rough-In',
        priority: 'medium',
        photoUrl: 'https://example.com/photo.jpg',
        floorPlanX: 42.5,
        floorPlanY: 18.25
      },
      timestamp: 1720720550000
    }
  ];

  const merged = mergeIssues(remoteIssues, offlineOps);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'issue_1');
  assert.equal(merged[0].title, 'Leak under kitchen sink');
  assert.equal(merged[0].priority, 'medium');
  assert.equal(merged[0].photoUrl, 'https://example.com/photo.jpg');
  assert.equal(merged[0].floorPlanX, 42.5);
  assert.equal(merged[0].floorPlanY, 18.25);
  assert.equal(merged[0].createdAt, '2026-07-11T12:00:00.000Z');
  assert.equal(merged[0].updatedAt, new Date(1720720550000).toISOString());
});

test('mergeIssues applies SOFT_DELETE operations by setting deletedAt', () => {
  const remoteIssues = [
    {
      id: 'issue_1',
      title: 'Leak under sink',
      category: 'Mechanicals_&_Utilities',
      priority: 'high',
      status: 'open',
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
      deletedAt: null
    }
  ];

  const offlineOps = [
    {
      type: 'SOFT_DELETE',
      id: 'issue_1',
      timestamp: 1720720600000
    }
  ];

  const merged = mergeIssues(remoteIssues, offlineOps);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deletedAt, new Date(1720720600000).toISOString());
  assert.equal(merged[0].updatedAt, new Date(1720720600000).toISOString());
});

test('mergeIssues applies multiple operations in chronological order', () => {
  const remoteIssues = [];
  const offlineOps = [
    {
      type: 'CREATE',
      id: 'issue_1',
      payload: { title: 'Stud missing', status: 'open', category: 'Framing_&_Lumber' },
      timestamp: 1000
    },
    {
      type: 'UPDATE_STATUS',
      id: 'issue_1',
      payload: { status: 'in_progress' },
      timestamp: 2000
    },
    {
      type: 'SOFT_DELETE',
      id: 'issue_1',
      timestamp: 3000
    }
  ];

  const merged = mergeIssues(remoteIssues, offlineOps);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'in_progress');
  assert.equal(merged[0].deletedAt, new Date(3000).toISOString());
});

test('removeLegacyCachedIssuePhotos removes old write-only jobscan_photo_* keys and keeps everything else', () => {
  const data = new Map([
    ['jobscan_photo_issue_1', 'data:image/jpeg;base64,AAAA'],
    ['jobscan_photo_issue_2', 'data:image/jpeg;base64,BBBB'],
    ['jobscan_staged_items', '[]'],
    ['jobscan_projects', '[]']
  ]);
  const storage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] || null,
    getItem: (k) => data.get(k) ?? null,
    removeItem: (k) => data.delete(k)
  };

  const removed = removeLegacyCachedIssuePhotos(storage);
  assert.equal(removed, 2);
  assert.equal(data.has('jobscan_photo_issue_1'), false);
  assert.equal(data.has('jobscan_photo_issue_2'), false);
  assert.equal(data.get('jobscan_staged_items'), '[]');
  assert.equal(data.get('jobscan_projects'), '[]');

  const useIssuesSource = fs.readFileSync(new URL('../src/hooks/useIssues.js', import.meta.url), 'utf8');
  assert.doesNotMatch(useIssuesSource, /jobscan_photo_/);
});

test('uploadQueuedIssuePhotos uploads defect and proof photos, strips base64, and stops on upload failure', async () => {
  const sampleBase64 = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;
  const queue = [
    {
      type: 'CREATE',
      id: 'issue_1',
      timestamp: 1000,
      payload: { title: 'Defect 1', photoBase64: sampleBase64, proofPhotoBase64: null }
    },
    {
      type: 'UPDATE',
      id: 'issue_1',
      timestamp: 2000,
      payload: { status: 'in_progress', proofPhotoBase64: sampleBase64 }
    }
  ];

  const savedSnapshots = [];
  await uploadQueuedIssuePhotos('token', 'folder_1', queue, {
    onProgress: (q) => savedSnapshots.push(JSON.parse(JSON.stringify(q))),
    uploadDefect: async () => ({ id: 'drive_defect_1', url: 'https://drive.google.com/file/d/drive_defect_1/view' }),
    uploadProof: async () => ({ id: 'drive_proof_1', url: 'https://drive.google.com/file/d/drive_proof_1/view' })
  });

  assert.equal(savedSnapshots.length, 2);
  assert.equal(queue[0].payload.photoBase64, undefined);
  assert.equal(queue[0].payload.photoFileId, 'drive_defect_1');
  assert.equal(queue[1].payload.proofPhotoBase64, null);
  assert.equal(queue[1].payload.proofPhotoFileId, 'drive_proof_1');

  // If a photo upload fails mid-sync, it must throw so raw base64 is never merged into issues_data.json
  const failingQueue = [
    {
      type: 'CREATE',
      id: 'issue_2',
      timestamp: 3000,
      payload: { title: 'Defect 2', photoBase64: sampleBase64 }
    }
  ];
  await assert.rejects(
    uploadQueuedIssuePhotos('token', 'folder_1', failingQueue, {
      uploadDefect: async () => { throw new Error('Network dropped'); }
    }),
    /Network dropped/
  );
  // Base64 stays intact in the queued item so the next sync retries the upload
  assert.equal(failingQueue[0].payload.photoBase64, sampleBase64);
});

test('filterRemainingOfflineQueue removes only synced operations and preserves concurrent additions', () => {
  const syncedBatch = [
    { type: 'CREATE', id: 'issue_1', timestamp: 1000 },
    { type: 'UPDATE', id: 'issue_1', timestamp: 2000 }
  ];
  const currentQueue = [
    ...syncedBatch,
    { type: 'CREATE', id: 'issue_2', timestamp: 2500 }
  ];

  const remaining = filterRemainingOfflineQueue(currentQueue, syncedBatch);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'issue_2');
});

test('createSerialSyncRunner executes overlapping async tasks strictly in order and recovers after rejections', async () => {
  const runSerial = createSerialSyncRunner();
  const events = [];

  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });

  const p1 = runSerial(async () => {
    events.push('start-1');
    await firstGate;
    events.push('end-1');
    return 'ok-1';
  });

  const p2 = runSerial(async () => {
    events.push('start-2');
    throw new Error('boom-2');
  });

  const p3 = runSerial(async () => {
    events.push('start-3');
    return 'ok-3';
  });

  await Promise.resolve();
  assert.deepEqual(events, ['start-1']);

  releaseFirst();
  assert.equal(await p1, 'ok-1');
  await assert.rejects(p2, /boom-2/);
  assert.equal(await p3, 'ok-3');
  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'start-3']);
});
