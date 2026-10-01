import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

import { executeClientToolCall, resetWriteIdempotencyState } from '../src/services/aiTools.js';
import { setCustomContentProvider, resetContentProvider } from '../src/services/documentContentProvider.js';

describe('remove_purchasing_section AI Tool Test Suite', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    resetContentProvider();
    resetWriteIdempotencyState();
  });

  it('successfully executes remove_purchasing_section without reference errors', async () => {
    let writtenContent = null;

    const initialDoc = `# Lot 3 Purchasing Checklist

## Electrical Hardware Fixtures
- [ ] Security lights
- [ ] Dimmer switches

## Plumbing
- [ ] PVC pipes
- [ ] PEX tubing
`;

    setCustomContentProvider({
      fetchDocumentContent: async ({ documentId }) => {
        assert.equal(documentId, 'doc_lot3_purchasing');
        return {
          success: true,
          content: initialDoc
        };
      },
      writeDocumentContent: async ({ documentId, content }) => {
        assert.equal(documentId, 'doc_lot3_purchasing');
        writtenContent = content;
        return { success: true };
      }
    });

    const projectContext = {
      projectId: 'lot_3',
      activeProjectName: 'Lot 3',
      driveTree: {
        directFiles: [],
        subfolders: [
          {
            folderName: 'Google Doc Purchasing List',
            files: [
              {
                id: 'doc_lot3_purchasing',
                name: 'Purchasing Checklist.docx',
                mimeType: 'application/vnd.google-apps.document'
              }
            ]
          }
        ]
      }
    };

    const result = await executeClientToolCall(
      'remove_purchasing_section',
      { sectionName: 'Electrical Hardware Fixtures' },
      projectContext
    );

    assert.equal(result.success, true, 'Tool execution must succeed');
    assert.ok(result.sectionName, 'Result must report sectionName');
    assert.ok(writtenContent, 'Must have written updated document content');
    assert.ok(!writtenContent.includes('## Electrical Hardware Fixtures'), 'Updated content must not contain ## Electrical Hardware Fixtures');
    assert.ok(writtenContent.includes('## Plumbing'), 'Updated content must retain ## Plumbing');
  });

  it('gracefully reports when section to remove is not found', async () => {
    const initialDoc = `# Lot 3 Purchasing Checklist

## Plumbing
- [ ] PVC pipes
`;

    setCustomContentProvider({
      fetchDocumentContent: async () => ({
        success: true,
        content: initialDoc
      })
    });

    const projectContext = {
      projectId: 'lot_3',
      activeProjectName: 'Lot 3',
      driveTree: {
        directFiles: [],
        subfolders: [
          {
            folderName: 'Google Doc Purchasing List',
            files: [
              {
                id: 'doc_lot3_purchasing',
                name: 'Purchasing Checklist.docx',
                mimeType: 'application/vnd.google-apps.document'
              }
            ]
          }
        ]
      }
    };

    const result = await executeClientToolCall(
      'remove_purchasing_section',
      { sectionName: 'Electrical' },
      projectContext
    );

    assert.equal(result.success, false);
    assert.ok(result.message.includes('not found') || result.message.includes('Could not find'));
  });

  it('successfully removes a section from the Master Purchasing template', async () => {
    let writtenContent = null;
    const initialMasterDoc = `# Master Fixtures & Hardware Purchasing Checklist (Company Master Template — v1.0)
<!-- version: 1.0 -->

<!-- section: quartz -->
## 1. Quartz Hardware
- [ ] Undermount kitchen sink clips

<!-- section: plumbing -->
## 2. Plumbing Hardware
- [ ] P-traps
`;

    setCustomContentProvider({
      fetchDocumentContent: async () => ({
        success: true,
        content: initialMasterDoc
      }),
      writeDocumentContent: async ({ content }) => {
        writtenContent = content;
        return { success: true };
      }
    });

    const result = await executeClientToolCall(
      'remove_purchasing_section',
      { projectId: 'master', sectionName: 'Quartz Hardware' },
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.sectionName, 'Quartz Hardware');
    const storedMaster = globalThis.localStorage.getItem('sitetactix_purchasing_master_doc');
    assert.ok(storedMaster, 'Must have saved updated master doc to storage');
    assert.ok(!storedMaster.includes('Quartz Hardware'));
    assert.ok(storedMaster.includes('Plumbing Hardware'));
  });
});
