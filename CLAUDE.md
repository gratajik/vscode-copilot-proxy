# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript to JavaScript
npm run watch        # Watch mode for development
npm run lint         # Run ESLint on src/
```

## Running the Extension

Press F5 in VS Code to launch a new Extension Development Host window with the extension loaded. The server auto-starts on port 8080 by default.

## Testing the API

```bash
# Health check
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models

# Chat completion
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

## Architecture

This is a VS Code extension that exposes an OpenAI-compatible HTTP API backed by VS Code's Language Model API (`vscode.lm`).

**Core flow:**

1. External client sends OpenAI-format request to `http://localhost:8080/v1/chat/completions`
2. Extension converts messages to VS Code's `LanguageModelChatMessage` format
3. Request is forwarded to Copilot via `vscode.lm.selectChatModels()` and `model.sendRequest()`
4. Response is converted back to OpenAI format and returned

**Key components in `src/extension.ts`:**

- `createServer()` - HTTP server with CORS support routing to handlers
- `handleChatCompletion()` - Main endpoint, supports streaming (SSE) and non-streaming
- `getModel()` - Flexible model matching (exact ID, family, or partial name match)
- `convertToVSCodeMessages()` - Converts OpenAI message format to VS Code format

**Limitations:**

- VS Code LM API has no system role - system messages are converted to user messages
- Token counts are not available from VS Code API (always returns 0)
- `temperature` and `max_tokens` are accepted but not forwarded to VS Code API

## Code Guidelines

### Code Surgery Principles

Make the smallest possible diff. You are a code surgeon - touch only what's necessary.

**Hard rules:**

- Never reformat unrelated code
- Never reorder functions, declarations, or imports unless required
- Never rename identifiers, files, or modules unless explicitly required
- Never refactor code not directly related to the task
- Never change line endings, encodings, or whitespace styles

**Approach:**

- Additive over modificative - add new code rather than changing existing
- Local over global - put helpers near their usage, not in new modules
- Specific over sweeping - change only affected files
- Incremental over rewrite - evolve, don't replace

### Critical Evaluation

Truth and helpfulness take precedence over agreement.

- Question incorrect assumptions in requests
- Disagree when necessary - politely but clearly correct mistakes
- Say "I don't know" when uncertain rather than guessing
- Present balanced perspectives with pros/cons when multiple approaches exist

## Markdown Rules

When editing markdown files:

- **No em dashes** - Use `-` or `--` instead of `—`
- **Blank line before lists** - Always add a blank line before bullet or numbered lists
- **Consistent list markers** - Use `-` consistently, don't mix with `*` or `+`
- **Blank lines around headers** - Add blank line before and after headers

## Task Workflow

> **Full details:** See `.claude/task-workflow.md` for complete workflow, templates, and timestamp automation rules.

### Before starting work

1. Read existing documentation - TASKS.md, design.md, relevant docs in `/docs`
2. Check for related completion docs: `docs/tasks/TASK-*.md`
3. Understand full context before making changes

### After completing work

1. Update TASKS.md - mark complete with `[x]`, add timestamp and duration
2. Update design.md if architecture/design changed
3. Create completion summary in `docs/tasks/` for significant work

### Developer Identity

For attribution in "Last Updated by" fields:

1. Check `.developer` file in repo root (NAME= and EMAIL=)
2. Fallback: use Windows username from file paths

### Timestamp Format

Use ISO 8601 with timezone: `YYYY-MM-DD HH:MM:SS UTC-X`

## Documentation

- Completion docs go in `docs/<feature>/completion/`
- DOCX conversion: use `scripts/md-to-docx.ps1`, output placed with source MD file
