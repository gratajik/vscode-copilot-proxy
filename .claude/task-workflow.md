# Task Workflow

## Quick Reference

| State | Marker | Action |
|-------|--------|--------|
| Not started | `[ ]` | - |
| In progress | `[>]` | Add "Started" timestamp |
| Complete | `[x]` | Add "Completed" timestamp, duration |

**Timestamp format:** `YYYY-MM-DD HH:MM:SS UTC-X`

---

## Before Starting Any Task

### 1. Read Documentation

**Required:**

- TASKS.md - Find task, review acceptance criteria
- design.md (or prd.md) - Architecture and requirements

**Discovery pattern:**

```
docs/**/*.md              -> All documentation
docs/tasks/TASK-X.Y*.md   -> Related completion docs
docs/architecture/*.md    -> Architecture docs
```

### 2. Get Developer Identity

For "Last Updated by" attribution:

1. Check `.developer` file: `NAME=` and `EMAIL=`
2. Fallback: Windows username from file paths

---

## After Completing Any Task

### 1. Update TASKS.md

```markdown
- [x] **2.4.2** Implement video capture
  - **Started**: 2025-10-09 14:30:00 UTC-7
  - **Completed**: 2025-10-09 18:45:00 UTC-7
  - **Duration**: 4h 15m
  - Implementation notes...
```

### 2. Update design.md

- Document design decisions made
- Update architecture diagrams if changed
- Note deviations from original design
- Update "Last Updated" with developer name

### 3. Create Completion Summary (for significant work)

Location: `docs/tasks/TASK-X.Y.Z-TASK-NAME-COMPLETION-SUMMARY.md`

```markdown
# Task X.Y.Z - [Task Title] - Completion Summary

**Completed:** YYYY-MM-DD HH:MM
**Completed By:** [Developer name]
**Duration:** X hours

## What Was Implemented

- Key features and functionality added

## Design Decisions

- Decisions made and rationale
- Alternatives considered

## Implementation Details

- Patterns used
- Key files modified
- Dependencies added

## Testing & Validation

- How feature was tested
- Known limitations

## Future Considerations

- Potential improvements
- Technical debt (if any)
```

---

## Phase Tracking

```markdown
## PHASE 2: CORE DEVELOPMENT

**Status:** In Progress | Done
**Progress:** 12/25 tasks complete (48%)
**Phase Started**: 2025-09-15 09:00:00 UTC-7
**Last Updated**: 2025-10-09 14:30:00 UTC-7
**Phase Completed**: TBD | 2025-10-22 17:00:00 UTC-7
**Phase Duration**: TBD | 5w 3d 8h
```

---

## Rules

### Never

- Start work without reading existing documentation
- Complete work without updating TASKS.md
- Complete work without updating design.md
- Skip completion docs for significant work
- Create duplicate documentation

### Always

- Use file search to discover docs before starting
- Update TASKS.md with checkbox, timestamp, duration
- Update design.md with architecture changes
- Document new patterns and decisions

---

**Last Updated:** December 11, 2025
