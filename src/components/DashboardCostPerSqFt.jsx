import React, { useState } from 'react';
import { ChevronDown, Ruler } from 'lucide-react';
import { formatPerSqFt } from '../services/sheetV2';

const OPEN_KEY = 'sitetactix_cost_per_sqft_open';

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

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * New-layout Sheets only: build cost and all-in cost per living and per total square foot (2×2).
 * Collapsed by default to one line; the open/closed choice is remembered on this device.
 */
export default function DashboardCostPerSqFt({ projectInfo = {} }) {
  const [open, setOpen] = useState(readOpen);
  if (projectInfo?.layout !== 'v2') return null;
  const cost = projectInfo.costPerSqFt || {};
  const missingSqft = !(Number(projectInfo.sqftLiving) > 0) || !(Number(projectInfo.sqftTotal) > 0);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? 'true' : 'false');
    } catch {
      // Remembering the choice is optional
    }
  };

  const cells = [
    { label: 'Build / living', value: cost.buildPerLiving },
    { label: 'Build / total', value: cost.buildPerTotal },
    { label: 'All-in / living', value: cost.allInPerLiving },
    { label: 'All-in / total', value: cost.allInPerTotal }
  ];
  const collapsedSummary = missingSqft ? 'Tap to see' : `All-in ${formatPerSqFt(cost.allInPerLiving)} / living sq ft`;

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
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%', minHeight: '32px', padding: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--st-gold)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Ruler size={11} /> Cost per sq ft
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--st-muted)' }}>
          {!open && collapsedSummary}
          <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </span>
      </button>
      {open && (
        <>
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
        </>
      )}
    </div>
  );
}
