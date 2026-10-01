const DEFAULT_FIREBASE_API_KEY = 'AIzaSyDjYPPkW8ffQMOCByCo9gMlVxQ8PsMpAoU';
const DEFAULT_FIREBASE_PROJECT_ID = 'adepec-scanner-invites';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

// In-memory rate limiting map for serverless execution context
const rateLimitMap = new Map();

/**
 * Checks in-memory sliding window rate limits per key (e.g. UID or IP).
 */
export function checkRateLimit(key, limit = 30, windowMs = 60000) {
  if (!key) return true;
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    rateLimitMap.set(key, entry);
    return true;
  }

  entry.count += 1;
  rateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return false;
  }
  return true;
}

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Sanitized security audit logger that never outputs tokens, secrets, or document bodies.
 */
export function logSecurityEvent(eventType, metadata = {}) {
  // Strip any accidental sensitive fields
  const sanitized = { ...metadata };
  delete sanitized.idToken;
  delete sanitized.token;
  delete sanitized.apiKey;
  delete sanitized.secret;
  delete sanitized.password;
  delete sanitized.body;
  delete sanitized.contents;
  delete sanitized.prompt;

  console.warn('[SECURITY_EVENT]', JSON.stringify({
    event: eventType,
    ...sanitized,
    timestamp: new Date().toISOString()
  }));
}

export function getBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export async function verifyFirebaseIdentity(idToken, fetchImpl = fetch) {
  if (!idToken) {
    throw new HttpError(401, 'Sign in is required.');
  }

  const apiKey = process.env.FIREBASE_WEB_API_KEY || DEFAULT_FIREBASE_API_KEY;
  const response = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken })
    }
  );

  if (!response.ok) {
    throw new HttpError(401, 'Your sign-in session expired. Please sign in again.');
  }

  const payload = await response.json();
  const user = payload.users?.[0];
  if (!user?.localId || !user?.email || user.disabled) {
    throw new HttpError(401, 'Your account is not available. Please sign in again.');
  }

  if (user.emailVerified !== true) {
    throw new HttpError(403, 'Email verification is required.');
  }

  return {
    uid: user.localId,
    email: user.email.toLowerCase()
  };
}

async function firestoreDocumentExists(path, idToken, fetchImpl) {
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;
  const response = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`,
    { headers: { authorization: `Bearer ${idToken}` } }
  );

  if (response.ok) return true;
  if (response.status === 403 || response.status === 404) return false;
  throw new HttpError(503, 'Authorization service is temporarily unavailable.');
}

export async function requireScannerAccess(request, fetchImpl = fetch, options = {}) {
  const clientIp = getClientIp(request);
  const idToken = getBearerToken(request);

  if (!idToken) {
    logSecurityEvent('UNAUTHENTICATED_ACCESS_ATTEMPT', {
      clientIp,
      path: new URL(request.url || 'http://localhost').pathname
    });
    throw new HttpError(401, 'Sign in is required.');
  }

  const user = await verifyFirebaseIdentity(idToken, fetchImpl);
  const adminPath = `admins/${encodeURIComponent(user.email)}`;
  const accessPath = `user_access/${encodeURIComponent(user.uid)}`;

  const isAdmin = await firestoreDocumentExists(adminPath, idToken, fetchImpl);
  if (!isAdmin) {
    const hasAccess = await firestoreDocumentExists(accessPath, idToken, fetchImpl);
    if (!hasAccess) {
      logSecurityEvent('UNAUTHORIZED_INVITE_ACCESS_ATTEMPT', {
        clientIp,
        uid: user.uid,
        emailDomain: user.email.split('@')[1] || 'unknown',
        path: new URL(request.url || 'http://localhost').pathname
      });
      throw new HttpError(403, 'Scanner access is not authorized for this account.');
    }
  }

  // Check rate limit per authenticated UID
  const rateLimitCount = options.rateLimit || 40; // 40 requests per min default
  const isAllowed = checkRateLimit(user.uid, rateLimitCount, options.windowMs || 60000);
  if (!isAllowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      clientIp,
      uid: user.uid,
      path: new URL(request.url || 'http://localhost').pathname
    });
    throw new HttpError(429, 'Too many requests. Please slow down and try again in a few moments.');
  }

  return user;
}

export function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

export function errorResponse(error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError
    ? error.message
    : 'The secure processing service could not complete the request.';

  if (status >= 400 && status < 500) {
    logSecurityEvent('REQUEST_REJECTED', {
      status,
      errorName: error.name || 'Error'
    });
  } else if (status >= 500) {
    console.error('[SERVER_ERROR]', error.message || error);
  }

  return jsonResponse({ error: message }, status);
}
