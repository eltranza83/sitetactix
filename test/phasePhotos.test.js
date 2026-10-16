// Phase album photos through the REAL Drive code on a fake Drive: what the app uploads, the album finds.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDrive } from './fakeDrive.js';
import { listPhotosInPhase, phasePhotoFolderName, uploadPhotoToPhaseFolder } from '../src/services/googleDrive.js';
import { listDashboardPhasePhotos } from '../src/services/dashboardDrive.js';
import { listBlueprintPhasePhotos, uploadBlueprintAlbumPhoto } from '../src/services/blueprintDrive.js';

const photo = () => new Blob(['jpeg bytes'], { type: 'image/jpeg' });

describe('phase album photos (real code, fake Drive)', () => {
  let drive;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    drive = createFakeDrive();
    globalThis.fetch = drive.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('a photo uploaded to a phase shows up in that phase\'s album', async () => {
    await uploadPhotoToPhaseFolder('token', 'lot99', 'Mechanicals_&_Utilities', 'Electrical & Lighting', 'a.jpg', 'image/jpeg', photo());

    const photos = await listPhotosInPhase('token', 'lot99', 'Mechanicals_&_Utilities', 'Electrical & Lighting');
    assert.equal(photos.length, 1);
    assert.equal(photos[0].name, 'a.jpg');
    assert.equal(
      drive.folderPath(photos[0].id),
      'lot99/App Folders/X-Ray Photos/Project_Photos/Mechanicals___Utilities/Electrical _ Lighting'
    );
  });

  test('Dashboard and X-Ray albums both find photos from either screen', async () => {
    const phase = { category: 'Site_Prep_&_Structure', phase: 'Slab / Foundation' };
    await uploadBlueprintAlbumPhoto({
      accessToken: 'token',
      projectFolderId: 'lot99',
      activeAlbumPhase: phase,
      file: new File(['jpeg'], 'slab.jpg', { type: 'image/jpeg' })
    });

    const fromDashboard = await listDashboardPhasePhotos({ accessToken: 'token', projectFolderId: 'lot99', phase });
    const fromXRay = await listBlueprintPhasePhotos({ accessToken: 'token', projectFolderId: 'lot99', ...phase });
    assert.equal(fromDashboard.length, 1);
    assert.equal(fromXRay.length, 1);
  });

  test('photos stay in their own phase and lot', async () => {
    await uploadPhotoToPhaseFolder('token', 'lot99', 'Mechanicals_&_Utilities', 'Plumbing', 'p.jpg', 'image/jpeg', photo());
    assert.equal((await listPhotosInPhase('token', 'lot99', 'Mechanicals_&_Utilities', 'Electrical & Lighting')).length, 0);
    assert.equal((await listPhotosInPhase('token', 'lot3', 'Mechanicals_&_Utilities', 'Plumbing')).length, 0);
  });

  test('looking at an empty album creates no folders', async () => {
    assert.deepEqual(await listPhotosInPhase('token', 'lot99', 'Mechanicals_&_Utilities', 'Plumbing'), []);
    assert.equal(drive.calls.filter(c => c.method === 'POST').length, 0);
  });

  test('upload and list use the same folder names (spaces and dashes kept)', () => {
    assert.equal(phasePhotoFolderName('Electrical & Lighting'), 'Electrical _ Lighting');
    assert.equal(phasePhotoFolderName('Slab / Foundation'), 'Slab _ Foundation');
    assert.equal(phasePhotoFolderName('Pre-Drywall'), 'Pre-Drywall');
  });
});

describe('Drive searches (real code, fake Drive)', () => {
  let drive;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    drive = createFakeDrive();
    globalThis.fetch = drive.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('a folder with more than 100 files is listed in full', async () => {
    const { listFilesWithDescriptionInFolder, listSubfoldersInFolder } = await import('../src/services/googleDrive.js');
    for (let i = 0; i < 150; i++) {
      drive.add({ name: `receipt ${i}.pdf`, mimeType: 'application/pdf', parents: ['uploads'] });
      drive.add({ name: `vendor ${i}`, mimeType: 'application/vnd.google-apps.folder', parents: ['vendors'] });
    }
    assert.equal((await listFilesWithDescriptionInFolder('token', 'uploads')).length, 150);
    assert.equal((await listSubfoldersInFolder('token', 'vendors')).length, 150);
  });

  test('names with an apostrophe are found (no broken search)', async () => {
    const { findFileInFolder, findOrCreateFolder } = await import('../src/services/googleDrive.js');
    const file = drive.add({ name: "O'Connor Lot 5.pdf", mimeType: 'application/pdf', parents: ['lot5'] });
    assert.equal((await findFileInFolder('token', 'lot5', "O'Connor Lot 5.pdf"))?.id, file.id);

    const folderId = await findOrCreateFolder('token', "Lowe's", 'vendors');
    assert.equal(await findOrCreateFolder('token', "Lowe's", 'vendors'), folderId, 'second lookup must find, not duplicate');
  });
});
