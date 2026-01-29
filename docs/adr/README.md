# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting significant technical decisions made in the Codenames Online project.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision along with its context and consequences. ADRs help:
- Document the "why" behind technical choices
- Onboard new team members
- Revisit decisions when context changes
- Avoid repeating past discussions

## ADR Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [001](001-lua-scripts-for-atomic-operations.md) | Lua Scripts for Atomic Redis Operations | Adopted | 2024 |
| [002](002-session-storage-over-local-storage.md) | sessionStorage Over localStorage | Adopted | 2024 |
| [003](003-distributed-locks-for-concurrency.md) | Distributed Locks for Concurrency Control | Adopted | 2024 |
| [004](004-graceful-degradation.md) | Graceful Degradation Without Database | Adopted | 2024 |
| [005](0005-frontend-consolidation.md) | Frontend Consolidation to Modular Architecture | Adopted | 2026 |

## ADR Template

When creating a new ADR, use this template:

```markdown
# ADR XXX: Title

## Status
[Proposed | Adopted | Deprecated | Superseded by ADR-XXX]

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult because of this change?
```

## References
- [ADR GitHub Organization](https://adr.github.io/)
- [Michael Nygard's Article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
