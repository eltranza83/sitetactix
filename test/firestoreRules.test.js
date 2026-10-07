import { describe, it, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, writeBatch } from 'firebase/firestore';

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
  });

  // 3. User without user_access rejected
  it('3. Rejects verified users who lack a user_access document (hasAccess gate)', async () => {
    const strangerDb = getContext({
      uid: STRANGER_UID,
      email: STRANGER_EMAIL,
      email_verified: true
    }).firestore();

    await assertFails(getDoc(doc(strangerDb, 'projects', 'p1')));
  });

  // 4. User with user_access can manage their own data
  it('4. Allows user with user_access to create and read their own projects', async () => {
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();

    // Own Project
    await assertSucceeds(setDoc(doc(userADb, 'projects', 'project-a'), {
      id: 'project-a',
      ownerUid: USER_A_UID,
      name: 'Lot 12'
    }));
    await assertSucceeds(getDoc(doc(userADb, 'projects', 'project-a')));

  });

  // 7. Owner vs. Member permissions on projects
  it('7. Member in memberUids can read the project, but cannot update or delete it', async () => {
    // Seed project owned by User A with User B as member
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'projects', 'collab-proj'), {
        id: 'collab-proj',
        ownerUid: USER_A_UID,
        memberUids: [USER_B_UID],
        name: 'Shared Lot 55'
      });
    });

    const userBDb = getContext({ uid: USER_B_UID, email: USER_B_EMAIL }).firestore();

    // Member CAN read the project
    await assertSucceeds(getDoc(doc(userBDb, 'projects', 'collab-proj')));

    // Member CANNOT update or delete the project (only owner can)
    await assertFails(updateDoc(doc(userBDb, 'projects', 'collab-proj'), { name: 'Renamed by Member' }));
    await assertFails(deleteDoc(doc(userBDb, 'projects', 'collab-proj')));

    // Owner CAN update and delete
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();
    await assertSucceeds(updateDoc(doc(userADb, 'projects', 'collab-proj'), { name: 'Renamed by Owner' }));
  });

  // 8. Admin privileges: user_access listing
  it('8. Allows admin to list user_access, while regular users cannot', async () => {
    const adminDb = getContext({ uid: ADMIN_UID, email: ADMIN_EMAIL }).firestore();
    const userADb = getContext({ uid: USER_A_UID, email: USER_A_EMAIL }).firestore();

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
});


