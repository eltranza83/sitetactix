import React from 'react';

export default function EditFormCamera({ videoRef, onCapturePhoto, onStopCamera, zoomInfo = null, zoomValue = 1, onZoomChange }) {
  return (
    <div className="edit-overlay-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Inline Camera</h2>
        <button
          type="button"
          onClick={onStopCamera}
          className="btn btn-secondary"
          style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
        >
          Cancel
        </button>
      </div>

      <div className="camera-container">
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          playsInline
          muted
        />
        <div className="camera-overlay">
          <div className="camera-target-box"></div>
        </div>
      </div>

      {zoomInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 4px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-zinc-400)' }}>Zoom</span>
          <input
            type="range"
            min={zoomInfo.min}
            max={zoomInfo.max}
            step={zoomInfo.step}
            value={zoomValue}
            onChange={onZoomChange}
            style={{ flex: 1 }}
            aria-label="Camera zoom"
          />
        </div>
      )}

      <div className="camera-controls">
        <button
          type="button"
          onClick={onCapturePhoto}
          className="shutter-btn"
          title="Capture photo"
        />
      </div>
    </div>
  );
}
