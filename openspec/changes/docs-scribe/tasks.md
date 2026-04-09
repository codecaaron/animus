## 1. Preparation

- [ ] 1.1 Confirm Phase 1 outline (docs-cartographer) is approved and finalized
- [ ] 1.2 Count pages in approved outline and create per-page expansion tasks below
- [ ] 1.3 Prepare type definition extracts for each page's API coverage list
- [ ] 1.4 Extract theme definition (ds.ts) for token reference context
- [ ] 1.5 Update docsNav.ts if Phase 1 outline defines different page structure than current nav

## 2. Per-Page Expansion

Task list is GENERATED from Phase 1 output. The pages below are placeholders.
Replace with the actual page list from the approved outline.

For each page in the approved outline:
- [ ] 2.N Expand: [page title from outline] ([Diataxis category])

Repeat for every page. Each expansion follows the expansion-protocol spec:
paste the outline section + relevant type definitions + theme, then expand.

## 3. Per-Page Coverage Check

- [ ] 3.1 For each expanded page, diff against its Phase 1 coverage checklist
- [ ] 3.2 Flag any silently dropped or relocated APIs
- [ ] 3.3 Verify all code examples use real imports and token references
- [ ] 3.4 Verify MDX component usage matches outline annotations
