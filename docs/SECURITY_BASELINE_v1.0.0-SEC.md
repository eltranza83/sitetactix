# 🛡️ SiteTactix Production Security Baseline Report (v1.0.0-SEC)

**Audit Date:** August 20, 2026  
**Git Baseline Tag:** `v1.0.0-SEC`  
**Status:** **APPROVED, FROZEN, AND VERIFIED**

---

## 1. Executive Summary
This document establishes the official **v1.0.0-SEC** security baseline for the **SiteTactix** application. All identified vulnerabilities from the initial and second comprehensive audits have been remediated, tested with zero regressions across 131 automated tests, and verified through end-to-end integration workflows.

---

## 2. Issues Fixed & Remediations Applied

| Finding | Component | Remediation Applied |
| :--- | :--- | :--- |
| **Unauthenticated AI Endpoints** | `/api/ask-brain.js`<br>`/api/embed-memory.js` | Enforced `requireScannerAccess(request)` with sliding-window rate limiting (30-40 req/min) and sanitized event logging. |
| **Unscoped Memory Collection** | `firestore.rules`<br>`src/services/memoryService.js` | Scoped `/memories/{memoryId}` to require `resource.data.uid == request.auth.uid`. Updated client queries with `where('uid', '==', user.uid)`. |
| **Dependency CVEs (4 advisories)** | `dompurify`<br>`nanoid`<br>`postcss`<br>`protobufjs` | Applied non-breaking security patches via `npm audit fix`. |
| **Sanitized Security Logging** | `api/_lib/firebase-auth.js` | Implemented `logSecurityEvent` that strips tokens, API keys, passwords, and document bodies from security logs. |
| **Client Auth Header Binding** | `src/services/builderBrainService.js` | Dynamically retrieves user Firebase ID token (`user.getIdToken()`) and binds `Authorization: Bearer ${token}` on inference calls. |

---

## 3. Accepted Risks & Assumptions

1. **Firebase Client Web API Key Exposure (`AIzaSy...`)**
   - **Architectural Context:** Standard Firebase web application architecture requires embedding the public web API key into the frontend bundle (`src/config/appConfig.js`) to allow clients to initialize the Firebase SDK and authenticate users.
   - **Risk Mitigation:** Access to Firestore databases and storage buckets is strictly guarded by `firestore.rules` and backend token verification. The API key alone grants no administrative or unauthorized data access without valid user authentication and verified invite permissions.

2. **Local Development / Offline Fallback Behavior**
   - **Architectural Context:** In offline environments or local development servers where Vercel serverless `/api/*` endpoints are not running (e.g. standard `vite dev`), client services (`gemini.js`, `builderBrainService.js`, `memoryService.js`) gracefully fall back to local cached storage (LocalStorage / IndexedDB) or user-entered Settings API keys.
   - **Risk Mitigation:** The fallback only activates on client network failures (e.g. 404 on localhost) when the user has explicitly provided a personal API key in Settings, ensuring local developer productivity without bypassing production serverless security rules.

---

## 4. Verification & Security Testing Results

### A. Dependency Audit (`npm audit`)
- **Status:** 0 vulnerabilities across 136 audited packages.

### B. Automated Test Suite (`node --test`)
- **Status:** 131 tests passing across 11 suites (0 failures).
- **Test Scenarios Covered:**
  - ✅ Unauthenticated endpoint calls -> rejected with `401 Unauthorized`.
  - ✅ Unauthorized users without invite record -> rejected with `403 Forbidden`.
  - ✅ Excessive rapid requests -> rate limited with `429 Too Many Requests`.
  - ✅ Sanitized logging -> tokens, passwords, and API keys never outputted.
  - ✅ Cross-tenant memory access -> User B strictly blocked from reading or tampering with User A's memories.
  - ✅ Memory UID spoofing -> User B strictly rejected from creating memories stamped with User A's UID.
  - ✅ Admin override -> Admins retain access to manage memories for system maintenance.
  - ✅ Document extraction, voice loop, and direct spreadsheet sync regression suites -> 100% passing.

### C. Production Build & Lint (`npm run build` & `npm run lint`)
- **Status:** 0 lint errors, production bundle generated with 0 exposed sourcemaps or server secrets.

---

## 5. Baseline Declaration
From this commit forward, `v1.0.0-SEC` serves as the golden security baseline for SiteTactix. Any subsequent features or architectural changes must be verified against this baseline to ensure security posture is never degraded.
