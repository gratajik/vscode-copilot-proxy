# Code Health Refactor - Tasks

## Status: In Progress

Last Updated: 2025-12-14 15:30:00 UTC-8
Last Updated by: Claude Code

**Phase Started**: 2025-12-14 15:30:00 UTC-8

## Summary

Comprehensive refactoring to address critical security, maintainability, and code quality issues identified in senior code review. Work is organized into four phases by priority.

## Phase 1: Critical Fixes (Week 1)

Priority: **CRITICAL** - Blocking issues that must be fixed immediately

### Task 1.1: Fix ESLint Errors

**Status**: [x] Complete
**Started**: 2025-12-14 15:30:00 UTC-8
**Completed**: 2025-12-14 15:35:00 UTC-8
**Duration**: 5 minutes

Resolve all linting errors that block test execution.

- [x] 1.1.1: Change `let` to `const` in core.ts line 185 (requested variable never reassigned)
- [x] 1.1.2: Prefix unused `port` parameter with `_` in extension.ts createServer function
- [x] 1.1.3: Remove unused `port` variable in showStatus function
- [x] 1.1.4: Remove unused `isRunning` variable in showStatus function
- [x] 1.1.5: Wrap case block in braces for updateSetting handler (lexical declaration issue)
- [x] 1.1.6: Run `npm run lint` to verify all errors resolved
- [x] 1.1.7: Run `npm test` to verify tests pass (67 passing)

**Actual Effort**: 5 minutes

### Task 1.2: Implement Request Validation

**Status**: [x] Complete
**Started**: 2025-12-14 15:36:00 UTC-8
**Completed**: 2025-12-14 15:40:00 UTC-8
**Duration**: 4 minutes

Integrate existing validateRequest() function into request pipeline.

- [x] 1.2.1: Import parseRequestBody and validateRequest from core.ts into extension.ts
- [x] 1.2.2: Replace direct JSON.parse with parseRequestBody call in handleChatCompletion
- [x] 1.2.3: Add null check for parseRequestBody result with 400 error response
- [x] 1.2.4: Call validateRequest on parsed request body
- [x] 1.2.5: Return 400 error with validation message if validation fails
- [x] 1.2.6: Import createErrorResponse from core.ts for consistent error formatting
- [ ] 1.2.7: Add unit tests for validation error paths (deferred - integration tests)
- [ ] 1.2.8: Manual test with malformed JSON request (deferred - requires running server)
- [ ] 1.2.9: Manual test with missing messages field (deferred - requires running server)

**Actual Effort**: 4 minutes
**Notes**: Validation now active. Manual tests deferred to Phase 4 integration testing.

### Task 1.3: Remove Duplicate Code

**Status**: [x] Complete
**Started**: 2025-12-14 15:45:00 UTC-8
**Completed**: 2025-12-14 15:50:00 UTC-8
**Duration**: 5 minutes

Consolidate all types and utilities in core.ts as single source of truth.

- [x] 1.3.1: Remove ChatMessage interface from extension.ts (use core.ts)
- [x] 1.3.2: Remove ChatCompletionRequest interface from extension.ts
- [x] 1.3.3: Remove OpenAIResponse interface from extension.ts
- [x] 1.3.4: Remove StreamChunk interface from extension.ts
- [x] 1.3.5: Remove ModelInfo interface from extension.ts
- [x] 1.3.6: Remove SettingsInfo interface from extension.ts
- [x] 1.3.7: Add necessary imports from core.ts at top of extension.ts
- [x] 1.3.8: Remove generateId function from extension.ts (import from core.ts)
- [x] 1.3.9: Remove escapeHtml function from extension.ts (import from core.ts)
- [x] 1.3.10: Refactor getModel to use findBestModel from core.ts internally
- [x] 1.3.11: Update all type references throughout extension.ts
- [x] 1.3.12: Run TypeScript compiler to verify no type errors
- [x] 1.3.13: Run tests to verify functionality preserved (67 passing)

**Actual Effort**: 5 minutes
**Notes**: Removed ~80 lines of duplicate code. getModel now delegates to findBestModel from core.ts.

## Phase 2: Security Hardening (Week 2)

Priority: **HIGH** - Security vulnerabilities that need prompt attention

### Task 2.1: Add Request Size Limits

**Status**: [x] Complete
**Started**: 2025-12-14 15:52:00 UTC-8
**Completed**: 2025-12-14 15:58:00 UTC-8
**Duration**: 6 minutes

Prevent memory exhaustion from oversized requests.

- [x] 2.1.1: Define MAX_REQUEST_BODY_SIZE constant (10MB recommended)
- [x] 2.1.2: Track accumulated body size in request data handler
- [x] 2.1.3: Destroy request and return 413 if size exceeds limit
- [x] 2.1.4: Add 413 error response with "Request body too large" message
- [x] 2.1.5: Add unit test for MAX_REQUEST_BODY_SIZE constant
- [x] 2.1.6: Document size limit in README

**Actual Effort**: 6 minutes
**Notes**: Added constant to core.ts, size tracking in handleChatCompletion, 2 new tests (69 total).

### Task 2.2: Add Request Timeout

**Status**: [x] Complete
**Started**: 2025-12-14 16:00:00 UTC-8
**Completed**: 2025-12-14 16:06:00 UTC-8
**Duration**: 6 minutes

Prevent connection exhaustion from slow requests.

- [x] 2.2.1: Define REQUEST_TIMEOUT_MS constant (30000ms recommended)
- [x] 2.2.2: Set req.setTimeout in request handler
- [x] 2.2.3: Return 408 error on timeout
- [x] 2.2.4: Configure server.timeout for overall connection limit
- [x] 2.2.5: Configure server.keepAliveTimeout (5000ms)
- [x] 2.2.6: Add tests for timeout constants (4 new tests, 73 total)
- [x] 2.2.7: Document timeout in README

**Actual Effort**: 6 minutes
**Notes**: Added REQUEST_TIMEOUT_MS and KEEP_ALIVE_TIMEOUT_MS constants. Request handler and server-level timeouts configured.

### Task 2.3: Standardize Error Handling

**Status**: [x] Complete
**Started**: 2025-12-14 16:08:00 UTC-8
**Completed**: 2025-12-14 16:15:00 UTC-8
**Duration**: 7 minutes

Create consistent error handling across all code paths.

- [x] 2.3.1: Create sendErrorResponse utility function in extension.ts
- [x] 2.3.2: Define error handling strategy (when to log, when to show UI, when to return HTTP error)
- [x] 2.3.3: Update handleChatCompletion to use centralized error handling
- [x] 2.3.4: Update 404 handler to use centralized error handling
- [x] 2.3.5: Fix streaming error format (use proper SSE event format with createErrorResponse)
- [x] 2.3.6: refreshModels already logs errors (verified)
- [x] 2.3.7: Update all try-catch blocks to follow error strategy
- [x] 2.3.8: Existing tests verify createErrorResponse format consistency
- [x] 2.3.9: Document error handling strategy in design.md (detailed table of error codes)

**Actual Effort**: 7 minutes
**Notes**: Created sendErrorResponse helper function. Standardized all 8 error paths to use consistent format. Updated design.md with comprehensive error handling documentation.

### Task 2.4: Document Security Model

**Status**: [x] Complete
**Started**: 2025-12-14 16:17:00 UTC-8
**Completed**: 2025-12-14 16:22:00 UTC-8
**Duration**: 5 minutes

Clearly document security assumptions and limitations.

- [x] 2.4.1: Add Security section to README
- [x] 2.4.2: Document localhost-only binding
- [x] 2.4.3: Document no-authentication design decision
- [x] 2.4.4: Document CORS configuration
- [x] 2.4.5: Document request limits (table format)
- [x] 2.4.6: Add security considerations to design.md

**Actual Effort**: 5 minutes
**Notes**: Added comprehensive Security section to README with subsections for each area. Updated design.md with implementation table.

## Phase 3: Architecture Improvements (Week 3)

Priority: **MEDIUM** - Structural improvements for maintainability

### Task 3.1: Refactor State Management

**Status**: [ ] Not Started

Encapsulate global state to prevent race conditions.

- [ ] 3.1.1: Design ProxyServerState class interface
- [ ] 3.1.2: Create ProxyServerState class with private state variables
- [ ] 3.1.3: Add getters for read access to state
- [ ] 3.1.4: Add setters with validation for state mutations
- [ ] 3.1.5: Implement promise-based locking for refreshModels
- [ ] 3.1.6: Add server running state check before starting
- [ ] 3.1.7: Migrate server variable to state class
- [ ] 3.1.8: Migrate statusBarItem to state class
- [ ] 3.1.9: Migrate outputChannel to state class
- [ ] 3.1.10: Migrate statusPanel to state class
- [ ] 3.1.11: Migrate cachedModels to state class
- [ ] 3.1.12: Update all state access to use new class
- [ ] 3.1.13: Add unit tests for state class
- [ ] 3.1.14: Test concurrent operation handling

**Estimated Effort**: 1 day

### Task 3.2: Simplify Model Matching

**Status**: [ ] Not Started

Make model matching logic clearer and more testable.

- [ ] 3.2.1: Document scoring priorities (exact match, family match, fuzzy match)
- [ ] 3.2.2: Replace magic numbers with named constants
- [ ] 3.2.3: Simplify version matching logic
- [ ] 3.2.4: Add word boundary checks for partial matches
- [ ] 3.2.5: Add comprehensive edge case tests
- [ ] 3.2.6: Add logging for match decisions (debug level)
- [ ] 3.2.7: Update design.md with matching algorithm documentation

**Estimated Effort**: 4 hours

### Task 3.3: Improve System Message Handling

**Status**: [ ] Not Started

Better handle VS Code API limitation around system messages.

- [ ] 3.3.1: Log warning when system messages are converted
- [ ] 3.3.2: Consider prepending system content to first user message
- [ ] 3.3.3: Document limitation in README
- [ ] 3.3.4: Add tests for system message conversion
- [ ] 3.3.5: Consider adding configuration option for handling strategy

**Estimated Effort**: 2 hours

## Phase 4: Testing and Polish (Week 4)

Priority: **MEDIUM** - Quality improvements and coverage

### Task 4.1: Add Integration Tests

**Status**: [ ] Not Started

Test HTTP endpoints and VS Code integration.

- [ ] 4.1.1: Set up integration test infrastructure
- [ ] 4.1.2: Create mock VS Code API for testing
- [ ] 4.1.3: Add test for POST /v1/chat/completions success path
- [ ] 4.1.4: Add test for POST /v1/chat/completions with streaming
- [ ] 4.1.5: Add test for GET /v1/models endpoint
- [ ] 4.1.6: Add test for GET /health endpoint
- [ ] 4.1.7: Add test for 404 on unknown endpoint
- [ ] 4.1.8: Add test for CORS preflight handling
- [ ] 4.1.9: Add test for request size limit rejection
- [ ] 4.1.10: Add test for request timeout
- [ ] 4.1.11: Add test for validation error responses
- [ ] 4.1.12: Add test for concurrent requests

**Estimated Effort**: 1 day

### Task 4.2: Add Error Path Tests

**Status**: [ ] Not Started

Ensure error handling is thoroughly tested.

- [ ] 4.2.1: Test model not found scenario
- [ ] 4.2.2: Test VS Code API timeout scenario
- [ ] 4.2.3: Test malformed JSON request
- [ ] 4.2.4: Test missing required fields
- [ ] 4.2.5: Test invalid message roles
- [ ] 4.2.6: Test streaming error mid-response
- [ ] 4.2.7: Test server start when already running
- [ ] 4.2.8: Test server stop when not running

**Estimated Effort**: 4 hours

### Task 4.3: Performance Optimization

**Status**: [ ] Not Started

Improve response times and resource usage.

- [ ] 4.3.1: Implement TTL-based model caching
- [ ] 4.3.2: Add cache expiry constant (60 seconds recommended)
- [ ] 4.3.3: Update handleModels to use cached models
- [ ] 4.3.4: Add cache hit/miss logging
- [ ] 4.3.5: Add force refresh capability for model list
- [ ] 4.3.6: Measure and document performance improvements

**Estimated Effort**: 2 hours

### Task 4.4: Code Cleanup

**Status**: [ ] Not Started

Final polish and cleanup tasks.

- [ ] 4.4.1: Extract CORS headers to reusable constant
- [ ] 4.4.2: Extract magic numbers to named constants (port, timeouts, etc.)
- [ ] 4.4.3: Ensure consistent string formatting (template literals)
- [ ] 4.4.4: Review and update all JSDoc comments
- [ ] 4.4.5: Run final lint check
- [ ] 4.4.6: Run full test suite
- [ ] 4.4.7: Update version number if appropriate
- [ ] 4.4.8: Final manual testing of all features

**Estimated Effort**: 2 hours

## Verification Checklist

Before marking this feature complete:

- [ ] All ESLint errors resolved
- [ ] All tests passing
- [ ] Test coverage >= 80% for extension.ts
- [ ] No duplicate type definitions
- [ ] Request validation active
- [ ] Request limits enforced
- [ ] Error handling consistent
- [ ] Security model documented
- [ ] Design.md updated with final state
- [ ] README updated as needed

## Notes

- All code changes should be incremental with tests at each step
- Run `npm test` after each task to verify no regressions
- Run `npm run compile` to check TypeScript errors
- Manual testing recommended after each phase completion
- Consider creating separate branches for each phase

## Time Estimates Summary

| Phase | Estimated Effort |
|-------|------------------|
| Phase 1: Critical Fixes | 6.5 hours |
| Phase 2: Security Hardening | 6 hours |
| Phase 3: Architecture | 1.5 days |
| Phase 4: Testing & Polish | 1.5 days |
| **Total** | **~4-5 days** |
