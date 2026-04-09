## 1. Preparation

- [x] 1.1 Confirm Phase 2 expansion (docs-scribe) is complete for all pages
- [x] 1.2 Prepare source code reference: read system, core, theming, extract, vite-plugin entry points
- [x] 1.3 Prepare Phase 1 outline with coverage checklists for diffing

## 2. Per-Page Validation

### Batch 1 — Foundation
- [x] 2.1 Validate: Introduction — PASS
- [x] 2.2 Validate: Getting Started — PASS
- [x] 2.3 Validate: Base Styling — 1 error

### Batch 2 — Core Authoring
- [x] 2.4 Validate: Variants, Compounds & States — 1 error
- [x] 2.5 Validate: Selectors & Nesting — PASS
- [x] 2.6 Validate: System Props & Groups — 1 error
- [x] 2.7 Validate: Custom Props & Transforms — 2 errors
- [x] 2.8 Validate: Composition — PASS

### Batch 3 — Architecture
- [x] 2.9 Validate: Theming & Tokens — 1 error
- [x] 2.10 Validate: Color Modes — PASS
- [x] 2.11 Validate: System Setup — PASS
- [x] 2.12 Validate: Theme Extension — PASS
- [x] 2.13 Validate: Global Styles — PASS

### Batch 4 — Integration + Advanced
- [ ] 2.14 Validate: Vite Plugin
- [ ] 2.15 Validate: Next.js & Remix
- [ ] 2.16 Validate: TypeScript Integration
- [ ] 2.17 Validate: Framework Agnostic
- [ ] 2.18 Validate: Static Extraction & CSS Output

### Batch 5 — Reference
- [ ] 2.19 Validate: Builder Chain Reference
- [ ] 2.20 Validate: createTheme() Reference
- [ ] 2.21 Validate: createSystem() Reference
- [ ] 2.22 Validate: compose() Reference

### Batch 6 — Support
- [ ] 2.23 Validate: Recipes & Patterns
- [ ] 2.24 Validate: Troubleshooting
- [ ] 2.25 Validate: Migration & Adoption

## 3. Cross-Page Consistency

- [ ] 3.1 Check for inconsistent API explanations across pages
- [ ] 3.2 Verify all cross-references point to real sections/pages
- [ ] 3.3 Verify import paths are consistent across all examples
- [ ] 3.4 Verify token usage is consistent (same tokens for same visual concepts)

## 4. Error Report Delivery

- [ ] 4.1 Compile per-page reports into single audit document
- [ ] 4.2 Triage errors by severity (HALLUCINATED_API and WRONG_SIGNATURE are blockers; MISSING_COVERAGE is high; others are medium)
- [ ] 4.3 Hand off error report to Phase 2 for correction pass
