import React from 'react';
import { Camera, Image, Plus, X } from 'lucide-react';
import { STATUS_MESSAGES } from '../services/appErrors';
import DrivePhoto from './DrivePhoto';

export default function DashboardPhotoGallery({
  googleToken,
  activeGalleryPhase,
  photos,
  loadingPhotos,
  uploadingPhoto,
  fullscreenPhoto,
  onCloseGallery,
  onPhotoUpload,
  onOpenPhoto,
  onClosePhoto,
  getPhaseReminderTip
}) {
  return (
    <>
      {activeGalleryPhase && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '16px'
        }} onClick={onCloseGallery}>
          <div style={{
            backgroundColor: 'var(--color-zinc-950)',
            border: '1px solid var(--color-zinc-800)',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '480px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.9)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '16px',
              borderBottom: '1px solid var(--color-zinc-900)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Camera size={16} style={{ color: 'var(--color-amber-500)' }} />
                  {activeGalleryPhase.phase}
                </h3>
                <span style={{ fontSize: '0.68rem', color: 'var(--color-zinc-500)', textTransform: 'uppercase', fontWeight: 600 }}>
                  {activeGalleryPhase.category.replace(/_/g, ' ')}
                </span>
              </div>
              <button
                type="button"
                onClick={onCloseGallery}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingPhotos ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <div className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto' }}></div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-zinc-500)', display: 'block', marginTop: '8px' }}>{STATUS_MESSAGES.loadingPhotos}</span>
                </div>
              ) : photos.length === 0 ? (
                <div style={{
                  padding: '30px 20px',
                  textAlign: 'center',
                  border: '1px dashed var(--color-zinc-800)',
                  borderRadius: '8px',
                  color: 'var(--color-zinc-500)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <Image size={28} style={{ color: 'var(--color-zinc-700)', margin: '0 auto' }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-zinc-400)' }}>No photos uploaded yet</span>
                  <p style={{ fontSize: '0.7rem', lineHeight: '1.4' }}>
                    {getPhaseReminderTip(activeGalleryPhase.phase)}
                  </p>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px'
                }}>
                  {photos.map(photo => (
                    <div
                      key={photo.id}
                      onClick={() => onOpenPhoto(photo)}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: '1px solid var(--color-zinc-800)',
                        backgroundColor: 'var(--color-zinc-900)'
                      }}
                    >
                      <DrivePhoto
                        googleToken={googleToken}
                        fileId={photo.id}
                        thumbnailLink={photo.thumbnailLink}
                        alt={photo.name}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--color-zinc-900)', paddingTop: '12px' }}>
                <label
                  className={`btn ${uploadingPhoto ? 'btn-secondary' : 'btn-primary'}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: uploadingPhoto ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    padding: '10px'
                  }}
                >
                  <Plus size={14} />
                  {uploadingPhoto ? STATUS_MESSAGES.uploadingToDrive : 'Add Photo (Camera/Gallery)'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={onPhotoUpload}
                    disabled={uploadingPhoto}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreenPhoto && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '16px'
        }} onClick={onClosePhoto}>
          <button
            type="button"
            onClick={onClosePhoto}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              color: '#fff',
              padding: '8px',
              borderRadius: '50%',
              cursor: 'pointer'
            }}
          >
            <X size={20} />
          </button>

          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center' }}>
            <DrivePhoto
              googleToken={googleToken}
              fileId={fullscreenPhoto.id}
              alt="Fullscreen view"
              full
              placeholderSize={32}
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '8px' }}
            />
          </div>

          <div style={{ color: 'var(--color-zinc-400)', fontSize: '0.8rem', marginTop: '12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <a
              href={fullscreenPhoto.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-amber-500)', textDecoration: 'underline', fontWeight: 600 }}
            >
              Open in Google Drive
            </a>
          </div>
        </div>
      )}
    </>
  );
}
