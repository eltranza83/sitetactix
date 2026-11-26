import React, { useState } from 'react';
import { Camera, ChevronDown, ChevronUp, FileText } from 'lucide-react';

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
  onSelectSubcontractor,
  onViewPhasePhotos,
  onOpenReceiptPdf
}) {
  const [expandedPhases, setExpandedPhases] = useState({});

  const togglePhase = (phaseId) => {
    setExpandedPhases(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

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
        Trade Sections &amp; Phase Totals
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
                    const hasContract = Array.isArray(sub.contracts) ? sub.contracts.length > 0 : Boolean(
                      cleanPayee &&
                      cleanPayee.toLowerCase() !== cleanPhase.toLowerCase() &&
                      !cleanPayee.toLowerCase().endsWith('payee') &&
                      cleanPayee.toLowerCase() !== `${cleanPhase.toLowerCase()} payee`
                    );
                    const displayPayee = hasContract ? cleanPayee : null;
                    const isPhaseOpen = !!expandedPhases[sub.id];
                    const phasePayments = Array.isArray(sub.payments) ? [...sub.payments].reverse() : [];

                    return (
                      <div
                        key={sub.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: '8px',
                          backgroundColor: 'var(--st-soft)',
                          fontSize: '0.78rem',
                          border: isPhaseOpen ? '1px solid rgba(212, 183, 135, 0.4)' : '1px solid var(--st-line)',
                          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)',
                          overflow: 'hidden',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        <div
                          onClick={() => togglePhase(sub.id)}
                          className="project-profile-row"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            padding: '10px 12px',
                            cursor: 'pointer'
                          }}
                        >
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              {displayPayee && (
                                <span style={{
                                  fontWeight: 600,
                                  color: 'var(--st-gold)',
                                  fontSize: '0.72rem'
                                }}>
                                  {displayPayee}
                                </span>
                              )}
                              {phasePayments.length > 0 && (
                                <span style={{ fontSize: '0.66rem', color: 'var(--st-muted)', fontWeight: 600 }}>
                                  ({phasePayments.length})
                                </span>
                              )}
                              {isPhaseOpen
                                ? <ChevronUp size={14} style={{ color: 'var(--st-gold)' }} />
                                : <ChevronDown size={14} style={{ color: 'var(--st-muted)' }} />}
                            </div>
                          </div>

                          <PhaseMetricGroup sub={sub} />
                        </div>

                        {isPhaseOpen && (
                          <div style={{
                            borderTop: '1px solid var(--st-line)',
                            backgroundColor: 'rgba(0, 0, 0, 0.28)',
                            padding: '10px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--st-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Phase Transactions ({phasePayments.length})
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {hasContract && onSelectSubcontractor && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectSubcontractor(sub);
                                    }}
                                    style={{
                                      background: 'rgba(212, 183, 135, 0.14)',
                                      border: '1px solid rgba(212, 183, 135, 0.35)',
                                      color: 'var(--st-gold)',
                                      borderRadius: '14px',
                                      padding: '3px 9px',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Contract Balance →
                                  </button>
                                )}
                                {onViewPhasePhotos && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onViewPhasePhotos({ category: sub.category, phase: sub.phase });
                                    }}
                                    style={{
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '1px solid var(--st-line)',
                                      color: 'var(--st-text)',
                                      borderRadius: '14px',
                                      padding: '3px 9px',
                                      fontSize: '0.68rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <Camera size={11} style={{ color: 'var(--st-gold)' }} />
                                    <span>Phase Photos</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {phasePayments.length === 0 ? (
                              <div style={{ fontSize: '0.73rem', color: 'var(--color-zinc-500)', fontStyle: 'italic', padding: '4px 0' }}>
                                No receipts or checks recorded in this phase yet.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {phasePayments.map((p, idx) => {
                                  const matVal = p.rawMaterial ?? parseCurrencyNumber(p.materialCost);
                                  const labVal = p.rawLabor ?? parseCurrencyNumber(p.laborCost);
                                  const isLabor = labVal !== 0 && matVal === 0;
                                  const displayAmt = isLabor ? labVal : matVal;
                                  const paymentMeta = [
                                    p.date && p.date !== 'N/A' ? p.date : null,
                                    p.checkNumber && p.checkNumber !== 'N/A' ? p.checkNumber : null
                                  ].filter(Boolean).join(' · ');

                                  return (
                                    <div
                                      key={`${p.rowNumber || idx}_${p.vendor}`}
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '7px 9px',
                                        borderRadius: '6px',
                                        backgroundColor: 'var(--st-panel)',
                                        border: '1px solid var(--st-line)'
                                      }}
                                    >
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--st-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {p.vendor}
                                        </div>
                                        {p.description && (
                                          <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                                            {p.description}
                                          </div>
                                        )}
                                        {paymentMeta && (
                                          <div style={{ fontSize: '0.66rem', color: 'var(--st-muted)', marginTop: '2px' }}>
                                            {paymentMeta}
                                          </div>
                                        )}
                                      </div>

                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                        <span style={{
                                          fontSize: '0.62rem',
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          padding: '2px 5px',
                                          borderRadius: '4px',
                                          color: isLabor ? '#7dd3fc' : 'var(--st-gold)',
                                          backgroundColor: isLabor ? 'rgba(56, 189, 248, 0.12)' : 'rgba(212, 183, 135, 0.12)'
                                        }}>
                                          {isLabor ? 'Lab' : 'Mat'}
                                        </span>
                                        <span style={{ fontWeight: 700, fontSize: '0.78rem', color: isLabor ? '#7dd3fc' : 'var(--st-text)' }}>
                                          {formatMoney(displayAmt)}
                                        </span>
                                        {p.receiptUrl && onOpenReceiptPdf && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenReceiptPdf({ link: p.receiptUrl });
                                            }}
                                            className="btn btn-secondary"
                                            style={{
                                              width: 'auto',
                                              padding: '3px 7px',
                                              fontSize: '0.68rem',
                                              borderRadius: '5px',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '3px'
                                            }}
                                            title="Open scanned receipt PDF"
                                          >
                                            <FileText size={11} />
                                            <span>PDF</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
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
