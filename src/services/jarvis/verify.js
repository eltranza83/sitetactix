/**
 * Write verification and claim checking for Jarvis (v1.4.0).
 * Reuses the battle-tested grounding and claim checks from v1.3.14-v1.3.16.
 */

/**
 * Returns true if proposed expense vendor and amount are grounded in the user's words.
 */
export function isExpenseGrounded(vendor = '', amount = 0, userQuery = '') {
  const q = String(userQuery || '').toLowerCase();
  const amtNum = Number(amount);

  // Check amount
  const hasAmt = !isNaN(amtNum) && amtNum > 0 && (
    q.includes(String(amtNum)) ||
    q.includes(`$${amtNum}`) ||
    q.includes(amtNum.toFixed(2)) ||
    q.includes(String(Math.floor(amtNum)))
  );

  // Check vendor
  const v = String(vendor || '').toLowerCase().trim();
  const hasVendor = !v || q.includes(v) || v.split(/\s+/).some(part => part.length > 2 && q.includes(part));

  return hasAmt && hasVendor;
}

const FALSE_CLAIM_PATTERNS = [
  /\b(?:i(?:'ve| have)?\s+(?:successfully\s+)?(?:added|created|inserted|put|saved|updated|marked|logged|staged|recorded|noted|set\s+a\s+reminder))\b/i,
  /\b(?:(?:added|created|staged|logged|recorded|noted|scheduled)\s+(?:it|them|this|the\s+item|the\s+expense|the\s+reminder|the\s+receipt))\b/i,
  /\b(?:ya\s+(?:lo\s+)?(?:agregu[eé]|cre[eé]|guard[eé]|anot[eé]|registr[eé]|apunt[eé]|marqu[eé]|program[eé]))\b/i,
  /\b(?:(?:ha|he)\s+sido\s+(?:agregado|creado|guardado|anotado|registrado|marcado))\b/i
];

const REFUSAL_CLAIM_PATTERNS = [
  /\b(?:i\s+do\s*n['o]?t\s+have\s+(?:the\s+)?(?:authorization|permission|access|ability)\s+to\s+(?:add|modify|create|stage|delete|update))\b/i,
  /\b(?:as\s+an\s+ai[,\s]+i\s+(?:can(?:not|['’]t)|do\s+not\s+have\s+the\s+ability))\b/i,
  /\b(?:no\s+tengo\s+(?:la\s+)?(?:autorizaci[oó]n|permiso|acceso)\s+para\s+(?:modificar|agregar|crear|borrar))\b/i
];

/**
 * Claim check: verifies that the AI's final answer doesn't falsely claim that
 * an action succeeded or refuse with lack of authorization.
 */
export function verifyActionExecutionClaims(replyText = '', userQuery = '', executedTools = []) {
  if (!replyText || typeof replyText !== 'string') return replyText;

  const successfulWrites = (executedTools || []).filter(t => t.isWrite && t.ok);
  if (successfulWrites.length > 0) {
    return replyText;
  }

  const hasClaim = FALSE_CLAIM_PATTERNS.some(p => p.test(replyText));
  const hasRefusal = REFUSAL_CLAIM_PATTERNS.some(p => p.test(replyText));

  if (hasClaim || hasRefusal) {
    return "I didn't complete that. Which item or action did you mean?";
  }

  return replyText;
}
