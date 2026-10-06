import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTranscriptAccumulator } from '../src/services/speechTranscript.js';

function feed(pieces) {
  const acc = createTranscriptAccumulator();
  for (const p of pieces) acc.addFinal(p);
  return acc.getText();
}

describe('v1.4.7 voice input: growing phrases do not repeat', () => {
  test('Android pattern: every growing update marked final (owner screenshot 1)', () => {
    const pieces = [
      'do', 'do we', 'do we have', 'do we have', 'do we have a',
      'do we have a balance', 'do we have a balance with', 'do we have a balance with the',
      'do we have a balance with the electrician'
    ];
    assert.equal(feed(pieces), 'do we have a balance with the electrician');
  });

  test('Android pattern with the wake word and repeated updates (owner screenshot 2)', () => {
    const pieces = [
      'Jarvis', 'Jarvis do we', 'Jarvis do we', 'Jarvis do we or the electrician',
      'Jarvis do we or the electrician any', 'Jarvis do we or the electrician any money',
      'Jarvis do we or the electrician any money do we have a balance with them'
    ];
    assert.equal(feed(pieces), 'Jarvis do we or the electrician any money do we have a balance with them');
  });

  test('growth in the middle of a word', () => {
    assert.equal(feed(['show me the elec', 'show me the electrician']), 'show me the electrician');
  });

  test('identical and older (shorter) updates are ignored', () => {
    assert.equal(feed(['how much do we owe', 'how much do we owe the plumber', 'how much do we owe', 'how much do we owe the plumber']),
      'how much do we owe the plumber');
  });

  test('genuinely separate phrases are still joined (desktop behavior)', () => {
    assert.equal(feed(['how much do we owe the plumber', 'and what did the electrician quote']),
      'how much do we owe the plumber and what did the electrician quote');
  });

  test('a new phrase can itself grow without repeating', () => {
    assert.equal(feed(['how much do we owe the plumber', 'and', 'and the', 'and the electrician']),
      'how much do we owe the plumber and the electrician');
  });

  test('punctuation and accents do not break matching (Spanish)', () => {
    assert.equal(feed(['¿Cuánto le debemos', '¿Cuánto le debemos al electricista?']), '¿Cuánto le debemos al electricista?');
  });

  test('interim text that extends the final text replaces it in the preview', () => {
    const acc = createTranscriptAccumulator();
    acc.addFinal('do we have');
    assert.equal(acc.previewWith('do we have a balance'), 'do we have a balance');
    assert.equal(acc.getText(), 'do we have'); // preview does not change the state
  });

  test('interim text that is new is appended in the preview', () => {
    const acc = createTranscriptAccumulator();
    acc.addFinal('how much do we owe the plumber');
    assert.equal(acc.previewWith('and the electrician'), 'how much do we owe the plumber and the electrician');
  });

  test('empty pieces are ignored and reset clears everything', () => {
    const acc = createTranscriptAccumulator();
    acc.addFinal('   ');
    acc.addFinal('');
    assert.equal(acc.getText(), '');
    acc.addFinal('hello there');
    acc.reset();
    assert.equal(acc.getText(), '');
    assert.equal(acc.previewWith(''), '');
  });

  test('the assistant uses the accumulator instead of appending raw pieces', () => {
    const src = readFileSync(new URL('../src/components/GlobalAIAssistant.jsx', import.meta.url), 'utf8');
    assert.match(src, /finalTranscript\.addFinal\(piece\)/);
    assert.match(src, /finalTranscript\.previewWith\(interimText\)/);
    assert.doesNotMatch(src, /accumulatedFinalText/);
  });
});
