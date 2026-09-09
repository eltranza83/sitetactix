import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBestBritishMaleVoice,
  getBestSpanishMaleVoice,
  resolveVoice,
  isFemaleVoice,
  isExplicitMaleVoice
} from '../src/services/voiceResolver.js';

describe('J.A.R.V.I.S. Mobile & Platform Voice Resolver Test Suite', () => {

  test('1. Samsung Galaxy S24/S25/S26 Ultra: Selects Samsung UK Male over default Samsung Female', () => {
    // Exact representation of Samsung TTS voices on One UI / Android
    const samsungVoices = [
      { name: 'Samsung English (United States)', lang: 'en-US', voiceURI: 'en_US' }, // default female
      { name: 'Samsung English (United Kingdom)', lang: 'en-GB', voiceURI: 'en_GB' }, // default female UK!
      { name: 'Samsung English (United Kingdom, Male)', lang: 'en-GB', voiceURI: 'en_GB_male' },
      { name: 'Samsung English (United States, Male)', lang: 'en-US', voiceURI: 'en_US_male' },
      { name: 'Samsung Español (España)', lang: 'es-ES', voiceURI: 'es_ES' }
    ];

    const chosen = getBestBritishMaleVoice(samsungVoices);
    assert.ok(chosen, 'A voice must be chosen');
    assert.equal(chosen.name, 'Samsung English (United Kingdom, Male)');
    assert.equal(chosen.voiceURI, 'en_GB_male');
    assert.equal(isFemaleVoice(chosen), false);
    assert.equal(isExplicitMaleVoice(chosen), true);
  });

  test('2. Android with Google Speech Services: Selects Google UK English Male over female defaults', () => {
    // Exact representation of Google TTS engine voices on Android
    const googleAndroidVoices = [
      { name: 'English (United States)', lang: 'en-US', voiceURI: 'en-us-x-sfg-local' }, // Google female
      { name: 'English (United Kingdom)', lang: 'en-GB', voiceURI: 'en-gb-x-gba-local' }, // Google female UK
      { name: 'English (United Kingdom)', lang: 'en-GB', voiceURI: 'en-gb-x-rjs-local' }, // Google male UK
      { name: 'English (United Kingdom)', lang: 'en-GB', voiceURI: 'en-gb-x-gbb-local' }, // Google male UK #2
      { name: 'English (United States)', lang: 'en-US', voiceURI: 'en-us-x-iol-local' }  // Google male US
    ];

    const chosen = getBestBritishMaleVoice(googleAndroidVoices);
    assert.ok(chosen, 'A voice must be chosen');
    assert.ok(chosen.voiceURI.includes('rjs') || chosen.voiceURI.includes('gbb'), 'Must pick male UK voice');
    assert.equal(isFemaleVoice(chosen), false);
  });

  test('3. Mobile Fallback: If only UK voice is female, cleanly falls back to US Male instead of female UK', () => {
    const mobileNoUkMale = [
      { name: 'English (United States)', lang: 'en-US', voiceURI: 'en-us-x-sfg' }, // female US
      { name: 'English (United Kingdom)', lang: 'en-GB', voiceURI: 'en-gb-x-gba' }, // female UK (no male UK installed)
      { name: 'Samsung English (United States, Male)', lang: 'en-US', voiceURI: 'en_US_male' } // male US
    ];

    const chosen = getBestBritishMaleVoice(mobileNoUkMale);
    assert.ok(chosen, 'A voice must be chosen');
    assert.equal(chosen.name, 'Samsung English (United States, Male)', 'Must prefer US Male over Female UK');
    assert.equal(isFemaleVoice(chosen), false);
  });

  test('4. Windows PC: Selects Microsoft George (UK Male)', () => {
    const windowsVoices = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'urn:moz-tts:sapi:Microsoft David' },
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', voiceURI: 'urn:moz-tts:sapi:Microsoft Zira' },
      { name: 'Microsoft George - English (United Kingdom)', lang: 'en-GB', voiceURI: 'urn:moz-tts:sapi:Microsoft George' },
      { name: 'Microsoft Susan - English (United Kingdom)', lang: 'en-GB', voiceURI: 'urn:moz-tts:sapi:Microsoft Susan' }
    ];

    const chosen = getBestBritishMaleVoice(windowsVoices);
    assert.ok(chosen);
    assert.equal(chosen.name, 'Microsoft George - English (United Kingdom)');
    assert.equal(isFemaleVoice(chosen), false);
  });

  test('5. Apple iOS / macOS: Selects Daniel (UK Male)', () => {
    const appleVoices = [
      { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.samantha' },
      { name: 'Karen', lang: 'en-AU', voiceURI: 'com.apple.speech.synthesis.voice.karen' },
      { name: 'Daniel', lang: 'en-GB', voiceURI: 'com.apple.speech.synthesis.voice.daniel' },
      { name: 'Kate', lang: 'en-GB', voiceURI: 'com.apple.speech.synthesis.voice.kate' }
    ];

    const chosen = getBestBritishMaleVoice(appleVoices);
    assert.ok(chosen);
    assert.equal(chosen.name, 'Daniel');
    assert.equal(isFemaleVoice(chosen), false);
  });

  test('6. Stale config override: If localStorage contains a female voice, ignores it and auto-corrects to male', () => {
    const voices = [
      { name: 'Samsung English (United Kingdom)', lang: 'en-GB', voiceURI: 'en_GB' }, // stale female choice
      { name: 'Samsung English (United Kingdom, Male)', lang: 'en-GB', voiceURI: 'en_GB_male' }
    ];

    const staleFemaleConfig = { uri: 'en_GB', name: 'Samsung English (United Kingdom)', lang: 'en-GB' };
    const chosen = resolveVoice(voices, staleFemaleConfig, false);
    assert.ok(chosen);
    assert.equal(chosen.name, 'Samsung English (United Kingdom, Male)', 'Must reject stale female config and pick male');
  });

  test('7. Spanish Male Voice: Selects male Spanish voice over female default', () => {
    const spanishVoices = [
      { name: 'Microsoft Sabina - Spanish (Mexico)', lang: 'es-MX', voiceURI: 'sabina' }, // female
      { name: 'Microsoft Raul - Spanish (Mexico)', lang: 'es-MX', voiceURI: 'raul' },     // male
      { name: 'Google español', lang: 'es-ES', voiceURI: 'es-es-x-eea' }                 // female
    ];

    const chosen = getBestSpanishMaleVoice(spanishVoices);
    assert.ok(chosen);
    assert.equal(chosen.name, 'Microsoft Raul - Spanish (Mexico)');
    assert.equal(isFemaleVoice(chosen), false);
  });

});
