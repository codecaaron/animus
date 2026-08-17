import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * The prerequisites every lane that boots the REAL v2 engine shares: the
 * host-native NAPI binary and the sibling package dists.
 *
 * Owned here because the resolution being probed is this package's own —
 * `packages/extract/index-v2.js` tries exactly these three candidate names
 * from exactly this directory — so a new target triple moves in one place
 * instead of once per consuming lane. Previously the same list, the same
 * required dists and the same build commands were restated in
 * `packages/next-plugin/tests/webpack-gauntlet/prerequisites.ts` and
 * `packages/vite-plugin/tests/dev-lane/prerequisites.ts`, whose failure mode
 * is a silent green skip.
 *
 * Test support, not shipped API: `packages/extract/tests/` is outside the
 * package's `files` list and unreachable through its `exports` map, so this
 * module widens nothing. The two plugin lanes reach it by relative path, the
 * idiom `packages/next-plugin/tests` already uses for
 * `../../extract/session/*`.
 *
 * Skip semantics: this module never throws. A missing prerequisite is
 * reported as `{ ok: false, reason }`, and the reason is the lane's skip
 * message.
 */

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
/** The extract package root — the dir `index-v2.js` resolves the binary from. */
const EXTRACT_ROOT = join(TESTS_DIR, '..');
export const REPO_ROOT = join(EXTRACT_ROOT, '../..');

const BUILD_NAPI = "bun run --filter '@animus-ui/extract' build:v2:debug";
const BUILD_DISTS = 'vp run build:ts';

/** One probe's answer: `ok`, or the missing artifact plus its build command. */
export interface EnginePrerequisites {
  ok: boolean;
  /** Empty when `ok`; otherwise names the missing artifact + remediation. */
  reason: string;
}

/** The candidate list mirrors `loadNative()` in index-v2.js — the same
 *  host-native resolution the engine performs at run time, so a
 *  foreign-target artifact never counts as present. */
function hostNativeBinaryExists(): boolean {
  const { platform, arch } = process;
  const candidates = [
    `animus-extract-v2.${platform}-${arch}.node`,
    `animus-extract-v2.${platform}-${arch}-gnu.node`,
    `animus-extract-v2.${platform}-${arch}-msvc.node`,
  ];
  return candidates.some((name) =>
    existsSync(join(EXTRACT_ROOT, 'crates/extract-v2', name))
  );
}

/** Dists a real-engine lane's fixture and plugin resolve at run time. */
const REQUIRED_DISTS = [
  'packages/extract/dist/index.cjs',
  'packages/system/dist/index.js',
  'packages/properties/dist/index.js',
] as const;

export function probeEnginePrerequisites(): EnginePrerequisites {
  if (!hostNativeBinaryExists()) {
    return {
      ok: false,
      reason: `v2 NAPI native binary not found for ${process.platform}-${process.arch} under packages/extract/crates/extract-v2/. Run: ${BUILD_NAPI}`,
    };
  }

  const missingDist = REQUIRED_DISTS.find(
    (rel) => !existsSync(join(REPO_ROOT, rel))
  );
  if (missingDist) {
    return { ok: false, reason: `${missingDist} missing. Run: ${BUILD_DISTS}` };
  }

  return { ok: true, reason: '' };
}
