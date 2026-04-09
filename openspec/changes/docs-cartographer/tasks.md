## 1. Quarantine Stale Content

- [ ] 1.1 Stub 19 MDX files (replace content with `# Page Title` heading only, preserving routing)
- [ ] 1.2 Verify showcase still builds after stubbing (`bun run --filter './packages/showcase' build`)
- [ ] 1.3 Verify kitchen sink (`support/component-test.mdx`) and Examples page are untouched

## 2. Full API Surface Enumeration

- [ ] 2.1 Read `packages/system/src/index.ts` — catalog every public export
- [ ] 2.2 Read `packages/core/src/index.ts` and `packages/core/src/Animus.ts` — catalog every builder chain method on all 6 classes
- [ ] 2.3 Read `packages/theming/src/index.ts` and `packages/theming/src/ThemeBuilder.ts` — catalog every theme builder method and type export
- [ ] 2.4 Read `packages/system/src/groups/index.ts` — catalog all pre-built group exports and their prop lists
- [ ] 2.5 Read `packages/vite-plugin/src/index.ts` — catalog plugin config type and all options
- [ ] 2.6 Read `packages/core/src/types.ts` and `packages/theming/src/types.ts` — catalog all public type exports
- [ ] 2.7 Investigate selector aliases (system/src/selectors.ts) — enumerate built-in selectors and custom selector API
- [ ] 2.8 Investigate transforms — find where named transforms are defined, how they're registered
- [ ] 2.9 Investigate prop shorthand resolution — find the mapping from shorthand to CSS properties
- [ ] 2.10 Read `packages/showcase/src/ds.ts` as a real-world usage reference — note patterns that need documentation
- [ ] 2.11 Cross-check enumerated surface against CLAUDE.md files for completeness
- [ ] 2.12 Produce final API surface inventory with every discovered export, method, type, and config option

## 3. Generate Outline

- [ ] 3.1 Determine page boundaries from the enumerated surface (page count is NOT fixed — let coverage density drive the structure)
- [ ] 3.2 Assign Diataxis category to each page
- [ ] 3.3 Draft per-page structure: title, slug, reader context, objective, sections
- [ ] 3.4 Assign APIs from the inventory to sections within each page
- [ ] 3.5 Annotate each section with MDX component assignments from the verified palette
- [ ] 3.6 Document edge cases and non-obvious patterns per section
- [ ] 3.7 Add cross-reference links between related sections across pages
- [ ] 3.8 Call out any APIs discovered beyond the seed inventory (high-value discoveries)

## 4. Coverage Audit

- [ ] 4.1 Verify every enumerated API appears on exactly one page's coverage checklist (no gaps)
- [ ] 4.2 Verify no API appears on multiple pages' checklists (no duplicates)
- [ ] 4.3 Mark any API that could not be fully understood from source with [VERIFY]
- [ ] 4.4 Final review: do the page boundaries make sense given the coverage density?
