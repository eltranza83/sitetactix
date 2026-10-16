import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { connectConfirmDialog } from '../services/confirmAction';

/**
 * A yes/no question in the app's own style. Cancel is the safe choice: it has the focus
 * (Enter = Cancel), and Escape or a tap outside the box also cancel.
 * With no confirmLabel it is a plain message with one OK button.
 */
export default function ConfirmDialog({ title, message, confirmLabel = 'Continue', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  const isMessage = confirmLabel === null;
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
          {!isMessage && (
            <button type="button" className="btn btn-danger" onClick={onConfirm} style={{ width: 'auto', padding: '10px 16px' }}>
              {confirmLabel}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onCancel} autoFocus style={{ width: 'auto', padding: '10px 18px' }}>
            {isMessage ? 'OK' : cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows the questions asked with confirmAction(). Rendered once, in App. */
export function ConfirmHost() {
  const [request, setRequest] = useState(null);

  useEffect(() => connectConfirmDialog((next) => {
    // A new question replaces one still open; the old one counts as cancelled
    setRequest(previous => {
      previous?.resolve(false);
      return next;
    });
  }), []);

  if (!request) return null;
  const answer = (yes) => {
    request.resolve(yes);
    setRequest(null);
  };
  return (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
}
