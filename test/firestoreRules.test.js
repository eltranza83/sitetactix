import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, writeBatch, query, where } from 'firebase/firestore';

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe('Firestore Security Rules Emulator Test Suite', { skip: !hasEmulator ? 'Firestore emulator not running (FIRESTORE_EMULATOR_HOST unset)' : false }, () => {
  let testEnv;

  const PROJECT_ID = 'adepec-scanner-invites';
  const rulesPath = path.resolve('firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  // Test accounts
  const ADMIN_UID = 'admin-uid-1';
  const ADMIN_EMAIL = 'adepecgroup@gmail.com';

  const USER_A_UID = 'user-a-uid';
  const USER_A_EMAIL = 'user.a@example.com';

  const USER_B_UID = 'user-b-uid';
  const USER_B_EMAIL = 'user.b@example.com';

  const UNVERIFIED_UID = 'unverified-uid';
  const UNVERIFIED_EMAIL = 'unverified@example.com';

  const STRANGER_UID = 'stranger-uid';
  const STRANGER_EMAIL = 'stranger@example.com';

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: process.env.FIRESTORE_EMULATOR_HOST.split(':')[0],
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1], 10)
      }
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();

      // Seed baseline documents: admin directory and user_access
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        // Admin document
        await setDoc(doc(db, 'admins', ADMIN_EMAIL), { role: 'admin', createdAt: new Date().toISOString() });

        // User A and User B have user_access documents
        await setDoc(doc(db, 'user_access', USER_A_UID), {
          uid: USER_A_UID,
          email: USER_A_EMAIL,
          createdAt: new Date().toISOString()
        });
        await setDoc(doc(db, 'user_access', USER_B_UID), {
          uid: USER_B_UID,
          email: USER_B_EMAIL,
          createdAt: new Date().toISOString()
        });
      });
    }
  });

  function getContext(auth) {
    if (!auth) {
      return testEnv.unauthenticatedContext();
    }
    return testEnv.authenticatedContext(auth.uid, {
      email: auth.email,
      email_verified: auth.email_verified ?? true
    });
  }

  // 1. Unauthenticated access rejected
  it('1. Rejects unauthenticated requests across all protected collections', async () => {
    const unauthedDb = getContext(null).firestore();

    await assertFails(getDoc(doc(unauthedDb, 'projects', 'p1')));
    await assertFails(getDoc(doc(unauthedDb, 'memories', 'm1')));
    await assertFails(getDoc(doc(unauthedDb, 'user_preferences', 'pref1')));
    await assertFails(getDoc(doc(unauthedDb, 'purchasing_templates', 'tpl1', 'items', 'i1')));
    await assertFails(getDoc(doc(unauthedDb, 'admins', ADMIN_EMAIL)));
  });

  // 2. Unverified email rejected
  it('2. Rejects signed-in users whose email is unverified', async () => {
    const unverifiedDb = getContext({
      uid: UNVERIFIED_UID,
      email: UNVERIFIED_EMAIL,
      email_verified: false
    }).firestore();

    await assertFails(getDoc(doc(unverifiedDb, 'projects', 'p1')));
    await assertFails(getDoc(doc(unverifiedDb, 'memories', 'm1')));
    await assertFails(getDoc(doc(unverifiedDb, 'user_preferences', 'pref1')));
    await assertFails(getDoc(doc(unverifiedDb, 'purchasing_templates', 'tpl1', 'items', 'i1')));
  });

  // 3. User without user_access rejected
  it('3. Rejects verified users who lack a user_access document (hasAccess gate)', async () => {
    const strangerDb = getContext({
      uid: STRANGER_UID,
      email: STRANGER_EMAIL,
      email_verified: true
    }).firestore();

    await assertFails(getDoc(doc(strangerDb, 'projects', 'p1')));
    await assertFails(getDoc(doc(strangerDb, 'memories', 'm1')));
    await assertFails(getDoc(doc(strangerDb, 'user_preferences', 'pref1')));
    await assertFails(getDoc(doc(strangerDb, 'purchasing_templates', 'tpl1', 'items', 'i1')));
  });

  // 4. User with user_access can manage their own data
  it('4. Allows user with user_access to create and read their own projects, memories, and preferences', async () => {
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();

    // Own Project
    await assertSucceeds(setDoc(doc(userADb, 'projects', 'project-a'), {
      id: 'project-a',
      ownerUid: USER_A_UID,
      name: 'Lot 12'
    }));
    await assertSucceeds(getDoc(doc(userADb, 'projects', 'project-a')));

    // Own Memory
    await assertSucceeds(setDoc(doc(userADb, 'memories', 'mem-a'), {
      id: 'mem-a',
      uid: USER_A_UID,
      text: 'Preferred dumpster vendor is WM.'
    }));
    await assertSucceeds(getDoc(doc(userADb, 'memories', 'mem-a')));

    // Own Preference
    await assertSucceeds(setDoc(doc(userADb, 'user_preferences', 'pref-a'), {
      id: 'pref-a',
      uid: USER_A_UID,
      preferenceStatement: 'Keep responses concise.'
    }));
    await assertSucceeds(getDoc(doc(userADb, 'user_preferences', 'pref-a')));
  });

  // 5. Cross-user isolation: User B cannot access User A's data
  it('5. Strictly blocks User B from reading, updating, or deleting User A memories and preferences', async () => {
    // Seed User A's data
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'memories', 'mem-a'), { uid: USER_A_UID, text: 'Secret note' });
      await setDoc(doc(db, 'user_preferences', 'pref-a'), { uid: USER_A_UID, preferenceStatement: 'Secret pref' });
    });

    const userBDb = getContext({ uid: USER_B_UID, email: USER_B_EMAIL }).firestore();

    // Read attempts
    await assertFails(getDoc(doc(userBDb, 'memories', 'mem-a')));
    await assertFails(getDoc(doc(userBDb, 'user_preferences', 'pref-a')));

    // Write attempts
    await assertFails(setDoc(doc(userBDb, 'memories', 'mem-a'), { uid: USER_B_UID, text: 'Tampered' }));
    await assertFails(setDoc(doc(userBDb, 'user_preferences', 'pref-a'), { uid: USER_B_UID, preferenceStatement: 'Tampered' }));
    await assertFails(deleteDoc(doc(userBDb, 'memories', 'mem-a')));
    await assertFails(deleteDoc(doc(userBDb, 'user_preferences', 'pref-a')));

    // User B cannot spoof User A's UID on create
    await assertFails(setDoc(doc(userBDb, 'memories', 'mem-spoof'), { uid: USER_A_UID, text: 'Spoofed' }));
    await assertFails(setDoc(doc(userBDb, 'user_preferences', 'pref-spoof'), { uid: USER_A_UID, preferenceStatement: 'Spoofed' }));
  });

  // 6. Zero admin override on user_preferences
  it('6. Blocks admin from reading or tampering with another user preferences', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'user_preferences', 'pref-a'), { uid: USER_A_UID, preferenceStatement: 'Private style' });
    });

    const adminDb = getContext({ uid: ADMIN_UID, email: ADMIN_EMAIL }).firestore();
    await assertFails(getDoc(doc(adminDb, 'user_preferences', 'pref-a')));
    await assertFails(updateDoc(doc(adminDb, 'user_preferences', 'pref-a'), { preferenceStatement: 'Overridden' }));
    await assertFails(deleteDoc(doc(adminDb, 'user_preferences', 'pref-a')));
  });

  // 7. Owner vs. Member permissions on projects
  it('7. Member in memberUids can read project and subcollections, but cannot update or delete project', async () => {
    // Seed project owned by User A with User B as member
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'projects', 'collab-proj'), {
        id: 'collab-proj',
        ownerUid: USER_A_UID,
        memberUids: [USER_B_UID],
        name: 'Shared Lot 55'
      });
      await setDoc(doc(db, 'projects', 'collab-proj', 'purchasing_items', 'item-1'), {
        name: '2x4 Lumber',
        cost: 450
      });
      await setDoc(doc(db, 'projects', 'collab-proj', 'finishes', 'finish-1'), {
        name: 'Sherwin Williams Alabaster'
      });
    });

    const userBDb = getContext({ uid: USER_B_UID, email: USER_B_EMAIL }).firestore();

    // Member CAN read project and subcollections
    await assertSucceeds(getDoc(doc(userBDb, 'projects', 'collab-proj')));
    await assertSucceeds(getDoc(doc(userBDb, 'projects', 'collab-proj', 'purchasing_items', 'item-1')));
    await assertSucceeds(getDoc(doc(userBDb, 'projects', 'collab-proj', 'finishes', 'finish-1')));

    // Member CANNOT update or delete the project (only owner can)
    await assertFails(updateDoc(doc(userBDb, 'projects', 'collab-proj'), { name: 'Renamed by Member' }));
    await assertFails(deleteDoc(doc(userBDb, 'projects', 'collab-proj')));

    // Owner CAN update and delete
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();
    await assertSucceeds(updateDoc(doc(userADb, 'projects', 'collab-proj'), { name: 'Renamed by Owner' }));
  });

  // 8. Admin privileges: purchasing_templates and user_access listing
  it('8. Allows admin to manage purchasing_templates and list user_access, while regular users cannot', async () => {
    const adminDb = getContext({ uid: ADMIN_UID, email: ADMIN_EMAIL }).firestore();
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();

    // Regular user can read templates, but cannot write
    await assertSucceeds(getDoc(doc(userADb, 'purchasing_templates', 'master', 'items', 'i1')));
    await assertFails(setDoc(doc(userADb, 'purchasing_templates', 'master', 'items', 'i1'), { name: 'Custom' }));

    // Admin can write to templates
    await assertSucceeds(setDoc(doc(adminDb, 'purchasing_templates', 'master', 'items', 'i1'), { name: 'Master Framing' }));

    // Admin can list user_access; regular user cannot
    await assertSucceeds(getDocs(collection(adminDb, 'user_access')));
    await assertFails(getDocs(collection(userADb, 'user_access')));
  });

  // 9. Atomic invite claiming workflow
  it('9. Allows a verified user claiming an invite in a transaction to claim invite and create user_access', async () => {
    const CLAIMER_UID = 'claimer-uid';
    const CLAIMER_EMAIL = 'claimer@example.com';
    const INVITE_CODE = 'INVITE-TEST-99';

    // Seed available invite
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'invites', INVITE_CODE), {
        code: INVITE_CODE,
        used: false,
        usedAt: null,
        claimedByUid: null,
        claimedByEmail: null
      });
    });

    const claimerDb = getContext({ uid: CLAIMER_UID, email: CLAIMER_EMAIL }).firestore();

    // Execute atomic batch simulating InviteScreen claim transaction
    const batch = writeBatch(claimerDb);
    batch.update(doc(claimerDb, 'invites', INVITE_CODE), {
      used: true,
      usedAt: new Date().toISOString(),
      claimedByUid: CLAIMER_UID,
      claimedByEmail: CLAIMER_EMAIL
    });
    batch.set(doc(claimerDb, 'user_access', CLAIMER_UID), {
      uid: CLAIMER_UID,
      email: CLAIMER_EMAIL,
      sourceInviteId: INVITE_CODE,
      createdAt: new Date().toISOString()
    });

    await assertSucceeds(batch.commit());
  });

  // 10. No forging access without a valid invite
  it('10. Blocks a user from forging user_access without a valid corresponding invite claim', async () => {
    const FORGER_UID = 'forger-uid';
    const FORGER_EMAIL = 'forger@example.com';

    const forgerDb = getContext({ uid: FORGER_UID, email: FORGER_EMAIL }).firestore();

    // Attempt to directly create user_access without valid invite getAfter
    await assertFails(setDoc(doc(forgerDb, 'user_access', FORGER_UID), {
      uid: FORGER_UID,
      email: FORGER_EMAIL,
      sourceInviteId: 'NON-EXISTENT-INVITE',
      createdAt: new Date().toISOString()
    }));
  });

  // 11. Project invites authorization
  it('11. Only project owner can create project_invites; invited email can read', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'projects', 'owner-proj'), {
        id: 'owner-proj',
        ownerUid: USER_A_UID,
        name: 'Lot 10'
      });
    });

    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();
    const userBDb = getContext({ uid: USER_B_UID, email: USER_B_EMAIL }).firestore();

    // User A (owner) creates invite with invitedByUid == USER_A_UID -> succeeds
    await assertSucceeds(setDoc(doc(userADb, 'project_invites', 'inv-1'), {
      projectId: 'owner-proj',
      invitedByUid: USER_A_UID,
      invitedEmail: USER_B_EMAIL
    }));

    // User B (non-owner) attempts to create invite for User A's project -> fails
    await assertFails(setDoc(doc(userBDb, 'project_invites', 'inv-2'), {
      projectId: 'owner-proj',
      invitedByUid: USER_B_UID,
      invitedEmail: 'someone@example.com'
    }));

    // User B (invited email) can read the invite
    await assertSucceeds(getDoc(doc(userBDb, 'project_invites', 'inv-1')));
  });

  // 12. Multi-device preference sync & anti-resurrection
  it('12. Deleted preference on Device 1 is deleted in Firestore and never resurrected by Device 2', async () => {
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();

    // 1. Device 1 creates a preference in Firestore
    const prefId = 'pref-multi-device-1';
    await assertSucceeds(setDoc(doc(userADb, 'user_preferences', prefId), {
      id: prefId,
      uid: USER_A_UID,
      preferenceStatement: 'Always send summaries by text',
      status: 'active',
      updatedAt: new Date().toISOString()
    }));

    // Verify it exists in Firestore via scoped query
    const q = query(collection(userADb, 'user_preferences'), where('uid', '==', USER_A_UID));
    const preDeleteSnap = await assertSucceeds(getDocs(q));
    assert.equal(preDeleteSnap.docs.some(d => d.id === prefId), true);

    // 2. Device 1 deletes the preference from Firestore
    await assertSucceeds(deleteDoc(doc(userADb, 'user_preferences', prefId)));

    // 3. Device 2 reads cloud state with the scoped query: deleted document is absent
    const postDeleteSnap = await assertSucceeds(getDocs(q));
    assert.equal(postDeleteSnap.docs.some(d => d.id === prefId), false, 'Deleted preference must not exist in cloud query for Device 2');
  });

  // 13. Calendar preference storage & permissions
  it('13. Non-existent calendar preference returns permission-denied on get; owner can create/read, non-owner cannot', async () => {
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();
    const userBDb = getContext({ uid: USER_B_UID, email: USER_B_EMAIL }).firestore();
    const calDocRef = doc(userADb, 'user_preferences', `calendar_${USER_A_UID}`);
    const userBCalDocRef = doc(userBDb, 'user_preferences', `calendar_${USER_A_UID}`);

    // 1. Reading a non-existent document fails with permission-denied because resource.data is null
    await assertFails(getDoc(calDocRef));

    // 2. Owner can create the calendar preference with their uid
    await assertSucceeds(setDoc(calDocRef, {
      uid: USER_A_UID,
      calendarId: 'cal-lot3-reminders-id',
      updatedAt: new Date().toISOString()
    }));

    // 3. Owner can read their existing calendar preference
    await assertSucceeds(getDoc(calDocRef));

    // 4. Non-owner (User B) cannot read User A's calendar preference
    await assertFails(getDoc(userBCalDocRef));

    // 5. Non-owner (User B) cannot overwrite or update User A's calendar preference
    await assertFails(setDoc(userBCalDocRef, {
      uid: USER_B_UID,
      calendarId: 'malicious-cal-id',
      updatedAt: new Date().toISOString()
    }));
  });
});


