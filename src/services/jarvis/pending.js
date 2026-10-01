/**
 * Pending action state manager for Jarvis.
 * Enforces two-step confirmations for write operations (e.g. stage_expense, deletions).
 */

const PENDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let activePending = null;

const YES_WORDS = '(?:yes|yeah|yep|sure|ok|okay|confirm|confirmed|proceed|do it|go ahead|sounds good|looks good|s[ií]|claro|adelante|dale|hazlo|confirmo|por favor|please)';
const AFFIRMATIVE_REGEX = new RegExp(`^${YES_WORDS}(?:[\\s,]+${YES_WORDS})*[.!,]?$`, 'i');

const NO_WORDS = '(?:no|nope|nah|cancel(?:\\s+(?:that|it))?|stop|don\'t(?:\\s+(?:do\\s+that|it))?|dont|nevermind|forget it|drop it|cancela(?:\\s+(?:eso|lo))?|cancelar|no lo hagas)';
const NEGATIVE_REGEX = new RegExp(`^${NO_WORDS}(?:[\\s,]+${NO_WORDS})*[.!,]?$`, 'i');

export function getActivePending() {
  if (!activePending) return null;
  if (Date.now() - activePending.createdAt > PENDING_TIMEOUT_MS) {
    activePending = null;
    return null;
  }
  return activePending;
}

export function setPendingAction({ type, preview, projectId, executeCallback }) {
  activePending = {
    id: `pending_${type}_${Date.now()}`,
    type,
    preview,
    projectId,
    createdAt: Date.now(),
    executeCallback
  };
  return activePending;
}

export function clearPendingAction() {
  activePending = null;
}

export function isUserAffirmative(text = '') {
  return AFFIRMATIVE_REGEX.test(String(text || '').trim());
}

export function isUserNegative(text = '') {
  return NEGATIVE_REGEX.test(String(text || '').trim());
}

export function stripModelConfirmedArg(args) {
  if (!args || typeof args !== 'object') return args;
  const safe = { ...args };
  delete safe.confirmed;
  return safe;
}

/**
 * Checks if the current user turn is a response to an active pending confirmation.
 * Returns { handled: true, result: ... } or { handled: false }.
 */
export async function checkAndHandlePending(userText = '', currentProjectId = '') {
  const pending = getActivePending();
  if (!pending) return { handled: false };

  // If project changed, discard pending
  if (pending.projectId && currentProjectId && pending.projectId !== currentProjectId) {
    clearPendingAction();
    return { handled: false };
  }

  const clean = String(userText || '').trim();

  if (isUserAffirmative(clean)) {
    try {
      const execResult = await pending.executeCallback();
      clearPendingAction();
      return {
        handled: true,
        confirmed: true,
        type: pending.type,
        result: execResult,
        message: execResult?.message || 'Action confirmed and completed.'
      };
    } catch (err) {
      clearPendingAction();
      return {
        handled: true,
        confirmed: true,
        error: true,
        message: `Failed to complete action: ${err.message}`
      };
    }
  }

  if (isUserNegative(clean)) {
    clearPendingAction();
    return {
      handled: true,
      confirmed: false,
      message: 'Action cancelled.'
    };
  }

  return { handled: false };
}
