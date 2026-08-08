# Strategy digest — chat-boot-critical-path

## Categories tried
- architecture: 1 kept (local-first + parallel models)

## Key learnings
- Cloud GET was on the interactive critical path only because hydrate awaited it before `chatsHydrated` and before starting models.
- Auth-before-models-cache remains satisfied: `fetchModels(bound)` still runs after `refreshAccountStatus`.

## Exploration frontier
- Partial variants (hydrate-only or models-only) likely worse than the combined keep.
- Not awaiting skills/memories before OAuth is residual polish; does not change interactive_ms under current definition.

## Current best
- interactive_ms: 855 (baseline 2855, target 900) — **target reached**
- full_boot_ms: 2055 (cloud still completes in background of interactive)
