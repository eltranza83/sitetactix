import React from 'react';
import { knownSubPayeeName } from '../services/payeeMatching';

/**
 * Under the payee box on the review screen: shows which known sub (from the Sheet's Contracts tab)
 * the payee was matched to, and lets the user pick a different known sub or keep the typed name.
 */
export default function EditFormPayeePicker({ vendor, payeeMatch, knownSubs = [], onPick }) {
  if (!Array.isArray(knownSubs) || knownSubs.length === 0) return null;

  const isMatched = Boolean(payeeMatch) && String(vendor || '').trim() === knownSubPayeeName(payeeMatch);
  const selectedIndex = isMatched
    ? knownSubs.findIndex(k => (k.sub || '') === (payeeMatch.sub || '') && (k.company || '') === (payeeMatch.company || ''))
    : -1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
      {isMatched && (
        <span style={{ fontSize: '0.68rem', color: 'var(--color-emerald-500)' }}>
          {payeeMatch.auto ? 'Auto-' : ''}matched to {payeeMatch.sub || payeeMatch.company}
          {payeeMatch.auto && payeeMatch.original && payeeMatch.original !== vendor ? ` (scanned "${payeeMatch.original}")` : ''}
        </span>
      )}
      <select
        aria-label="Known subs"
        className="form-input"
        style={{ padding: '4px 8px', fontSize: '0.72rem', width: '100%' }}
        value={selectedIndex >= 0 ? String(selectedIndex) : ''}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '') {
            onPick(null);
            return;
          }
          onPick(knownSubs[Number(value)] || null);
        }}
      >
        <option value="">Keep typed name</option>
        {knownSubs.map((k, index) => (
          <option key={`${k.sub}|${k.company}`} value={String(index)}>
            {k.company && k.sub && k.company !== k.sub ? `${k.sub} (${k.company})` : (k.company || k.sub)}
          </option>
        ))}
      </select>
    </div>
  );
}
