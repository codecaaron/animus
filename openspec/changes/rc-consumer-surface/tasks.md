## 1. Root README

- [ ] 1.1 Rewrite root README.md — remove Emotion refs, use `ds.styles()` / `.system()`, show pre-built group composition, two-file setup (theme.ts + ds.ts), bundler plugin config, legacy footnote
- [ ] 1.2 Review root README examples against showcase `ds.ts` for pattern accuracy

## 2. Consumer-Facing Package READMEs

- [ ] 2.1 Create `packages/system/README.md` — install, quick start (tokens → system → component), group composition from `@animus-ui/system/groups`, builder chain table, exports table
- [ ] 2.2 Create `packages/vite-plugin/README.md` — install, `vite.config.ts` setup with `animusExtract()`, what it does (build/dev/HMR), no-React-alias warning
- [ ] 2.3 Create `packages/next-plugin/README.md` — install, `next.config.mjs` setup with `withAnimus()`, RSC compatibility note

## 3. Internal Package READMEs

- [ ] 3.1 Create `packages/extract/README.md` — brief description, "consumed by plugins" note, supported platforms
- [ ] 3.2 Create `packages/properties/README.md` — brief description, "transitive dep of system" note

## 4. package.json Metadata

- [ ] 4.1 Add `homepage` (deep-linked to package dir) to all 5 publishable packages
- [ ] 4.2 Add `repository.directory` to all 5 publishable packages
- [ ] 4.3 Review and set `keywords` — discovery terms for consumer packages, technical terms for extract only
- [ ] 4.4 Verify `description` fields are accurate and don't reference deprecated packages

## 5. Showcase Docs Audit

- [ ] 5.1 Fix `.groups()` → `.system()` in `getting-started.md` prose and code examples
- [ ] 5.2 Fix `.groups()` → `.system()` in `api/builder-chain.md` method table and code examples
- [ ] 5.3 Audit `api/create-system.md` — verify `.addGroup()` references are correct (this is the system builder method, not the component builder method — should be unchanged)
- [ ] 5.4 Grep all showcase markdown content for remaining `.groups(` references

## 6. Skill Refresh

- [ ] 6.1 Audit `thinking-in-animus` skill for stale API references — fix any `.groups()` mentions
- [ ] 6.2 Remove `animus-narrator` skill (experimental, not maintained)

## 7. Verification

- [ ] 7.1 Grep all READMEs for `.groups(` — zero matches expected
- [ ] 7.2 Grep all READMEs for `animus.styles` — zero matches expected
- [ ] 7.3 Grep all READMEs for `Emotion` or `@emotion` — only in legacy section of root README
- [ ] 7.4 Run `bun run check` — biome passes
- [ ] 7.5 Build showcase to verify markdown content changes don't break build
