import React, { useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { filterHistoryItems } from '../services/historySync';

export default function HistoryTab({
  history = [],
  onViewPDF,
  onDeleteItem,
  onClearAll
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [costFilter, setCostFilter] = useState('all'); // 'all' | 'material' | 'labor'

  const filteredHistory = useMemo(
    () => filterHistoryItems(history, { query: searchQuery, costFilter }),
    [history, searchQuery, costFilter]
  );

  const hasActiveFilter = Boolean(searchQuery.trim()) || costFilter !== 'all';

  return (
    <div key="history-subtab" className="slide-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
          Sync Log &amp; History ({hasActiveFilter ? `${filteredHistory.length}/${history.length}` : history.length})
        </h2>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="btn btn-secondary"
            style={{
              width: 'auto',
              padding: '4px 10px',
              fontSize: '0.74rem',
              color: '#f87171',
              borderColor: 'rgba(239, 68, 68, 0.3)',
              backgroundColor: 'rgba(239, 68, 68, 0.05)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0
            }}
          >
            <Trash2 size={13} />
            <span>Clear All</span>
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '11px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--st-muted)',
                pointerEvents: 'none'
              }}
            />
            <input
              type="text"
              className="form-input"
              placeholder="Search vendor, phase, description, or amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '34px', paddingRight: searchQuery ? '34px' : '12px', fontSize: '0.82rem' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--st-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'material', label: 'Material' },
              { id: 'labor', label: 'Labor' }
            ].map(tab => {
              const active = costFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCostFilter(tab.id)}
                  style={{
                    padding: '4px 11px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: '14px',
                    cursor: 'pointer',
                    border: active
                      ? (tab.id === 'labor'
                        ? '1px solid rgba(56, 189, 248, 0.45)'
                        : '1px solid rgba(212, 183, 135, 0.5)')
                      : '1px solid var(--st-line)',
                    backgroundColor: active
                      ? (tab.id === 'labor'
                        ? 'rgba(56, 189, 248, 0.14)'
                        : 'rgba(212, 183, 135, 0.14)')
                      : 'rgba(255, 255, 255, 0.03)',
                    color: active
                      ? (tab.id === 'labor' ? '#7dd3fc' : 'var(--st-gold)')
                      : 'var(--st-muted)'
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.9rem', border: '1px dashed var(--color-zinc-800)', borderRadius: '12px' }}>
          No documents uploaded yet. Scans will be logged here.
        </div>
      ) : filteredHistory.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.84rem', border: '1px dashed var(--color-zinc-800)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <span>No matching receipts found.</span>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setCostFilter('all');
            }}
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '5px 12px', fontSize: '0.75rem' }}
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredHistory.map(item => (
            <div key={item.id} className="history-item">
              <div className="history-info" style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                <div className="history-title-text" style={{ wordBreak: 'break-word' }}>{item.description}</div>
                <div className="history-meta">
                  {item.vendor} • {item.dateTransaction || 'N/A'}
                </div>
                {item.tradeCategory && item.tradePhase && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-amber-400)', marginTop: '2px', fontWeight: 500 }}>
                    Logged: {item.tradeCategory.replace(/_/g, ' ')} → {item.tradePhase}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 600, color: item.costCategory === 'labor' ? 'var(--color-blue-500)' : 'var(--color-amber-500)', textTransform: 'uppercase' }}>
                    {item.costCategory}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-zinc-600)' }}>•</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-zinc-500)' }}>Logged {item.dateLogged}</span>
                </div>
                {item.check?.status === 'ok' && (
                  <div style={{ fontSize: '0.68rem', color: '#4ade80', marginTop: '3px', fontWeight: 600 }}>
                    ✓ Recorded in Sheet{item.check.rowNumber ? ` (row ${item.check.rowNumber})` : ''}
                  </div>
                )}
                {item.check && item.check.status !== 'ok' && (
                  <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '3px', fontWeight: 600, lineHeight: 1.35 }}>
                    ⚠ {item.check.status === 'missing' ? 'Not found in the Sheet' : 'Sheet row is different'}: {(item.check.problems || []).join('; ')}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                <div className="history-price">${Number(item.amount).toFixed(2)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.link ? (
                    <button
                      type="button"
                      onClick={() => onViewPDF(item)}
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '0.75rem', width: 'auto', borderRadius: '6px', whiteSpace: 'nowrap' }}
                    >
                      View PDF
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-600)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                      Downloaded
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-zinc-500)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px'
                    }}
                    title="Delete log entry"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
