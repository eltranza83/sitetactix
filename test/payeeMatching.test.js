import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPayeeMatch,
  loadCachedKnownSubs,
  matchPayeeToKnownSubs,
  normalizePayeeName,
  persistKnownSubs
} from '../src/services/payeeMatching.js';

const KNOWN = [
  { sub: 'Enrique Vallejo', company: 'Vallejo Electric LLC' },
  { sub: 'Pedro Salinas', company: '' },
  { sub: 'Rio Cool Air', company: 'Rio Cool Air' },
  { sub: 'SecureHome Alarms', company: 'SecureHome Alarms' }
];

describe('matching a scanned payee to a known sub', () => {
  test('normalization ignores case, punctuation, order and business suffixes', () => {
    assert.equal(normalizePayeeName('VALLEJO ELECTRIC, L.L.C.'), normalizePayeeName('Vallejo Electric'));
    assert.equal(normalizePayeeName('Vallejo Electric LLC'), 'electric vallejo');
    assert.equal(normalizePayeeName('Vallejo, Enrique'), normalizePayeeName('Enrique Vallejo'));
  });

  test('company name, company without suffix, all caps, and the person all go to the Company', () => {
    for (const scanned of ['Vallejo Electric', 'VALLEJO ELECTRIC LLC', 'Vallejo Electric, Inc.', 'Enrique Vallejo', 'enrique vallejo', 'Vallejo Enrique']) {
      const match = matchPayeeToKnownSubs(scanned, KNOWN);
      assert.ok(match, scanned);
      assert.equal(match.name, 'Vallejo Electric LLC', scanned);
      assert.equal(match.sub, 'Enrique Vallejo');
    }
    assert.equal(matchPayeeToKnownSubs('Enrique Vallejo', KNOWN).matchedOn, 'sub');
    assert.equal(matchPayeeToKnownSubs('Vallejo Electric', KNOWN).matchedOn, 'company');
  });

  test('a sub with no company is written with the Sub name', () => {
    assert.equal(matchPayeeToKnownSubs('PEDRO SALINAS', KNOWN).name, 'Pedro Salinas');
  });

  test('one OCR slip in a long name still matches', () => {
    assert.equal(matchPayeeToKnownSubs('Vallejo Electrc', KNOWN)?.name, 'Vallejo Electric LLC');
    assert.equal(matchPayeeToKnownSubs('Vallejo Elektric', KNOWN)?.name, 'Vallejo Electric LLC');
    assert.equal(matchPayeeToKnownSubs('Pedro Salina', KNOWN)?.name, 'Pedro Salinas');
  });

  test('Jr / Sr is a different person and is not auto-matched', () => {
    assert.equal(matchPayeeToKnownSubs('Enrique Vallejo Jr', KNOWN), null);
    assert.equal(matchPayeeToKnownSubs('Enrique Vallejo Sr.', KNOWN), null);
  });

  test('unrelated or partial names are not matched', () => {
    for (const scanned of ['Home Depot', 'Vallejo', 'Enrique', 'Vallejo Plumbing LLC', 'Rio Grande Air', 'Pedro Martinez', 'Electric', '', null]) {
      assert.equal(matchPayeeToKnownSubs(scanned, KNOWN), null, String(scanned));
    }
    assert.equal(matchPayeeToKnownSubs('Vallejo Electric', []), null);
  });

  test('a name matching two different subs is left alone', () => {
    const twins = [{ sub: 'Juan Garza', company: 'Garza Roofing' }, { sub: 'Juan Garza', company: 'Garza Concrete' }];
    assert.equal(matchPayeeToKnownSubs('Juan Garza', twins), null);
    assert.equal(matchPayeeToKnownSubs('Garza Roofing', twins).name, 'Garza Roofing');
  });

  test('scan result gets the known name and is marked auto-matched', () => {
    const matched = applyPayeeMatch({ vendor: 'VALLEJO ELECTRIC', amount: 3000 }, KNOWN);
    assert.equal(matched.vendor, 'Vallejo Electric LLC');
    assert.deepEqual(matched.payeeMatch, { auto: true, original: 'VALLEJO ELECTRIC', sub: 'Enrique Vallejo', company: 'Vallejo Electric LLC' });
    assert.equal(matched.amount, 3000);
    const untouched = { vendor: 'Home Depot' };
    assert.equal(applyPayeeMatch(untouched, KNOWN), untouched);
  });

  test('known subs are cached per Sheet', () => {
    const store = new Map();
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    assert.deepEqual(loadCachedKnownSubs(storage, 's1'), []);
    persistKnownSubs(storage, 's1', KNOWN);
    assert.deepEqual(loadCachedKnownSubs(storage, 's1'), KNOWN);
    assert.deepEqual(loadCachedKnownSubs(storage, 's2'), []);
    store.set('sitetactix_known_subs_s3', 'not json');
    assert.deepEqual(loadCachedKnownSubs(storage, 's3'), []);
  });
});
