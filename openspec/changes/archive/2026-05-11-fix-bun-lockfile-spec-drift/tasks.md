## 1. Update active spec

- [x] 1.1 Replace `bun.lockb` → `bun.lock` (5 occurrences) in `openspec/specs/bun-workspace/spec.md`
- [x] 1.2 Verify the requirement headers and scenario structures match the MODIFIED blocks in `specs/bun-workspace/spec.md` (whitespace-insensitive)

## 2. Update root CLAUDE.md

- [x] 2.1 Replace `bun.lockb` → `bun.lock` (1 occurrence) in `CLAUDE.md`

## 3. Verification

- [x] 3.1 Run `bunx vp run verify:lint` — confirm lint + fmt still clean
- [x] 3.2 Run `openspec validate fix-bun-lockfile-spec-drift` — confirm change validates
- [x] 3.3 Confirm no `bun.lockb` references remain in active files: `grep -rn "bun\.lockb" openspec/specs/ CLAUDE.md` returns no matches (archived `openspec/changes/archive/*/` is excluded by scope — historical record)
