import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBlueprintAlbumPhotoFileName, normalizePinPhotos } from '../src/services/blueprintDrive.js';

test('buildBlueprintAlbumPhotoFileName sanitizes phase names', () => {
  assert.equal(
    buildBlueprintAlbumPhotoFileName('Paint & Tile', 'progress.photo.jpg', 12345),
    'Paint___Tile_Album_12345.jpg'
  );
});

test('normalizePinPhotos reads multi-photo arrays and returns nothing for pins without photos', () => {
  const noPhotoPin = { id: 'pin_1' };
  const modernPin = {
    id: 'pin_2',
    photoAttachments: [
      { fileId: 'file-2', url: 'https://example.com/two.jpg', name: 'two.jpg' },
      { fileId: 'file-3', url: 'https://example.com/three.jpg', name: 'three.jpg' }
    ]
  };

  assert.deepEqual(normalizePinPhotos(noPhotoPin), []);
  assert.deepEqual(normalizePinPhotos(modernPin), [
    { fileId: 'file-2', url: 'https://example.com/two.jpg', name: 'two.jpg' },
    { fileId: 'file-3', url: 'https://example.com/three.jpg', name: 'three.jpg' }
  ]);
});

test('normalizePinPhotos converts Drive web links to browser-safe preview URLs when possible', () => {
  const pin = {
    id: 'pin_3',
    photoAttachments: [
      {
        fileId: 'drive-file-123',
        url: 'https://drive.google.com/file/d/drive-file-123/view?usp=drivesdk',
        name: 'photo.jpg'
      }
    ]
  };

  const normalized = normalizePinPhotos(pin);

  assert.equal(normalized[0].fileId, 'drive-file-123');
  assert.equal(normalized[0].url, 'https://drive.google.com/uc?export=view&id=drive-file-123');
  assert.equal(normalized[0].name, 'photo.jpg');
});
