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
      background: 'linear-gradient(145deg, #18181c 0%, #0d0d0f 100%)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(197, 160, 89, 0.38)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7), 0 0 20px rgba(197, 160, 89, 0.12)',
      borderRadius: '16px',
      padding: '16px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      marginTop: '8px',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px', position: 'relative' }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: '40px' }}>
          <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedSub.payee}</h4>
          <p style={{ fontSize: '0.76rem', color: 'var(--color-zinc-400)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Phase: <strong style={{ color: 'var(--color-amber-400)' }}>{selectedSub.phase}</strong> ({selectedSub.category})
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '10px', flexWrap: 'nowrap' }}>
            <button
              type="button"
              onClick={() => onViewPhasePhotos({ category: selectedSub.category, phase: selectedSub.phase })}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(197, 160, 89, 0.35)',
                borderRadius: '20px',
                color: 'var(--color-amber-400)',
                fontSize: '0.7rem',
                fontWeight: 700,
                padding: '4px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              <Camera size={13} /> View Phase Photos
            </button>
            <button
              type="button"
              onClick={handleCopySummary}
              style={{
                background: 'linear-gradient(135deg, #c5a059 0%, #a37c35 100%)',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: '20px',
                fontSize: '0.7rem',
                fontWeight: 800,
                padding: '5px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(197, 160, 89, 0.3)'
              }}
            >
              {copied ? <Check size={13} style={{ color: '#000000' }} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy Summary'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'absolute', right: '0', top: '0', height: '100%', maxHeight: '32px' }}>
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--color-zinc-400)',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              transition: 'all 0.15s'
            }}
            title="Clear Selection"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ padding: '10px 4px', backgroundColor: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '10px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.64rem', color: 'var(--color-zinc-400)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>
            Quote
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.originalQuote), fontWeight: 800, color: '#ffffff', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.originalQuote)}
          </div>
        </div>
        <div style={{ padding: '10px 4px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '10px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.64rem', color: '#60a5fa', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>
            Paid ({laborPayments.length})
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.totalLabor || selectedSub.totalPaid || 0), fontWeight: 800, color: '#60a5fa', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.totalLabor || selectedSub.totalPaid || 0)}
          </div>
        </div>
        <div style={{ padding: '10px 4px', backgroundColor: 'rgba(197, 160, 89, 0.1)', border: '1px solid rgba(197, 160, 89, 0.35)', borderRadius: '10px', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.64rem', color: 'var(--color-amber-400)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>
            Balance
          </span>
          <div className="font-display" style={{ fontSize: getDynamicFontSize(selectedSub.remainingBalance), fontWeight: 800, color: 'var(--color-amber-400)', marginTop: '4px', textShadow: '0 0 10px rgba(197, 160, 89, 0.3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {safeFormatCurrency(selectedSub.remainingBalance)}
          </div>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-zinc-400)', display: 'block', marginBottom: '6px' }}>
          Payment History Logs ({laborPayments.length})
        </span>

        {laborPayments.length === 0 ? (
          <p style={{ fontSize: '0.72rem', color: 'var(--color-zinc-600)', fontStyle: 'italic', padding: '6px 0' }}>
            No labor payments recorded yet for this contractor.
          </p>
        ) : (
          <div style={{ maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {laborPayments.map((p, idx) => {
              const lab = parseFloat(String(p.laborCost || '').replace(/[^0-9.-]/g, '')) || 0;
              return (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 8px',
                  backgroundColor: 'var(--color-zinc-900)',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  color: 'var(--color-zinc-300)'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600 }}>{p.vendor}</span>
                    <span style={{ fontSize: '0.62rem', color: 'var(--color-zinc-500)' }}>
                      Date: {p.date} {p.checkNumber && p.checkNumber !== 'N/A' ? `- Check: ${p.checkNumber}` : ''}
                    </span>
                  </div>

                  <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-blue-400)' }}>
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
