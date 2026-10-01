import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  askGeminiBrain,
  normalizePurchasingToolCalls,
  isPastTensePurchasingInquiry,
  isPurchasingItemGrounded,
  verifyActionExecutionClaims,
  getPendingRetryAction,
  setPendingRetryAction,
  clearPendingRetryAction,
  clearPendingClarificationAction,
  clearPendingConfirmationAction,
  resetActiveSessionCognitiveState
} from '../src/services/builderBrainService.js';

import { clearIdempotencyCache } from '../src/services/aiTools.js';

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

describe('v1.3.16: Trust the AI, Verify the Action Suite', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    globalThis.localStorage = mockStorage;
    resetActiveSessionCognitiveState();
    clearIdempotencyCache();
  });

  describe('1. Past-Tense Purchasing Inquiries vs Change Requests', () => {
    test('isPastTensePurchasingInquiry flags questions about past actions', () => {
      assert.equal(isPastTensePurchasingInquiry('did we add the exhaust fans?'), true);
      assert.equal(isPastTensePurchasingInquiry('what did we add yesterday?'), true);
      assert.equal(isPastTensePurchasingInquiry('have we added the ceiling fans'), true);
      assert.equal(isPastTensePurchasingInquiry('have we bought the faucets?'), true);
      assert.equal(isPastTensePurchasingInquiry('were the exhaust fans added?'), true);
      assert.equal(isPastTensePurchasingInquiry('was the transformer added to electrical?'), true);
      assert.equal(isPastTensePurchasingInquiry('¿agregamos los ventiladores?'), true);
      assert.equal(isPastTensePurchasingInquiry('¿qué agregaste ayer?'), true);
      assert.equal(isPastTensePurchasingInquiry('¿compramos los reflectores?'), true);
      assert.equal(isPastTensePurchasingInquiry('se agregó el ventilador?'), true);
    });

    test('isPastTensePurchasingInquiry does not flag imperative or future change requests', () => {
      assert.equal(isPastTensePurchasingInquiry('add 2 exhaust fans to the electrical purchasing list'), false);
      assert.equal(isPastTensePurchasingInquiry('can you add two exhaust fans to the purchasing list'), false);
      assert.equal(isPastTensePurchasingInquiry('could you please put a doorbell transformer on the checklist'), false);
      assert.equal(isPastTensePurchasingInquiry('agrega dos ventiladores a la lista de compras'), false);
      assert.equal(isPastTensePurchasingInquiry('mark exhaust fans as purchased'), false);
    });
  });

  describe('2. Removal of isExplicitAdd Gate: Model-chosen Writes Allowed', () => {
    test('allows add_purchasing_item through regardless of phrasing (EN/ES)', () => {
      const tcAdd = [{ name: 'add_purchasing_item', args: { item: 'exhaust fans', quantity: 2, category: 'electrical', projectId: 'lot_3' } }];

      // Phrasing 1: direct add
      const res1 = normalizePurchasingToolCalls(tcAdd, 'add 2 exhaust fans to the electrical purchasing list');
      assert.equal(res1[0].name, 'add_purchasing_item');

      // Phrasing 2: conversational "can you add..." (the bug reported in live testing)
      const res2 = normalizePurchasingToolCalls(tcAdd, 'can you add two exhaust fans to the purchasing list');
      assert.equal(res2[0].name, 'add_purchasing_item');

      // Phrasing 3: "could you please put... on the checklist"
      const res3 = normalizePurchasingToolCalls(
        [{ name: 'add_purchasing_item', args: { item: 'doorbell transformer', quantity: 1, projectId: 'lot_3' } }],
        'could you please put a doorbell transformer on the checklist'
      );
      assert.equal(res3[0].name, 'add_purchasing_item');

      // Phrasing 4: Spanish "agrega dos ventiladores..."
      const res4 = normalizePurchasingToolCalls(
        [{ name: 'add_purchasing_item', args: { item: 'ventiladores', quantity: 2, projectId: 'lot_3' } }],
        'agrega dos ventiladores a la lista de compras'
      );
      assert.equal(res4[0].name, 'add_purchasing_item');
    });

    test('converts purchasing write tool calls to get_purchasing_list when query is a question about the past', () => {
      const tcAdd = [{ name: 'add_purchasing_item', args: { item: 'exhaust fans', quantity: 2, projectId: 'lot_3' } }];
      const res = normalizePurchasingToolCalls(tcAdd, 'did we add the exhaust fans?');
      assert.equal(res[0].name, 'get_purchasing_list');
      assert.equal(res[0].args.unpurchasedOnly, false);

      const tcUpdate = [{ name: 'update_purchasing_item_status', args: { itemName: 'faucets', isPurchased: true, projectId: 'lot_3' } }];
      const resUpdate = normalizePurchasingToolCalls(tcUpdate, 'have we bought the faucets?');
      assert.equal(resUpdate[0].name, 'get_purchasing_list');

      const tcSpanish = [{ name: 'add_purchasing_item', args: { item: 'ventiladores', projectId: 'lot_3' } }];
      const resSpanish = normalizePurchasingToolCalls(tcSpanish, '¿agregamos los ventiladores?');
      assert.equal(resSpanish[0].name, 'get_purchasing_list');
    });
  });

  describe('3. Grounding Verification for Purchasing Writes', () => {
    test('isPurchasingItemGrounded accurately verifies item appears in user text with plural/stem tolerance', () => {
      assert.equal(isPurchasingItemGrounded('exhaust fans', 'can you add two exhaust fans to the purchasing list'), true);
      assert.equal(isPurchasingItemGrounded('exhaust fans', 'add 2 exhaust fans to the electrical purchasing list'), true);
      assert.equal(isPurchasingItemGrounded('doorbell transformer', 'could you please put a doorbell transformer on the checklist'), true);
      assert.equal(isPurchasingItemGrounded('ventiladores', 'agrega dos ventiladores a la lista de compras'), true);
      assert.equal(isPurchasingItemGrounded('ventilador', 'agrega dos ventiladores a la lista de compras'), true);
      assert.equal(isPurchasingItemGrounded('exhaust fan', 'can you add two exhaust fans to the purchasing list'), true);
    });

    test('isPurchasingItemGrounded blocks ungrounded item proposals', () => {
      assert.equal(isPurchasingItemGrounded('copper pipes', 'can you add two exhaust fans to the purchasing list'), false);
      assert.equal(isPurchasingItemGrounded('refrigerador', 'agrega dos ventiladores a la lista de compras'), false);
      assert.equal(isPurchasingItemGrounded('chandelier', 'put a doorbell transformer on the checklist'), false);
      assert.equal(isPurchasingItemGrounded('', 'can you add two exhaust fans'), false);
    });

    test('askGeminiBrain blocks tool execution when model proposes an ungrounded item', async () => {
      // Mock fetch returning ungrounded tool call: model proposes "copper pipes" when user asked for exhaust fans
      globalThis.fetch = async (url) => {
        if (url === '/api/ask-brain') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: "I'll add copper pipes to the list.",
              toolCalls: [{
                name: 'add_purchasing_item',
                args: { item: 'copper pipes', quantity: 5, category: 'plumbing', projectId: 'lot_3' }
              }],
              telemetry: { modelUsed: 'gemini-2.5' }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      const res = await askGeminiBrain('can you add two exhaust fans to the purchasing list', {
        projectId: 'lot_3',
        activeProjectName: 'Lot 3'
      });

      assert.equal(res.text, "I didn't complete that — which item did you mean?");
      assert.equal(res.telemetry?.intent, 'Ungrounded Purchasing Write Blocked');
      assert.equal(res.telemetry?.toolsExecuted?.length, 0);
    });
  });

  describe('4. Refusal Text Interception & Working Pending Retry', () => {
    test('intercepts "no authorization / cannot modify" replies on change requests and stores pending retry', () => {
      clearPendingRetryAction();
      const refusalText = "I do not have the authorization to modify or add items to the Firestore database directly.";
      const verified = verifyActionExecutionClaims(
        refusalText,
        'can you add two exhaust fans to the electrical purchasing list',
        [],
        { projectId: 'lot_3' }
      );

      assert.equal(verified, "I didn't complete that. Want me to try again?");
      const pending = getPendingRetryAction();
      assert.ok(pending);
      assert.equal(pending.query, 'can you add two exhaust fans to the electrical purchasing list');
      assert.equal(pending.projectId, 'lot_3');
    });

    test('intercepts Spanish refusal text and stores pending retry', () => {
      clearPendingRetryAction();
      const spRefusal = "No tengo autorización para modificar la base de datos de compras.";
      const verified = verifyActionExecutionClaims(
        spRefusal,
        'agrega dos ventiladores a la lista de compras',
        [],
        { projectId: 'lot_3' }
      );

      assert.equal(verified, "I didn't complete that. Want me to try again?");
      const pending = getPendingRetryAction();
      assert.ok(pending);
      assert.equal(pending.query, 'agrega dos ventiladores a la lista de compras');
    });

    test('answering "yes" or "try again" to retry prompt re-runs the original query', async () => {
      setPendingRetryAction({
        query: 'can you add two exhaust fans to the electrical purchasing list',
        projectId: 'lot_3',
        timestamp: Date.now()
      });

      let invokedQuery = null;
      globalThis.fetch = async (url, opts) => {
        if (url === '/api/ask-brain') {
          const body = JSON.parse(opts.body);
          invokedQuery = body.query;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: "Added 2 'exhaust fans' to Electrical Hardware Fixtures.",
              toolCalls: [{
                name: 'add_purchasing_item',
                args: { item: 'exhaust fans', quantity: 2, category: 'electrical', projectId: 'lot_3' }
              }],
              telemetry: { modelUsed: 'gemini-2.5' }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      const res = await askGeminiBrain('yes', {
        projectId: 'lot_3',
        activeProjectName: 'Lot 3'
      });

      // The original query was re-run
      assert.equal(invokedQuery, 'can you add two exhaust fans to the electrical purchasing list');
      assert.ok(res.text.includes("Added 2 'exhaust fans'") || res.text.includes('exhaust fans'));
      // Pending retry was consumed and cleared
      assert.equal(getPendingRetryAction(), null);
    });

    test('answering "no" or "cancel" to retry prompt cancels cleanly', async () => {
      setPendingRetryAction({
        query: 'can you add two exhaust fans to the electrical purchasing list',
        projectId: 'lot_3',
        timestamp: Date.now()
      });

      const res = await askGeminiBrain('no', {
        projectId: 'lot_3',
        activeProjectName: 'Lot 3'
      });

      assert.equal(res.text, 'OK, cancelled.');
      assert.equal(getPendingRetryAction(), null);
    });

    test('pending retry expires after 5 minutes or project switch', async () => {
      setPendingRetryAction({
        query: 'add exhaust fans',
        projectId: 'lot_3',
        timestamp: Date.now() - (6 * 60 * 1000) // 6 minutes ago
      });

      let calledApi = false;
      globalThis.fetch = async () => {
        calledApi = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: 'Standard response', telemetry: {} })
        };
      };

      await askGeminiBrain('yes', { projectId: 'lot_3', activeProjectName: 'Lot 3' });
      // Was expired, so it cleared and processed 'yes' normally through API
      assert.equal(getPendingRetryAction(), null);
      assert.equal(calledApi, true);
    });
  });
});
