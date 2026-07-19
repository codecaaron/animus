# Verification Truth Hardening — Exploration Record

Evidence already established in this session: the repository-wide ANTICHRIST
audit, its executable witnesses, the user's instruction to remediate, and the
approved surgical owner-boundary design. The audit distinguished
letter-compliant enforcement exploits from ordinary coverage bugs and rejected
configuration-restatement tests as remediation.

## Decision chain

1. Verification volume is not itself a defect. A candidate matters only when a
   plausible implementer can obtain a green result while the protected outcome
   is false.
2. The highest-impact witness is release artifact substitution: the packed lane
   tests pre-release Bun tarballs under dependency-masking overrides, while the
   release job later rewrites manifests and publishes newly packed directories.
3. The next class is observation substitution: receipts infer an engine from
   source/configuration, Worker assertions aggregate served and unserved CSS,
   and NAPI freshness selects an arbitrary binary rather than the host binary.
4. The final class is sanctioned suppression: file-deletion risk is only a
   note, cargo-machete ignores are unconstrained, attw suppresses a whole rule,
   and crate-wide Rust allows can neutralize strict Clippy.
5. The repair therefore belongs at each owner boundary. Do not introduce a
   generic compliance framework or tests that merely restate task/workflow
   wiring.

## Known now

- Release must stamp versions before packing, verify the exact tarballs that
  will be published, and publish those same bytes.
- Packed installation must not use overrides that hide internal dependency
  edges. Every installed internal package instance must match the corresponding
  tested tarball version.
- Vinext and React Router Worker build/assert/dry-run behavior is supported and
  must gate releases alongside the existing consumers.
- The TypeScript unit tier currently omits active colocated tests and the
  non-canary extractor test.
- Worker delivery assertions must inspect the Wrangler-served client root
  independently from server output.
- NAPI freshness must select the binary for the current platform, architecture,
  and libc rather than the first matching filename.
- Engine receipts may claim only runtime-observed identity. Source/config regex
  inference is not observation.
- Risky hygiene file deletion must not finish green on compile+lint alone when
  the tool itself documents invisible build-time consumers.
- The current cargo-machete ignore list is empty, so the capability can fail
  closed without grandfathering entries.
- The attw DEF-5 exemption is broad enough to absorb new declaration failures.
- No active Rust source currently uses `allow(warnings)` or
  `allow(clippy::all)`, so blanket suppression can be prohibited without
  migration.

## Deferred variables and resolving signals

- **Engine marker transport:** whether Vite and Next can share one marker format
  is deferred until a failing adapter test establishes each host's stable build
  output hook. The resolving signal is a built artifact written by the actual
  selected engine path and consumed by the assertion lane.
- **DEF-5 removal mechanism:** source import rewriting versus a toolchain emit
  fix is deferred until a fresh build plus attw output identifies the exact
  remaining diagnostics. The resolving signal is attw passing without
  `--ignore-rules internal-resolution-error`.
- **Hygiene build selection:** automatic mapping from a removed file to one or
  more consumer builds is deferred. The resolving signal is a reliable
  ownership mapping derived from the Change-Type Map. This increment will fail
  closed for file deletion instead of guessing.
- **Cross-platform NAPI validation:** only host selection is in scope locally.
  Cross-target load proof remains CI-owned; the resolving signal is an
  executable runner for each supported target.

## Candidate North Star

- A green verification result describes the artifact and execution path that
  will actually be consumed.
- Evidence is produced by the protected behavior, not inferred from adjacent
  configuration.
- Suppressions are incident-bound, observable, and unable to absorb unrelated
  future failures.
- The smallest behavior check wins over a second policy/configuration model.
- Provisional: release may perform the packed consumer proof inside the release
  job rather than a prerequisite job; revisit when CI supports passing a single
  immutable release bundle between jobs without repacking.

## Candidate guardrails

- The change SHALL NOT publish a package directory after verifying a different
  tarball. Executable check: release publishes explicit `.tgz` paths produced
  before verification.
- The packed lane SHALL NOT use dependency overrides for internal packages.
  Executable check: install direct local tarballs and recursively validate every
  installed `@animus-ui/*/package.json` against the tested tarball map.
- A receipt SHALL NOT label configured intent as `engineLoaded`. Executable
  check: corrupt the runtime route in an adapter test and require the observed
  marker/receipt to follow the loaded module.
- Worker CSS assertions SHALL NOT combine server CSS with the served-client
  proof. Executable check: a fixture with server-only CSS fails the client-root
  assertion.
- Freshness checks SHALL NOT accept a foreign binary as evidence for the host
  loader. Executable check: a fresh foreign/stale host fixture fails.
- Rust verification SHALL NOT accept blanket warning/Clippy suppression.
  Executable check: a policy fixture containing crate-wide suppression fails
  while narrow lint-specific allows remain accepted.
- Cargo dependency hygiene SHALL NOT silently honor an unreviewed non-empty
  ignore list. Executable check: parsed Cargo metadata with an ignored entry
  fails before cargo-machete runs.
- Type lint exemptions SHALL NOT suppress new diagnostics. Executable check:
  attw runs without the broad rule ignore, or an exact incident-bound check
  fails when the diagnostic set expands.
- Hygiene SHALL NOT report success after deleting a file invisible to its
  safety envelope. Executable check: a file-deletion receipt produces a
  non-zero manual-review verdict.
- The implementation SHALL NOT add workflow/source-string contract tests.
  Executable check: review the added tests; each must execute a behavior or
  validator against a failing fixture.
