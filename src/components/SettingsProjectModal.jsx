import React from 'react';
import { CheckCircle, FolderOpen, FolderPlus, X } from 'lucide-react';

export default function SettingsProjectModal({
  isOpen,
  editingProject,
  projectName,
  selectedFolder,
  onProjectNameChange,
  onOpenFolderPicker,
  onCancel,
  onSave
}) {
  if (!isOpen) return null;

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
                backgroundColor: 'rgba(197, 160, 89, 0.08)',
                border: '1px solid rgba(197, 160, 89, 0.2)',
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
            disabled={!projectName.trim() || !selectedFolder}
          >
            {editingProject ? 'Update Project' : 'Save Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
