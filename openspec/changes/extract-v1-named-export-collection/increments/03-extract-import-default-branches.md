# Increment 03: extract V1 import and default-export branches

**Goal:** Move the two remaining inline `parse_module_info()` collection
branches behind private helpers without changing V1 module metadata.

**Scope:** One combined, independently reversible same-file increment in
`packages/extract/src/import_resolver.rs`. It resolves D9–D11 and DEF-2. It
does not change public types, callers, named/declaration policy, binding or
resolution policy, V2, manifests, or dependencies.

## Implemented value

- [x] Characterized ordered named/default imports, bare and namespace skips,
  and named/anonymous/expression default exports through one public-parser
  matrix.
- [x] Extracted `collect_imports()` and `collect_default_export()` as private
  owners while leaving `parse_module_info()` responsible for dispatch.
- [x] Preserved completed row-01/04 helpers, matrices, binding policy, and the
  resolution chain byte-for-byte.
- [x] Ran the exact V1 verification map and final committed-SHA sweep.

## Evidence

- **Baseline:** target
  `3870557812e27dffc459c9ce6d1f6d230023872393bbeff177ad056e61839989`;
  cumulative target diff
  `f75696370fe8d8a522e57f0edb19557122d96db21d32f8a49debe4bb43741dfc`;
  G12 `0/0/0/0/1/1`; G13 selected zero tests; local resolver suite 17/17.
- **Characterization:** G13 passed 1/1 against unchanged production and the
  local resolver suite passed 18/18.
- **Structure:** final G12 is `1/2/1/2/0/0`. The final two counts use the
  function-bounded `parse_module_info()` range recorded in `design.md`; the
  earlier helper-bounded range incorrectly included the extracted bodies.
- **Behavior:** focused G13 passed 1/1 before and after extraction. The local
  resolver suite passed 18/18 at committed SHA `1b89adf81b4a82e7c4e75ac998c2886f62549c76`
  (`repowise#912fad2244ab`).
- **Preservation:** G1 was empty. G7 remained
  `35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb`.
  G14 remained, in order,
  `68ac8b39b6b4832fff197c63d5b226f81193074ffbf26860fc951c5f4f5979b8`,
  `81c8c7684c45e81ca48bb9ec4bfab5a8afa984c4040e1efcdb4cdd4d73776497`,
  `ae4f0901cce5e6313ddc94fbc5ede358df4a1469eca40eea6bbdc6eb71486e68`,
  `cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c`,
  `7c15860a0c03ad79189e3d21510b2c8e100c774bed4447da17dd4747b31a65d5`,
  and `950c40837bea1d680c297b89bbc5716803f95f536e2e61c18742425aa4f3a59f`.
  Before commit, G5 remained
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`
  and `git diff --check` was empty.
- **Rust owner claim:** strict Clippy passed. Rust units passed 643 with one
  ignored (`286 + 9 + 348`). The original post-build canary result was lost by
  the outer execution wrapper, so it is not claimed. A fresh committed-SHA
  canary passed 200/200 with 4 snapshots and 432 expectations; integration
  passed 157/157 across 11 files.
- **Committed boundary:** final target file SHA-256
  `b03c0a6d26209e6de5aa8b91731dcf05006bcf12e1fae7f4c844bbcbf156c6b8`.
  The source tree is clean at `1b89adf`; the only working-tree item is the
  unrelated untracked `openspec/changes/formalize-style-verification/`.

## Completion

- **Status:** complete and verified. The optional end reviewer was stopped when
  the user directed a value-first batched cadence; no independent-clean claim
  is made for this row.
- **Residuals:** rows 02 and 05–07 remain signal-gated and packetless. The epic
  stays active; do not create epic verify/retrospective/archive artifacts.
