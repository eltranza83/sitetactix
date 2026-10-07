import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const exists = (p) => existsSync(new URL(p, import.meta.url));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('Jarvis retired (v1.7.0); restore from the git tag "jarvis-final" if ever needed', () => {
  test('the assistant, its voice system, tools and server route are gone', () => {
    for (const p of [
      '../src/components/GlobalAIAssistant.jsx',
      '../src/services/jarvis/jarvisCore.js',
      '../src/services/voiceStateMachine.js',
      '../src/services/voiceResolver.js',
      '../src/services/speechTranscript.js',
      '../src/components/DocumentViewerModal.jsx',
      '../src/services/documentViewerService.js',
      '../api/jarvis.js',
      '../api/_lib/jarvis-tools-definitions.js',
      // removed earlier
      '../src/services/builderBrainService.js',
      '../src/services/memoryService.js',
      '../src/services/purchasingService.js',
      '../api/ask-brain.js',
      '../api/observe-preference.js'
    ]) {
      assert.equal(exists(p), false, `${p} should be deleted`);
    }
  });

  test('the scan route and buyer handover PDF are still there', () => {
    for (const p of [
      '../api/extract-document.js',
      '../src/services/buyerHandoverPdfGenerator.js'
    ]) {
      assert.equal(exists(p), true, `${p} must exist`);
    }
  });

  test('no Jarvis button in the app shell, and the dev server only runs the scan route', () => {
    const app = read('../src/App.jsx');
    assert.doesNotMatch(app, /Jarvis|GlobalAIAssistant|open-ai-assistant/);
    const vite = read('../vite.config.js');
    assert.doesNotMatch(vite, /api\/jarvis/);
    assert.match(vite, /\/api\/extract-document/);
  });
});
