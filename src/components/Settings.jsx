import React, { useState } from 'react';
import SettingsDeleteProjectModal from './SettingsDeleteProjectModal';
import SettingsFolderPickerModal from './SettingsFolderPickerModal';
import SettingsProjectModal from './SettingsProjectModal';
import SettingsAdminPanel from './SettingsAdminPanel';
import SettingsGoogleConnectionCard from './SettingsGoogleConnectionCard';
import SettingsProjectProfilesCard from './SettingsProjectProfilesCard';
import { useSettingsAdmin } from '../hooks/useSettingsAdmin';
import { useSettingsProjects } from '../hooks/useSettingsProjects';
import { APP_BUILD_LABEL, APP_RELEASE_NAME } from '../config/appConfig';
import { getJarvisEngineMode } from '../services/jarvis/engineMode';

export default function Settings({
  googleClientId: _googleClientId,
  setGoogleClientId: _setGoogleClientId,
  googleToken,
  setGoogleToken: _setGoogleToken,
  selectedFolder: _selectedFolder,
  setSelectedFolder,
  googleUser,
  onSignOut,
  onSignIn,
  projects,
  setProjects,
  activeProject,
  setActiveProject,
  handleSelectActiveProject
}) {
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [jarvisEngine, setJarvisEngine] = useState(() => getJarvisEngineMode());

  const handleSetJarvisEngine = (mode) => {
    setJarvisEngine(mode);
    try {
      localStorage.setItem('jarvis_engine_mode', mode);
    } catch {}
    window.dispatchEvent(new CustomEvent('jarvis-engine-changed', { detail: mode }));
  };

  const admin = useSettingsAdmin({ setError, setSuccess });

  const projectSettings = useSettingsProjects({
    activeProject,
    googleToken,
    googleUser,
    projects,
    setActiveProject,
    setError,
    setProjects,
    setSelectedFolder,
    setSuccess
  });

  return (
    <div className="settings-section">
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '10px' }}>Application Settings</h2>

      {success && <div className="alert-box alert-success">{success}</div>}
      {error && <div className="alert-box alert-error">{error}</div>}

      <SettingsGoogleConnectionCard
        googleToken={googleToken}
        googleUser={googleUser}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />

      {/* Jarvis Engine Selection */}
      <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-zinc-100)' }}>Jarvis Engine</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-400)', marginTop: '2px' }}>
              Choose the AI engine for the floating Field Assistant.
            </p>
          </div>
          <div className="sliding-toggle-container" style={{ margin: 0, padding: '2px', background: 'var(--color-zinc-900)' }}>
            <button
              type="button"
              className={`sliding-toggle-btn ${jarvisEngine === 'classic' ? 'active' : ''}`}
              onClick={() => handleSetJarvisEngine('classic')}
              style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            >
              Classic
            </button>
            <button
              type="button"
              className={`sliding-toggle-btn ${jarvisEngine === 'new' ? 'active' : ''}`}
              onClick={() => handleSetJarvisEngine('new')}
              style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            >
              New
            </button>
          </div>
        </div>
      </div>


      {(googleToken || googleUser) && (
        <SettingsProjectProfilesCard
          activeProject={activeProject}
          isOpen={projectSettings.showProjectsAccordion}
          projects={projects}
          onCreateProject={projectSettings.openCreateProjectModal}
          onDeleteProject={projectSettings.setProjectToDelete}
          onEditProject={projectSettings.openEditProjectModal}
          onSelectActiveProject={handleSelectActiveProject}
          onToggleOpen={() => projectSettings.setShowProjectsAccordion(!projectSettings.showProjectsAccordion)}
        />
      )}

      {admin.isAdminUnlocked && (
        <SettingsAdminPanel
          checkingAdmin={admin.checkingAdmin}
          invites={admin.invites}
          isAdminUnlocked={admin.isAdminUnlocked}
          loadingInvites={admin.loadingInvites}
          showAdminPanel={admin.showAdminPanel}
          onDeleteInvite={admin.handleDeleteInvite}
          onGenerateInvite={admin.handleGenerateInvite}
          onShareInvite={admin.handleShareInvite}
          onToggleAdminPanel={() => admin.setShowAdminPanel(!admin.showAdminPanel)}
        />
      )}

      {/* Build & Version Diagnostic Badge */}
      <div style={{ textAlign: 'center', padding: '16px 8px', marginTop: '12px', borderTop: '1px solid var(--color-zinc-800)' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-zinc-400)' }}>
          SiteTactix Build <span style={{ color: 'var(--color-amber-400)' }}>{APP_BUILD_LABEL}</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-500)', marginTop: '4px' }}>
          {APP_RELEASE_NAME}
        </div>
      </div>

      <SettingsDeleteProjectModal
        project={projectSettings.projectToDelete}
        onCancel={() => projectSettings.setProjectToDelete(null)}
        onConfirm={projectSettings.confirmDeleteProject}
      />

      <SettingsProjectModal
        isOpen={projectSettings.showCreateModal}
        editingProject={projectSettings.editingProject}
        projectName={projectSettings.projectNameInput}
        selectedFolder={projectSettings.tempSelectedFolder}
        onProjectNameChange={projectSettings.setProjectNameInput}
        onOpenFolderPicker={() => projectSettings.setShowFolderPickerModal(true)}
        onCancel={projectSettings.handleCancelCreateProject}
        onSave={projectSettings.handleSaveProject}
      />

      <SettingsFolderPickerModal
        isOpen={projectSettings.showFolderPickerModal}
        folders={projectSettings.folders}
        loadingFolders={projectSettings.loadingFolders}
        breadcrumbs={projectSettings.breadcrumbs}
        currentParentId={projectSettings.currentParentId}
        selectedFolder={projectSettings.tempSelectedFolder}
        newFolderName={projectSettings.newFolderName}
        canCreateFolder={!!projectSettings.newFolderName.trim()}
        onClose={() => projectSettings.setShowFolderPickerModal(false)}
        onNavigateToCrumb={projectSettings.handleNavigateToCrumb}
        onOpenFolder={projectSettings.handleOpenFolder}
        onSelectFolder={projectSettings.handleSelectFolderForProject}
        onUseCurrentFolder={projectSettings.handleUseCurrentFolder}
        onNewFolderNameChange={projectSettings.setNewFolderName}
        onCreateFolder={projectSettings.handleCreateFolder}
      />
    </div>
  );
}
