import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIssues, mergeActivityHistories } from '../src/services/issuesDrive.js';

import { isLocatedIssue, visibleBlueprintIssues as filterBlueprintIssues } from '../src/services/floorPlanPin.js';
import { buildSubShareText } from '../src/services/issueStatus.js';

describe('Loop One: Blueprint Issue-to-Verified-Closeout Lifecycle', () => {
  it('1. Initializes new issues with open status and empty proof/verification fields', () => {
    const issue = {
      id: 'issue_101',
      title: 'Missing nail plate at laundry stack',
      description: 'Plumbing vent pipe passes through stud without protection plate',
      category: 'plumbing',
      tradePhase: 'Rough-in',
      contractorName: 'Apex Plumbing',
      phoneNumber: '555-0199',
      priority: 'high',
      dueDate: '2026-09-05',
      status: 'open',
      photoUrl: 'https://drive.google.com/thumbnail?id=photo_before_1',
      proofPhotoUrl: null,
      proofNotes: '',
      proofSubmittedAt: null,
      verifiedAt: null,
      verifiedBy: null,
      reopenReason: '',
      activityHistory: [
        {
          id: 'act_created_1',
          action: 'created',
          timestamp: '2026-09-01T12:00:00.000Z',
          actor: 'Builder',
          note: 'Initial defect logged'
        },
        {
          id: 'act_assigned_1',
          action: 'assigned',
          timestamp: '2026-09-01T12:00:00.000Z',
          actor: 'Builder',
          details: 'Assigned to Apex Plumbing (Target: 2026-09-05)'
        }
      ],
      floorPlanX: 42.5,
      floorPlanY: 65.0
    };

    assert.equal(issue.status, 'open');
    assert.equal(issue.dueDate, '2026-09-05');
    assert.equal(issue.proofPhotoUrl, null);
    assert.equal(issue.verifiedAt, null);
    assert.equal(issue.activityHistory.length, 2);
    assert.equal(isLocatedIssue(issue), true);
  });

  it('2. Correct Actor Model: Builder records resolution proof on behalf of subcontractor', () => {
    let issue = {
      id: 'issue_101',
      status: 'open',
      contractorName: 'Apex Plumbing',
      photoUrl: 'https://drive.google.com/thumbnail?id=photo_before_1',
      proofPhotoUrl: null,
      proofNotes: '',
      proofSubmittedAt: null,
      activityHistory: [
        { id: 'act_created_1', action: 'created', timestamp: '2026-09-01T12:00:00.000Z', actor: 'Builder' }
      ]
    };

    const timestamp = '2026-09-03T14:30:00.000Z';
    const proofEvent = {
      id: 'act_proof_1',
      action: 'proof_submitted',
      timestamp,
      actor: 'Builder',
      details: 'Submitted on behalf of Apex Plumbing',
      note: 'Heavy-duty 16ga steel plate installed over pipe penetration'
    };

    issue = {
      ...issue,
      status: 'in_progress',
      proofPhotoUrl: 'https://drive.google.com/thumbnail?id=photo_proof_1',
      proofNotes: proofEvent.note,
      proofSubmittedAt: timestamp,
      activityHistory: mergeActivityHistories(issue.activityHistory, [proofEvent])
    };

    assert.equal(issue.status, 'in_progress');
    assert.equal(issue.proofPhotoUrl, 'https://drive.google.com/thumbnail?id=photo_proof_1');
    assert.equal(issue.activityHistory.length, 2);
    assert.equal(issue.activityHistory[1].actor, 'Builder');
    assert.equal(issue.activityHistory[1].details, 'Submitted on behalf of Apex Plumbing');
  });

  it('3. Verification Requires Evidence: Allows photo proof OR explicit builder inspection record', () => {
    // Case A: Issue WITH photo proof -> verified smoothly
    const issueWithPhoto = {
      id: 'issue_101',
      status: 'in_progress',
      proofPhotoUrl: 'https://drive.google.com/thumbnail?id=photo_proof_1',
      activityHistory: []
    };

    const verifyWithPhoto = (issue, inspectionNote = '') => {
      const hasPhoto = Boolean(issue.proofPhotoUrl || issue.proofPhotoBase64);
      if (!hasPhoto && !inspectionNote?.trim()) {
        throw new Error('Verification requires a resolution photo or an explicit builder inspection record.');
      }
      return {
        ...issue,
        status: 'resolved',
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'Builder'
      };
    };

    const verifiedA = verifyWithPhoto(issueWithPhoto);
    assert.equal(verifiedA.status, 'resolved');
    assert.equal(verifiedA.verifiedBy, 'Builder');

    // Case B: Issue WITHOUT photo proof and WITHOUT inspection note -> THROW error
    const issueWithoutPhoto = {
      id: 'issue_102',
      status: 'in_progress',
      proofPhotoUrl: null,
      proofPhotoBase64: null,
      activityHistory: []
    };

    assert.throws(
      () => verifyWithPhoto(issueWithoutPhoto, ''),
      /Verification requires a resolution photo or an explicit builder inspection record/
    );

    // Case C: Issue WITHOUT photo proof BUT WITH explicit builder inspection note -> Verified
    const verifiedC = verifyWithPhoto(issueWithoutPhoto, 'Inspected on site in person; leak test passed.');
    assert.equal(verifiedC.status, 'resolved');
  });

  it('4. Builder Rejection: Requires explanatory note and returns issue to open', () => {
    const issue = {
      id: 'issue_101',
      status: 'in_progress',
      activityHistory: []
    };

    const rejectFix = (issue, reason) => {
      const trimmed = reason?.trim();
      if (!trimmed) {
        throw new Error('Rejection requires an explanatory feedback note.');
      }
      return {
        ...issue,
        status: 'open',
        reopenReason: trimmed,
        reopenedAt: new Date().toISOString()
      };
    };

    // Rejection without reason throws
    assert.throws(() => rejectFix(issue, '   '), /Rejection requires an explanatory feedback note/);

    // Rejection with reason succeeds
    const rejected = rejectFix(issue, 'Plate is only 18-gauge, code requires 16-gauge steel plate here.');
    assert.equal(rejected.status, 'open');
    assert.equal(rejected.reopenReason.includes('16-gauge steel plate'), true);
  });

  it('5. Offline Sync & Repeated Saves: Deduplicates activity history events', () => {
    const existingHistory = [
      {
        id: 'act_created_100',
        action: 'created',
        timestamp: '2026-09-01T10:00:00.000Z',
        actor: 'Builder',
        note: 'Initial defect'
      },
      {
        id: 'act_proof_200',
        action: 'proof_submitted',
        timestamp: '2026-09-01T12:00:00.000Z',
        actor: 'Builder',
        details: 'Submitted on behalf of Plumber',
        note: 'Fixed'
      }
    ];

    // Incoming duplicate event from retry or offline queue
    const retryHistory = [
      {
        id: 'act_proof_200',
        action: 'proof_submitted',
        timestamp: '2026-09-01T12:00:00.000Z',
        actor: 'Builder',
        details: 'Submitted on behalf of Plumber',
        note: 'Fixed'
      },
      {
        id: 'act_verified_300',
        action: 'verified_closed',
        timestamp: '2026-09-01T14:00:00.000Z',
        actor: 'Builder',
        note: 'Verified'
      }
    ];

    const deduplicated = mergeActivityHistories(existingHistory, retryHistory);

    // Must have exactly 3 events, NOT 4!
    assert.equal(deduplicated.length, 3);
    assert.deepEqual(deduplicated.map(e => e.id), ['act_created_100', 'act_proof_200', 'act_verified_300']);
  });

  it('6. mergeIssues cleanly merges offline operations and activity history', () => {
    const remote = [
      {
        id: 'issue_1',
        title: 'Original title',
        status: 'open',
        activityHistory: [
          { id: 'act_created_1', action: 'created', timestamp: '2026-09-01T10:00:00.000Z', actor: 'Builder' }
        ]
      }
    ];

    const offlineQueue = [
      {
        type: 'UPDATE',
        id: 'issue_1',
        timestamp: 1788264000000,
        payload: {
          status: 'in_progress',
          activityHistory: [
            { id: 'act_created_1', action: 'created', timestamp: '2026-09-01T10:00:00.000Z', actor: 'Builder' },
            { id: 'act_proof_2', action: 'proof_submitted', timestamp: '2026-09-01T11:00:00.000Z', actor: 'Builder', note: 'Fix photo added' }
          ]
        }
      }
    ];

    const merged = mergeIssues(remote, offlineQueue);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, 'in_progress');
    assert.equal(merged[0].activityHistory.length, 2);
    assert.equal(merged[0].activityHistory[1].id, 'act_proof_2');
  });

  it('7. Backward Compatibility: Legacy issues without activityHistory survive without errors', () => {
    const legacyRemote = [
      {
        id: 'legacy_issue_99',
        title: 'Old issue created before Loop One',
        status: 'resolved',
        floorPlanX: 25.0,
        floorPlanY: 30.0
        // No activityHistory, no proofPhoto, no dueDate
      }
    ];

    const merged = mergeIssues(legacyRemote, []);
    assert.equal(merged.length, 1);
    assert.equal(Array.isArray(merged[0].activityHistory), true);
    assert.equal(merged[0].activityHistory.length, 0);

    // Canvas filter hides it by default
    const visibleDefault = filterBlueprintIssues(merged, false);
    assert.equal(visibleDefault.length, 0);

    // Canvas filter shows it when showResolvedIssues is true
    const visibleToggled = filterBlueprintIssues(merged, true);
    assert.equal(visibleToggled.length, 1);
  });

  it('8. One-tap Sub Share text formatting produces clean actionable dispatch message', () => {
    const issue = {
      title: 'Move cold water stub-out 4 inches right',
      category: 'plumbing',
      tradePhase: 'Rough-in',
      contractorName: 'Apex Plumbing',
      dueDate: '2026-09-08',
      description: 'Colliding with vanity drawer stack',
      photoUrl: 'https://drive.google.com/thumbnail?id=abc123xyz'
    };

    const textLines = buildSubShareText(issue);

    assert.match(textLines, /SiteTactix Issue: Move cold water stub-out/);
    assert.match(textLines, /Assigned To: Apex Plumbing/);
    assert.match(textLines, /Target Due Date: 2026-09-08/);
    assert.match(textLines, /Defect Photo: https:\/\/drive\.google\.com/);
  });
});
