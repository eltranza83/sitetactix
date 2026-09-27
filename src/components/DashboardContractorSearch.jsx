import React from 'react';
import { Search } from 'lucide-react';
import DashboardContractorDetail from './DashboardContractorDetail';

export default function DashboardContractorSearch({
  searchTerm,
  suggestions,
  selectedSub,
  formatCurrency,
  getStatusStyle,
  onSearchTermChange,
  onSelectSubcontractor,
  onClearSelection,
  onViewPhasePhotos,
  onShowToast
}) {
  return (
    <div id="contractor-lookup-container" className="settings-card" style={{ border: '1px solid var(--st-line)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--st-text)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
        <Search size={16} style={{ color: 'var(--st-gold)' }} />
        Contractor Balance Lookup
      </h3>

      <div style={{ position: 'relative' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search payee or trade (e.g. Framing)..."
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
                <span style={{ fontSize: '0.75rem', color: 'var(--st-gold)', fontWeight: 600 }}>{formatCurrency(sub.remainingBalance)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <DashboardContractorDetail
        selectedSub={selectedSub}
        formatCurrency={formatCurrency}
        getStatusStyle={getStatusStyle}
        onViewPhasePhotos={onViewPhasePhotos}
        onClearSelection={onClearSelection}
        onShowToast={onShowToast}
      />
    </div>
  );
}
