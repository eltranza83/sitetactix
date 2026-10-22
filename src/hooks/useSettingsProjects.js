import { useEffect, useRef, useState } from 'react';
import { createFolder, listFolders, listProjectSpreadsheets, listSpreadsheetsInFolder } from '../services/googleDrive';
import { getDriveErrorMessage, getFolderErrorMessage, getValidationErrorMessage } from '../services/appErrors';
import { toCanonicalProjectId } from '../services/projectIds';
import { saveUserProject, deleteUserProject } from '../services/projectService';
import {
  EMPTY_PROJECT_DETAILS,
  buildProjectInfoFromForm,
  clearSheetLinkIfFolderChanged,
  chooseProjectSpreadsheet,
  createProjectSheetFromTemplate,
  linkSheetToProject,
  projectDetailsFromSheet,
  projectInfoChanged
} from '../services/projectSheet';
import { readProjectInfoIfV2, writeProjectInfo } from '../services/sheetV2';
import { TEMPLATE_SHEET_ID } from '../config/appConfig';
import { APP_STORAGE_KEYS, persistActiveProject, persistProjects } from '../services/appStorage';
import {
  buildNotionLotRequest,
  cleanSubdivision,
  createNotionLotPage,
  fetchSubdivisionOptions,
  linkNotionPageToProject,
  matchSubdivision,
  subdivisionProblem,
  updateNotionSubdivision
} from '../services/notionLot';

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
  // Street address, city/state/zip, scope, budget and lot cost (the Sheet's Project Info tab)
  const [projectDetails, setProjectDetails] = useState(EMPTY_PROJECT_DETAILS);
  const detailsTouchedRef = useRef(false);
  // Whether the linked Sheet is the new layout, and its Project Info as last read
  const [sheetInfo, setSheetInfo] = useState({ status: 'idle', values: null });
  // Make a new Sheet from the template for a new project
  const [useTemplate, setUseTemplate] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const templateAvailable = Boolean(TEMPLATE_SHEET_ID);
  // The project whose Notion page is being made right now (its id), so its button can show progress
  const [notionBusyId, setNotionBusyId] = useState(null);
  // The house's subdivision (goes on its Notion page), with the names already used in Notion as suggestions
  const [subdivisionInput, setSubdivisionInput] = useState('');
  const [subdivisionOptions, setSubdivisionOptions] = useState([]);
  // The Notion page is made after the project is saved; by then the project list has moved on
  const latestRef = useRef({ projects, activeProject });
  latestRef.current = { projects, activeProject };

  const fetchFolders = async (parentId = 'root') => {
    setLoadingFolders(true);
    setError(null);
    try {
      const [folderList, sheetList] = await Promise.all([
        listFolders(googleToken, parentId),
        listSpreadsheetsInFolder(googleToken, parentId).catch(() => [])
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

  // Load the subdivision names from Notion each time the form opens (suggestions only; typing a new one is fine)
  useEffect(() => {
    if (!showCreateModal) return;
    let stale = false;
    fetchSubdivisionOptions()
      .then(options => { if (!stale) setSubdivisionOptions(options); })
      .catch(err => console.warn('[useSettingsProjects] Subdivision suggestions unavailable:', err?.message));
    return () => { stale = true; };
  }, [showCreateModal]);

  // A new project gets a Sheet made from the template when its folder has no spreadsheet yet
  useEffect(() => {
    if (!showCreateModal || editingProject) return;
    setUseTemplate(templateAvailable && sheetPreview.status === 'none');
  }, [showCreateModal, editingProject, templateAvailable, sheetPreview.status]);

  // Read Project Info from the chosen Sheet when it is the new layout (fills the form on edit)
  useEffect(() => {
    const sheetId = tempSelectedSheet?.id;
    if (!showCreateModal || !googleToken || !sheetId) {
      setSheetInfo({ status: 'idle', values: null });
      return;
    }
    let stale = false;
    setSheetInfo({ status: 'loading', values: null });
    readProjectInfoIfV2(googleToken, sheetId)
      .then(values => {
        if (stale) return;
        if (!values) {
          setSheetInfo({ status: 'legacy', values: null });
          return;
        }
        setSheetInfo({ status: 'v2', values });
        if (!detailsTouchedRef.current) {
          setProjectDetails(projectDetailsFromSheet(values));
        }
      })
      .catch(() => {
        if (!stale) setSheetInfo({ status: 'error', values: null });
      });
    return () => { stale = true; };
  }, [showCreateModal, googleToken, tempSelectedSheet?.id]);

  const resetProjectDetails = () => {
    setProjectDetails(EMPTY_PROJECT_DETAILS);
    detailsTouchedRef.current = false;
    setSheetInfo({ status: 'idle', values: null });
    setUseTemplate(false);
  };

  const updateProjectDetail = (field, value) => {
    detailsTouchedRef.current = true;
    setProjectDetails(prev => ({ ...prev, [field]: value }));
  };

  const openCreateProjectModal = () => {
    setProjectNameInput('');
    setSubdivisionInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    resetProjectDetails();
    setShowCreateModal(true);
  };

  const openEditProjectModal = (project) => {
    setEditingProject(project);
    setProjectNameInput(project.name);
    setSubdivisionInput(project.subdivision || '');
    setTempSelectedFolder({ id: project.folderId, name: project.folderName });
    setTempSelectedSheet(project.spreadsheetId ? { id: project.spreadsheetId, name: project.spreadsheetName } : null);
    resetProjectDetails();
    setShowCreateModal(true);
  };

  // Writes the form's Project Info to a new-layout Sheet when something changed. Returns an error message or null.
  const saveProjectInfoToSheet = async (sheetId, projectName) => {
    if (!googleToken || !sheetId || sheetInfo.status !== 'v2') return null;
    const info = buildProjectInfoFromForm(projectName, projectDetails);
    if (!projectInfoChanged(sheetInfo.values, info)) return null;
    try {
      await writeProjectInfo(googleToken, sheetId, info);
      return null;
    } catch (err) {
      console.error(err);
      return getDriveErrorMessage(err, "update the Sheet's Project Info");
    }
  };

  // Makes the lot's Notion page from the lot template and remembers its link on the project
  const makeNotionPage = async (project, details = null, { keepError = false } = {}) => {
    if (!project || notionBusyId) return;
    setNotionBusyId(project.id);
    if (!keepError) setError(null);
    try {
      let lotDetails = details;
      if (!lotDetails && googleToken && project.spreadsheetId) {
        lotDetails = await readProjectInfoIfV2(googleToken, project.spreadsheetId).catch(() => null);
      }
      const result = await createNotionLotPage(buildNotionLotRequest(project, lotDetails || {}));

      const { projects: currentProjects, activeProject: currentActive } = latestRef.current;
      const base = currentProjects.find(p => p.id === project.id) || project;
      const linked = linkNotionPageToProject(base, result);
      const nextProjects = currentProjects.map(p => (p.id === project.id ? linked : p));
      setProjects(nextProjects);
      // Saved on this phone and in the account, so the link is still there after the app reloads
      persistProjects(nextProjects);
      if (googleUser?.email) {
        saveUserProject(linked, googleUser).catch(err => console.warn('[makeNotionPage] Could not save the Notion link to the account:', err));
      }
      if (currentActive?.id === project.id) {
        const updatedActive = linkNotionPageToProject(currentActive, result);
        setActiveProject(updatedActive);
        persistActiveProject(updatedActive);
      }

      const finishes = result.finishesCopied ? ` with ${result.finishesCopied} standard finishes` : '';
      setSuccess(result.existing
        ? `"${project.name}" already had a Notion page. It's linked now.`
        : `Notion page made for "${project.name}"${finishes}.`);
    } catch (err) {
      console.error(err);
      setSuccess(null);
      const notionMessage = `The Notion page for "${project.name}" was not made: ${err.message} Tap "Make Notion page" on the project to try again.`;
      setError(prev => (keepError && prev ? `${prev} ${notionMessage}` : notionMessage));
    } finally {
      setNotionBusyId(null);
    }
  };

  const handleSaveProject = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (savingProject) return;
    if (!projectNameInput.trim()) {
      setError(getValidationErrorMessage('Please enter a Project Name'));
      return;
    }
    if (!tempSelectedFolder) {
      setError(getValidationErrorMessage('Please select a target Google Drive folder first'));
      return;
    }
    const badSubdivision = subdivisionProblem(subdivisionInput);
    if (badSubdivision) {
      setError(badSubdivision);
      return;
    }
    const subdivision = matchSubdivision(subdivisionInput, subdivisionOptions);

    if (editingProject) {
      setSavingProject(true);
      const sheetWriteError = await saveProjectInfoToSheet(tempSelectedSheet?.id, projectNameInput.trim());
      // A project that already has its Notion page gets the new subdivision there too
      let notionError = null;
      const subdivisionChanged = cleanSubdivision(editingProject.subdivision) !== subdivision;
      if (subdivisionChanged && editingProject.notionPageId) {
        try {
          await updateNotionSubdivision(editingProject.notionPageId, subdivision);
        } catch (err) {
          console.error(err);
          notionError = err.message;
        }
      }
      setSavingProject(false);
      const updatedProjects = projects.map(p => {
        if (p.id === editingProject.id) {
          const { appsScriptUrl: _url, appsScriptSecret: _secret, ...safeProject } = p;
          const base = clearSheetLinkIfFolderChanged(safeProject, tempSelectedFolder.id);
          return {
            ...(tempSelectedSheet ? linkSheetToProject(base, tempSelectedSheet) : base),
            name: projectNameInput.trim(),
            // Kept as it was if Notion could not be updated, so the app and Notion never disagree
            subdivision: notionError ? (editingProject.subdivision || '') : subdivision,
            folderId: tempSelectedFolder.id,
            folderName: tempSelectedFolder.name
          };
        }
        return p;
      });
      setProjects(updatedProjects);
      persistProjects(updatedProjects);

      const updatedProj = updatedProjects.find(p => p.id === editingProject.id);
      if (googleUser?.email) {
        saveUserProject(updatedProj, googleUser);
      }

      if (activeProject && activeProject.id === editingProject.id) {
        setActiveProject(updatedProj);
        persistActiveProject(updatedProj);
        setSelectedFolder({ id: updatedProj.folderId, name: updatedProj.folderName });
      }

      setProjectNameInput('');
      setSubdivisionInput('');
      setTempSelectedFolder(null);
      setTempSelectedSheet(null);
      setEditingProject(null);
      resetProjectDetails();
      setShowCreateModal(false);
      if (sheetWriteError) {
        setError(`Project "${updatedProj.name}" updated, but the Sheet was not: ${sheetWriteError}`);
      } else if (notionError) {
        setError(`Project "${updatedProj.name}" updated, but its subdivision was not changed (Notion: ${notionError}) Please try again.`);
      } else {
        setSuccess(`Project "${updatedProj.name}" updated successfully!`);
      }
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
      subdivision,
      folderId: tempSelectedFolder.id,
      folderName: tempSelectedFolder.name
    };
    // The project's Sheet: a fresh copy of the template, or the existing Sheet found in the folder
    let projectSheet = tempSelectedSheet;
    let sheetWriteError = null;
    if (useTemplate && templateAvailable) {
      if (!googleToken) {
        setError('Connect Google first so the app can make the project Sheet from the template.');
        return;
      }
      setSavingProject(true);
      try {
        const created = await createProjectSheetFromTemplate({
          accessToken: googleToken,
          templateId: TEMPLATE_SHEET_ID,
          folderId: tempSelectedFolder.id,
          projectName: baseProj.name,
          info: buildProjectInfoFromForm(baseProj.name, projectDetails)
        });
        projectSheet = created.sheet;
        if (!created.infoWritten) {
          sheetWriteError = getDriveErrorMessage(created.infoError, "fill in the Sheet's Project Info");
        }
      } catch (err) {
        console.error(err);
        setSavingProject(false);
        setError(getDriveErrorMessage(err, 'make the project Sheet from the template'));
        return;
      }
      setSavingProject(false);
    } else if (projectSheet) {
      setSavingProject(true);
      sheetWriteError = await saveProjectInfoToSheet(projectSheet.id, baseProj.name);
      setSavingProject(false);
    }
    const newProj = projectSheet ? linkSheetToProject(baseProj, projectSheet) : baseProj;

    const updatedProjects = [...projects, newProj];
    setProjects(updatedProjects);
    persistProjects(updatedProjects);

    if (googleUser?.email) {
      saveUserProject(newProj, googleUser);
    }

    setActiveProject(newProj);
    persistActiveProject(newProj);
    setSelectedFolder({ id: newProj.folderId, name: newProj.folderName });

    const notionDetails = projectDetails;
    setProjectNameInput('');
    setSubdivisionInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    resetProjectDetails();
    setShowCreateModal(false);
    if (sheetWriteError) {
      setError(`Project "${newProj.name}" saved, but the Sheet's Project Info was not filled in: ${sheetWriteError}`);
    } else {
      setSuccess(`Project "${newProj.name}" saved. Making its Notion page...`);
    }
    // Every new house gets its Notion lot page (Sheet link filled in), even when the Sheet step had a problem
    await makeNotionPage(newProj, notionDetails, { keepError: Boolean(sheetWriteError) });
  };

  const handleCancelCreateProject = () => {
    setProjectNameInput('');
    setSubdivisionInput('');
    setTempSelectedFolder(null);
    setTempSelectedSheet(null);
    resetProjectDetails();
    setEditingProject(null);
    setShowCreateModal(false);
    setError(null);
  };

  const confirmDeleteProject = () => {
    if (!projectToDelete) return;
    const projectId = projectToDelete.id;
    const updatedProjects = projects.filter(p => p.id !== projectId);
    setProjects(updatedProjects);
    persistProjects(updatedProjects);

    if (googleUser?.email) {
      deleteUserProject(projectId, googleUser);
    }

    if (activeProject && activeProject.id === projectId) {
      setActiveProject(null);
      persistActiveProject(null);
      setSelectedFolder(null);
      localStorage.removeItem(APP_STORAGE_KEYS.folderId);
      localStorage.removeItem(APP_STORAGE_KEYS.folderName);
    }

    setSuccess(`Project "${projectToDelete.name}" deleted.`);
    setProjectToDelete(null);
  };

  const handleCreateFolder = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newFolderName.trim()) return;

    setError(null);
    setSuccess(null);
    try {
      await createFolder(
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
    projectDetails,
    updateProjectDetail,
    sheetInfo,
    templateAvailable,
    useTemplate,
    setUseTemplate,
    savingProject,
    subdivisionInput,
    setSubdivisionInput,
    subdivisionOptions,
    notionBusyId,
    makeNotionPage,
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
