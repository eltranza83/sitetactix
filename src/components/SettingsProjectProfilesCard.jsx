import React from 'react';
import { ChevronDown, ChevronUp, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';

export default function SettingsProjectProfilesCard({
  activeProject,
  isOpen,
  projects,
  onCreateProject,
  onDeleteProject,
  onEditProject,
  onSelectActiveProject,
  onToggleOpen
}) {
  return (
    <div className="settings-card" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 className="settings-title" style={{ marginBottom: '4px' }}>
        <FolderOpen size={18} className="logo-icon" style={{ color: 'var(--color-amber-500)' }} />
        Project Profiles
      </h3>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onCreateProject}
        style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
      >
        <Plus size={16} /> Create New Project
      </button>

      {projects.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-zinc-800)', paddingTop: '12px' }}>
          <div
            onClick={onToggleOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '4px 0'
            }}
          >
            <label className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>
              Manage Project Profiles ({projects.length})
            </label>
            <div style={{ color: 'var(--color-zinc-400)' }}>
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>

          {isOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
              {projects.map(project => {
                const isActive = activeProject && activeProject.id === project.id;
                return (
                  <div
                    key={project.id}
                    onClick={() => onSelectActiveProject(project.id)}
                    className="project-profile-row"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectActiveProject(project.id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: isActive ? 'rgba(197, 160, 89, 0.05)' : 'var(--color-zinc-900)',
                      border: isActive ? '1px solid rgba(197, 160, 89, 0.3)' : '1px solid var(--color-zinc-800)',
                      fontSize: '0.85rem'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '8px' }}>
                      <div style={{
                        fontWeight: 600,
                        color: isActive ? 'var(--color-amber-400)' : 'var(--color-zinc-200)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {project.name} {isActive && <span style={{ fontSize: '0.7rem', color: 'var(--color-emerald-500)', marginLeft: '6px', fontWeight: 'bold' }}>(ACTIVE)</span>}
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: 'var(--color-zinc-500)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        Folder: {project.folderName}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onEditProject(project)}
                        className="nav-item"
                        style={{ width: 'auto', padding: '4px', color: 'var(--color-amber-500)' }}
                        title="Edit Project Profile"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(project)}
                        className="nav-item"
                        style={{ width: 'auto', padding: '4px', color: 'var(--color-rose-500)' }}
                        title="Delete Project Profile"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
