import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * A yes/no question in the app's own style. Cancel is the safe choice: it has the focus
 * (Enter = Cancel), and Escape or a tap outside the box also cancel.
 */
export default function ConfirmDialog({ title, message, confirmLabel = 'Continue', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-container"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '440px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <AlertTriangle size={20} style={{ color: 'var(--st-gold)', flexShrink: 0 }} />
          <span id="confirm-dialog-title" style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--st-text)' }}>{title}</span>
        </div>
        <div style={{ fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--st-text)', whiteSpace: 'pre-line' }}>{message}</div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-danger" onClick={onConfirm} style={{ width: 'auto', padding: '10px 16px' }}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onCancel} autoFocus style={{ width: 'auto', padding: '10px 18px' }}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
