import React, { useState } from 'react';
import { Camera, ChevronDown, ChevronUp, FileText } from 'lucide-react';

import { TRADE_CATEGORIES, categoryRank } from '../config/tradeCategories.js';
import { formatMoney, parseMoney as parseCurrencyNumber } from '../services/money.js';

const safeFormat = (val) => formatMoney(val, { cents: 'auto' });

function getCategoryColor(catName) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(catName);
  const found = TRADE_CATEGORIES.find(c => norm(c.name) === target || norm(c.key) === target);
  return found?.color || '#d4b787';
}

function hasPhysicalSitePhotos(catName) {
  const norm = String(catName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return norm !== 'paperworkpermits' && norm !== 'projectoverheadbills';
}

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

function TransactionRowItem({ payment, onOpenReceiptPdf }) {
  const matVal = payment.rawMaterial ?? parseCurrencyNumber(payment.materialCost);
  const labVal = payment.rawLabor ?? parseCurrencyNumber(payment.laborCost);
  const isLabor = labVal !== 0 && matVal === 0;
  const displayAmt = isLabor ? labVal : matVal;

  const paymentMeta = [
    payment.date && payment.date !== 'N/A' ? payment.date : null,
    payment.checkNumber && payment.checkNumber !== 'N/A' ? payment.checkNumber : null
  ].filter(Boolean).join(' · ');

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 9px',
        borderRadius: '6px',
        backgroundColor: 'var(--st-panel)',
        border: '1px solid var(--st-line)',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--st-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {payment.vendor}
        </div>
        {payment.description && (
          <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
            {payment.description}
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
        {payment.receiptUrl && onOpenReceiptPdf && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenReceiptPdf({ link: payment.receiptUrl });
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
}

/**
 * Option 3 (Smart Hybrid):
 * - Master Category Header (colored left stripe + full title + big Category Total on right + Mat • Lab • Phases row)
 * - Indented child phases: active phases show 3-column Mat | Lab | Total pills; untouched $0 phases stay quiet 1-line rows
 * - Expanding any phase shows ONLY the clean Phase Expenses list (Sub contract quotes/balances live up in Contractor Balance Lookup)
 */
export default function DashboardTradeSections({
  categories = [],
  subcontractors = [],
  expandedCategories = {},
  defaultExpandedPhases = {},
  onToggleCategory,
  onSelectSubcontractor,
  onViewPhasePhotos,
  onOpenReceiptPdf
}) {
  const [expandedPhases, setExpandedPhases] = useState(defaultExpandedPhases);

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
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.98rem', fontWeight: 700, color: 'var(--st-text)', marginBottom: '10px' }}>
        Trade Sections &amp; Phase Totals
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {sortedCategories.map((cat) => {
          const isExpanded = !!expandedCategories[cat.name];
          const catSubs = safeSubcontractors.filter(sub => sub.category === cat.name);
          const catPaid = parseCurrencyNumber(cat.totalPaid);
          const catMat = parseCurrencyNumber(cat.totalMaterial);
          const catLab = parseCurrencyNumber(cat.totalLabor);
          const hasCatActivity = catPaid > 0 || catMat > 0 || catLab > 0;
          const accentColor = getCategoryColor(cat.name);

          return (
            <div
              key={cat.name}
              style={{
                border: isExpanded
                  ? '1px solid rgba(212, 183, 135, 0.48)'
                  : (hasCatActivity ? '1px solid var(--st-line)' : '1px solid rgba(255, 255, 255, 0.05)'),
                borderLeft: hasCatActivity || isExpanded
                  ? `4px solid ${accentColor}`
                  : '4px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '11px',
                overflow: 'hidden',
                backgroundColor: 'var(--st-panel)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: isExpanded
                  ? '0 8px 24px rgba(0, 0, 0, 0.42)'
                  : '0 2px 8px rgba(0, 0, 0, 0.2)',
                transition: 'all 0.25s ease'
              }}
            >
              {/* Master Category Header */}
              <div
                onClick={() => onToggleCategory(cat.name)}
                style={{
                  padding: '13px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: isExpanded
                    ? 'linear-gradient(90deg, rgba(212, 183, 135, 0.09) 0%, rgba(255, 255, 255, 0.02) 100%)'
                    : (hasCatActivity ? 'linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)' : 'transparent'),
                  borderBottom: isExpanded ? '1px solid var(--st-line)' : 'none',
                  transition: 'background 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(0.77rem, 3.4vw, 0.92rem)',
                    fontWeight: 800,
                    color: hasCatActivity || isExpanded ? '#ffffff' : 'var(--st-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    lineHeight: 1.25,
                    minWidth: 0,
                    flex: 1
                  }}>
                    {cat.name}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: hasCatActivity ? 'clamp(0.92rem, 4vw, 1.06rem)' : '0.85rem',
                      fontWeight: 800,
                      color: hasCatActivity ? '#86efac' : 'var(--st-muted)',
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap'
                    }}>
                      {safeFormat(cat.totalPaid || 0)}
                    </span>
                    {isExpanded
                      ? <ChevronUp size={16} style={{ color: 'var(--st-gold)' }} />
                      : <ChevronDown size={16} style={{ color: 'var(--st-muted)' }} />}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.7rem', color: 'var(--st-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: hasCatActivity ? 'var(--st-gold)' : 'rgba(255,255,255,0.18)' }} />
                      <span>Mat: <strong style={{ color: hasCatActivity ? 'var(--st-gold)' : 'var(--st-muted)', fontWeight: 600 }}>{safeFormat(cat.totalMaterial || 0)}</strong></span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: hasCatActivity ? '#7dd3fc' : 'rgba(255,255,255,0.18)' }} />
                      <span>Lab: <strong style={{ color: hasCatActivity ? '#7dd3fc' : 'var(--st-muted)', fontWeight: 600 }}>{safeFormat(cat.totalLabor || 0)}</strong></span>
                    </span>
                  </div>

                  <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--st-muted)' }}>
                    {cat.phasesCount} {cat.phasesCount === 1 ? 'Phase' : 'Phases'}
                  </span>
                </div>
              </div>

              {/* Indented Phases Drawer */}
              {isExpanded && (
                <div style={{
                  padding: '10px 10px 10px 11px',
                  backgroundColor: 'rgba(8, 9, 11, 0.72)'
                }}>
                  <div style={{
                    paddingLeft: '9px',
                    borderLeft: `2px solid ${accentColor}45`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {catSubs.map(sub => {
                      const cleanPayee = String(sub.payee || '').trim();
                      const cleanPhase = String(sub.phase || '').trim();
                      const hasV2Contracts = Array.isArray(sub.contracts) && sub.contracts.length > 0;
                      const hasLegacyContract = !Array.isArray(sub.contracts) && Boolean(
                        cleanPayee &&
                        cleanPayee.toLowerCase() !== cleanPhase.toLowerCase() &&
                        !cleanPayee.toLowerCase().endsWith('payee') &&
                        cleanPayee.toLowerCase() !== `${cleanPhase.toLowerCase()} payee` &&
                        parseCurrencyNumber(sub.originalQuote) > 0
                      );
                      const hasContract = hasV2Contracts || hasLegacyContract;
                      const displayPayee = hasContract ? cleanPayee : null;
                      const isPhaseOpen = !!expandedPhases[sub.id];
                      const allPhasePayments = Array.isArray(sub.payments) ? [...sub.payments].reverse() : [];

                      const phaseMat = parseCurrencyNumber(sub.totalMaterial);
                      const phaseLab = parseCurrencyNumber(sub.totalLabor);
                      const phaseTotal = parseCurrencyNumber(sub.totalSpent || (phaseMat + phaseLab));
                      const isPhaseActive = hasContract || phaseTotal > 0 || phaseMat > 0 || phaseLab > 0;

                      return (
                        <div
                          key={sub.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            borderRadius: '9px',
                            backgroundColor: isPhaseActive ? 'var(--st-soft)' : 'rgba(255, 255, 255, 0.015)',
                            fontSize: '0.78rem',
                            border: isPhaseOpen
                              ? '1px solid rgba(212, 183, 135, 0.45)'
                              : (isPhaseActive ? '1px solid var(--st-line)' : '1px solid rgba(255, 255, 255, 0.05)'),
                            overflow: 'hidden',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        >
                          {/* Phase Header */}
                          <div
                            onClick={() => togglePhase(sub.id)}
                            className="project-profile-row"
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              padding: isPhaseActive ? '10px 11px' : '8px 11px',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', width: '100%' }}>
                              <span style={{
                                fontFamily: 'var(--font-sans)',
                                fontWeight: isPhaseActive ? 600 : 500,
                                color: isPhaseActive ? 'var(--st-text)' : 'var(--st-muted)',
                                fontSize: isPhaseActive ? '0.84rem' : '0.78rem',
                                minWidth: 0,
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {sub.phase}
                              </span>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                {!isPhaseActive && (
                                  <span style={{ fontSize: '0.72rem', color: 'var(--st-muted)', opacity: 0.75 }}>$0</span>
                                )}
                                {allPhasePayments.length > 0 && (
                                  <span style={{ fontSize: '0.66rem', color: 'var(--st-muted)', fontWeight: 600 }}>
                                    ({allPhasePayments.length})
                                  </span>
                                )}
                                {isPhaseOpen
                                  ? <ChevronUp size={14} style={{ color: 'var(--st-gold)' }} />
                                  : <ChevronDown size={14} style={{ color: 'var(--st-muted)', opacity: isPhaseActive ? 1 : 0.6 }} />}
                              </div>
                            </div>

                            {/* Left-aligned tappable Subcontractor link (~200px away from the right-side expand arrow so thumbs never mis-tap) */}
                            {displayPayee && (
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                {onSelectSubcontractor ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectSubcontractor(sub);
                                    }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'var(--st-gold)',
                                      padding: '2px 0',
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      maxWidth: '100%'
                                    }}
                                    title="Open Contract Balance above"
                                  >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationColor: 'rgba(212, 183, 135, 0.45)', textUnderlineOffset: '3px' }}>
                                      {displayPayee}
                                    </span>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, flexShrink: 0 }}>↗</span>
                                  </button>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--st-gold)' }}>
                                    {displayPayee}
                                  </span>
                                )}
                              </div>
                            )}

                            {isPhaseActive && <PhaseMetricGroup sub={sub} />}
                          </div>

                          {/* Simple, Uniform Phase Expenses List */}
                          {isPhaseOpen && (
                            <div style={{
                              borderTop: '1px solid var(--st-line)',
                              backgroundColor: 'rgba(0, 0, 0, 0.32)',
                              padding: '10px 11px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.67rem', fontWeight: 700, color: 'var(--st-gold)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                  Phase Expenses ({allPhasePayments.length})
                                </span>
                                {onViewPhasePhotos && hasPhysicalSitePhotos(sub.category) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onViewPhasePhotos({ category: sub.category, phase: sub.phase });
                                    }}
                                    style={{
                                      background: 'rgba(212, 183, 135, 0.1)',
                                      border: '1px solid rgba(212, 183, 135, 0.3)',
                                      color: 'var(--st-gold)',
                                      borderRadius: '14px',
                                      padding: '4px 9px',
                                      fontSize: '0.68rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <Camera size={11} />
                                    <span>Photos</span>
                                  </button>
                                )}
                              </div>

                              {allPhasePayments.length === 0 ? (
                                <div style={{ fontSize: '0.73rem', color: 'var(--color-zinc-500)', fontStyle: 'italic', padding: '4px 0' }}>
                                  No receipts or checks recorded in this phase yet.
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto', width: '100%' }}>
                                  {allPhasePayments.map((p, idx) => (
                                    <TransactionRowItem
                                      key={`tx_${p.rowNumber || idx}_${p.vendor}`}
                                      payment={p}
                                      onOpenReceiptPdf={onOpenReceiptPdf}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
