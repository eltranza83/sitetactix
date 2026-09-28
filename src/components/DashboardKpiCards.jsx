import React from 'react';
import { Wallet } from 'lucide-react';

export default function DashboardKpiCards({ projectInfo = {} }) {
  const safeFormat = (val) => {
    const num = typeof val === 'number' ? val : parseFloat(String(val || 0).replace(/[^0-9.-]/g, '')) || 0;
    const hasCents = Math.abs(num % 1) > 0.009;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
      <div style={{
        backgroundColor: 'rgba(18, 20, 25, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--st-line)',
        boxShadow: 'var(--shadow-sm), var(--specular-highlight)',
        borderRadius: '12px',
        padding: '12px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
        textAlign: 'center'
      }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--st-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.08em' }}>Gross Budget</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(0.85rem, 3.6vw, 1.15rem)', fontWeight: 700, color: 'var(--st-text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {safeFormat(projectInfo?.budgetGross || 0)}
        </span>
        <span style={{ fontSize: '0.62rem', color: 'var(--st-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Build: {safeFormat(projectInfo?.budgetBuild || 0)}
        </span>
      </div>

      <div style={{
        backgroundColor: 'rgba(18, 20, 25, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(212, 183, 135, 0.3)',
        boxShadow: 'var(--shadow-sm), inset 0 1px 0 0 rgba(212, 183, 135, 0.25)',
        borderRadius: '12px',
        padding: '12px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
        textAlign: 'center'
      }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--st-gold)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.08em' }}>Draws Paid</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(0.85rem, 3.6vw, 1.15rem)', fontWeight: 700, color: 'var(--st-gold)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {safeFormat(projectInfo?.totalSpent || 0)}
        </span>
        <span style={{ fontSize: '0.62rem', color: 'var(--st-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Dep: {safeFormat(projectInfo?.deposits || 0)}
        </span>
      </div>

      <div style={{
        backgroundColor: 'rgba(18, 20, 25, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(157, 204, 174, 0.3)',
        boxShadow: 'var(--shadow-sm), inset 0 1px 0 0 rgba(157, 204, 174, 0.25)',
        borderRadius: '12px',
        padding: '12px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
        textAlign: 'center'
      }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--st-green)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.08em' }}>
          <Wallet size={11} /> Net Capital
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(0.85rem, 3.6vw, 1.15rem)', fontWeight: 700, color: 'var(--st-green)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {safeFormat(projectInfo?.capitalBalance || 0)}
        </span>
        <span style={{ fontSize: '0.62rem', color: 'var(--st-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Liquidity
        </span>
      </div>
    </div>
  );
}
