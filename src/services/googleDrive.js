/**
 * Service to interact with the Google Drive and Sheets API client-side using fetch.
 */

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

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

import * as fflate from 'fflate';

/**
 * Extracts plain text checklist markdown from Microsoft Word (.docx) binary bytes.
 * Unzips word/document.xml in-memory and normalizes headings, checkboxes, and quantities.
 */
export function extractTextFromDocxBytes(bytes) {
  if (!bytes) return null;
  try {
    const uint8 = bytes instanceof Uint8Array ? bytes : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null);
    if (!uint8 || uint8.length < 4) return null;

    // Verify PKZip header [0x50, 0x4B, 0x03, 0x04] or [0x50, 0x4B]
    if (uint8[0] !== 0x50 || uint8[1] !== 0x4b) {
      return null;
    }

    const unzipped = fflate.unzipSync(uint8);
    const docXmlEntry = unzipped['word/document.xml'];
    if (!docXmlEntry) {
      return null;
    }

    const xmlString = fflate.strFromU8(docXmlEntry);
    if (!xmlString) return null;

    const paragraphs = [];
    const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
    let pMatch;

    while ((pMatch = pRegex.exec(xmlString)) !== null) {
      const pContent = pMatch[1];

      // Detect Word 2010 content control checkboxes
      const isW14Checked = /<w14:checked\s+w14:val="(1|true)"/i.test(pContent);
      const isW14Unchecked = /<w14:checked\s+w14:val="(0|false)"/i.test(pContent);

      // Detect Wingdings font checkbox symbols
      const isWingdingsChecked = /<w:sym\s+[^>]*w:char="(F0FE|F053|2611)"/i.test(pContent);
      const isWingdingsUnchecked = /<w:sym\s+[^>]*w:char="(F0A8|F0A9|2610)"/i.test(pContent);

      // Extract all text runs inside paragraph
      const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
      let tMatch;
      let pText = '';
      while ((tMatch = tRegex.exec(pContent)) !== null) {
        pText += tMatch[1];
      }

      // Decode standard XML entities
      pText = pText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

      if (!pText && !isW14Checked && !isW14Unchecked && !isWingdingsChecked && !isWingdingsUnchecked) {
        continue;
      }

      // Check heading style or trade section
      const isHeading = /<w:pStyle\s+w:val="Heading[1-3]"/i.test(pContent) ||
                        /^\d+[.)]\s+[A-Za-z]/.test(pText) ||
                        /^(quartz|electrical|plumbing|hvac|paint|drywall|general)\s+(hardware|fixtures|supplies|materials)/i.test(pText);

      // Normalize checkbox markers
      if (isW14Checked || isWingdingsChecked) {
        pText = pText.replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒\-*•+o\s]+/, '').replace(/^\[[ xX]?\]\s*/, '').trim();
        pText = `- [x] ${pText}`;
      } else if (isW14Unchecked || isWingdingsUnchecked) {
        pText = pText.replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒\-*•+o\s]+/, '').replace(/^\[[ xX]?\]\s*/, '').trim();
        pText = `- [ ] ${pText}`;
      } else if (/[☑☒✓]/.test(pText) || /^\[[xX]\]/.test(pText)) {
        pText = pText.replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒✓\-*•+o\s]+/, '').replace(/^\[[ xX]?\]\s*/, '').trim();
        pText = `- [x] ${pText}`;
      } else if (/[☐]/.test(pText) || /^\[\s*\]/.test(pText)) {
        pText = pText.replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒\-*•+o\s]+/, '').replace(/^\[[ xX]?\]\s*/, '').trim();
        pText = `- [ ] ${pText}`;
      } else if (isHeading && !pText.startsWith('##') && !pText.startsWith('#')) {
        pText = `## ${pText}`;
      }

      if (pText) {
        paragraphs.push(pText);
      }
    }

    const result = paragraphs.join('\n');
    return result || null;
  } catch (err) {
    console.warn('[extractTextFromDocxBytes] Failed to extract docx XML:', err);
    return null;
  }
}

export async function fetchGoogleDocText(accessToken, fileId, options = {}) {
  if (!accessToken || !fileId) {
    throw new Error('Missing accessToken or fileId for Google Doc text export.');
  }

  const fileName = String(options.fileName || options.name || '').toLowerCase();
  const mimeType = String(options.mimeType || '').toLowerCase();
  const isDocx = fileName.endsWith('.docx') || mimeType.includes('wordprocessingml') || mimeType.includes('docx');

  // If known to be a .docx file, download binary media and unpack XML
  if (isDocx) {
    const mediaResponse = await authenticatedDriveFetch(accessToken, getDriveFileMediaUrl(fileId));
    if (!mediaResponse.ok) {
      const errText = await mediaResponse.text();
      throw new Error(`Failed to retrieve document binary media: ${errText}`);
    }
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const extracted = extractTextFromDocxBytes(new Uint8Array(arrayBuffer));
    if (!extracted) {
      throw new Error(`Could not parse valid checklist text from "${options.fileName || 'Purchasing Checklist.docx'}".`);
    }
    return extracted;
  }

  // Otherwise, try native Google Docs export first
  const exportUrl = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/plain`;
  try {
    const response = await authenticatedDriveFetch(accessToken, exportUrl);
    if (response.ok) {
      return await response.text();
    }
  } catch (err) {
    if (err.status === 401) throw err;
  }

  // Fallback to direct media fetch if export was unsupported or returned binary
  const mediaResponse = await authenticatedDriveFetch(accessToken, getDriveFileMediaUrl(fileId));
  if (!mediaResponse.ok) {
    const errText = await mediaResponse.text();
    throw new Error(`Failed to retrieve document text: ${errText}`);
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Check if downloaded media is a PKZip / .docx binary archive
  if (uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4b) {
    const extracted = extractTextFromDocxBytes(uint8);
    if (extracted) return extracted;
  }

  // Fall back to decoding as UTF-8 text string
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(uint8);
}

export async function fetchDriveFileAsObjectUrl(accessToken, fileId) {
  const blob = await fetchDriveFileBlob(accessToken, fileId);
  return URL.createObjectURL(blob);
}

export async function fetchDriveFileBase64(accessToken, fileId) {
  const blob = await fetchDriveFileBlob(accessToken, fileId);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result || '';
      const base64Data = result.includes(',') ? result.split(',')[1] : result;
      resolve({ base64: base64Data, mimeType: blob.type || 'application/pdf' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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

export async function findSpreadsheetInFolder(accessToken, folderId, preferredName = 'JobScan_Expense_Log') {
  if (!accessToken || !folderId) return null;

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
    return nonFinishDirect.find(f => f.name === preferredName) || nonFinishDirect[0];
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
          return nonFinishApp.find(f => f.name === preferredName) || nonFinishApp[0];
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
              return budgetFiles.find(f => f.name === preferredName) || budgetFiles[0];
            }
          }
        }
      }
    }
  } catch {}

  return directFiles[0] || null;
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
    throw new Error(`Failed to create folder: ${errText}`);
  }

  return await response.json();
}

/**
 * Finds the tracking Google Sheet (JobScan_Expense_Log) in the folder, or creates one if it doesn't exist.
 */
export async function findOrCreateTrackingSheet(accessToken, folderId) {
  // Query to find any spreadsheet in the project folder
  const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const searchUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const searchResponse = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!searchResponse.ok) {
    throw new Error('Failed to search for tracking sheet');
  }

  const searchData = await searchResponse.json();
  
  if (searchData.files && searchData.files.length > 0) {
    // Prefer the one named 'JobScan_Expense_Log' if there are multiple, otherwise return the first one
    const preferred = searchData.files.find(f => f.name === 'JobScan_Expense_Log');
    return preferred ? preferred.id : searchData.files[0].id;
  }

  // If not found, create a new Google Sheet
  const createResponse = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'JobScan_Expense_Log',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    }),
  });

  if (!createResponse.ok) {
    throw new Error('Failed to create tracking sheet');
  }

  const newSheet = await createResponse.json();
  const sheetId = newSheet.id;

  // Initialize the sheet with headers
  const headers = [
    'Date Logged',
    'Date of Transaction',
    'Job Description',
    'Vendor / Subcontractor',
    'Cost Category',
    'Amount',
    'Check Number',
    'PDF Link'
  ];

  await appendRowToSheet(accessToken, sheetId, headers);
  return sheetId;
}

/**
 * Appends a row of data to the Google Sheet.
 */
export async function appendRowToSheet(accessToken, sheetId, rowData) {
  const range = 'Sheet1!A1'; // Google Sheets API will find the table end starting from A1
  const url = `${GOOGLE_SHEETS_API_BASE}/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowData],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to append row to spreadsheet: ${errText}`);
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
        throw new Error(`Failed to search for folder ${folderName}: ${errText}`);
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
 * Updates a file's permission on Google Drive to be publicly readable by anyone with the link.
 */
export async function makeFilePubliclyReadable(accessToken, fileId) {
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}/permissions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone'
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to make file publicly readable: ${errText}`);
  }
  return true;
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
    throw new Error(`Failed to move file in Drive: ${errText}`);
  }
  return await response.json();
}

/**
 * Lists all non-trashed files in a Google Drive folder including their description and webViewLink.
 */
export async function listFilesWithDescriptionInFolder(accessToken, folderId) {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,description,webViewLink)`;
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

/**
 * Helper to fetch all child files and subfolders within a specific parent folder,
 * handling Google Drive API pagination (nextPageToken) automatically.
 */
async function fetchFolderChildren(accessToken, parentFolderId) {
  const items = [];
  let pageToken = null;
  const safeParentId = escapeDriveQueryString(parentFolderId);

  do {
    const q = `'${safeParentId}' in parents and trashed=false`;
    let url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,webViewLink)&pageSize=100`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      console.warn(`[GoogleDrive] Failed to fetch items for folder ${parentFolderId}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    if (Array.isArray(data.files)) {
      items.push(...data.files);
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return items;
}

/**
 * Fetches the complete, depth-unlimited folder hierarchy and file manifest
 * for a project's Google Drive root folder using Breadth-First Search (BFS).
 *
 * Guarantees:
 * 1. Discovers every folder and file at ANY nesting depth without arbitrary limits.
 * 2. Uses `visitedFolderIds` Set to prevent loops/duplicate crawling.
 * 3. Builds full breadcrumb paths for every file and folder.
 * 4. Indexes folders by folder ID and builds a flat `allFiles` manifest.
 * 5. Handles API pagination via `nextPageToken`.
 */
export async function fetchProjectDriveTree(accessToken, rootFolderId) {
  if (!accessToken || !rootFolderId) return null;

  try {
    const visitedFolderIds = new Set([rootFolderId]);
    const folderQueue = [{
      folderId: rootFolderId,
      folderName: 'Root',
      folderPath: '',
      depth: 0
    }];

    const directFiles = [];
    const subfolders = [];
    const foldersById = {};
    const allFiles = [];

    // Initialize root folder in index
    foldersById[rootFolderId] = {
      folderId: rootFolderId,
      folderName: 'Root',
      folderPath: '',
      parentFolderId: null,
      subfolderIds: [],
      files: [],
      depth: 0
    };

    while (folderQueue.length > 0) {
      const current = folderQueue.shift();
      const rawChildren = await fetchFolderChildren(accessToken, current.folderId);

      const childFolders = rawChildren.filter((i) => i.mimeType === 'application/vnd.google-apps.folder');
      const childFiles = rawChildren.filter((i) => i.mimeType !== 'application/vnd.google-apps.folder');

      const currentFolderNode = foldersById[current.folderId] || {
        folderId: current.folderId,
        folderName: current.folderName,
        folderPath: current.folderPath,
        parentFolderId: null,
        subfolderIds: [],
        files: [],
        depth: current.depth
      };
      foldersById[current.folderId] = currentFolderNode;

      // 1. Process files in current folder
      const processedFiles = childFiles.map((f) => {
        const fileObj = {
          id: f.id,
          name: f.name,
          link: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
          webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
          mimeType: f.mimeType,
          folderId: current.folderId,
          folderName: current.folderName,
          folderPath: current.folderPath || 'Root'
        };
        allFiles.push(fileObj);
        return fileObj;
      });

      currentFolderNode.files = processedFiles;

      if (current.folderId === rootFolderId) {
        directFiles.push(...processedFiles);
      }

      // 2. Process and enqueue child folders
      for (const folder of childFolders) {
        const childPath = current.folderPath
          ? `${current.folderPath} / ${folder.name}`
          : folder.name;

        currentFolderNode.subfolderIds.push(folder.id);

        if (!foldersById[folder.id]) {
          foldersById[folder.id] = {
            folderId: folder.id,
            folderName: folder.name,
            folderPath: childPath,
            parentFolderId: current.folderId,
            subfolderIds: [],
            files: [],
            depth: current.depth + 1
          };
        }

        if (!visitedFolderIds.has(folder.id)) {
          visitedFolderIds.add(folder.id);
          folderQueue.push({
            folderId: folder.id,
            folderName: folder.name,
            folderPath: childPath,
            depth: current.depth + 1
          });
        }
      }
    }

    // Build the subfolders array for backward compatibility and deep querying
    for (const [fId, node] of Object.entries(foldersById)) {
      if (fId !== rootFolderId) {
        const childFolderNodes = (node.subfolderIds || []).map((id) => foldersById[id]?.folderName).filter(Boolean);
        subfolders.push({
          folderId: node.folderId,
          folderName: node.folderName,
          folderPath: node.folderPath,
          parentFolderId: node.parentFolderId,
          depth: node.depth,
          subfolderNames: childFolderNodes,
          files: node.files,
          fileCount: (node.files || []).length,
          subfolderCount: (node.subfolderIds || []).length,
          webViewLink: `https://drive.google.com/drive/folders/${node.folderId}`
        });
      }
    }

    return {
      rootFolderId,
      directFiles,
      subfolders,
      foldersById,
      allFiles
    };
  } catch (err) {
    console.warn('[GoogleDrive] Error fetching complete recursive drive tree:', err);
    return null;
  }
}

/**
 * Moves a file or folder to the trash in Google Drive.
 */
export async function trashDriveFileOrFolder(accessToken, fileOrFolderId) {
  if (!accessToken || !fileOrFolderId) return false;

  // Permanent Safety Guard: Check if item is a Google Sheet or financial ledger
  try {
    const metaRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${fileOrFolderId}?fields=id,name,mimeType`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      const name = (meta.name || '').toLowerCase();
      const mime = meta.mimeType || '';
      if (
        mime === 'application/vnd.google-apps.spreadsheet' ||
        mime.includes('spreadsheet') ||
        mime.includes('excel') ||
        name.endsWith('.xlsx') ||
        name.endsWith('.csv') ||
        name.includes('expense') ||
        name.includes('payment') ||
        name.includes('budget') ||
        name.includes('ledger')
      ) {
        console.warn(`PROTECTED FILE: Cannot trash or modify spreadsheet "${meta.name}".`);
        throw new Error(`Action blocked: Project spreadsheets and financial sheets ("${meta.name}") are permanently protected in read-only mode.`);
      }
    }
  } catch (checkErr) {
    if (checkErr.message?.includes('Action blocked')) throw checkErr;
  }

  const url = `${GOOGLE_DRIVE_API_BASE}/files/${fileOrFolderId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trashed: true })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to delete Drive item: ${err}`);
  }
  return true;
}

/**
 * Creates/locates "Finish Specs & Buyer Handover" folder and syncs the finish specs into a canonical native Google Sheet.
 * Safeguard: Legacy CSVs are only trashed AFTER native Google Sheet is verified and successfully updated.
 */
export async function syncFinishSpecsToDrive(accessToken, projectFolderId, projectName, specsList = []) {
  if (!accessToken || !projectFolderId) return null;
  try {
    const folderName = 'Finish Specs & Buyer Handover';
    const safeParent = escapeDriveQueryString(projectFolderId);

    // 1. Locate or create "Finish Specs & Buyer Handover" folder
    const folderQuery = `'${safeParent}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name)&pageSize=1`;
    const folderRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const folderData = await folderRes.json();

    let finishFolderId = folderData.files?.[0]?.id;
    if (!finishFolderId) {
      const created = await createFolder(accessToken, folderName, projectFolderId);
      finishFolderId = created?.id;
    }
    if (!finishFolderId) return null;

    // 2. Format table values for Google Sheets API
    const headers = ['Category', 'Room / Location', 'Brand / Supplier', 'Color Name / Code / Model', 'Sheen / Specs', 'Notes', 'Date Added'];
    const rows = specsList.map((s) => {
      const attrStr = s.attributes && typeof s.attributes === 'object' && Object.keys(s.attributes).length > 0
        ? Object.entries(s.attributes).map(([k, v]) => `${k}: ${v}`).join('; ')
        : '';
      const notesCombined = [s.notes, attrStr].filter(Boolean).join(' | ');

      return [
        s.category || 'General',
        s.location || '',
        s.brand || s.supplier || '',
        s.code || s.name || s.title || '',
        s.sheen || s.specs || '',
        notesCombined,
        s.createdAt ? new Date(s.createdAt).toLocaleDateString() : new Date().toLocaleDateString()
      ];
    });
    const tableValues = [headers, ...rows];

    // 3. Search for existing canonical native Google Sheet and legacy CSV files in finishFolderId
    const safeSubParent = escapeDriveQueryString(finishFolderId);
    
    // 3a. Search for native Google Sheets
    const sheetQuery = `'${safeSubParent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const sheetSearchRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(sheetQuery)}&fields=files(id,name,webViewLink)&pageSize=10`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const sheetData = await sheetSearchRes.json();
    const existingNativeSheet = sheetData.files?.[0];

    // 3b. Search for legacy CSV files (to safely migrate after verified write)
    const csvQuery = `'${safeSubParent}' in parents and (mimeType='text/csv' or name contains '.csv') and trashed=false`;
    const csvSearchRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(csvQuery)}&fields=files(id,name)&pageSize=10`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const csvData = await csvSearchRes.json();
    const legacyCsvFiles = csvData.files || [];

    let targetSheetId = existingNativeSheet?.id;
    let targetWebViewLink = existingNativeSheet?.webViewLink;

    // 4. If no native Google Sheet exists, create one via Drive API
    if (!targetSheetId) {
      const canonicalSheetName = `Homeowner Finishes & Specs — ${projectName || 'Project'}`;
      const createRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: canonicalSheetName,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [finishFolderId]
        })
      });

      if (!createRes.ok) {
        throw new Error('Failed to create native Google Sheet');
      }

      const createdSheet = await createRes.json();
      targetSheetId = createdSheet.id;
      targetWebViewLink = `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`;
    }

    // 5. Discover the actual first tab title of the target spreadsheet (handles Sheet1, converted CSV tab names, or renamed tabs)
    let firstSheetTitle = 'Sheet1';
    try {
      const metaRes = await fetch(`${GOOGLE_SHEETS_API_BASE}/${targetSheetId}?fields=sheets.properties(sheetId,title)`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        if (metaData.sheets?.[0]?.properties?.title) {
          firstSheetTitle = metaData.sheets[0].properties.title;
        }
      }
    } catch (e) {
      console.warn('Could not fetch spreadsheet metadata, falling back to Sheet1:', e);
    }

    const safeSheetRange = `'${firstSheetTitle.replace(/'/g, "''")}'!A1`;
    const safeClearRange = `'${firstSheetTitle.replace(/'/g, "''")}'!A1:Z500`;

    // Clear old rows first to prevent orphan entries when records are deleted or modified
    await fetch(`${GOOGLE_SHEETS_API_BASE}/${targetSheetId}/values/${encodeURIComponent(safeClearRange)}:clear`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }).catch(() => {});

    const updateUrl = `${GOOGLE_SHEETS_API_BASE}/${targetSheetId}/values/${encodeURIComponent(safeSheetRange)}?valueInputOption=USER_ENTERED`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: tableValues
      })
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error('Google Sheets API update failed:', errText);
      throw new Error(`Google Sheets API write failed: ${errText}`);
    }

    // 6. Safe Migration Cleanup Safeguard:
    // Only trash legacy CSVs AFTER the native Google Sheet has been successfully verified & written
    if (updateRes.ok && legacyCsvFiles.length > 0) {
      for (const csvFile of legacyCsvFiles) {
        try {
          await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${csvFile.id}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ trashed: true })
          });
        } catch {}
      }
    }

    return {
      ok: true,
      folderId: finishFolderId,
      fileId: targetSheetId,
      webViewLink: targetWebViewLink || `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`
    };
  } catch (err) {
    console.warn('Error syncing finish specs to native Google Sheet:', err);
    return {
      ok: false,
      error: err?.message || 'Google Sheets sync failed. Please check Drive permissions.'
    };
  }
}

/**
 * Checks the Google Sheet synchronization status for the project finishes.
 */
export async function getFinishSheetSyncStatus(accessToken, projectFolderId, firestoreSpecs = []) {
  if (!accessToken || !projectFolderId) {
    return { status: 'idle', webViewLink: null };
  }

  try {
    const folderName = 'Finish Specs & Buyer Handover';
    const safeParent = escapeDriveQueryString(projectFolderId);

    const folderQuery = `'${safeParent}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name)&pageSize=1`;
    const folderRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const folderData = await folderRes.json();

    const finishFolderId = folderData.files?.[0]?.id;
    if (!finishFolderId) {
      return { status: firestoreSpecs.length > 0 ? 'out_of_sync' : 'synced', webViewLink: null };
    }

    const safeSubParent = escapeDriveQueryString(finishFolderId);
    const sheetQuery = `'${safeSubParent}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const sheetSearchRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(sheetQuery)}&fields=files(id,name,webViewLink)&pageSize=1`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const sheetData = await sheetSearchRes.json();
    const sheetFile = sheetData.files?.[0];

    if (!sheetFile) {
      return { status: firestoreSpecs.length > 0 ? 'out_of_sync' : 'synced', webViewLink: null };
    }

    const webViewLink = sheetFile.webViewLink || `https://docs.google.com/spreadsheets/d/${sheetFile.id}/edit`;

    // Fetch spreadsheet row values to verify actual data parity
    try {
      const readUrl = `${GOOGLE_SHEETS_API_BASE}/${sheetFile.id}/values/A1:D500?fields=values`;
      const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (readRes.ok) {
        const valData = await readRes.json();
        const rows = valData.values || [];
        const dataRows = rows.slice(1); // Exclude header row

        // If sheet is completely empty or row count doesn't match Firestore specs count
        if (rows.length === 0 || dataRows.length !== firestoreSpecs.length) {
          return { status: 'out_of_sync', webViewLink, rowCount: dataRows.length };
        }
        return { status: 'synced', webViewLink, rowCount: dataRows.length };
      }
    } catch {}

    return { status: 'synced', webViewLink };
  } catch (err) {
    console.warn('Error checking finish sheet sync status:', err);
    return { status: 'error', error: err?.message || 'Sync check failed', webViewLink: null };
  }
}

/**
 * Uploads/syncs the generated Buyer Handover PDF to the "Finish Specs & Buyer Handover" folder.
 */
export async function uploadBuyerHandoverPdfToDrive(accessToken, finishFolderId, projectName, pdfBlob) {
  if (!accessToken || !finishFolderId || !pdfBlob) return null;
  try {
    const fileName = `Homeowner Handover & Warranty Binder — ${projectName || 'Project'}.pdf`;
    return await uploadFileToDrive(accessToken, finishFolderId, fileName, 'application/pdf', pdfBlob, 'Adepec Homes Homeowner Handover Binder');
  } catch (err) {
    console.warn('Error uploading Buyer Handover PDF to Drive:', err);
    return null;
  }
}



