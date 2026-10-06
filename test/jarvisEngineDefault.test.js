import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getJarvisEngineMode, JARVIS_ENGINE_KEY } from '../src/services/jarvis/engineMode.js';

const fakeStorage = (value) => ({ getItem: (k) => (k === JARVIS_ENGINE_KEY ? value : null) });

describe('v1.4.8 new Jarvis is the default', () => {
  test('a device with no saved choice uses the new Jarvis', () => {
    assert.equal(getJarvisEngineMode(fakeStorage(null)), 'new');
  });

  test('a saved "new" stays new', () => {
    assert.equal(getJarvisEngineMode(fakeStorage('new')), 'new');
  });

  test('only an explicit "classic" choice stays on the old Jarvis', () => {
    assert.equal(getJarvisEngineMode(fakeStorage('classic')), 'classic');
  });

  test('unknown values and blocked storage fall back to new', () => {
    assert.equal(getJarvisEngineMode(fakeStorage('something-else')), 'new');
    assert.equal(getJarvisEngineMode({ getItem() { throw new Error('blocked'); } }), 'new');
  });

  test('assistant and Settings use the shared default', () => {
    const assistant = readFileSync(new URL('../src/components/GlobalAIAssistant.jsx', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
    assert.match(assistant, /const engineMode = getJarvisEngineMode\(\);/);
    assert.match(settings, /useState\(\(\) => getJarvisEngineMode\(\)\)/);
    assert.doesNotMatch(assistant, /jarvis_engine_mode'\) \|\| 'classic'/);
    assert.doesNotMatch(settings, /jarvis_engine_mode'\) \|\| 'classic'/);
  });

  test('the greeting is just "Online and at your service."', () => {
    const assistant = readFileSync(new URL('../src/components/GlobalAIAssistant.jsx', import.meta.url), 'utf8');
    assert.match(assistant, /text: 'Online and at your service\.'/);
    assert.doesNotMatch(assistant, /I have indexed all project financials/);
  });
});
