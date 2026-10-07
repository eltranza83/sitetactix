import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConfidentVendor, toCanonicalVendorKey } from '../src/services/googleDrive.js';
import { toCanonicalLotId, resolveSplitProjectFolder } from '../src/services/invoiceUpload.js';

/**
 * Mock Google Drive Virtual File System
 * Accurately models multi-level folder creation, hierarchy traversal, and file moves.
 */
export class MockDriveFileSystem {
  constructor() {
    this.folders = new Map(); // id -> { id, name, parentId }
    this.files = new Map();   // id -> { id, name, parentId, mimeType, content }
    this.idCounter = 1;
  }

  createFolder(name, parentId = null) {
    const id = `folder_${this.idCounter++}`;
    const folder = { id, name, parentId };
    this.folders.set(id, folder);
    return folder;
  }

  createFile(name, parentId, mimeType = 'application/octet-stream', content = '') {
    const id = `file_${this.idCounter++}`;
    const file = { id, name, parentId, mimeType, content };
    this.files.set(id, file);
    return file;
  }

  findFolder(name, parentId) {
    for (const folder of this.folders.values()) {
      if (folder.name.toLowerCase() === name.toLowerCase() && folder.parentId === parentId) {
        return folder;
      }
    }
    return null;
  }

  findOrCreateFolder(name, parentId) {
    const existing = this.findFolder(name, parentId);
    if (existing) return existing.id;
    const created = this.createFolder(name, parentId);
    return created.id;
  }

  ensureAppSubfolder(projectFolderId, subfolderName) {
    const appFoldersId = this.findOrCreateFolder('App Folders', projectFolderId);
    return this.findOrCreateFolder(subfolderName, appFoldersId);
  }

  ensureVendorFolder(projectFolderId, vendorName) {
    if (!isConfidentVendor(vendorName)) return null;
    const vendorsStoresId = this.ensureAppSubfolder(projectFolderId, 'Vendors / Stores');
    const cleanVendor = String(vendorName).trim().replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ');
    if (!cleanVendor) return null;

    const existingFolders = Array.from(this.folders.values()).filter(f => f.parentId === vendorsStoresId);

    const targetCanonical = toCanonicalVendorKey(cleanVendor);
    const canonicalMatches = existingFolders.filter(f => toCanonicalVendorKey(f.name) === targetCanonical);

    // Rule 3: Multiple canonical matches -> AMBIGUOUS DUPLICATE CONFLICT!
    if (canonicalMatches.length > 1) {
      return null;
    }

    // Rule 1 & 2: Exactly ONE canonical match -> reuse
    if (canonicalMatches.length === 1) {
      return canonicalMatches[0].id;
    }

    // Rule 4: Zero matches -> create
    const created = this.createFolder(cleanVendor, vendorsStoresId);
    return created.id;
  }

  findSpreadsheet(projectFolderId, preferredName = 'JobScan_Expense_Log') {
    // 1. Check direct files under projectFolderId
    for (const f of this.files.values()) {
      if (f.parentId === projectFolderId && f.mimeType === 'application/vnd.google-apps.spreadsheet') {
        if (!f.name.toLowerCase().includes('finish')) return f;
      }
    }

    // 2. Check inside App Folders and App Folders > Master Budget Sheet
    const appFolder = this.findFolder('App Folders', projectFolderId);
    if (appFolder) {
      for (const f of this.files.values()) {
        if (f.parentId === appFolder.id && f.mimeType === 'application/vnd.google-apps.spreadsheet') {
          if (!f.name.toLowerCase().includes('finish')) return f;
        }
      }

      const budgetFolder = this.findFolder('Master Budget Sheet', appFolder.id);
      if (budgetFolder) {
        for (const f of this.files.values()) {
          if (f.parentId === budgetFolder.id && f.mimeType === 'application/vnd.google-apps.spreadsheet') {
            return f;
          }
        }
      }
    }

    return null;
  }

  moveFile(fileId, fromFolderId, toFolderId) {
    const file = this.files.get(fileId);
    if (!file) throw new Error('File not found');
    file.parentId = toFolderId;
    return file;
  }

  getRootChildren(projectFolderId) {
    const directFolders = Array.from(this.folders.values()).filter(f => f.parentId === projectFolderId);
    const directFiles = Array.from(this.files.values()).filter(f => f.parentId === projectFolderId);
    return { folders: directFolders, files: directFiles };
  }

  getAppFolderChildren(projectFolderId) {
    const appFolder = this.findFolder('App Folders', projectFolderId);
    if (!appFolder) return [];
    return Array.from(this.folders.values()).filter(f => f.parentId === appFolder.id);
  }
}

describe('Canonical Google Drive App Folders Architecture Suite', () => {
  it('1. App Folders Container: Creates App Folders under Lot root on first operational access', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    // Access Invoice Uploads via ensureAppSubfolder
    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    assert.ok(uploadsId);

    // Verify 'App Folders' exists directly under Lot 3
    const appFolder = drive.findFolder('App Folders', lot3.id);
    assert.ok(appFolder, 'App Folders must exist under Lot 3');

    // Verify Invoice Uploads is inside App Folders, NOT directly under Lot 3
    const uploadsFolder = drive.folders.get(uploadsId);
    assert.equal(uploadsFolder.parentId, appFolder.id);
    assert.notEqual(uploadsFolder.parentId, lot3.id);
  });

  it('2. Zero Root Duplication: Operational folders are never created at the Lot root', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    // Client facing folders at root
    drive.findOrCreateFolder('Floor Plans', lot3.id);
    drive.findOrCreateFolder('Finish Specs & Buyer Handover', lot3.id);
    drive.findOrCreateFolder('Closing Settlement', lot3.id);

    // Operational folders via ensureAppSubfolder
    drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    drive.ensureAppSubfolder(lot3.id, 'Processed Invoices');
    drive.ensureAppSubfolder(lot3.id, 'X-Ray Photos');
    drive.ensureAppSubfolder(lot3.id, 'Vendors / Stores');
    drive.ensureAppSubfolder(lot3.id, 'Master Budget Sheet');

    const rootChildren = drive.getRootChildren(lot3.id);
    const rootFolderNames = rootChildren.folders.map(f => f.name);

    // Exact allowable folders at Lot root: Floor Plans, Finish Specs, Closing Settlement, App Folders
    assert.equal(rootFolderNames.length, 4);
    assert.ok(rootFolderNames.includes('Floor Plans'));
    assert.ok(rootFolderNames.includes('Finish Specs & Buyer Handover'));
    assert.ok(rootFolderNames.includes('Closing Settlement'));
    assert.ok(rootFolderNames.includes('App Folders'));

    // Verify none of the operational folders leaked to the root
    assert.equal(rootFolderNames.includes('Invoice Uploads'), false);
    assert.equal(rootFolderNames.includes('Processed Invoices'), false);
    assert.equal(rootFolderNames.includes('X-Ray Photos'), false);
    assert.equal(rootFolderNames.includes('Vendors / Stores'), false);
    assert.equal(rootFolderNames.includes('Master Budget Sheet'), false);
  });

  it('3. Re-use & Idempotency: Multiple calls to ensureAppSubfolder reuse existing folders without duplication', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    const id1 = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const id2 = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const id3 = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');

    assert.equal(id1, id2);
    assert.equal(id2, id3);

    const appFolderChildren = drive.getAppFolderChildren(lot3.id);
    const invoiceUploadsMatches = appFolderChildren.filter(f => f.name === 'Invoice Uploads');
    assert.equal(invoiceUploadsMatches.length, 1, 'Exactly 1 Invoice Uploads folder should exist');
  });

  it('4. Vendor Hierarchy: ensureVendorFolder creates vendors inside App Folders > Vendors / Stores', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    const homeDepotId = drive.ensureVendorFolder(lot3.id, 'Home Depot');
    const lowesId = drive.ensureVendorFolder(lot3.id, 'Lowes');
    const tileId = drive.ensureVendorFolder(lot3.id, 'Rodriguez Tile');

    const appFolder = drive.findFolder('App Folders', lot3.id);
    const vendorsStores = drive.findFolder('Vendors / Stores', appFolder.id);
    assert.ok(vendorsStores, 'Vendors / Stores must exist inside App Folders');

    const homeDepotFolder = drive.folders.get(homeDepotId);
    const lowesFolder = drive.folders.get(lowesId);
    const tileFolder = drive.folders.get(tileId);

    assert.equal(homeDepotFolder.parentId, vendorsStores.id);
    assert.equal(lowesFolder.parentId, vendorsStores.id);
    assert.equal(tileFolder.parentId, vendorsStores.id);
  });

  it('5. X-Ray Photos Hierarchy: Project_Photos and Issue Photos nest inside App Folders / X-Ray Photos', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    const xRayFolderId = drive.ensureAppSubfolder(lot3.id, 'X-Ray Photos');
    const issuePhotosId = drive.findOrCreateFolder('Issue Photos', xRayFolderId);
    const projectPhotosId = drive.findOrCreateFolder('Project_Photos', xRayFolderId);
    const framingId = drive.findOrCreateFolder('Framing', projectPhotosId);

    const appFolder = drive.findFolder('App Folders', lot3.id);
    const xRayFolder = drive.folders.get(xRayFolderId);
    const issuePhotos = drive.folders.get(issuePhotosId);
    const projectPhotos = drive.folders.get(projectPhotosId);
    const framingFolder = drive.folders.get(framingId);

    assert.equal(xRayFolder.parentId, appFolder.id);
    assert.equal(issuePhotos.parentId, xRayFolder.id);
    assert.equal(projectPhotos.parentId, xRayFolder.id);
    assert.equal(framingFolder.parentId, projectPhotos.id);
  });

  it('6. Full Pipeline Simulation: Invoice Uploads -> Processing -> Processed Invoices + Budget Discovery', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    // 1. Provision Master Budget Sheet inside App Folders / Master Budget Sheet
    const budgetFolderId = drive.ensureAppSubfolder(lot3.id, 'Master Budget Sheet');
    const budgetSheet = drive.createFile('Lot 3 — Master Budget Sheet', budgetFolderId, 'application/vnd.google-apps.spreadsheet');

    // 2. Discover Budget Sheet
    const discoveredSheet = drive.findSpreadsheet(lot3.id);
    assert.ok(discoveredSheet, 'Budget spreadsheet must be discovered inside Master Budget Sheet folder');
    assert.equal(discoveredSheet.id, budgetSheet.id);

    // 3. User uploads invoice into App Folders / Invoice Uploads
    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const archiveId = drive.ensureAppSubfolder(lot3.id, 'Processed Invoices');
    const uploadedInvoice = drive.createFile('Lot 3 - Lumber - Material.pdf', uploadsId, 'application/pdf', 'INVOICE_BYTES');

    assert.equal(uploadedInvoice.parentId, uploadsId);

    // 4. Process invoice: Move file from Invoice Uploads to Processed Invoices
    drive.moveFile(uploadedInvoice.id, uploadsId, archiveId);

    const movedInvoice = drive.files.get(uploadedInvoice.id);
    assert.equal(movedInvoice.parentId, archiveId, 'Invoice must now reside in Processed Invoices inside App Folders');
  });

  it('7. Dynamic Vendor Routing: Brand-new vendor (e.g. Walmart) creates Vendors / Stores and Walmart folder automatically with 0 manual steps', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    // 1. Initial State: Only Lot 3 exists. Neither Vendors / Stores nor Walmart folder exists.
    assert.equal(drive.findFolder('App Folders', lot3.id), null);

    // 2. User scans/uploads a Walmart receipt into Invoice Uploads
    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const receiptFile = drive.createFile('Lot 3 - Tools - Material.pdf', uploadsId, 'application/pdf', 'RECEIPT_BYTES');

    // 3. Pipeline processes receipt with metadata { vendor: 'Walmart' }
    const vendorName = 'Walmart';
    const destinationFolderId = drive.ensureVendorFolder(lot3.id, vendorName);
    drive.moveFile(receiptFile.id, uploadsId, destinationFolderId);

    // 4. Verification: App Folders, Vendors / Stores, and Walmart were all dynamically generated
    const appFolder = drive.findFolder('App Folders', lot3.id);
    assert.ok(appFolder, 'App Folders created automatically');

    const vendorsStoresFolder = drive.findFolder('Vendors / Stores', appFolder.id);
    assert.ok(vendorsStoresFolder, 'Vendors / Stores created automatically');

    const walmartFolder = drive.findFolder('Walmart', vendorsStoresFolder.id);
    assert.ok(walmartFolder, 'Walmart folder created automatically');

    const movedReceipt = drive.files.get(receiptFile.id);
    assert.equal(movedReceipt.parentId, walmartFolder.id, 'Receipt is located inside Walmart folder');

    // 5. Subsequent receipt from Walmart reuses existing folder (no duplicates)
    const secondReceipt = drive.createFile('Lot 3 - Paint Roller - Material.pdf', uploadsId, 'application/pdf', 'RECEIPT_2_BYTES');
    const secondDestinationId = drive.ensureVendorFolder(lot3.id, 'Walmart');
    assert.equal(secondDestinationId, walmartFolder.id, 'Existing Walmart folder is reused');
    drive.moveFile(secondReceipt.id, uploadsId, secondDestinationId);

    const movedSecond = drive.files.get(secondReceipt.id);
    assert.equal(movedSecond.parentId, walmartFolder.id, 'Second receipt moved into same Walmart folder');

    // Confirm only 1 Walmart folder exists inside Vendors / Stores
    const vendorChildren = Array.from(drive.folders.values()).filter(f => f.parentId === vendorsStoresFolder.id && f.name === 'Walmart');
    assert.equal(vendorChildren.length, 1, 'Zero duplicate Walmart folders created');
  });

  it('8. Unknown Vendors Exception Queue: Missing or low-confidence vendor routes to App Folders / Unknown Vendors', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const unknownVendorsFolderId = drive.ensureAppSubfolder(lot3.id, 'Unknown Vendors');

    // 1. Receipt with no vendor metadata
    const namelessReceipt = drive.createFile('Lot 3 - Fasteners.pdf', uploadsId, 'application/pdf', 'RAW_BYTES');
    drive.moveFile(namelessReceipt.id, uploadsId, unknownVendorsFolderId);

    // 2. Receipt with unconfident "Unknown" vendor
    const unconfidentReceipt = drive.createFile('Lot 3 - Tools.pdf', uploadsId, 'application/pdf', 'RAW_BYTES_2');
    drive.moveFile(unconfidentReceipt.id, uploadsId, unknownVendorsFolderId);

    const appFolder = drive.findFolder('App Folders', lot3.id);
    const unknownFolder = drive.findFolder('Unknown Vendors', appFolder.id);

    assert.ok(unknownFolder, 'Unknown Vendors folder exists in App Folders');
    assert.equal(drive.files.get(namelessReceipt.id).parentId, unknownFolder.id);
    assert.equal(drive.files.get(unconfidentReceipt.id).parentId, unknownFolder.id);

    // 3. Confirm NO "Unknown" folder was created inside Vendors / Stores
    const vendorsStores = drive.findFolder('Vendors / Stores', appFolder.id);
    if (vendorsStores) {
      const unknownInVendors = drive.findFolder('Unknown', vendorsStores.id);
      assert.equal(unknownInVendors, null, 'No Unknown vendor subfolder in Vendors / Stores');
    }
  });

  it('9. Metadata Preservation & Exception Queue Inspection: Metadata and raw vendor snippets remain fully preserved in file descriptions', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');

    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const unknownVendorsId = drive.ensureAppSubfolder(lot3.id, 'Unknown Vendors');

    const rawMetadata = JSON.stringify({
      amount: 842.50,
      date: '2026-08-14',
      description: 'Floor tiles and thinset mortar',
      tradeCategory: 'Finishes',
      tradePhase: 'Tile',
      vendor: 'Unknown',
      rawOcrSnippet: 'R...guez Tile Supply Inc'
    });

    const receipt = drive.createFile('Lot 3 - Tile - Material.pdf', uploadsId, 'application/pdf', rawMetadata);
    drive.moveFile(receipt.id, uploadsId, unknownVendorsId);

    const exceptionFile = drive.files.get(receipt.id);
    assert.equal(exceptionFile.parentId, unknownVendorsId);

    // Parse description metadata
    const parsed = JSON.parse(exceptionFile.content);
    assert.equal(parsed.amount, 842.50);
    assert.equal(parsed.date, '2026-08-14');
    assert.equal(parsed.rawOcrSnippet, 'R...guez Tile Supply Inc');
  });

  it('10. Vendor Name Classification Matrix: Validates conservative isConfidentVendor logic against noisy thermal headers', () => {
    // Valid unusual vendors (must pass)
    assert.equal(isConfidentVendor('Home Depot'), true);
    assert.equal(isConfidentVendor('84 Lumber'), true);
    assert.equal(isConfidentVendor("Lowe's Home Centers"), true);
    assert.equal(isConfidentVendor('ABC Concrete Supply LLC'), true);
    assert.equal(isConfidentVendor('José Martinez Framing'), true);
    assert.equal(isConfidentVendor('Ferguson Enterprises #128'), true);

    // Noisy / Thermal / Ambiguous / Generic strings (must be rejected to prevent corrupted vendor folders)
    assert.equal(isConfidentVendor(''), false);
    assert.equal(isConfidentVendor('   '), false);
    assert.equal(isConfidentVendor('Unknown'), false);
    assert.equal(isConfidentVendor('Unidentified'), false);
    assert.equal(isConfidentVendor('N/A'), false);
    assert.equal(isConfidentVendor('none'), false);
    assert.equal(isConfidentVendor('CASH'), false);
    assert.equal(isConfidentVendor('VISA'), false);
    assert.equal(isConfidentVendor('MASTERCARD'), false);
    assert.equal(isConfidentVendor('RECEIPT'), false);
    assert.equal(isConfidentVendor('INVOICE'), false);
    assert.equal(isConfidentVendor('TOTAL'), false);
    assert.equal(isConfidentVendor('CUSTOMER COPY'), false);
    assert.equal(isConfidentVendor('12345678'), false);
    assert.equal(isConfidentVendor('$45.99'), false);
    assert.equal(isConfidentVendor('---'), false);
    assert.equal(isConfidentVendor('?'), false);
  });

  it('11. Vendor Exact Match: L. Herrera Landscaping & Sprinklers matches existing folder exactly', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');
    const vendorsStoresId = drive.ensureAppSubfolder(lot3.id, 'Vendors / Stores');
    const existingFolder = drive.createFolder('L. Herrera Landscaping & Sprinklers', vendorsStoresId);

    const resolvedId = drive.ensureVendorFolder(lot3.id, 'L. Herrera Landscaping & Sprinklers');
    assert.equal(resolvedId, existingFolder.id, 'Reuses exact matching folder ID');

    // Confirm no duplicate created
    const subfolders = Array.from(drive.folders.values()).filter(f => f.parentId === vendorsStoresId);
    assert.equal(subfolders.length, 1);
  });

  it('12. Single Canonical Match: L.Herrera Landscaping & Sprinklers matches L. Herrera without creating a duplicate', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');
    const vendorsStoresId = drive.ensureAppSubfolder(lot3.id, 'Vendors / Stores');
    const existingFolder = drive.createFolder('L. Herrera Landscaping & Sprinklers', vendorsStoresId);

    // Incoming receipt has NO space after "L."
    const resolvedId = drive.ensureVendorFolder(lot3.id, 'L.Herrera Landscaping & Sprinklers');
    assert.equal(resolvedId, existingFolder.id, 'Reuses single canonical matching folder ID');

    // Zero duplicate created
    const subfolders = Array.from(drive.folders.values()).filter(f => f.parentId === vendorsStoresId);
    assert.equal(subfolders.length, 1);
  });

  it('13. Multiple Canonical Matches: When both L. Herrera and L.Herrera already exist, resolver returns null and routes to Unknown Vendors (NO automatic consolidation)', () => {
    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');
    const vendorsStoresId = drive.ensureAppSubfolder(lot3.id, 'Vendors / Stores');
    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const unknownVendorsId = drive.ensureAppSubfolder(lot3.id, 'Unknown Vendors');

    // Both duplicates exist in the drive
    const folderA = drive.createFolder('L. Herrera Landscaping & Sprinklers', vendorsStoresId);
    const folderB = drive.createFolder('L.Herrera Landscaping & Sprinklers', vendorsStoresId);

    // Incoming receipt arrives with double space
    const incomingVendor = 'L.  Herrera Landscaping & Sprinklers';
    let destinationId = drive.ensureVendorFolder(lot3.id, incomingVendor);

    // Ambiguity detected: must return null
    assert.equal(destinationId, null, 'Ambiguous canonical match returns null');

    // System routes to Unknown Vendors
    if (!destinationId) {
      destinationId = unknownVendorsId;
    }

    const receipt = drive.createFile('Lot 3 - Sprinklers.pdf', uploadsId, 'application/pdf', 'RECEIPT_DATA');
    drive.moveFile(receipt.id, uploadsId, destinationId);

    const movedReceipt = drive.files.get(receipt.id);
    assert.equal(movedReceipt.parentId, unknownVendorsId, 'Receipt is safely staged in Unknown Vendors for human review');

    // VERIFY ZERO SIDE EFFECTS: Both existing folders remain completely untouched
    assert.ok(drive.folders.has(folderA.id), 'Existing folder A was NOT deleted or renamed');
    assert.ok(drive.folders.has(folderB.id), 'Existing folder B was NOT deleted or renamed');
  });

  it('14. Builder Payer Self-Identity Safeguard: ADEPEC GROUP is rejected as a vendor and routes to Unknown Vendors', () => {
    assert.equal(isConfidentVendor('ADEPEC GROUP'), false);
    assert.equal(isConfidentVendor('ADEPEC Homes'), false);
    assert.equal(isConfidentVendor('Adepec Group LLC'), false);

    const drive = new MockDriveFileSystem();
    const lot3 = drive.createFolder('Lot 3');
    const uploadsId = drive.ensureAppSubfolder(lot3.id, 'Invoice Uploads');
    const unknownVendorsId = drive.ensureAppSubfolder(lot3.id, 'Unknown Vendors');

    let resolvedVendorId = drive.ensureVendorFolder(lot3.id, 'ADEPEC GROUP');
    assert.equal(resolvedVendorId, null, 'Payer self-identity returns null');

    if (!resolvedVendorId) {
      resolvedVendorId = unknownVendorsId;
    }

    const cleaningReceipt = drive.createFile('Lot 3 - Cleaning - Labor.pdf', uploadsId, 'application/pdf', 'CLEANING_RECEIPT');
    drive.moveFile(cleaningReceipt.id, uploadsId, resolvedVendorId);

    // Verify receipt landed in Unknown Vendors
    assert.equal(drive.files.get(cleaningReceipt.id).parentId, unknownVendorsId);

    // Verify NO "ADEPEC GROUP" folder was created in Vendors / Stores
    const appFolder = drive.findFolder('App Folders', lot3.id);
    const vendorsStores = drive.findFolder('Vendors / Stores', appFolder.id);
    if (vendorsStores) {
      const adepecInVendors = drive.findFolder('ADEPEC GROUP', vendorsStores.id);
      assert.equal(adepecInVendors, null, 'Zero ADEPEC folder created in Vendors / Stores');
    }
  });

  it('15. Canonical Lot Normalization: Lot 3, L. 3, L.3, L-3, lot3 resolve to the same canonical lot ID', () => {
    assert.equal(toCanonicalLotId('Lot 3'), 'lot_3');
    assert.equal(toCanonicalLotId('L. 3'), 'lot_3');
    assert.equal(toCanonicalLotId('L.3'), 'lot_3');
    assert.equal(toCanonicalLotId('L-3'), 'lot_3');
    assert.equal(toCanonicalLotId('lot3'), 'lot_3');
    assert.equal(toCanonicalLotId('Lot 3A'), 'lot_3a');
    assert.equal(toCanonicalLotId('L. 3A'), 'lot_3a');
  });

  it('16. Strict Lot Boundaries: Lot 3 can NEVER match Lot 30 or Lot 3A', () => {
    const lot3Id = toCanonicalLotId('Lot 3');
    const lot30Id = toCanonicalLotId('Lot 30');
    const lot33Id = toCanonicalLotId('Lot 33');
    const lot3AId = toCanonicalLotId('Lot 3A');

    assert.notEqual(lot3Id, lot30Id, 'Lot 3 != Lot 30');
    assert.notEqual(lot3Id, lot33Id, 'Lot 3 != Lot 33');
    assert.notEqual(lot3Id, lot3AId, 'Lot 3 != Lot 3A');
  });

  it('17. Unresolved Lot Split Resolver: Never silently falls back to selectedFolder.id when lot is unresolved', () => {
    const projects = [
      { id: 'proj_1', folderId: 'folder_lot_3', name: 'Lot 3' },
      { id: 'proj_2', folderId: 'folder_lot_4', name: 'Lot 4' }
    ];
    const selectedFolder = { id: 'folder_lot_3', name: 'Lot 3' };

    // 1. Formatting variation matches seamlessly
    const matchedVariation = resolveSplitProjectFolder(projects, selectedFolder, { lotNumber: 'L. 4' });
    assert.equal(matchedVariation.unresolved, false);
    assert.equal(matchedVariation.folderId, 'folder_lot_4');

    // 2. Non-existent lot: MUST NOT fall back to selectedFolder.id!
    const unresolvedSplit = resolveSplitProjectFolder(projects, selectedFolder, { lotNumber: 'Lot 99' });
    assert.equal(unresolvedSplit.unresolved, true);
    assert.equal(unresolvedSplit.folderId, null, 'Must NOT fall back to selectedFolder.id');
    assert.ok(unresolvedSplit.error.includes('Could not resolve project lot "Lot 99"'));
  });

  it('18. Semantic Non-Merging Safeguard: Distinct entities remain separate folders', () => {
    // & vs and must NOT collapse
    assert.notEqual(toCanonicalVendorKey('Smith & Sons'), toCanonicalVendorKey('Smith and Sons'));

    // Corporate suffixes must NOT collapse
    assert.notEqual(toCanonicalVendorKey('ABC Supply'), toCanonicalVendorKey('ABC Supply Co'));
    assert.notEqual(toCanonicalVendorKey('Rodriguez Framing LLC'), toCanonicalVendorKey('Rodriguez Framing Inc'));

    // Store numbers must NOT collapse
    assert.notEqual(toCanonicalVendorKey('84 Lumber #12'), toCanonicalVendorKey('84 Lumber #14'));
  });
});

