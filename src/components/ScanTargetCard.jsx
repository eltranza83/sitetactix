import React from 'react';
import { CheckCircle2, AlertTriangle, ChevronRight, Home } from 'lucide-react';
import { summarizeScanTarget } from '../services/dailyCheck';
import { formatMoney } from '../services/money';

// "2026-10-15" -> "Oct 15" (other formats are shown as written)
function shortDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Under the scan buttons: which house the next receipt goes to (hard to miss, so nothing is scanned
 * into the wrong lot), the house's last synced receipt and whether it was found in the Sheet, and
 * today's count. History only, no Google call. Tapping it opens the Dashboard.
 */
export default function ScanTargetCard({ projectName, history, onOpenDashboard }) {
  if (!projectName) {
    return (
      <div style={cardStyle}>
        <span style={labelStyle}>Scanning into</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fca5a5' }}>No house selected. Pick one at the top before scanning.</span>
      </div>
    );
  }

  const { last, todayCount, todayTotal } = summarizeScanTarget(history, projectName);
  const inSheet = last?.status === 'ok';
  const needsLook = last?.status === 'missing' || last?.status === 'different';

  return (
    <button type="button" onClick={onOpenDashboard} style={{ ...cardStyle, cursor: 'pointer', textAlign: 'left', width: '100%' }} title="Open this house's Dashboard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={labelStyle}>Scanning into</span>
        <ChevronRight size={16} style={{ color: 'var(--st-muted)', flexShrink: 0 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Home size={18} style={{ color: 'var(--st-gold)', flexShrink: 0 }} />
        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--st-text)', overflowWrap: 'anywhere' }}>{projectName}</span>
      </div>
      <span style={lineStyle}>
        {todayCount === 0 ? 'Nothing synced today' : `Today: ${todayCount} ${todayCount === 1 ? 'entry' : 'entries'} · ${formatMoney(todayTotal)}`}
      </span>
      {last ? (
        <span style={{ ...lineStyle, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span>Last: {last.vendor} {formatMoney(last.amount)}{last.date ? ` · ${shortDate(last.date)}` : ''}</span>
          {inSheet && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#4ade80', fontWeight: 700 }}>
              <CheckCircle2 size={13} /> in the Sheet
            </span>
          )}
          {needsLook && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#f87171', fontWeight: 700 }}>
              <AlertTriangle size={13} /> check History
            </span>
          )}
        </span>
      ) : (
        <span style={lineStyle}>No receipts synced for this house yet</span>
      )}
    </button>
  );
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '14px 16px',
  borderRadius: '12px',
  backgroundColor: 'var(--st-panel)',
  border: '1px solid var(--st-line)',
  color: 'var(--st-text)',
  font: 'inherit'
};

const labelStyle = {
  fontSize: '0.68rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--st-muted)'
};

const lineStyle = {
  fontSize: '0.8rem',
  color: 'var(--st-text)',
  lineHeight: 1.4
};
