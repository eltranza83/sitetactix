import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const exists = (p) => existsSync(new URL(p, import.meta.url));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('v1.5.1 old Jarvis removed', () => {
  test('the old brain, tools and server routes are gone', () => {
    for (const p of [
      '../src/services/builderBrainService.js',
      '../src/services/aiTools.js',
      '../src/services/clientActionService.js',
      '../src/services/cognitiveInitiativeEngine.js',
      '../src/services/semanticIntentService.js',
      '../src/services/userPreferenceEngine.js',
      '../src/services/memoryService.js',
      '../src/services/finishService.js',
      '../src/services/documentContentProvider.js',
      '../src/services/googleDocsPurchasingService.js',
      '../api/ask-brain.js',
      '../api/observe-preference.js',
      '../api/_lib/ai-tools-definitions.js'
    ]) {
      assert.equal(exists(p), false, `${p} should be deleted`);
    }
  });

  test('the new Jarvis route and core are still there', () => {
    for (const p of [
      '../api/jarvis.js',
      '../api/_lib/jarvis-tools-definitions.js',
      '../src/services/jarvis/jarvisCore.js',
      '../src/services/purchasingService.js',
      '../src/services/buyerHandoverPdfGenerator.js'
    ]) {
      assert.equal(exists(p), true, `${p} must exist`);
    }
  });

  test('Settings has no engine switch and the assistant has no diagnostics suite', () => {
    const settings = read('../src/components/Settings.jsx');
    const assistant = read('../src/components/GlobalAIAssistant.jsx');
    assert.doesNotMatch(settings, /Jarvis Engine/);
    assert.doesNotMatch(assistant, /Diagnostics/);
    assert.doesNotMatch(assistant, /showTestSuite/);
    assert.doesNotMatch(assistant, /devMode/);
  });

  test('the dev server only proxies the Jarvis route', () => {
    const vite = read('../vite.config.js');
    assert.doesNotMatch(vite, /ask-brain/);
    assert.match(vite, /\/api\/jarvis/);
  });
});
