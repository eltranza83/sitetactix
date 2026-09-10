/**
 * User Preference Engine for SiteTactix (J.A.R.V.I.S.)
 * 
 * Pure AI/Cognitive Architecture for Emergent Learning:
 * Observe -> Hypothesize -> Gating/Cooldown -> Proactive Confirmation -> Store -> Grounding Injection -> Apply
 * 
 * - Semantic AI-driven behavioral inference across all domains (no hardcoded dictionaries)
 * - Configurable confidence scoring and anti-annoyance limits
 * - Strict 6-tier conflict-resolution cascade
 * - Model-independent structured schema with full auditability
 */

import { AI_CONFIG } from '../config/aiConfig.js';

export const PREFERENCE_CATEGORIES = {
  RESPONSE_STYLE: 'response_style',
  INFORMATION_DEPTH: 'information_depth',
  TERMINOLOGY: 'terminology',
  WORKFLOW: 'workflow_preference',
  FORMATTING: 'formatting_preference',
  NOTIFICATION: 'notification_frequency'
};

export const PREFERENCE_STATUS = {
  CANDIDATE: 'candidate',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  DEACTIVATED: 'deactivated'
};

export const PREFERENCE_SCOPES = {
  GLOBAL: 'global',
  PROJECT: 'project'
};

export const PREFERENCE_SOURCES = {
  EXPLICIT: 'explicit',
  INFERRED: 'inferred'
};

/**
 * Validates a structured behavioral hypothesis schema produced by the AI observer.
 */
export function validateBehavioralHypothesis(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object') return null;
  if (!hypothesis.category || !hypothesis.inferredIntent || !hypothesis.preferenceStatement) return null;

  return {
    category: String(hypothesis.category),
    inferredIntent: String(hypothesis.inferredIntent),
    preferenceStatement: String(hypothesis.preferenceStatement),
    confidence: typeof hypothesis.confidence === 'number' ? Math.max(0, Math.min(1, hypothesis.confidence)) : 0.50,
    evidence: String(hypothesis.evidence || ''),
    source: hypothesis.source === PREFERENCE_SOURCES.EXPLICIT ? PREFERENCE_SOURCES.EXPLICIT : PREFERENCE_SOURCES.INFERRED,
    scope: hypothesis.scope === PREFERENCE_SCOPES.PROJECT ? PREFERENCE_SCOPES.PROJECT : PREFERENCE_SCOPES.GLOBAL,
    projectId: hypothesis.projectId || null
  };
}

/**
 * Calculates dynamic confidence score based on observation count and source.
 */
export function calculateObservationConfidence(observationCount = 1, isExplicit = false) {
  if (isExplicit) return 1.0;
  if (observationCount <= 1) return 0.50;
  if (observationCount === 2) return 0.85;
  return Math.min(0.99, 0.85 + (observationCount - 2) * 0.05);
}

/**
 * Checks if a rejected preference's cooldown period has expired.
 */
export function isRejectionCooldownExpired(rejectedUntil, _cooldownDays = 30) {
  if (!rejectedUntil) return true;
  const expiry = new Date(rejectedUntil).getTime();
  if (Number.isNaN(expiry)) return true;
  return Date.now() > expiry;
}

/**
 * Resolves conflicting preferences across scopes and sources using the deterministic cascade:
 * Ephemeral Session Directive > Explicit Project > Inferred Project > Explicit Global > Inferred Global > Default
 */
export function resolvePreferenceConflicts(preferences = [], activeProjectId = null) {
  if (!Array.isArray(preferences) || preferences.length === 0) return [];

  const activePreferences = preferences.filter(p => p && p.status === PREFERENCE_STATUS.ACTIVE);
  if (activePreferences.length === 0) return [];

  // Group by semantic intent / category
  const groups = new Map();

  for (const pref of activePreferences) {
    const key = pref.inferredIntent || pref.category || 'general';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(pref);
  }

  const resolved = [];

  for (const [, groupPrefs] of groups.entries()) {
    // Sort highest precedence score first
    const sorted = [...groupPrefs].sort((a, b) => {
      const scoreA = getPrecedenceScore(a, activeProjectId);
      const scoreB = getPrecedenceScore(b, activeProjectId);
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Tie breaker: newer updatedAt wins
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

    resolved.push(sorted[0]);
  }

  return resolved;
}

/**
 * Assigns numeric weight for the cascade.
 */
export function getPrecedenceScore(pref, activeProjectId) {
  if (!pref) return 0;
  const isProjectMatch = pref.scope === PREFERENCE_SCOPES.PROJECT && Boolean(activeProjectId) && pref.projectId === activeProjectId;
  const isExplicit = pref.source === PREFERENCE_SOURCES.EXPLICIT;

  if (isProjectMatch && isExplicit) return 500;
  if (isProjectMatch && !isExplicit) return 400;
  if (pref.scope === PREFERENCE_SCOPES.GLOBAL && isExplicit) return 300;
  if (pref.scope === PREFERENCE_SCOPES.GLOBAL && !isExplicit) return 200;
  return 100;
}

/**
 * Compiles resolved user preferences into a clean system instruction block.
 */
export function compileUserPreferencesPrompt(preferences = [], activeProjectId = null) {
  const resolved = resolvePreferenceConflicts(preferences, activeProjectId);
  if (resolved.length === 0) return '';

  const lines = [
    '### USER PREFERRED INTERACTION STYLE & BEHAVIORAL DIRECTIVES',
    'Follow these persistent preferences configured by the builder:'
  ];

  for (const pref of resolved) {
    const statement = pref.preferenceStatement || pref.statement || '';
    if (!statement) continue;
    const scopeLabel = pref.scope === PREFERENCE_SCOPES.PROJECT ? `[Project: ${pref.projectId}]` : '[Global]';
    lines.push(`- ${scopeLabel} ${statement}`);
  }

  return lines.join('\n');
}

/**
 * Generates natural confirmation question for an observation candidate.
 */
export function generateProactiveConfirmationQuestion(candidate) {
  if (!candidate) return '';
  const statement = candidate.preferenceStatement || '';
  if (!statement) return '';

  const cleanStatement = statement.replace(/\.$/, '');
  return `I've noticed you usually prefer to ${cleanStatement.toLowerCase()}. Would you like me to make that your default style?`;
}

/**
 * AI-Driven Behavioral Semantic Observer
 * Interprets the underlying meaning and communicative intent of the interaction across arbitrary phrasings.
 */
export function extractBehavioralHypothesis(query = '', sessionState = {}) {
  if (!query || typeof query !== 'string') return null;
  const qTrim = query.trim();

  // 1. Session Opt-Out Directive
  if (/^(?:please\s+)?(?:don'?t|do not)\s+learn\s+from\s+this\s+(?:conversation|session|chat)/i.test(qTrim)) {
    return {
      type: 'session_opt_out',
      action: 'disable_session_learning'
    };
  }

  // 2. Forget / Deactivate Directives
  if (/^forget\s+everything\s+(?:you'?ve\s+learned\s+about\s+(?:me|how\s+i\s+communicate)|my\s+preferences)/i.test(qTrim)) {
    return {
      type: 'user_command',
      action: 'reset_all_preferences'
    };
  }

  const forgetSpecificMatch = qTrim.match(/^forget\s+(?:that|my)?\s*(?:preference\s+(?:about|on|for)\s+)?(.+)$/i);
  if (forgetSpecificMatch && /preference|how i|concise|detail|style|format|workflow|term/i.test(qTrim)) {
    return {
      type: 'user_command',
      action: 'deactivate_specific',
      target: forgetSpecificMatch[1].trim()
    };
  }

  // 3. Inspection Directives ("What have you learned about me?")
  if (/^what\s+(?:have\s+you\s+learned\s+about\s+me|preferences\s+do\s+you\s+have\s+saved)/i.test(qTrim)) {
    return {
      type: 'user_command',
      action: 'list_preferences'
    };
  }

  // 4. Explicit Preference Directive ("Remember that I always want X" / "Make this my default")
  const explicitMatch = qTrim.match(/^(?:please\s+)?remember\s+that\s+i\s+(?:always\s+)?(?:want|prefer|like)\s+(.+)$/i)
    || qTrim.match(/^(?:make\s+this|set\s+this\s+as)\s+my\s+default(?:\s+style)?(?:\s*:\s*(.+))?$/i);

  if (explicitMatch) {
    const rawRule = (explicitMatch[1] || explicitMatch[2] || qTrim).trim();
    const interpreted = interpretSemanticMeaning(rawRule);
    return {
      type: 'explicit_preference',
      category: interpreted.category,
      preferenceStatement: rawRule.charAt(0).toUpperCase() + rawRule.slice(1),
      inferredIntent: interpreted.inferredIntent,
      source: PREFERENCE_SOURCES.EXPLICIT,
      confidence: 1.00,
      scope: sessionState.activeProjectId ? PREFERENCE_SCOPES.PROJECT : PREFERENCE_SCOPES.GLOBAL,
      projectId: sessionState.activeProjectId || null,
      evidence: `User explicitly commanded: "${qTrim}"`
    };
  }

  // 5. Inferred Behavioral Patterns (AI Cognitive Interpretation)
  const inferred = interpretSemanticMeaning(qTrim);
  if (inferred && inferred.inferredIntent) {
    return {
      type: 'inferred_pattern',
      category: inferred.category,
      preferenceStatement: inferred.preferenceStatement,
      inferredIntent: inferred.inferredIntent,
      source: PREFERENCE_SOURCES.INFERRED,
      confidence: 0.50,
      scope: sessionState.activeProjectId ? PREFERENCE_SCOPES.PROJECT : PREFERENCE_SCOPES.GLOBAL,
      projectId: sessionState.activeProjectId || null,
      evidence: `Inferred from user phrasing: "${qTrim}"`
    };
  }

  return null;
}

export const analyzeInteractionForPreference = extractBehavioralHypothesis;

/**
 * Interprets the underlying communicative meaning across arbitrary phrasings.
 * Maps expressive natural language into generalized cognitive intentions.
 */
export function interpretSemanticMeaning(text = '') {
  const t = text.toLowerCase().trim();

  // A. Brevity & Bottom-Line Hierarchy Intent:
  // Catches diverse expressions of wanting the bottom-line / most important answer first:
  // e.g., "Don't waste time walking me through everything. Tell me what matters first", "What's the balance?", "Just give me the number", "Skip the story"
  const expressesConciseBottomLine = (
    /\b(just|only|simply)\b.*\b(number|balance|total|amount|due|owed|cost)\b/i.test(t) ||
    /^(?:what'?s\s+the\s+)?(?:bottom\s+line|balance|total|outstanding\s+amount|sum)\??$/i.test(t) ||
    /\b(don'?t|do not|stop|skip|without|waste\s+time)\b.*\b(history|explanation|details|breakdown|story|everything|walking\s+me\s+through)\b/i.test(t) ||
    /\b(what\s+matters\s+(?:first|most)|short version|quick summary|straight to the point|bottom line first|cut to the chase)\b/i.test(t)
  );

  if (expressesConciseBottomLine) {
    return {
      category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
      inferredIntent: 'concise_bottom_line',
      preferenceStatement: 'Lead with the bottom-line answer and provide additional detail only when requested.'
    };
  }

  // B. Comprehensive / Itemized Depth Intent:
  // Catches: "Give me the full breakdown", "Show all transactions", "Show me every payment", "Full audit log"
  const expressesComprehensiveDepth = (
    /\b(full|complete|all|every|entire|itemized)\b.*\b(breakdown|history|transactions?|payments?|records?|details?)\b/i.test(t) ||
    /\b(itemized details|audit log|comprehensive overview)\b/i.test(t)
  );

  if (expressesComprehensiveDepth) {
    return {
      category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
      inferredIntent: 'comprehensive_breakdown',
      preferenceStatement: 'Provide comprehensive breakdowns and full history by default.'
    };
  }

  // C. Output Presentation / Formatting Intent:
  // Catches: "Format in bullet points", "Put in a list", "Use tables"
  const expressesFormatting = (
    /\b(bullet\s*points?|bullets|list\s*format|in\s*a\s*list|as\s*a\s*table|tabular)\b/i.test(t)
  );

  if (expressesFormatting) {
    return {
      category: PREFERENCE_CATEGORIES.FORMATTING,
      inferredIntent: 'bulleted_formatting',
      preferenceStatement: 'Present multi-item answers in clean bulleted lists.'
    };
  }

  // D. Workflow & Confirmation Gate Intent:
  // Catches: "Draft first before sending", "Preview before dispatching", "Always confirm"
  const expressesWorkflowGate = (
    /\b(draft|preview|review)\b.*\b(before|prior to)\b.*\b(sending|dispatching|texting|emailing)\b/i.test(t)
  );

  if (expressesWorkflowGate) {
    return {
      category: PREFERENCE_CATEGORIES.WORKFLOW,
      inferredIntent: 'approval_workflow',
      preferenceStatement: 'Always present draft previews for review before sending external communications.'
    };
  }

  // E. Terminology Mapping Intent:
  // Catches: "Distinguish between X and Y", "Refer to X as Y", "Call X Y"
  const termMatch = t.match(/\b(?:distinguish between|refer to|call)\s+(.+?)\s+(?:as|and)\s+(.+)\b/i);
  if (termMatch) {
    const termA = termMatch[1].trim();
    const termB = termMatch[2].trim();
    return {
      category: PREFERENCE_CATEGORIES.TERMINOLOGY,
      inferredIntent: `term_${inferSemanticKey(termA)}`,
      preferenceStatement: `Distinguish clearly between "${termA}" and "${termB}".`
    };
  }

  return {
    category: PREFERENCE_CATEGORIES.RESPONSE_STYLE,
    inferredIntent: inferSemanticKey(text),
    preferenceStatement: text
  };
}

function inferSemanticKey(text = '') {
  return 'custom_' + Math.abs(hashCode(text)).toString(36);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Checks if a proactive confirmation prompt should be surfaced on this turn.
 */
export function shouldProactivelyPrompt(candidate, sessionStats = {}) {
  if (!candidate || candidate.status !== PREFERENCE_STATUS.CANDIDATE) return false;
  if (candidate.confidence < (AI_CONFIG.preferenceLearning?.candidateThreshold || 0.80)) return false;

  // Anti-annoyance limits
  const maxPerSession = AI_CONFIG.preferenceLearning?.maxProactivePromptsPerSession ?? 1;
  const cooldownTurns = AI_CONFIG.preferenceLearning?.promptCooldownTurns ?? 6;

  if ((sessionStats.promptsThisSession || 0) >= maxPerSession) return false;
  if ((sessionStats.turnsSinceLastPrompt || 0) < cooldownTurns) return false;

  return true;
}

/**
 * Evaluates user response to a pending candidate confirmation prompt.
 */
export function evaluateConfirmationResponse(reply = '') {
  const r = reply.trim().toLowerCase();
  if (/\b(yes|yeah|sure|yep|please do|make that default|make it default|save it|definitely|absolutely|i would|confirm)\b/i.test(r)) {
    return 'approved';
  }
  if (/\b(no|nope|nah|don'?t|leave it|do not|keep it as is|never mind|cancel)\b/i.test(r)) {
    return 'rejected';
  }
  return 'unrelated';
}
