import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_TYPES,
  ACTION_SCHEMAS,
  validateActionPayload,
  findDriveFile,
  findDriveFolder,
  executeClientAction
} from '../src/services/clientActionService.js';

import {
  executeClientToolCall
} from '../src/services/aiTools.js';

import {
  classifySemanticIntent,
  synthesizeGroundedEvidence,
  ActionCommandPlugin
} from '../src/services/semanticIntentService.js';

describe('Generalized Client Actions Framework Suite', () => {

  const mockDriveTree = {
    directFiles: [
      { name: 'Lot 3 Financial Summary.xlsx', id: 'f_fin_1', webViewLink: 'https://drive.google.com/file/d/f_fin_1/view' },
      { name: 'Site Safety Rules.pdf', id: 'f_safety_1', webViewLink: 'https://drive.google.com/file/d/f_safety_1/view' },
      { name: 'Corrupted File With No Link.pdf', id: null, webViewLink: null }
    ],
    subfolders: [
      {
        folderName: 'Floor Plans',
        folderId: 'fld_fp_1',
        webViewLink: 'https://drive.google.com/drive/folders/fld_fp_1',
        files: [
          { name: 'Lot 3 Floor Plan Review.pdf', id: 'f_fp_1', webViewLink: 'https://drive.google.com/file/d/f_fp_1/view', mimeType: 'application/pdf' },
          { name: 'Electrical Rough-in Layout.pdf', id: 'f_fp_2', webViewLink: 'https://drive.google.com/file/d/f_fp_2/view', mimeType: 'application/pdf' }
        ]
      },
      {
        folderName: 'Closing Settlement',
        folderId: 'fld_cs_1',
        webViewLink: 'https://drive.google.com/drive/folders/fld_cs_1',
        files: [
          { name: 'Closing Cost Allocation.pdf', id: 'f_cs_1', webViewLink: 'https://drive.google.com/file/d/f_cs_1/view' }
        ]
      },
      {
        folderName: 'Permits & City Docs',
        folderId: 'fld_empty_1',
        webViewLink: 'https://drive.google.com/drive/folders/fld_empty_1',
        files: [] // Empty folder
      }
    ]
  };

  it('1. Contract Validation: Validates required schema fields and allowed enum values', () => {
    assert.doesNotThrow(() => {
      validateActionPayload(ACTION_TYPES.OPEN_DOCUMENT, { fileName: 'Lot 3 Floor Plan Review.pdf' });
    });

    assert.doesNotThrow(() => {
      validateActionPayload(ACTION_TYPES.NAVIGATE_TO, { tab: 'xray' });
    });

    assert.throws(() => {
      validateActionPayload(ACTION_TYPES.OPEN_DOCUMENT, {});
    }, /Missing required field "fileName"/);

    assert.throws(() => {
      validateActionPayload(ACTION_TYPES.NAVIGATE_TO, { tab: 'invalid_tab' });
    }, /Invalid value for \[NAVIGATE_TO\.tab\]/);

    assert.throws(() => {
      validateActionPayload('UNKNOWN_ACTION', { foo: 'bar' });
    }, /Unknown Action Type/);
  });

  it('2. OPEN_DOCUMENT Success: Finds file across nested subfolders and returns valid link & metadata', async () => {
    const result = await executeClientAction(ACTION_TYPES.OPEN_DOCUMENT, {
      fileName: 'floor plan'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.fileName, 'Lot 3 Floor Plan Review.pdf');
    assert.strictEqual(result.folderName, 'Floor Plans');
    assert.strictEqual(result.webViewLink, 'https://drive.google.com/file/d/f_fp_1/view');
    assert.strictEqual(result.actionType, ACTION_TYPES.OPEN_DOCUMENT);
  });

  it('3. OPEN_DOCUMENT Nonexistent File: Returns success: false with truthful failure reason', async () => {
    const result = await executeClientAction(ACTION_TYPES.OPEN_DOCUMENT, {
      fileName: 'Nonexistent Blueprint 999.pdf'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3'
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /was not found in Google Drive for Lot 3/);
  });

  it('4. OPEN_DOCUMENT File with missing link: Returns success: false when view link cannot be constructed', async () => {
    const result = await executeClientAction(ACTION_TYPES.OPEN_DOCUMENT, {
      fileName: 'Corrupted File With No Link'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3'
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /no accessible view link is available/);
  });

  it('5. OPEN_FOLDER Success: Locates subfolder and returns folder URL and file list', async () => {
    const result = await executeClientAction(ACTION_TYPES.OPEN_FOLDER, {
      folderName: 'Floor Plans'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.folderName, 'Floor Plans');
    assert.strictEqual(result.fileCount, 2);
    assert.strictEqual(result.webViewLink, 'https://drive.google.com/drive/folders/fld_fp_1');
  });

  it('6. OPEN_FOLDER Empty Folder: Returns success: false with isFolderEmpty: true and truthful message', async () => {
    const result = await executeClientAction(ACTION_TYPES.OPEN_FOLDER, {
      folderName: 'Permits'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.isFolderEmpty, true);
    assert.match(result.error, /is currently empty/);
  });

  it('7. NAVIGATE_TO Action: Calls tab navigation callback with valid tab', async () => {
    let navigatedTab = null;
    const result = await executeClientAction(ACTION_TYPES.NAVIGATE_TO, {
      tab: 'xray'
    }, {
      onNavigateTab: (tab) => {
        navigatedTab = tab;
      }
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(navigatedTab, 'xray');
  });

  it('8. Client Tool Execution via executeClientToolCall routes open_drive_document cleanly', async () => {
    const toolResult = await executeClientToolCall('open_drive_document', {
      fileName: 'floor plan'
    }, {
      driveTree: mockDriveTree,
      activeProject: { name: 'Lot 3' }
    });

    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.fileName, 'Lot 3 Floor Plan Review.pdf');
    assert.strictEqual(toolResult.folderName, 'Floor Plans');
  });

  it('9. Truthful Confirmation Gate: AI synthesizes confirmation ONLY when action succeeded', () => {
    // 9.1 Successful Action
    const successTelemetry = [{
      name: 'open_drive_document',
      success: true,
      result: {
        success: true,
        fileName: 'Lot 3 Floor Plan Review.pdf',
        folderName: 'Floor Plans',
        webViewLink: 'https://drive.google.com/file/d/f_fp_1/view'
      }
    }];

    const successSynthesis = synthesizeGroundedEvidence(successTelemetry, 'open the floor plan PDF', { activeProjectName: 'Lot 3' });
    assert.match(successSynthesis, /Opened "Lot 3 Floor Plan Review\.pdf"/);

    // 9.2 Failed Action (Nonexistent File)
    const failureTelemetry = [{
      name: 'open_drive_document',
      success: false,
      error: 'Document "missing.pdf" was not found in Google Drive for Lot 3.',
      result: {
        success: false,
        error: 'Document "missing.pdf" was not found in Google Drive for Lot 3.'
      }
    }];

    const failureSynthesis = synthesizeGroundedEvidence(failureTelemetry, 'open missing.pdf', { activeProjectName: 'Lot 3' });
    assert.match(failureSynthesis, /was not found in Google Drive for Lot 3/);
    assert.doesNotMatch(failureSynthesis, /^Opened/); // Never claims opened
  });

  it('10. OPEN_DOCUMENT In-App Viewer Callback: Invokes onOpenDocument when provided in context', async () => {
    let openedDoc = null;
    const result = await executeClientAction(ACTION_TYPES.OPEN_DOCUMENT, {
      fileName: 'floor plan'
    }, {
      driveTree: mockDriveTree,
      activeProjectName: 'Lot 3',
      onOpenDocument: (doc) => {
        openedDoc = doc;
      }
    });

    assert.strictEqual(result.success, true);
    assert.ok(openedDoc, 'onOpenDocument must be called');
    assert.strictEqual(openedDoc.name, 'Lot 3 Floor Plan Review.pdf');
    assert.strictEqual(openedDoc.id, 'f_fp_1');
    assert.strictEqual(openedDoc.folderName, 'Floor Plans');
    assert.strictEqual(openedDoc.webViewLink, 'https://drive.google.com/file/d/f_fp_1/view');
  });

});
