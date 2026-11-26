import React, { useState } from 'react';
import { Camera, X, Copy, Check, FileText } from 'lucide-react';
import { paidToSub, overpaidAmount } from '../services/sheetV2.js';
import { formatMoney, parseMoney } from '../services/money.js';

const safeFormat = (val) => formatMoney(val, { cents: 'auto' });

function hasPhysicalSitePhotos(catName) {
  const norm = String(catName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return norm !== 'paperworkpermits' && norm !== 'projectoverheadbills';
}

function matchesAnyContractParty(vendor, contracts) {
  const v = String(vendor || '').trim().toLowerCase();
  if (!v) return false;
  return (Array.isArray(contracts) ? contracts : []).some(c => {
    const subName = String(c?.sub || '').trim().toLowerCase();
    const companyName = String(c?.company || '').trim().toLowerCase();
    return (subName && subName === v) || (companyName && companyName === v);
  });
}

export default function DashboardContractorDetail({
  selectedSub,
  onViewPhasePhotos,
  onOpenReceiptPdf,
  onClearSelection,
  onShowToast
}) {
  const [copied, setCopied] = useState(false);

  if (!selectedSub) {
    return null;
  }

  const hasV2Contracts = Array.isArray(selectedSub.contracts) && selectedSub.contracts.length > 0;
  const laborPayments = (selectedSub.payments || []).filter((p) => {
    const lab = p.rawLabor ?? parseMoney(p.laborCost);
    const mat = p.rawMaterial ?? parseMoney(p.materialCost);
    if (lab <= 0 || mat !== 0) return false;
    return !hasV2Contracts || matchesAnyContractParty(p.vendor, selectedSub.contracts);
  });

  const overpaid = overpaidAmount(selectedSub);
  const remaining = Number(selectedSub.remainingBalance) || 0;
  const isPaidInFull = overpaid === 0 && remaining === 0 && parseMoney(selectedSub.originalQuote) > 0;
  const balanceText = overpaid > 0 ? `Overpaid ${formatMoney(overpaid)}` : formatMoney(selectedSub.remainingBalance);

  const handleCopySummary = () => {
    let summaryText = `${selectedSub.payee} - ${selectedSub.phase} (${selectedSub.category})\nQuote: ${formatMoney(selectedSub.originalQuote)}\nPaid (${laborPayments.length}): ${formatMoney(paidToSub(selectedSub))}\nBalance: ${balanceText}`;

    if (laborPayments.length > 0) {
      summaryText += `\n\nPayment History Logs (${laborPayments.length}):`;
      laborPayments.forEach((p, idx) => {
        const lab = p.rawLabor ?? parseMoney(p.laborCost);
        const checkDetails = p.checkNumber && p.checkNumber !== 'N/A' ? ` - Check: ${p.checkNumber}` : '';
        const dateDetails = p.date ? `Date: ${p.date}` : 'Date: N/A';
        summaryText += `\n${idx + 1}. ${formatMoney(lab)} (${dateDetails}${checkDetails})`;
      });
    }

    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    if (onShowToast) {
      onShowToast(`Copied payment summary for ${selectedSub.payee}!`, 'success');
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const getTileFontSize = (val) => {
    const formatted = safeFormat(val);
    const len = formatted.length;
    if (len >= 11) return 'clamp(0.72rem, 3.2vw, 0.86rem)';
    if (len >= 9) return 'clamp(0.78rem, 3.6vw, 0.92rem)';
    return 'clamp(0.84rem, 4vw, 0.98rem)';
  };

  const showPhotosBtn = Boolean(onViewPhasePhotos) && hasPhysicalSitePhotos(selectedSub.category);

  return (
    <div style={{
      backgroundColor: 'var(--st-soft)',
      border: '1px solid var(--st-line)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
      borderRadius: '10px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      marginTop: '4px',
      width: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid var(--st-line)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.12rem', fontWeight: 700, color: 'var(--st-text)', letterSpacing: '-0.01em', margin: 0, wordBreak: 'break-word' }}>
              {selectedSub.payee}
            </h4>
            <p style={{ fontSize: '0.76rem', color: 'var(--st-muted)', marginTop: '3px', marginBottom: 0 }}>
              Phase: <strong style={{ color: 'var(--st-gold)', fontWeight: 600 }}>{selectedSub.phase}</strong> ({selectedSub.category})
            </p>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--st-line)',
              color: 'var(--st-muted)',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              flexShrink: 0
            }}
            title="Clear Selection"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          {showPhotosBtn && (
            <button
              type="button"
              onClick={() => onViewPhasePhotos({ category: selectedSub.category, phase: selectedSub.phase })}
              style={{
                flex: 1,
                background: 'rgba(212, 183, 135, 0.1)',
                border: '1px solid rgba(212, 183, 135, 0.3)',
                borderRadius: '20px',
                color: 'var(--st-gold)',
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '6px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
            >
              <Camera size={13} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Phase Photos</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopySummary}
            style={{
              flex: 1,
              background: 'var(--st-gold)',
              color: '#151719',
              border: '1px solid var(--st-gold)',
              borderRadius: '20px',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '6px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minWidth: 0,
              boxShadow: '0 2px 8px rgba(212, 183, 135, 0.22)'
            }}
          >
            {copied ? <Check size={13} style={{ color: '#151719', flexShrink: 0 }} /> : <Copy size={13} style={{ flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{copied ? 'Copied!' : 'Copy Summary'}</span>
          </button>
        </div>
      </div>

      {/* 3 Metric Tiles: QUOTE | PAID (N) | BALANCE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px', textAlign: 'center', width: '100%' }}>
        <div style={{ padding: '9px 4px', backgroundColor: 'var(--st-panel)', border: '1px solid var(--st-line)', borderRadius: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--st-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', display: 'block' }}>
            Quote
          </span>
          <div className="font-display" style={{ fontSize: getTileFontSize(selectedSub.originalQuote), fontWeight: 700, color: 'var(--st-text)', marginTop: '3px', whiteSpace: 'nowrap' }}>
            {safeFormat(selectedSub.originalQuote)}
          </div>
        </div>
        <div style={{ padding: '9px 4px', backgroundColor: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '0.62rem', color: '#7dd3fc', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', display: 'block' }}>
            Paid ({laborPayments.length})
          </span>
          <div className="font-display" style={{ fontSize: getTileFontSize(paidToSub(selectedSub)), fontWeight: 700, color: '#7dd3fc', marginTop: '3px', whiteSpace: 'nowrap' }}>
            {safeFormat(paidToSub(selectedSub))}
          </div>
        </div>
        <div style={{
          padding: '9px 4px',
          backgroundColor: overpaid > 0 ? 'rgba(248, 113, 113, 0.12)' : (isPaidInFull ? 'rgba(74, 222, 128, 0.1)' : 'rgba(212, 183, 135, 0.1)'),
          border: overpaid > 0 ? '1px solid rgba(248, 113, 113, 0.45)' : (isPaidInFull ? '1px solid rgba(74, 222, 128, 0.35)' : '1px solid rgba(212, 183, 135, 0.3)'),
          borderRadius: '8px',
          minWidth: 0
        }}>
          <span style={{ fontSize: '0.62rem', color: overpaid > 0 ? '#f87171' : (isPaidInFull ? '#4ade80' : 'var(--st-gold)'), textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', display: 'block' }}>
            {overpaid > 0 ? 'Overpaid' : 'Balance'}
          </span>
          <div className="font-display" style={{ fontSize: getTileFontSize(overpaid > 0 ? overpaid : selectedSub.remainingBalance), fontWeight: 700, color: overpaid > 0 ? '#f87171' : (isPaidInFull ? '#4ade80' : 'var(--st-gold)'), marginTop: '3px', whiteSpace: 'nowrap' }}>
            {safeFormat(overpaid > 0 ? overpaid : selectedSub.remainingBalance)}
          </div>
        </div>
      </div>

      {/* Draw Payment History */}
      <div>
        <span style={{ fontSize: '0.68rem', color: 'var(--st-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', display: 'block' }}>
          Payment History Logs ({laborPayments.length})
        </span>
        {laborPayments.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.76rem', color: 'var(--st-muted)', backgroundColor: 'var(--st-panel)', borderRadius: '8px', border: '1px dashed var(--st-line)' }}>
            No draw checks recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
            {[...laborPayments].reverse().map((p, idx) => {
              const lab = p.rawLabor ?? parseMoney(p.laborCost);
              const meta = [
                p.date && p.date !== 'N/A' ? `Date: ${p.date}` : null,
                p.checkNumber && p.checkNumber !== 'N/A' ? `Check: ${p.checkNumber}` : null
              ].filter(Boolean).join(' - ');

              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    backgroundColor: 'var(--st-panel)',
                    border: '1px solid var(--st-line)',
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--st-text)', fontSize: '0.77rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.vendor}
                    </div>
                    {meta && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--st-muted)', marginTop: '2px' }}>
                        {meta}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span style={{ fontWeight: 700, color: '#7dd3fc', fontSize: '0.8rem' }}>
                      {formatMoney(lab)}
                    </span>
                    {p.receiptUrl && onOpenReceiptPdf && (
                      <button
                        type="button"
                        onClick={() => onOpenReceiptPdf({ link: p.receiptUrl })}
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
    </div>
  );
}
