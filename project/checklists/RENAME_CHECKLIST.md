# Technical Checklist: Rename Implementation

**Council Vote Result**: ✅ APPROVED (Unanimous)
**Target**: Single comprehensive PR

## Pre-Implementation Tasks
- [ ] @codecaaron: Register `@syzygy` npm scope
- [ ] @codecaaron: Register `syzygy.dev` domain
- [ ] @codecaaron: Rename GitHub repository to `syzygy`

## Codebase Changes (Lead: @Claude)

### Core Renames
- [ ] Global find-and-replace: "Animus" → "Syzygy", "animus" → "syzygy"
- [ ] Update all internal variable names and constants (e.g., `ANIMUS_CONFIG` → `SYZYGY_CONFIG`)
- [ ] Update API names if branded (e.g., `createAnimusTheme()` → `createSyzygyTheme()`)
- [ ] Rename files using `git mv` to preserve history:
  - [ ] `STATE_OF_THE_ANIMUS.md` → `STATE_OF_THE_SYZYGY.md`
  - [ ] Any other files with "animus" in the name

### Code Details
- [ ] Update all TypeScript type definitions that reference "Animus"
- [ ] Update error messages and console outputs
- [ ] Check for hardcoded strings in test files
- [ ] Update any environment variable names (ANIMUS_* → SYZYGY_*)
- [ ] Update webpack/rollup config references
- [ ] Update example projects and demos
- [ ] Check all import/require statements

## Configuration & Tooling (Lead: @Gemini)

### Package Configuration
- [ ] Update `name` in all `package.json` files to `@syzygy/*`:
  - [ ] `packages/core/package.json` → `@syzygy/core`
  - [ ] `packages/theming/package.json` → `@syzygy/theming`
  - [ ] `packages/components/package.json` → `@syzygy/components`
  - [ ] Root `package.json` workspace references
- [ ] Update repository URLs in all `package.json` files
- [ ] Update `homepage` fields to use new domain

### Build & CI/CD
- [ ] Update build scripts and test configurations
- [ ] Update CI/CD workflows in `.github/workflows/`
- [ ] Update GitHub Actions workflow names and badges
- [ ] Update any CI environment variables or secrets
- [ ] Configure npm publishing for `@syzygy` scope

### Development Tools
- [ ] Update any CLI commands (if applicable)
- [ ] Update VS Code workspace settings
- [ ] Update any debug configurations

## Documentation (Lead: @OpenAI)

### Core Documentation
- [ ] Update `README.md` with new project name, badges, and links
- [ ] Update `PARTNERS.md` (includes hardcoded names in signature blocks)
- [ ] Update `PHILOSOPHY.md`
- [ ] Update `CLAUDE.md` at both root and package levels
- [ ] Create decision log entry in `/decisions/0001-rename-to-syzygy.md`

### Governance Documents
- [ ] Update `GOVERNANCE_VOTING_SYSTEM.md`
- [ ] Update `COUNCIL_VOTE_ACTIVE.md` template
- [ ] Archive the completed vote in `/votes/completed/`

### External-Facing Documentation
- [ ] Update all markdown files in `/docs`
- [ ] Update issue and PR templates
- [ ] Create migration guide for any existing users
- [ ] Set up redirects if we have public documentation

### Legal & License
- [ ] Audit and update `LICENSE.md`
- [ ] Update any NOTICE files
- [ ] Check copyright headers in source files

## Post-Implementation Tasks

### Communication
- [ ] Publish deprecation notice for old `animus` packages (if any were published)
- [ ] Update GitHub issue #60 with completion status
- [ ] Create announcement for any community channels

### Verification
- [ ] Run full test suite
- [ ] Verify all packages build correctly
- [ ] Test npm package publishing (dry run)
- [ ] Verify GitHub redirects work
- [ ] Check all internal links still function

## Final Steps
- [ ] Merge PR with co-authored commit from all partners
- [ ] Tag release as `v0.1.0-syzygy`
- [ ] Celebrate the first successful Council Vote! 🎉