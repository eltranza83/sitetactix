/**
 * SiteTactix Persistent Memory Service ("Second Brain")
 * Manages contextual business intelligence, site decisions, subcontractor preferences,
 * verbal agreements, quotes, and lessons learned across projects.
 */
import { collection, doc, getDocs, setDoc, updateDoc, query as firestoreQuery, where } from 'firebase/firestore/lite';
import { getFirebaseDb, getFirebaseAuthInstance } from './firebase.js';

export const MEMORY_STORAGE_KEY = 'sitetactix_persistent_memories_v1';
export const MEMORY_COLLECTION = 'memories';

export const MEMORY_TYPES = [
  'project_fact',
  'subcontractor',
  'vendor',
  'preference',
  'decision',
  'agreement',
  'instruction',
  'lesson_learned',
  'business_rule',
  'general'
];

export const MEMORY_IMPORTANCE = {
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  INFORMATIONAL: 'informational'
};

export const MEMORY_SOURCES = {
  USER_EXPLICIT: 'user_explicit',
  AI_INFERRED: 'ai_inferred',
  SYSTEM: 'system'
};

/**
 * Words indicating speculation or non-authoritative statements.
 */
const AMBIGUITY_INDICATORS = [
  'might',
  'maybe',
  'perhaps',
  'thinking about',
  'considering',
  'not sure if',
  'possibly',
  'could be',
  'may switch',
  'may want',
  'might want'
];

/**
 * Detects if a text contains uncertain or speculative language.
 */
export function detectAmbiguity(text = '') {
  if (!text || typeof text !== 'string') return { isAmbiguous: false };
  const lower = text.toLowerCase();
  for (const indicator of AMBIGUITY_INDICATORS) {
    if (lower.includes(indicator)) {
      return {
        isAmbiguous: true,
        indicator,
        warning: `Statement contains speculative phrasing ("${indicator}"). AI must confirm with user before saving as a permanent business fact.`
      };
    }
  }
  return { isAmbiguous: false };
}

/**
 * Basic stopwords to filter out when auto-generating tags
 */
const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'lot', 'remember', 'save', 'note'
]);

/**
 * Extracts searchable keyword tags from natural text.
 */
export function extractTags(text = '') {
  if (!text || typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Computes cosine similarity between two numeric embedding vectors.
 */
export function computeCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const cosineSimilarity = computeCosineSimilarity;

/**
 * Generates a unique ID for memories.
 */
export function generateMemoryId() {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Normalize project ID / Lot identifier for consistent scoping.
 */
export function normalizeProjectId(projectId) {
  if (!projectId || typeof projectId !== 'string') return null;
  const trimmed = projectId.trim();
  if (trimmed.toLowerCase() === 'global' || trimmed.toLowerCase() === 'all') return null;
  return trimmed;
}

/**
 * Checks if a memory's project matches the target project query, supporting ID/Name aliases.
 */
export function isProjectScopeMatch(memProjectId, targetProjectId) {
  if (!memProjectId || !targetProjectId) return false;

  const memClean = String(memProjectId).toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetClean = String(targetProjectId).toLowerCase().replace(/[^a-z0-9]/g, '');

  if (memClean === targetClean) return true;

  // Check prefix or slug matches (e.g. lot3 matching lot_3 or proj_... when associated)
  if (memClean.includes(targetClean) || targetClean.includes(memClean)) return true;

  return false;
}

/**
 * In-memory / LocalStorage cache fallback helpers.
 */
function loadLocalMemories() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    // Automatically purge the accidental purchasing memory created during test
    const cleaned = list.filter(m => {
      const t = String(m?.text || '').toLowerCase();
      const isErrantPurchasingMemory = t.includes('electrical items') && t.includes('security lights') && t.includes('doorbell chime kit') && t.includes('still need to be purchased');
      return !isErrantPurchasingMemory;
    });

    if (cleaned.length !== list.length) {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch (err) {
    console.error('[MemoryService] Failed to load local memories:', err);
    return [];
  }
}

function saveLocalMemories(memories) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
  } catch (err) {
    console.error('[MemoryService] Failed to save local memories:', err);
  }
}

export const MEMORY_SCOPES = {
  PROJECT: 'project',
  GLOBAL: 'global',
  PERSONAL: 'personal'
};

/**
 * Checks if a text indicates a personal memory.
 */
export function isPersonalIntent(text = '') {
  const t = text.toLowerCase();
  const personalKeywords = [
    'lunch', 'dinner', 'breakfast', 'meal', 'restaurant', 'food', 'chipotle',
    'doctor', 'dentist', 'appointment', 'grocery', 'groceries', 'gym',
    'workout', 'vacation', 'flight', 'hotel', 'family', 'birthday', 'anniversary',
    'personal'
  ];
  return personalKeywords.some(k => t.includes(k));
}

/**
 * Clean conversational phrasing and command prefixes from stored memory texts.
 */
export function cleanMemoryText(text = '') {
  let cleaned = String(text || '').trim();
  cleaned = cleaned.replace(/^(?:i need you to |please )?remember (?:that )?/i, '');
  cleaned = cleaned.replace(/^(?:make a note|take note|save (?:this )?(?:for later|to memory)?|keep (?:this )?in mind)(?: that|:)?\s*/i, '');
  cleaned = cleaned.replace(/^(?:hey,? )?(?:actually,? )?(?:we need to |please )?(?:change|update)(?: that[.,]?)?(?: note| preference| memory)? (?:to|that)?[:\s]*/i, '');
  cleaned = cleaned.trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Normalize memory object schema ensuring all required and guardrail fields exist.
 */
export function sanitizeMemoryRecord(raw = {}) {
  const now = new Date().toISOString();
  const rawText = cleanMemoryText(raw.text || raw.memory || '');
  const projectId = normalizeProjectId(raw.projectId || raw.lotId);

  let scope = raw.scope;
  if (!scope) {
    if (raw.isPersonal || raw.category === 'personal' || isPersonalIntent(rawText)) {
      scope = MEMORY_SCOPES.PERSONAL;
    } else if (raw.isGlobal || !projectId) {
      scope = MEMORY_SCOPES.GLOBAL;
    } else {
      scope = MEMORY_SCOPES.PROJECT;
    }
  }

  const isGlobal = scope === MEMORY_SCOPES.GLOBAL;
  const isPersonal = scope === MEMORY_SCOPES.PERSONAL;

  return {
    id: raw.id || generateMemoryId(),
    text: rawText,
    projectId: (isGlobal || isPersonal) ? null : projectId,
    scope: scope,
    isGlobal: isGlobal,
    isPersonal: isPersonal,
    category: raw.category || (isPersonal ? 'personal' : 'general'),
    memoryType: raw.memoryType || (isPersonal ? 'personal' : 'project_fact'),
    importance: raw.importance || MEMORY_IMPORTANCE.IMPORTANT,
    source: raw.source || MEMORY_SOURCES.USER_EXPLICIT,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : (raw.source === MEMORY_SOURCES.AI_INFERRED ? 0.75 : 1.0),
    effectiveDate: raw.effectiveDate || now.split('T')[0],
    expirationDate: raw.expirationDate || null,
    lastVerifiedAt: raw.lastVerifiedAt || now,
    createdBy: raw.createdBy || 'user',
    updatedBy: raw.updatedBy || 'user',
    uid: raw.uid || (getFirebaseAuthInstance()?.currentUser?.uid) || null,
    tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags : extractTags(rawText),
    embedding: Array.isArray(raw.embedding) ? raw.embedding : null,
    active: raw.active !== false,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    deletedAt: raw.deletedAt || null,
    changeHistory: Array.isArray(raw.changeHistory) ? raw.changeHistory : []
  };
}

/**
 * Save a new memory to Firestore (and local storage cache).
 */
export async function saveMemory(memoryInput, options = {}) {
  const record = sanitizeMemoryRecord(memoryInput);
  if (!record.text) {
    throw new Error('Memory text cannot be empty.');
  }

  // Check for ambiguity
  const ambiguity = detectAmbiguity(record.text);
  if (ambiguity.isAmbiguous && record.source !== MEMORY_SOURCES.USER_EXPLICIT) {
    record.confidence = 0.5;
  }

  // 1. Update local cache
  const localList = loadLocalMemories();
  const existingIdx = localList.findIndex(m => m.id === record.id);
  if (existingIdx >= 0) {
    localList[existingIdx] = record;
  } else {
    localList.unshift(record);
  }
  saveLocalMemories(localList);

  // 2. Sync to Firestore if available
  try {
    const db = getFirebaseDb();
    if (db) {
      const docRef = doc(db, MEMORY_COLLECTION, record.id);
      await setDoc(docRef, record);
    }
  } catch (err) {
    console.warn('[MemoryService] Firestore save sync failed, cached locally:', err);
    if (options.throwOnFirestoreError) {
      throw err;
    }
  }

  return record;
}

/**
 * Update an existing memory while preserving an audit change history.
 */
export async function updateMemory(memoryId, updates = {}, reason = 'Updated by user', options = {}) {
  if (!memoryId) throw new Error('Memory ID is required for update.');

  const localList = loadLocalMemories();
  const idx = localList.findIndex(m => m.id === memoryId);
  if (idx < 0) {
    throw new Error(`Memory with ID "${memoryId}" not found.`);
  }

  const current = localList[idx];
  const now = new Date().toISOString();

  // Create audit trail entry
  const changeEntry = {
    timestamp: now,
    modifiedBy: updates.updatedBy || 'user',
    reason: reason,
    previousText: current.text,
    previousData: {
      category: current.category,
      memoryType: current.memoryType,
      importance: current.importance,
      effectiveDate: current.effectiveDate,
      expirationDate: current.expirationDate,
      active: current.active
    }
  };

  const newHistory = [changeEntry, ...(current.changeHistory || [])];
  const newTags = updates.text ? extractTags(updates.text) : current.tags;

  const updatedRecord = {
    ...current,
    ...updates,
    tags: newTags,
    changeHistory: newHistory,
    updatedAt: now,
    lastVerifiedAt: now
  };

  // 1. Update local storage
  localList[idx] = updatedRecord;
  saveLocalMemories(localList);

  // 2. Sync to Firestore
  try {
    const db = getFirebaseDb();
    if (db) {
      const docRef = doc(db, MEMORY_COLLECTION, memoryId);
      await updateDoc(docRef, updatedRecord);
    }
  } catch (err) {
    console.warn('[MemoryService] Firestore update sync failed, cached locally:', err);
    if (options.throwOnFirestoreError) {
      throw err;
    }
  }

  return updatedRecord;
}

/**
 * Soft-delete / deactivate a memory record.
 */
export async function deactivateMemory(memoryId, reason = 'Deactivated by user') {
  return updateMemory(memoryId, {
    active: false,
    deletedAt: new Date().toISOString()
  }, reason);
}

/**
 * Permanently remove a memory (if hard purge is requested).
 */
export async function hardDeleteMemory(memoryId) {
  const localList = loadLocalMemories().filter(m => m.id !== memoryId);
  saveLocalMemories(localList);
  return { success: true, deletedId: memoryId };
}

/**
 * Retrieve active memories scoped by project, category, or type.
 */
export async function getMemories(options = {}) {
  const {
    projectId = null,
    scope = null,
    category = null,
    memoryType = null,
    includeGlobal = true,
    includePersonal = false,
    activeOnly = true
  } = options;

  const normalizedProj = normalizeProjectId(projectId);
  let list = loadLocalMemories();

  // Try fetching fresh from Firestore if available
  try {
    const db = getFirebaseDb();
    const auth = getFirebaseAuthInstance();
    const user = auth?.currentUser;

    if (db && user) {
      const memoriesRef = collection(db, MEMORY_COLLECTION);
      const q = firestoreQuery(memoriesRef, where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      const remoteList = [];
      snapshot.forEach(d => remoteList.push(d.data()));
      if (remoteList.length > 0) {
        list = remoteList;
        saveLocalMemories(remoteList);
      }
    } else if (db && !user) {
      // Unauthenticated client relies on local storage cache
    }
  } catch {
    // Gracefully use local cache
  }

  const todayStr = new Date().toISOString().split('T')[0];

  return list.filter(mem => {
    if (activeOnly && mem.active === false) return false;

    // Filter Expired Memories
    if (activeOnly && mem.expirationDate && mem.expirationDate < todayStr) {
      return false;
    }
    
    // Explicit Scope Filtering
    if (scope && scope !== 'all') {
      if (mem.scope !== scope) return false;
    }

    // Project Scoping & Isolation
    if (normalizedProj) {
      const matchesProj = isProjectScopeMatch(mem.projectId, normalizedProj);
      const isGlobalItem = includeGlobal && !mem.isPersonal && mem.scope !== MEMORY_SCOPES.PERSONAL && (mem.isGlobal || mem.scope === MEMORY_SCOPES.GLOBAL);
      const isPersonalItem = includePersonal && (mem.isPersonal || mem.scope === MEMORY_SCOPES.PERSONAL);
      if (!matchesProj && !isGlobalItem && !isPersonalItem) return false;
    } else if (projectId === 'global') {
      if (mem.isPersonal || (!mem.isGlobal && mem.scope !== MEMORY_SCOPES.GLOBAL)) return false;
    } else if (projectId === 'personal') {
      if (!mem.isPersonal && mem.scope !== MEMORY_SCOPES.PERSONAL) return false;
    }

    if (category && category !== 'all' && mem.category !== category) return false;
    if (memoryType && memoryType !== 'all' && mem.memoryType !== memoryType) return false;

    return true;
  });
}

/**
 * Search memories using semantic embeddings and keyword matching.
 */
export async function searchMemories(queryStr = '', options = {}) {
  const {
    projectId = null,
    category = null,
    memoryType = null,
    queryEmbedding = null,
    _importance = null,
    includePersonal = false,
    limit = 10
  } = options;

  const shouldIncludePersonal = Boolean(includePersonal || isPersonalIntent(queryStr));

  const allMemories = await getMemories({
    projectId,
    category,
    memoryType,
    includeGlobal: true,
    includePersonal: shouldIncludePersonal,
    activeOnly: true
  });

  if (!queryStr && !queryEmbedding) {
    return allMemories.slice(0, limit);
  }

  const queryTerms = extractTags(queryStr);
  const lowerQuery = queryStr.toLowerCase();

  const scored = allMemories.map(mem => {
    let score = 0;
    const memTextLower = (mem.text || '').toLowerCase();

    // 1. Exact phrase match bonus
    if (lowerQuery && memTextLower.includes(lowerQuery)) {
      score += 10;
    }

    // 2. Keyword / tag matches
    for (const term of queryTerms) {
      if (memTextLower.includes(term)) score += 2;
      if (mem.tags && mem.tags.includes(term)) score += 3;
    }

    // 3. Project direct match bonus
    if (projectId && mem.projectId && isProjectScopeMatch(mem.projectId, projectId)) {
      score += 2;
    }

    // 4. Semantic vector cosine similarity
    if (queryEmbedding && Array.isArray(mem.embedding)) {
      const sim = computeCosineSimilarity(queryEmbedding, mem.embedding);
      score += (sim * 15); // Heavily weigh semantic similarity
    }

    // 5. Importance boost
    if (mem.importance === MEMORY_IMPORTANCE.CRITICAL) score += 1.5;
    else if (mem.importance === MEMORY_IMPORTANCE.IMPORTANT) score += 0.5;

    return { ...mem, searchScore: score };
  });

  // Filter out non-matching results if search terms were provided
  const results = scored
    .filter(item => item.searchScore > 0 || !queryStr)
    .sort((a, b) => b.searchScore - a.searchScore);

  return results.slice(0, limit);
}

/**
 * Formats a list of memory records into a clean, concise context string for Gemini prompts.
 */
export function formatMemoriesForPrompt(memories = []) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return 'No persistent contextual memories recorded for this project scope.';
  }

  return memories.map((m, idx) => {
    const scopeLabel = m.isGlobal ? '[GLOBAL BUSINESS KNOWLEDGE]' : `[LOT: ${m.projectId || 'Unspecified'}]`;
    const typeLabel = `[TYPE: ${(m.memoryType || m.category || 'fact').toUpperCase()}]`;
    const importanceLabel = m.importance === 'critical' ? '⚡ CRITICAL: ' : '';
    const dateLabel = m.effectiveDate ? `(Effective: ${m.effectiveDate})` : '';
    return `${idx + 1}. ${scopeLabel} ${typeLabel} ${importanceLabel}"${m.text}" ${dateLabel}`;
  }).join('\n');
}

export const USER_PREFERENCE_STORAGE_KEY = 'sitetactix_user_preferences_v1';

/**
 * Loads user preferences for a given user ID and optional project ID.
 */
export async function loadUserPreferences(userId = 'default_user', _projectId = null) {
  if (!userId) userId = 'default_user';
  let prefs = [];

  // LocalStorage / memory cache
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(`${USER_PREFERENCE_STORAGE_KEY}_${userId}`);
      if (raw) prefs = JSON.parse(raw);
    } catch {
      prefs = [];
    }
  }

  // Firestore sync if available
  const db = getFirebaseDb();
  if (db && userId !== 'default_user') {
    try {
      const q = firestoreQuery(collection(db, 'user_preferences'), where('uid', '==', userId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const remoteList = [];
        snap.forEach(d => remoteList.push({ id: d.id, ...d.data() }));
        prefs = remoteList;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`${USER_PREFERENCE_STORAGE_KEY}_${userId}`, JSON.stringify(prefs));
        }
      }
    } catch (err) {
      console.warn('Failed to load user preferences from Firestore, using local cache:', err?.message);
    }
  }

  return prefs;
}

/**
 * Saves or updates a user preference record.
 */
export async function saveUserPreference(userId = 'default_user', prefData = {}) {
  if (!userId) userId = 'default_user';
  const now = new Date().toISOString();
  const id = prefData.id || `pref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const record = {
    id,
    uid: userId,
    category: prefData.category || 'response_style',
    preferenceStatement: prefData.preferenceStatement || prefData.statement || '',
    inferredIntent: prefData.inferredIntent || 'custom_style',
    confidence: typeof prefData.confidence === 'number' ? prefData.confidence : 1.0,
    source: prefData.source || 'explicit',
    observationCount: prefData.observationCount || 1,
    status: prefData.status || 'active',
    scope: prefData.scope || 'global',
    projectId: prefData.projectId || null,
    createdAt: prefData.createdAt || now,
    updatedAt: now,
    lastObservedAt: prefData.lastObservedAt || now,
    lastPromptedAt: prefData.lastPromptedAt || null,
    rejectedUntil: prefData.rejectedUntil || null,
    auditHistory: Array.isArray(prefData.auditHistory) ? prefData.auditHistory : [
      {
        action: prefData.status === 'candidate' ? 'candidate_created' : 'activated',
        timestamp: now,
        actor: prefData.source === 'explicit' ? 'user_explicit' : 'ai_observer',
        details: { source: prefData.source, confidence: prefData.confidence }
      }
    ]
  };

  // 1. Save in local cache
  if (typeof localStorage !== 'undefined') {
    try {
      const key = `${USER_PREFERENCE_STORAGE_KEY}_${userId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const idx = existing.findIndex(p => p.id === id || (p.inferredIntent === record.inferredIntent && p.scope === record.scope && p.projectId === record.projectId));
      if (idx >= 0) {
        const existingHistory = existing[idx].auditHistory || [];
        existingHistory.push({
          action: 'modified',
          timestamp: now,
          actor: 'user_preference_engine',
          details: { status: record.status }
        });
        existing[idx] = { ...existing[idx], ...record, auditHistory: existingHistory, updatedAt: now };
      } else {
        existing.push(record);
      }
      localStorage.setItem(key, JSON.stringify(existing));
    } catch (err) {
      console.warn('LocalStorage save failed for preference:', err?.message);
    }
  }

  // 2. Save in Firestore if available
  const db = getFirebaseDb();
  if (db && userId !== 'default_user') {
    try {
      await setDoc(doc(db, 'user_preferences', id), record, { merge: true });
    } catch (err) {
      console.warn('Firestore setDoc failed for preference:', err?.message);
    }
  }

  return record;
}

/**
 * Updates status of a user preference (e.g. candidate -> active, candidate -> rejected).
 */
export async function updateUserPreferenceStatus(userId = 'default_user', preferenceId, newStatus, rejectionCooldownDays = 30) {
  if (!preferenceId) return null;
  const now = new Date().toISOString();
  let rejectedUntil = null;

  if (newStatus === 'rejected') {
    const d = new Date();
    d.setDate(d.getDate() + rejectionCooldownDays);
    rejectedUntil = d.toISOString();
  }

  const auditEntry = {
    action: newStatus === 'active' ? 'confirmed' : (newStatus === 'rejected' ? 'rejected' : 'status_changed'),
    timestamp: now,
    actor: 'user',
    details: { newStatus, rejectedUntil }
  };

  const updates = {
    status: newStatus,
    updatedAt: now,
    ...(rejectedUntil ? { rejectedUntil } : {})
  };

  // LocalStorage update
  if (typeof localStorage !== 'undefined') {
    try {
      const key = `${USER_PREFERENCE_STORAGE_KEY}_${userId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const idx = existing.findIndex(p => p.id === preferenceId);
      if (idx >= 0) {
        const history = existing[idx].auditHistory || [];
        history.push(auditEntry);
        existing[idx] = { ...existing[idx], ...updates, auditHistory: history };
        localStorage.setItem(key, JSON.stringify(existing));
      }
    } catch (err) {
      console.warn('LocalStorage status update failed:', err?.message);
    }
  }

  // Firestore update
  const db = getFirebaseDb();
  if (db && userId !== 'default_user') {
    try {
      await updateDoc(doc(db, 'user_preferences', preferenceId), updates);
    } catch (err) {
      console.warn('Firestore status update failed:', err?.message);
    }
  }

  return { id: preferenceId, ...updates };
}

/**
 * Deactivates or deletes a specific user preference.
 */
export async function deleteUserPreference(userId = 'default_user', preferenceId) {
  return await updateUserPreferenceStatus(userId, preferenceId, 'deactivated');
}

/**
 * Resets all user preferences for the authenticated user.
 */
export async function resetAllUserPreferences(userId = 'default_user') {
  if (!userId) userId = 'default_user';

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(`${USER_PREFERENCE_STORAGE_KEY}_${userId}`);
    } catch {}
  }

  const db = getFirebaseDb();
  if (db && userId !== 'default_user') {
    try {
      const q = firestoreQuery(collection(db, 'user_preferences'), where('uid', '==', userId));
      const snap = await getDocs(q);
      const updates = [];
      snap.forEach(d => {
        updates.push(updateDoc(doc(db, 'user_preferences', d.id), { status: 'deactivated', updatedAt: new Date().toISOString() }));
      });
      await Promise.all(updates);
    } catch (err) {
      console.warn('Firestore reset failed:', err?.message);
    }
  }

  return { success: true, message: 'All user preferences reset.' };
}

