/**
 * Type-parity assertion — Shape B of the structural-mirror pair
 * (openspec: system-color-scheme, cross-cutting 2.1; inc-03 review).
 *
 * `@animus-ui/vite-plugin` declares its `appearanceBootstrap` option
 * STRUCTURALLY as `{ code: string; cspHash: string }` rather than importing
 * `AppearanceBootstrapArtifact`, because the plugin must not depend on
 * `@animus-ui/system` at all (guardrail G3). That inline mirror is therefore
 * unchecked by the compiler: the two declarations can drift silently.
 *
 * This file closes the type half of that gap from the system side. Its twin —
 * Shape A, a source-text pin over the interface's member names — lives in
 * `packages/vite-plugin/tests/appearance-bootstrap-injection.test.ts`. Both are
 * needed: assignability alone would not notice a member RENAME that keeps the
 * shape compatible in one direction, and a source-text pin alone would not
 * notice a member TYPE change.
 *
 * Compiled by `tsconfig.test-d.json` (auto-included via `./**\/*.test-d.ts`),
 * run by `vp run verify:types`. It is a type-only file — nothing here executes.
 *
 * The import is a DIRECT `src` import on purpose: the contract under test is
 * the source declaration, not a build artifact, so this must not depend on
 * `dist/` being fresh.
 */

import type { AppearanceBootstrapArtifact } from '../src/bootstrap/createAppearanceBootstrap';

// ─── Type Utilities ─────────────────────────────────────────

type Assert<T extends true> = T;

/** Bidirectional assignability — neither side may gain or lose structure. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ─── The Mirror Under Test ──────────────────────────────────

/**
 * Transcribed verbatim from `AnimusExtractOptions['appearanceBootstrap']` in
 * `packages/vite-plugin/src/index.ts`. Update BOTH sides together — this
 * literal is the whole point of the assertion.
 */
type PluginMirror = { code: string; cspHash: string };

// ─── Assertions ─────────────────────────────────────────────

/**
 * The plugin's inline mirror and the generator's real artifact are the same
 * type. If this stops compiling, the two declarations have drifted: reconcile
 * `PluginMirror` above with `AnimusExtractOptions['appearanceBootstrap']` and
 * with `AppearanceBootstrapArtifact`.
 */
type _ArtifactMirrorIsExact = Assert<
  Exact<PluginMirror, AppearanceBootstrapArtifact>
>;

/**
 * Non-vacuity control: `Exact<>` must actually be able to report `false`, so a
 * green assertion above means "identical", not "the helper always passes".
 * A member rename and a member-type change are both caught.
 */
type _ExactRejectsRenamedMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; hash: string }
  > extends false
    ? true
    : false
>;

type _ExactRejectsRetypedMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; cspHash: string | undefined }
  > extends false
    ? true
    : false
>;

type _ExactRejectsExtraMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; cspHash: string; nonce: string }
  > extends false
    ? true
    : false
>;
