import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchProjectDriveTree } from '../src/services/googleDrive.js';

describe('Project Drive tree crawler', () => {
  it('discovers arbitrary depth, paginates, and does not loop on a circular shortcut', async () => {
    let callCount = 0;
    const mockServer = async (url) => {
      callCount++;
      const urlStr = String(url);

      if (urlStr.includes('fld_root')) {
        return Response.json({
          files: [
            { id: 'fld_app_folders', name: 'App Folders', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f_root_1', name: 'Charter.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/d/f_root_1' }
          ]
        });
      }

      if (urlStr.includes('fld_app_folders')) {
        return Response.json({
          files: [
            { id: 'fld_purchasing', name: 'Google Doc Purchasing List', mimeType: 'application/vnd.google-apps.folder' },
            // circular shortcut back to the root to test loop prevention
            { id: 'fld_root', name: 'Shortcut to Root', mimeType: 'application/vnd.google-apps.folder' }
          ]
        });
      }

      if (urlStr.includes('fld_purchasing')) {
        if (!urlStr.includes('pageToken')) {
          return Response.json({
            nextPageToken: 'token_page_2',
            files: [
              { id: 'fld_archive_2026', name: '2026 Archive', mimeType: 'application/vnd.google-apps.folder' },
              { id: 'f_pur_1', name: 'Purchasing Checklist.docx', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://drive.google.com/file/d/f_pur_1' }
            ]
          });
        }
        return Response.json({
          files: [
            { id: 'f_pur_2', name: 'Second Page Order.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/d/f_pur_2' }
          ]
        });
      }

      if (urlStr.includes('fld_archive_2026')) {
        return Response.json({
          files: [
            { id: 'f_arch_1', name: 'Deep Lumber PO.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/d/f_arch_1' }
          ]
        });
      }

      return Response.json({ files: [] });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockServer;

    try {
      const tree = await fetchProjectDriveTree('mock_token', 'fld_root');

      assert.ok(tree, 'Drive tree must be returned');
      assert.equal(tree.directFiles.length, 1);
      assert.equal(tree.directFiles[0].name, 'Charter.pdf');

      assert.ok(tree.foldersById['fld_archive_2026'], 'Level 3 folder must be indexed');
      assert.equal(tree.foldersById['fld_archive_2026'].folderPath, 'App Folders / Google Doc Purchasing List / 2026 Archive');

      assert.equal(tree.foldersById['fld_purchasing'].files.length, 2, 'Must paginate through both pages');
      assert.equal(tree.allFiles.length, 4, 'Must aggregate files across all depths');
      assert.ok(callCount <= 10, `Total API calls (${callCount}) must be bounded and not infinite`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
