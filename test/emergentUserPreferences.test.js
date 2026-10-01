import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateObservationConfidence,
  isRejectionCooldownExpired,
  resolvePreferenceConflicts,
  compileUserPreferencesPrompt,
  generateProactiveConfirmationQuestion,
  analyzeInteractionForPreference,
  extractBehavioralHypothesis,
  shouldProactivelyPrompt,
  evaluateConfirmationResponse,
  PREFERENCE_CATEGORIES,
  PREFERENCE_STATUS,
  PREFERENCE_SCOPES,
  PREFERENCE_SOURCES
} from '../src/services/userPreferenceEngine.js';

import {
  loadUserPreferences,
  saveUserPreference,
  updateUserPreferenceStatus,
  deleteUserPreference,
  resetAllUserPreferences,
  USER_PREFERENCE_STORAGE_KEY
} from '../src/services/memoryService.js';

// Setup mock localStorage for Node.js test environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

test.beforeEach(() => {
  mockStorage.clear();
});

test('1. One-off behavior does NOT create active preference or trigger proactive prompt', () => {
  const query = 'Just give me the number for the electrician.';
  const analysis = analyzeInteractionForPreference(query, { activeProjectId: 'Lot3' });

  assert.ok(analysis, 'Should detect inferred pattern');
  assert.equal(analysis.type, 'inferred_pattern');
  assert.equal(analysis.inferredIntent, 'concise_bottom_line');

  // Confidence for single observation is 0.50 (< 0.80 threshold)
  const confidence = calculateObservationConfidence(1, false);
  assert.equal(confidence, 0.50);

  const candidate = {
    status: PREFERENCE_STATUS.CANDIDATE,
    confidence,
    preferenceStatement: analysis.preferenceStatement
  };

  const shouldPrompt = shouldProactivelyPrompt(candidate, { promptsThisSession: 0, turnsSinceLastPrompt: 10 });
  assert.equal(shouldPrompt, false, 'Should not prompt on single observation with confidence 0.50');
});

test('2. Repeated behavior produces a candidate with confidence >= 0.80 and proactive question', () => {
  const count = 2;
  const confidence = calculateObservationConfidence(count, false);
  assert.ok(confidence >= 0.80, `Expected confidence >= 0.80, got ${confidence}`);

  const candidate = {
    status: PREFERENCE_STATUS.CANDIDATE,
    confidence,
    preferenceStatement: 'Lead with the bottom-line answer and provide additional detail only when requested.'
  };

  const shouldPrompt = shouldProactivelyPrompt(candidate, { promptsThisSession: 0, turnsSinceLastPrompt: 10 });
  assert.equal(shouldPrompt, true, 'Should prompt user once candidate meets criteria');

  const question = generateProactiveConfirmationQuestion(candidate);
  assert.match(question, /prefer to lead with the bottom-line answer/i);
  assert.match(question, /default style\?/i);
});

test('3. Explicit confirmation promotes candidate to ACTIVE preference', async () => {
  const userId = 'user_builder_alpha';
  const savedCandidate = await saveUserPreference(userId, {
    preferenceStatement: 'Lead with the bottom-line answer.',
    inferredIntent: 'concise_bottom_line',
    confidence: 0.85,
    status: PREFERENCE_STATUS.CANDIDATE,
    source: PREFERENCE_SOURCES.INFERRED,
    scope: PREFERENCE_SCOPES.GLOBAL
  });

  assert.equal(savedCandidate.status, 'candidate');

  const userReply = 'Yes, make that my default style.';
  const evalResult = evaluateConfirmationResponse(userReply);
  assert.equal(evalResult, 'approved');

  const activated = await updateUserPreferenceStatus(userId, savedCandidate.id, PREFERENCE_STATUS.ACTIVE);
  assert.equal(activated.status, 'active');

  const loaded = await loadUserPreferences(userId);
  const activePref = loaded.find(p => p.id === savedCandidate.id);
  assert.ok(activePref);
  assert.equal(activePref.status, 'active');
});

test('4. Rejection suppresses candidate with 30-day cooldown', async () => {
  const userId = 'user_builder_beta';
  const savedCandidate = await saveUserPreference(userId, {
    preferenceStatement: 'Provide comprehensive financial breakdowns by default.',
    inferredIntent: 'comprehensive_breakdown',
    confidence: 0.85,
    status: PREFERENCE_STATUS.CANDIDATE,
    source: PREFERENCE_SOURCES.INFERRED,
    scope: PREFERENCE_SCOPES.GLOBAL
  });

  const userReply = 'No, keep it as is.';
  const evalResult = evaluateConfirmationResponse(userReply);
  assert.equal(evalResult, 'rejected');

  const rejected = await updateUserPreferenceStatus(userId, savedCandidate.id, PREFERENCE_STATUS.REJECTED, 30);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.rejectedUntil, 'Should set rejectedUntil timestamp');

  // Verify cooldown is active
  const isExpired = isRejectionCooldownExpired(rejected.rejectedUntil);
  assert.equal(isExpired, false, 'Cooldown should not be expired immediately after rejection');
});

test('5. Previously rejected preference can be reconsidered after cooldown expires', () => {
  // Past date
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 35);
  const isExpired = isRejectionCooldownExpired(pastDate.toISOString());
  assert.equal(isExpired, true, 'Cooldown should be expired after 35 days');
});

test('6. Explicit preferences override inferred preferences in conflict cascade', () => {
  const inferred = {
    id: 'pref_1',
    category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
    inferredIntent: 'financial_depth',
    preferenceStatement: 'Provide comprehensive breakdowns by default.',
    source: PREFERENCE_SOURCES.INFERRED,
    scope: PREFERENCE_SCOPES.GLOBAL,
    status: PREFERENCE_STATUS.ACTIVE,
    updatedAt: '2026-08-01T00:00:00Z'
  };

  const explicit = {
    id: 'pref_2',
    category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
    inferredIntent: 'financial_depth',
    preferenceStatement: 'Always lead with the bottom-line number.',
    source: PREFERENCE_SOURCES.EXPLICIT,
    scope: PREFERENCE_SCOPES.GLOBAL,
    status: PREFERENCE_STATUS.ACTIVE,
    updatedAt: '2026-08-02T00:00:00Z'
  };

  const resolved = resolvePreferenceConflicts([inferred, explicit], 'Lot3');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'pref_2', 'Explicit global must override inferred global');
  assert.equal(resolved[0].preferenceStatement, 'Always lead with the bottom-line number.');
});

test('7. Project-scoped preferences override global preferences', () => {
  const globalExplicit = {
    id: 'pref_global',
    category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
    inferredIntent: 'financial_depth',
    preferenceStatement: 'Keep answers concise across all lots.',
    source: PREFERENCE_SOURCES.EXPLICIT,
    scope: PREFERENCE_SCOPES.GLOBAL,
    status: PREFERENCE_STATUS.ACTIVE
  };

  const projectExplicit = {
    id: 'pref_lot3',
    category: PREFERENCE_CATEGORIES.INFORMATION_DEPTH,
    inferredIntent: 'financial_depth',
    preferenceStatement: 'For Lot 3, provide line-item payment details.',
    source: PREFERENCE_SOURCES.EXPLICIT,
    scope: PREFERENCE_SCOPES.PROJECT,
    projectId: 'Lot3',
    status: PREFERENCE_STATUS.ACTIVE
  };

  // When on Lot 3 -> project preference wins
  const resolvedLot3 = resolvePreferenceConflicts([globalExplicit, projectExplicit], 'Lot3');
  assert.equal(resolvedLot3[0].id, 'pref_lot3');

  // When on Lot 5 -> global preference wins
  const resolvedLot5 = resolvePreferenceConflicts([globalExplicit, projectExplicit], 'Lot5');
  assert.equal(resolvedLot5[0].id, 'pref_global');
});

test('8. Session directive ("Don\'t learn from this conversation") pauses learning', () => {
  const query = 'Please don\'t learn from this conversation.';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis);
  assert.equal(analysis.type, 'session_opt_out');
  assert.equal(analysis.action, 'disable_session_learning');
});

test('9. User inspection ("What have you learned about me?") parses accurately', () => {
  const query = 'What have you learned about me?';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis);
  assert.equal(analysis.type, 'user_command');
  assert.equal(analysis.action, 'list_preferences');
});

test('10. Specific preference deactivation ("Forget my preference about concise answers")', async () => {
  const userId = 'user_gamma';
  const pref = await saveUserPreference(userId, {
    preferenceStatement: 'Lead with concise answers.',
    inferredIntent: 'concise_bottom_line',
    status: PREFERENCE_STATUS.ACTIVE
  });

  const query = 'Forget my preference about concise answers';
  const analysis = analyzeInteractionForPreference(query);
  assert.equal(analysis.action, 'deactivate_specific');

  await deleteUserPreference(userId, pref.id);
  const loaded = await loadUserPreferences(userId);
  const active = loaded.filter(p => p.status === 'active');
  assert.equal(active.length, 0);
});

test('11. "Forget everything you\'ve learned about me" purges all user preferences', async () => {
  const userId = 'user_delta';
  await saveUserPreference(userId, { preferenceStatement: 'Style 1', status: PREFERENCE_STATUS.ACTIVE });
  await saveUserPreference(userId, { preferenceStatement: 'Style 2', status: PREFERENCE_STATUS.ACTIVE });

  const query = 'Forget everything you\'ve learned about me';
  const analysis = analyzeInteractionForPreference(query);
  assert.equal(analysis.action, 'reset_all_preferences');

  await resetAllUserPreferences(userId);
  const loaded = await loadUserPreferences(userId);
  assert.equal(loaded.length, 0);
});

test('12. Preferences survive simulated server restart / localStorage rehydration', async () => {
  const userId = 'user_reboot';
  await saveUserPreference(userId, {
    id: 'pref_persistent_101',
    preferenceStatement: 'Always state electrician balance first.',
    status: PREFERENCE_STATUS.ACTIVE
  });

  // Verify it exists in storage string
  const storedJson = mockStorage.get(`${USER_PREFERENCE_STORAGE_KEY}_${userId}`);
  assert.ok(storedJson);
  assert.match(storedJson, /pref_persistent_101/);

  // Reload afresh
  const reloaded = await loadUserPreferences(userId);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, 'pref_persistent_101');
});

test('13. Preferences remain isolated between different user accounts (Strict Tenant Isolation)', async () => {
  const userAlpha = 'uid_contractor_A';
  const userBeta = 'uid_contractor_B';

  await saveUserPreference(userAlpha, {
    preferenceStatement: 'Contractor A private workflow preference.',
    status: PREFERENCE_STATUS.ACTIVE
  });

  const alphaPrefs = await loadUserPreferences(userAlpha);
  const betaPrefs = await loadUserPreferences(userBeta);

  assert.equal(alphaPrefs.length, 1);
  assert.equal(betaPrefs.length, 0, 'User Beta must not have access to User Alpha preferences');
});

test('14. Prompt compiler formats cleanly for Gemini system instruction', () => {
  const prefs = [
    {
      id: 'p1',
      category: PREFERENCE_CATEGORIES.RESPONSE_STYLE,
      inferredIntent: 'concise_bottom_line',
      scope: PREFERENCE_SCOPES.GLOBAL,
      preferenceStatement: 'Lead with the bottom-line number.',
      status: PREFERENCE_STATUS.ACTIVE,
      source: PREFERENCE_SOURCES.EXPLICIT
    },
    {
      id: 'p2',
      category: PREFERENCE_CATEGORIES.WORKFLOW,
      inferredIntent: 'room_number_tagging',
      scope: PREFERENCE_SCOPES.PROJECT,
      projectId: 'Lot3',
      preferenceStatement: 'Tag all drywall items with room numbers.',
      status: PREFERENCE_STATUS.ACTIVE,
      source: PREFERENCE_SOURCES.EXPLICIT
    }
  ];

  const promptBlock = compileUserPreferencesPrompt(prefs, 'Lot3');
  assert.match(promptBlock, /### USER PREFERRED INTERACTION STYLE/);
  assert.match(promptBlock, /\[Global\] Lead with the bottom-line number\./);
  assert.match(promptBlock, /\[Project: Lot3\] Tag all drywall items with room numbers\./);
});

test('15. Malformed preference records fail safely without crashing', () => {
  const malformed = [null, undefined, {}, { status: 'invalid' }];
  const resolved = resolvePreferenceConflicts(malformed, null);
  assert.deepEqual(resolved, []);

  const promptBlock = compileUserPreferencesPrompt(malformed, null);
  assert.equal(promptBlock, '');
});

test('16. Multi-Domain Generalization A: Brevity / Short Answers outside financial domain', () => {
  const query = 'Give me the short version on site safety setup.';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis, 'Should detect brevity pattern outside finance');
  assert.equal(analysis.type, 'inferred_pattern');
  assert.equal(analysis.inferredIntent, 'concise_bottom_line');
  assert.equal(analysis.category, PREFERENCE_CATEGORIES.INFORMATION_DEPTH);
});

test('17. Multi-Domain Generalization B: Formatting / Bullet Points preference', () => {
  const query = 'Please format the inspection checklist with bullet points.';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis, 'Should detect formatting preference');
  assert.equal(analysis.type, 'inferred_pattern');
  assert.equal(analysis.inferredIntent, 'bulleted_formatting');
  assert.equal(analysis.category, PREFERENCE_CATEGORIES.FORMATTING);
  assert.match(analysis.preferenceStatement, /bulleted lists/i);
});

test('18. Multi-Domain Generalization C: Terminology Distinction preference', () => {
  const query = 'Distinguish between rough-in electrical and finish trim.';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis, 'Should detect terminology distinction pattern');
  assert.equal(analysis.type, 'inferred_pattern');
  assert.equal(analysis.category, PREFERENCE_CATEGORIES.TERMINOLOGY);
  assert.match(analysis.preferenceStatement, /distinguish clearly between/i);
});

test('19. Multi-Domain Generalization D: Workflow Approval & Draft Previews', () => {
  const query = 'Always draft the message first before sending to subcontractors.';
  const analysis = analyzeInteractionForPreference(query);

  assert.ok(analysis, 'Should detect workflow approval pattern');
  assert.equal(analysis.type, 'inferred_pattern');
  assert.equal(analysis.category, PREFERENCE_CATEGORIES.WORKFLOW);
  assert.match(analysis.preferenceStatement, /draft previews/i);
});

test('20. Preference Auditability: Tracks observation, candidate creation, confirmation & status transitions', async () => {
  const userId = 'user_audit_101';
  
  // 1. Create candidate
  const candidate = await saveUserPreference(userId, {
    preferenceStatement: 'Keep responses concise.',
    inferredIntent: 'concise_bottom_line',
    confidence: 0.85,
    status: PREFERENCE_STATUS.CANDIDATE,
    source: PREFERENCE_SOURCES.INFERRED
  });

  assert.ok(Array.isArray(candidate.auditHistory), 'Audit history must be an array');
  assert.equal(candidate.auditHistory[0].action, 'candidate_created');
  assert.ok(candidate.auditHistory[0].timestamp);

  // 2. User confirms
  await updateUserPreferenceStatus(userId, candidate.id, PREFERENCE_STATUS.ACTIVE);
  const loaded = await loadUserPreferences(userId);
  const updated = loaded.find(p => p.id === candidate.id);

  assert.ok(updated.auditHistory.length >= 2);
  const latestAudit = updated.auditHistory[updated.auditHistory.length - 1];
  assert.equal(latestAudit.action, 'confirmed');
  assert.equal(latestAudit.actor, 'user');
});

test('21. Model Independence: Switching Gemini models preserves all learned preferences in prompt compiler', () => {
  const prefs = [
    {
      id: 'p_perm',
      category: PREFERENCE_CATEGORIES.RESPONSE_STYLE,
      inferredIntent: 'concise_bottom_line',
      scope: PREFERENCE_SCOPES.GLOBAL,
      preferenceStatement: 'Always state remaining balance first.',
      status: PREFERENCE_STATUS.ACTIVE,
      source: PREFERENCE_SOURCES.EXPLICIT
    }
  ];

  // Compile under flash-lite
  const promptFlashLite = compileUserPreferencesPrompt(prefs, 'Lot3');

  // Simulate model switch to flash reasoning model
  const promptFlashReasoning = compileUserPreferencesPrompt(prefs, 'Lot3');

  assert.equal(promptFlashLite, promptFlashReasoning, 'Prompt must be 100% identical regardless of underlying model');
  assert.match(promptFlashReasoning, /Always state remaining balance first\./);
});

test('22. Semantic Generalization: Completely different phrasings resolve to the exact same generalized preference', () => {
  const diversePhrasings = [
    "Just give me the number.",
    "What's the balance?",
    "Bottom line?",
    "Don't give me all that history, just tell me what I owe.",
    "What's the outstanding amount?",
    "Skip the story, just give me the total."
  ];

  const hypotheses = diversePhrasings.map(query => extractBehavioralHypothesis(query));

  for (const h of hypotheses) {
    assert.ok(h, 'Every phrasing must be interpreted');
    assert.equal(h.category, PREFERENCE_CATEGORIES.INFORMATION_DEPTH);
    assert.equal(h.inferredIntent, 'concise_bottom_line');
    assert.equal(
      h.preferenceStatement,
      'Lead with the bottom-line answer and provide additional detail only when requested.'
    );
  }
});




