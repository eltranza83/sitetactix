import React from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { dataUrlToBlob } from '../services/imageFiles';

export function openPdfPreview(mainImageUrl) {
  if (!mainImageUrl) return;
  if (mainImageUrl.startsWith('data:')) {
    const blob = dataUrlToBlob(mainImageUrl, 'application/pdf');
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 60000);
    return;
  }
  window.open(mainImageUrl, '_blank');
}

export default function EditFormAttachments({
  cameraError,
  mainImageUrl,
  onFileChange,
  onRemoveReceipt,
  onStartCamera,
  secondaryImageUrl
}) {
  return (
    <div className="form-group" style={{ marginTop: '4px' }}>
      <label className="form-label" style={{ fontSize: '0.72rem' }}>Attachments</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {mainImageUrl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px', backgroundColor: 'var(--color-zinc-950)', borderRadius: '8px', border: '1px solid var(--color-zinc-800)' }}>
            {mainImageUrl.startsWith('data:application/pdf') ? (
              <div
                onClick={() => openPdfPreview(mainImageUrl)}
                style={{
                  cursor: 'pointer',
                  width: '40px',
                  height: '40px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.62rem',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  flexShrink: 0
                }}
                title="Click to view PDF in new tab"
              >
                PDF
              </div>
            ) : (
              <img src={mainImageUrl} alt="Primary Scan" style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {mainImageUrl.startsWith('data:application/pdf') ? 'Primary PDF Document' : 'Primary scan'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {mainImageUrl.startsWith('data:application/pdf') ? 'Click PDF icon to view document' : 'Original receipt or check photo'}
              </div>
            </div>
          </div>
        )}

        {secondaryImageUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px', backgroundColor: 'var(--color-zinc-950)', borderRadius: '8px', border: '1px solid var(--color-zinc-800)' }}>
            <img src={secondaryImageUrl} alt="Attached Receipt" style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Attached Receipt</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Additional paper receipt reference</div>
            </div>
            <button
              type="button"
              onClick={onRemoveReceipt}
              className="nav-item"
              style={{ width: 'auto', padding: '6px', color: 'var(--color-rose-500)', flex: 'none' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cameraError && (
              <div className="alert-box alert-error" style={{ padding: '6px', fontSize: '0.75rem' }}>
                {cameraError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onStartCamera}
                className="btn btn-secondary"
                style={{ borderStyle: 'dashed', padding: '8px', fontSize: '0.8rem', flex: 1, height: '36px' }}
              >
                <Camera size={14} />
                Take Photo
              </button>

              <div style={{ position: 'relative', flex: 1 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ borderStyle: 'dashed', padding: '8px', fontSize: '0.8rem', width: '100%', height: '36px' }}
                >
                  <Plus size={14} />
                  Choose Photo
                </button>
                <input
                  type="file"
                  onChange={onFileChange}
                  accept="image/*"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    zIndex: 10
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
