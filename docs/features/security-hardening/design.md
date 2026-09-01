# Security Hardening Feature Design

**Feature:** Security Hardening
**Status:** Complete (Sprints 1-4 implemented)
**Created:** 2025-12-14
**Last Updated:** 2026-09-01
**Last Updated By:** Dev Team (Sage/Nova/Milo)

> **Implementation note (Sprint 4):** This document originally described the *planned* design (see "Original Plan (Historical)" below for the as-written proposal). The sections above the historical appendix describe **what was actually implemented** across Sprints 1-4, which diverges from the original plan in several ways (SecretStorage-backed bearer token instead of a generated/displayed API key; deny-by-default auth; explicit CORS allowlist instead of `null`/localhost-regex; no rate limiting, connection limiting, or prompt-filtering features were implemented; metadata-only logging via bounded error categories instead of a generic `sanitizeErrorMessage()` path-stripping function).

## What Was Actually Built

### Sprint 1 - `src/security.ts` (pure helpers) + tests

- `LOOPBACK_HOST` constant (`127.0.0.1`)
- `parseBearerToken(header)` - extracts a bearer token from an `Authorization` header
- `constantTimeEqual(a, b)` - timing-safe string comparison for token checks
- `isAuthExemptRoute(path)` - identifies routes (currently `GET /health`) exempt from auth
- `normalizeOrigin(origin)` / `isOriginAllowed(origin, allowlist)` - origin allowlist matching (exact match, no wildcards)
- `buildCorsHeaders(origin, allowlist)` - returns CORS headers only when origin is present and allowlisted; otherwise no `Access-Control-Allow-Origin` header at all
- `categorizeError(error)` - maps arbitrary errors to a small fixed set of category strings (never raw exception text/stack traces/paths)
- `validateMaxToolRounds(value)` - validates `max_tool_rounds` is an integer in `[1, MAX_TOOL_ROUNDS_CAP]` (100); returns error for out-of-range/invalid values
- `isAutoExecutionAllowed(requestedMode, settingEnabled)` - a client's `tool_execution: "auto"` is only honored if `copilotProxy.allowAutoToolExecution` is `true`
- `MAX_TOOL_ROUNDS_CAP = 100`, `DEFAULT_TOOL_ROUNDS = 10`
- `src/test/security.test.ts` - unit tests for all of the above

### Sprint 2 - wiring into `package.json` and `src/extension.ts`

- New settings: `copilotProxy.allowedOrigins` (array, default `[]`), `copilotProxy.allowAutoToolExecution` (boolean, default `false`)
- New command: `copilot-proxy.setProxyToken` - prompts for and stores a bearer token via `context.secrets` (VS Code SecretStorage), never written to settings/files
- `authenticateRequest()` in `extension.ts`: reads the stored token, extracts the request's bearer token, does a constant-time comparison; **deny-by-default** if no token has been set (all non-exempt requests are rejected with `401`); `GET /health` is exempt
- CORS responses built via `buildCorsHeaders()` - no wildcard `*`, only allowlisted origins are echoed
- `server.listen()` uses the shared `LOOPBACK_HOST` constant (still `127.0.0.1`, but now sourced from `security.ts` rather than a literal)
- Tool-execution gating wired via `isAutoExecutionAllowed()` / `validateMaxToolRounds()` - a client cannot self-enable auto-execution; `max_tool_rounds` outside `[1,100]` returns `400`
- `src/test/extension-integration.test.ts` - 9 integration tests covering auth, CORS, and tool-exec gating

### Sprint 3 - logging hardening

- Removed `logRaw()` entirely and the `copilotProxy.rawLogging` setting completely - there is no raw/verbose logging mode
- `addRequestLog()`'s persisted `errorMessage` field now always uses `categorizeError(error)` (fixed enum of categories), never raw exception text
- Client-facing HTTP error responses still use the existing human-readable `describeRequestError(error)` (intentional: this is a log-vs-response distinction, not a regression - log storage never contains raw text, but the client still gets an understandable error response)
- Tool-call logging is metadata-only (argument character count, not argument content)
- `src/test/log-redaction.test.ts` - 6 tests verifying no raw content or stack traces reach persisted logs

### Sprint 4 - documentation + final verification (this sprint)

- No further source logic changes
- README.md, `docs/CONFIGURATION.md`, `docs/features/tool-calling/design.md`, `docs/FEATURE_INVENTORY.md`, and this file updated to accurately describe the implemented behavior
- Full verification: `npm run compile`, `npm run lint`, `npm test`, and (if present) `npm run docs:check`
- Local `.vsix` packaging via `vsce package` for handoff/QA

## Divergences From the Original Plan (Historical, see appendix)

| Original Plan | What Was Actually Built | Why |
|---|---|---|
| Generated/displayed API key (`generateApiKey`, `showApiKey`, `rotateApiKey` commands); `requireAuth` opt-in setting (default `false`) | Single `copilot-proxy.setProxyToken` command; user supplies their own token; auth is **always on** and **deny-by-default** (no `requireAuth` opt-out) | Simpler UX, and always-on auth closes the "forgot to enable it" gap entirely |
| CORS: `Access-Control-Allow-Origin: null` + regex-based localhost-only origin validation | CORS: explicit `copilotProxy.allowedOrigins` array allowlist, exact match only, no regex/wildcard | Explicit allowlist is more auditable and avoids regex bypass edge cases; also supports legitimate non-localhost dev origins (e.g. a LAN dev box) the user explicitly trusts |
| `sanitizeErrorMessage()` - regex-strips file paths/stack traces from error text, falls back to generic messages for known system error codes | `categorizeError()` - maps to a small fixed enum of categories; no attempt to selectively redact substrings of arbitrary error text | Categorization is a stronger guarantee than best-effort regex redaction (regex redaction can miss unanticipated leak patterns) |
| Rate limiting (`RateLimiter` class, 429 responses), connection limiting (503 responses), prompt-content filtering, security response headers (`X-Content-Type-Options` etc.), settings validation for webview updates | **Not implemented** - out of scope for Sprints 1-4 | These were P2/P3 items in the original phased plan; the delivered sprints focused on the P0/P1-equivalent items (localhost binding, auth, CORS, error/log redaction) plus tool-exec gating which was newly identified during implementation. Not fixing a bug silently - flagging as a known gap below. |
| `MAX_MESSAGES`/`MAX_MESSAGE_LENGTH` input validation limits, crypto-random ID generation, connection/rate-limit settings in `package.json` | **Not implemented** | Same as above - out of scope for the delivered sprints |

## Known Gaps / Not Implemented (carried forward, not silently dropped)

The following P2/P3 items from the original assessment were **not** addressed in Sprints 1-4 and remain open for a future sprint if desired:

- Rate limiting / 429 responses
- Connection limiting / 503 responses
- Security response headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.)
- Optional prompt-content/jailbreak filtering
- `MAX_MESSAGES` / `MAX_MESSAGE_LENGTH` input validation limits
- `crypto.randomBytes()`-based ID generation (still uses prior ID generation scheme)
- Settings validation for webview `updateSetting` handler

---

## Original Plan (Historical)

*The remainder of this document is the original Sprint-0 design proposal, preserved for historical reference. It does not reflect final implementation - see "What Was Actually Built" above for the authoritative description.*

**Original Status:** Planning
**Original Created:** 2025-12-14

## Overview

This feature implements security hardening improvements identified in the VS Code Copilot Proxy security assessment. The goal is to address all CRITICAL, HIGH, and MEDIUM severity findings to make the extension safe for general development use.

## Background

A comprehensive security audit identified 17 security findings:

- 2 CRITICAL issues (network exposure, no authentication)
- 3 HIGH issues (prompt injection, information disclosure, CORS)
- 5 MEDIUM issues (DoS vectors, input validation, XSS)
- 4 LOW issues (logging, settings validation, race conditions)
- 3 INFORMATIONAL (security headers, audit logging)

Reference: `VSCode_Copilot_Proxy_Security_Assessment.md`

## Goals

1. Enforce localhost-only binding to prevent network exposure
2. Implement optional API key authentication
3. Sanitize error messages to prevent information disclosure
4. Restrict CORS and validate request origins
5. Add rate limiting and connection controls
6. Implement input validation limits
7. Add security headers to all responses

## Non-Goals

- Full enterprise security features (OAuth, RBAC)
- HTTPS/TLS support (localhost-only, not needed)
- Advanced threat detection/AI-based filtering
- Persistent audit logging (keep simple VS Code output)

## Architecture

### Component Changes

```
src/
  extension.ts       # Server creation, CORS, auth middleware
  core.ts           # Input validation, error sanitization, rate limiting
  security.ts       # NEW: Security utilities (auth, sanitization, headers)
```

### Security Middleware Stack

```
Request
    |
    v
[1. Connection Limit Check] --> 503 if exceeded
    |
    v
[2. Origin Validation] --> 403 if invalid origin
    |
    v
[3. Rate Limit Check] --> 429 if exceeded
    |
    v
[4. API Key Auth] --> 401/403 if invalid
    |
    v
[5. Input Validation] --> 400 if invalid
    |
    v
[Handler] --> Response with security headers
```

### Configuration Schema

New VS Code settings for security features:

```typescript
interface SecuritySettings {
  // Authentication
  apiKey?: string;           // Optional API key (stored in VS Code secrets)
  requireAuth: boolean;      // Default: false

  // Network
  bindAddress: string;       // Default: '127.0.0.1' (HARDCODED, not configurable)
  allowNetworkBinding: boolean; // Default: false (requires explicit opt-in)

  // Rate Limiting
  rateLimit: number;         // Default: 60 requests/min
  rateLimitWindow: number;   // Default: 60000ms
  maxConnections: number;    // Default: 10

  // Input Limits
  maxMessages: number;       // Default: 100
  maxMessageLength: number;  // Default: 100000 chars

  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug';  // Default: 'info'
}
```

## Detailed Design

### Phase 1: Critical Fixes

#### 1.1 Localhost Binding Enforcement (CRITICAL-01)

**Change:** Modify `server.listen()` to explicitly bind to `127.0.0.1`

```typescript
// Before
server.listen(port, async () => { ... });

// After
server.listen(port, '127.0.0.1', async () => {
    log(`Server started on 127.0.0.1:${port}`);
});
```

**Files:** `src/extension.ts:418`

#### 1.2 API Key Authentication (CRITICAL-02)

**New function in `src/security.ts`:**

```typescript
export async function validateApiKey(
    req: http.IncomingMessage,
    context: vscode.ExtensionContext
): Promise<{ valid: boolean; error?: string }> {
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const requireAuth = config.get<boolean>('requireAuth', false);

    if (!requireAuth) {
        return { valid: true };
    }

    const storedKey = await context.secrets.get('copilotProxy.apiKey');
    if (!storedKey) {
        return { valid: false, error: 'API key not configured' };
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return { valid: false, error: 'Missing authorization header' };
    }

    const providedKey = authHeader.substring(7);
    if (providedKey !== storedKey) {
        return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
}
```

**Commands to add:**

- `copilotProxy.generateApiKey` - Generate new random API key
- `copilotProxy.showApiKey` - Display current API key
- `copilotProxy.rotateApiKey` - Generate new key, invalidate old

### Phase 2: High-Risk Fixes

#### 2.1 Error Message Sanitization (HIGH-02)

**New function in `src/security.ts`:**

```typescript
export function sanitizeErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'An unexpected error occurred';
    }

    let message = error.message;

    // Remove file paths (Unix and Windows)
    message = message.replace(/\/[\w\-\.\/]+/g, '[REDACTED]');
    message = message.replace(/[A-Z]:\\[\w\-\.\\]+/gi, '[REDACTED]');

    // Remove stack traces
    message = message.split('\n')[0];

    // Generic message for system errors
    if (/ENOENT|EACCES|EPERM|ECONNREFUSED/.test(message)) {
        return 'Internal server error';
    }

    return message;
}
```

#### 2.2 CORS Restriction (HIGH-03)

**Replace wildcard CORS with localhost-only:**

```typescript
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'null',  // Local files only
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true'
} as const;

function validateOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    // Allow no origin (direct API calls) or localhost origins
    if (!origin) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
```

#### 2.3 Basic Prompt Validation (HIGH-01)

**Configurable pattern-based filtering (optional, off by default):**

```typescript
const SUSPICIOUS_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+a/i,
    /pretend\s+you\s+are/i,
    /jailbreak/i,
    /DAN\s+mode/i
];

export function validatePromptContent(content: string): string | null {
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const enableFiltering = config.get<boolean>('enablePromptFiltering', false);

    if (!enableFiltering) return null;

    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
            return 'Potentially harmful content detected';
        }
    }
    return null;
}
```

### Phase 3: Hardening

#### 3.1 Rate Limiting (LOW-04, MEDIUM-01)

```typescript
class RateLimiter {
    private requests = new Map<string, { count: number; resetAt: number }>();

    constructor(
        private limit: number = 60,
        private windowMs: number = 60000
    ) {}

    check(clientId: string): { allowed: boolean; retryAfter?: number } {
        const now = Date.now();
        const record = this.requests.get(clientId);

        if (!record || now > record.resetAt) {
            this.requests.set(clientId, { count: 1, resetAt: now + this.windowMs });
            return { allowed: true };
        }

        if (record.count >= this.limit) {
            return { allowed: false, retryAfter: record.resetAt - now };
        }

        record.count++;
        return { allowed: true };
    }
}
```

#### 3.2 Connection Limiting (MEDIUM-01)

```typescript
const activeConnections = new Set<http.IncomingMessage>();
const MAX_CONNECTIONS = 10;

// In request handler:
if (activeConnections.size >= MAX_CONNECTIONS) {
    sendErrorResponse(res, 503, 'Server busy', 'service_unavailable');
    return;
}
activeConnections.add(req);
req.on('close', () => activeConnections.delete(req));
```

#### 3.3 Input Validation Limits (MEDIUM-02)

Update `validateRequest()` in `src/core.ts`:

```typescript
const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 100000;

if (request.messages.length > MAX_MESSAGES) {
    return `Too many messages (max: ${MAX_MESSAGES})`;
}

for (const msg of request.messages) {
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
        return `Message content too long (max: ${MAX_MESSAGE_LENGTH} chars)`;
    }
}
```

#### 3.4 Secure ID Generation (MEDIUM-04)

```typescript
import { randomBytes } from 'crypto';

export function generateId(): string {
    return 'chatcmpl-' + randomBytes(12).toString('hex');
}
```

### Phase 4: Best Practices

#### 4.1 Security Headers (INFO-01)

```typescript
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
} as const;
```

#### 4.2 Settings Validation (LOW-02)

```typescript
const SETTING_VALIDATORS: Record<string, (value: unknown) => boolean> = {
    port: (v) => typeof v === 'number' && v >= 1 && v <= 65535,
    autoStart: (v) => typeof v === 'boolean',
    defaultModel: (v) => typeof v === 'string',
    rateLimit: (v) => typeof v === 'number' && v >= 1 && v <= 1000,
};

function validateSettingUpdate(key: string, value: unknown): boolean {
    const validator = SETTING_VALIDATORS[key];
    return validator ? validator(value) : false;
}
```

## Testing Strategy

### Unit Tests

- API key generation and validation
- Error message sanitization
- Origin validation
- Rate limiter behavior
- Input validation limits

### Integration Tests

- Server binds only to localhost
- Auth rejection for invalid keys
- CORS blocking for external origins
- Rate limiting enforced
- Large payload rejection

### Manual Testing

- Verify network exposure blocked
- Test API key workflow (generate, use, rotate)
- Test error messages don't leak paths
- Test streaming with auth headers

## Rollout Plan

1. **Phase 1:** Ship with CRITICAL fixes, auth disabled by default
2. **Phase 2:** Add HIGH fixes, prompt filtering disabled by default
3. **Phase 3:** Add hardening features with sensible defaults
4. **Phase 4:** Add remaining improvements

## Security Considerations

- API keys stored in VS Code Secrets API (encrypted)
- No breaking changes - all new features opt-in
- Localhost binding hardcoded, not configurable
- Rate limits configurable but have sensible defaults

## Open Questions

1. Should we add a "developer mode" that disables all security for local testing?
2. Should rate limits apply per-client-IP or globally?
3. Should we support multiple API keys for different clients?

## References

- `VSCode_Copilot_Proxy_Security_Assessment.md`
- [VS Code Extension Security Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
