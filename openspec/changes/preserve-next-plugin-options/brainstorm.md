# Exploration evidence

This capture is based on the 2026-07-19 RepoWise risk/context/why audit, live
inspection of `packages/next-plugin/src/{with-animus,plugin,types}.ts`, the
current `next-config-wrapper`, `vite-extraction-plugin`, and
`layer-declaration-delivery` specifications, package tests and README, and git
history for the introduction of `extensions` (`1996d05`) and `layers`
(`a7a7fe1`). The analyzer's broad claim that `plugin.ts` has no governing
decision is a false positive: several canonical requirements govern its
behavior. The audit did expose a narrower public-adapter regression.

## Known now

- `AnimusNextOptions` exposes `extensions` and `layers`, and
  `AnimusWebpackPlugin` consumes both.
- `withAnimus` reconstructs a subset of `AnimusNextOptions` before constructing
  the plugin. That copy omits `extensions` and `layers`, so a valid public
  configuration is silently discarded at the adapter boundary.
- Passing the original typed options object to `AnimusWebpackPlugin` is the
  smallest fix and makes future additions fail closed at the type boundary
  instead of requiring another synchronized property list.
- The existing `Options forwarded to plugin` scenario only names `strict` and
  `verbose`, so the canonical wrapper requirement does not guard the complete
  option contract.
- The README's `withAnimus(nextConfig, options)` example is inconsistent with
  the implemented and specified curried API, `withAnimus(options)(nextConfig)`.
- The affected source is high-churn and single-owner. A focused public-boundary
  regression test is preferable to a broad internal refactor.

## Deferred

- Decomposing the large `AnimusWebpackPlugin` class remains deferred until a
  separate audit identifies a behavior seam with a measured complexity or
  defect reduction and a complete test inventory for that seam.
- Changing tolerant filesystem/package-resolution error policy remains
  deferred until a dedicated failure-policy audit produces a reproducible
  case and a canonical strict-versus-best-effort decision.
- Replacing MD5 content fingerprints remains deferred unless a security review
  shows the hashes cross a trust boundary or a collision measurement shows a
  correctness risk; current uses are non-security build-cache fingerprints.
- Refreshing RepoWise health/decision indexing is deferred until these local
  increments are landed and indexable; the current index is pinned to the
  committed revision and cannot score uncommitted OpenSpec governance.

## Candidate north stars

- Every valid `AnimusNextOptions` value supplied through `withAnimus` reaches
  the injected plugin without an adapter-maintained allowlist.
- Public examples and executable tests describe the same curried wrapper API.
- Changes to the high-churn plugin surface stay at the narrowest owner boundary
  that expresses the behavior; revisit only if the deferred seam evidence is
  produced.

## Candidate guardrails

- The change SHALL NOT modify `packages/next-plugin/src/plugin.ts`; check with
  `git diff -- packages/next-plugin/src/plugin.ts` and require empty output.
- The wrapper SHALL NOT hand-copy individual plugin options; check that
  `with-animus.ts` contains exactly one `new AnimusWebpackPlugin(options)` and
  no `system: options.system`, `extensions: options.extensions`, or
  `layers: options.layers` constructor entries.
- The regression test SHALL exercise the exported `withAnimus` wrapper and the
  real injected `AnimusWebpackPlugin`, and SHALL assert both `extensions` and
  `layers` reach `getOptions()`; run the focused Vitest file in RED and GREEN.
- The change SHALL NOT disturb the pre-existing Rust/integration increments;
  compare the final path inventory with the baseline status captured before
  this change.
- The README SHALL NOT show the obsolete two-argument wrapper call; search for
  `withAnimus(nextConfig,` and require no matches.
- The owner claim SHALL remain green: run compile, TypeScript units, and the
  Next consumer verification exactly as routed by the repository change map.

## Decision chain

1. Start from the RepoWise Attention Needed lead, but verify the claimed lack
   of governance against current OpenSpec requirements and source history.
2. Reject the broad governance label because current specifications govern the
   adapter and plugin behavior; retain the churn signal as a reason to minimize
   scope.
3. Trace the public option type through `withAnimus` into the plugin and find
   the concrete loss of `extensions` and `layers` at the hand-copied boundary.
4. Prefer whole-object typed forwarding over adding two more copied fields,
   because it fixes the present regression and removes the synchronization
   failure mode without changing plugin internals.
5. Strengthen the canonical wrapper requirement and prove it at the public
   boundary with a real plugin instance, following RED-GREEN TDD.
6. Correct the adjacent README invocation because it contradicts the same
   public wrapper contract; leave all broader plugin cleanup for separately
   evidenced increments.
