import React from 'react';
import { CheckCircle, FolderOpen, FolderPlus, X } from 'lucide-react';

export default function SettingsProjectModal({
  isOpen,
  editingProject,
  projectName,
  selectedFolder,
  sheetPreview = { status: 'idle' },
  selectedSheet = null,
  onSelectSheet,
  projectDetails = {},
  onProjectDetailChange,
  sheetInfo = { status: 'idle' },
  templateAvailable = false,
  useTemplate = false,
  onUseTemplateChange,
  saving = false,
  onProjectNameChange,
  onOpenFolderPicker,
  onCancel,
  onSave
}) {
  if (!isOpen) return null;

  const makingFromTemplate = !editingProject && templateAvailable && useTemplate;
  // The house details live in the new-layout Sheet's Project Info tab
  const showDetails = makingFromTemplate || sheetInfo.status === 'v2';
  const detailFields = [
    { field: 'address', label: 'Street Address', placeholder: 'e.g. 1204 Northwood Trail' },
    { field: 'cityStateZip', label: 'City, State, Zip', placeholder: 'e.g. McAllen, TX 78504' },
    { field: 'scope', label: 'Development Scope', placeholder: 'e.g. Single Family Residence Plan' },
    { field: 'budgetBuild', label: 'Budget for Build (Hard Costs)', placeholder: 'e.g. 240000', numeric: true },
    { field: 'lotCost', label: 'Lot Cost (Land)', placeholder: 'e.g. 70500', numeric: true }
  ];

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 900,
      padding: '20px',
      backdropFilter: 'blur(4px)'
    }}>
      <div className="settings-card" style={{
        width: '100%',
        maxWidth: '380px',
        maxHeight: '100%',
        overflowY: 'auto',
        backgroundColor: 'var(--color-zinc-950)',
        border: '1px solid var(--color-zinc-800)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-zinc-800)', paddingBottom: '12px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--color-zinc-100)', fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderPlus size={18} style={{ color: 'var(--color-amber-500)' }} />
            {editingProject ? 'Edit Project Profile' : 'Create New Project'}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="new-project-name">Project Name</label>
            <input
              type="text"
              id="new-project-name"
              className="form-input"
              value={projectName}
              onChange={(e) => onProjectNameChange(e.target.value)}
              placeholder="e.g. Lot 102, 456 Oak St"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Google Drive Folder</label>

            {selectedFolder ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--color-emerald-500)',
                fontWeight: 500,
                marginBottom: '8px'
              }}>
                <CheckCircle size={16} style={{ flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Linked Folder: <strong>{selectedFolder.name}</strong>
                </span>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                backgroundColor: 'rgba(241, 215, 167, 0.08)',
                border: '1px solid rgba(241, 215, 167, 0.2)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--color-amber-500)',
                fontWeight: 500,
                marginBottom: '8px'
              }}>
                <span>No folder linked yet.</span>
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={onOpenFolderPicker}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px' }}
            >
              <FolderOpen size={16} />
              {selectedFolder ? 'Change Folder...' : 'Select Target Folder...'}
            </button>
          </div>

          {!editingProject && selectedFolder && templateAvailable && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.8rem', color: 'var(--color-zinc-300)', lineHeight: 1.4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => onUseTemplateChange?.(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <span>Make a new Sheet for this house from the template (saved in this folder)</span>
            </label>
          )}

          {!editingProject && !templateAvailable && (
            <div style={{ fontSize: '0.76rem', color: 'var(--color-zinc-500)', lineHeight: 1.4 }}>
              No Sheet template is set up yet, so the project links the Sheet already in its folder.
            </div>
          )}

          {selectedFolder && makingFromTemplate && (
            <div style={{
              padding: '10px 12px', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '8px', fontSize: '0.8rem', color: 'var(--color-emerald-500)', lineHeight: 1.4
            }}>
              A new Sheet named "{(projectName || '').trim() || 'New Project'} – SiteTactix" will be made in this folder and linked.
            </div>
          )}

          {showDetails && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {detailFields.map(({ field, label, placeholder, numeric }) => (
                <div className="form-group" key={field}>
                  <label className="form-label" htmlFor={`project-${field}`}>{label}</label>
                  <input
                    type="text"
                    inputMode={numeric ? 'decimal' : undefined}
                    id={`project-${field}`}
                    className="form-input"
                    value={projectDetails[field] || ''}
                    onChange={(e) => onProjectDetailChange?.(field, e.target.value)}
                    placeholder={placeholder}
                  />
                </div>
              ))}
              <div style={{ fontSize: '0.72rem', color: 'var(--color-zinc-500)' }}>
                Saved to the Sheet's Project Info tab.
              </div>
            </div>
          )}

          {selectedFolder && !makingFromTemplate && (
            <div className="form-group">
              <label className="form-label">Google Sheet</label>
              {sheetPreview.status === 'loading' && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', padding: '6px 2px' }}>Looking for the spreadsheet in this folder...</div>
              )}
              {sheetPreview.status === 'linked' && selectedSheet && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)',
                  borderRadius: '8px', fontSize: '0.85rem', color: 'var(--color-emerald-500)', fontWeight: 500
                }}>
                  <CheckCircle size={16} style={{ flex: 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Sheet found: <strong>{selectedSheet.name}</strong>
                  </span>
                </div>
              )}
              {sheetPreview.status === 'choose' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-amber-500)' }}>This folder has more than one spreadsheet. Tap the project's budget Sheet:</div>
                  {sheetPreview.candidates.map(sheet => (
                    <button
                      key={sheet.id}
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onSelectSheet?.(sheet)}
                      style={{
                        justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.8rem', textAlign: 'left',
                        borderColor: selectedSheet?.id === sheet.id ? 'var(--color-emerald-500)' : undefined,
                        color: selectedSheet?.id === sheet.id ? 'var(--color-emerald-500)' : undefined
                      }}
                    >
                      {selectedSheet?.id === sheet.id ? '✓ ' : ''}{sheet.name}
                    </button>
                  ))}
                </div>
              )}
              {sheetPreview.status === 'none' && (
                <div style={{
                  padding: '10px 12px', backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: '8px', fontSize: '0.8rem', color: 'var(--color-amber-500)', lineHeight: 1.4
                }}>
                  No spreadsheet found in this folder. Receipts can't sync to a Sheet until there is one. Pick a different folder, or add the Sheet to this folder later and the app will link it automatically.
                </div>
              )}
              {sheetPreview.status === 'error' && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)' }}>Couldn't check for a spreadsheet right now. The app will link it automatically later.</div>
              )}
            </div>
          )}

        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '8px', borderTop: '1px solid var(--color-zinc-800)', paddingTop: '12px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={onSave}
            disabled={saving || !projectName.trim() || !selectedFolder}
          >
            {saving ? 'Saving...' : (editingProject ? 'Update Project' : 'Save Project')}
          </button>
        </div>
      </div>
    </div>
  );
}
