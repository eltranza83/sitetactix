// Where receipts and photos go in Drive, through the REAL googleDrive.js code on a fake Drive
// (test/fakeDrive.js), plus the vendor and lot name rules.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDrive } from './fakeDrive.js';
import {
  ensureAppSubfolder,
  ensureUnknownVendorsFolder,
  ensureVendorFolder,
  isConfidentVendor,
  toCanonicalVendorKey,
  uploadPhotoToPhaseFolder
} from '../src/services/googleDrive.js';
import { toCanonicalLotId, resolveSplitProjectFolder } from '../src/services/invoiceUpload.js';

const FOLDER = 'application/vnd.google-apps.folder';

describe('App Folders in Drive (real code, fake Drive)', () => {
  let drive;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    drive = createFakeDrive();
    globalThis.fetch = drive.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const foldersNamed = (name) => [...drive.files.values()].filter(f => f.mimeType === FOLDER && f.name === name && !f.trashed);
  const pathOf = (id) => `${drive.folderPath(id)}/${drive.files.get(id).name}`;

  it('work folders are made inside App Folders, never at the lot root, and reused', async () => {
    const uploads = await ensureAppSubfolder('token', 'lot3', 'Invoice Uploads');
    const again = await ensureAppSubfolder('token', 'lot3', 'Invoice Uploads');
    const unknown = await ensureUnknownVendorsFolder('token', 'lot3');

    assert.equal(uploads, again);
    assert.equal(pathOf(uploads), 'lot3/App Folders/Invoice Uploads');
    assert.equal(pathOf(unknown), 'lot3/App Folders/Unknown Vendors');
    assert.equal(foldersNamed('App Folders').length, 1);
    assert.equal(foldersNamed('Invoice Uploads').length, 1);
  });

  it('a new vendor gets its own folder under App Folders / Vendors / Stores', async () => {
    const walmart = await ensureVendorFolder('token', 'lot3', 'Walmart');
    assert.equal(pathOf(walmart), 'lot3/App Folders/Vendors / Stores/Walmart');
    assert.equal(await ensureVendorFolder('token', 'lot3', 'Walmart'), walmart);
  });

  it('a slightly different spelling reuses the existing vendor folder', async () => {
    const herrera = await ensureVendorFolder('token', 'lot3', 'L. Herrera Landscaping & Sprinklers');
    assert.equal(await ensureVendorFolder('token', 'lot3', 'L.Herrera Landscaping & Sprinklers'), herrera);
    assert.equal(foldersNamed('L.Herrera Landscaping & Sprinklers').length, 0, 'no duplicate folder');
  });

  it('when two existing folders could match, it refuses to guess (Unknown Vendors)', async () => {
    const vendors = await ensureAppSubfolder('token', 'lot3', 'Vendors / Stores');
    drive.add({ name: 'L. Herrera', mimeType: FOLDER, parents: [vendors] });
    drive.add({ name: 'L.Herrera', mimeType: FOLDER, parents: [vendors] });
    assert.equal(await ensureVendorFolder('token', 'lot3', 'L Herrera'), null);
  });

  it('unclear vendors and the builder itself never get a vendor folder', async () => {
    for (const vendor of ['Unknown', 'CASH', 'TOTAL', 'ADEPEC GROUP', 'Adepec Group LLC']) {
      assert.equal(await ensureVendorFolder('token', 'lot3', vendor), null, vendor);
    }
    assert.equal(foldersNamed('Vendors / Stores').length, 0);
  });

  it('phase photos live under App Folders / X-Ray Photos / Project_Photos', async () => {
    const photo = await uploadPhotoToPhaseFolder('token', 'lot3', 'Site_Prep_&_Structure', 'Framing', 'f.jpg', 'image/jpeg', new Blob(['x']));
    assert.equal(drive.folderPath(photo.id), 'lot3/App Folders/X-Ray Photos/Project_Photos/Site_Prep___Structure/Framing');
  });
});

describe('vendor and lot name rules', () => {
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
