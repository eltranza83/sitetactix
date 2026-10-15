import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatMoney } from '../services/money.js';

/** Shown under the Dashboard totals when a sub has been paid more than their quote. */
export default function DashboardOverpaidNotice({ overpaidSubs = [] }) {
  if (!Array.isArray(overpaidSubs) || overpaidSubs.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        padding: '12px 14px',
        borderRadius: '12px',
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        border: '1px solid rgba(248, 113, 113, 0.4)'
      }}
    >
      <AlertTriangle size={18} style={{ color: '#f87171', flexShrink: 0, marginTop: '1px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fca5a5' }}>
          {overpaidSubs.length === 1 ? '1 sub was paid more than their quote' : `${overpaidSubs.length} subs were paid more than their quote`}
        </span>
        {overpaidSubs.map(sub => (
          <span key={`${sub.name}|${sub.phase}`} style={{ fontSize: '0.76rem', color: 'var(--st-text)' }}>
            {sub.name} ({sub.phase}): overpaid {formatMoney(sub.amount)}
          </span>
        ))}
        <span style={{ fontSize: '0.7rem', color: 'var(--st-muted)', lineHeight: 1.4 }}>
          Check the Contracts tab: extra work not added to the quote, a check scanned twice, or a payment in the wrong phase.
        </span>
      </div>
    </div>
  );
}
