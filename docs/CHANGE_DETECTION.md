# Change Detection Guide

Guidelines for keeping code and documentation in sync.

---

## When to Update Documentation

### After Modifying Source Files

| Change Type | Documentation to Update |
|-------------|------------------------|
| New function | Add to SOURCE_MAPPING.md |
| New feature | Create feature docs, update FEATURE_INVENTORY.md |
| API change | Update API_REFERENCE.md |
| Setting change | Update CONFIGURATION.md |
| Command change | Update COMMANDS.md |
| Bug fix | Update TASKS.md if tracked |

### After Adding Files

| File Type | Actions |
|-----------|---------|
| `src/*.ts` | Add to SOURCE_MAPPING.md |
| `docs/features/*/` | Add to FEATURE_INVENTORY.md |
| `scripts/*.js` | Document in relevant feature docs |

---

## PR Checklist

Before submitting a pull request:

### Code Changes

- [ ] Source files have JSDoc comments with `@see` links
- [ ] New functions documented in SOURCE_MAPPING.md
- [ ] Line number references still accurate

### Feature Changes

- [ ] Feature status updated in FEATURE_INVENTORY.md
- [ ] TASKS.md updated with completion markers
- [ ] design.md updated if implementation differs

### Configuration Changes

- [ ] CONFIGURATION.md updated
- [ ] package.json contributes.configuration matches docs

### API Changes

- [ ] API_REFERENCE.md updated
- [ ] Breaking changes noted

---

## Automated Checks

Run before committing:

```bash
# Validate documentation structure
npm run docs:check

# Update feature inventory
npm run docs:inventory
```

### What docs:check Validates

- Each feature folder has design.md and TASKS.md
- Status markers are consistent
- Task markers follow format (`[ ]`, `[x]`, `[>]`)
- FEATURE_INVENTORY.md exists and has required sections

### What docs:inventory Reports

- Feature status (Complete, In Progress, Not Started)
- Missing documentation files
- Status table for all features

---

## Stale Documentation Signs

Watch for these indicators:

| Indicator | Action |
|-----------|--------|
| Line numbers don't match | Update SOURCE_MAPPING.md |
| Status "Not Started" with completed code | Update TASKS.md status |
| Settings in code not in docs | Update CONFIGURATION.md |
| New commands not documented | Update COMMANDS.md |

---

## File Watch Patterns

Key files to monitor for documentation updates:

### High Impact Changes

| File | Documentation to Update |
|------|------------------------|
| `package.json` (contributes) | CONFIGURATION.md, COMMANDS.md |
| `src/extension.ts` | SOURCE_MAPPING.md, API_REFERENCE.md |
| `src/core.ts` | SOURCE_MAPPING.md |

### Documentation Files

| File | Related To |
|------|------------|
| `docs/FEATURE_INVENTORY.md` | All features |
| `docs/SOURCE_MAPPING.md` | Source files |
| `docs/features/*/TASKS.md` | Feature progress |
| `docs/features/*/design.md` | Feature architecture |

---

## Keeping Line Numbers Current

Line number references in SOURCE_MAPPING.md can become stale.

### When to Update

- After adding/removing significant code blocks
- After refactoring that moves functions
- After merging PRs with code changes

### How to Update

1. Use IDE "Go to Definition" to find current line numbers
2. Run grep to find function definitions:
   ```bash
   grep -n "function functionName" src/extension.ts
   ```
3. Update SOURCE_MAPPING.md with new line numbers

### Tip: Use Ranges

Instead of exact line numbers, use ranges:

```markdown
| Chat Handler | src/extension.ts | 158-442 |
```

Ranges are more resilient to small changes.

---

## Integration with Git

### Pre-commit Hook (Optional)

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
npm run docs:check
```

### Commit Message Guidelines

When updating documentation:

```
docs: Update SOURCE_MAPPING.md line numbers

- Updated handleChatCompletion range
- Added new utility function reference
```

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
