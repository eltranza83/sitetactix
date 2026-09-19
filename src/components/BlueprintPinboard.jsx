import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useBlueprintPinboard } from '../hooks/useBlueprintPinboard';
import BlueprintAddPinModal from './BlueprintAddPinModal';
import BlueprintCanvasView from './BlueprintCanvasView';
import BlueprintFullscreenPhotoModal from './BlueprintFullscreenPhotoModal';
import BlueprintPhaseAlbums from './BlueprintPhaseAlbums';
import BlueprintSetupPrompt from './BlueprintSetupPrompt';
import { useIssues } from '../hooks/useIssues';
import DashboardPunchList from './DashboardPunchList';
import IssueFormModal from './IssueFormModal';
import {
  getCachedDashboardSpreadsheetId,
  loadCachedDashboard,
  loadProjectDashboardFromFolder,
  persistDashboardCache,
  persistDashboardSpreadsheetId
} from '../services/dashboardDrive';
import { createAndShareIssuePacket } from '../services/issuePacketShare';
import { isPlaceholderProjectInfo } from '../services/projectInfoFormatter';



// Subcontractor categories and phases matching EditForm config
export const TRADE_SECTIONS_CONFIG = {
  'Mechanicals_&_Utilities': {
    label: 'Mechanicals & Utilities',
    color: '#F1D7A7',
    phases: ['Plumbing Rough-In', 'Electrical & Lighting', 'HVAC / AC Systems', 'Insulation & Alarms']
  },
  'Framing_&_Lumber': {
    label: 'Framing & Lumber',
    color: '#3b82f6',
    phases: ['Framing Lumber & Truss']
  },
  'Site_Prep_&_Structure': {
    label: 'Site Prep & Structure',
    color: '#10b981',
    phases: ['Foundation & Flatwork', 'Roofing', 'Windows & Exterior Doors']
  },
  'Interior_Finishes': {
    label: 'Interior Finishes',
    color: '#f43f5e',
    phases: ['Drywall & Sheetrock', 'Cabinets & Trim Carpentry', 'Quartz & Countertops', 'Glass Work']
  },
  'Paint_Tile': {
    label: 'Paint & Tile',
    color: '#a855f7',
    phases: ['Tile & Flooring', 'Paint & Finishes']
  },
  'House_Exterior_&_Yard': {
    label: 'House Exterior & Yard',
    color: '#F1D7A7',
    phases: ['Stucco & Masonry', 'Garage Doors', 'Driveway & Sidewalks', 'Cantera Stone Detail', 'Fencing & Gates', 'Landscaping & Irrigation']
  },
  'Project_Overhead_&_Bills': {
    label: 'Project Overhead & Bills',
    color: '#71717a',
    phases: ['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Extra Costs & Misc']
  },
  'Paperwork_&_Permits': {
    label: 'Paperwork & Permits',
    color: '#14b8a6',
    phases: ['Paperwork & Permits']
  },
  'Interior_Hardware': {
    label: 'Interior Hardware',
    color: '#6366f1',
    phases: ['Plumbing Hardware Fixtures', 'Electrical Hardware Fixtures']
  }
};

function BlueprintViewModeToggle({ viewMode, onSetViewMode, activeIssuesCount }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backgroundColor: 'var(--color-zinc-900)',
        padding: '4px',
        borderRadius: '8px',
        border: '1px solid var(--color-zinc-800)',
        overflowX: 'auto'
      }}
    >
      <button
        onClick={() => onSetViewMode('blueprint')}
        style={{
          padding: '6px 10px',
          fontSize: '0.72rem',
          fontWeight: 700,
          borderRadius: '6px',
          border: 'none',
          backgroundColor: viewMode === 'blueprint' ? 'var(--color-amber-500)' : 'transparent',
          color: viewMode === 'blueprint' ? '#000' : 'var(--color-zinc-400)',
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap'
        }}
      >
        Floor Plan View
      </button>
      <button
        onClick={() => onSetViewMode('albums')}
        style={{
          padding: '6px 10px',
          fontSize: '0.72rem',
          fontWeight: 700,
          borderRadius: '6px',
          border: 'none',
          backgroundColor: viewMode === 'albums' ? 'var(--color-amber-500)' : 'transparent',
          color: viewMode === 'albums' ? '#000' : 'var(--color-zinc-400)',
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap'
        }}
      >
        Phase Albums
      </button>
      <button
        onClick={() => onSetViewMode('punch_list')}
        style={{
          padding: '6px 10px',
          fontSize: '0.72rem',
          fontWeight: 700,
          borderRadius: '6px',
          border: 'none',
          backgroundColor: viewMode === 'punch_list' ? 'var(--color-amber-500)' : 'transparent',
          color: viewMode === 'punch_list' ? '#000' : 'var(--color-zinc-400)',
          cursor: 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          whiteSpace: 'nowrap'
        }}
      >
        <span>Punch List</span>
        {activeIssuesCount > 0 && (
          <span style={{
            backgroundColor: viewMode === 'punch_list' ? '#000' : '#ef4444',
            color: viewMode === 'punch_list' ? 'var(--color-amber-500)' : '#fff',
            fontSize: '0.65rem',
            fontWeight: 700,
            borderRadius: '10px',
            padding: '1px 5px',
            lineHeight: 1
          }}>
            {activeIssuesCount}
          </span>
        )}
      </button>
    </div>
  );
}

function BlueprintLoadingState({ message }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: '12px' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: 'var(--color-amber-500)' }} />
      <span style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)' }}>{message}</span>
    </div>
  );
}

export default function BlueprintPinboard({ googleToken, activeProject, selectedFolder }) {
  const [isIssueAddMode, setIsIssueAddMode] = useState(false);
  const [pendingIssueLocation, setPendingIssueLocation] = useState(null);
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [editingIssue, setEditingIssue] = useState(null);
  const [packetProjectInfo, setPacketProjectInfo] = useState(null);

  const pinboard = useBlueprintPinboard({
    activeProject,
    googleToken,
    selectedFolder,
    tradeSectionsConfig: TRADE_SECTIONS_CONFIG
  });

  const issuesState = useIssues({ googleToken, activeProject });

  // Read subcontractor payee directory from cached dashboard data
  const cachedDashboard = useMemo(
    () => loadCachedDashboard(localStorage, activeProject?.id),
    [activeProject?.id]
  );
  const subcontractors = cachedDashboard?.subcontractors || [];
  const cachedProjectInfo = isPlaceholderProjectInfo(cachedDashboard?.projectInfo)
    ? null
    : cachedDashboard?.projectInfo;
  const formProjectInfo = packetProjectInfo || cachedProjectInfo || null;
  const selectedIssue = issuesState.issues.find(issue => issue.id === selectedIssueId && !issue.deletedAt) || null;

  const handleToggleIssueAddMode = () => {
    setIsIssueAddMode(prev => !prev);
    setSelectedIssueId(null);
    if (pinboard.isAddMode) {
      pinboard.handleToggleAddMode();
    }
  };

  const handleToggleBlueprintAddMode = () => {
    setIsIssueAddMode(false);
    setSelectedIssueId(null);
    pinboard.handleToggleAddMode();
  };

  const handleFloorPlanClick = (e) => {
    if (isIssueAddMode) {
      const rect = e.target.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setPendingIssueLocation({ x: parseFloat(x.toFixed(2)), y: parseFloat(y.toFixed(2)) });
      setIsIssueAddMode(false);
      return;
    }

    pinboard.handleCanvasClick(e);
  };

  const handleSaveLocatedIssue = async (data) => {
    await issuesState.addIssue(data);
    setPendingIssueLocation(null);
  };

  const handleSaveIssueEdit = async (data) => {
    if (!editingIssue) return;
    await issuesState.updateIssue(editingIssue.id, data);
    setEditingIssue(null);
  };

  useEffect(() => {
    setPacketProjectInfo(null);
  }, [activeProject?.id, selectedFolder?.id]);

  const loadPacketProjectInfo = async ({ forceRefresh = false } = {}) => {
    if (!forceRefresh && packetProjectInfo && !isPlaceholderProjectInfo(packetProjectInfo)) {
      return packetProjectInfo;
    }

    if (!forceRefresh && cachedProjectInfo) {
      setPacketProjectInfo(cachedProjectInfo);
      return cachedProjectInfo;
    }

    const projectFolderId = selectedFolder?.id || activeProject?.folderId;
    if (!googleToken || !projectFolderId) {
      return null;
    }

    const cachedSpreadsheetId = getCachedDashboardSpreadsheetId(localStorage, activeProject.id);
    const { spreadsheetId, data } = await loadProjectDashboardFromFolder({
      accessToken: googleToken,
      projectFolderId,
      cachedSpreadsheetId: forceRefresh || isPlaceholderProjectInfo(cachedDashboard?.projectInfo)
        ? null
        : cachedSpreadsheetId
    });

    if (spreadsheetId !== cachedSpreadsheetId) {
      persistDashboardSpreadsheetId(localStorage, activeProject.id, spreadsheetId);
    }
    persistDashboardCache(localStorage, activeProject.id, data);
    setPacketProjectInfo(data?.projectInfo || null);

    return data?.projectInfo || null;
  };

  useEffect(() => {
    let cancelled = false;

    const loadFormProjectInfo = async () => {
      if (cachedProjectInfo) {
        setPacketProjectInfo(cachedProjectInfo);
        return;
      }

      if (packetProjectInfo || !googleToken || !(selectedFolder?.id || activeProject?.folderId)) {
        return;
      }

      try {
        const info = await loadPacketProjectInfo({ forceRefresh: true });
        if (!cancelled) {
          setPacketProjectInfo(info);
        }
      } catch (err) {
        console.warn('Failed to load project info for issue form:', err);
      }
    };

    loadFormProjectInfo();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, activeProject?.folderId, selectedFolder?.id, googleToken, cachedProjectInfo, packetProjectInfo]);

  const handleSendIssuePacket = async (issue) => {
    const projectInfo = await loadPacketProjectInfo();

    await createAndShareIssuePacket({
      issue,
      googleToken,
      floorPlanImageSrc: pinboard.imageSrc,
      projectName: activeProject?.name,
      selectedFolderName: selectedFolder?.name,
      projectInfo
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {pinboard.success && <div className="alert-box alert-success">{pinboard.success}</div>}
      {pinboard.error && <div className="alert-box alert-error">{pinboard.error}</div>}

      {!pinboard.loading && (
        <BlueprintViewModeToggle
          viewMode={pinboard.viewMode}
          onSetViewMode={pinboard.setViewMode}
          activeIssuesCount={issuesState.issues.filter(i => !i.deletedAt && i.status !== 'resolved').length}
        />
      )}

      {pinboard.loading ? (
        <BlueprintLoadingState message={pinboard.statusMessages.loadingBlueprint} />
      ) : pinboard.viewMode === 'punch_list' ? (
        <DashboardPunchList
          issuesState={issuesState}
          googleToken={googleToken}
          activeProject={activeProject}
          subcontractors={subcontractors}
          projectInfo={formProjectInfo}
          selectedFolderName={selectedFolder?.name}
          onSendIssuePacket={handleSendIssuePacket}
        />
      ) : pinboard.viewMode === 'albums' ? (
        <BlueprintPhaseAlbums
          activeAlbumPhase={pinboard.activeAlbumPhase}
          albumFileInputRef={pinboard.albumFileInputRef}
          albumPhotos={pinboard.albumPhotos}
          expandedCategory={pinboard.expandedCategory}
          imageSrc={pinboard.imageSrc}
          loadingAlbumPhotos={pinboard.loadingAlbumPhotos}
          onBackToBlueprint={() => pinboard.setViewMode('blueprint')}
          onExpandCategory={pinboard.setExpandedCategory}
          onPhotoUpload={pinboard.handleUploadAlbumPhoto}
          onSelectAlbumPhase={pinboard.setActiveAlbumPhase}
          onSelectFullscreenPhoto={pinboard.setFullscreenAlbumPhoto}
          tradeSectionsConfig={TRADE_SECTIONS_CONFIG}
          uploadingAlbumPhoto={pinboard.uploadingAlbumPhoto}
        />
      ) : !pinboard.imageSrc ? (
        <BlueprintSetupPrompt
          blueprintInputRef={pinboard.blueprintInputRef}
          onUploadBlueprint={pinboard.handleUploadBlueprint}
        />
      ) : (
        <BlueprintCanvasView
          imageContainerRef={pinboard.imageContainerRef}
          imageSrc={pinboard.imageSrc}
          isAddMode={pinboard.isAddMode}
          isIssueAddMode={isIssueAddMode}
          issues={issuesState.issues}
          onCanvasClick={handleFloorPlanClick}
          onDeletePin={pinboard.handleDeletePin}
          onDeleteIssue={issuesState.softDeleteIssue}
          onEditIssue={setEditingIssue}
          onEditPin={pinboard.handleEditPin}
          onOpenPhoto={pinboard.setFullscreenAlbumPhoto}
          onSendIssuePacket={handleSendIssuePacket}
          onResetBlueprint={pinboard.handleResetBlueprint}
          onSelectIssue={(issue) => setSelectedIssueId(issue?.id || null)}
          onSelectPin={pinboard.handleSelectPin}
          onSetZoomScale={pinboard.setZoomScale}
          onToggleIssueAddMode={handleToggleIssueAddMode}
          onToggleAddMode={handleToggleBlueprintAddMode}
          onUpdateIssueStatus={issuesState.updateIssueStatus}
          onMarkIssueFixed={issuesState.markIssueFixed}
          onVerifyIssue={issuesState.verifyIssue}
          onReopenIssue={issuesState.reopenIssue}
          googleToken={googleToken}
          pins={pinboard.pins}
          selectedIssue={selectedIssue}
          selectedPin={pinboard.selectedPin}
          tradeSectionsConfig={TRADE_SECTIONS_CONFIG}
          zoomScale={pinboard.zoomScale}
        />
      )}


      <BlueprintAddPinModal
        isOpen={pinboard.showAddForm}
        formData={pinboard.formData}
        tradeSectionsConfig={TRADE_SECTIONS_CONFIG}
        photoPreviews={pinboard.photoPreviews}
        savingPin={pinboard.savingPin}
        fileInputRef={pinboard.fileInputRef}
        isEditing={Boolean(pinboard.editingPin)}
        onCategoryChange={pinboard.handleCategoryChange}
        onFormDataChange={pinboard.setFormData}
        onPhotoSelect={pinboard.handlePhotoSelect}
        onClearPhoto={pinboard.clearSelectedPhoto}
        onCancel={() => pinboard.setShowAddForm(false)}
        onSave={pinboard.handleSavePin}
      />
      <BlueprintFullscreenPhotoModal
        photo={pinboard.fullscreenAlbumPhoto}
        onClose={() => pinboard.setFullscreenAlbumPhoto(null)}
      />
      {pendingIssueLocation && (
        <IssueFormModal
          issues={issuesState.issues}
          contacts={issuesState.contacts || {}}
          subcontractors={subcontractors}
          initialFloorLocation={pendingIssueLocation}
          projectInfo={formProjectInfo}
          projectName={activeProject?.name}
          selectedFolderName={selectedFolder?.name}
          googleToken={googleToken}
          onSave={handleSaveLocatedIssue}
          onClose={() => setPendingIssueLocation(null)}
        />
      )}
      {editingIssue && (
        <IssueFormModal
          issues={issuesState.issues}
          contacts={issuesState.contacts || {}}
          subcontractors={subcontractors}
          editingIssue={editingIssue}
          projectInfo={formProjectInfo}
          projectName={activeProject?.name}
          selectedFolderName={selectedFolder?.name}
          googleToken={googleToken}
          onSave={handleSaveIssueEdit}
          onClose={() => setEditingIssue(null)}
        />
      )}
    </div>
  );
}
