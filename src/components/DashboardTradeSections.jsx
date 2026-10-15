import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { categoryRank } from '../config/tradeCategories.js';
import { formatMoney, parseMoney as parseCurrencyNumber } from '../services/money.js';

const safeFormat = (val) => formatMoney(val, { cents: 'auto' });

function PhaseMetricGroup({ sub }) {
  const phaseTotal = sub.totalSpent || (
    parseCurrencyNumber(sub.totalMaterial) +
    parseCurrencyNumber(sub.totalLabor)
  );

  const totalNum = parseCurrencyNumber(phaseTotal);
  const matNum = parseCurrencyNumber(sub.totalMaterial);
  const labNum = parseCurrencyNumber(sub.totalLabor);
  const hasPhaseActivity = totalNum > 0 || matNum > 0 || labNum > 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        color: hasPhaseActivity ? 'var(--st-gold)' : 'var(--st-muted)',
        backgroundColor: hasPhaseActivity ? 'rgba(212, 183, 135, 0.12)' : 'rgba(0, 0, 0, 0.25)',
        padding: '3px 4px',
        borderRadius: '5px',
        border: hasPhaseActivity ? '1px solid rgba(212, 183, 135, 0.25)' : '1px solid var(--st-line)',
        fontSize: 'clamp(0.58rem, 2vw, 0.66rem)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        boxSizing: 'border-box'
      }}>
        Mat: {safeFormat(sub.totalMaterial || 0)}
      </div>

      <div style={{
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        color: hasPhaseActivity ? '#7dd3fc' : 'var(--st-muted)',
        backgroundColor: hasPhaseActivity ? 'rgba(56, 189, 248, 0.12)' : 'rgba(0, 0, 0, 0.25)',
        padding: '3px 4px',
        borderRadius: '5px',
        border: hasPhaseActivity ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid var(--st-line)',
        fontSize: 'clamp(0.58rem, 2vw, 0.66rem)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        boxSizing: 'border-box'
      }}>
        Lab: {safeFormat(sub.totalLabor || 0)}
      </div>

      <div style={{
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        color: hasPhaseActivity ? '#86efac' : 'var(--st-muted)',
        backgroundColor: hasPhaseActivity ? 'rgba(74, 222, 128, 0.12)' : 'rgba(0, 0, 0, 0.25)',
        padding: '3px 4px',
        borderRadius: '5px',
        border: hasPhaseActivity ? '1px solid rgba(74, 222, 128, 0.25)' : '1px solid var(--st-line)',
        fontSize: 'clamp(0.58rem, 2vw, 0.66rem)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        boxSizing: 'border-box'
      }}>
        Total: {safeFormat(phaseTotal)}
      </div>
    </div>
  );
}

export default function DashboardTradeSections({
  categories = [],
  subcontractors = [],
  expandedCategories = {},
  onToggleCategory,
  onSelectSubcontractor
}) {
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeSubcontractors = Array.isArray(subcontractors) ? subcontractors : [];

  const sortedCategories = [...safeCategories].sort((a, b) => {
    const rankA = categoryRank(a.name);
    const rankB = categoryRank(b.name);
    if (rankA !== rankB) return rankA - rankB;
    return (a.name || '').localeCompare(b.name || '');
  });

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--st-text)', marginBottom: '10px' }}>
        Trade Sections & Phase Totals
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sortedCategories.map((cat) => {
          const isExpanded = !!expandedCategories[cat.name];
          const catSubs = safeSubcontractors.filter(sub => sub.category === cat.name);
          const catPaid = parseCurrencyNumber(cat.totalPaid);
          const catMat = parseCurrencyNumber(cat.totalMaterial);
          const catLab = parseCurrencyNumber(cat.totalLabor);
          const hasCatActivity = catPaid > 0 || catMat > 0 || catLab > 0;

          return (
            <div
              key={cat.name}
              style={{
                border: isExpanded
                  ? '1px solid var(--st-gold)'
                  : (hasCatActivity ? '1px solid var(--st-line)' : '1px solid rgba(255, 255, 255, 0.05)'),
                borderRadius: '10px',
                overflow: 'hidden',
                backgroundColor: 'var(--st-panel)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: isExpanded
                  ? '0 6px 20px rgba(0, 0, 0, 0.35), 0 0 10px rgba(212, 183, 135, 0.08)'
                  : '0 2px 8px rgba(0, 0, 0, 0.2)',
                transition: 'all 0.25s ease'
              }}
            >
              {/* Category Card Header - Structured 2-Row Layout */}
              <div
                onClick={() => onToggleCategory(cat.name)}
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  backgroundColor: isExpanded ? 'rgba(0, 0, 0, 0.15)' : 'transparent',
                  borderBottom: isExpanded ? '1px solid var(--st-line)' : 'none',
                  transition: 'background-color 0.2s ease'
                }}
              >
                {/* Row 1: Category Title + Phase Count & Expand Arrow */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    color: hasCatActivity || isExpanded ? 'var(--st-text)' : 'var(--st-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    lineHeight: '1.2',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {cat.name}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span style={{ color: 'var(--st-muted)', fontSize: '0.7rem', fontWeight: 600 }}>
                      {cat.phasesCount} Phase{cat.phasesCount > 1 ? 's' : ''}
                    </span>
                    {isExpanded ? <ChevronUp size={16} style={{ color: 'var(--st-gold)' }} /> : <ChevronDown size={16} style={{ color: 'var(--st-muted)' }} />}
                  </div>
                </div>

                {/* Row 2: Fixed 3-Column Pill Bar (Mat, Lab, Spent) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: hasCatActivity ? 'var(--st-gold)' : 'var(--st-muted)',
                    backgroundColor: hasCatActivity ? 'rgba(212, 183, 135, 0.12)' : 'var(--st-soft)',
                    padding: '3px 4px',
                    borderRadius: '5px',
                    border: hasCatActivity ? '1px solid rgba(212, 183, 135, 0.25)' : '1px solid var(--st-line)',
                    fontSize: 'clamp(0.58rem, 2vw, 0.68rem)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    opacity: hasCatActivity ? 1 : 0.85
                  }}>
                    Mat: {safeFormat(cat.totalMaterial || 0)}
                  </div>

                  <div style={{
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: hasCatActivity ? '#7dd3fc' : 'var(--st-muted)',
                    backgroundColor: hasCatActivity ? 'rgba(56, 189, 248, 0.12)' : 'var(--st-soft)',
                    padding: '3px 4px',
                    borderRadius: '5px',
                    border: hasCatActivity ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid var(--st-line)',
                    fontSize: 'clamp(0.58rem, 2vw, 0.68rem)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    opacity: hasCatActivity ? 1 : 0.85
                  }}>
                    Lab: {safeFormat(cat.totalLabor || 0)}
                  </div>

                  <div style={{
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: hasCatActivity ? '#86efac' : 'var(--st-muted)',
                    backgroundColor: hasCatActivity ? 'rgba(74, 222, 128, 0.12)' : 'var(--st-soft)',
                    padding: '3px 4px',
                    borderRadius: '5px',
                    border: hasCatActivity ? '1px solid rgba(74, 222, 128, 0.25)' : '1px solid var(--st-line)',
                    fontSize: 'clamp(0.58rem, 2vw, 0.68rem)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    opacity: hasCatActivity ? 1 : 0.85
                  }}>
                    Spent: {safeFormat(cat.totalPaid || 0)}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: 'rgba(15, 17, 19, 0.55)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                    {catSubs.map(sub => {
                      const cleanPayee = String(sub.payee || '').trim();
                      const cleanPhase = String(sub.phase || '').trim();
                      const isPlaceholder = !cleanPayee ||
                        cleanPayee.toLowerCase() === cleanPhase.toLowerCase() ||
                        cleanPayee.toLowerCase().endsWith('payee') ||
                        cleanPayee.toLowerCase() === `${cleanPhase.toLowerCase()} payee`;

                      // Only a sub with a contract is named; phases bought as material show no label
                      const isAssigned = !isPlaceholder;
                      const displayPayee = isAssigned ? cleanPayee : null;

                      return (
                        <div
                          key={sub.id}
                          onClick={() => onSelectSubcontractor(sub)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--st-soft)',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            border: '1px solid var(--st-line)',
                            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                          className="project-profile-row"
                        >
                          {/* Row 1: Phase name on the left, the sub (if any) on the right */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', width: '100%' }}>
                            <span style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 600,
                              color: 'var(--st-text)',
                              fontSize: '0.82rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1
                            }}>
                              {sub.phase}
                            </span>
                            {displayPayee && (
                              <span style={{
                                fontWeight: 600,
                                color: 'var(--st-gold)',
                                fontSize: '0.72rem',
                                flexShrink: 0
                              }}>
                                {displayPayee}
                              </span>
                            )}
                          </div>

                          {/* Row 2: Fixed 3-Column Pill Bar (Mat, Lab, Total) */}
                          <PhaseMetricGroup sub={sub} />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
