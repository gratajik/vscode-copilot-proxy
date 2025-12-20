# Source File Mapping

Maps source code files to their corresponding feature documentation.

---

## Source Files

### src/extension.ts

**Primary File:** Main extension entry point

| Feature | Functions/Sections |
|---------|-------------------|
| Copilot Proxy | `handleChatCompletion`, `handleModels`, `handleHealth`, `createServer`, `startServer`, `stopServer` |
| Webview Status Panel | `getWebviewContent`, `showStatus`, `updateStatusPanel` |
| Security Hardening | CORS handling, origin validation |

**Related Docs:**

- `docs/features/copilot-proxy/design.md`
- `docs/features/webview-status-panel/design.md`

---

### src/core.ts

**Primary File:** Shared utilities and types

| Feature | Functions/Sections |
|---------|-------------------|
| Copilot Proxy | `ChatMessage`, `OpenAIResponse`, `StreamChunk`, `parseRequestBody`, `validateRequest` |
| Code Health Refactor | All utility functions, type definitions |
| Security Hardening | `getCorsHeaders`, `isLocalhostOrigin`, `escapeHtml`, `MAX_REQUEST_BODY_SIZE`, `REQUEST_TIMEOUT_MS` |

**Related Docs:**

- `docs/features/copilot-proxy/design.md`
- `docs/features/code-health-refactor/design.md`
- `docs/features/security-hardening/design.md`

---

### src/test/core.test.ts

**Primary File:** Unit tests for core.ts

| Feature | Test Suites |
|---------|-------------|
| Code Health Refactor | All test suites |
| Security Hardening | Security constants tests |

**Related Docs:**

- `docs/features/code-health-refactor/TASKS.md`

---

## Feature to Source Mapping

### Copilot Proxy

| Component | File | Lines |
|-----------|------|-------|
| HTTP Server | `src/extension.ts` | 490-524 |
| Chat Completions Handler | `src/extension.ts` | 158-442 |
| Models Handler | `src/extension.ts` | 444-477 |
| Health Handler | `src/extension.ts` | 479-488 |
| Types | `src/core.ts` | 78-156 |
| Validation | `src/core.ts` | 417-445 |

---

### Webview Status Panel

| Component | File | Lines |
|-----------|------|-------|
| HTML Content | `src/extension.ts` | 612-1239 |
| Panel Management | `src/extension.ts` | 1241-1320 |
| State Updates | `src/extension.ts` | 1322-1353 |
| Model Info Type | `src/core.ts` | 126-132 |
| Settings Info Type | `src/core.ts` | 134-140 |

---

### Security Hardening

| Component | File | Lines |
|-----------|------|-------|
| Request Size Limit | `src/core.ts` | 10 |
| Request Timeout | `src/core.ts` | 17 |
| Keep-Alive Timeout | `src/core.ts` | 24 |
| Headers Timeout | `src/core.ts` | 30 |
| Localhost Check | `src/core.ts` | 42-45 |
| CORS Headers | `src/core.ts` | 51-65 |
| HTML Escaping | `src/core.ts` | 160-167 |

---

### Code Health Refactor

| Component | File | Lines |
|-----------|------|-------|
| Utility Functions | `src/core.ts` | 160-470 |
| Type Definitions | `src/core.ts` | 78-156 |
| Unit Tests | `src/test/core.test.ts` | All |

---

## Undocumented Code Areas

Areas of code that may need documentation:

| File | Section | Recommended Action |
|------|---------|-------------------|
| `src/extension.ts` | Request logging | Add to webview-status-panel docs |
| `src/extension.ts` | Model caching | Add to copilot-proxy docs |
| `src/core.ts` | Model matching | Already documented in code JSDoc |

---

## How to Update This File

When adding new features:

1. Add source file entries under "Source Files" section
2. Add feature-to-source mapping under "Feature to Source Mapping"
3. Update line numbers if significant code changes occur
4. Check for undocumented code areas

When refactoring:

1. Update line number references
2. Update function/component names
3. Check if any code areas become undocumented

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
