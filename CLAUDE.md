# CLAUDE.md

Guidance for Claude Code when working with this VS Code extension.

## Critical: Windows Paths

Use Windows backslash paths for `Edit`, `Glob`, `Grep`, `Read` tools:
- ✅ `C:\\path\\to\\file.txt`
- ❌ `/c/path/to/file.txt`

Expand `~` to full path: `C:\Users\username`

## Build & Test

```bash
npm install           # Install dependencies
npm run compile       # Compile TypeScript
npm run lint          # Run ESLint
```

**Test the API:**

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/models
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

**Debugging:** F5 debug is unreliable. Always rebuild and reinstall: `vsce package && code --install-extension *.vsix --force`

## Architecture

VS Code extension exposing OpenAI-compatible HTTP API via `vscode.lm` API.

**Flow:** Client request → HTTP server → convert to VS Code format → Copilot → convert response → return

**Key files:**

- `src/extension.ts` - HTTP server, handlers, webview UI
- `src/core.ts` - Shared utilities (CORS, validation, model matching)

**Limitations:** No system role (converted to user), no token counts, temperature/max_tokens ignored

## Code Guidelines

**Minimal diffs** - Touch only what's necessary:

- Never reformat, reorder, or rename unrelated code
- Additive over modificative
- Local helpers over new modules
- Specific changes over sweeping refactors

**Be direct** - Question assumptions, disagree when wrong, say "I don't know" when uncertain

## Task Workflow

**MANDATORY:** Read `.claude/task-workflow.md` before creating any TASKS.md or design.md.

**New features:**

1. Create `docs/features/<name>/design.md` and `TASKS.md`
2. Use phase format: Status, Progress %, timestamps
3. Task markers: `[ ]` todo, `[>]` in progress, `[x]` done

**After work:** Update TASKS.md with completion timestamps

## CRITICAL: Check Before Implementing

Before implementing any feature, always:

1. **Check Feature Inventory** - `docs/FEATURE_INVENTORY.md`
   - Is this feature already listed?
   - What's its current status?

2. **Search Codebase** - `grep -rn "FeatureName" src/`
   - Does similar code already exist?
   - Are there partial implementations?

3. **Check Feature Docs** - `docs/features/`
   - Is there a design.md for this feature?
   - What was the original plan?

## CRITICAL: Update After Implementing

After completing any feature work:

1. **Update FEATURE_INVENTORY.md**
   - Add to "Recently Added" section if new
   - Update status if changed

2. **Update Task Docs**
   - Mark tasks as `[x]` complete
   - Add completion timestamps
   - Add duration if tracked

3. **Create Feature Doc** (if significant - 3+ files)
   - Create `docs/features/<name>/design.md`
   - Create `docs/features/<name>/TASKS.md`

## Why This Matters

- **Prevents duplicating** existing functionality
- **Prevents missing** partial implementations
- **Prevents forgetting** what was added between sessions

## Markdown Rules

- No em dashes (`—`) - use `-` or `--`
- Blank line before lists and around headers
- Use `-` for bullets consistently
