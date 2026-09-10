import React from 'react';
import { ArrowLeft, Camera, ChevronDown, ChevronUp, Image, Loader2 } from 'lucide-react';
import { STATUS_MESSAGES } from '../services/appErrors';

export default function BlueprintPhaseAlbums({
  activeAlbumPhase,
  albumFileInputRef,
  albumPhotos,
  expandedCategory,
  loadingAlbumPhotos,
  onExpandCategory,
  onPhotoUpload,
  onSelectAlbumPhase,
  onSelectFullscreenPhoto,
  tradeSectionsConfig,
  uploadingAlbumPhoto
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', padding: '10px 14px', borderRadius: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'rgba(217, 119, 6, 0.12)', border: '1px solid rgba(217, 119, 6, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
            <Camera size={16} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff' }}>Phase Photo Albums</span>
            <span style={{ fontSize: '0.70rem', color: 'var(--color-zinc-400)' }}>Progress photos by trade phase</span>
          </div>
        </div>
      </div>

      {activeAlbumPhase ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)', borderRadius: '12px', padding: '16px', flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-zinc-800)', paddingBottom: '10px' }}>
            <button
              onClick={() => onSelectAlbumPhase(null)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer', fontSize: '0.78rem', padding: 0 }}
            >
              <ArrowLeft size={16} /> Back to Albums
            </button>
            <div style={{ textAlign: 'right' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>{activeAlbumPhase.phase}</h4>
              <span style={{ fontSize: '0.62rem', color: 'var(--color-zinc-500)', textTransform: 'uppercase' }}>
                {activeAlbumPhase.category.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          <div
            onClick={() => !uploadingAlbumPhoto && albumFileInputRef.current?.click()}
            style={{
              border: '1px dashed var(--color-zinc-700)',
              borderRadius: '8px',
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: uploadingAlbumPhoto ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--color-zinc-950)',
              opacity: uploadingAlbumPhoto ? 0.7 : 1
            }}
          >
            {uploadingAlbumPhoto ? (
              <>
                <Loader2 className="animate-spin" size={16} style={{ color: 'var(--color-amber-500)' }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-zinc-400)' }}>{STATUS_MESSAGES.uploadingToDrive}</span>
              </>
            ) : (
              <>
                <Camera size={16} style={{ color: 'var(--color-amber-500)' }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-zinc-300)', fontWeight: 600 }}>Snap / Upload Phase Photo</span>
              </>
            )}
            <input
              type="file"
              ref={albumFileInputRef}
              onChange={onPhotoUpload}
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
            />
          </div>

          {loadingAlbumPhotos ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '8px' }}>
              <Loader2 className="animate-spin" size={24} style={{ color: 'var(--color-amber-500)' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--color-zinc-500)' }}>{STATUS_MESSAGES.loadingPhotos}</span>
            </div>
          ) : albumPhotos.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.78rem' }}>
              <Image size={24} style={{ color: 'var(--color-zinc-700)', margin: '0 auto 8px' }} />
              No photos logged for this phase yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {albumPhotos.map(photo => (
                <div
                  key={photo.id}
                  onClick={() => onSelectFullscreenPhoto(photo)}
                  style={{ position: 'relative', aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--color-zinc-800)', backgroundColor: 'var(--color-zinc-950)' }}
                >
                  <img
                    src={photo.thumbnailLink}
                    alt={photo.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
          {Object.keys(tradeSectionsConfig).map(catKey => {
            const config = tradeSectionsConfig[catKey];
            const isExpanded = expandedCategory === catKey;

            return (
              <div key={catKey} style={{ border: '1px solid var(--color-zinc-800)', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--color-zinc-950)' }}>
                <div
                  onClick={() => onExpandCategory(isExpanded ? null : catKey)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer', userSelect: 'none', backgroundColor: isExpanded ? 'var(--color-zinc-900)' : 'transparent' }}
                >
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: config.color, textTransform: 'uppercase', letterSpacing: '0.01em' }}>
                    {config.label}
                  </span>
                  {isExpanded ? <ChevronUp size={16} style={{ color: 'var(--color-zinc-500)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-zinc-500)' }} />}
                </div>

                {isExpanded && (
                  <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: 'var(--color-zinc-900)' }}>
                    {config.phases.map(phase => (
                      <div
                        key={phase}
                        onClick={() => onSelectAlbumPhase({ category: catKey, phase })}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '6px', backgroundColor: 'var(--color-zinc-950)', fontSize: '0.78rem', cursor: 'pointer', border: '1px solid var(--color-zinc-800)' }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--color-zinc-200)' }}>{phase}</span>
                        <Camera size={14} style={{ color: 'var(--color-zinc-500)' }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
