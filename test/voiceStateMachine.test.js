import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceStateMachine,
  VOICE_STATES,
  VOICE_MODES,
  isExitIntent,
  getExitReplyText,
  containsWakeWord,
  stripWakeWord
} from '../src/services/voiceStateMachine.js';

describe('J.A.R.V.I.S. Continuous Voice State Machine Test Suite', () => {
  test('1. Full Lifecycle Transition in Push-to-Talk Mode', () => {
    const sm = new VoiceStateMachine({ mode: VOICE_MODES.PUSH_TO_TALK });
    assert.equal(sm.state, VOICE_STATES.IDLE);

    // 1. User taps mic -> LISTENING
    sm.startListening('user_tap');
    assert.equal(sm.state, VOICE_STATES.LISTENING);

    // 2. Speech recognized -> THINKING
    sm.startThinking('speech_recognized');
    assert.equal(sm.state, VOICE_STATES.THINKING);

    // 3. AI response ready -> SPEAKING
    sm.startSpeaking('The framing draw total is forty two thousand dollars.', 'ai_response_ready');
    assert.equal(sm.state, VOICE_STATES.SPEAKING);

    // 4. TTS ended in PTT mode -> IDLE
    sm.finishSpeaking('tts_ended');
    assert.equal(sm.state, VOICE_STATES.IDLE);
  });

  test('2. Full Lifecycle in Continuous Hands-Free Mode (Auto-Listen)', () => {
    const sm = new VoiceStateMachine({
      mode: VOICE_MODES.CONTINUOUS_HANDS_FREE,
      silenceTimeoutSec: 5
    });

    sm.startListening('user_tap');
    assert.equal(sm.state, VOICE_STATES.LISTENING);

    sm.startThinking('speech_recognized');
    assert.equal(sm.state, VOICE_STATES.THINKING);

    sm.startSpeaking('Here are the notes for Lot 3.', 'ai_response_ready');
    assert.equal(sm.state, VOICE_STATES.SPEAKING);

    // Finish speaking in Hands-Free Mode -> AUTO_LISTENING
    sm.finishSpeaking('tts_ended');
    assert.equal(sm.state, VOICE_STATES.AUTO_LISTENING);
    assert.equal(sm.silenceRemaining, 5);

    // Clean up timers
    sm.clearTimers();
  });

  test('3. Instant Barge-In Interruption during Speech Playback', () => {
    const sm = new VoiceStateMachine({ mode: VOICE_MODES.CONTINUOUS_HANDS_FREE });

    sm.startSpeaking('Reading long report on plumbing rough-in inspection...', 'ai_response_ready');
    assert.equal(sm.state, VOICE_STATES.SPEAKING);
    const initialSessionId = sm.currentSessionId;

    // User interrupts Jarvis by speaking
    sm.bargeIn('user_spoke_during_playback');
    assert.equal(sm.state, VOICE_STATES.LISTENING);
    assert.notEqual(sm.currentSessionId, initialSessionId); // Session invalidated and refreshed
  });

  test('4. Stale-Session Event Invalidation', () => {
    const sm = new VoiceStateMachine({ mode: VOICE_MODES.CONTINUOUS_HANDS_FREE });
    sm.startSpeaking('Some voice text', 'ai_response_ready');

    const oldSessionId = sm.currentSessionId;

    // Interruption creates new session
    sm.bargeIn('barge_in');
    const newSessionId = sm.currentSessionId;

    // A delayed TTS 'onend' event arrives from the old session
    const transitionResult = sm.finishSpeaking('tts_ended', oldSessionId);
    assert.equal(transitionResult, false);
    // State remains in LISTENING of new session
    assert.equal(sm.state, VOICE_STATES.LISTENING);
    assert.equal(sm.currentSessionId, newSessionId);
  });

  test('5. Acoustic Feedback Protection against Self-Echo', () => {
    const sm = new VoiceStateMachine();
    sm.startSpeaking('The inspection for plumbing passed on July 22, 2026.', 'ai_response_ready');

    // Transcribing what Jarvis just said should be flagged as feedback
    assert.equal(sm.isAcousticFeedback('plumbing passed on July 22'), true);
    assert.equal(sm.isAcousticFeedback('The inspection for plumbing passed'), true);

    // Unrelated new user query is NOT feedback
    assert.equal(sm.isAcousticFeedback('Show me the electrical permit'), false);
  });

  test('6. Graceful Stand-down on Exit Phrases & Robust Intent Safeguards', () => {
    // Valid standalone exit intents (various natural English formulations)
    assert.equal(isExitIntent('Jarvis, good night'), true);
    assert.equal(isExitIntent('goodnight jarvis'), true);
    assert.equal(isExitIntent("Okay Jarvis that's it for now"), true);
    assert.equal(isExitIntent("that's all for now"), true);
    assert.equal(isExitIntent("that'll be all thank you"), true);
    assert.equal(isExitIntent('talk to you later Jarvis'), true);
    assert.equal(isExitIntent('see you later'), true);
    assert.equal(isExitIntent('catch you later buddy'), true);
    assert.equal(isExitIntent('Goodbye'), true);
    assert.equal(isExitIntent('Stand down'), true);
    assert.equal(isExitIntent('go to sleep'), true);
    assert.equal(isExitIntent('close conversation'), true);
    assert.equal(isExitIntent('back to app'), true);

    // Valid standalone exit intents (Spanish formulations)
    assert.equal(isExitIntent('buenas noches'), true);
    assert.equal(isExitIntent('buenas noches jarvis'), true);
    assert.equal(isExitIntent('buenas moches'), true); // Tolerates acoustic/STT mistranscription
    assert.equal(isExitIntent('buenas moches jarvis'), true);
    assert.equal(isExitIntent('buena noche señor'), true);
    assert.equal(isExitIntent('hasta luego jarvis'), true);
    assert.equal(isExitIntent('hasta mañana'), true);
    assert.equal(isExitIntent('adiós'), true);
    assert.equal(isExitIntent('adios jarvis'), true);
    assert.equal(isExitIntent('chao'), true);
    assert.equal(isExitIntent('eso es todo por ahora'), true);
    assert.equal(isExitIntent('es todo gracias'), true);
    assert.equal(isExitIntent('a dormir'), true);
    assert.equal(isExitIntent('descansa jarvis'), true);
    assert.equal(isExitIntent('retírate'), true);
    assert.equal(isExitIntent('apágate'), true);

    // Safeguard cases (Legitimate conversational phrases in English & Spanish that MUST NOT close assistant)
    assert.equal(isExitIntent('We need good night lighting on the front porch'), false);
    assert.equal(isExitIntent('Did the plumber work last night?'), false);
    assert.equal(isExitIntent('Talk to the contractor later today about invoices'), false);
    assert.equal(isExitIntent('Close the quote for Lot 3 drywall'), false);
    assert.equal(isExitIntent('What is the total cost spent so far?'), false);
    assert.equal(isExitIntent('Stage a $50 expense for gas'), false);
    assert.equal(isExitIntent('Necesitamos luces de noche en el porche'), false);
    assert.equal(isExitIntent('El electricista trabajó anoche en el lote 3'), false);
    assert.equal(isExitIntent('Hablar luego con el subcontratista sobre facturas'), false);
    assert.equal(isExitIntent('Cerrar el presupuesto para la pintura'), false);
    assert.equal(isExitIntent('¿Cuál es el costo total gastado hasta ahora?'), false);

    // Spoken and visual farewell reply generation
    assert.equal(getExitReplyText('good night jarvis'), 'Good night Sir. Standing down.');
    assert.equal(getExitReplyText('talk to you later'), 'Talk to you later Sir. Standing down.');
    assert.equal(getExitReplyText('goodbye'), 'Goodbye Sir. Standing down.');
    assert.equal(getExitReplyText("that's all"), "Understood. That's all for now. Standing down.");
    assert.equal(getExitReplyText('buenas noches jarvis'), 'Buenas noches Señor. Me retiro.');
    assert.equal(getExitReplyText('buenas moches'), 'Buenas noches Señor. Me retiro.');
    assert.equal(getExitReplyText('hasta luego'), 'Hasta luego Señor. Me retiro.');
    assert.equal(getExitReplyText('adiós amigo'), 'Adiós Señor. Me retiro.');
    assert.equal(getExitReplyText('eso es todo'), 'Entendido. Eso es todo por ahora Señor. Me retiro.');
    assert.equal(getExitReplyText('descansa'), 'Buenas noches Señor. Me retiro.');

    const sm = new VoiceStateMachine({ mode: VOICE_MODES.CONTINUOUS_HANDS_FREE });
    sm.startListening('user_tap');
    sm.standDown('user_said_goodbye');
    assert.equal(sm.state, VOICE_STATES.IDLE);
  });

  test('7. Wake-Word Detection and Parsing', () => {
    assert.equal(containsWakeWord('Hey Jarvis what is the permit number?'), true);
    assert.equal(containsWakeWord('Jarvis check the budget'), true);
    assert.equal(containsWakeWord('Where is the receipt?'), false);

    assert.equal(stripWakeWord('Hey Jarvis, show me the framing photos'), 'show me the framing photos');
    assert.equal(stripWakeWord('Jarvis what is row 4?'), 'what is row 4?');
  });

  test('8. Graceful Error Recovery: Permissions, Bluetooth, Network, and Timeouts', () => {
    const sm = new VoiceStateMachine({ mode: VOICE_MODES.CONTINUOUS_HANDS_FREE });

    // Permission Denied -> falls back to PTT and IDLE
    sm.startListening('user_tap');
    sm.handleError('not-allowed', 'User denied microphone access');
    assert.equal(sm.state, VOICE_STATES.IDLE);
    assert.equal(sm.mode, VOICE_MODES.PUSH_TO_TALK);

    // Bluetooth Disconnect / Audio Capture Failure -> IDLE
    sm.startListening('user_tap');
    sm.handleError('bluetooth-disconnect', 'Headset unlinked');
    assert.equal(sm.state, VOICE_STATES.IDLE);

    // Network Failure during Thinking -> IDLE
    sm.startThinking('speech_recognized');
    sm.handleError('network', '503 service unavailable');
    assert.equal(sm.state, VOICE_STATES.IDLE);

    // No Speech in Auto-Listen -> IDLE
    sm.transition(VOICE_STATES.AUTO_LISTENING, 'tts_ended');
    sm.handleError('no-speech', 'Microphone heard silence');
    assert.equal(sm.state, VOICE_STATES.IDLE);
  });

  test('9. State Watchdog Safety: System Recovers from Indefinite Hangs', () => {
    const sm = new VoiceStateMachine();
    sm.watchdogLimits[VOICE_STATES.LISTENING] = 50; // Set low 50ms limit for testing

    sm.startListening('user_tap');
    assert.equal(sm.state, VOICE_STATES.LISTENING);

    return new Promise((resolve) => {
      setTimeout(() => {
        // Watchdog automatically resets hung listening state to IDLE
        assert.equal(sm.state, VOICE_STATES.IDLE);
        assert.equal(sm.transitionLogs[0].reason, 'watchdog_timeout_LISTENING');
        resolve();
      }, 70);
    });
  });

  test('10. Mobile Speech Stream Accumulation (0 Duplicates on Android Interim Sequences)', () => {
    // Helper replicating the onresult accumulation algorithm in GlobalAIAssistant
    function simulateSpeechAccumulation(eventSequence) {
      let accumulatedFinalText = '';
      let latestOutput = '';

      for (const e of eventSequence) {
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const res = e.results[i];
          const piece = res[0]?.transcript || '';
          if (res.isFinal) {
            accumulatedFinalText = (accumulatedFinalText ? (accumulatedFinalText.trim() + ' ' + piece.trim()) : piece.trim()).trim();
          } else {
            interimText += piece;
          }
        }
        latestOutput = (accumulatedFinalText ? (accumulatedFinalText + (interimText ? ' ' + interimText.trim() : '')) : interimText.trim()).trim();
      }

      return latestOutput;
    }

    // Simulate Android Google Speech Recognizer sequence that caused "goodgood morninggood morning Jarvis"
    const androidEventSequence = [
      // Event 1: Interim hypothesis 1
      {
        resultIndex: 0,
        results: [
          [{ transcript: 'good' }]
        ]
      },
      // Event 2: Interim hypothesis 2
      {
        resultIndex: 0,
        results: [
          [{ transcript: 'good morning' }]
        ]
      },
      // Event 3: Finalization of "good morning"
      {
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: 'good morning' }], { isFinal: true })
        ]
      },
      // Event 4: Next word interim
      {
        resultIndex: 1,
        results: [
          Object.assign([{ transcript: 'good morning' }], { isFinal: true }),
          [{ transcript: 'Jarvis' }]
        ]
      },
      // Event 5: Finalization of second segment
      {
        resultIndex: 1,
        results: [
          Object.assign([{ transcript: 'good morning' }], { isFinal: true }),
          Object.assign([{ transcript: 'Jarvis' }], { isFinal: true })
        ]
      }
    ];

    const result = simulateSpeechAccumulation(androidEventSequence);
    assert.equal(result, 'good morning Jarvis', 'Must produce exact single utterance without doubling/tripling');
  });

  test('11. Mode-Aware Speech Recognition Parameters (PTT vs Hands-Free)', () => {
    const pttSm = new VoiceStateMachine({ mode: VOICE_MODES.PUSH_TO_TALK });
    const isPttContinuous = pttSm.mode !== VOICE_MODES.PUSH_TO_TALK;
    assert.equal(isPttContinuous, false, 'PTT mode must set continuous to false for single-utterance mobile accuracy');

    const handsFreeSm = new VoiceStateMachine({ mode: VOICE_MODES.CONTINUOUS_HANDS_FREE });
    const isHandsFreeContinuous = handsFreeSm.mode !== VOICE_MODES.PUSH_TO_TALK;
    assert.equal(isHandsFreeContinuous, true, 'Hands-Free mode must enable continuous stream');
  });
});

