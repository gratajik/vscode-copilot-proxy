# Security Hardening - Sprint Breakdown

**Created:** 2026-09-01
**Last Updated:** 2026-09-01
**Last Updated By:** Copilot SDK Agent (Producer role)

## Overview

This sprint plan implements the security hardening requirements defined in
`VSCode_Copilot_Proxy_Security_Assessment.md` and `design.md`/`TASKS.md` in
this directory: loopback-only binding (already present, needs regression
test), SecretStorage-backed bearer authentication, an explicit CORS
allowlist (no wildcard), metadata-only logging, and a hard gate + finite
cap on server-side automatic tool execution.

Work is split into four sprints with a strict dependency order because
sprints 2-4 all build on the pure, unit-tested primitives added in Sprint 1.

---

## Sprint 1: Security Primitives + Tests

**Status:** Done
**Scope:** `src/security.ts`, `src/test/security.test.ts` only.

Pure, `vscode`-free helper module exporting: `LOOPBACK_HOST`,
`MAX_TOOL_ROUNDS_CAP`, `DEFAULT_TOOL_ROUNDS`, `parseBearerToken`,
`constantTimeEqual`, `isAuthExemptRoute`, `normalizeOrigin`,
`isOriginAllowed`, `buildCorsHeaders`, `categorizeError`,
`validateMaxToolRounds`, `isAutoExecutionAllowed`.

**Result:** Verified by dedicated Dev agent run. `npm run compile`,
`npm run lint`, and `npm test` all passed (205/205 tests, including 61 new
Security Utilities tests). No bugs found in either file; no edits were
necessary.

---

## Sprint 2: Wire Auth + CORS Allowlist + Tool-Execution Gating

**Status:** Done
**Depends on:** Sprint 1
**Scope:** `package.json`, `src/extension.ts`, `src/core.ts` (removal of
superseded CORS helpers), associated test updates. Explicitly excludes
logging/`rawLogging` content changes and all documentation (reserved for
later sprints).

Tasks dispatched:

1. Add `copilotProxy.allowedOrigins` (array, default `[]`) and
   `copilotProxy.allowAutoToolExecution` (boolean, default `false`) settings;
   add `copilot-proxy.setProxyToken` command to `package.json`.
2. Implement `copilot-proxy.setProxyToken` command in `extension.ts` using
   a password-style input box, storing the token via
   `context.secrets.store('copilotProxy.proxyToken', token)`. Never logs or
   echoes the token.
3. Implement `authenticateRequest()` using `parseBearerToken` +
   `constantTimeEqual` against the stored secret; deny by default when no
   token is configured.
4. Enforce authentication on every route except `GET /health`
   (`isAuthExemptRoute`), returning `401` with CORS headers attached.
5. Replace `core.ts`'s `isLocalhostOrigin` / `getCorsHeaders` /
   `CORS_HEADERS` (wildcard-permitting) with `security.ts`'s
   `buildCorsHeaders` (exact-match allowlist, no wildcard, `Vary: Origin`).
   Remove now-dead call sites and corresponding tests in `core.test.ts`.
6. Gate `tool_execution: "auto"` behind `isAutoExecutionAllowed` (extension
   setting must be explicitly `true`; a request cannot self-enable it) in
   both the OpenAI (`handleChatCompletion`) and Anthropic
   (`handleAnthropicMessages`) handlers. When denied, fall through to normal
   pass-through behavior rather than failing the whole request.
7. Replace unlimited (`0 = unlimited`) `max_tool_rounds` handling with
   `validateMaxToolRounds` (bounded 1-100, `400` on invalid values) in both
   handlers.
8. Run `npm run compile`, `npm run lint`, `npm test`; fix until green.

**Result:** All 8 tasks completed by the Dev agent.

Files changed:
- `package.json` — added `copilotProxy.allowedOrigins` (array, default
  `[]`), `copilotProxy.allowAutoToolExecution` (boolean, default `false`),
  and command `copilot-proxy.setProxyToken`.
- `src/core.ts` — removed `isLocalhostOrigin`, `getCorsHeaders`,
  `CORS_HEADERS` (no test file referenced them, so no test removal
  needed); `DEFAULT_MAX_TOOL_ROUNDS` left in place.
- `src/extension.ts` — added `authenticateRequest()` (deny-by-default,
  constant-time compare, never logs credentials), `getRequestCorsHeaders()`
  helper wrapping `buildCorsHeaders`, auth gate before routing (401 on
  every non-exempt route), removed old non-localhost-origin 403 block,
  `server.listen` now uses `LOOPBACK_HOST` from `security.ts`, registered
  `copilot-proxy.setProxyToken` command, gated both auto-execute branches
  (OpenAI + Anthropic) behind `isAutoExecutionAllowed`, replaced
  `max_tool_rounds` handling with `validateMaxToolRounds` (400 on invalid).
- `src/test/extension-integration.test.ts` (new) — 9 tests reconstructing
  the auth -> CORS -> routing composition with real `security.ts` functions
  (full `vscode` mocking was judged out of scope per the task's escape
  hatch); covers health-exempt, 401 missing/invalid token, 200 valid token,
  no-Origin passthrough, CORS echo/omission, OPTIONS preflight, and the
  auto-tool-execution gate fallthrough.

Verification: `npm run compile` pass (0 errors); `npm run lint` pass (0
errors, 5 pre-existing unrelated warnings); `npm test` **214 passing, 0
failing** (205 pre-existing + 9 new).

Deviations: no `DOCS_NAMESPACE`/producer-plan folder structure existed in
this repo, so the agent reported directly instead of writing per-run
`producer-*.md` artifacts; this file (`SPRINTS.md`) serves as the
consolidated record instead. No git operations were performed, and
README/docs/logging content were correctly left untouched per scope.

---

## Sprint 3: Log Redaction

**Status:** Done
**Depends on:** Sprint 2
**Scope:** `src/extension.ts` (logging call sites), `src/core.ts`
(`SettingsInfo`), `package.json` (removed `copilotProxy.rawLogging`),
`docs/CONFIGURATION.md`, new `src/test/log-redaction.test.ts`.

Results:

- Deleted `logRaw()` entirely and all 10 raw-content call sites (OpenAI +
  Anthropic REQUEST/RESPONSE/RESPONSE(auto-execute)/RESPONSE(stream)/ERROR
  variants). Removed now-dead `fullResponse` accumulators left with no
  consumer.
- Replaced 6 raw tool-call-argument log lines with metadata-only versions
  (`Tool call: ${name} (${arguments.length} arg chars)`); the pre-existing
  `executeToolCall` completion log was already length-only.
- All 8 `addRequestLog({..., errorMessage})` call sites now pass
  `categorizeError(error)` (fixed-enum, from `security.ts`) instead of raw
  exception text — this is the *persisted/UI-facing* log entry only.
  Client-facing HTTP error responses (`sendErrorResponse`,
  `sendAnthropicErrorResponse`, SSE error events) intentionally still use
  the existing human-readable `describeRequestError(error)` string, since
  that is a direct API response to the caller, not a log.
- Removed the `rawLogging` setting completely: `package.json` config
  property, `SettingsInfo.rawLogging` field (`core.ts`), webview checkbox +
  its change-listener script, `updateStatusPanel()` read — no
  content-bearing debug mode was retained, per requirement.
- `docs/CONFIGURATION.md`: removed the `rawLogging` row/section; added a
  note that logs are metadata-only and error entries carry a bounded
  category, not raw exception text.
- New `src/test/log-redaction.test.ts` (6 tests): injects sentinel secrets,
  a Windows file path, and a jailbreak-style prompt phrase into simulated
  errors/content, asserting `JSON.stringify(entry)` never contains any of
  them, and that `categorizeError` always returns one of 7 fixed safe
  categories.

Verification: `npm run compile` pass (0 errors); `npm run lint` pass (0
errors, same 5 pre-existing unrelated warnings); `npm test` **220 passing,
0 failing** (214 prior + 6 new).

Deviations: none affecting scope. Outer per-request JSON-parse-error catch
blocks (which never call `addRequestLog`) were intentionally left
untouched — only `logError`/console output (not the persisted UI table)
sees that raw parse error text, consistent with sprint scope (`logError`/
`log`/`logWarn` themselves were not the target of this sprint).

---

## Sprint 4: Documentation + Final Verification

**Status:** In Progress
**Depends on:** Sprint 2, Sprint 3
**Scope:** `README.md`, `docs/CONFIGURATION.md`,
`docs/features/security-hardening/design.md` and `TASKS.md`,
`docs/features/tool-calling/design.md`, `docs/FEATURE_INVENTORY.md`.

Planned tasks:

1. Document the proxy token workflow (`copilot-proxy.setProxyToken`),
   `Authorization: Bearer <token>` usage in every README example (curl,
   Python, Node, Claude Code), `copilotProxy.allowedOrigins`, and
   `copilotProxy.allowAutoToolExecution`.
2. State explicitly that model access uses the VS Code Copilot session
   (`vscode.lm`), independent of any `gh auth` account.
3. Update `security-hardening/design.md` and `TASKS.md` to match the actual
   SecretStorage-based, allowlist-based implementation (correcting stale
   "Not Started"/plaintext-setting content), with phase timestamps per
   `.claude/task-workflow.md`.
4. Update `tool-calling/design.md`: `max_tool_rounds` is now bounded
   1-100 (no more "0 = unlimited"); document the `allowAutoToolExecution`
   gate.
5. Update `FEATURE_INVENTORY.md` (Recently Added entry, Configuration
   Reference table, Commands table, Security Hardening source files list).
6. Final full verification: `npm test`, `npm run compile`, `npm run lint`,
   `npm run docs:check`.
7. Package with `vsce package` (local only - no publish, no global
   install) and produce manual install/test steps for the resulting
   `.vsix`, including validating `/v1/models` and reporting the actual
   model IDs returned before any change to `chatLanguageModels.json`.

**Status: Done. Results:**

- `README.md`: added a "Security / Local Setup" section; every curl/
  Python/Node/Claude Code example now shows `Authorization: Bearer
  <token>` and explicit `http://127.0.0.1:<port>`; documented
  `allowedOrigins`/`allowAutoToolExecution` settings, `setProxyToken`
  command, bounded `max_tool_rounds`, metadata-only logging, and that
  model access uses the VS Code Copilot session independent of `gh auth`.
- `docs/CONFIGURATION.md`: added full docs for `allowedOrigins` and
  `allowAutoToolExecution` (previously undocumented despite existing in
  `package.json` since Sprint 2).
- `docs/features/security-hardening/design.md`: added "What Was Actually
  Built", a divergences table, and a "Known Gaps / Not Implemented" list
  (rate limiting, connection limits, security response headers, prompt
  filtering, input-length limits - none implemented, correctly flagged as
  future work); original plan preserved as a labeled historical appendix.
- `docs/features/security-hardening/TASKS.md`: recreated per
  `.claude/task-workflow.md` conventions; Phases 1-2 `Done` with
  timestamps/notes; Phases 3-4 accurately left `Not Started`/descoped.
- `docs/features/tool-calling/design.md`: bounded `max_tool_rounds`
  (1-100) documented; new "Auto-Execution Gate" subsection.
- `docs/FEATURE_INVENTORY.md`: "Recently Added" entry, Security Hardening
  and Tool Calling entries marked `Complete`, Configuration Reference and
  Commands tables updated.

Verification: `npm run compile` pass (0 errors); `npm run lint` pass (0
errors, 5 pre-existing unrelated warnings); `npm test` **220 passing, 0
failing**; `npm run docs:check` ran with `0 errors, 2 warnings` - one
pre-existing (`copilot-proxy/` feature, unrelated), one false positive on
`security-hardening/` where the checker's whole-file string match finds
`**Status:** Not Started` inside correctly-labeled Phase 3/4 sub-items and
the historical appendix, even though the top-level feature `Status:` is
`Done` - a pre-existing limitation of `scripts/check-docs.js`, not fixed
(out of this sprint's docs/verification-only scope).

Packaging: `npx vsce package` succeeded (no global install; `vsce` was
resolved transiently via `npx`) producing
`vscode-copilot-proxy-0.0.18.vsix` (122 files, 1.26MB) at the repo root.
One harmless pre-existing warning: no `LICENSE` file in the repo.

Deviations: no source-logic (`.ts`) files were touched, per scope; no
`gh`/git commands run; `chatLanguageModels.json` untouched.

---

## Explicit Exclusions (Unchanged Behavior)

Streaming (OpenAI/Anthropic), model matching/scoring, pass-through tool
calling, stats/lifetime persistence, webview layout beyond the settings
noted above, request size/timeout constants, `/v1/tools`, `/v1/models`,
port configurability. No commits, pushes, global extension installs,
publishing, or `gh auth`/account changes are performed as part of this
sprint plan.
