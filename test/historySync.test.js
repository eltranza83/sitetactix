import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProjectHistory,
  getHistoryDismissKey
} from '../src/services/historySync.js';

describe('historySync cross-device Sheet History', () => {
  const lot3 = { id: 'lot-3', name: 'Lot 3', folderId: 'folder_lot3' };
  const lot4 = { id: 'lot-4', name: 'Lot 4', folderId: 'folder_lot4' };

  const sheetTransactions = [
    {
      rowNumber: 2,
      date: '2026-10-21',
      payee: 'Martin Dominguez',
      description: 'Lot 3 Floor Plans',
      category: 'Paperwork & Permits',
      phase: 'Paperwork & Permits',
      material: 0,
      labor: 1443,
      check: '1440',
      receipt: 'https://drive.google.com/file/d/pdf_martin/view',
      receiptId: 'r_martin'
    },
    {
      rowNumber: 8,
      date: '2026-11-26',
      payee: 'Google LLC',
      description: 'Google AI Pro (5 TB) subscription',
      category: 'Project Overhead & Bills',
      phase: 'Office & Tech',
      material: 106.59,
      labor: 0,
      check: 'Credit Card',
      receipt: 'https://drive.google.com/file/d/pdf_google/view',
      receiptId: 'r_google'
    }
  ];

  test('hydrates active project History from Sheet Transactions newest-first across devices', () => {
    // Device has empty localHistory (e.g. opening on PC after scanning on phone)
    const result = buildProjectHistory({
      activeProject: lot3,
      sheetTransactions,
      localHistory: [],
      dismissedKeys: []
    });

    assert.equal(result.length, 2);
    // Row 8 (newest) appears first
    assert.equal(result[0].vendor, 'Google LLC');
    assert.equal(result[0].amount, 106.59);
    assert.equal(result[0].costCategory, 'material');
    assert.equal(result[0].tradePhase, 'Office & Tech');
    assert.equal(result[0].link, 'https://drive.google.com/file/d/pdf_google/view');
    assert.equal(result[0].check.status, 'ok');

    // Row 2 appears second with labor classification
    assert.equal(result[1].vendor, 'Martin Dominguez');
    assert.equal(result[1].amount, 1443);
    assert.equal(result[1].costCategory, 'labor');
  });

  test('filters out other projects and hides locally dismissed keys without altering Sheet data', () => {
    const localHistory = [
      {
        id: 'local_other_lot',
        receiptId: 'r_lot4_1',
        vendor: 'Home Depot',
        amount: 250,
        lotName: 'Lot 4',
        folderId: 'folder_lot4'
      }
    ];
    const dismissGoogle = getHistoryDismissKey({ receiptId: 'r_google' });

    const lot3History = buildProjectHistory({
      activeProject: lot3,
      sheetTransactions,
      localHistory,
      dismissedKeys: [dismissGoogle]
    });

    assert.equal(lot3History.length, 1);
    assert.equal(lot3History[0].vendor, 'Martin Dominguez');

    const lot4History = buildProjectHistory({
      activeProject: lot4,
      sheetTransactions: null,
      localHistory,
      dismissedKeys: []
    });
    assert.equal(lot4History.length, 1);
    assert.equal(lot4History[0].vendor, 'Home Depot');
  });
});
