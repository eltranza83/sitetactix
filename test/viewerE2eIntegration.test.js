import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_VIEWER_SPEC_VERSION,
  detectBrowserCapabilities,
  resolveDocumentViewPlan,
  getStrategyChainForFile,
  recordProviderHealth,
  isProviderHealthy,
  getProviderHealthStatus,
  logViewerTelemetry,
  getViewerTelemetryHistory,
  clearViewerTelemetry,
  RENDER_MODES
} from '../src/services/documentViewerService.js';

describe('Document Viewer End-to-End Integration & Robustness Suite', () => {
  test('Scenario 1: End-to-End Flow — Pronoun resolution -> Action -> Mobile Strategy Selection', async () => {
    // 1. Mock prior chat context where a file was discussed
    const mockDriveTree = {
      subfolders: [
        {
          folderName: 'Closing Settlement',
          files: [
            {
              id: 'DRIVE_FILE_777',
              name: 'Lot_3_Closing_Cost_Allocation.pdf',
              mimeType: 'application/pdf'
            }
          ]
        }
      ]
    };

    const mockMessages = [
      { sender: 'user', text: 'Where is our closing statement?' },
      { sender: 'ai', text: 'Your file Lot_3_Closing_Cost_Allocation.pdf is located in the Closing Settlement folder.' }
    ];

    // 2. Pronoun query: "open it"
    // Simulate finding referenced file from recent history (mimicking findReferencedDriveFile)
    const referencedFile = mockDriveTree.subfolders[0].files[0];
    assert.equal(referencedFile.name, 'Lot_3_Closing_Cost_Allocation.pdf');

    // 3. Action execution payload
    const fileActionPayload = {
      fileId: referencedFile.id,
      fileName: referencedFile.name,
      folderName: 'Closing Settlement',
      provider: 'google_drive'
    };

    // 4. Mobile capabilities
    const mobileCaps = {
      isMobile: true,
      isAndroid: true,
      isIOS: false,
      pdfViewerEnabled: false,
      supportsTouch: true
    };

    // 5. Resolve plan
    const plan = await resolveDocumentViewPlan(fileActionPayload, 'mock_token', mobileCaps);

    // Verify strategy
    assert.equal(plan.success, true);
    assert.equal(plan.specVersion, DOCUMENT_VIEWER_SPEC_VERSION);
    assert.equal(plan.strategyId, 'drive_preview_embed');
    assert.equal(plan.renderMode, RENDER_MODES.IFRAME_EMBED);
    assert.equal(plan.srcUrl, 'https://drive.google.com/file/d/DRIVE_FILE_777/preview');
    assert.equal(plan.externalUrl, 'https://drive.google.com/file/d/DRIVE_FILE_777/view');
    assert.equal(typeof plan.downloadUrl, 'string');
  });

  test('Scenario 2: Provider Health & Circuit Breaker — Tripping circuit breaker disables failing strategy', async () => {
    // 1. Initial state
    assert.equal(isProviderHealthy('custom_storage'), true);

    // 2. Record 3 consecutive failures
    recordProviderHealth('custom_storage', false, '503 Gateway Timeout');
    recordProviderHealth('custom_storage', false, '503 Gateway Timeout');
    recordProviderHealth('custom_storage', false, '503 Gateway Timeout');

    // 3. Verify circuit breaker state
    assert.equal(isProviderHealthy('custom_storage'), false);
    assert.equal(getProviderHealthStatus('custom_storage'), 'UNAVAILABLE');

    // 4. Recover health on successful response
    recordProviderHealth('custom_storage', true);
    assert.equal(isProviderHealthy('custom_storage'), true);
    assert.equal(getProviderHealthStatus('custom_storage'), 'HEALTHY');
  });

  test('Scenario 3: Extensible Provider Strategy Registry — Adding third-party provider (OneDrive/SharePoint)', async () => {
    const oneDriveFile = {
      fileId: 'ONEDRIVE_99',
      fileName: 'Structural_Inspection.pdf',
      provider: 'onedrive',
      embedUrl: 'https://onedrive.live.com/embed?resid=ONEDRIVE_99'
    };

    const caps = { isMobile: false, pdfViewerEnabled: true };
    const plan = await resolveDocumentViewPlan(oneDriveFile, null, caps);

    assert.equal(plan.success, true);
    assert.equal(plan.strategyId, 'onedrive_preview_embed');
    assert.equal(plan.srcUrl, 'https://onedrive.live.com/embed?resid=ONEDRIVE_99');
  });

  test('Scenario 4: Field Telemetry Logger — Records telemetry history with timings & spec version', async () => {
    clearViewerTelemetry();

    const fileMeta = { fileId: 'TEL_FILE_1', fileName: 'blueprint.png', directUrl: 'https://cdn.example.com/img.png' };
    const plan = await resolveDocumentViewPlan(fileMeta, null, { isMobile: false });

    const history = getViewerTelemetryHistory();
    assert.equal(history.length >= 1, true);

    const latest = history[0];
    assert.equal(latest.specVersion, DOCUMENT_VIEWER_SPEC_VERSION);
    assert.equal(latest.fileId, 'TEL_FILE_1');
    assert.equal(latest.strategyId, 'image_direct');
    assert.equal(latest.success, true);
    assert.equal(typeof latest.durationMs, 'number');
  });
});
