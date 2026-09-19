import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, Upload, Check } from 'lucide-react';
import { TRADE_SECTIONS_CONFIG } from '../services/editFormHelpers';
import { getProjectPacketInfo } from '../services/projectInfoFormatter';
import { useAuthenticatedDriveImage } from '../hooks/useAuthenticatedDriveImage';

function getDisplayImageUrl(url, base64, size = 'w400') {
  if (base64) return base64;
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${driveIdMatch[1]}&sz=${size}`;
  }

  return url;
}

export default function IssueFormModal({
  issues,
  contacts = {},
  subcontractors = [],
  initialFloorLocation = null,
  editingIssue = null,
  projectInfo = null,
  projectName = '',
  selectedFolderName = '',
  googleToken = null,
  onSave,
  onClose
}) {
  const isEditing = Boolean(editingIssue);
  const packetProject = getProjectPacketInfo(projectInfo, projectName, selectedFolderName);
  const [title, setTitle] = useState(editingIssue?.title || '');
  const [description, setDescription] = useState(editingIssue?.description || '');
  const [category, setCategory] = useState(editingIssue?.category || Object.keys(TRADE_SECTIONS_CONFIG)[0]);
  const [tradePhase, setTradePhase] = useState(editingIssue?.tradePhase || '');
  const [contractorName, setContractorName] = useState(editingIssue?.contractorName || '');
  const [phoneNumber, setPhoneNumber] = useState(editingIssue?.phoneNumber || '');
  const [priority, setPriority] = useState(editingIssue?.priority || 'medium'); // 'low' | 'medium' | 'high'
  const [dueDate, setDueDate] = useState(editingIssue?.dueDate || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(getDisplayImageUrl(editingIssue?.photoUrl || '', editingIssue?.photoBase64 || '', 'w400') || null);
  const [showContactPickerBtn, setShowContactPickerBtn] = useState(false);

  const authImage = useAuthenticatedDriveImage({
    googleToken,
    fileId: editingIssue?.photoFileId,
    url: editingIssue?.photoUrl,
    base64: editingIssue?.photoBase64
  });

  useEffect(() => {
    if (authImage.src && !photoFile) {
      setPhotoPreview(authImage.src);
    }
  }, [authImage.src, photoFile]);

  const fileInputRef = useRef(null);

  // Get phases for the selected category
  const phases = TRADE_SECTIONS_CONFIG[category]?.phases || [];

  // Update selected phase when category changes
  useEffect(() => {
    if (phases.length > 0 && !phases.includes(tradePhase)) {
      setTradePhase(phases[0]);
    } else if (phases.length === 0) {
      setTradePhase('');
    }
  }, [category, phases, tradePhase]);

  // Detect support for Contacts Picker API (supported on mobile devices)
  useEffect(() => {
    if (navigator.contacts && typeof navigator.contacts.select === 'function') {
      setShowContactPickerBtn(true);
    }
  }, []);

  // Pre-fill contractor name and phone number from sheet or cloud contacts or past issues
  useEffect(() => {
    if (isEditing) return;

    const normalizeStr = (str) => String(str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // 1. Find matching subcontractor payee from the sheet (matching by phase name, just like the dashboard does)
    const matchedSub = subcontractors.find(sub => 
      normalizeStr(sub.phase) === normalizeStr(tradePhase)
    );
    let name = matchedSub?.payee || '';
    
    // Ignore default placeholder payee names
    const isPlaceholder = name.toLowerCase().endsWith('payee') || 
                          name.toLowerCase().includes('placeholder') ||
                          name.toLowerCase() === `${tradePhase.toLowerCase()} contractor`;
    if (isPlaceholder) {
      name = '';
    }
    
    // 2. If no payee name found in spreadsheet for this phase, look up past issues
    if (!name && issues && issues.length > 0) {
      const pastIssue = [...issues]
        .reverse()
        .find(i => (!tradePhase || normalizeStr(i.tradePhase) === normalizeStr(tradePhase)) && i.contractorName);
      if (pastIssue) name = pastIssue.contractorName;
    }

    // 3. Find phone number from the Drive contacts directory
    let phone = '';
    if (name) {
      phone = contacts[name] || '';
    }

    // 4. If no phone found, check past issues for a phone number for this contractor name or phase
    if (!phone && name && issues && issues.length > 0) {
      const pastIssueWithPhone = [...issues]
        .reverse()
        .find(i => i.contractorName === name && i.phoneNumber);
      if (pastIssueWithPhone) {
        phone = pastIssueWithPhone.phoneNumber;
      }
    }

    setContractorName(name);
    setPhoneNumber(phone);
  }, [category, tradePhase, subcontractors, contacts, issues, isEditing]);

  // Handle Contact Picker selection
  const handleSelectContact = async () => {
    try {
      const props = ['name', 'tel'];
      const opts = { multiple: false };
      const selected = await navigator.contacts.select(props, opts);
      if (selected && selected.length > 0) {
        const contact = selected[0];
        const rawName = contact.name?.[0] || '';
        const rawPhone = contact.tel?.[0] || '';
        if (rawName) setContractorName(rawName);
        if (rawPhone) setPhoneNumber(rawPhone);
      }
    } catch (err) {
      console.warn('Contact picker cancelled or failed:', err);
    }
  };

function compressImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name || 'photo.jpg', {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setPhotoFile(compressed);
        const reader = new FileReader();
        reader.onloadend = () => {
          setPhotoPreview(reader.result);
        };
        reader.readAsDataURL(compressed);
      } catch (err) {
        console.error('Failed to compress photo:', err);
        setPhotoFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
          setPhotoPreview(reader.result);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const triggerCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment');
      fileInputRef.current.click();
    }
  };

  const triggerFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture');
      fileInputRef.current.click();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      title: title.trim(),
      description: description.trim(),
      category,
      tradePhase,
      contractorName: contractorName.trim(),
      phoneNumber: phoneNumber.trim(),
      priority,
      dueDate: dueDate.trim(),
      photoFile,
      floorPlanX: Number.isFinite(initialFloorLocation?.x)
        ? initialFloorLocation.x
        : (Number.isFinite(Number(editingIssue?.floorPlanX)) ? editingIssue.floorPlanX : null),
      floorPlanY: Number.isFinite(initialFloorLocation?.y)
        ? initialFloorLocation.y
        : (Number.isFinite(Number(editingIssue?.floorPlanY)) ? editingIssue.floorPlanY : null)
    });
  };


  return (
    <div className="modal-backdrop">
      <div className="settings-card modal-container" style={{
        maxHeight: '90vh',
        overflowY: 'auto',
        maxWidth: '480px',
        width: '100%',
        margin: '20px auto',
        backgroundColor: 'var(--color-zinc-950)',
        border: '1px solid var(--color-zinc-800)',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-zinc-800)',
          paddingBottom: '14px',
          marginBottom: '16px'
        }}>
          <h3 style={{
            fontSize: '1.2rem',
            fontWeight: 700,
            color: 'var(--color-zinc-100)',
            fontFamily: 'var(--font-serif)'
          }}>
            {isEditing ? 'Edit Issue' : 'Log New Issue'}
          </h3>
          <button 
            type="button" 
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-zinc-400)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{
            border: '1px solid rgba(241, 215, 167, 0.24)',
            backgroundColor: 'rgba(241, 215, 167, 0.07)',
            borderRadius: '10px',
            padding: '10px 12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '8px 12px'
          }}>
            <div style={{ gridColumn: '1 / -1', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-amber-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Project Location
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--color-zinc-500)', fontWeight: 700, textTransform: 'uppercase' }}>Subdivision</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-zinc-100)', fontWeight: 700 }}>{packetProject.subdivision}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--color-zinc-500)', fontWeight: 700, textTransform: 'uppercase' }}>Lot</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-zinc-100)', fontWeight: 700 }}>{packetProject.lotNumber}</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '0.66rem', color: 'var(--color-zinc-500)', fontWeight: 700, textTransform: 'uppercase' }}>Address</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-zinc-200)', fontWeight: 600, lineHeight: 1.35 }}>{packetProject.fullAddress}</div>
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="issue-title">Title *</label>
            <input
              id="issue-title"
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Broken tile, leaking pipe"
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="issue-desc">Description</label>
            <textarea
              id="issue-desc"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue details for the contractor..."
              style={{ minHeight: '60px', resize: 'vertical' }}
            />
          </div>

          {/* Priority Selection */}
          <div>
            <label className="form-label">Priority</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['low', 'medium', 'high'].map((level) => {
                const isActive = priority === level;
                let color = 'var(--color-zinc-400)';
                let activeBg = 'var(--color-zinc-800)';
                let activeBorder = 'var(--color-zinc-700)';

                if (level === 'high') {
                  color = '#ef4444';
                  activeBg = 'rgba(239, 68, 68, 0.12)';
                  activeBorder = '#ef4444';
                } else if (level === 'medium') {
                  color = '#F1D7A7';
                  activeBg = 'rgba(241, 215, 167, 0.12)';
                  activeBorder = '#F1D7A7';
                }

                return (
                  <button
                    key={level}
                    type="button"
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '8px',
                      border: isActive ? `1.5px solid ${activeBorder}` : '1px solid var(--color-zinc-800)',
                      backgroundColor: isActive ? activeBg : 'transparent',
                      color: isActive ? color : 'var(--color-zinc-400)',
                      fontSize: '0.85rem',
                      fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => setPriority(level)}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>

          {(initialFloorLocation || Number.isFinite(Number(editingIssue?.floorPlanX))) && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(241, 215, 167, 0.25)',
              backgroundColor: 'rgba(241, 215, 167, 0.08)',
              color: 'var(--color-amber-400)',
              fontSize: '0.78rem',
              fontWeight: 600
            }}>
              Floor plan location attached
            </div>
          )}

          {/* Trade Category Selection */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label" htmlFor="issue-cat">Trade Category</label>
              <select
                id="issue-cat"
                className="form-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ appearance: 'auto' }}
              >
                {Object.keys(TRADE_SECTIONS_CONFIG).map((key) => (
                  <option key={key} value={key}>
                    {TRADE_SECTIONS_CONFIG[key].label}
                  </option>
                ))}
              </select>
            </div>

            {phases.length > 0 && (
              <div style={{ flex: 1 }}>
                <label className="form-label" htmlFor="issue-phase">Phase / Area</label>
                <select
                  id="issue-phase"
                  className="form-input"
                  value={tradePhase}
                  onChange={(e) => setTradePhase(e.target.value)}
                  style={{ appearance: 'auto' }}
                >
                  {phases.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Contractor Details */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Contractor Details</label>
              {showContactPickerBtn && (
                <button
                  type="button"
                  onClick={handleSelectContact}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: 'var(--color-zinc-900)',
                    border: '1px solid var(--color-zinc-800)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    color: 'var(--color-amber-500)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <span>👤 Import Contact</span>
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
              <div style={{ flex: 1 }}>
                <label className="form-label" htmlFor="contractor-name" style={{ fontSize: '0.75rem', opacity: 0.8 }}>Name</label>
                <input
                  id="contractor-name"
                  type="text"
                  className="form-input"
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  placeholder="e.g. John (Plumbing)"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label" htmlFor="contractor-phone" style={{ fontSize: '0.75rem', opacity: 0.8 }}>Phone</label>
                <input
                  id="contractor-phone"
                  type="tel"
                  className="form-input"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. +15550199"
                />
              </div>
            </div>
          </div>

          {/* Priority & Due Date */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label" htmlFor="issue-priority">Priority</label>
              <select
                id="issue-priority"
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                style={{ appearance: 'auto' }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label" htmlFor="issue-due-date">Target Due Date</label>
              <input
                id="issue-due-date"
                type="date"
                className="form-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Photo Attachment Section */}
          <div>
            <label className="form-label">Attach Photo Proof</label>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
            
            {photoPreview ? (
              <div style={{ position: 'relative', marginTop: '4px' }}>
                <img
                  src={photoPreview}
                  alt="Preview"
                  style={{
                    width: '100%',
                    maxHeight: '140px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: '1px solid var(--color-zinc-800)'
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    border: 'none',
                    borderRadius: '50%',
                    color: 'white',
                    cursor: 'pointer',
                    padding: '4px'
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={triggerCamera}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Camera size={16} />
                  <span>Snap Photo</span>
                </button>
                <button
                  type="button"
                  onClick={triggerFileSelect}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Upload size={16} />
                  <span>Choose File</span>
                </button>
              </div>
            )}
          </div>

          {/* Submit Actions */}
          <div style={{
            display: 'flex',
            gap: '10px',
            marginTop: '10px',
            borderTop: '1px solid var(--color-zinc-800)',
            paddingTop: '14px'
          }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, padding: '10px' }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 2, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <Check size={16} />
              <span>{isEditing ? 'Save Changes' : 'Log Issue'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
