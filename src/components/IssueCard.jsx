import React, { useState, useRef } from 'react';
import {
  Edit3,
  FileText,
  Calendar,
  Trash2,
  Clock,
  AlertTriangle,
  X,
  Share2,
  Camera,
  RotateCcw,
  Check,
  ShieldCheck,
  History,
  ClipboardCheck
} from 'lucide-react';
import { useAuthenticatedDriveImage } from '../hooks/useAuthenticatedDriveImage';

function getDisplayImageUrl(url, base64, size = 'w200') {
  if (base64) return base64;
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1]) {
    const fileId = driveIdMatch[1];
    const widthParam = size === 'w1000' ? 'w1000' : (size === 'w400' ? 'w400' : 'w200');
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=${widthParam}`;
  }

  return url;
}

export default function IssueCard({
  issue,
  googleToken = null,
  onUpdateStatus,
  onDelete,
  onEdit,
  onSendPacket,
  onMarkFixed,
  onVerify,
  onReopen
}) {
  const [fullscreenPhotoSrc, setFullscreenPhotoSrc] = useState(null);
  const [preparingPacket, setPreparingPacket] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Fix / Proof Photo submission state
  const [showFixForm, setShowFixForm] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);
  const [proofNotes, setProofNotes] = useState('');
  const [submittingProof, setSubmittingProof] = useState(false);

  // Inspection record prompt for verification without photo
  const [showInspectionPrompt, setShowInspectionPrompt] = useState(false);
  const [inspectionRecordText, setInspectionRecordText] = useState('');

  // Reopen prompt state
  const [showReopenPrompt, setShowReopenPrompt] = useState(false);
  const [reopenReasonText, setReopenReasonText] = useState('');

  const proofInputRef = useRef(null);

  const {
    id,
    title,
    description,
    category,
    tradePhase,
    contractorName,
    phoneNumber,
    priority,
    status,
    dueDate,
    photoUrl,
    photoBase64,
    proofPhotoUrl,
    proofPhotoBase64,
    proofNotes: storedProofNotes,
    proofSubmittedAt,
    verifiedAt,
    verifiedBy,
    reopenReason,
    activityHistory,
    createdAt
  } = issue;

  const defectImage = useAuthenticatedDriveImage({
    googleToken,
    fileId: issue?.photoFileId,
    url: photoUrl,
    base64: photoBase64
  });

  const proofImage = useAuthenticatedDriveImage({
    googleToken,
    fileId: issue?.proofPhotoFileId,
    url: proofPhotoUrl,
    base64: proofPhotoBase64
  });

  const hasDefectPhoto = Boolean(photoUrl || photoBase64 || issue?.photoFileId);
  const hasProofPhoto = Boolean(proofPhotoUrl || proofPhotoBase64 || issue?.proofPhotoFileId);
  const hasBothPhotos = Boolean(hasDefectPhoto && hasProofPhoto);

  // Format creation date
  const dateFormatted = createdAt ? new Date(createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit'
  }) : 'N/A';

  const dueDateFormatted = dueDate ? (() => {
    const match = String(dueDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, y, m, d] = match;
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: '2-digit'
      });
    }
    return new Date(dueDate).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: '2-digit'
    });
  })() : null;

  // Backward compatibility: build synthesized history if legacy issue has none
  const historyItems = (Array.isArray(activityHistory) && activityHistory.length > 0)
    ? activityHistory
    : [
        createdAt ? {
          id: 'legacy_created',
          action: 'created',
          timestamp: createdAt,
          actor: 'Builder',
          note: description ? `Initial defect logged: ${description}` : 'Initial defect logged'
        } : null,
        contractorName ? {
          id: 'legacy_assigned',
          action: 'assigned',
          timestamp: createdAt || new Date().toISOString(),
          actor: 'Builder',
          details: `Assigned to ${contractorName}`
        } : null,
        hasProofPhoto ? {
          id: 'legacy_proof',
          action: 'proof_submitted',
          timestamp: proofSubmittedAt || createdAt || new Date().toISOString(),
          actor: 'Builder',
          details: contractorName ? `Submitted on behalf of ${contractorName}` : 'Resolution proof submitted',
          note: storedProofNotes || 'Proof attached'
        } : null,
        status === 'resolved' ? {
          id: 'legacy_verified',
          action: 'verified_closed',
          timestamp: verifiedAt || createdAt || new Date().toISOString(),
          actor: verifiedBy || 'Builder',
          note: 'Work verified and closed'
        } : null
      ].filter(Boolean);

  // Priority Styles
  const getPriorityBadge = () => {
    let text = 'Low';
    let color = 'var(--color-zinc-400)';
    let bg = 'rgba(255, 255, 255, 0.05)';
    let border = 'var(--color-zinc-800)';

    if (priority === 'high') {
      text = 'High';
      color = '#f87171';
      bg = 'rgba(239, 68, 68, 0.08)';
      border = 'rgba(239, 68, 68, 0.2)';
    } else if (priority === 'medium') {
      text = 'Medium';
      color = '#fbbf24';
      bg = 'rgba(245, 158, 11, 0.08)';
      border = 'rgba(245, 158, 11, 0.2)';
    }

    return (
      <span style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '2px 8px',
        borderRadius: '4px',
        color,
        backgroundColor: bg,
        border: `1px solid ${border}`
      }}>
        {text}
      </span>
    );
  };

  // Status Styles
  const getStatusConfig = () => {
    switch (status) {
      case 'resolved':
        return {
          label: 'Verified Closed',
          color: '#34d399',
          icon: <ShieldCheck size={14} style={{ color: '#34d399' }} />
        };
      case 'in_progress':
        return {
          label: 'Needs Review',
          color: '#fbbf24',
          icon: <Clock size={13} style={{ color: '#fbbf24' }} />
        };
      default:
        return {
          label: 'Open Defect',
          color: '#f87171',
          icon: <AlertTriangle size={14} style={{ color: '#f87171' }} />
        };
    }
  };

  const statusConfig = getStatusConfig();

  const handleSendPacketClick = async () => {
    if (!onSendPacket || preparingPacket) return;

    try {
      setPreparingPacket(true);
      await onSendPacket(issue);
    } catch (err) {
      console.error('Failed to prepare issue packet:', err);
      alert(err?.message || 'Could not create the issue packet PDF.');
    } finally {
      setPreparingPacket(false);
    }
  };

  const handleShareWithSub = async () => {
    const textLines = [
      `SiteTactix Issue: ${title}`,
      `Category: ${category?.replace(/_/g, ' ') || 'General'}${tradePhase ? ` (${tradePhase})` : ''}`,
      contractorName ? `Assigned To: ${contractorName}` : null,
      dueDate ? `Target Due Date: ${dueDateFormatted || dueDate}` : null,
      description ? `Details: ${description}` : null,
      photoUrl ? `Defect Photo: ${photoUrl}` : null,
      `Please text back a proof photo once completed for verification.`
    ].filter(Boolean).join('\n');

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(textLines);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
      }
    } catch (err) {
      console.warn('Failed to copy text:', err);
    }
  };

  const handleProofPhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
      const url = URL.createObjectURL(file);
      setProofPreview(url);
    }
  };

  const handleSubmitProof = async () => {
    setSubmittingProof(true);
    try {
      if (onMarkFixed) {
        await onMarkFixed(id, { proofPhotoFile: proofFile, proofNotes });
      } else if (onUpdateStatus) {
        await onUpdateStatus(id, 'in_progress');
      }
      setShowFixForm(false);
      setProofFile(null);
      setProofPreview(null);
      setProofNotes('');
    } catch (err) {
      console.error('Failed to submit proof photo:', err);
      alert('Failed to save proof photo.');
    } finally {
      setSubmittingProof(false);
    }
  };

  const handleVerifyClick = () => {
    // If no resolution photo is attached, require an explicit inspection record
    if (!hasProofPhoto) {
      setShowInspectionPrompt(true);
    } else {
      executeVerification();
    }
  };

  const executeVerification = async (inspectionNote = '') => {
    try {
      if (onVerify) {
        await onVerify(id, { verifiedBy: 'Builder', inspectionNote });
      } else if (onUpdateStatus) {
        await onUpdateStatus(id, 'resolved');
      }
      setShowInspectionPrompt(false);
      setInspectionRecordText('');
    } catch (err) {
      console.error('Failed to verify issue:', err);
      alert(err?.message || 'Failed to verify issue.');
    }
  };

  const handleConfirmReopen = async () => {
    const trimmedReason = reopenReasonText.trim();
    if (!trimmedReason) {
      alert('Please provide an explanatory note stating why the fix is rejected.');
      return;
    }

    try {
      if (onReopen) {
        await onReopen(id, { reason: trimmedReason });
      } else if (onUpdateStatus) {
        await onUpdateStatus(id, 'open');
      }
      setShowReopenPrompt(false);
      setReopenReasonText('');
    } catch (err) {
      console.error('Failed to reopen issue:', err);
      alert(err?.message || 'Failed to reopen issue.');
    }
  };

  const getActionColor = (act) => {
    switch (act) {
      case 'verified_closed': return '#34d399';
      case 'proof_submitted': return '#fbbf24';
      case 'rejected': return '#f87171';
      case 'assigned': return '#60a5fa';
      default: return 'var(--color-zinc-400)';
    }
  };

  const getActionIcon = (act) => {
    switch (act) {
      case 'verified_closed': return <ShieldCheck size={13} />;
      case 'proof_submitted': return <Camera size={13} />;
      case 'rejected': return <RotateCcw size={13} />;
      case 'assigned': return <ClipboardCheck size={13} />;
      default: return <AlertTriangle size={13} />;
    }
  };

  const formatActionTitle = (act) => {
    switch (act) {
      case 'created': return 'Defect Logged';
      case 'assigned': return 'Trade Assigned';
      case 'proof_submitted': return 'Proof Submitted';
      case 'rejected': return 'Inspection Rejected';
      case 'verified_closed': return 'Verified & Closed';
      default: return act;
    }
  };

  return (
    <div style={{
      backgroundColor: 'var(--color-zinc-900)',
      border: '1px solid var(--color-zinc-800)',
      borderRadius: '12px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      position: 'relative'
    }}>
      {/* Top row: Priority, Status (Left) | Utility Actions (Top-Right Corner) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
          {getPriorityBadge()}
          {status !== 'open' && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.68rem',
              fontWeight: 700,
              color: statusConfig.color,
              backgroundColor: `${statusConfig.color}15`,
              border: `1px solid ${statusConfig.color}35`,
              padding: '2px 7px',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}>
              {statusConfig.icon}
              <span>{statusConfig.label}</span>
            </span>
          )}
        </div>

        {/* Top-Right Utility Bar: ONLY Edit and Delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: 'auto' }}>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(issue)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-zinc-400)',
                cursor: 'pointer',
                padding: '3px 4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Edit issue"
            >
              <Edit3 size={14} />
            </button>
          )}

          <button
            onClick={() => {
              if (confirm('Are you sure you want to delete this issue?')) {
                onDelete(id);
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-zinc-400)',
              cursor: 'pointer',
              padding: '3px 4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Delete issue"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* If BOTH Before & After photos exist: Full-width text + Dedicated Comparison Grid below */}
      {hasBothPhotos ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 100% Full Width Text Section */}
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <h4 style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--color-zinc-100)',
                lineHeight: '1.4',
                margin: 0
              }}>
                {title}
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                {onSendPacket && (
                  <button
                    type="button"
                    onClick={handleSendPacketClick}
                    disabled={preparingPacket}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--color-zinc-800)',
                      color: 'var(--color-zinc-300)',
                      cursor: 'pointer',
                      padding: '3px 7px',
                      borderRadius: '5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      opacity: preparingPacket ? 0.6 : 1
                    }}
                    title="Download PDF Packet"
                  >
                    <FileText size={12} />
                    <span>{preparingPacket ? '...' : 'PDF'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleShareWithSub}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--color-zinc-800)',
                    color: copiedShare ? '#34d399' : 'var(--color-zinc-300)',
                    cursor: 'pointer',
                    padding: '3px 7px',
                    borderRadius: '5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '0.68rem',
                    fontWeight: 600
                  }}
                  title="Copy text summary to share with sub"
                >
                  {copiedShare ? <Check size={12} /> : <Share2 size={12} />}
                  <span>{copiedShare ? 'Copied!' : 'Share'}</span>
                </button>
              </div>
            </div>
            {description && (
              <p style={{
                fontSize: '0.85rem',
                color: 'var(--color-zinc-400)',
                lineHeight: '1.5',
                marginBottom: '6px'
              }}>
                {description}
              </p>
            )}

            {/* Category details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.75rem', color: 'var(--color-zinc-400)' }}>
              <div>
                Category: <strong style={{ color: 'var(--color-zinc-200)' }}>{category?.replace(/_/g, ' ')}</strong>
                {tradePhase && <span> • <strong>{tradePhase}</strong></span>}
              </div>
              {(contractorName || phoneNumber) && (
                <div>
                  Assigned: <strong style={{ color: 'var(--color-amber-400)' }}>{contractorName || 'N/A'}</strong> {phoneNumber ? `(${phoneNumber})` : ''}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--color-zinc-400)', flexWrap: 'wrap', marginTop: '3px' }}>
                {dateFormatted && dateFormatted !== 'N/A' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--color-zinc-500)' }}>
                    <Calendar size={11} />
                    <span>Logged {dateFormatted}</span>
                  </span>
                )}
                {dueDateFormatted && (
                  <span style={{
                    fontSize: '0.68rem',
                    color: 'var(--color-amber-400)',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}>
                    <Clock size={10} />
                    <span>Due {dueDateFormatted}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Dedicated Before & After Comparison Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            padding: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--color-zinc-800)',
            borderRadius: '10px'
          }}>
            {/* Before Photo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                🔴 Before
              </span>
              {defectImage.loading ? (
                <div style={{ width: '100%', height: '105px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-zinc-900)', borderRadius: '8px' }}>
                  <div className="spinner" style={{ width: '16px', height: '16px' }} />
                </div>
              ) : (
                <img
                  src={defectImage.src || getDisplayImageUrl(photoUrl, photoBase64, 'w400')}
                  alt="Defect photo"
                  loading="lazy"
                  onClick={() => setFullscreenPhotoSrc(defectImage.src || getDisplayImageUrl(photoUrl, photoBase64, 'w1000'))}
                  style={{
                    width: '100%',
                    height: '105px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: '1.5px solid rgba(239, 68, 68, 0.4)'
                  }}
                />
              )}
              {status === 'in_progress' && (
                <button
                  type="button"
                  onClick={() => setShowReopenPrompt(true)}
                  className="btn"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#f87171',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    borderRadius: '6px',
                    width: '100%'
                  }}
                >
                  <RotateCcw size={12} />
                  <span>Reject</span>
                </button>
              )}
            </div>

            {/* After Photo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  🟢 After
                </span>
                {proofSubmittedAt && (
                  <span style={{ fontSize: '0.60rem', color: 'var(--color-zinc-500)' }}>
                    {new Date(proofSubmittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
              {proofImage.loading ? (
                <div style={{ width: '100%', height: '105px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-zinc-900)', borderRadius: '8px' }}>
                  <div className="spinner" style={{ width: '16px', height: '16px' }} />
                </div>
              ) : (
                <img
                  src={proofImage.src || getDisplayImageUrl(proofPhotoUrl, proofPhotoBase64, 'w400')}
                  alt="Proof resolution photo"
                  loading="lazy"
                  onClick={() => setFullscreenPhotoSrc(proofImage.src || getDisplayImageUrl(proofPhotoUrl, proofPhotoBase64, 'w1000'))}
                  style={{
                    width: '100%',
                    height: '105px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: '1.5px solid rgba(52, 211, 153, 0.4)'
                  }}
                />
              )}
              {status === 'in_progress' && (
                <button
                  type="button"
                  onClick={handleVerifyClick}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    borderRadius: '6px',
                    width: '100%'
                  }}
                >
                  <ShieldCheck size={13} />
                  <span>Verify</span>
                </button>
              )}
            </div>
          </div>

          {status === 'resolved' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowReopenPrompt(true)}
                className="btn"
                style={{
                  backgroundColor: 'var(--color-zinc-800)',
                  border: '1px solid var(--color-zinc-700)',
                  color: 'var(--color-zinc-300)',
                  fontSize: '0.66rem',
                  padding: '4px 10px',
                  borderRadius: '5px'
                }}
              >
                Reopen Issue
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Single Photo (or No Photo) Compact Row: Text on Left + 72px Thumbnail on Right */
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <h4 style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--color-zinc-100)',
                lineHeight: '1.4',
                margin: 0
              }}>
                {title}
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                {onSendPacket && (
                  <button
                    type="button"
                    onClick={handleSendPacketClick}
                    disabled={preparingPacket}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--color-zinc-800)',
                      color: 'var(--color-zinc-300)',
                      cursor: 'pointer',
                      padding: '3px 7px',
                      borderRadius: '5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      opacity: preparingPacket ? 0.6 : 1
                    }}
                    title="Download PDF Packet"
                  >
                    <FileText size={12} />
                    <span>{preparingPacket ? '...' : 'PDF'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleShareWithSub}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--color-zinc-800)',
                    color: copiedShare ? '#34d399' : 'var(--color-zinc-300)',
                    cursor: 'pointer',
                    padding: '3px 7px',
                    borderRadius: '5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '0.68rem',
                    fontWeight: 600
                  }}
                  title="Copy text summary to share with sub"
                >
                  {copiedShare ? <Check size={12} /> : <Share2 size={12} />}
                  <span>{copiedShare ? 'Copied!' : 'Share'}</span>
                </button>
              </div>
            </div>
            {description && (
              <p style={{
                fontSize: '0.85rem',
                color: 'var(--color-zinc-400)',
                lineHeight: '1.5',
                marginBottom: '6px'
              }}>
                {description}
              </p>
            )}

            {/* Category details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.75rem', color: 'var(--color-zinc-400)' }}>
              <div>
                Category: <strong style={{ color: 'var(--color-zinc-200)' }}>{category?.replace(/_/g, ' ')}</strong>
                {tradePhase && <span> • <strong>{tradePhase}</strong></span>}
              </div>
              {(contractorName || phoneNumber) && (
                <div>
                  Assigned: <strong style={{ color: 'var(--color-amber-400)' }}>{contractorName || 'N/A'}</strong> {phoneNumber ? `(${phoneNumber})` : ''}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--color-zinc-400)', flexWrap: 'wrap', marginTop: '3px' }}>
                {dateFormatted && dateFormatted !== 'N/A' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--color-zinc-500)' }}>
                    <Calendar size={11} />
                    <span>Logged {dateFormatted}</span>
                  </span>
                )}
                {dueDateFormatted && (
                  <span style={{
                    fontSize: '0.68rem',
                    color: 'var(--color-amber-400)',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}>
                    <Clock size={10} />
                    <span>Due {dueDateFormatted}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Side: Single Compact Thumbnail + Action Button Underneath */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
            {hasDefectPhoto && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                  🔴 Before
                </span>
                {defectImage.loading ? (
                  <div style={{ width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-zinc-900)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    <div className="spinner" style={{ width: '16px', height: '16px' }} />
                  </div>
                ) : (
                  <img
                    src={defectImage.src || getDisplayImageUrl(photoUrl, photoBase64, 'w400')}
                    alt="Defect photo"
                    loading="lazy"
                    onClick={() => setFullscreenPhotoSrc(defectImage.src || getDisplayImageUrl(photoUrl, photoBase64, 'w1000'))}
                    style={{
                      width: '72px',
                      height: '72px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: '1.5px solid rgba(239, 68, 68, 0.4)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                    }}
                  />
                )}
              </div>
            )}

            {hasProofPhoto && !hasDefectPhoto && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                  🟢 After
                </span>
                {proofImage.loading ? (
                  <div style={{ width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-zinc-900)', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                    <div className="spinner" style={{ width: '16px', height: '16px' }} />
                  </div>
                ) : (
                  <img
                    src={proofImage.src || getDisplayImageUrl(proofPhotoUrl, proofPhotoBase64, 'w400')}
                    alt="Proof photo"
                    loading="lazy"
                    onClick={() => setFullscreenPhotoSrc(proofImage.src || getDisplayImageUrl(proofPhotoUrl, proofPhotoBase64, 'w1000'))}
                    style={{
                      width: '72px',
                      height: '72px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: '1.5px solid rgba(52, 211, 153, 0.4)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                    }}
                  />
                )}
              </div>
            )}

            {/* Action Button: Underneath the single thumbnail */}
            {status === 'open' && !showFixForm && (
              <button
                type="button"
                onClick={() => setShowFixForm(true)}
                className="btn"
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: 'var(--color-amber-400)',
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  padding: '3px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                  borderRadius: '5px',
                  width: '100%',
                  maxWidth: '72px',
                  whiteSpace: 'nowrap'
                }}
                title="Mark as Fixed"
              >
                <Camera size={11} />
                <span>Mark Fixed</span>
              </button>
            )}

            {status === 'in_progress' && (
              <div style={{ display: 'flex', gap: '4px', width: '100%', maxWidth: '72px' }}>
                <button
                  type="button"
                  onClick={() => setShowReopenPrompt(true)}
                  className="btn"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    padding: '3px 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '5px',
                    flex: 1
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleVerifyClick}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    color: '#fff',
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    padding: '3px 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '5px',
                    flex: 1
                  }}
                >
                  Verify
                </button>
              </div>
            )}

            {status === 'resolved' && (
              <button
                type="button"
                onClick={() => setShowReopenPrompt(true)}
                className="btn"
                style={{
                  backgroundColor: 'var(--color-zinc-800)',
                  border: '1px solid var(--color-zinc-700)',
                  color: 'var(--color-zinc-300)',
                  fontSize: '0.64rem',
                  padding: '3px 6px',
                  borderRadius: '5px',
                  width: '100%',
                  maxWidth: '72px'
                }}
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stored Proof Notes (if any) */}
      {storedProofNotes && (
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--color-zinc-300)',
          fontStyle: 'italic',
          padding: '6px 10px',
          backgroundColor: 'rgba(52, 211, 153, 0.05)',
          borderLeft: '3px solid #34d399',
          borderRadius: '4px'
        }}>
          <strong>Fix notes:</strong> "{storedProofNotes}"
        </div>
      )}

      {/* Reopen Warning Banner (if issue was previously reopened) */}
      {reopenReason && status === 'open' && (
        <div style={{
          padding: '8px 10px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '6px',
          fontSize: '0.75rem',
          color: '#fca5a5'
        }}>
          <strong>Rejected by Builder:</strong> "{reopenReason}"
        </div>
      )}

      {/* Verification Banner (if resolved) */}
      {status === 'resolved' && (
        <div style={{
          padding: '8px 10px',
          backgroundColor: 'rgba(52, 211, 153, 0.1)',
          border: '1px solid rgba(52, 211, 153, 0.25)',
          borderRadius: '6px',
          fontSize: '0.75rem',
          color: '#6ee7b7',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <ShieldCheck size={16} style={{ color: '#34d399' }} />
          <span>
            Verified Closed by <strong>{verifiedBy || 'Builder'}</strong>
            {verifiedAt && ` on ${new Date(verifiedAt).toLocaleDateString()}`}
          </span>
        </div>
      )}

      {/* Inline Form to Attach Proof Photo (Recorded by Builder on behalf of sub) */}
      {showFixForm && (
        <div style={{
          backgroundColor: 'var(--color-zinc-950)',
          border: '1px dashed var(--color-amber-500)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-amber-400)' }}>
              Record Resolution Proof {contractorName ? `for ${contractorName}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setShowFixForm(false)}
              style={{ background: 'none', border: 'none', color: 'var(--color-zinc-500)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>

          <input
            type="file"
            ref={proofInputRef}
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleProofPhotoSelect}
          />

          {proofPreview ? (
            <div style={{ position: 'relative', width: '100%', height: '110px', borderRadius: '6px', overflow: 'hidden' }}>
              <img src={proofPreview} alt="Proof preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                onClick={() => { setProofFile(null); setProofPreview(null); }}
                style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', padding: '4px', cursor: 'pointer' }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => proofInputRef.current?.click()}
              className="btn"
              style={{
                backgroundColor: 'var(--color-zinc-800)',
                border: '1px solid var(--color-zinc-700)',
                color: '#fff',
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px'
              }}
            >
              <Camera size={15} />
              <span>Snap / Upload Resolution Photo</span>
            </button>
          )}

          <textarea
            placeholder={`Resolution notes from ${contractorName || 'subcontractor'} (e.g. Rerouted pipe and installed 16ga protection plate)...`}
            value={proofNotes}
            onChange={(e) => setProofNotes(e.target.value)}
            className="form-input"
            rows={2}
            style={{ fontSize: '0.78rem', resize: 'none' }}
          />

          <button
            type="button"
            disabled={submittingProof || (!proofFile && !proofNotes.trim())}
            onClick={handleSubmitProof}
            className="btn btn-primary"
            style={{ fontSize: '0.78rem', padding: '8px', fontWeight: 700 }}
          >
            {submittingProof ? 'Saving Proof...' : 'Submit Resolution Proof'}
          </button>
        </div>
      )}

      {/* Inspection Record Prompt (When verifying without photo evidence) */}
      {showInspectionPrompt && (
        <div style={{
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399' }}>
            No Resolution Photo Attached — Enter Inspection Record:
          </span>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-zinc-400)', margin: 0 }}>
            To prevent unverified closeouts, verification requires a photo or an explicit builder inspection sign-off note.
          </p>
          <textarea
            placeholder="e.g. Walked site with plumber, verified leak test passed and nail plate installed properly..."
            value={inspectionRecordText}
            onChange={(e) => setInspectionRecordText(e.target.value)}
            className="form-input"
            rows={2}
            style={{ fontSize: '0.78rem', resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowInspectionPrompt(false)}
              className="btn"
              style={{ backgroundColor: 'var(--color-zinc-800)', border: 'none', color: '#fff', fontSize: '0.74rem' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!inspectionRecordText.trim()}
              onClick={() => executeVerification(inspectionRecordText.trim())}
              className="btn"
              style={{ backgroundColor: '#10b981', border: 'none', color: '#fff', fontSize: '0.74rem', fontWeight: 700, opacity: inspectionRecordText.trim() ? 1 : 0.5 }}
            >
              Certify & Close
            </button>
          </div>
        </div>
      )}

      {/* Reject / Reopen Feedback Prompt (Requires mandatory note) */}
      {showReopenPrompt && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f87171' }}>
            Reason for Rejecting Fix (Required):
          </span>
          <textarea
            placeholder="e.g. Plate is only 18-gauge, code requires 16-gauge steel plate here..."
            value={reopenReasonText}
            onChange={(e) => setReopenReasonText(e.target.value)}
            className="form-input"
            rows={2}
            style={{ fontSize: '0.78rem', resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowReopenPrompt(false)}
              className="btn"
              style={{ backgroundColor: 'var(--color-zinc-800)', border: 'none', color: '#fff', fontSize: '0.74rem' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reopenReasonText.trim()}
              onClick={handleConfirmReopen}
              className="btn"
              style={{ backgroundColor: '#ef4444', border: 'none', color: '#fff', fontSize: '0.74rem', fontWeight: 700, opacity: reopenReasonText.trim() ? 1 : 0.5 }}
            >
              Reject & Send Back
            </button>
          </div>
        </div>
      )}

      {/* Activity Timeline (append-only by convention) */}
      <div style={{
        marginTop: '2px',
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
        border: '1px solid var(--color-zinc-800)',
        borderRadius: '8px',
        padding: '8px 12px'
      }}>
        <div
          onClick={() => setShowTimeline(prev => !prev)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <History size={13} style={{ color: 'var(--color-zinc-400)' }} />
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-zinc-400)', letterSpacing: '0.02em' }}>
              Activity Timeline ({historyItems.length})
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-zinc-500)', fontWeight: 600 }}>
            {showTimeline ? '▲ Hide' : '▼ View History'}
          </span>
        </div>

        {showTimeline && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {historyItems.map((item, idx) => (
              <div key={item.id || idx} style={{ display: 'flex', gap: '8px', fontSize: '0.74rem', alignItems: 'flex-start' }}>
                <span style={{ color: getActionColor(item.action), marginTop: '2px' }}>
                  {getActionIcon(item.action)}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--color-zinc-200)' }}>{formatActionTitle(item.action)}</strong>
                    <span style={{ color: 'var(--color-zinc-500)', fontSize: '0.68rem' }}>
                      by {item.actor || 'Builder'} • {new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {item.details && <span style={{ color: 'var(--color-zinc-400)', fontSize: '0.72rem' }}>{item.details}</span>}
                  {item.note && <span style={{ color: 'var(--color-zinc-300)', fontStyle: 'italic', fontSize: '0.72rem' }}>"{item.note}"</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Photo Modal */}
      {fullscreenPhotoSrc && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.92)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2500,
          padding: '20px',
          backdropFilter: 'blur(8px)'
        }}>
          <button
            onClick={() => setFullscreenPhotoSrc(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: '50%',
              color: 'white',
              cursor: 'pointer',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={24} />
          </button>
          <img
            src={fullscreenPhotoSrc}
            alt="Fullscreen Issue view"
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px'
            }}
          />
        </div>
      )}
    </div>
  );
}
