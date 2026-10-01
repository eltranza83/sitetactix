/**
 * Drive Tools for Jarvis:
 * - list_folder_files: browse files in a project Drive folder live from Drive API
 * - open_file: open an authorized file in the document viewer
 */

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// In-memory session state for Drive folder browsing and authorized file IDs
let activeSessionDriveListing = null; // { folderName, folderId, files: [{ id, name, date, size, webViewLink }] }
const sessionAuthorizedFileIds = new Map(); // fileId -> { id, name, webViewLink, mimeType }

export function getSessionDriveListing() {
  return activeSessionDriveListing;
}

export function setSessionDriveListing(listing) {
  activeSessionDriveListing = listing;
  if (listing && Array.isArray(listing.files)) {
    for (const f of listing.files) {
      if (f.id) {
        sessionAuthorizedFileIds.set(f.id, {
          id: f.id,
          name: f.name,
          folderName: listing.folderName,
          webViewLink: f.webViewLink || null,
          mimeType: f.mimeType || 'application/pdf'
        });
      }
    }
  }
}

export function clearSessionDriveListing() {
  activeSessionDriveListing = null;
  sessionAuthorizedFileIds.clear();
}

export function authorizeFileId(file) {
  if (file && file.id) {
    sessionAuthorizedFileIds.set(file.id, {
      id: file.id,
      name: file.name || 'Document',
      folderName: file.folderName || file.vendor || null,
      webViewLink: file.webViewLink || file.link || null,
      mimeType: file.mimeType || 'application/pdf'
    });
  }
}

export function getAuthorizedFile(fileId) {
  return sessionAuthorizedFileIds.get(fileId) || null;
}

/**
 * Normalizes folder and file names for exact comparison (ignoring case, extra spaces, punctuation).
 */
export function normalizeDriveName(name = '') {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Recursively walks the Drive tree at EVERY level to find all folders.
 */
export function extractAllFolders(tree, parentPath = '') {
  if (!tree) return [];
  const folders = [];

  const subfolders = Array.isArray(tree.subfolders)
    ? tree.subfolders
    : (Array.isArray(tree.children) ? tree.children : []);

  for (const sub of subfolders) {
    if (!sub || typeof sub !== 'object') continue;
    const name = sub.name || sub.folderName || 'Unnamed Folder';
    const path = parentPath ? `${parentPath}/${name}` : name;
    const files = Array.isArray(sub.files)
      ? sub.files
      : (Array.isArray(sub.children) ? sub.children.filter(c => !c.subfolders && !c.files) : []);

    folders.push({
      id: sub.id || sub.folderId || null,
      name,
      path,
      files
    });

    // Recursively walk deeper levels
    folders.push(...extractAllFolders(sub, path));
  }

  // Also check if tree itself is a folder node
  if (tree.name && tree.id && !folders.some(f => f.id === tree.id)) {
    folders.unshift({
      id: tree.id,
      name: tree.name,
      path: tree.name,
      files: Array.isArray(tree.files) ? tree.files : []
    });
  }

  return folders;
}

/**
 * Lists files LIVE from Google Drive API for a given folder id.
 * Falls back to tree-provided files when offline or when API call fails.
 */
async function fetchFolderFilesLive(folderId, fallbackFiles = [], googleToken = null) {
  if (googleToken && folderId) {
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent('files(id, name, mimeType, createdTime, size, webViewLink)');
      const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=name`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.files)) {
          return data.files.map(f => ({
            id: f.id,
            name: f.name,
            date: f.createdTime ? f.createdTime.split('T')[0] : '',
            size: f.size ? `${Math.round(f.size / 1024)} KB` : '',
            webViewLink: f.webViewLink || null,
            mimeType: f.mimeType || 'application/pdf'
          }));
        }
      }
    } catch (err) {
      console.warn('[list_folder_files] Live Drive API fetch error, falling back to tree:', err.message);
    }
  }

  // Fallback to fixture / cached tree files
  return fallbackFiles.map(f => ({
    id: f.id || f.driveFileId,
    name: f.name || f.fileName || 'Untitled',
    date: f.date || f.createdTime?.split('T')[0] || '',
    size: f.size || '',
    webViewLink: f.webViewLink || f.link || null,
    mimeType: f.mimeType || 'application/pdf'
  }));
}

/**
 * Tool: list_folder_files(folder)
 * Matches folder name EXACTLY after normalizing case/punctuation.
 * If no match: returns ok: false with ALL real folder names so model can pick or ask.
 */
export async function list_folder_files(args = {}, context = {}) {
  const targetFolder = String(args.folder || '').trim();
  const driveTree = context.driveTree || null;
  const googleToken = context.googleToken || null;

  if (!targetFolder) {
    return {
      ok: false,
      error: 'missing_folder',
      message: 'Folder name is required to list files.'
    };
  }

  const allFolders = extractAllFolders(driveTree);
  const realFolderNames = allFolders.map(f => f.name);

  // Exact matching after normalizing case and punctuation
  const targetNorm = normalizeDriveName(targetFolder);
  const matched = allFolders.find(f => normalizeDriveName(f.name) === targetNorm);

  if (!matched) {
    return {
      ok: false,
      error: 'folder_not_found',
      candidates: realFolderNames,
      message: `Folder "${targetFolder}" was not found. Real project folders are: ${realFolderNames.join(', ')}.`
    };
  }

  // Fetch files live from Drive API (or tree fallback)
  const files = await fetchFolderFilesLive(matched.id, matched.files, googleToken);

  // Store listing in session so open_file can resolve relative references and validate IDs
  const listingPayload = {
    folderName: matched.name,
    folderId: matched.id,
    files: files.map((f, idx) => ({ ...f, index: idx + 1 }))
  };
  setSessionDriveListing(listingPayload);

  return {
    ok: true,
    folderName: matched.name,
    folderId: matched.id,
    count: files.length,
    files: listingPayload.files
  };
}

/**
 * Tool: open_file(fileId)
 * Opens an authorized file in the existing viewer (DocumentViewerModal).
 * Only accepts file IDs returned by a previous tool call this session.
 */
export async function open_file(args = {}, context = {}) {
  const fileId = String(args.fileId || '').trim();

  if (!fileId) {
    return {
      ok: false,
      error: 'missing_file_id',
      message: 'File ID is required to open a document.'
    };
  }

  const authorized = getAuthorizedFile(fileId);
  if (!authorized) {
    return {
      ok: false,
      error: 'unauthorized_file',
      message: `File ID "${fileId}" is not recognized from the recent folder listing or search results.`
    };
  }

  if (typeof context.onOpenDocument === 'function') {
    try {
      context.onOpenDocument({
        id: authorized.id,
        name: authorized.name,
        fileName: authorized.name,
        webViewLink: authorized.webViewLink,
        mimeType: authorized.mimeType || 'application/pdf'
      });
    } catch (err) {
      return {
        ok: false,
        error: 'viewer_error',
        message: `Failed to open document viewer: ${err.message}`
      };
    }
  }

  const folderInfo = authorized.folderName ? ` from ${authorized.folderName}` : '';
  return {
    ok: true,
    opened: true,
    fileId: authorized.id,
    fileName: authorized.name,
    folderName: authorized.folderName || null,
    message: `Opened "${authorized.name}"${folderInfo} in the viewer.`
  };
}
