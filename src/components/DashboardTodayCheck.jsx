import React, { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { buildDailyCheck, parseSheetDashboardTotals } from '../services/dailyCheck';

const money = (value) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "Today" card: everything synced today on this device for this house, checked against the Sheet
 * (row found, same payee / category / phase / amounts), plus drafts still waiting, possible duplicates,
 * and whether the Sheet's own Dashboard total matches.
 */
export default function DashboardTodayCheck({ data, history, drafts, projectName, isCached }) {
  const result = useMemo(() => buildDailyCheck({
    history: history || [],
    transactions: data?.transactions || [],
    drafts: drafts || [],
    projectName,
    appTotals: data?.projectInfo || {},
    sheetTotals: Array.isArray(data?.sheetDashboardRows) ? parseSheetDashboardTotals(data.sheetDashboardRows) : null
  }), [data, history, drafts, projectName]);

  if (!data?.transactions) return null;

  const good = result.ok;
  const color = good ? '#4ade80' : '#f87171';
  const lines = [];
  result.missing.forEach(e => lines.push(`${e.log.vendor || 'Entry'} ${money(e.log.amount)}: not found in the Sheet`));
  result.different.forEach(e => lines.push(`${e.log.vendor || 'Entry'} ${money(e.log.amount)}: ${e.problems.join('; ')}`));
  result.duplicates.forEach(d => lines.push(`Possible duplicate: ${d.payee} ${money(d.amount)} on ${d.date} (rows ${d.rows.join(' and ')})`));
  if (result.totalsMatch === false) {
    lines.push(`The Sheet's Dashboard shows ${money(result.sheetTotals.spent)} spent, the app counts ${money(data.projectInfo.totalSpent)}. Check the Sheet's formulas.`);
  }

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: '12px',
      backgroundColor: good ? 'rgba(74, 222, 128, 0.07)' : 'rgba(248, 113, 113, 0.1)',
      border: `1px solid ${good ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.4)'}`,
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }}>
      {good
        ? <CheckCircle2 size={18} style={{ color, flexShrink: 0, marginTop: '1px' }} />
        : <AlertTriangle size={18} style={{ color, flexShrink: 0, marginTop: '1px' }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: good ? 'var(--st-text)' : '#fca5a5' }}>
          Today: {result.count === 0 ? 'nothing synced yet' : `${result.count} ${result.count === 1 ? 'entry' : 'entries'} · ${money(result.total)}`}
          {result.count > 0 && good ? ' · all recorded' : ''}
          {!good ? ` · ${result.problemCount} to check` : ''}
        </span>
        {lines.map(line => (
          <span key={line} style={{ fontSize: '0.74rem', color: 'var(--st-text)', lineHeight: 1.4 }}>{line}</span>
        ))}
        <span style={{ fontSize: '0.7rem', color: 'var(--st-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {result.draftsWaiting > 0 ? (
            <><Clock size={12} /> {result.draftsWaiting} {result.draftsWaiting === 1 ? 'draft' : 'drafts'} waiting to sync</>
          ) : '0 drafts waiting'}
          {result.totalsMatch === true ? ' · Sheet totals match' : ''}
          {result.totalsMatch === null && !isCached
            ? (data?.sheetDashboardRows ? ' · Sheet total not found on the Dashboard tab' : ' · could not read the Sheet Dashboard tab')
            : ''}
          {isCached ? ' · saved copy, tap Refresh for the latest' : ''}
        </span>
      </div>
    </div>
  );
}
