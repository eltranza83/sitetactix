import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findOpenPunchItemsForSub,
  getCachedIssuesKey,
  loadCachedProjectIssues,
  persistCachedProjectIssues
} from '../src/services/punchGuardrail.js';

describe('punchGuardrail', () => {
  it('persists and loads cached project issues using the exact useIssues key format', () => {
    const map = new Map();
    const storage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v))
    };

    assert.equal(getCachedIssuesKey('lot_3'), 'jobscan_cached_issues__lot_3');
    persistCachedProjectIssues(storage, 'lot_3', [{ id: 'iss_1', title: 'Cracked tile', status: 'open' }]);

    const loaded = loadCachedProjectIssues(storage, 'lot_3');
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].title, 'Cracked tile');
  });

  it('matches unresolved punch items by contractor name, company in parentheses, or canonical phase', () => {
    const issues = [
      { id: '1', title: 'Crooked anchor bolt', contractorName: 'RG Concrete', tradePhase: 'Foundation & Flatwork', status: 'open', priority: 'medium' },
      { id: '2', title: 'Honeycomb on stem wall', contractorName: 'Ramiro Garza', tradePhase: 'Foundation & Flatwork', status: 'in_progress', priority: 'high' },
      { id: '3', title: 'Already fixed', contractorName: 'RG Concrete', tradePhase: 'Foundation & Flatwork', status: 'resolved', priority: 'high' },
      { id: '4', title: 'Deleted defect', contractorName: 'RG Concrete', tradePhase: 'Foundation & Flatwork', status: 'open', deletedAt: '2026-10-01' },
      { id: '5', title: 'Missing GFCI', contractorName: 'Lucen LLC', tradePhase: 'Electrical & Lighting', status: 'open', priority: 'high' }
    ];

    const matched = findOpenPunchItemsForSub({
      issues,
      payee: 'Ramiro Garza (RG Concrete)',
      contracts: [{ sub: 'Ramiro Garza', company: 'RG Concrete' }],
      phase: 'Foundation & Flatwork'
    });

    assert.deepEqual(matched.map(i => i.id), ['2', '1']);
  });

  it('matches by canonical phase even when contractor name is blank on the punch item', () => {
    const issues = [
      { id: 'p1', title: 'Leaky hose bib', contractorName: '', tradePhase: 'Plumbing Rough-In', status: 'open', priority: 'medium' }
    ];

    const matched = findOpenPunchItemsForSub({
      issues,
      payee: 'Pedro Salinas',
      phase: 'Plumbing Rough-In'
    });

    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'p1');
  });
});
