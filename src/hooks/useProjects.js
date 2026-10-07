import { useEffect, useState, useCallback, useRef } from 'react';
import {
  APP_STORAGE_KEYS,
  loadStoredAppState,
  persistActiveProject,
  persistProjects
} from '../services/appStorage.js';
import {
  fetchUserProjects,
  saveUserProject,
  resolveUserActiveProject
} from '../services/projectService.js';
import {
  loadProjectsConfigFromDrive,
  saveProjectsConfigToDrive
} from '../services/projectCloudSync.js';
import { listProjectSpreadsheets } from '../services/googleDrive.js';
import { chooseProjectSpreadsheet, linkSheetToProject } from '../services/projectSheet.js';

export function useProjects({ googleToken, googleUser, setSuccess } = {}) {
  const [selectedFolder, setSelectedFolder] = useState(() => loadStoredAppState().selectedFolder);
  const [projects, setProjects] = useState(() => loadStoredAppState().projects);
  const [activeProject, setActiveProject] = useState(() => loadStoredAppState().activeProject);
  // Set when a project folder holds more than one spreadsheet and the owner has to tap the right one
  const [sheetChoice, setSheetChoice] = useState(null);
  const linkAttemptRef = useRef('');

  const syncProjectsFromFirestore = useCallback(async (user) => {
    try {
      const cloudProjects = await fetchUserProjects(user);
      if (Array.isArray(cloudProjects) && cloudProjects.length > 0) {
        setProjects(cloudProjects);
        persistProjects(cloudProjects);

        const storedActiveId = localStorage.getItem(APP_STORAGE_KEYS.activeProjectId);
        const resolved = resolveUserActiveProject(cloudProjects, storedActiveId);
        if (resolved) {
          setActiveProject(resolved);
          setSelectedFolder({ id: resolved.folderId, name: resolved.folderName });
          persistActiveProject(resolved);
        }
      }
    } catch (err) {
      console.warn('[useProjects] Cloud sync failed:', err);
    }
  }, []);

  // Sync from Firestore whenever googleUser is present or changes
  useEffect(() => {
    if (googleUser?.email) {
      syncProjectsFromFirestore(googleUser);
    }
  }, [googleUser, syncProjectsFromFirestore]);

  // Secondary Drive sync (legacy fallback)
  useEffect(() => {
    if (googleToken && (!projects || projects.length === 0)) {
      loadProjectsConfigFromDrive(googleToken, projects)
        .then((driveProjects) => {
          if (Array.isArray(driveProjects) && driveProjects.length > 0) {
            setProjects(driveProjects);
            persistProjects(driveProjects);
            if (googleUser?.email) {
              driveProjects.forEach((p) => saveUserProject(p, googleUser));
            }
          }
        })
        .catch(() => {});
    }
  }, [googleToken, googleUser, projects]);

  const updateProjects = (newProjects) => {
    setProjects(newProjects);
    persistProjects(newProjects);
    if (googleUser?.email) {
      newProjects.forEach((p) => saveUserProject(p, googleUser));
    }
    if (googleToken) {
      saveProjectsConfigToDrive(googleToken, newProjects);
    }
  };

  // Saves the project's Sheet link everywhere the project lives (this device, Firestore, Drive config)
  const linkProjectSheet = useCallback((projectId, sheet) => {
    const base = (projects || []).find(p => p.id === projectId)
      || (activeProject?.id === projectId ? activeProject : null);
    if (!base) return;
    const linked = linkSheetToProject(base, sheet);

    const next = (projects || []).some(p => p.id === projectId)
      ? projects.map(p => (p.id === projectId ? linked : p))
      : [...(projects || []), linked];
    setProjects(next);
    persistProjects(next);
    if (googleToken) saveProjectsConfigToDrive(googleToken, next);
    if (googleUser?.email) saveUserProject(linked, googleUser);

    if (activeProject?.id === projectId) {
      const updated = linkSheetToProject(activeProject, sheet);
      setActiveProject(updated);
      persistActiveProject(updated);
    }
  }, [projects, activeProject, googleToken, googleUser]);

  // Always call the newest version (the lookup below finishes after later renders)
  const linkProjectSheetRef = useRef(linkProjectSheet);
  linkProjectSheetRef.current = linkProjectSheet;

  // Link the active project to its Sheet automatically when it has none yet
  useEffect(() => {
    const project = activeProject;
    if (!googleToken || !project?.folderId || project.spreadsheetId) return;
    const attemptKey = `${project.id}:${project.folderId}`;
    if (linkAttemptRef.current === attemptKey) return;
    linkAttemptRef.current = attemptKey;

    // Not cancelled when the screen updates mid-search: the attempt key already stops repeats
    listProjectSpreadsheets(googleToken, project.folderId)
      .then(candidates => {
        const choice = chooseProjectSpreadsheet(candidates);
        if (choice.status === 'linked') {
          linkProjectSheetRef.current(project.id, choice.sheet);
          setSuccess?.(`Linked Google Sheet: "${choice.sheet.name}"`);
          setTimeout(() => setSuccess?.(null), 3500);
        } else if (choice.status === 'choose') {
          setSheetChoice({ projectId: project.id, projectName: project.name, candidates: choice.candidates });
        }
      })
      .catch(err => {
        console.warn('[useProjects] Could not look up the project Sheet:', err);
        linkAttemptRef.current = '';
      });
  }, [activeProject, googleToken, setSuccess]);

  const chooseSheetForProject = (sheet) => {
    if (!sheetChoice || !sheet) return;
    linkProjectSheet(sheetChoice.projectId, sheet);
    setSuccess?.(`Linked Google Sheet: "${sheet.name}"`);
    setTimeout(() => setSuccess?.(null), 3500);
    setSheetChoice(null);
  };

  const selectActiveProject = (projectId) => {
    if (!projectId) {
      setActiveProject(null);
      setSelectedFolder(null);
      persistActiveProject(null);
      return;
    }

    const proj = projects.find(
      (p) => p.id === projectId || p.canonicalId === projectId
    );
    if (proj) {
      setActiveProject(proj);
      setSelectedFolder({ id: proj.folderId, name: proj.folderName });
      persistActiveProject(proj);

      setSuccess?.(`Switched active project to: "${proj.name}"`);
      setTimeout(() => setSuccess?.(null), 2500);
    }
  };

  const resetProjectSelection = () => {
    setSelectedFolder(null);
    setActiveProject(null);
  };

  return {
    selectedFolder,
    setSelectedFolder,
    projects,
    activeProject,
    setActiveProject,
    updateProjects,
    selectActiveProject,
    resetProjectSelection,
    sheetChoice,
    chooseSheetForProject,
    dismissSheetChoice: () => setSheetChoice(null)
  };
}
