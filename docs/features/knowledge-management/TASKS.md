# Knowledge Management System - Tasks

**Feature:** Documentation & Feature Discovery System
**Created:** 2025-12-20
**Status:** Phase 1 Partial

---

## Phase 1: Foundation - PARTIAL

**Status:** Partial (4/7 complete)
**Last Updated:** 2025-12-20

### Completed Tasks

- [x] **1.1.1** Create `.claude/documentation-organization.md` with organization rules
- [x] **1.1.2** Organize `docs/` into features/ subdirectories
- [x] **1.1.3** Add workflow rules to `CLAUDE.md`
- [x] **1.1.4** Create `.claude/task-workflow.md` with task tracking format

### Remaining Tasks

- [ ] **1.1.5** Create `docs/FEATURE_INVENTORY.md`
  - List all features with status (complete, in-progress, planned)
  - Link to design docs and task files
  - Include file locations for each feature

- [ ] **1.1.6** Audit existing feature docs for consistency
  - Verify all features have both design.md and TASKS.md
  - Update stale status markers
  - Add missing timestamps

- [ ] **1.1.7** Add critical workflow rules to `CLAUDE.md`
  - Add "CRITICAL: Check Before Implementing" section:
    - Check Feature Inventory (`docs/FEATURE_INVENTORY.md`)
    - Search codebase: `grep -rn "FeatureName" src/`
    - Check feature docs in `docs/features/`
  - Add "CRITICAL: Update After Implementing" section:
    - Update FEATURE_INVENTORY.md "Recently Added" section
    - Update task docs if feature has one
    - Create new feature doc only if significant (3+ files)
  - Add "Why This Matters" section:
    - Prevents duplicating existing functionality
    - Prevents missing partial implementations
    - Prevents forgetting what was added between sessions

### Current Feature Docs

| Feature | design.md | TASKS.md | Status |
|---------|-----------|----------|--------|
| copilot-proxy | Yes | Yes | Complete |
| webview-status-panel | Yes | Yes | Complete |
| code-health-refactor | Yes | Yes | Complete |
| security-hardening | Yes | Yes | Complete |
| tool-calling | Yes | Yes | Not Started |
| knowledge-management | No | Yes | In Progress |

---

## Phase 2: Automated Checks - NOT STARTED

**Status:** Not Started
**Goal:** Automate documentation maintenance

### Tasks

- [ ] **2.1.1** Create `scripts/check-docs.js`
  - Verify each feature folder has design.md and TASKS.md
  - Check for stale "Not Started" status on implemented features
  - Validate task markers (`[ ]`, `[x]`, `[>]`)
  - Output report of issues

- [ ] **2.1.2** Create `scripts/update-inventory.js`
  - Scan docs/features/ for all feature folders
  - Extract status from TASKS.md files
  - Generate/update FEATURE_INVENTORY.md
  - Report new/removed features

- [ ] **2.1.3** Add npm script for doc checks
  - `npm run docs:check` - Run documentation validation
  - `npm run docs:inventory` - Update feature inventory

---

## Phase 3: Code-Doc Sync - NOT STARTED

**Status:** Not Started
**Goal:** Keep code and documentation in sync

### Tasks

- [ ] **3.1.1** Create source file mapping
  - Map src/ files to feature docs
  - Identify undocumented code areas
  - Track which features touch which files

- [ ] **3.1.2** Add doc references to code
  - Add JSDoc comments linking to design docs
  - Reference feature docs in complex functions
  - Example: `@see docs/features/tool-calling/design.md`

- [ ] **3.1.3** Create change detection
  - Track when src/ files change
  - Flag if related docs might be stale
  - Include in PR checklist

---

## Phase 4: Extension-Specific - NOT STARTED

**Status:** Not Started
**Goal:** VS Code extension documentation improvements

### Tasks

- [ ] **4.1.1** Document VS Code API usage
  - List all vscode.* APIs used
  - Link to VS Code API docs
  - Note any limitations or workarounds

- [ ] **4.1.2** Create configuration reference
  - Document all settings in package.json
  - Include default values and valid ranges
  - Add examples for each setting

- [ ] **4.1.3** Document commands and activation
  - List all contributed commands
  - Document activation events
  - Describe command behavior

---

## Maintenance Notes

### Keeping Inventory Current

When adding features:

1. Create `docs/features/<name>/design.md` and `TASKS.md`
2. Add entry to FEATURE_INVENTORY.md
3. Follow `.claude/task-workflow.md` format

When completing features:

1. Update TASKS.md with completion timestamps
2. Update status in FEATURE_INVENTORY.md
3. Review and update design.md if implementation differed

### File Locations

| Item | Location |
|------|----------|
| Doc organization rules | `.claude/documentation-organization.md` |
| Task workflow | `.claude/task-workflow.md` |
| Feature docs | `docs/features/<name>/` |
| Feature inventory | `docs/FEATURE_INVENTORY.md` |
| Source code | `src/` |
| Examples | `examples/` |
| Tests | `src/test/` |

---

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Foundation | 7 | 4/7 Complete |
| Phase 2: Automated Checks | 3 | Not Started |
| Phase 3: Code-Doc Sync | 3 | Not Started |
| Phase 4: Extension-Specific | 3 | Not Started |
| **Total** | **16** | **25% Complete** |

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
