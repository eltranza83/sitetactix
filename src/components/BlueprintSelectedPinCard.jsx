import React from 'react';
import { X } from 'lucide-react';
import { normalizePinPhotos, normalizePhotoUrl } from '../services/blueprintDrive';
import { fetchDriveFileAsObjectUrl } from '../services/googleDrive';

export default function BlueprintSelectedPinCard({
  pin,
  tradeSectionsConfig,
  googleToken,
  onClose,
  onDelete,
  onEditPin,
  onOpenPhoto
}) {
  if (!pin) return null;

  const attachments = React.useMemo(() => normalizePinPhotos(pin), [pin]);
  const [resolvedImageUrls, setResolvedImageUrls] = React.useState({});

  React.useEffect(() => {
    let cancelled = false;
    const nextImageUrls = {};

    const resolveAttachments = async () => {
      if (!googleToken) {
        setResolvedImageUrls({});
        return;
      }

      for (const attachment of attachments) {
        if (!attachment.fileId || !googleToken) continue;

        try {
          const objectUrl = await fetchDriveFileAsObjectUrl(googleToken, attachment.fileId);
          if (!cancelled) {
            nextImageUrls[attachment.fileId] = objectUrl;
          }
        } catch (err) {
          console.warn('Failed to resolve blueprint photo preview URL:', err);
        }
      }

      if (!cancelled) {
        setResolvedImageUrls(nextImageUrls);
      }
    };

    resolveAttachments();

    return () => {
      cancelled = true;
      Object.values(nextImageUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments, googleToken]);

  return (
    <div style={{ backgroundColor: 'var(--st-panel)', border: '1px solid var(--st-line)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'slideUp 0.2s ease-out', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: tradeSectionsConfig[pin.category]?.color || 'var(--st-gold)', fontWeight: 800, letterSpacing: '0.08em' }}>
            {tradeSectionsConfig[pin.category]?.label || 'General'}
          </span>
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--st-text)' }}>{pin.phase}</h4>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--st-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--st-text)', lineHeight: 1.4, backgroundColor: 'var(--st-soft)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--st-line)' }}>
        {pin.note}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-zinc-400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Verification Photos
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-amber-500)', fontWeight: 700 }}>
            {attachments.length} {attachments.length === 1 ? 'photo' : 'photos'}
          </div>
        </div>
        {attachments.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {attachments.map((attachment, index) => {
              const attachmentUrl = normalizePhotoUrl(attachment.url || '', attachment.fileId || '');
              const resolvedImageUrl = attachment.fileId ? resolvedImageUrls[attachment.fileId] : '';
              const thumbnailUrl = resolvedImageUrl || attachment.thumbnailUrl || attachmentUrl;
              const attachmentName = attachment.name || `Verification photo ${index + 1}`;
              return (
                <button
                  key={`${attachment.fileId || attachment.url || index}`}
                  type="button"
                  onClick={() => onOpenPhoto?.({
                    ...attachment,
                    id: attachment.fileId || attachment.url || index,
                    name: attachmentName,
                    url: resolvedImageUrl || attachmentUrl,
                    webViewLink: attachment.webViewLink || attachmentUrl || attachment.url
                  })}
                  style={{ display: 'block', width: '100%', padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-zinc-800)' }}
                  title={`Open ${attachmentName}`}
                >
                  <img
                    src={thumbnailUrl}
                    alt={`Verification preview ${index + 1}`}
                    style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }}
                    onError={(e) => {
                      e.target.src = attachmentUrl || attachment.url || '';
                      if (!e.target.src) {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onEditPin(pin)}
            style={{ border: '1px dashed var(--color-zinc-700)', borderRadius: '8px', padding: '10px 12px', backgroundColor: 'rgba(241, 215, 167, 0.08)', color: 'var(--color-amber-500)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Add verification photos from Edit Pin
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
        <button
          onClick={() => onEditPin(pin)}
          className="btn"
          style={{ backgroundColor: 'rgba(241, 215, 167, 0.12)', border: '1px solid rgba(241, 215, 167, 0.2)', color: 'var(--color-amber-500)', fontSize: '0.75rem', padding: '6px 12px', fontWeight: 600 }}
        >
          Edit Pin
        </button>
        <button
          onClick={() => onDelete(pin.id)}
          className="btn"
          style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.2)', color: 'var(--color-rose-500)', fontSize: '0.75rem', padding: '6px 12px', fontWeight: 600 }}
        >
          Delete Pin
        </button>
      </div>
    </div>
  );
}
