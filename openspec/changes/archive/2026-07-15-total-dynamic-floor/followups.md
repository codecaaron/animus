# Deferred follow-ups — total-dynamic-floor

These items preserve lower-severity seams without treating them as unfinished delivery.
Each follow-up requires its stated evidence before a new change is proposed.

| ID | Source | Follow-up | Owner | Trigger | Review-by |
|----|--------|-----------|-------|---------|-----------|
| TF-1 | DEF-2 / #13 | Decide warn-once versus value/per-hit escalation and whether tests need a strict mode | `external:dynamic-drop-diagnostic-dogfood` | Showcase dev dogfood shows distinct values for one component/prop are independently actionable, or warn-once hides a reproducible diagnosis | 2026-08-15 or after 3 portfolio reorientations |
| TF-2 | retained seam #4 | Revisit exported-but-locally-unrendered components under a package-first extraction model | `external:source-unavailable-package-fixture` | A supported fixture consumes pretransformed/source-unavailable package output, or standalone package extraction becomes authoritative | On first trigger |
| TF-3 | retained seam #14 | Remove or promote the private detection-only floor mode | `external:total-floor-production-mode-signal` | A second production caller, public API requirement, or binary/profile measurement makes the mode operationally relevant | On first trigger |

When a trigger fires, start a separate OpenSpec change with the evidence attached; do
not reopen this completed delivery envelope.
