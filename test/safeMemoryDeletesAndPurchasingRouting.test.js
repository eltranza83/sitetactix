import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchMemories,
  saveMemory,
  getMemories
} from '../src/services/memoryService.js';

import {
  PurchasingService,
  LocalStoragePurchasingAdapter
} from '../src/services/purchasingService.js';

import {
  askGeminiBrain,
  getAuthoritativeReadRoute,
  parsePurchasingRemoval,
  isPurchasingOrChecklistQuery,
  verifyActionExecutionClaims,
  guardAgainstInventedPurchasingList,
  getPendingConfirmationAction,
  setPendingConfirmationAction,
  clearPendingConfirmationAction,
  didCompatibleChangeToolSucceed
} from '../src/services/builderBrainService.js';

import { executeClientToolCall, clearIdempotencyCache } from '../src/services/aiTools.js';

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

describe('Safe Memory Deletes & Purchasing Routing Suite (v1.3.15)', () => {
  let mockStorage;
  let purchasingService;

  beforeEach(async () => {
    mockStorage = createMockLocalStorage();
    globalThis.localStorage = mockStorage;
    purchasingService = new PurchasingService(new LocalStoragePurchasingAdapter());
    clearPendingConfirmationAction();
    clearIdempotencyCache();
  });

  describe('1. Memory Shortcut Tightening & Purchasing Routing', () => {
    test('isPurchasingOrChecklistQuery identifies purchasing queries that must never hit memory shortcut', () => {
      assert.equal(isPurchasingOrChecklistQuery('remove the exhaust fans from the electrical purchasing list'), true);
      assert.equal(isPurchasingOrChecklistQuery('delete dimmer switches from purchasing checklist'), true);
      assert.equal(isPurchasingOrChecklistQuery('remove quartz from the list'), true);
      assert.equal(isPurchasingOrChecklistQuery('forget what i told you about the painter'), false);
      assert.equal(isPurchasingOrChecklistQuery('delete the note about drywall'), false);
    });

    test('"remove the exhaust fans from the electrical purchasing list" parses as purchasing removal, never memory', async () => {
      const parsed = parsePurchasingRemoval('remove the exhaust fans from the electrical purchasing list');
      assert.ok(parsed, 'Must parse as purchasing removal');
      assert.equal(parsed.item, 'exhaust fans');
      assert.equal(parsed.category, 'electrical');

      // Seed an item in purchasing
      await purchasingService.addItem('Lot 3', {
        itemName: 'exhaust fans',
        category: 'electrical',
        quantity: 2
      });

      // Save a memory that contains the word "purchasing" (mimicking the incident memory)
      const opRule = await saveMemory({
        text: 'STRICT OPERATIONAL RULE: Never extrapolate purchasing items or fixtures',
        projectId: 'Lot 3',
        source: 'user_explicit'
      });

      // Execute via askGeminiBrain
      const reply = await askGeminiBrain(
        'remove the exhaust fans from the electrical purchasing list',
        [],
        'Lot 3'
      );

      // Verify purchasing item was removed
      assert.ok(reply.text.includes("Removed 'exhaust fans' from Electrical Hardware Fixtures"));
      const remainingItems = await purchasingService.getItems('Lot 3');
      assert.equal(remainingItems.find(i => i.itemName.toLowerCase().includes('exhaust')), undefined);

      // Verify the memory was NOT deleted or modified!
      const activeMemories = await getMemories({ projectId: 'Lot 3' });
      const foundRule = activeMemories.find(m => m.id === opRule.id);
      assert.ok(foundRule, 'Operational rule memory must still be active and untouched!');
      assert.equal(foundRule.active, true);
    });
  });

  describe('2. Text Match Requirement in searchMemories (Zero Overlap Finds Nothing)', () => {
    test('Zero-word text match returns 0 results despite project match and importance bonuses', async () => {
      await saveMemory({
        text: 'The painter prefers Benjamin Moore Chantilly Lace paint',
        projectId: 'Lot 3',
        importance: 'critical'
      });

      // Query with zero overlapping words or tags
      const results = await searchMemories('unrelated plumbing valve', {
        projectId: 'Lot 3'
      });

      assert.equal(results.length, 0, 'Zero text match must never return any memory');
    });

    test('Zero-word match delete returns "I couldn\'t find a memory matching that."', async () => {
      await saveMemory({
        text: 'Electrician requested copper wiring for panels',
        projectId: 'Lot 3'
      });

      const res = await executeClientToolCall('delete_memory', {
        searchQuery: 'completely unrelated query',
        projectId: 'Lot 3'
      }, { projectId: 'Lot 3' });

      assert.equal(res.success, false);
      assert.equal(res.message, "I couldn't find a memory matching that.");
    });
  });

  describe('3. Delete Confirmation Workflow', () => {
    test('Delete request sharing 1 word with memory asks confirmation; "yes" deactivates, "no" cancels, unrelated discards', async () => {
      const mem = await saveMemory({
        text: 'STRICT OPERATIONAL RULE: Never extrapolate purchasing items',
        projectId: 'Lot 3'
      });

      // Ask to forget the rule
      const reply1 = await askGeminiBrain('forget the note about purchasing rule', [], 'Lot 3');
      assert.ok(
        reply1.text.includes("Delete this memory: 'STRICT OPERATIONAL RULE: Never extrapolate purchasing items'?"),
        `Expected confirmation prompt, got: ${reply1.text}`
      );

      // Verify pending confirmation action is stored
      const pending = getPendingConfirmationAction();
      assert.ok(pending, 'Pending confirmation action must be stored');
      assert.equal(pending.memoryId, mem.id);

      // User says "yes"
      const reply2 = await askGeminiBrain('yes', [], 'Lot 3');
      assert.ok(reply2.text.includes("I've deactivated that memory"));

      // Verify memory is deactivated in storage
      const activeMemories = await getMemories({ projectId: 'Lot 3' });
      assert.equal(activeMemories.find(m => m.id === mem.id), undefined);

      // Verify pending action is cleared
      assert.equal(getPendingConfirmationAction(), null);
    });

    test('User saying "no" or "cancel" cancels the pending deletion', async () => {
      const mem = await saveMemory({
        text: 'Plumber prefers Moen fixtures',
        projectId: 'Lot 3'
      });

      const reply1 = await askGeminiBrain('forget what i told you about plumber', [], 'Lot 3');
      assert.ok(reply1.text.includes('Delete this memory'));

      // User cancels
      const reply2 = await askGeminiBrain('no', [], 'Lot 3');
      assert.equal(reply2.text, 'OK, cancelled.');
      assert.equal(getPendingConfirmationAction(), null);

      // Memory is still active
      const activeMemories = await getMemories({ projectId: 'Lot 3' });
      assert.ok(activeMemories.find(m => m.id === mem.id));
    });

    test('Unrelated next message discards the pending confirmation action', async () => {
      await saveMemory({
        text: 'Drywall subcontractor requires 2 weeks notice',
        projectId: 'Lot 3'
      });

      await askGeminiBrain('forget what i told you about drywall', [], 'Lot 3');
      assert.ok(getPendingConfirmationAction());

      // Send unrelated query
      await askGeminiBrain('What is the budget?', [], 'Lot 3');
      assert.equal(getPendingConfirmationAction(), null, 'Pending confirmation must be discarded on unrelated query');
    });

    test('Pending delete expires after 5 minutes or lot switch', async () => {
      const mem = await saveMemory({
        text: 'Client wants brushed nickel hardware',
        projectId: 'Lot 3'
      });

      await askGeminiBrain('forget the note about brushed nickel', [], 'Lot 3');
      const pending = getPendingConfirmationAction();
      assert.ok(pending);

      // Simulate 6 minutes passing
      pending.timestamp = Date.now() - (6 * 60 * 1000);
      setPendingConfirmationAction(pending);

      // Attempting to answer "yes" now should treat it as expired
      const replyExpired = await askGeminiBrain('yes', [], 'Lot 3');
      assert.notEqual(replyExpired.text, "Got it. I've deactivated that memory.");

      // Test lot switch clearing
      await askGeminiBrain('forget the note about brushed nickel', [], 'Lot 3');
      assert.ok(getPendingConfirmationAction());
      // Switch to Lot 4
      await askGeminiBrain('yes', [], 'Lot 4');
      assert.equal(getPendingConfirmationAction(), null);
    });
  });

  describe('4. Purchasing Removal Matching Logic', () => {
    test('Single match: removes immediately and states item name and section title', async () => {
      await purchasingService.addItem('Lot 3', {
        itemName: 'exhaust fans',
        category: 'electrical',
        quantity: 2
      });

      const res = await purchasingService.removeItem('Lot 3', 'exhaust fans', 'electrical');
      assert.equal(res.success, true);
      assert.equal(res.message, "Removed 'exhaust fans' from Electrical Hardware Fixtures.");
    });

    test('Multiple matches: asks which item with "Did you mean \'X\' or \'Y\'?"', async () => {
      await purchasingService.addItem('Lot 3', {
        itemName: 'ceiling fans',
        category: 'electrical',
        quantity: 3
      });
      await purchasingService.addItem('Lot 3', {
        itemName: 'exhaust fans',
        category: 'electrical',
        quantity: 2
      });

      const res = await purchasingService.removeItem('Lot 3', 'fans', 'electrical');
      assert.equal(res.success, false);
      assert.equal(res.isAmbiguous, true);
      assert.equal(res.message, "Did you mean 'ceiling fans' or 'exhaust fans'?");
    });

    test('Zero matches: reports "I couldn\'t find \'X\' on the list."', async () => {
      const res = await purchasingService.removeItem('Lot 3', 'nonexistent item', 'electrical');
      assert.equal(res.success, false);
      assert.equal(res.isNotFound, true);
      assert.equal(res.message, "I couldn't find 'nonexistent item' on the list.");
    });
  });

  describe('5. Read Routing for "List" / Trade Queries', () => {
    test('Trade list requests route straight to get_purchasing_list in English and Spanish', () => {
      const q1 = getAuthoritativeReadRoute('give me the list for the quartz guy');
      assert.ok(q1);
      assert.equal(q1.toolName, 'get_purchasing_list');
      assert.equal(q1.args.trade, 'quartz');

      const q2 = getAuthoritativeReadRoute('send me the plumbing list');
      assert.ok(q2);
      assert.equal(q2.toolName, 'get_purchasing_list');
      assert.equal(q2.args.trade, 'plumbing');

      const q3 = getAuthoritativeReadRoute('make me a list for the plumber');
      assert.ok(q3);
      assert.equal(q3.toolName, 'get_purchasing_list');
      assert.equal(q3.args.trade, 'plumbing');

      const q4 = getAuthoritativeReadRoute('dame la lista del plomero');
      assert.ok(q4);
      assert.equal(q4.toolName, 'get_purchasing_list');
      assert.equal(q4.args.trade, 'plumbing');
    });
  });

  describe('6. Invented Purchasing List Guard', () => {
    test('Replaces hallucinated list with real Firestore list or empty message when get_purchasing_list did not run', async () => {
      const hallucinatedReply = 'Here is the electrical list:\n- 2 Exhaust fans\n- 5 Dimmer switches\n- 10 Outlets';
      const guarded = await guardAgainstInventedPurchasingList(
        hallucinatedReply,
        'what electrical items do we need?',
        [], // No tools ran
        { projectId: 'Lot 3', projectName: 'Lot 3' }
      );

      // Lot 3 has no electrical items currently
      assert.equal(guarded, 'There are no electrical items on the purchasing list for Lot 3.');
    });

    test('Leaves legitimate reply intact when get_purchasing_list did run', async () => {
      const realReply = 'Here are the items: - Exhaust fans';
      const guarded = await guardAgainstInventedPurchasingList(
        realReply,
        'what electrical items do we need?',
        [{ name: 'get_purchasing_list', success: true, result: { items: [] } }],
        { projectId: 'Lot 3', projectName: 'Lot 3' }
      );
      assert.equal(guarded, realReply);
    });
  });

  describe('7. False Claim Cross-Check (Domain Mismatch)', () => {
    test('didCompatibleChangeToolSucceed detects domain mismatch between purchasing and memory', () => {
      // User asked purchasing removal, but memory tool ran
      const purchasingQuery = 'remove the exhaust fans from the electrical purchasing list';
      const memoryToolRan = [{ name: 'delete_memory', success: true }];
      assert.equal(didCompatibleChangeToolSucceed(purchasingQuery, memoryToolRan), false);

      // User asked memory deletion, but purchasing tool ran
      const memoryQuery = 'forget what i told you about the painter';
      const purchasingToolRan = [{ name: 'remove_purchasing_item', success: true }];
      assert.equal(didCompatibleChangeToolSucceed(memoryQuery, purchasingToolRan), false);
    });

    test('verifyActionExecutionClaims blocks claim when domain mismatch occurs', () => {
      const reply = "I have removed 'exhaust fans' from the electrical purchasing list.";
      const blocked = verifyActionExecutionClaims(
        reply,
        'remove the exhaust fans from the electrical purchasing list',
        [{ name: 'delete_memory', success: true }]
      );
      assert.equal(blocked, "I didn't complete that. Want me to try again?");
    });
  });

  describe('8. Follow-up Hardening: Spanish Variations & Dispatcher Defense in Depth', () => {
    test('Spanish shortcut accepts "borra la nota del..." and asks confirmation', async () => {
      await saveMemory({
        text: 'El plomero pide tubería de cobre',
        projectId: 'Lot 3'
      });

      const reply = await askGeminiBrain('borra la nota del plomero', [], 'Lot 3');
      assert.ok(reply.text.includes("Delete this memory: 'El plomero pide tubería de cobre'?"));
      assert.ok(getPendingConfirmationAction());
    });

    test('Spanish shortcut accepts "borra la nota de..." and asks confirmation', async () => {
      await saveMemory({
        text: 'Pintura color Chantilly Lace',
        projectId: 'Lot 3'
      });

      const reply = await askGeminiBrain('borra la nota de la pintura', [], 'Lot 3');
      assert.ok(reply.text.includes("Delete this memory: 'Pintura color Chantilly Lace'?"));
      assert.ok(getPendingConfirmationAction());
    });
  });
});
