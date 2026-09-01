# Security Hardening Tasks

**Feature:** Security Hardening
**Created:** 2025-12-14 12:00:00 UTC-8
**Last Updated:** 2026-09-01 17:36:00 UTC+2
**Last Updated By:** Dev Team (Sage/Nova/Milo)

## Overview

Implementation tasks for security hardening based on the security assessment findings.

**Actual delivery diverged from this original task breakdown** - see `design.md`'s "What Was Actually Built" and "Divergences From the Original Plan" sections for the authoritative description of what shipped across Sprints 1-4. This file's checkboxes below have been updated to reflect actual completion status; tasks describing features that were **not** built are marked `[ ]` and annotated as descoped/not implemented rather than silently deleted.

Reference documents:

- `design.md` - Feature design (see "What Was Actually Built" for as-shipped behavior)
- `VSCode_Copilot_Proxy_Security_Assessment.md` - Full security audit

---

## PHASE 1: CRITICAL FIXES (P0)

**Status:** Done
**Progress:** 5/5 tasks complete (100%) - implemented with different mechanics than originally specified (see notes)
**Phase Started:** 2025-12-14 (Sprint 1)
**Last Updated:** 2026-09-01 17:36:00 UTC+2
**Phase Completed:** Sprint 2 (wiring into extension.ts)
**Phase Duration:** Sprints 1-2

Priority: MUST FIX - Address before any production use

### 1.1 Localhost Binding Enforcement

- [x] **CRITICAL-01-A:** Modify `server.listen()` to bind to `127.0.0.1` explicitly
  - File: `src/extension.ts`
  - Implemented via shared `LOOPBACK_HOST` constant from `src/security.ts` (Sprint 2)

- [x] **CRITICAL-01-B:** Update log message to show bind address
  - File: `src/extension.ts`
  - Startup log shows `Server started on 127.0.0.1:${port}`

### 1.2 API Key / Token Authentication

- [x] **CRITICAL-02-A:** Create `src/security.ts` with authentication utilities (Sprint 1)
  - Implemented: `parseBearerToken()`, `constantTimeEqual()`, `isAuthExemptRoute()` instead of `validateApiKey()`/`generateSecureApiKey()`
  - Token storage: VS Code `context.secrets` (SecretStorage) - same storage mechanism as originally planned

- [x] **CRITICAL-02-B:** Add token command(s) to extension (Sprint 2)
  - Implemented: single `copilot-proxy.setProxyToken` command (user supplies their own token)
  - **Descoped:** separate `generateApiKey`/`showApiKey`/`clearApiKey` commands were not implemented - one set command covers set/rotate (re-running it overwrites the stored token); there is no "show" command (token is a secret, never displayed) and no separate "clear" command

- [x] **CRITICAL-02-C:** Integrate auth check into request handler (Sprint 2)
  - File: `src/extension.ts` - `authenticateRequest()`
  - Returns `401` for missing/invalid auth (no separate `403` path - unified on `401` for simplicity)
  - **Deviates from plan:** auth is always-on and deny-by-default; there is no `requireAuth` opt-out setting - if no token has been set, all non-exempt requests are rejected

**Phase 1 Acceptance Criteria:**

- [x] Server ONLY binds to 127.0.0.1
- [x] Cannot access API from network (even if port forwarded)
- [x] Bearer-token auth works (always enabled, deny-by-default)
- [x] Token stored securely (SecretStorage, not plaintext settings)

---

## PHASE 2: HIGH-RISK FIXES (P1)

**Status:** Done
**Progress:** 4/6 tasks complete (67%) - CORS and error/log sanitization done; prompt-content filtering descoped
**Phase Started:** Sprint 2
**Last Updated:** 2026-09-01 17:36:00 UTC+2
**Phase Completed:** Sprint 3 (log/error sanitization)
**Phase Duration:** Sprints 2-3

Priority: Should fix - Prevents information disclosure and abuse

### 2.1 Error Message Sanitization

- [x] **HIGH-02-A:** Add error categorization function to `src/security.ts` (Sprint 1)
  - Implemented as `categorizeError(error)` - maps to a small fixed set of category strings, rather than the originally-proposed regex-based `sanitizeErrorMessage()` path/stack-trace stripper
  - **Design deviation:** categorization (allowlist of known categories) chosen over best-effort redaction (denylist regex stripping) for a stronger guarantee against unanticipated leak patterns

- [x] **HIGH-02-B:** Apply sanitization to logged errors (Sprint 3)
  - File: `src/extension.ts` - `addRequestLog()`'s persisted `errorMessage` field now always uses `categorizeError(error)`
  - Client-facing HTTP error responses intentionally continue to use the existing human-readable `describeRequestError(error)` (log storage vs. direct API response is a deliberate distinction, not an oversight)

### 2.2 CORS Restriction

- [x] **HIGH-03-A:** Replace wildcard CORS with an explicit allowlist (Sprint 2)
  - File: `src/extension.ts` / `src/security.ts` (`buildCorsHeaders`)
  - **Deviates from plan:** rather than `Access-Control-Allow-Origin: null` + `Access-Control-Allow-Credentials: true`, implemented as a configurable exact-match origin allowlist (`copilotProxy.allowedOrigins`, default `[]`); no header sent at all if origin is absent/not-allowlisted

- [x] **HIGH-03-B:** Add origin validation function (Sprint 1)
  - File: `src/security.ts` - `normalizeOrigin()` / `isOriginAllowed()`
  - **Deviates from plan:** exact-match against a user-configured allowlist, not a regex-based "any localhost origin" allowance (localhost origins are not auto-allowed - they must be added to `allowedOrigins` like any other origin)

- [x] **HIGH-03-C:** Integrate origin check into request handler (Sprint 2)
  - Non-allowlisted origins simply receive no CORS header (browser blocks the response client-side); the proxy does not return a `403` specifically for CORS mismatches since normal REST clients typically don't send an `Origin` header at all

### 2.3 Prompt Validation (Optional Feature)

- [ ] **HIGH-01-A:** Add optional prompt content validation
  - **Not implemented / descoped** for Sprints 1-4 - carried forward as a known gap (see `design.md` "Known Gaps")

**Phase 2 Acceptance Criteria:**

- [x] Persisted error log entries never contain raw paths/stack traces (bounded categories only)
- [x] External non-allowlisted websites cannot receive CORS headers from the API
- [x] Origin validation blocks non-allowlisted origins (no header returned)
- [ ] Prompt filtering available - **not implemented, descoped**

---

## PHASE 3: HARDENING (P2)

**Status:** Not Started
**Progress:** 0/8 tasks complete (0%) - descoped for Sprints 1-4
**Phase Started:** N/A
**Last Updated:** 2026-09-01 17:36:00 UTC+2
**Phase Completed:** N/A
**Phase Duration:** N/A

Priority: Should fix - Improves resilience and prevents abuse

**Sprint 4 note:** None of Phase 3 was implemented in Sprints 1-4. It remains a candidate for a future sprint. Listed here unchanged from the original plan for traceability; see `design.md` "Known Gaps / Not Implemented".

### 3.1 Rate Limiting

- [ ] **LOW-04-A:** Implement `RateLimiter` class - not implemented
- [ ] **LOW-04-B:** Integrate rate limiting into request handler - not implemented

### 3.2 Connection Limiting

- [ ] **MEDIUM-01-A:** Add connection tracking to server - not implemented
- [ ] **MEDIUM-01-B:** Enforce connection limit - not implemented

### 3.3 Input Validation Limits

- [ ] **MEDIUM-02-A:** Add message count limit to `validateRequest()` - not implemented
- [ ] **MEDIUM-02-B:** Add message length limit to `validateRequest()` - not implemented

### 3.4 Secure ID Generation

- [ ] **MEDIUM-04-A:** Replace `Math.random()` with `crypto.randomBytes()` - not implemented

### 3.5 Timeout Consistency

- [ ] **MEDIUM-05-A:** Align timeout values - not implemented (pre-existing timeout values unchanged by this effort)

**Phase 3 Acceptance Criteria:** Not applicable - phase not started.

---

## PHASE 4: BEST PRACTICES (P3)

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%) - descoped for Sprints 1-4, except the tool-execution gating item which was added as new scope (see below)
**Phase Started:** N/A
**Last Updated:** 2026-09-01 17:36:00 UTC+2
**Phase Completed:** N/A
**Phase Duration:** N/A

Priority: Could fix - Improves overall security posture

### 4.1 Security Headers

- [ ] **INFO-01-A:** Define security headers constant - not implemented
- [ ] **INFO-01-B:** Apply security headers to all responses - not implemented

### 4.2 Settings Validation

- [ ] **LOW-02-A:** Add setting validators - not implemented
- [ ] **LOW-02-B:** Apply validation in webview message handler - not implemented

### 4.3 Model Refresh Race Condition

- [ ] **LOW-03-A:** Fix race condition in `refreshModels()` - not implemented (out of scope for this security effort)

### 4.4 Configuration Settings

- [ ] **CONFIG-A:** Add security settings to package.json - **partially implemented under different names/semantics** (new scope added during implementation, not in original plan):
  - `copilotProxy.allowedOrigins` (array, default `[]`) - shipped (Sprint 2)
  - `copilotProxy.allowAutoToolExecution` (boolean, default `false`) - shipped (Sprint 2) - this setting was **not** in the original plan; it was added to close a gap where a client could otherwise request server-side auto tool execution unconditionally
  - `copilotProxy.requireAuth`, `copilotProxy.rateLimit`, `copilotProxy.maxConnections`, `copilotProxy.maxMessages`, `copilotProxy.enablePromptFiltering` - **not implemented** (auth has no opt-out; rate limiting/connection limiting/message limits/prompt filtering are not implemented at all)

**Phase 4 Acceptance Criteria:** Not applicable - phase largely not started; only the CORS/tool-exec settings under 4.4 shipped.

---

## Documentation Tasks

- [x] **DOC-01:** Update README with security section
  - Completed 2026-09-01 (Sprint 4) - added "Security / Local Setup" section, updated all code examples with `Authorization: Bearer` header and explicit `127.0.0.1`, updated Configuration/Commands tables and the "Security" section at the end of the README

- [x] **DOC-02:** Add inline code comments for security functions
  - Completed in Sprints 1-2 within `src/security.ts` and `src/extension.ts`

- [x] **DOC-03:** Create completion summary when feature is done
  - This `design.md`/`TASKS.md` update (Sprint 4) serves as the completion documentation; a separate `docs/features/security-hardening/completion/` folder was not created since this file and `design.md` now fully capture what shipped

---

## Testing Tasks

- [x] **TEST-01:** Automated + manual testing - localhost binding
  - Covered by `src/test/extension-integration.test.ts` and Sprint 1-3 unit tests; server only listens on `127.0.0.1`

- [x] **TEST-02:** Automated testing - bearer token auth
  - Covered by `src/test/security.test.ts` and `src/test/extension-integration.test.ts` (valid/invalid/missing token cases; deny-by-default when unset)

- [x] **TEST-03:** Automated testing - error/log sanitization
  - Covered by `src/test/log-redaction.test.ts` (6 tests) - verifies no raw paths/stack traces in persisted logs

- [x] **TEST-04:** Automated testing - CORS
  - Covered by `src/test/security.test.ts` / `src/test/extension-integration.test.ts` (allowlisted vs. non-allowlisted origins)

- [ ] **TEST-05:** Manual testing - rate limiting
  - **Not applicable** - rate limiting was not implemented in Sprints 1-4

**Sprint 4 final verification (2026-09-01):** `npm run compile`, `npm run lint`, `npm test` re-run to confirm no regressions from documentation-only changes - see `dev-validation-evidence.md` (if produced in a run folder) for this run's exact output.

---

## Notes

- All new features are backward-compatible with the exception of auth now being always-on by default (a deliberate, documented security posture change - previously "no breaking changes" applied to the original opt-in `requireAuth` proposal, but the team chose deny-by-default instead for stronger default security)
- Security features implemented (auth, CORS allowlist, log/error categorization, tool-exec gating) are not opt-in/opt-out toggles in the traditional sense - auth and CORS restriction are always active; only the allowlist contents and `allowAutoToolExecution` are user-configurable
- Kept VS Code output logging for debugging (not removed) - now metadata-only
- Phases 3 and 4 (rate limiting, connection limits, input length/message-count limits, security response headers, settings validation, ID generation) remain **not implemented** and are open for a future sprint if desired
