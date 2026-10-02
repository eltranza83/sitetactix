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
 * Escapes special characters in Google Drive query parameters.
 */
export function escapeDriveQueryString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

/**
 * Checks if a given folderId is located under projectFolderId by walking up parent folders.
 */
async function isFolderUnderProject(folderId, projectFolderId, googleToken, fetchImpl = fetch, maxHops = 5) {
  if (!folderId || !projectFolderId) return { isUnder: false, callFailed: false };
  if (folderId === projectFolderId) return { isUnder: true, callFailed: false };
  if (!googleToken) return { isUnder: false, callFailed: true };

  let currentId = folderId;
  const visited = new Set([folderId]);

  for (let hop = 0; hop < maxHops; hop++) {
    try {
      const url = `${GOOGLE_DRIVE_API_BASE}/files/${currentId}?fields=parents`;
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      if (!res.ok) {
        console.warn(`[isFolderUnderProject] Drive HTTP error: ${res.status}`);
        return { isUnder: false, callFailed: true, authExpired: res.status === 401 };
      }
      const data = await res.json();
      const parents = Array.isArray(data.parents) ? data.parents : [];
      if (parents.length === 0) break;
      if (parents.includes(projectFolderId)) return { isUnder: true, callFailed: false };

      const nextParent = parents[0];
      if (visited.has(nextParent) || nextParent === 'root') break;
      visited.add(nextParent);
      currentId = nextParent;
    } catch (err) {
      console.warn('[isFolderUnderProject] Parent walk error:', err.message);
      return { isUnder: false, callFailed: true };
    }
  }

  return { isUnder: false, callFailed: false };
}

/**
 * Queries Google Drive live for folders matching an exact name.
 * Filters results to those located within projectFolderId (walking parents if necessary).
 */
async function searchFoldersByNameLive(folderName, projectFolderId, googleToken, fetchImpl = fetch) {
  if (!googleToken || !folderName) return { matches: [], callFailed: !googleToken };

  try {
    const escapedName = escapeDriveQueryString(folderName);
    const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${escapedName}'`);
    const fields = encodeURIComponent('files(id, name, parents)');
    const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${q}&fields=${fields}`;

    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${googleToken}` }
    });

    if (!res.ok) return { matches: [], callFailed: true, authExpired: res.status === 401 };
    const data = await res.json();
    const rawFiles = Array.isArray(data.files) ? data.files : [];
    if (rawFiles.length === 0) return { matches: [], callFailed: false };

    if (projectFolderId) {
      const verified = [];
      for (const f of rawFiles) {
        if (Array.isArray(f.parents) && f.parents.includes(projectFolderId)) {
          verified.push(f);
        } else {
          const parentCheck = await isFolderUnderProject(f.id, projectFolderId, googleToken, fetchImpl);
          if (parentCheck.callFailed) {
            return { matches: [], callFailed: true, authExpired: parentCheck.authExpired === true };
          }
          if (parentCheck.isUnder) {
            verified.push(f);
          }
        }
      }
      return { matches: verified, callFailed: false };
    }

    return { matches: rawFiles, callFailed: false };
  } catch (err) {
    console.warn('[searchFoldersByNameLive] Error searching folder:', err.message);
    return { matches: [], callFailed: true };
  }
}

/**
 * Crawls the full project Drive tree with a strict timeout (~10s) as fallback.
 */
async function fetchTreeWithTimeout(googleToken, projectFolderId, timeoutMs = 10000, fetchImpl = fetch) {
  if (!googleToken || !projectFolderId) return { tree: null, callFailed: !googleToken, timedOut: false };
  let timerId = null;
  try {
    const { fetchProjectDriveTree } = await import('../../googleDrive.js');
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Drive tree fetch timeout')), timeoutMs);
    });
    const result = await Promise.race([
      fetchProjectDriveTree(googleToken, projectFolderId, fetchImpl),
      timeoutPromise
    ]);
    return { tree: result, callFailed: false, timedOut: false };
  } catch (err) {
    if (err.message === 'Drive tree fetch timeout') {
      return { tree: null, callFailed: false, timedOut: true };
    }
    console.warn('[list_folder_files] fetchProjectDriveTree failed:', err.message);
    return { tree: null, callFailed: true, timedOut: false };
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

/**
 * Reads the receipt details the app stores on a synced Drive file (JSON in the
 * file description, written by invoiceUpload.js). Returns null fields when the
 * file wasn't scanned by the app.
 */
export function readReceiptDetails(description) {
  const empty = { purchaseDate: null, amount: null, vendor: null, item: null };
  if (!description || typeof description !== 'string' || !description.trim().startsWith('{')) return empty;
  try {
    const m = JSON.parse(description);
    const rawAmount = m.amount ?? m.totalCost ?? m.total ?? null;
    const amount = rawAmount === null || rawAmount === '' ? null : Number(String(rawAmount).replace(/[$,]/g, ''));
    return {
      purchaseDate: m.date || m.paymentDate || m.transactionDate || null,
      amount: Number.isFinite(amount) ? amount : null,
      vendor: m.vendor || m.payee || null,
      item: m.description || m.desc || m.item || null
    };
  } catch {
    return empty;
  }
}

function toListedFile(f) {
  const details = readReceiptDetails(f.description);
  const savedToDrive = f.createdTime ? f.createdTime.split('T')[0] : (f.savedToDrive || null);
  return {
    id: f.id || f.driveFileId,
    name: f.name || f.fileName || 'Untitled',
    purchaseDate: details.purchaseDate || f.purchaseDate || f.date || null,
    amount: details.amount ?? f.amount ?? null,
    vendor: details.vendor || f.vendor || null,
    item: details.item || f.item || null,
    savedToDrive,
    size: f.size ? (typeof f.size === 'number' || /^\d+$/.test(String(f.size)) ? `${Math.round(Number(f.size) / 1024)} KB` : f.size) : '',
    webViewLink: f.webViewLink || f.link || null,
    mimeType: f.mimeType || 'application/pdf'
  };
}

/**
 * Files without stored receipt details (e.g. uploaded by hand) take the date and
 * amount from the spreadsheet row that links to the same Drive file.
 */
function fillFromLedger(file, ledgerSource) {
  if (file.purchaseDate || !ledgerSource?.getTransactionByDriveFileId) return file;
  const tx = ledgerSource.getTransactionByDriveFileId(file.id);
  if (!tx) return file;
  return {
    ...file,
    purchaseDate: tx.date || null,
    amount: file.amount ?? (tx.amount || null),
    vendor: file.vendor || tx.vendor || null
  };
}

/**
 * Lists files LIVE from Google Drive API for a given folder id.
 * Falls back to tree-provided files when offline or when API call fails.
 */
async function fetchFolderFilesLive(folderId, fallbackFiles = [], googleToken = null, fetchImpl = fetch) {
  if (googleToken && folderId) {
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent('files(id, name, mimeType, createdTime, size, webViewLink, description)');
      const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=name`;

      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.files)) {
          return data.files.map(toListedFile);
        }
      }
    } catch (err) {
      console.warn('[list_folder_files] Live Drive API fetch error, falling back to tree:', err.message);
    }
  }

  // Fallback to fixture / cached tree files
  return fallbackFiles.map(toListedFile);
}

/**
 * Tool: list_folder_files(folder)
 * Multi-stage folder discovery:
 * 1. Checks cached in-memory tree if available
 * 2. Queries Drive live for folders matching target name (scoped to projectFolderId)
 * 3. Crawls full tree with timeout fallback for speech slips (e.g. "Hindipo")
 * 4. Error reporting:
 *    - timeout -> folder_not_found + hint
 *    - call failed -> drive_unavailable
 *    - Drive answered but no match -> folder_not_found (candidates only if non-empty)
 */
export async function list_folder_files(args = {}, context = {}) {
  const targetFolder = String(args.folder || '').trim();
  let driveTree = context.driveTree || null;
  const googleToken = context.googleToken || null;
  const projectFolderId = context.projectFolderId || null;
  const fetchImpl = context.fetchImpl || fetch;
  const timeoutMs = context.timeoutMs || 10000;

  if (!targetFolder) {
    return {
      ok: false,
      error: 'missing_folder',
      message: 'Folder name is required to list files.'
    };
  }

  const targetNorm = normalizeDriveName(targetFolder);

  // Stage 1: Check existing in-memory cached tree if available
  let allFolders = extractAllFolders(driveTree);
  let matched = allFolders.find(f => normalizeDriveName(f.name) === targetNorm);

  let callActuallyFailed = !googleToken && (!driveTree || allFolders.length === 0);
  let crawlTimedOut = false;
  let authExpired = false;

  // Stage 2: Fast live Drive name search if not matched in tree and token is present
  if (!matched && googleToken) {
    const liveSearch = await searchFoldersByNameLive(targetFolder, projectFolderId, googleToken, fetchImpl);
    if (liveSearch.callFailed) {
      callActuallyFailed = true;
      authExpired = liveSearch.authExpired === true;
    } else {
      const liveMatches = liveSearch.matches;
      if (liveMatches.length === 1) {
        matched = {
          id: liveMatches[0].id,
          name: liveMatches[0].name,
          path: liveMatches[0].name,
          files: []
        };
      } else if (liveMatches.length > 1) {
        // Several matches inside the project -> return them so the model asks
        return {
          ok: false,
          error: 'multiple_folders_found',
          candidates: liveMatches.map(f => f.name),
          message: `Multiple folders matching "${targetFolder}" were found in this project. Please clarify which one you mean.`
        };
      }
    }
  }

  // Stage 3: Full tree crawl fallback if still not matched (e.g. speech slips like "Hindipo", or empty tree)
  if (!matched && googleToken && projectFolderId && !callActuallyFailed) {
    const crawlResult = await fetchTreeWithTimeout(googleToken, projectFolderId, timeoutMs, fetchImpl);
    if (crawlResult.timedOut) {
      crawlTimedOut = true;
    } else if (crawlResult.callFailed) {
      callActuallyFailed = true;
    } else if (crawlResult.tree) {
      driveTree = crawlResult.tree;
      allFolders = extractAllFolders(crawlResult.tree);
      matched = allFolders.find(f => normalizeDriveName(f.name) === targetNorm);
    }
  }

  // If matched (from tree or live search), fetch files live and set session listing
  if (matched) {
    const files = (await fetchFolderFilesLive(matched.id, matched.files, googleToken, fetchImpl))
      .map(f => fillFromLedger(f, context.ledgerSource));
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

  // If not matched:
  const realFolderNames = allFolders.map(f => f.name).filter(Boolean);

  // 1. Crawl timed out -> folder_not_found + timeout hint
  if (crawlTimedOut) {
    const payload = {
      ok: false,
      error: 'folder_not_found',
      message: `I couldn't find a folder named "${targetFolder}" in this project. Your project has a lot of folders. Try the exact folder name.`
    };
    if (realFolderNames.length > 0) {
      payload.candidates = realFolderNames;
    }
    return payload;
  }

  // 2. Google sign-in expired (401) -> tell the user to sign in again
  if (authExpired) {
    return {
      ok: false,
      error: 'needs_auth',
      message: 'Your Google sign-in expired. Please sign in again.'
    };
  }

  // 3. A Drive call actually failed (no token, network error, other non-2xx)
  if (callActuallyFailed) {
    return {
      ok: false,
      error: 'drive_unavailable',
      message: "I couldn't reach Google Drive right now. Please check your connection or Drive login."
    };
  }

  // 4. Drive answered (or tree was inspected) but no match
  const payload = {
    ok: false,
    error: 'folder_not_found',
    message: `I couldn't find a folder named "${targetFolder}" in this project.`
  };
  if (realFolderNames.length > 0) {
    payload.candidates = realFolderNames;
  }
  return payload;
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
