import React, { useState } from 'react';
import { Camera, X, Copy, Check } from 'lucide-react';

export default function DashboardContractorDetail({
  selectedSub,
  formatCurrency,
  onViewPhasePhotos,
  onClearSelection,
  onShowToast
}) {
  const [copied, setCopied] = useState(false);

  if (!selectedSub) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', fontSize: '0.78rem', color: 'var(--color-zinc-500)', fontStyle: 'italic' }}>
        Type a contractor name or phase (e.g. "framing" or "paint") above to verify their quote & payments.
      </div>
    );
  }

  const safeFormatCurrency = (val) => {
    if (typeof formatCurrency === 'function') {
      return formatCurrency(val);
    }
    const num = parseFloat(String(val || 0).replace(/[^0-9.-]/g, '')) || 0;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const laborPayments = (selectedSub.payments || []).filter((p) => {
    const lab = parseFloat(String(p.laborCost || '').replace(/[^0-9.-]/g, '')) || 0;
    return lab > 0;
  });

  const handleCopySummary = () => {
    let summaryText = `${selectedSub.payee} - ${selectedSub.phase} (${selectedSub.category})\nQuote: ${safeFormatCurrency(selectedSub.originalQuote)}\nPaid (${laborPayments.length}): ${safeFormatCurrency(selectedSub.totalLabor || selectedSub.totalPaid || 0)}\nBalance: ${safeFormatCurrency(selectedSub.remainingBalance)}`;

    if (laborPayments.length > 0) {
      summaryText += `\n\nPayment History Logs (${laborPayments.length}):`;
      laborPayments.forEach((p, idx) => {
        const lab = parseFloat(String(p.laborCost || '').replace(/[^0-9.-]/g, '')) || 0;
        const checkDetails = p.checkNumber && p.checkNumber !== 'N/A' ? ` - Check: ${p.checkNumber}` : '';
        const dateDetails = p.date ? `Date: ${p.date}` : 'Date: N/A';
        summaryText += `\n${idx + 1}. ${safeFormatCurrency(lab)} (${dateDetails}${checkDetails})`;
      });
    }

    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    if (onShowToast) {
      onShowToast(`Copied payment summary for ${selectedSub.payee}!`, 'success');
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const getDynamicFontSize = (val) => {
    const formatted = safeFormatCurrency(val);
    const len = formatted.length;
    if (len >= 13) return '0.72rem';
    if (len >= 11) return '0.80rem';
    return '0.90rem';
  };

  return (
    <div style={{
      backgroundColor: 'var(--st-soft)',
      border: '1px solid var(--st-line)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
      borderRadius: '10px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      marginTop: '6px',
      width: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden',
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid var(--st-line)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--st-text)', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
              {selectedSub.payee}
            </h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--st-muted)', marginTop: '4px', marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              flexShrink: 0,
              transition: 'var(--transition-all)'
            }}
            title="Clear Selection"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
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
              minWidth: 0,
              transition: 'var(--transition-all)'
            }}
          >
            <Camera size={13} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>View Phase Photos</span>
          </button>
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
              boxShadow: '0 2px 8px rgba(212, 183, 135, 0.22)',
              transition: 'var(--transition-all)'
            }}
          >
            {copied ? <Check size={13} style={{ color: '#151719', flexShrink: 0 }} /> : <Copy size={13} style={{ flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{copied ? 'Copied!' : 'Copy Summary'}</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ padding: '10px 6px', backgroundColor: 'var(--st-panel)', border: '1px solid var(--st-line)', borderRadius: '8px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.66rem', color: 'var(--st-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', display: 'block' }}>
            Quote
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.originalQuote), fontWeight: 700, color: 'var(--st-text)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.originalQuote)}
          </div>
        </div>
        <div style={{ padding: '10px 6px', backgroundColor: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.66rem', color: '#7dd3fc', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', display: 'block' }}>
            Paid ({laborPayments.length})
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.totalLabor || selectedSub.totalPaid || 0), fontWeight: 700, color: '#7dd3fc', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.totalLabor || selectedSub.totalPaid || 0)}
          </div>
        </div>
        <div style={{ padding: '10px 6px', backgroundColor: 'rgba(212, 183, 135, 0.1)', border: '1px solid rgba(212, 183, 135, 0.3)', borderRadius: '8px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.66rem', color: 'var(--st-gold)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', display: 'block' }}>
            Balance
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.remainingBalance), fontWeight: 700, color: 'var(--st-gold)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.remainingBalance)}
          </div>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--st-muted)', display: 'block', marginBottom: '8px' }}>
          Payment History Logs ({laborPayments.length})
        </span>

        {laborPayments.length === 0 ? (
          <p style={{ fontSize: '0.72rem', color: 'var(--st-muted)', fontStyle: 'italic', padding: '6px 0', margin: 0 }}>
            No labor payments recorded yet for this contractor.
          </p>
        ) : (
          <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {laborPayments.map((p, idx) => {
              const lab = parseFloat(String(p.laborCost || '').replace(/[^0-9.-]/g, '')) || 0;
              return (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  backgroundColor: 'var(--st-panel)',
                  border: '1px solid var(--st-line)',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  color: 'var(--st-text)'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--st-text)' }}>{p.vendor}</span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--st-muted)' }}>
                      Date: {p.date} {p.checkNumber && p.checkNumber !== 'N/A' ? `- Check: ${p.checkNumber}` : ''}
                    </span>
                  </div>

                  <div style={{ textAlign: 'right', fontWeight: 700, color: '#7dd3fc', fontSize: '0.82rem' }}>
                    {safeFormatCurrency(lab)}
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
