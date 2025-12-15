# Code Health Refactor - Design Document

## Overview

This document outlines the findings from a comprehensive senior code review of the vscode-copilot-proxy codebase and defines the architectural improvements needed to address critical security, maintainability, and quality issues.

## Current State Assessment

The codebase demonstrates good architectural instincts - core utilities were extracted to a separate module for testability, and comprehensive unit tests exist for pure functions. However, the refactoring was incomplete, leaving critical gaps in security, code organization, and test coverage.

### Strengths

- Clean separation of HTTP server and VS Code integration
- Testable pure functions extracted to core.ts
- 67 passing unit tests for core utilities
- Good README documentation
- Proper VS Code extension lifecycle management

### Weaknesses

- Incomplete refactoring left duplicate code
- Security-critical validation code exists but is unused
- No integration tests for HTTP endpoints
- Global mutable state creates race conditions
- Inconsistent error handling patterns

## Critical Issues

### Issue 1: Duplicate Type Definitions and Logic

**Problem**: The same interfaces and utility functions are defined in both `extension.ts` and `core.ts`. This includes:

- ChatMessage, ChatCompletionRequest, OpenAIResponse, StreamChunk interfaces
- Model matching logic (getModel vs findBestModel)
- ID generation, HTML escaping utilities

**Impact**:

- Bug fixes must be applied in two places
- Increased maintenance burden
- Test coverage gives false confidence
- Larger bundle size

**Resolution Strategy**: Remove all duplicates from extension.ts and import from core.ts. The core.ts module should be the single source of truth for all shared types and utilities.

### Issue 2: Missing Request Validation

**Problem**: The `validateRequest()` function exists in core.ts but is never called in the actual request handler. Incoming requests are parsed and used without any validation.

**Impact**:

- Malformed requests could cause crashes
- No protection against malicious payloads
- Missing required fields cause runtime errors
- Security vulnerability

**Resolution Strategy**: Integrate existing validation into the request handler pipeline. Add proper error responses for validation failures.

### Issue 3: No Request Size Limits

**Problem**: The HTTP server accepts requests of any size with no limits on body size, headers, or connection duration.

**Impact**:

- Memory exhaustion via large request bodies (DoS vector)
- Connection exhaustion via slow-loris attacks
- VS Code instance could crash

**Resolution Strategy**: Add configurable limits for request body size (10MB default), request timeout (30s), and connection limits.

### Issue 4: ESLint Errors Block Testing

**Problem**: Multiple ESLint errors prevent the test suite from running:

- `let` used instead of `const` for non-reassigned variables
- Unused variable declarations
- Missing braces around case blocks

**Impact**:

- Tests cannot run
- CI/CD pipeline would fail
- Developer workflow friction

**Resolution Strategy**: Fix all linting errors immediately as they are blocking issues.

## Architectural Concerns

### Issue 5: Global Mutable State

**Problem**: Module-level variables manage all state (server, statusPanel, cachedModels, etc.) without coordination between async operations.

**Impact**:

- Race conditions between concurrent operations
- Difficult to test in isolation
- Memory leaks possible from improper cleanup

**Resolution Strategy**: Encapsulate state in a dedicated state management class with proper access control and locking mechanisms.

### Issue 6: Inconsistent Error Handling

**Problem**: Error handling varies across the codebase:

- Some errors show UI dialogs, others only log
- Stream errors send invalid SSE format
- Some operations silently swallow errors

**Impact**:

- Inconsistent user experience
- Clients cannot reliably parse errors
- Silent failures hide problems

**Resolution Strategy**: Define and implement a consistent error handling strategy with centralized error utilities.

### Issue 7: Complex Model Matching

**Problem**: The model matching algorithm uses magic numbers and complex string operations without clear documentation or comprehensive edge case testing.

**Impact**:

- Unpredictable behavior for edge cases
- Hard to tune or debug
- Difficult to explain to users

**Resolution Strategy**: Simplify and document the scoring system with clear priority tiers and comprehensive test coverage.

## Security Considerations

### Security Model

Copilot Proxy is designed for trusted local development environments only.

**Network Security:**

- Server binds to `127.0.0.1` (localhost only) - prevents network access
- Not designed for production or multi-user deployment

**Authentication:**

- No authentication required by design
- Rationale: Localhost binding provides sufficient access control
- VS Code manages Copilot credentials securely

**CORS:**

- Allows all origins (`Access-Control-Allow-Origin: *`)
- Rationale: Required for browser-based local tools; localhost binding limits risk

### Implemented Protections

| Protection | Implementation | Value |
|------------|----------------|-------|
| Request size limit | `MAX_REQUEST_BODY_SIZE` | 10 MB |
| Request timeout | `REQUEST_TIMEOUT_MS` | 30 seconds |
| Keep-alive timeout | `KEEP_ALIVE_TIMEOUT_MS` | 5 seconds |
| Input validation | `validateRequest()` | All requests validated |

### Security Documentation

Full security model documented in:

- README.md (user-facing) - Security section with best practices
- This document (developer-facing) - Implementation details

### Acceptable Risks (Documented)

- Localhost-only binding acceptable for intended use case
- No authentication acceptable for trusted local environment
- Open CORS acceptable for local browser-based tools
- Users advised not to expose to network

## Test Coverage Analysis

### Currently Tested

- HTML escaping (9 tests)
- ID generation (3 tests)
- Token estimation (5 tests)
- Context size calculation (3 tests)
- Version extraction (5 tests)
- Model scoring (5 tests)
- Model selection (9 tests)
- Response formatting (10 tests)
- Request parsing and validation (11 tests)
- Log formatting (6 tests)

### Not Tested

- Extension activation and deactivation
- HTTP server endpoints (integration)
- VS Code API integration
- Error handling paths
- WebView panel interactions
- Configuration changes
- Streaming behavior
- Model caching and refresh

### Coverage Goals

- Achieve 80% coverage for extension.ts
- Add integration tests for all HTTP endpoints
- Add error scenario tests

## Performance Considerations

### Issue: Model Refresh on Every Request

The `/v1/models` endpoint refreshes models from VS Code API on every request with no caching strategy.

**Resolution**: Implement TTL-based caching (60 second default) with forced refresh capability.

### Issue: WebView HTML Generation

The status panel HTML (391 lines) is regenerated as a string on every update.

**Resolution**: Consider extracting templates or using VS Code webview UI toolkit in future iteration.

## Implementation Principles

### Code Organization

- Single source of truth for types and utilities (core.ts)
- Extension.ts focuses on VS Code integration and HTTP server
- Clear separation between pure functions and side effects

### Error Handling Standards

**Logging Strategy:**

- All errors logged to output channel with timestamps via `logError()`
- Errors include both high-level message and detailed exception info when available

**HTTP Error Response Format:**

All HTTP errors use the `sendErrorResponse()` helper which calls `createErrorResponse()` from core.ts, ensuring consistent format:

```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "error_type_identifier",
    "code": 400
  }
}
```

**Error Types:**

| Code | Type | When Used |
|------|------|-----------|
| 400 | `invalid_request_error` | Invalid JSON, validation failures |
| 404 | `not_found` | Unknown endpoint |
| 408 | `timeout_error` | Request timeout |
| 413 | `invalid_request_error` | Request body too large |
| 500 | `server_error` | Internal errors, model failures |
| 503 | `service_unavailable` | No models available |

**Streaming Errors:**

Streaming errors use SSE format with same error structure:
```
data: {"error":{"message":"...","type":"server_error","code":500}}
```

**UI Notifications:**

- VS Code notifications only for user-actionable errors (server start failure, port in use)
- Silent logging for recoverable errors (timeout, individual request failures)

### Testing Standards

- Unit tests for all pure functions
- Integration tests for HTTP endpoints
- Error scenario coverage
- Mock VS Code APIs for extension tests

## Success Criteria

1. All ESLint errors resolved
2. Zero duplicate type definitions
3. Request validation active on all endpoints
4. Request size and timeout limits enforced
5. Test coverage >= 80% for extension.ts
6. All HTTP error responses follow consistent format
7. Security model documented in README

## Dependencies

- No new external dependencies required
- All fixes use existing Node.js and VS Code APIs
- Test infrastructure already in place (mocha, chai, sinon)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking changes during refactor | Medium | High | Incremental changes with tests |
| Performance regression | Low | Medium | Benchmark before/after |
| VS Code API changes | Low | Medium | Pin VS Code engine version |
| Incomplete migration | Medium | Medium | Track with task list |

## Future Considerations

Items identified but deferred to future iterations:

- Extract HTTP server to separate module
- Add metrics and monitoring endpoints
- Consider TypeScript strict mode
- Evaluate webview UI toolkit adoption
- Add request logging middleware pattern
