import React from 'react';
import { Check, ChevronRight, FileSpreadsheet, Folder, FolderOpen, FolderPlus, X } from 'lucide-react';
import { STATUS_MESSAGES } from '../services/appErrors';

export default function SettingsFolderPickerModal({
  isOpen,
  folders,
  sheets = [],
  loadingFolders,
  breadcrumbs,
  currentParentId,
  selectedFolder,
  newFolderName,
  canCreateFolder,
  onClose,
  onNavigateToCrumb,
  onOpenFolder,
  onSelectFolder,
  onUseCurrentFolder,
  onNewFolderNameChange,
  onCreateFolder
}) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
      backdropFilter: 'blur(4px)'
    }}>
      <div className="settings-card" style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: 'var(--color-zinc-950)',
        border: '1px solid var(--color-zinc-800)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-zinc-800)', paddingBottom: '12px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--color-zinc-100)', fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={18} style={{ color: 'var(--color-amber-500)' }} />
            Select Google Drive Folder
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px',
          fontSize: '0.82rem',
          backgroundColor: 'var(--color-zinc-900)',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--color-zinc-800)'
        }}>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <ChevronRight size={12} style={{ color: 'var(--color-zinc-600)' }} />}
              <button
                type="button"
                onClick={() => onNavigateToCrumb(crumb, idx)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: idx === breadcrumbs.length - 1 ? 'var(--color-amber-500)' : 'var(--color-zinc-400)',
                  fontWeight: idx === breadcrumbs.length - 1 ? '700' : '500',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: '4px'
                }}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '220px',
          overflowY: 'auto',
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid var(--color-zinc-800)',
          borderRadius: '8px',
          padding: '6px',
          minHeight: '120px'
        }}>
          {loadingFolders ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', margin: '0 auto 8px auto' }}></div>
              {STATUS_MESSAGES.loadingFolders}
            </div>
          ) : folders.length === 0 && sheets.length === 0 ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--color-zinc-600)', fontSize: '0.85rem' }}>
              No subfolders found inside this directory.
            </div>
          ) : (
            <>
            {folders.map(folder => (
              <div
                key={folder.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--color-zinc-950)',
                  border: '1px solid var(--color-zinc-800)',
                  fontSize: '0.85rem'
                }}
              >
                <div
                  onClick={() => onOpenFolder(folder)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, fontWeight: 500, minWidth: 0, paddingRight: '8px' }}
                >
                  <Folder size={16} style={{ color: 'var(--color-amber-500)', flex: 'none' }} />
                  <span style={{ color: 'var(--color-zinc-200)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder.name}</span>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectFolder(folder)}
                  className="btn btn-secondary"
                  style={{
                    width: 'auto',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    borderColor: selectedFolder?.id === folder.id ? 'var(--color-emerald-500)' : 'var(--color-zinc-700)',
                    backgroundColor: selectedFolder?.id === folder.id ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-zinc-800)',
                    color: selectedFolder?.id === folder.id ? 'var(--color-emerald-500)' : 'var(--color-zinc-200)'
                  }}
                >
                  {selectedFolder?.id === folder.id ? <Check size={12} /> : 'Select'}
                </button>
              </div>
            ))}
            {sheets.map(sheet => (
              <div
                key={sheet.id}
                title="Spreadsheet in this folder. Select the folder that holds it; the app links the Sheet automatically."
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--color-zinc-950)',
                  border: '1px dashed var(--color-zinc-800)',
                  fontSize: '0.8rem',
                  color: 'var(--color-zinc-500)',
                  minWidth: 0
                }}
              >
                <FileSpreadsheet size={16} style={{ color: 'var(--color-emerald-600, #059669)', flex: 'none', opacity: 0.8 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sheet.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.68rem', flex: 'none' }}>spreadsheet</span>
              </div>
            ))}
            </>
          )}
        </div>

        {currentParentId !== 'root' && (
          <button
            type="button"
            onClick={onUseCurrentFolder}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '8px 12px', fontWeight: 600, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            Use Current Folder: "{breadcrumbs[breadcrumbs.length - 1].name}"
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--color-zinc-800)', paddingTop: '12px' }}>
          <label className="form-label" style={{ fontSize: '0.78rem' }}>Create New Folder in Here</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem', minWidth: 0 }}
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              placeholder="New Folder name"
            />
            <button
              type="button"
              onClick={onCreateFolder}
              className="btn btn-primary"
              style={{
                width: 'auto',
                padding: '8px 14px',
                fontSize: '0.85rem',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
              disabled={!canCreateFolder}
            >
              <FolderPlus size={14} /> Create
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--color-zinc-800)', paddingTop: '12px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={onClose}
          >
            Back to Form
          </button>
        </div>
      </div>
    </div>
  );
}
