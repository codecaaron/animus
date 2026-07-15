# Journal — extract-v2-default-flip

- 2026-07-13 02:59 · seed — Apply started. Envelope-licensed rows: none
  (rows 01/02 lazy on DEF-3, row 03 lazy on DEF-1). Specs were fully
  authored at propose (4 capabilities); increment creation awaited
  resolving signals per the lazy rule.
- 2026-07-13 02:59 · signal — DEF-3 resolving signal landed:
  `external:release-window`. The user directed the orchestration
  session to apply this change now ("Apply the changes:
  extract-v2-default-flip => extract-quirk-shed => total-dynamic-floor
  => prop-flow-reachability", 2026-07-13), scheduling the ship-and-flip
  release event as this apply. Licenses creation of increments 01 and
  02. Row 03 remains gated on DEF-1 (resolves at increment 02's
  review).
- 2026-07-13 03:09 · review — inc 01 subagent review: APPROVE, 5 minor
  findings. Fixed inline: postpack-smoke.sh rejects unknown args
  (fail-loud contract); index-v2.js message no longer offers
  ANIMUS_ENGINE=v1 as a consumer-facing hatch (fixture-level only).
  Accepted-as-informational: bun-pack-vs-npm-publish artifact
  non-identity; stale Proxy text (row 03 scope).
- 2026-07-13 03:09 · friction — known gap recorded from review: the v1
  loader (`packages/extract/index.js`, NAPI-RS codegen) throws the
  generic "Cannot find native binding" message, not the actionable
  fail-loud shape §engine-release-packaging/Missing engine binaries
  fail loud describes. The requirement's only scenario is v2-specific
  and index.js is regenerated codegen — carrying as a gap, candidate
  spec-scenario or wrapper in extract-quirk-shed.
- 2026-07-13 03:09 · reorientation (off-beat: entropy auditor) —
  Observe: inc 01 landed, gates G1/G2/G3 green. Orient: no deferral
  resolved without signal (DEF-3 signal recorded before creation);
  no decision leaked into specs (envelope untouched); mode matched
  density. Decide: proceed to inc 02 per registry. Act: row 01 ticked
  03:09; full adversarial pass due at row 02 (K=2).
- 2026-07-13 03:20 · review — inc 02 subagent review: APPROVE, 2 minor
  findings. Finding 1 (delta specs authored v2-default as ADDED while
  main specs still carry the v1-default `Engine selection option`
  requirement — sync would manufacture a contradiction) fixed inline by
  orchestrator: both delta specs rewritten as MODIFIED against the
  existing requirement name; `openspec validate` green. Finding 2
  (drift-warning latch fires once per process, first drifted file only)
  documented as D4's rider.
- 2026-07-13 03:20 · signal — DEF-1 resolved at inc 02's review (its
  designated alternate signal): ACCEPT-AND-DOCUMENT → D4. Licenses
  creation of increment 03 (scaffolding retirement).
- 2026-07-13 03:20 · reorientation (FULL adversarial pass, K=2) —
  Observe: inc 01+02 landed; all gates green (G1 count=6 PASS, G2, G3,
  G4 three fixtures; compile/unit/consumer proofs green). Orient vs
  Ledger: DEF-1 → D4 at its designated signal; DEF-3 → D5 at
  external:release-window; DEF-2 untouched (quirk-shed's). Vs NS: NS1
  held (fixture proofs byte-level green both engines); NS2 held (parity
  untouched); NS3 strengthened (strict release matrix + postpack
  smoke). Falsifier: main-spec v1-default requirement would fail
  black-box post-flip — addressed via MODIFIED deltas; escape-hatch
  "output unchanged" rests on code-path identity + G4 build-green, not
  byte-diff — accepted, parity harness covers byte-equality
  engine-level. Entropy auditor: no deferral resolved without signal;
  the ADDED/MODIFIED leak was caught and fixed. Heretic (recorded, not
  adopted): corpus is three in-house fixtures with one ordering shape;
  binary distribution and default flip debut in the same release with
  no bake time — mitigation is D2's live escape hatch and the retained
  differential harness. Decide: proceed to row 03 under DEF-1's D4.
  Act: row 02 ticked 03:20.
- 2026-07-13 03:29 · reorientation (off-beat: entropy auditor) — inc 03
  landed: Proxy retired (module exports native binding directly;
  fail-loud missing-binary error kept), code/css/chain-parity retired
  from the archive with RETIRED.md, gates G1/G2/G3 + verify:vite +
  verify:lint green. Auditor: retirement stayed inside D3's
  provably-dead enumeration (seam-battery and _parity untouched — G1
  proves it); no decision leaked; no deferral resolved off-signal. All
  three registry rows ticked — apply complete. verify + retrospective
  artifacts remain for a follow-up verify action; DEF-2
  (loadSystemModule port) correctly remains open, owned by
  extract-quirk-shed#07.

- 2026-07-15 14:50 EDT · registry-correction — The final audit narrowed the
  fail-loud requirement to the V2 loader, matching the implemented scenario,
  and normalized all three registry rows to their real increment packet paths,
  requirement headers, and journal-backed tick timestamps. The historical V1
  generic-loader observation remains intentional outside this change.
