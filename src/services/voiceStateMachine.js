/**
 * J.A.R.V.I.S. Continuous Voice State Machine & Session Engine (v1.0)
 * 
 * Provides deterministic client-side voice management:
 * - States: IDLE -> LISTENING -> THINKING -> SPEAKING -> AUTO_LISTENING -> IDLE
 * - Stale-event rejection via unique Session IDs
 * - Instant Barge-In interruption (cancels TTS, invalidates session, opens fresh mic)
 * - Acoustic feedback protection (suppresses mic during TTS)
 * - Watchdog safety timers (prevents getting stuck in any state)
 * - Graceful recovery from permission loss, network drops, and Bluetooth disconnects
 */

export const VOICE_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  AUTO_LISTENING: 'AUTO_LISTENING',
  ERROR: 'ERROR'
};

export const VOICE_MODES = {
  PUSH_TO_TALK: 'PUSH_TO_TALK',
  CONTINUOUS_HANDS_FREE: 'CONTINUOUS_HANDS_FREE'
};

export const EXIT_PHRASES = [
  'thank you',
  'thanks',
  "that's all",
  'thats all',
  "that's it",
  'thats it',
  "that's it for now",
  'thats it for now',
  "that's all for now",
  'thats all for now',
  'that will be all',
  "that'll be all",
  'goodnight',
  'good night',
  'goodbye',
  'bye',
  'talk to you later',
  'talk later',
  'catch you later',
  'see you later',
  'have a good night',
  'have a good one',
  'have a good day',
  'go to sleep',
  'stand down',
  'stop listening',
  'close conversation',
  'close app',
  'back to app',
  'exit',
  // Spanish exit phrases
  'buenas noches',
  'hasta luego',
  'hasta mañana',
  'hasta manana',
  'hasta pronto',
  'nos vemos',
  'adiós',
  'adios',
  'chao',
  'chau',
  'eso es todo',
  'es todo',
  'ya es todo',
  'eso es todo por hoy',
  'eso es todo por ahora',
  'a dormir',
  'descansa',
  'duérmete',
  'duermete',
  'apágate',
  'apagate',
  'retírate',
  'retirate',
  'detente',
  'deténte',
  'cerrar',
  'cierra',
  'salir'
];

export const WAKE_WORDS = [
  'hey jarvis',
  'jarvis',
  'ok jarvis',
  'okay jarvis'
];

/**
 * Creates a unique session identifier
 */
export function generateSessionId() {
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if text contains a graceful standalone exit intent
 * Safeguards against false positives inside longer queries (e.g. "good night lighting").
 */
export function isExitIntent(text = '') {
  if (!text || typeof text !== 'string') return false;
  let clean = text.toLowerCase().trim();
  
  // Strip quotes and apostrophes first so "that's" becomes "thats", "that'll" becomes "thatll"
  clean = clean.replace(/['’"`]/g, '');

  // Normalize other punctuation to spaces
  clean = clean.replace(/[.,/#!$%^&*;:{}=\-_~()?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  // Maximum word limit for a standalone exit utterance (e.g. max 8 words)
  const words = clean.split(' ').filter(Boolean);
  if (words.length > 8) return false;

  // Strip leading conversational fillers / wake words (up to 3 passes)
  for (let i = 0; i < 3; i++) {
    clean = clean.replace(/^(hey|hi|hello|ok|okay|alright|well|so|cool|great|perfect|thanks|thank you|hola|bueno|oye|vale|gracias|muchas gracias)\s+/, '');
    clean = clean.replace(/^(jarvis)\s+/, '');
  }

  // Strip trailing polite closers / wake words (up to 3 passes)
  for (let i = 0; i < 3; i++) {
    clean = clean.replace(/\s+(jarvis|sir|buddy|man|bro|thanks|thank you|senor|señor|amigo|por favor|gracias|muchas gracias)$/, '');
  }
  clean = clean.trim();

  // Core exit patterns
  const exitPatterns = [
    // English exit patterns
    /^good\s*night(\s+for\s+now)?$/,
    /^goodnight(\s+for\s+now)?$/,
    /^have a (good|great) (night|day|one)$/,
    /^that(s| is)? (all|it)(\s+for\s+now)?$/,
    /^that(ll| will) be all(\s+for\s+now)?$/,
    /^that(s| is) going to be all$/,
    /^talk( to you)? later$/,
    /^(catch|see) (you|ya) later$/,
    /^goodbye$/,
    /^bye(\s*bye)?$/,
    /^stand down$/,
    /^go to sleep$/,
    /^stop listening$/,
    /^(close|exit)(\s+(the\s+)?(conversation|assistant|app|chat))?$/,
    /^back to (\s*the\s*)?app$/,

    // Spanish exit patterns
    /^(que\s+tengas?\s+)?(buenas\s*(noches|moches)|buena\s*noche)(\s+(por\s+hoy|por\s+ahora|amigo|senor|señor|descansa|que\s+descanses))?$/,
    /^hasta\s*(luego|mañana|manana|pronto)$/,
    /^nos\s*vemos(\s+luego|\s+mañana|\s+manana|\s+pronto)?$/,
    /^(adios|adiós|chao|chau)(\s+(amigo|senor|señor))?$/,
    /^(eso\s+es|es|ya\s+es|eso\s+seria|eso\s+sería)\s+(todo|it)(\s+(por\s+hoy|por\s+ahora))?$/,
    /^(todo\s+bien\s+por\s+hoy|nada\s+mas|nada\s+más)$/,
    /^(ve\s+a\s+|a\s+)?(dormir|descansar)$/,
    /^(duermete|duérmete|descansa)$/,
    /^(apagate|apágate|apagar|retirate|retírate|desconectate|desconéctate)$/,
    /^(detente|deténte|deja\s+de\s+escuchar|silencio)$/,
    /^(cierra|cerrar|salir)(\s+(la\s+)?(conversacion|conversación|asistente|app|chat))?$/
  ];

  return exitPatterns.some(pattern => pattern.test(clean));
}

/**
 * Generates an appropriate spoken and visual farewell reply when an exit intent is triggered.
 * Spanish farewell honors user preference: "Buenas noches Señor. Me retiro."
 */
export function getExitReplyText(text = '', isSpanishMode = false) {
  const clean = String(text || '').toLowerCase().trim();
  const isSpanish = isSpanishMode ||
    /[áéíóúüñ¿¡]/i.test(clean) ||
    /\b(buenas|noches|moches|noche|hasta|luego|mañana|manana|pronto|adios|adiós|chao|chau|todo|dormir|descansar|descansa|duermete|duérmete|retirate|retírate|apagate|apágate|gracias|senor|señor|amigo)\b/i.test(clean);

  if (isSpanish) {
    if (clean.includes('noche') || clean.includes('moche') || clean.includes('dormir') || clean.includes('descans') || clean.includes('duerm')) {
      return 'Buenas noches Señor. Me retiro.';
    }
    if (clean.includes('luego') || clean.includes('vemos') || clean.includes('mañana') || clean.includes('manana') || clean.includes('pronto')) {
      return 'Hasta luego Señor. Me retiro.';
    }
    if (clean.includes('adios') || clean.includes('adiós') || clean.includes('chao') || clean.includes('chau')) {
      return 'Adiós Señor. Me retiro.';
    }
    if (clean.includes('todo') || clean.includes('nada')) {
      return 'Entendido. Eso es todo por ahora Señor. Me retiro.';
    }
    return 'Entendido Señor. Me retiro.';
  }

  if (clean.includes('night')) return 'Good night Sir. Standing down.';
  if (clean.includes('later') || clean.includes('catch you') || clean.includes('see you')) return 'Talk to you later Sir. Standing down.';
  if (clean.includes('goodbye') || clean.includes('bye')) return 'Goodbye Sir. Standing down.';
  if (clean.includes('that') && (clean.includes('it') || clean.includes('all'))) return "Understood. That's all for now. Standing down.";
  return 'Understood. Standing down.';
}

/**
 * Check if text contains wake word
 */
export function containsWakeWord(text = '') {
  const clean = String(text).toLowerCase().trim();
  return WAKE_WORDS.some(ww => {
    const regex = new RegExp(`(^|\\b)${ww}(\\b|$)`, 'i');
    return regex.test(clean);
  });
}

/**
 * Strip wake words from recognized query
 */
export function stripWakeWord(text = '') {
  let clean = String(text).trim();
  for (const ww of WAKE_WORDS) {
    const regex = new RegExp(`^${ww}[,\\s]*`, 'i');
    clean = clean.replace(regex, '');
  }
  return clean.trim();
}

/**
 * Voice State Machine Class
 */
export class VoiceStateMachine {
  constructor(config = {}) {
    this.mode = config.mode || VOICE_MODES.CONTINUOUS_HANDS_FREE;
    this.silenceTimeoutSec = config.silenceTimeoutSec || 7;
    this.wakeWordEnabled = Boolean(config.wakeWordEnabled);

    this.state = VOICE_STATES.IDLE;
    this.currentSessionId = generateSessionId();
    this.listeners = new Set();
    this.transitionLogs = [];
    this.activeUtterances = new Set();
    this.lastSpokenText = '';
    this.lastSpokenTimestamp = 0;

    // Watchdog Timers
    this.safetyTimer = null;
    this.silenceCountdownTimer = null;
    this.silenceRemaining = this.silenceTimeoutSec;

    // Maximum safe duration per state before watchdog reset (in ms)
    this.watchdogLimits = {
      [VOICE_STATES.LISTENING]: 45000,   // Max 45s continuous listen
      [VOICE_STATES.THINKING]: 30000,    // Max 30s network timeout
      [VOICE_STATES.SPEAKING]: 60000,    // Max 60s speech synthesis
      [VOICE_STATES.AUTO_LISTENING]: (this.silenceTimeoutSec + 5) * 1000
    };
  }

  /**
   * Subscribe to state machine changes
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
      // Immediately notify current state
      callback(this.getSnapshot());
    }
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit snapshot to all subscribers
   */
  emit() {
    const snapshot = this.getSnapshot();
    for (const callback of this.listeners) {
      try {
        callback(snapshot);
      } catch (err) {
        console.error('VoiceStateMachine subscriber error:', err);
      }
    }
  }

  getSnapshot() {
    return {
      state: this.state,
      mode: this.mode,
      sessionId: this.currentSessionId,
      silenceRemaining: this.silenceRemaining,
      silenceTimeoutSec: this.silenceTimeoutSec,
      wakeWordEnabled: this.wakeWordEnabled,
      lastTransition: this.transitionLogs[0] || null
    };
  }

  /**
   * Update configuration dynamically
   */
  updateConfig({ mode, silenceTimeoutSec, wakeWordEnabled }) {
    if (mode && Object.values(VOICE_MODES).includes(mode)) {
      this.mode = mode;
    }
    if (typeof silenceTimeoutSec === 'number' && silenceTimeoutSec >= 3 && silenceTimeoutSec <= 30) {
      this.silenceTimeoutSec = silenceTimeoutSec;
      this.watchdogLimits[VOICE_STATES.AUTO_LISTENING] = (silenceTimeoutSec + 5) * 1000;
    }
    if (typeof wakeWordEnabled === 'boolean') {
      this.wakeWordEnabled = wakeWordEnabled;
    }
    this.emit();
  }

  /**
   * Transition to new state with session validation and logging
   */
  transition(toState, reason = 'standard_flow', sessionId = this.currentSessionId) {
    // Stale session check: If a specific sessionId was passed and doesn't match current, ignore
    if (sessionId && sessionId !== this.currentSessionId) {
      console.warn(`[VoiceStateMachine] Rejected stale transition to ${toState} for old session ${sessionId}`);
      return false;
    }

    const fromState = this.state;
    if (fromState === toState && toState !== VOICE_STATES.AUTO_LISTENING) {
      return true; // No-op for identical state
    }

    // Clear any active watchdog or countdown timers from previous state
    this.clearTimers();

    this.state = toState;
    const logEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      fromState,
      toState,
      reason,
      mode: this.mode
    };

    this.transitionLogs.unshift(logEntry);
    if (this.transitionLogs.length > 50) {
      this.transitionLogs.pop();
    }

    // Arm state-specific watchdogs and handlers
    this.setupStateWatchdogs(toState);

    this.emit();
    return true;
  }

  /**
   * Arm Watchdogs so system NEVER gets stuck in LISTENING, THINKING, or SPEAKING
   */
  setupStateWatchdogs(state) {
    const limit = this.watchdogLimits[state];
    if (limit && state !== VOICE_STATES.IDLE) {
      this.safetyTimer = setTimeout(() => {
        console.warn(`[VoiceStateMachine] Watchdog timeout in state: ${state}. Resetting to safe IDLE state.`);
        this.transition(VOICE_STATES.IDLE, `watchdog_timeout_${state}`);
      }, limit);
      if (this.safetyTimer?.unref) {
        this.safetyTimer.unref();
      }
    }

    // Auto-Listening Silence Countdown Timer
    if (state === VOICE_STATES.AUTO_LISTENING) {
      this.silenceRemaining = this.silenceTimeoutSec;
      this.silenceCountdownTimer = setInterval(() => {
        this.silenceRemaining -= 1;
        if (this.silenceRemaining <= 0) {
          clearInterval(this.silenceCountdownTimer);
          this.silenceCountdownTimer = null;
          this.transition(VOICE_STATES.IDLE, 'silence_timeout_expired');
        } else {
          this.emit();
        }
      }, 1000);
      if (this.silenceCountdownTimer?.unref) {
        this.silenceCountdownTimer.unref();
      }
    }
  }


  clearTimers() {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (this.silenceCountdownTimer) {
      clearInterval(this.silenceCountdownTimer);
      this.silenceCountdownTimer = null;
    }
  }

  /**
   * Instant Barge-In / Interruption:
   * Stops TTS immediately, invalidates old session, increments session ID, and enters LISTENING.
   */
  bargeIn(reason = 'user_interruption') {
    // 1. Invalidate current session
    this.currentSessionId = generateSessionId();

    // 2. Cancel native speech synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    // 3. Transition to listening
    return this.transition(VOICE_STATES.LISTENING, `barge_in_${reason}`);
  }

  /**
   * Start a new user-initiated voice turn (Tap or Wake-Word)
   */
  startListening(reason = 'user_tap') {
    this.currentSessionId = generateSessionId();
    return this.transition(VOICE_STATES.LISTENING, reason);
  }

  /**
   * Finished speaking question, awaiting AI reasoning
   */
  startThinking(reason = 'speech_recognized') {
    return this.transition(VOICE_STATES.THINKING, reason);
  }

  /**
   * Started reading answer via TTS
   */
  startSpeaking(text = '', reason = 'ai_response_ready') {
    this.lastSpokenText = text;
    this.lastSpokenTimestamp = Date.now();
    return this.transition(VOICE_STATES.SPEAKING, reason);
  }

  /**
   * Completed TTS playback -> decide whether to auto-listen or go to IDLE
   */
  finishSpeaking(reason = 'tts_ended', sessionId = this.currentSessionId) {
    if (sessionId !== this.currentSessionId) {
      return false; // Ignore stale TTS end events
    }

    if (this.mode === VOICE_MODES.CONTINUOUS_HANDS_FREE) {
      return this.transition(VOICE_STATES.AUTO_LISTENING, reason);
    } else {
      return this.transition(VOICE_STATES.IDLE, reason);
    }
  }

  /**
   * Graceful Stand-down (User said "Thank you", "Goodbye", or clicked close)
   */
  standDown(reason = 'user_stand_down') {
    this.currentSessionId = generateSessionId();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    return this.transition(VOICE_STATES.IDLE, reason);
  }

  /**
   * Handle Error & Failure Modes Gracefully (Permission loss, Bluetooth drop, Network error)
   */
  handleError(errorType, errorDetails = '', sessionId = this.currentSessionId) {
    if (sessionId && sessionId !== this.currentSessionId) {
      return false;
    }

    console.warn(`[VoiceStateMachine] Error event: ${errorType}`, errorDetails);

    // If permission is denied or audio capture failed, fall back to PTT and IDLE
    if (errorType === 'not-allowed' || errorType === 'permission-denied') {
      this.mode = VOICE_MODES.PUSH_TO_TALK;
      return this.transition(VOICE_STATES.IDLE, 'permission_denied_fallback');
    }

    if (errorType === 'audio-capture' || errorType === 'bluetooth-disconnect') {
      return this.transition(VOICE_STATES.IDLE, 'audio_capture_failure');
    }

    if (errorType === 'network') {
      return this.transition(VOICE_STATES.IDLE, 'network_failure');
    }

    if (errorType === 'no-speech') {
      if (this.mode === VOICE_MODES.CONTINUOUS_HANDS_FREE && this.state === VOICE_STATES.AUTO_LISTENING) {
        return this.transition(VOICE_STATES.IDLE, 'no_speech_timeout');
      }
      return this.transition(VOICE_STATES.IDLE, 'no_speech');
    }

    return this.transition(VOICE_STATES.IDLE, `error_${errorType}`);
  }

  /**
   * Feedback Protection: Determine if transcribed text is just an echo of Jarvis's own TTS output
   */
  isAcousticFeedback(transcript = '') {
    if (!this.lastSpokenText || Date.now() - this.lastSpokenTimestamp > 10000) {
      return false;
    }

    const cleanInput = transcript.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
    const cleanSpoken = this.lastSpokenText.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');

    if (cleanInput.length < 5) return false;

    // Check substring overlap
    return cleanSpoken.includes(cleanInput) || (cleanInput.length > 15 && cleanSpoken.slice(0, 50).includes(cleanInput.slice(0, 30)));
  }

  /**
   * Get transition audit logs for diagnostics
   */
  getTransitionLogs() {
    return [...this.transitionLogs];
  }
}

// Global Singleton Instance for easy reuse across app
let defaultVoiceStateMachineInstance = null;

export function getVoiceStateMachine(config = {}) {
  if (!defaultVoiceStateMachineInstance) {
    defaultVoiceStateMachineInstance = new VoiceStateMachine(config);
  }
  return defaultVoiceStateMachineInstance;
}
