import React from 'react';
import { Plus, Search } from 'lucide-react';
import DashboardContractorDetail from './DashboardContractorDetail';
import { overpaidAmount } from '../services/sheetV2.js';
import { formatMoney } from '../services/money.js';

export default function DashboardContractorSearch({
  searchTerm,
  suggestions,
  selectedSub,
  hasAnyContracts = true,
  isV2Layout = false,
  quoteFiles = [],
  openPunchItems = [],
  onSearchTermChange,
  onSelectSubcontractor,
  onClearSelection,
  onViewPhasePhotos,
  onViewPunchList,
  onOpenReceiptPdf,
  onOpenQuoteModal,
  onEditQuote,
  onAddChangeOrder,
  onShowToast
}) {
  return (
    <div id="contractor-lookup-container" className="settings-card" style={{ border: '1px solid var(--st-line)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'nowrap' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(0.84rem, 3.6vw, 0.95rem)', fontWeight: 700, color: 'var(--st-text)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Search size={15} style={{ color: 'var(--st-gold)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Contractor Balance Lookup</span>
        </h3>

        {isV2Layout && onOpenQuoteModal && (
          <button
            type="button"
            onClick={onOpenQuoteModal}
            className="btn btn-primary"
            style={{
              width: 'auto',
              padding: '5px 10px',
              fontSize: '0.72rem',
              fontWeight: 700,
              borderRadius: '20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <Plus size={12} />
            <span>Add Quote</span>
          </button>
        )}
      </div>

      {hasAnyContracts ? (
        <>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search contracted sub or trade (e.g. Framing)..."
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              style={{ width: '100%', paddingLeft: '36px' }}
            />
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--st-muted)' }} />

            {searchTerm && suggestions.length > 0 && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                width: '100%',
                backgroundColor: 'var(--st-panel)',
                border: '1px solid var(--st-line)',
                borderRadius: '8px',
                zIndex: 900,
                maxHeight: '200px',
                overflowY: 'auto',
                boxShadow: '0 12px 32px rgba(0,0,0,0.6)'
              }}>
                {suggestions.map(sub => (
                  <div
                    key={sub.id}
                    onClick={() => onSelectSubcontractor(sub)}
                    style={{
                      padding: '10px 12px',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--st-line)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    className="project-profile-row"
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--st-text)' }}>{sub.payee}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--st-muted)', marginLeft: '6px' }}>({sub.phase})</span>
                    </div>
                    {overpaidAmount(sub) > 0 ? (
                      <span style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 600 }}>Overpaid {formatMoney(overpaidAmount(sub))}</span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--st-gold)', fontWeight: 600 }}>{formatMoney(sub.remainingBalance)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedSub && (
            <DashboardContractorDetail
              selectedSub={selectedSub}
              isV2Layout={isV2Layout}
              quoteFiles={quoteFiles}
              openPunchItems={openPunchItems}
              onViewPhasePhotos={onViewPhasePhotos}
              onViewPunchList={onViewPunchList}
              onOpenReceiptPdf={onOpenReceiptPdf}
              onEditQuote={onEditQuote}
              onAddChangeOrder={onAddChangeOrder}
              onClearSelection={onClearSelection}
              onShowToast={onShowToast}
            />
          )}
        </>
      ) : (
        <div style={{
          padding: '14px 12px',
          textAlign: 'center',
          fontSize: '0.78rem',
          color: 'var(--color-zinc-400)',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          border: '1px dashed var(--st-line)',
          borderRadius: '8px',
          lineHeight: 1.45
        }}>
          No subcontractor quotes added to <strong style={{ color: 'var(--st-text)' }}>Contracts</strong> yet. Tap <strong style={{ color: 'var(--st-gold)' }}>+ Add Quote</strong> above when a sub bid comes in.
        </div>
      )}
    </div>
  );
}
