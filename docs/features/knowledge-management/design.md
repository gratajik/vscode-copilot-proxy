# Knowledge Management System - Design

## Overview

A documentation organization and feature discovery system that prevents duplication of work and ensures all implementations are properly tracked and discoverable.

---

## Problem Statement

Without proper knowledge management:

1. **Duplicate implementations** - Same feature implemented multiple times
2. **Lost context** - Previous work forgotten between sessions
3. **Stale documentation** - Docs don't match current code
4. **Discovery friction** - Hard to find what already exists

---

## Goals

1. **Prevent duplication** - Check before implementing
2. **Track all features** - Central inventory with status
3. **Maintain consistency** - Automated doc validation
4. **Enable discovery** - Easy to find existing implementations

---

## Architecture

### Documentation Structure

```
docs/
  FEATURE_INVENTORY.md     # Central feature catalog
  CONFIGURATION.md         # Settings reference
  API_REFERENCE.md         # VS Code API usage
  features/
    <feature-name>/
      design.md            # Architecture and decisions
      TASKS.md             # Implementation tasks
```

### Automation Scripts

```
scripts/
  check-docs.js            # Validate documentation structure
  update-inventory.js      # Regenerate feature inventory
```

---

## Components

### 1. Feature Inventory

**File:** `docs/FEATURE_INVENTORY.md`

Central catalog listing all features with:

- Status (Complete, In Progress, Not Started)
- Location (docs path, source files)
- Quick links to design.md and TASKS.md
- Recently added section for quick reference

### 2. Documentation Validation Script

**File:** `scripts/check-docs.js`

Validates:

- Each feature folder has design.md and TASKS.md
- Status markers are consistent
- Task markers follow format (`[ ]`, `[x]`, `[>]`)
- No stale "Not Started" on implemented features

### 3. Inventory Generator Script

**File:** `scripts/update-inventory.js`

Generates:

- Scans docs/features/ for all feature folders
- Extracts status from TASKS.md
- Updates FEATURE_INVENTORY.md automatically

### 4. Workflow Integration

**File:** `CLAUDE.md` updates

Critical workflow rules:

- Check inventory before implementing
- Search codebase for existing implementations
- Update inventory after implementing

---

## Implementation Phases

### Phase 1: Foundation

- Create documentation organization rules
- Organize existing docs into feature folders
- Create FEATURE_INVENTORY.md
- Add workflow rules to CLAUDE.md

### Phase 2: Automated Checks

- Create check-docs.js script
- Create update-inventory.js script
- Add npm scripts for doc validation

### Phase 3: Code-Doc Sync

- Create source file to feature mapping
- Add JSDoc references to design docs
- Create change detection guidance

### Phase 4: Extension-Specific

- Document all vscode.* API usage
- Create configuration reference
- Document commands and activation events

---

## Workflow Rules

### Before Implementing

1. Check `docs/FEATURE_INVENTORY.md`
2. Search codebase: `grep -rn "FeatureName" src/`
3. Check feature docs in `docs/features/`

### After Implementing

1. Update FEATURE_INVENTORY.md "Recently Added"
2. Update TASKS.md with completion timestamps
3. Create feature doc if significant (3+ files changed)

---

## Success Criteria

1. All features have entries in FEATURE_INVENTORY.md
2. All feature folders have design.md and TASKS.md
3. Scripts validate documentation structure
4. No duplicate implementations occur

---

## Dependencies

- Node.js for scripts
- Standard file system APIs
- No external packages required

---

## References

- Task workflow: `.claude/task-workflow.md`
- Documentation rules: `.claude/documentation-organization.md`

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
