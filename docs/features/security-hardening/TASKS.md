# Security Hardening Tasks

**Feature:** Security Hardening
**Created:** 2025-12-14 12:00:00 UTC-8
**Last Updated:** 2025-12-14 12:00:00 UTC-8
**Last Updated By:** Claude Code

## Overview

Implementation tasks for security hardening based on the security assessment findings.

Reference documents:

- `design.md` - Feature design
- `VSCode_Copilot_Proxy_Security_Assessment.md` - Full security audit

---

## PHASE 1: CRITICAL FIXES (P0)

**Status:** Not Started
**Progress:** 0/5 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-14 12:00:00 UTC-8
**Phase Completed:** TBD
**Phase Duration:** TBD

Priority: MUST FIX - Address before any production use

### 1.1 Localhost Binding Enforcement

- [ ] **CRITICAL-01-A:** Modify `server.listen()` to bind to `127.0.0.1` explicitly
  - File: `src/extension.ts:418`
  - Change: Add hostname parameter to `server.listen(port, '127.0.0.1', callback)`

- [ ] **CRITICAL-01-B:** Update log message to show bind address
  - File: `src/extension.ts`
  - Change: Log `Server started on 127.0.0.1:${port}` instead of just port

### 1.2 API Key Authentication

- [ ] **CRITICAL-02-A:** Create `src/security.ts` with authentication utilities
  - Function: `validateApiKey(req, context)`
  - Function: `generateSecureApiKey()`
  - Use `crypto.randomBytes()` for key generation
  - Use VS Code Secrets API for storage

- [ ] **CRITICAL-02-B:** Add API key commands to extension
  - Command: `copilotProxy.generateApiKey` - Generate and store new key
  - Command: `copilotProxy.showApiKey` - Display current key (masked)
  - Command: `copilotProxy.clearApiKey` - Remove stored key
  - Register commands in `activate()`

- [ ] **CRITICAL-02-C:** Integrate auth check into request handler
  - File: `src/extension.ts` (createServer)
  - Add auth validation before processing requests
  - Return 401 for missing auth, 403 for invalid auth
  - Skip auth if `requireAuth` setting is false

**Phase 1 Acceptance Criteria:**

- [ ] Server ONLY binds to 127.0.0.1
- [ ] Cannot access API from network (even if port forwarded)
- [ ] API key auth works when enabled
- [ ] API key stored securely (not in plaintext settings)

---

## PHASE 2: HIGH-RISK FIXES (P1)

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-14 12:00:00 UTC-8
**Phase Completed:** TBD
**Phase Duration:** TBD

Priority: Should fix - Prevents information disclosure and abuse

### 2.1 Error Message Sanitization

- [ ] **HIGH-02-A:** Add `sanitizeErrorMessage()` function to `src/security.ts`
  - Remove file paths (Unix and Windows formats)
  - Remove stack traces
  - Map system errors (ENOENT, EACCES) to generic messages

- [ ] **HIGH-02-B:** Apply sanitization to all error responses
  - File: `src/extension.ts:314` - handleChatCompletion error handler
  - File: `src/extension.ts:392` - general error handler
  - Keep full error logged internally for debugging

### 2.2 CORS Restriction

- [ ] **HIGH-03-A:** Replace wildcard CORS with localhost-only
  - File: `src/extension.ts` (CORS headers)
  - Change `Access-Control-Allow-Origin: *` to `null`
  - Add `Access-Control-Allow-Credentials: true`

- [ ] **HIGH-03-B:** Add origin validation function
  - File: `src/security.ts`
  - Function: `validateRequestOrigin(req)`
  - Allow: no origin (direct API), localhost origins
  - Block: all other origins

- [ ] **HIGH-03-C:** Integrate origin check into request handler
  - Return 403 for invalid origins
  - Log blocked origin attempts

### 2.3 Prompt Validation (Optional Feature)

- [ ] **HIGH-01-A:** Add optional prompt content validation
  - File: `src/security.ts`
  - Function: `validatePromptContent(content)`
  - Pattern-based detection of jailbreak attempts
  - Disabled by default (opt-in via setting)

**Phase 2 Acceptance Criteria:**

- [ ] Error messages never contain file paths
- [ ] Error messages never contain stack traces
- [ ] External websites cannot access API via CORS
- [ ] Origin validation blocks non-localhost requests
- [ ] Prompt filtering available (if enabled)

---

## PHASE 3: HARDENING (P2)

**Status:** Not Started
**Progress:** 0/8 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-14 12:00:00 UTC-8
**Phase Completed:** TBD
**Phase Duration:** TBD

Priority: Should fix - Improves resilience and prevents abuse

### 3.1 Rate Limiting

- [ ] **LOW-04-A:** Implement `RateLimiter` class
  - File: `src/security.ts`
  - Track requests per client IP
  - Configurable limit and window
  - Return retry-after value when exceeded

- [ ] **LOW-04-B:** Integrate rate limiting into request handler
  - Check rate limit before processing
  - Return 429 with Retry-After header when exceeded
  - Log rate limit violations

### 3.2 Connection Limiting

- [ ] **MEDIUM-01-A:** Add connection tracking to server
  - Track active connections in a Set
  - Configurable max connections (default: 10)

- [ ] **MEDIUM-01-B:** Enforce connection limit
  - Return 503 when at capacity
  - Clean up on connection close

### 3.3 Input Validation Limits

- [ ] **MEDIUM-02-A:** Add message count limit to `validateRequest()`
  - File: `src/core.ts`
  - Max messages: 100 (configurable)
  - Return descriptive error

- [ ] **MEDIUM-02-B:** Add message length limit to `validateRequest()`
  - File: `src/core.ts`
  - Max length per message: 100000 chars (configurable)
  - Return descriptive error with index

### 3.4 Secure ID Generation

- [ ] **MEDIUM-04-A:** Replace `Math.random()` with `crypto.randomBytes()`
  - File: `src/core.ts:118-120`
  - Use `randomBytes(12).toString('hex')` for IDs

### 3.5 Timeout Consistency

- [ ] **MEDIUM-05-A:** Align timeout values
  - File: `src/core.ts:16` and `src/extension.ts:192`
  - Set consistent timeout (120s recommended)
  - Make configurable via settings

**Phase 3 Acceptance Criteria:**

- [ ] Rate limiting prevents abuse (60 req/min default)
- [ ] Connection limit prevents resource exhaustion
- [ ] Oversized requests rejected with clear errors
- [ ] IDs are cryptographically random
- [ ] Timeouts consistent across codebase

---

## PHASE 4: BEST PRACTICES (P3)

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-14 12:00:00 UTC-8
**Phase Completed:** TBD
**Phase Duration:** TBD

Priority: Could fix - Improves overall security posture

### 4.1 Security Headers

- [ ] **INFO-01-A:** Define security headers constant
  - File: `src/security.ts`
  - Include: X-Content-Type-Options, X-Frame-Options, etc.

- [ ] **INFO-01-B:** Apply security headers to all responses
  - File: `src/extension.ts`
  - Add to all `res.writeHead()` calls

### 4.2 Settings Validation

- [ ] **LOW-02-A:** Add setting validators
  - File: `src/security.ts`
  - Validate: port, autoStart, defaultModel, rateLimit
  - Type and range checking

- [ ] **LOW-02-B:** Apply validation in webview message handler
  - File: `src/extension.ts` (updateSetting handler)
  - Reject invalid values with user feedback

### 4.3 Model Refresh Race Condition

- [ ] **LOW-03-A:** Fix race condition in `refreshModels()`
  - File: `src/extension.ts:62-91`
  - Use promise-based locking instead of boolean flag
  - All callers await the same refresh operation

### 4.4 Configuration Settings

- [ ] **CONFIG-A:** Add security settings to package.json
  - `copilotProxy.requireAuth` (boolean, default: false)
  - `copilotProxy.rateLimit` (number, default: 60)
  - `copilotProxy.maxConnections` (number, default: 10)
  - `copilotProxy.maxMessages` (number, default: 100)
  - `copilotProxy.enablePromptFiltering` (boolean, default: false)

**Phase 4 Acceptance Criteria:**

- [ ] All responses include security headers
- [ ] Invalid settings rejected with feedback
- [ ] No race conditions in model refresh
- [ ] All security features configurable

---

## Documentation Tasks

- [ ] **DOC-01:** Update README with security section
  - Document API key setup
  - Document configuration options
  - Add security best practices

- [ ] **DOC-02:** Add inline code comments for security functions

- [ ] **DOC-03:** Create completion summary when feature is done
  - Location: `docs/features/security-hardening/completion/`

---

## Testing Tasks

- [ ] **TEST-01:** Manual testing - localhost binding
  - Verify server only accessible from localhost
  - Verify port forwarding doesn't expose API

- [ ] **TEST-02:** Manual testing - API key auth
  - Test with valid key
  - Test with invalid key
  - Test with missing key
  - Test key generation and rotation

- [ ] **TEST-03:** Manual testing - error sanitization
  - Trigger various errors
  - Verify no paths in responses

- [ ] **TEST-04:** Manual testing - CORS
  - Test from localhost page (should work)
  - Test from external page (should fail)

- [ ] **TEST-05:** Manual testing - rate limiting
  - Send rapid requests
  - Verify 429 response
  - Verify Retry-After header

---

## Notes

- All new features should be backward-compatible
- Security features should be opt-in where possible
- Keep VS Code output logging for debugging (don't remove)
- Focus on defense-in-depth - multiple layers of protection
