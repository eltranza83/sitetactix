import { createFolder, listFolders, listSpreadsheetsInFolder } from './googleDrive.js';

export async function listProjectFolders(accessToken, parentId = 'root') {
  return await listFolders(accessToken, parentId);
}

export async function createProjectFolder(accessToken, folderName, parentId = null) {
  return await createFolder(accessToken, folderName, parentId);
}

export async function listFolderSpreadsheets(accessToken, parentId = 'root') {
  return await listSpreadsheetsInFolder(accessToken, parentId);
}
