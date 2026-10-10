import React from 'react';
import { Ruler } from 'lucide-react';
import { formatPerSqFt } from '../services/sheetV2';

const cellStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.25)',
  border: '1px solid var(--st-line)',
  borderRadius: '8px',
  padding: '8px 6px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
  textAlign: 'center'
};

const labelStyle = {
  fontSize: '0.6rem',
  color: 'var(--st-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const valueStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(0.85rem, 3.4vw, 1.05rem)',
  fontWeight: 700,
  color: 'var(--st-text)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap'
};

/** New-layout Sheets only: build cost and all-in cost per living and per total square foot (2×2). */
export default function DashboardCostPerSqFt({ projectInfo = {} }) {
  if (projectInfo?.layout !== 'v2') return null;
  const cost = projectInfo.costPerSqFt || {};
  const missingSqft = !(Number(projectInfo.sqftLiving) > 0) || !(Number(projectInfo.sqftTotal) > 0);

  const cells = [
    { label: 'Build / living', value: cost.buildPerLiving },
    { label: 'Build / total', value: cost.buildPerTotal },
    { label: 'All-in / living', value: cost.allInPerLiving },
    { label: 'All-in / total', value: cost.allInPerTotal }
  ];

  return (
    <div style={{
      backgroundColor: 'rgba(18, 20, 25, 0.75)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid var(--st-line)',
      boxShadow: 'var(--shadow-sm), var(--specular-highlight)',
      borderRadius: '12px',
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--st-gold)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Ruler size={11} /> Cost per sq ft
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
        {cells.map(cell => (
          <div key={cell.label} style={cellStyle}>
            <span style={labelStyle}>{cell.label}</span>
            <span style={valueStyle}>{formatPerSqFt(cell.value)}</span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: '0.6rem', color: 'var(--st-muted)', lineHeight: 1.35 }}>
        {missingSqft
          ? 'Add square footage in Settings → Edit project'
          : 'Build = spent + still owed to subs. All-in adds the lot.'}
      </span>
    </div>
  );
}
