import React, { useState } from 'react';
import SettingsDeleteProjectModal from './SettingsDeleteProjectModal';
import SettingsFolderPickerModal from './SettingsFolderPickerModal';
import SettingsProjectModal from './SettingsProjectModal';
import SettingsAdminPanel from './SettingsAdminPanel';
import SettingsGoogleConnectionCard from './SettingsGoogleConnectionCard';
import SettingsProjectProfilesCard from './SettingsProjectProfilesCard';
import { useSettingsAdmin } from '../hooks/useSettingsAdmin';
import { useSettingsProjects } from '../hooks/useSettingsProjects';

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
          SiteTactix Build <span style={{ color: 'var(--color-amber-400)' }}>v1.3.7 (Build 2026.09.19-champagne-theme)</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-zinc-500)', marginTop: '4px' }}>
          Real-time Cloud Sync • Active Finishes & Municipal Engine
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
