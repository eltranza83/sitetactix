/**
 * Service to interact with the Google Drive and Sheets API client-side using fetch.
 */

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

function escapeDriveQueryString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function assertDriveFolderParent(parentId, action) {
  if (!parentId) {
    throw new Error(`Could not ${action}. No project folder is selected.`);
  }
}

export async function authenticatedDriveFetch(accessToken, url, options = {}) {
  if (!accessToken) {
    const error = new Error('Google Drive session not connected.');
    error.status = 401;
    throw error;
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    const error = new Error('Google Drive session expired.');
    error.status = 401;
    throw error;
  }

  return response;
}

export function getDriveFileMediaUrl(fileId) {
  return `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?alt=media`;
}

export async function fetchDriveFileBlob(accessToken, fileId) {
  const response = await authenticatedDriveFetch(accessToken, getDriveFileMediaUrl(fileId));

  if (response.status === 401) {
    const error = new Error('Google Drive session expired while retrieving file content.');
    error.status = 401;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to retrieve file content: ${errText}`);
  }

  return await response.blob();
}

export async function fetchDriveFileAsObjectUrl(accessToken, fileId) {
  const blob = await fetchDriveFileBlob(accessToken, fileId);
  return URL.createObjectURL(blob);
}

/**
 * Creates a file metadata resource and then uploads the media content.
 * This two-step process is highly reliable client-side and avoids multipart assembly.
 */
export async function uploadFileToDrive(accessToken, folderId, fileName, mimeType, fileBlob, description = null) {
  try {
    const body = {
      name: fileName,
      mimeType: mimeType,
      parents: folderId ? [folderId] : [],
    };
    if (description) {
      body.description = description;
    }

    // Step 1: Create file metadata
    const metadataResponse = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!metadataResponse.ok) {
      const errText = await metadataResponse.text();
      throw new Error(`Failed to create file metadata: ${errText}`);
    }

    const fileMetadata = await metadataResponse.json();
    const fileId = fileMetadata.id;

    // Step 2: Upload media content to the created file ID
    const uploadResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
      body: fileBlob,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`Failed to upload file media: ${errText}`);
    }

    const result = await uploadResponse.json();

    // Step 3: Update description metadata separately to guarantee it persists
    if (description) {
      try {
        const updateResponse = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: description
          }),
        });
        if (!updateResponse.ok) {
          console.warn("Failed to set file description property:", await updateResponse.text());
        }
      } catch (err) {
        console.warn("Error setting description metadata:", err);
      }
    }

    return {
      id: fileId,
      name: fileName,
      webViewLink: `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`,
      ...result
    };
  } catch (error) {
    console.error('Google Drive Upload Error:', error);
    throw error;
  }
}

/**
 * Fetch list of folders inside a specific parent folder in Google Drive (defaults to root).
 */
export async function listFolders(accessToken, parentId = 'root') {
  const query = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=100`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to list folders: ${errText}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Spreadsheets sitting directly inside one folder (shown in the folder picker).
 */
export async function listSpreadsheetsInFolder(accessToken, parentId = 'root') {
  const safeParent = escapeDriveQueryString(parentId);
  const query = `mimeType='application/vnd.google-apps.spreadsheet' and '${safeParent}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=100`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return [];
  const data = await response.json();
  return data.files || [];
}

/**
 * All spreadsheets that could be the project's Sheet, from the first place that has any:
 * the project folder itself, then App Folders, then App Folders / Master Budget Sheet.
 */
export async function listProjectSpreadsheets(accessToken, folderId) {
  if (!accessToken || !folderId) return [];

  async function searchSpreadsheetsInParent(parentId) {
    try {
      const safeParent = escapeDriveQueryString(parentId);
      const query = `'${safeParent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
      const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 401) {
        const error = new Error('Google Drive session expired while searching for the project spreadsheet.');
        error.status = 401;
        throw error;
      }
      if (!res.ok) return [];
      const data = await res.json();
      return data.files || [];
    } catch (err) {
      if (err?.status === 401) throw err;
      return [];
    }
  }

  // 1. Check direct files under folderId
  const directFiles = await searchSpreadsheetsInParent(folderId);
  const nonFinishDirect = directFiles.filter(f => !f.name.toLowerCase().includes('finish'));
  if (nonFinishDirect.length > 0) {
    return nonFinishDirect;
  }

  // 2. Check inside App Folders / Master Budget Sheet or App Folders
  try {
    const safeParent = escapeDriveQueryString(folderId);
    const appQuery = `'${safeParent}' in parents and name='${APP_FOLDERS_CONTAINER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const appRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(appQuery)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (appRes.ok) {
      const appData = await appRes.json();
      const appFolder = appData.files?.[0];
      if (appFolder) {
        // Check inside App Folders
        const appFiles = await searchSpreadsheetsInParent(appFolder.id);
        const nonFinishApp = appFiles.filter(f => !f.name.toLowerCase().includes('finish'));
        if (nonFinishApp.length > 0) {
          return nonFinishApp;
        }

        // Check inside Master Budget Sheet subfolder
        const safeAppParent = escapeDriveQueryString(appFolder.id);
        const budgetFolderQuery = `'${safeAppParent}' in parents and name='Master Budget Sheet' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const bRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(budgetFolderQuery)}&fields=files(id,name)`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (bRes.ok) {
          const bData = await bRes.json();
          const budgetFolder = bData.files?.[0];
          if (budgetFolder) {
            const budgetFiles = await searchSpreadsheetsInParent(budgetFolder.id);
            if (budgetFiles.length > 0) {
              return budgetFiles;
            }
          }
        }
      }
    }
  } catch {}

  return directFiles;
}

/** One spreadsheet for the project folder (the standard-named one if present), or null. */
export async function findSpreadsheetInFolder(accessToken, folderId, preferredName = 'JobScan_Expense_Log') {
  const files = await listProjectSpreadsheets(accessToken, folderId);
  return files.find(f => f.name === preferredName) || files[0] || null;
}

/**
 * Creates a new folder in Google Drive.
 */
export async function createFolder(accessToken, folderName, parentId = null) {
  const body = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    body.parents = [parentId];
  }

  const response = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Failed to create folder: ${errText}`);
    error.status = response.status;
    error.response = response;
    throw error;
  }

  return await response.json();
}

const inFlightFolderPromises = new Map();

export const APP_FOLDERS_CONTAINER_NAME = 'App Folders';
export const VENDORS_STORES_FOLDER_NAME = 'Vendors / Stores';
export const UNKNOWN_VENDORS_FOLDER_NAME = 'Unknown Vendors';

/**
 * Checks if a vendor name string is confident vs generic placeholder/unidentified.
 * Conservative safeguard: rejects generic terms, thermal receipt header noise (CASH, VISA, TOTAL),
 * strings without at least 2 alphabetic characters, and the builder/payer's own company identity (ADEPEC).
 */
export function isConfidentVendor(vendor) {
  if (!vendor || typeof vendor !== 'string') return false;
  const trimmed = vendor.trim();
  if (trimmed.length < 2) return false;

  const lower = trimmed.toLowerCase();

  // Builder / Payer Self-Identity Safeguard: ADEPEC is the customer, NEVER the vendor
  if (/\badepec\b/i.test(lower)) return false;

  const unconfidentKeywords = [
    'unknown', 'unidentified', 'n/a', 'na', 'none', 'null', 'undefined',
    'pending', 'unspecified', 'general', 'receipt', 'invoice', 'statement',
    'cash', 'visa', 'mastercard', 'amex', 'discover', 'debit', 'credit',
    'credit card', 'total', 'subtotal', 'customer copy', 'merchant copy',
    'store', 'vendor', 'contractor', 'payee'
  ];

  if (unconfidentKeywords.includes(lower)) return false;

  // Must contain at least two letter characters (rejects pure barcodes, dates, order numbers, symbol noise)
  const letterCount = (trimmed.match(/[a-zA-Z\u00C0-\u024F]/g) || []).length;
  if (letterCount < 2) return false;

  return true;
}

/**
 * Normalizes vendor name for deterministic matching across formatting differences
 * Eliminates punctuation/whitespace discrepancies without making semantic assumptions:
 * - Inserts a space after periods in initials (e.g. "L.Herrera" -> "L. Herrera")
 * - Strips periods, commas, apostrophes, and quotes
 * - Normalizes hyphens surrounded by whitespace
 * - Collapses repeated whitespace
 * - Leaves '&' vs 'and', corporate words (LLC, Inc, Co), and store numbers untouched
 */
export function toCanonicalVendorKey(vendorName) {
  if (!vendorName || typeof vendorName !== 'string') return '';
  return vendorName
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])\.([a-z0-9])/gi, '$1 $2')
    .replace(/[.,'"`]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lists all active subfolders under a parent folder in Google Drive.
 */
export async function listSubfoldersInFolder(accessToken, parentFolderId) {
  if (!accessToken || !parentFolderId) return [];
  assertDriveFolderParent(parentFolderId, 'list subfolders');
  const safeParentId = escapeDriveQueryString(parentFolderId);
  const query = `mimeType='application/vnd.google-apps.folder' and '${safeParentId}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Failed to list subfolders: ${await res.text()}`);
  const data = await res.json();
  return data.files || [];
}

/**
 * Ensures the top-level 'App Folders' container exists under projectFolderId,
 * and locates or creates the requested operational subfolder inside it.
 * Guarantees zero duplicate operational folders at the Lot root.
 */
export async function ensureAppSubfolder(accessToken, projectFolderId, subfolderName) {
  if (!accessToken || !projectFolderId || !subfolderName) return null;
  assertDriveFolderParent(projectFolderId, `ensure app subfolder ${subfolderName}`);

  // 1. Locate or create 'App Folders' container under the project root
  const appFoldersId = await findOrCreateFolder(accessToken, APP_FOLDERS_CONTAINER_NAME, projectFolderId);
  if (!appFoldersId) return null;

  // 2. Locate or create the operational subfolder inside 'App Folders'
  return await findOrCreateFolder(accessToken, subfolderName, appFoldersId);
}

/**
 * Resolves or creates a vendor subfolder under 'App Folders / Vendors / Stores / [Vendor Name]'
 * Following strict deterministic rules:
 * 1. Exact name match -> use existing folder ID.
 * 2. No exact match + exactly ONE canonical match -> use existing folder ID.
 * 3. Multiple canonical matches (ambiguity) -> returns null (routes to Unknown Vendors, never guesses).
 * 4. No match -> creates the new vendor folder (assuming confident vendor).
 * 5. Never automatically moves, merges, renames, or consolidates existing folders.
 */
export async function ensureVendorFolder(accessToken, projectFolderId, vendorName) {
  if (!accessToken || !projectFolderId || !vendorName) return null;
  if (!isConfidentVendor(vendorName)) return null;

  // 1. Locate or create 'Vendors / Stores' inside 'App Folders'
  const vendorsStoresFolderId = await ensureAppSubfolder(accessToken, projectFolderId, VENDORS_STORES_FOLDER_NAME);
  if (!vendorsStoresFolderId) return null;

  // 2. Sanitize vendor name for Google Drive folder creation
  const cleanVendor = String(vendorName).trim().replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ');
  if (!cleanVendor) return null;

  // 3. Inspect existing subfolders in 'Vendors / Stores'
  const existingFolders = await listSubfoldersInFolder(accessToken, vendorsStoresFolderId);

  const targetCanonical = toCanonicalVendorKey(cleanVendor);
  const canonicalMatches = existingFolders.filter(f => toCanonicalVendorKey(f.name) === targetCanonical);

  // Rule 3: Multiple canonical matches -> AMBIGUOUS DUPLICATE CONFLICT!
  // If multiple existing folders share the canonical key (e.g. "L. Herrera" and "L.Herrera"),
  // refuse to guess. Route to Unknown Vendors so the user can review and designate the canonical folder.
  if (canonicalMatches.length > 1) {
    console.warn(`[Drive Resolver] Duplicate folder conflict for "${vendorName}". Multiple existing folders (${canonicalMatches.map(f => f.name).join(', ')}) share canonical key "${targetCanonical}". Routing to Unknown Vendors.`);
    return null;
  }

  // Rule 1 & 2: Exactly ONE canonical match -> reuse that folder ID
  if (canonicalMatches.length === 1) {
    return canonicalMatches[0].id;
  }

  // Rule 4: Zero matches -> Locate or create the new vendor folder
  return await findOrCreateFolder(accessToken, cleanVendor, vendorsStoresFolderId);
}

/**
 * Ensures the 'Unknown Vendors' exception queue folder exists inside 'App Folders'
 */
export async function ensureUnknownVendorsFolder(accessToken, projectFolderId) {
  return await ensureAppSubfolder(accessToken, projectFolderId, UNKNOWN_VENDORS_FOLDER_NAME);
}

/**
 * Find or create a subfolder inside a parent folder in Google Drive.
 * Deduplicates concurrent requests for the same folder to prevent duplicate folder creation.
 */
export async function findOrCreateFolder(accessToken, folderName, parentId) {
  assertDriveFolderParent(parentId, `find or create folder ${folderName}`);

  const lockKey = `${parentId}_${String(folderName).trim().toLowerCase()}`;

  if (inFlightFolderPromises.has(lockKey)) {
    return await inFlightFolderPromises.get(lockKey);
  }

  const folderPromise = (async () => {
    try {
      const safeFolderName = escapeDriveQueryString(folderName);
      const safeParentId = escapeDriveQueryString(parentId);
      const query = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${safeParentId}' in parents and trashed=false`;
      const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        const error = new Error(`Failed to search for folder ${folderName}: ${errText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }

      const data = await response.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }

      // Create it
      const created = await createFolder(accessToken, folderName, parentId);
      return created.id;
    } finally {
      inFlightFolderPromises.delete(lockKey);
    }
  })();

  inFlightFolderPromises.set(lockKey, folderPromise);
  return await folderPromise;
}

/**
 * Creates and uploads a photo file into a dynamically resolved subfolder hierarchy in Google Drive.
 * Resolves into App Folders / X-Ray Photos / Project_Photos / [Category] / [Phase]
 */
export async function uploadPhotoToPhaseFolder(accessToken, rootFolderId, categoryName, phaseName, fileName, mimeType, fileBlob) {
  // 1. Ensure X-Ray Photos exists inside App Folders
  const xRayFolderId = await ensureAppSubfolder(accessToken, rootFolderId, 'X-Ray Photos');
  
  // 2. Find or create "Project_Photos" inside "X-Ray Photos"
  const photosFolderId = await findOrCreateFolder(accessToken, 'Project_Photos', xRayFolderId);
  
  // 3. Find or create category folder inside "Project_Photos"
  const cleanCategoryName = categoryName.replace(/[^a-zA-Z0-9_ -]/g, '_').trim();
  const categoryFolderId = await findOrCreateFolder(accessToken, cleanCategoryName, photosFolderId);
  
  // 4. Find or create phase folder inside category folder
  const cleanPhaseName = phaseName.replace(/[^a-zA-Z0-9_ -]/g, '_').trim();
  const phaseFolderId = await findOrCreateFolder(accessToken, cleanPhaseName, categoryFolderId);
  
  // 5. Upload file to phase folder
  return await uploadFileToDrive(accessToken, phaseFolderId, fileName, mimeType, fileBlob);
}

/**
 * Finds a folder ID by name and parent ID. Returns null if not found.
 */
export async function findFolder(accessToken, folderName, parentId) {
  assertDriveFolderParent(parentId, `find folder ${folderName}`);

  const safeFolderName = escapeDriveQueryString(folderName);
  const safeParentId = escapeDriveQueryString(parentId);
  const query = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${safeParentId}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to search for folder ${folderName}: ${errText}`);
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Lists all image files inside a specific phase folder in Google Drive.
 */
export async function listPhotosInPhase(accessToken, rootFolderId, categoryName, phaseName) {
  try {
    const photosFolderId = await findFolder(accessToken, 'Project_Photos', rootFolderId);
    if (!photosFolderId) return [];

    const cleanCategoryName = categoryName.replace(/[^a-zA-Z0-9_]/g, '_');
    const categoryFolderId = await findFolder(accessToken, cleanCategoryName, photosFolderId);
    if (!categoryFolderId) return [];

    const cleanPhaseName = phaseName.replace(/[^a-zA-Z0-9_]/g, '_');
    const phaseFolderId = await findFolder(accessToken, cleanPhaseName, categoryFolderId);
    if (!phaseFolderId) return [];

    const query = `'${phaseFolderId}' in parents and mimeType contains 'image/' and trashed=false`;
    const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink,thumbnailLink)&pageSize=100`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to list files in phase folder');
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list photos in phase:', error);
    return [];
  }
}

/**
 * Searches for a specific file by name inside a target Google Drive folder.
 */
export async function findFileInFolder(accessToken, folderId, fileName) {
  const query = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to find file in folder: ${await response.text()}`);
  }
  const result = await response.json();
  return result.files && result.files.length > 0 ? result.files[0] : null;
}

/**
 * Downloads and parses JSON content of a specific Google Drive file.
 */
export async function getFileContent(accessToken, fileId) {
  const blob = await fetchDriveFileBlob(accessToken, fileId);
  const text = await blob.text();
  if (!text || !text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

/**
 * Overwrites the binary content of an existing Google Drive file.
 */
export async function updateFileContent(accessToken, fileId, fileBlob, mimeType) {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType
    },
    body: fileBlob
  });
  if (!response.ok) {
    throw new Error(`Failed to update file content: ${await response.text()}`);
  }
  return await response.json();
}

/**
 * Moves a file from one parent folder to another in Google Drive.
 */
export async function moveFileInDrive(accessToken, fileId, removeParentId, addParentId) {
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?addParents=${addParentId}&removeParents=${removeParentId}&fields=id,parents`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Failed to move file in Drive: ${errText}`);
    error.status = response.status;
    error.response = response;
    throw error;
  }
  return await response.json();
}

/**
 * Tags a file in Google Drive with custom key-value appProperties.
 */
export async function tagDriveFileAppProperties(accessToken, fileId, appProperties) {
  if (!accessToken || !fileId || !appProperties) return false;
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?fields=id,appProperties`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ appProperties })
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
      const err = new Error(`Failed to tag file: HTTP ${response.status}`);
      err.status = response.status;
      err.response = response;
      throw err;
    }
    return false;
  }
  return true;
}

/**
 * Lists all non-trashed files in a Google Drive folder including their description, webViewLink, and appProperties.
 */
export async function listFilesWithDescriptionInFolder(accessToken, folderId) {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,description,webViewLink,appProperties)`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to list files in folder: ${errText}`);
  }
  const result = await response.json();
  return result.files || [];
}
