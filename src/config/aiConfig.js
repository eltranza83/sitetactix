/**
 * Centralized AI Configuration for SiteTactix (Builder Brain)
 */

export const AI_CONFIG = {
  primaryModel: (typeof process !== 'undefined' && process.env?.GEMINI_MODEL) || 'gemini-3.1-flash-lite',
  reasoningModel: (typeof process !== 'undefined' && process.env?.GEMINI_REASONING_MODEL) || 'gemini-3.5-flash',

  
  retry: {
    maxRetries: 2,
    initialDelayMs: 400,
    backoffFactor: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  },
  
  generation: {
    temperature: 0.3,
    maxOutputTokens: 2048
  },

  preferenceLearning: {
    candidateThreshold: 0.80,
    minObservationsForCandidate: 2,
    explicitConfidence: 1.00,
    maxProactivePromptsPerSession: 1,
    promptCooldownTurns: 6,
    minConfidenceToObserve: 0.40,
    rejectedSuppressionDays: 30
  }
};

export function determineTaskModel(query = '', forceDeepReasoning = false) {
  if (forceDeepReasoning) {
    return AI_CONFIG.reasoningModel;
  }

  const q = String(query).toLowerCase();

  const complexIntentPatterns = [
    /\b(remember|save to memory|keep in mind|make a note|store in memory|forget|update memory|change that (note|preference|memory)|how does .* prefer|what did .* quote)\b/i,
    /\b(and\s+also|and\s+before\s+i\s+forget|and\s+remind\s+me|and\s+save|and\s+tell\s+me|and\s+how\s+much)\b/i,
    /compare\s+(our\s+)?actual\s+spending/i,
    /audit\s+this\s+project/i,
    /identify\s+anything\s+that\s+looks\s+unusual/i,
    /where\s+are\s+we\s+going\s+over/i,
    /compare\s+these\s+(two\s+)?(options|quotes|proposals|contractors)/i,
    /which\s+is\s+better\s+financially/i,
    /analyze\s+(the\s+)?profitability/i,
    /financial\s+risk\s+assessment/i,
    /recommend\s+(a\s+)?strategy/i,
    /forecast\s+completion\s+cost/i
  ];

  const requiresDeepReasoning = complexIntentPatterns.some((pattern) => pattern.test(q));
  return requiresDeepReasoning ? AI_CONFIG.reasoningModel : AI_CONFIG.primaryModel;
}
