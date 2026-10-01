import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getAuthoritativeReadRoute } from '../src/services/builderBrainService.js';
import { TRADE_SECTION_MAP, TRADE_CATEGORIES } from '../src/config/tradesConfig.js';
import {
  PurchasingService,
  classifyTradeCategory,
  PURCHASING_STATUSES
} from '../src/services/purchasingService.js';
import {
  parseGoogleDocPurchasingStructure
} from '../src/services/googleDocsPurchasingService.js';
import { executeClientToolCall } from '../src/services/aiTools.js';

describe('Purchasing Routing Guard & Canonical 3-Section Validation', () => {
  describe('1. Authoritative Read Route Guard', () => {
    it('never routes preference or recollection questions to purchasing', () => {
      // Questions using prefer, preference, like, likes, remember, notes, said, told must bypass purchasing
      const prefQueries = [
        'What paint does the painter prefer?',
        'What is the client preference for tile?',
        'What light fixtures does the electrician like?',
        'Do you remember what the plumber said about pipes?',
        'What notes did we take about electrical?',
        'What did the builder told us about paint?'
      ];

      for (const q of prefQueries) {
        const route = getAuthoritativeReadRoute(q);
        assert.equal(
          route,
          null,
          `Query "${q}" must return null (staying on AI/memory path), but got ${JSON.stringify(route)}`
        );
      }
    });

    it('routes "chose/chosen" questions to finishes, not AI memory', () => {
      // "chose/chosen" is explicitly excluded from the preference guard
      const finishQueries = [
        'What paint color did the client choose?',
        'Which tile was chosen for the master bath?',
        'What countertop finish did the owner choose?'
      ];

      for (const q of finishQueries) {
        const route = getAuthoritativeReadRoute(q);
        assert.ok(route, `Query "${q}" must resolve an authoritative route`);
        assert.equal(route.toolName, 'get_project_finishes', `Query "${q}" must route to get_project_finishes`);
      }
    });

    it('only routes to purchasing when the query has buying intent', () => {
      const buyingQueries = [
        { q: 'What electrical do we still need to buy?', trade: 'electrical', unpurchasedOnly: true },
        { q: 'What quartz do we need to order?', trade: 'quartz', unpurchasedOnly: true },
        { q: 'What plumbing hardware did we purchase?', trade: 'plumbing', unpurchasedOnly: false },
        { q: 'Show me the purchasing checklist for electrical', trade: 'electrical', unpurchasedOnly: false },
        { q: 'What do we need to buy for Lot 3?', trade: '', unpurchasedOnly: true }
      ];

      for (const item of buyingQueries) {
        const route = getAuthoritativeReadRoute(item.q);
        assert.ok(route, `Query "${item.q}" must route to purchasing`);
        assert.equal(route.toolName, 'get_purchasing_list');
        assert.equal(route.args.trade, item.trade);
        assert.equal(route.args.unpurchasedOnly, item.unpurchasedOnly);
      }
    });

    it('bypasses purchasing for Google Doc / Drive queries', () => {
      const driveQuery = 'What is in Google Doc Purchasing List?';
      const route = getAuthoritativeReadRoute(driveQuery);
      assert.equal(route, null, 'Drive folder questions must not route to purchasing shortcut');
    });
  });

  describe('2. Canonical 3 Sections: Quartz, Electrical, Plumbing', () => {
    it('TRADE_SECTION_MAP only contains quartz, electrical, and plumbing', () => {
      const keys = Object.keys(TRADE_SECTION_MAP).sort();
      assert.deepEqual(keys, ['electrical', 'plumbing', 'quartz']);
      assert.equal(TRADE_SECTION_MAP.hvac, undefined);
      assert.equal(TRADE_SECTION_MAP.paint_drywall, undefined);
      assert.equal(TRADE_SECTION_MAP.general, undefined);
    });

    it('classifyTradeCategory returns null for non-canonical trades without override', () => {
      assert.equal(classifyTradeCategory('smart thermostat'), null);
      assert.equal(classifyTradeCategory('drywall joint compound'), null);
      assert.equal(classifyTradeCategory('hammer and nails'), null);
      assert.equal(classifyTradeCategory(''), null);
    });

    it('classifyTradeCategory correctly classifies canonical items', () => {
      assert.equal(classifyTradeCategory('four hole grommets')?.id, 'quartz');
      assert.equal(classifyTradeCategory('GFCI outlets')?.id, 'electrical');
      assert.equal(classifyTradeCategory('shower pan liner')?.id, 'plumbing');
    });
  });

  describe('3. Legacy Google Doc Heading Resilience', () => {
    it('safely parses document with old HVAC, Paint, and General headings without crashing or lumping', () => {
      const legacyDoc = `# Master Purchasing Checklist
## 1. Quartz Hardware
- [ ] Pass-through caps

## 2. Electrical Hardware Fixtures
- [ ] Security lights
- [ ] Dimmer switches

## 3. Plumbing Hardware Fixtures
- [ ] Toilets

## 4. HVAC Hardware & Fixtures
- [ ] Smart thermostat
- [ ] Bath fan

## 5. Paint & Drywall Supplies
- [ ] Primer
- [ ] Joint compound

## 6. General Hardware & Materials
- [ ] Hammer
`;

      const parsed = parseGoogleDocPurchasingStructure(legacyDoc);
      // Only Quartz, Electrical, and Plumbing should be recognized as sections
      assert.equal(parsed.sections.length, 3);
      assert.equal(parsed.sections[0].categoryId, 'quartz');
      assert.equal(parsed.sections[1].categoryId, 'electrical');
      assert.equal(parsed.sections[2].categoryId, 'plumbing');

      // Crucial: Items under legacy headings must NOT be lumped into Plumbing!
      assert.equal(parsed.sections[2].items.length, 1);
      assert.equal(parsed.sections[2].items[0].itemName, 'Toilets');
    });
  });

  describe('4. Two-Step Clarification Flow for Uncategorized Items', () => {
    it('prompts "Is that for Quartz, Electrical or Plumbing?" when adding item without recognized category', async () => {
      // Step 1: User says "Add 2 exhaust fans" (exhaust fans is not recognized in quartz/electrical/plumbing)
      const projectContext = { projectId: 'lot_3', activeProjectName: 'Lot 3' };
      const step1Result = await executeClientToolCall(
        'add_purchasing_item',
        { item: '2 exhaust fans', quantity: 2, projectId: 'lot_3' },
        projectContext
      );

      assert.equal(step1Result.success, false);
      assert.equal(step1Result.status, 'needs_clarification');
      assert.equal(step1Result.needsCategory, true);
      assert.equal(step1Result.action, 'NEEDS_CATEGORY');
      assert.equal(step1Result.message, 'Is that for Quartz, Electrical or Plumbing?');

      // Step 2: User responds "Electrical" -> Client calls add_purchasing_item with category: 'electrical'
      const step2Result = await executeClientToolCall(
        'add_purchasing_item',
        { item: '2 exhaust fans', quantity: 2, category: 'electrical', projectId: 'lot_3' },
        projectContext
      );

      assert.equal(step2Result.success, true);
      assert.equal(step2Result.sectionId, 'electrical');
      assert.equal(step2Result.itemName, 'exhaust fans');
      assert.equal(step2Result.quantity, 2);
    });
  });
});
