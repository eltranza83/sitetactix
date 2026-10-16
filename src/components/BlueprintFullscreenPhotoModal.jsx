import React from 'react';
import { X } from 'lucide-react';
import DrivePhoto from './DrivePhoto';

export default function BlueprintFullscreenPhotoModal({ photo, googleToken, onClose }) {
  if (!photo) return null;

  // Album photos carry id; pin photos carry fileId (older pins may only have a Drive link in url)
  const fileId = photo.fileId || photo.id || '';
  const url = photo.url || '';
  const title = photo?.name || 'Photo';
  const openLink = photo?.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : null);

  if (!fileId && !url) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
      >
        <X size={24} />
      </button>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center' }}>
        <DrivePhoto
          googleToken={googleToken}
          fileId={fileId}
          url={url}
          alt={title}
          full
          placeholderSize={32}
          style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px', border: '1px solid var(--color-zinc-800)' }}
        />
      </div>

      <div style={{ marginTop: '16px', textAlign: 'center', color: '#fff', fontSize: '0.82rem' }}>
        <p style={{ fontWeight: 600 }}>{title}</p>
        {openLink && (
          <a
            href={openLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-amber-500)', textDecoration: 'none', fontSize: '0.74rem', marginTop: '6px', display: 'inline-block', fontWeight: 600 }}
            onClick={(e) => e.stopPropagation()}
          >
            Open original
          </a>
        )}
      </div>
    </div>
  );
}
