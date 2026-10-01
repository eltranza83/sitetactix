import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PurchasingService,
  FirestorePurchasingAdapter,
  LocalStoragePurchasingAdapter,
  PURCHASING_STATUSES
} from '../src/services/purchasingService.js';

import {
  verifyActionExecutionClaims,
  getPendingClarificationAction,
  setPendingClarificationAction,
  clearPendingClarificationAction,
  resolvePendingCategory,
  askGeminiBrain
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

describe('Jarvis Action Verification & Single-Item Write Suite', () => {
  beforeEach(() => {
    clearPendingClarificationAction();
    clearIdempotencyCache();
  });

  describe('1. False Success Claim Interceptor', () => {
    test('Blocks English false claims when no mutation tool ran', () => {
      const claim1 = 'I have successfully added the two exhaust fans to the purchasing list under Electrical.';
      assert.equal(
        verifyActionExecutionClaims(claim1, 'electrical', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim2 = 'I added two exhaust fans to the list.';
      assert.equal(
        verifyActionExecutionClaims(claim2, 'add 2 exhaust fans', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim3 = 'Successfully marked the security light as purchased.';
      assert.equal(
        verifyActionExecutionClaims(claim3, 'mark security light as purchased', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim4 = 'I updated the quantity to 4 in your checklist.';
      assert.equal(
        verifyActionExecutionClaims(claim4, 'change quantity', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim5 = 'I removed the exhaust fan from the purchasing checklist.';
      assert.equal(
        verifyActionExecutionClaims(claim5, 'delete exhaust fan', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim6 = "I've saved that to your memory.";
      assert.equal(
        verifyActionExecutionClaims(claim6, 'remember the painter likes blue', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim7 = 'I logged the receipt to drafts.';
      assert.equal(
        verifyActionExecutionClaims(claim7, 'log a $50 receipt from Home Depot', []),
        "I didn't complete that. Want me to try again?"
      );

      const claim8 = 'I noted that in your project records.';
      assert.equal(
        verifyActionExecutionClaims(claim8, 'make a note that concrete was poured', []),
        "I didn't complete that. Want me to try again?"
      );
    });

    test('Blocks Spanish false claims when no mutation tool ran', () => {
      const sp1 = 'Ya agregué los dos ventiladores al listado de compras.';
      assert.equal(
        verifyActionExecutionClaims(sp1, 'eléctrico', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp2 = 'He agregado los dos ventiladores a compras.';
      assert.equal(
        verifyActionExecutionClaims(sp2, 'agrega 2 ventiladores', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp3 = 'Listo, ya quedó agregado a la lista.';
      assert.equal(
        verifyActionExecutionClaims(sp3, 'agrega los ventiladores', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp4 = 'Listo, ya quedó.';
      assert.equal(
        verifyActionExecutionClaims(sp4, 'marca el reflector como comprado', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp5 = 'Guardé el artículo en compras.';
      assert.equal(
        verifyActionExecutionClaims(sp5, 'guarda el ventilador', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp6 = 'Actualicé la cantidad del material.';
      assert.equal(
        verifyActionExecutionClaims(sp6, 'actualiza la cantidad', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp7 = 'Marqué el foco como comprado.';
      assert.equal(
        verifyActionExecutionClaims(sp7, 'marca comprado', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp8 = 'Eliminé el artículo del listado.';
      assert.equal(
        verifyActionExecutionClaims(sp8, 'elimina el artículo', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp9 = 'Anoté eso en tu memoria.';
      assert.equal(
        verifyActionExecutionClaims(sp9, 'recuerda que el pintor prefiere azul', []),
        "I didn't complete that. Want me to try again?"
      );

      const sp10 = 'Registré el recibo en borradores.';
      assert.equal(
        verifyActionExecutionClaims(sp10, 'registra un recibo de $50 de Home Depot', []),
        "I didn't complete that. Want me to try again?"
      );
    });

    test('Allows claim through when a mutation tool succeeded', () => {
      const claim = 'I have successfully added the two exhaust fans to the purchasing list under Electrical.';
      const successfulTools = [
        {
          name: 'add_purchasing_item',
          toolType: 'WRITE',
          success: true,
          result: { success: true }
        }
      ];

      assert.equal(
        verifyActionExecutionClaims(claim, 'electrical', successfulTools),
        claim,
        'Should not block legitimate claim when change tool succeeded'
      );

      const spClaim = 'Ya agregué los ventiladores a la lista.';
      assert.equal(
        verifyActionExecutionClaims(spClaim, 'eléctrico', successfulTools),
        spClaim,
        'Should not block Spanish claim when change tool succeeded'
      );

      const memClaim = "I've saved that to your memory.";
      const memSuccessTool = [
        {
          name: 'save_memory',
          toolType: 'WRITE',
          success: true,
          result: { saved: true }
        }
      ];
      assert.equal(
        verifyActionExecutionClaims(memClaim, 'remember the painter likes blue', memSuccessTool),
        memClaim,
        'Should not block memory claim when save_memory succeeded'
      );

      const logClaim = 'I logged the receipt to drafts.';
      const logSuccessTool = [
        {
          name: 'stage_receipt',
          toolType: 'WRITE',
          success: true,
          result: { success: true }
        }
      ];
      assert.equal(
        verifyActionExecutionClaims(logClaim, 'log a $50 receipt from Home Depot', logSuccessTool),
        logClaim,
        'Should not block log claim when stage/log tool succeeded'
      );
    });

    test('Does NOT block answers to informational/read inquiries', () => {
      const readReply1 = 'Yesterday, the following items were added to Lot 3: Can lights and exhaust fans.';
      assert.equal(
        verifyActionExecutionClaims(readReply1, 'What did we add yesterday?', []),
        readReply1,
        'Should not block read-only inquiry reporting items added'
      );

      const readReply2 = 'The security lights were marked as purchased on Monday.';
      assert.equal(
        verifyActionExecutionClaims(readReply2, 'Did we mark the security lights as purchased?', []),
        readReply2,
        'Should not block passive status check inquiry'
      );

      const readReply3 = 'Ayer se compraron los siguientes materiales: 4 cajas de tornillos.';
      assert.equal(
        verifyActionExecutionClaims(readReply3, '¿Qué compramos ayer?', []),
        readReply3,
        'Should not block Spanish inquiry reply'
      );
    });
  });

  describe('2. Pending Action Memory & Resumption', () => {
    test('resolvePendingCategory resolves English and Spanish categories', () => {
      assert.equal(resolvePendingCategory('electrical'), 'electrical');
      assert.equal(resolvePendingCategory('electric'), 'electrical');
      assert.equal(resolvePendingCategory('eléctrico'), 'electrical');
      assert.equal(resolvePendingCategory('electrico'), 'electrical');
      assert.equal(resolvePendingCategory('eléctrica'), 'electrical');
      assert.equal(resolvePendingCategory('electrica'), 'electrical');
      assert.equal(resolvePendingCategory('it is for electrical please'), 'electrical');

      assert.equal(resolvePendingCategory('plumbing'), 'plumbing');
      assert.equal(resolvePendingCategory('plomería'), 'plumbing');
      assert.equal(resolvePendingCategory('plomeria'), 'plumbing');
      assert.equal(resolvePendingCategory('under plumbing'), 'plumbing');

      assert.equal(resolvePendingCategory('quartz'), 'quartz');
      assert.equal(resolvePendingCategory('cuarzo'), 'quartz');
      assert.equal(resolvePendingCategory('para cuarzo'), 'quartz');

      assert.equal(resolvePendingCategory('what is the weather'), null);
      assert.equal(resolvePendingCategory('hvac'), null);
    });

    test('Pending action stores and expires properly', () => {
      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      const active = getPendingClarificationAction();
      assert.ok(active);
      assert.equal(active.item, 'exhaust fans');
      assert.equal(active.quantity, 2);

      clearPendingClarificationAction();
      assert.equal(getPendingClarificationAction(), null);
    });

    test('askGeminiBrain handles explicit cancel in English and Spanish', async () => {
      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      const cancelEn = await askGeminiBrain('cancel', [], 'Lot 3');
      assert.equal(cancelEn.text, 'OK, cancelled.');
      assert.equal(getPendingClarificationAction(), null);

      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      const cancelSp = await askGeminiBrain('olvídalo', [], 'Lot 3');
      assert.equal(cancelSp.text, 'OK, cancelled.');
      assert.equal(getPendingClarificationAction(), null);

      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      const neverMind = await askGeminiBrain('never mind', [], 'Lot 3');
      assert.equal(neverMind.text, 'OK, cancelled.');
      assert.equal(getPendingClarificationAction(), null);
    });

    test('askGeminiBrain executes pending action directly when category answered', async () => {
      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      const res = await askGeminiBrain('electrical', [], 'Lot 3');
      assert.ok(res.text.includes('exhaust fans'), `Expected text to mention item, got: ${res.text}`);
      assert.ok(res.text.includes('Electrical') || res.text.includes('electrical'));
      assert.equal(getPendingClarificationAction(), null, 'Pending action must be cleared');
      assert.equal(res.telemetry?.intent, 'Resume Pending Action');
    });

    test('askGeminiBrain clears pending action if project changed', async () => {
      setPendingClarificationAction({
        tool: 'add_purchasing_item',
        item: 'exhaust fans',
        quantity: 2,
        projectId: 'lot_3'
      });

      // User asks on Lot 55 instead of Lot 3
      await askGeminiBrain('electrical', [], 'Lot 55');
      assert.equal(getPendingClarificationAction(), null, 'Should have cleared pending action on lot change');
    });
  });

  describe('3. Single-Item Writes & Cloud Error Handling', () => {
    test('saveItem writes only single item to adapter without rewriting whole list', async () => {
      const mockStorage = createMockLocalStorage();
      const adapter = new LocalStoragePurchasingAdapter(mockStorage);
      const service = new PurchasingService(adapter);

      await service.initializeProjectFromMaster('lot_test');
      const initialItems = await service.getItems('lot_test');
      assert.equal(initialItems.length, 20);

      // Track calls to saveItems vs saveItem
      let saveItemCalled = 0;
      let saveItemsCalled = 0;
      const originalSaveItem = adapter.saveItem.bind(adapter);
      const originalSaveItems = adapter.saveItems.bind(adapter);

      adapter.saveItem = async (pId, item) => {
        saveItemCalled++;
        return await originalSaveItem(pId, item);
      };
      adapter.saveItems = async (pId, items) => {
        saveItemsCalled++;
        return await originalSaveItems(pId, items);
      };

      const addRes = await service.addItem('lot_test', '2 exhaust fans', 2, 'electrical');
      assert.equal(addRes.success, true);
      assert.equal(saveItemCalled, 1, 'Should invoke saveItem exactly once');

      const markRes = await service.updateItemStatus('lot_test', 'exhaust fans', PURCHASING_STATUSES.PURCHASED);
      assert.equal(markRes.success, true);
      assert.equal(saveItemCalled, 2, 'Should invoke saveItem on update');

      const delRes = await service.removeItem('lot_test', 'exhaust fans');
      assert.equal(delRes.success, true);
    });

    test('Never hides failed cloud save on addItem and updateItemStatus', async () => {
      // Create a mock adapter where Firestore throws a simulated network/permission error
      class FaultyCloudAdapter {
        constructor() {
          this.fallback = new LocalStoragePurchasingAdapter(createMockLocalStorage());
        }
        async getItems(projectId) {
          return await this.fallback.getItems(projectId);
        }
        async saveItem(projectId, item) {
          throw new Error('Cloud Firestore quota or permission error');
        }
        async deleteItem(projectId, itemId) {
          throw new Error('Cloud Firestore delete failed');
        }
        async saveItems(projectId, items) {
          throw new Error('Cloud Firestore batch save failed');
        }
      }

      const faultyAdapter = new FaultyCloudAdapter();
      const service = new PurchasingService(faultyAdapter);

      // Attempt to add item
      const addRes = await service.addItem('lot_err', '2 exhaust fans', 2, 'electrical');
      assert.equal(addRes.success, false);
      assert.equal(addRes.action, 'SAVE_FAILED');
      assert.equal(
        addRes.message,
        "Couldn't save 'exhaust fans' to the purchasing list. Please try again."
      );

      // Attempt to update status on faulty adapter
      faultyAdapter.fallback.saveItems('lot_err', [
        { id: 'elec_item_1', itemName: 'Recessed lights', categoryId: 'electrical', status: 'needed' }
      ]);
      const updateRes = await service.updateItemStatus('lot_err', 'Recessed lights', PURCHASING_STATUSES.PURCHASED);
      assert.equal(updateRes.success, false);
      assert.equal(updateRes.action, 'UPDATE_FAILED');
      assert.equal(
        updateRes.message,
        "Couldn't mark 'Recessed lights' on the purchasing list. Please try again."
      );

      // Attempt to remove item on faulty adapter
      const removeRes = await service.removeItem('lot_err', 'Recessed lights');
      assert.equal(removeRes.success, false);
      assert.equal(removeRes.action, 'DELETE_FAILED');
      assert.equal(
        removeRes.message,
        "Couldn't remove 'Recessed lights' from the purchasing checklist. Please try again."
      );
    });
  });
});
