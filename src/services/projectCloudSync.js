import {
  findFileInFolder,
  getFileContent,
  updateFileContent,
  uploadFileToDrive
} from './googleDrive.js';
import { sanitizeProjects } from './appStorage.js';

const PROJECTS_CONFIG_FILE = 'jobscan_config.json';

export function createProjectsConfigBlob(projects) {
  return new Blob([JSON.stringify(sanitizeProjects(projects), null, 2)], { type: 'application/json' });
}

export async function loadProjectsConfigFromDrive(accessToken, localProjects = []) {
  console.log('Searching for cloud projects configuration...');
  const configFile = await findFileInFolder(accessToken, 'root', PROJECTS_CONFIG_FILE);

  if (!configFile) {
    console.log('No cloud projects configuration found. Uploading current local projects...');
    await uploadFileToDrive(
      accessToken,
      'root',
      PROJECTS_CONFIG_FILE,
      'application/json',
      createProjectsConfigBlob(localProjects)
    );
    return null;
  }

  console.log('Cloud projects configuration found. Loading...');
  const cloudProjects = await getFileContent(accessToken, configFile.id);
  if (!Array.isArray(cloudProjects)) return null;

  const safeProjects = sanitizeProjects(cloudProjects);
  if (JSON.stringify(safeProjects) !== JSON.stringify(cloudProjects)) {
    await updateFileContent(accessToken, configFile.id, createProjectsConfigBlob(safeProjects), 'application/json');
  }
  console.log('Projects loaded from Google Drive:', safeProjects);
  return safeProjects;
}

export async function saveProjectsConfigToDrive(accessToken, projects) {
  if (!accessToken) return;

  console.log('Saving projects to Google Drive...');
  const configFile = await findFileInFolder(accessToken, 'root', PROJECTS_CONFIG_FILE);
  const blob = createProjectsConfigBlob(projects);

  if (configFile) {
    await updateFileContent(accessToken, configFile.id, blob, 'application/json');
    console.log('Cloud projects configuration updated.');
    return;
  }

  await uploadFileToDrive(accessToken, 'root', PROJECTS_CONFIG_FILE, 'application/json', blob);
  console.log('Cloud projects configuration created.');
}
