import React from 'react';
import { FileText, X } from 'lucide-react';

/** Pick which page of a plan PDF is the floor plan. Pages show as small previews while they load. */
export default function BlueprintPdfPagePicker({ picker, error = null, onPickPage, onCancel }) {
  if (!picker) return null;
  const { fileName, pageCount, shownCount, thumbnails, status, pickedPage } = picker;
  const busy = status === 'opening' || status === 'converting';

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-page-picker-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '560px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '90vh' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <div id="pdf-page-picker-title" style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--st-text)' }}>Which page is the floor plan?</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--st-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <FileText size={11} style={{ verticalAlign: '-1px' }} /> {fileName}{pageCount ? ` · ${pageCount} pages` : ''}
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={status === 'converting'} aria-label="Cancel" style={{ background: 'none', border: 'none', color: 'var(--st-muted)', cursor: 'pointer', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {status === 'opening' && <div style={{ fontSize: '0.85rem', color: 'var(--st-muted)' }}>Opening the PDF...</div>}
        {status === 'converting' && (
          <div style={{ fontSize: '0.85rem', color: 'var(--st-gold)' }}>Turning page {pickedPage} into the floor plan image...</div>
        )}
        {error && <div className="alert-box alert-error" role="alert" style={{ margin: 0 }}>{error}</div>}

        {status === 'ready' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', overflowY: 'auto', paddingRight: '2px' }}>
            {Array.from({ length: shownCount }, (_, i) => i + 1).map(pageNumber => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => onPickPage(pageNumber)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center',
                  padding: '8px', borderRadius: '10px', cursor: 'pointer',
                  backgroundColor: 'var(--st-soft)', border: '1px solid var(--st-line)', color: 'var(--st-text)'
                }}
              >
                <div style={{ width: '100%', aspectRatio: '4 / 3', backgroundColor: '#fff', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {thumbnails[pageNumber - 1]
                    ? <img src={thumbnails[pageNumber - 1]} alt={`Page ${pageNumber}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Loading...</span>}
                </div>
                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Page {pageNumber}</span>
              </button>
            ))}
          </div>
        )}
        {status === 'ready' && pageCount > shownCount && (
          <div style={{ fontSize: '0.72rem', color: 'var(--st-muted)' }}>Showing the first {shownCount} of {pageCount} pages.</div>
        )}
      </div>
    </div>
  );
}
