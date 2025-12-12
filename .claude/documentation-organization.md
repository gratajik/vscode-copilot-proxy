# Documentation Organization

## Directory Structure

| Directory | Purpose | Examples |
|-----------|---------|----------|
| `docs/setup/` | Getting started, installation | QUICKSTART.md, SETUP.md |
| `docs/architecture/` | Design decisions, system design | SCHEMA-COMPARISON.md |
| `docs/implementation/` | Implementation plans, guides | *-INTEGRATION.md |
| `docs/tasks/` | Task completion summaries | TASK-*-COMPLETION.md |
| `docs/troubleshooting/` | Bug fixes, debugging | *-FIX.md, BUILD-FIXES.md |
| `docs/features/` | Feature documentation | *-FEATURE.md |
| `docs/research/` | External analysis, comparisons | Market research |
| `docs/deployment/` | Hosting, production setup | PRODUCTION-HOSTING.md |
| `docs/testing/` | Testing guides | TESTING-GUIDE-*.md |
| `docs/onboarding/` | Team onboarding | ONBOARDING.md |
| `docs/misc/` | Everything else | - |

## Rules

1. **Never** create docs in root `docs/` - always use subdirectory
2. **Always** determine correct subdirectory by file purpose
3. **Mixed purpose** - choose PRIMARY purpose

---

## Hierarchical Documentation

Documentation can exist at any level:

```
/docs/                          # Project-wide
/backend/docs/                  # Backend-specific
/frontend/docs/                 # Frontend-specific
/backend/src/services/docs/     # Module-specific
```

### Subdirectory Pattern (same at all levels)

```
[location]/docs/
├── architecture/    # Design decisions
├── implementation/  # How-to guides
├── setup/          # Configuration
├── testing/        # Test documentation
└── README.md       # Overview
```

---

## Decision Tree

1. **Cross-component?** → `/docs/[category]/`
2. **Component-specific?** → `/[component]/docs/[category]/`
3. **Module-specific?** → `/[path-to-module]/docs/`

---

## Examples

| Documentation | Location |
|---------------|----------|
| System architecture | `/docs/architecture/` |
| Backend API design | `/backend/docs/architecture/` |
| Auth service details | `/backend/src/services/docs/` |
| Frontend components | `/frontend/docs/implementation/` |
| Task completion | `/docs/tasks/` |

---

**Last Updated:** December 11, 2025
