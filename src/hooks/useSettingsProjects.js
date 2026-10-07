import { useEffect, useState } from 'react';
import { createProjectFolder, listProjectFolders, listFolderSpreadsheets } from '../services/settingsDrive';
import { listProjectSpreadsheets } from '../services/googleDrive';
import { getDriveErrorMessage, getFolderErrorMessage, getValidationErrorMessage } from '../services/appErrors';
import { toCanonicalProjectId } from '../services/projectIds';
import { saveUserProject, deleteUserProject } from '../services/projectService';
import { clearSheetLinkIfFolderChanged, chooseProjectSpreadsheet, linkSheetToProject } from '../services/projectSheet';

export function useSettingsProjects({
  activeProject,
  googleToken,
  googleUser,
  projects,
  setActiveProject,
  setError,
  setProjects,
  setSelectedFolder,
  setSuccess
}) {
  const [folders, setFolders] = useState([]);
  // Spreadsheets in the folder being browsed (shown greyed out so you can tell you're in the right place)
  const [folderSheets, setFolderSheets] = useState([]);
  // The Sheet the project will be linked to, worked out as soon as a folder is picked
  const [sheetPreview, setSheetPreview] = useState({ status: 'idle' });
  const [tempSelectedSheet, setTempSelectedSheet] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [currentParentId, setCurrentParentId] = useState('root');
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: 'root', name: 'My Drive' }]);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFolderPickerModal, setShowFolderPickerModal] = useState(false);
  const [showProjectsAccordion, setShowProjectsAccordion] = useState(false);
  const [tempSelectedFolder, setTempSelectedFolder] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [editingProject, setEditingProject] = useState(null);

  const fetchFolders = async (parentId = 'root') => {
    setLoadingFolders(true);
    setError(null);
    try {
      const [folderList, sheetList] = await Promise.all([
        listProjectFolders(googleToken, parentId),
        listFolderSpreadsheets(googleToken, parentId).catch(() => [])
      ]);
      setFolders(folderList);
      setFolderSheets(sheetList);
    } catch (err) {
      console.error(err);
      setError(getFolderErrorMessage(err, 'load Google Drive folders'));
    } finally {
      setLoadingFolders(false);
    }
  };

  useEffect(() => {
    if (googleToken && showFolderPickerModal) {
      fetchFolders(currentParentId);
    }
  }, [googleToken, currentParentId, showFolderPickerModal]);

  useEffect(() => {
    if (!showCreateModal || !googleToken || !tempSelectedFolder?.id) {
      setSheetPreview({ status: 'idle' });
      return;
    }
    let stale = false;
    setSheetPreview({ status: 'loading' });
    listProjectSpreadsheets(googleToken, tempSelectedFolder.id)
      .then(candidates => {
        if (stale) return;
        const choice = chooseProjectSpreadsheet(candidates);
        setSheetPreview(choice);
        setTempSelectedSheet(prev => {
          // Keep a project's existing link when it is still in this folder
          if (prev && (choice.candidates || [choice.sheet]).some(c => c?.id === prev.id)) return prev;
          return choice.status === 'linked' ? choice.sheet : null;
        });
      })
      .catch(() => {
        if (!stale) setSheetPreview({ status: 'error' });
      });
    return () => { stale = true; };
  }, [showCreateModal, googleToken, tempSelectedFolder?.id]);

  const openCreateProjectModal = () => {
    setProjectNameInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    setShowCreateModal(true);
  };

  const openEditProjectModal = (project) => {
    setEditingProject(project);
    setProjectNameInput(project.name);
    setTempSelectedFolder({ id: project.folderId, name: project.folderName });
    setTempSelectedSheet(project.spreadsheetId ? { id: project.spreadsheetId, name: project.spreadsheetName } : null);
    setShowCreateModal(true);
  };

  const handleSaveProject = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!projectNameInput.trim()) {
      setError(getValidationErrorMessage('Please enter a Project Name'));
      return;
    }
    if (!tempSelectedFolder) {
      setError(getValidationErrorMessage('Please select a target Google Drive folder first'));
      return;
    }

    if (editingProject) {
      const updatedProjects = projects.map(p => {
        if (p.id === editingProject.id) {
          const { appsScriptUrl: _url, appsScriptSecret: _secret, ...safeProject } = p;
          const base = clearSheetLinkIfFolderChanged(safeProject, tempSelectedFolder.id);
          return {
            ...(tempSelectedSheet ? linkSheetToProject(base, tempSelectedSheet) : base),
            name: projectNameInput.trim(),
            folderId: tempSelectedFolder.id,
            folderName: tempSelectedFolder.name
          };
        }
        return p;
      });
      setProjects(updatedProjects);
      localStorage.setItem('jobscan_projects', JSON.stringify(updatedProjects));

      const updatedProj = updatedProjects.find(p => p.id === editingProject.id);
      if (googleUser?.email) {
        saveUserProject(updatedProj, googleUser);
      }

      if (activeProject && activeProject.id === editingProject.id) {
        setActiveProject(updatedProj);
        localStorage.setItem('jobscan_active_project', JSON.stringify(updatedProj));

        setSelectedFolder({ id: updatedProj.folderId, name: updatedProj.folderName });
        localStorage.setItem('jobscan_folder_id', updatedProj.folderId);
        localStorage.setItem('jobscan_folder_name', updatedProj.folderName);
      }

      setProjectNameInput('');
      setTempSelectedFolder(null);
      setTempSelectedSheet(null);
      setEditingProject(null);
      setShowCreateModal(false);
      setSuccess(`Project "${updatedProj.name}" updated successfully!`);
      setTimeout(() => setSuccess(null), 3000);
      return;
    }

    if (projects.some(p => p.name.toLowerCase() === projectNameInput.trim().toLowerCase())) {
      setError(`A project named "${projectNameInput.trim()}" already exists.`);
      return;
    }

    const canonicalId = toCanonicalProjectId(projectNameInput.trim());
    const baseProj = {
      id: canonicalId,
      canonicalId,
      name: projectNameInput.trim(),
      folderId: tempSelectedFolder.id,
      folderName: tempSelectedFolder.name
    };
    const newProj = tempSelectedSheet ? linkSheetToProject(baseProj, tempSelectedSheet) : baseProj;

    const updatedProjects = [...projects, newProj];
    setProjects(updatedProjects);
    localStorage.setItem('jobscan_projects', JSON.stringify(updatedProjects));

    if (googleUser?.email) {
      saveUserProject(newProj, googleUser);
    }

    setActiveProject(newProj);
    localStorage.setItem('jobscan_active_project', JSON.stringify(newProj));

    setSelectedFolder({ id: newProj.folderId, name: newProj.folderName });
    localStorage.setItem('jobscan_folder_id', newProj.folderId);
    localStorage.setItem('jobscan_folder_name', newProj.folderName);

    setProjectNameInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    setShowCreateModal(false);
    setSuccess(newProj.spreadsheetName
      ? `Project "${newProj.name}" saved and linked to "${newProj.spreadsheetName}"!`
      : `Project "${newProj.name}" saved and set as active!`);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleCancelCreateProject = () => {
    setProjectNameInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    setEditingProject(null);
    setShowCreateModal(false);
    setError(null);
  };

  const confirmDeleteProject = () => {
    if (!projectToDelete) return;
    const projectId = projectToDelete.id;
    const updatedProjects = projects.filter(p => p.id !== projectId);
    setProjects(updatedProjects);
    localStorage.setItem('jobscan_projects', JSON.stringify(updatedProjects));

    if (googleUser?.email) {
      deleteUserProject(projectId, googleUser);
    }

    if (activeProject && activeProject.id === projectId) {
      setActiveProject(null);
      localStorage.setItem('jobscan_active_project', 'null');
      setSelectedFolder(null);
      localStorage.removeItem('jobscan_folder_id');
      localStorage.removeItem('jobscan_folder_name');
    }

    setSuccess(`Project "${projectToDelete.name}" deleted.`);
    setProjectToDelete(null);
    setTimeout(() => setSuccess(null), 2500);
  };

  const handleCreateFolder = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newFolderName.trim()) return;

    setError(null);
    setSuccess(null);
    try {
      await createProjectFolder(
        googleToken,
        newFolderName.trim(),
        currentParentId === 'root' ? null : currentParentId
      );
      setSuccess(`Folder "${newFolderName}" created successfully!`);
      setNewFolderName('');
      await fetchFolders(currentParentId);
    } catch (err) {
      console.error(err);
      setError(getDriveErrorMessage(err, 'create folder'));
    }
  };

  const handleNavigateToCrumb = (crumb, index) => {
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    setCurrentParentId(crumb.id);
  };

  const handleOpenFolder = (folder) => {
    setBreadcrumbs([...breadcrumbs, { id: folder.id, name: folder.name }]);
    setCurrentParentId(folder.id);
  };

  const handleSelectFolderForProject = (folder) => {
    setTempSelectedFolder({ id: folder.id, name: folder.name });
    if (!projectNameInput.trim()) {
      setProjectNameInput(folder.name);
    }
    setShowFolderPickerModal(false);
    setSuccess(`Linked folder: "${folder.name}"`);
    setTimeout(() => setSuccess(null), 2500);
  };

  const handleUseCurrentFolder = () => {
    const currentFolder = breadcrumbs[breadcrumbs.length - 1];
    handleSelectFolderForProject(currentFolder);
  };

  return {
    breadcrumbs,
    currentParentId,
    editingProject,
    folders,
    folderSheets,
    sheetPreview,
    tempSelectedSheet,
    setTempSelectedSheet,
    loadingFolders,
    newFolderName,
    projectNameInput,
    projectToDelete,
    showCreateModal,
    showFolderPickerModal,
    showProjectsAccordion,
    tempSelectedFolder,
    confirmDeleteProject,
    handleCancelCreateProject,
    handleCreateFolder,
    handleNavigateToCrumb,
    handleOpenFolder,
    handleSaveProject,
    handleSelectFolderForProject,
    handleUseCurrentFolder,
    openCreateProjectModal,
    openEditProjectModal,
    setNewFolderName,
    setProjectNameInput,
    setProjectToDelete,
    setShowFolderPickerModal,
    setShowProjectsAccordion
  };
}
