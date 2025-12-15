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

## Markdown Rules

- No em dashes (`—`) - use `-` or `--`
- Blank line before lists and around headers
- Use `-` for bullets consistently
