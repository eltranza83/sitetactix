import React from 'react';
import { AlertTriangle, MapPin, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import BlueprintSelectedPinCard from './BlueprintSelectedPinCard';
import IssueCard from './IssueCard';

function getIssueMarkerColor(issue) {
  if (issue.status === 'resolved') return '#34d399';
  if (issue.status === 'in_progress') return '#fbbf24';
  if (issue.priority === 'high') return '#ef4444';
  return '#f87171';
}

function isLocatedIssue(issue) {
  return !issue?.deletedAt && Number.isFinite(Number(issue.floorPlanX)) && Number.isFinite(Number(issue.floorPlanY));
}

export default function BlueprintCanvasView({
  imageContainerRef,
  imageSrc,
  isAddMode,
  isIssueAddMode,
  issues = [],
  onCanvasClick,
  onDeletePin,
  onEditPin,
  onDeleteIssue,
  onEditIssue,
  onOpenPhoto,
  onSendIssuePacket,
  onResetBlueprint,
  onSelectIssue,
  googleToken,
  onSelectPin,
  onSetZoomScale,
  onToggleIssueAddMode,
  onToggleAddMode,
  onUpdateIssueStatus,
  onMarkIssueFixed,
  onVerifyIssue,
  onReopenIssue,
  pins,
  selectedIssue,
  selectedPin,
  tradeSectionsConfig,
  zoomScale
}) {
  const [showResolvedIssues, setShowResolvedIssues] = React.useState(false);
  const activeDropMode = isIssueAddMode ? 'issue' : isAddMode ? 'xray' : null;
  const allLocatedIssues = issues.filter(isLocatedIssue);
  const resolvedIssuesCount = allLocatedIssues.filter(i => i.status === 'resolved').length;
  const locatedIssues = showResolvedIssues ? allLocatedIssues : allLocatedIssues.filter(i => i.status !== 'resolved');
  const frameBorderColor = activeDropMode === 'issue'
    ? 'rgba(248, 113, 113, 0.82)'
    : activeDropMode === 'xray'
      ? 'rgba(52, 211, 153, 0.82)'
      : 'var(--color-zinc-800)';
  const frameGlow = activeDropMode === 'issue'
    ? '0 0 0 2px rgba(239, 68, 68, 0.18), 0 0 24px rgba(239, 68, 68, 0.2)'
    : activeDropMode === 'xray'
      ? '0 0 0 2px rgba(16, 185, 129, 0.18), 0 0 24px rgba(16, 185, 129, 0.2)'
      : 'none';
  const actionButtonBaseStyle = {
    width: 'auto',
    minWidth: 0,
    padding: '0 12px',
    fontSize: '0.76rem',
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.08)',
    height: '44px',
    borderRadius: '10px',
    lineHeight: 1,
    boxShadow: 'none'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      <div className="blueprint-toolbar">
        <div className="blueprint-toolbar-copy">
          <div className="blueprint-toolbar-meta">
            <span className="blueprint-toolbar-title">X-Ray Floor Plan</span>
            <span className="blueprint-toolbar-status">
              X-Ray: {pins.length} | Issues: {locatedIssues.length}
            </span>
          </div>
        </div>

        <div className="blueprint-toolbar-actions">
          <button
            type="button"
            onClick={onToggleIssueAddMode}
            className={`btn blueprint-action-button ${isIssueAddMode ? 'active issue' : ''}`}
            style={{
              ...actionButtonBaseStyle,
              backgroundColor: isIssueAddMode ? '#ef4444' : 'var(--color-zinc-800)',
              borderColor: isIssueAddMode ? 'rgba(248, 113, 113, 0.55)' : 'rgba(255,255,255,0.08)'
            }}
          >
            <AlertTriangle
              size={14}
              className={isIssueAddMode ? 'animate-pulse' : ''}
              style={{ color: isIssueAddMode ? '#fff' : '#f87171' }}
            />
            <span className="blueprint-action-label">
              {isIssueAddMode ? (
                <>
                  <span>Tap</span>
                  <span>Plan</span>
                </>
              ) : (
                <>
                  <span>Issue</span>
                  <span>Pin</span>
                </>
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleAddMode}
            className={`btn blueprint-action-button ${isAddMode ? 'active xray' : ''}`}
            style={{
              ...actionButtonBaseStyle,
              backgroundColor: isAddMode ? 'var(--color-emerald-500)' : 'var(--color-zinc-800)',
              color: isAddMode ? '#000' : '#fff',
              borderColor: isAddMode ? 'rgba(52, 211, 153, 0.55)' : 'rgba(255,255,255,0.08)'
            }}
          >
            <MapPin
              size={14}
              className={isAddMode ? 'animate-pulse' : ''}
              style={{ color: isAddMode ? '#000' : '#34d399' }}
            />
            <span className="blueprint-action-label">
              {isAddMode ? (
                <>
                  <span>Tap</span>
                  <span>Plan</span>
                </>
              ) : (
                <>
                  <span>X-Ray</span>
                  <span>Pin</span>
                </>
              )}
            </span>
          </button>

          {resolvedIssuesCount > 0 && (
            <button
              type="button"
              onClick={() => setShowResolvedIssues(prev => !prev)}
              className="btn blueprint-action-button"
              style={{
                ...actionButtonBaseStyle,
                backgroundColor: showResolvedIssues ? 'rgba(52, 211, 153, 0.15)' : 'var(--color-zinc-800)',
                color: showResolvedIssues ? '#34d399' : 'var(--color-zinc-400)',
                borderColor: showResolvedIssues ? 'rgba(52, 211, 153, 0.3)' : 'rgba(255,255,255,0.08)',
                fontSize: '0.72rem',
                padding: '0 8px'
              }}
              title={showResolvedIssues ? 'Hide resolved issues' : 'Show resolved issues'}
            >
              <span>{showResolvedIssues ? `Hide Closed (${resolvedIssuesCount})` : `Show Closed (${resolvedIssuesCount})`}</span>
            </button>
          )}
        </div>
      </div>

      {isAddMode && (
        <div style={{ padding: '8px 12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={14} style={{ color: 'var(--color-emerald-400)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.74rem', color: 'var(--color-emerald-400)' }}>
            Tap anywhere on the floor plan below to drop a pin.
          </span>
        </div>
      )}

      {isIssueAddMode && (
        <div style={{ padding: '8px 12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0 }} />
          <span style={{ fontSize: '0.74rem', color: '#fca5a5' }}>
            Tap the floor plan to create a punch list issue at that location.
          </span>
        </div>
      )}

      <div
        style={{
          position: 'relative',
          border: `1px solid ${frameBorderColor}`,
          borderRadius: '12px',
          maxHeight: '450px',
          backgroundColor: '#0c0c0e',
          overflow: 'hidden',
          minHeight: '260px',
          boxShadow: frameGlow,
          transition: 'border-color 0.18s ease, box-shadow 0.18s ease'
        }}
      >
        <button
          type="button"
          onClick={onResetBlueprint}
          className="blueprint-reset-button"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '30px',
            height: '30px',
            backgroundColor: 'rgba(10, 10, 10, 0.82)',
            border: '1px solid rgba(255,255,255,0.16)',
            color: 'var(--color-rose-500)',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            boxShadow: '0 4px 12px rgba(0,0,0,0.32)'
          }}
          title="Remove floor plan"
        >
          <X size={13} />
        </button>

        <div
          style={{
            overflow: 'auto',
            maxHeight: '450px',
            minHeight: '260px',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'flex-start'
          }}
          ref={imageContainerRef}
        >
          <div
            style={{
              position: 'relative',
              width: `${zoomScale * 100}%`,
              flex: '0 0 auto',
              transition: 'none',
              display: 'block',
              cursor: isAddMode || isIssueAddMode ? 'crosshair' : 'default'
            }}
          >
            <img
              src={imageSrc}
              alt="Project Floor Plan"
              onClick={onCanvasClick}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                pointerEvents: 'auto'
              }}
            />

            {pins.map(pin => {
              const isSelected = selectedPin?.id === pin.id;

              return (
                <button
                  key={pin.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIssue(null);
                    onSelectPin(pin);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${pin.x}%`,
                    top: `${pin.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8)) drop-shadow(0 0 2px rgba(255,255,255,0.9))',
                    boxShadow: isSelected ? '0 0 0 3px rgba(16, 185, 129, 0.24)' : 'none',
                    zIndex: isSelected ? 100 : 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    padding: 0
                  }}
                  className={isSelected ? '' : 'animate-pulse'}
                  title={pin.phase || 'Pin'}
                >
                  <MapPin size={14} style={{ color: '#10b981', strokeWidth: 2.6 }} />
                </button>
              );
            })}

            {locatedIssues.map(issue => {
              const isSelected = selectedIssue?.id === issue.id;
              const markerColor = getIssueMarkerColor(issue);

              return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPin(null);
                    onSelectIssue(issue);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${Number(issue.floorPlanX)}%`,
                    top: `${Number(issue.floorPlanY)}%`,
                    transform: 'translate(-50%, -50%)',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8)) drop-shadow(0 0 2px rgba(255,255,255,0.9))',
                    boxShadow: isSelected ? '0 0 0 3px rgba(239, 68, 68, 0.24)' : 'none',
                    zIndex: isSelected ? 110 : 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    padding: 0
                  }}
                  title={issue.title || 'Punch issue'}
                >
                  <AlertTriangle size={14} style={{ color: markerColor, strokeWidth: 2.6 }} />
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: '8px',
            bottom: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            zIndex: 50,
            padding: '4px',
            borderRadius: '9px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
          }}
        >
          <button
            type="button"
            onClick={() => onSetZoomScale(s => Math.max(s - 0.25, 1))}
            style={{ width: '29px', height: '29px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={() => onSetZoomScale(s => Math.min(s + 0.25, 3))}
            style={{ width: '29px', height: '29px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            onClick={() => onSetZoomScale(1)}
            style={{ width: '29px', height: '29px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Reset zoom"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {selectedIssue ? (
        <IssueCard
          issue={selectedIssue}
          googleToken={googleToken}
          onUpdateStatus={onUpdateIssueStatus}
          onDelete={onDeleteIssue}
          onEdit={onEditIssue}
          onSendPacket={onSendIssuePacket}
          onMarkFixed={onMarkIssueFixed}
          onVerify={onVerifyIssue}
          onReopen={onReopenIssue}
        />
      ) : selectedPin ? (
        <BlueprintSelectedPinCard
          pin={selectedPin}
          tradeSectionsConfig={tradeSectionsConfig}
          onClose={() => onSelectPin(null)}
          onDelete={onDeletePin}
          onEditPin={onEditPin}
          onOpenPhoto={onOpenPhoto}
          googleToken={googleToken}
        />
      ) : (
        <div style={{ padding: '12px 14px', border: '1px dashed var(--color-zinc-700)', borderRadius: '10px', color: 'var(--color-zinc-400)', fontSize: '0.78rem', backgroundColor: 'rgba(255,255,255,0.03)' }}>
          Tap a pin on the floor plan to view its details and attached verification photos.
        </div>
      )}
    </div>
  );
}
