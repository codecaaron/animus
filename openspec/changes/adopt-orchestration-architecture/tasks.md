## 1. Pre-Archive Validation

- [ ] 1.1 Run `openspec validate adopt-orchestration-architecture --strict` and confirm clean
- [ ] 1.2 Re-sync check: for each MODIFIED requirement (`Bun workspace script execution` and `No competing orchestration tools` in `bun-workspace`; `Bun native test runner` in `bun-test`), diff the change's copied requirement text against the current `openspec/specs/<spec>/spec.md` to confirm no sibling change has overwritten the source between drafting and archive (per `feedback_openspec_modified_semantics`)
- [ ] 1.3 Re-sync check: confirm no in-flight sibling change (`add-rust-dep-hygiene`, `fix-mdx-component-usage-scanning`, `fix-selector-rule-extraction`, `rc-channel-graduation`, `refine-code-hygiene-dx`) introduces a requirement whose name collides with this change's ADDED requirements (most likely collision surface: `code-hygiene` spec, since `refine-code-hygiene-dx` is in active flux)
- [ ] 1.4 Confirm no `package.json`, `scripts/`, `.github/workflows/`, or `CLAUDE.md` edits are present in the change directory — this is a capability-only proposal and any code-touching files indicate scope creep

## 2. 5-Persona Review (per session 87 capability-proposal pattern)

- [ ] 2.1 Release Engineering persona review: are the migration trigger criteria (Vite+ GA OR per-slice risk-acceptance) operationally meaningful and unambiguous? Can a maintainer determine criterion satisfaction without judgment-call ambiguity?
- [ ] 2.2 DX/Agent persona review: do the invariants (loud-fail preconditions, Change-Type Map, dist-staleness) preserve agent instructability? Can an agent reading only the Change-Type Map after a future cutover still select the right minimum-tier set?
- [ ] 2.3 Test Skeptic persona review: are the loud-fail contracts testable per binding? Could a CI smoke test verify that a future Vite+ binding emits the correct `ERROR: ... Run: ...` shape?
- [ ] 2.4 Topology persona review: is the permanent boundary between orchestrator and Rust pipeline correctly drawn? Does any orchestrator-invariant requirement leak into Rust-pipeline territory or vice versa?
- [ ] 2.5 OpenSpec Steward persona review: are MODIFIED/ADDED deltas correctly shaped per `feedback_openspec_modified_semantics`? Specifically, do the MODIFIED requirements include FULL updated content (not partial)? Are scenario hashtag levels correct (`####` exactly)?

## 3. Archive

- [ ] 3.1 Run `openspec archive adopt-orchestration-architecture`
- [ ] 3.2 Verify the new capability spec landed at `openspec/specs/orchestration-architecture/spec.md` with all 11 requirements present
- [ ] 3.3 Verify the MODIFIED requirements in `bun-workspace` and `bun-test` specs reflect the new content without losing original requirement text or scenarios
- [ ] 3.4 Verify the ADDED `Binding to orchestration-architecture` requirements appear in: `build-orchestration/spec.md`, `verification-tier-policy/spec.md`, `workspace-build-ordering/spec.md`, `code-hygiene/spec.md`, `rolldown-build/spec.md`

## 4. Documentation Sync (post-archive)

- [ ] 4.1 Confirm root `CLAUDE.md` is unchanged by this archive (the orchestrator-designation documentation per the `Designated Orchestrator` requirement lands in the first cutover follow-on, not in this capability change)
- [ ] 4.2 Confirm no per-package `CLAUDE.md` files reference the new capability prematurely (the binding requirements take effect when cutover follow-ons land)
- [ ] 4.3 Update `project_viteplus_orchestrator.md` memory file: the 2026-04-02 entry that said "no bun support yet" was stale at this proposal's drafting; record that bun support has landed and that this capability change has been archived

## 5. Follow-On Enumeration Confirmation

- [ ] 5.1 Confirm the proposal's `## Impact` section enumerates the five follow-on policy changes by name (`migrate-orchestrator-to-vp-run`, `migrate-build-to-vp-pack`, `migrate-lint-to-vp-check`, `migrate-test-to-vp-test`, `resolve-clean-surface`) — these are the downstream scaffolding handles for subsequent `/opsx:propose` invocations
- [ ] 5.2 Confirm none of the follow-on names is already in use as an in-flight or archived change (avoid name collision at scaffolding time)
