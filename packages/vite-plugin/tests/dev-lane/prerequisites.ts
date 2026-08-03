import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Prerequisite probe for the dev-server conformance lane.
 *
 * Unlike the rest of `packages/vite-plugin/tests` (whose only prerequisite is
 * `bun install`), this lane boots a real Vite dev server that loads the design
 * system through the v2 NAPI binary and the sibling package dists. Those are
 * NOT materialized by `verify:unit:ts`, so the lane probes for them and skips
 * with an actionable reason instead of failing the fast unit tier.
 *
 * The binary candidate list mirrors `packages/extract/index-v2.js` — the same
 * host-native resolution the plugin performs at runtime, so a foreign-target
 * artifact never counts as present.
 */

const LANE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(LANE_DIR, '../../../..');

const BUILD_NAPI = "bun run --filter '@animus-ui/extract' build:v2:debug";
const BUILD_DISTS = 'vp run build:ts';

function hostNativeBinaryExists(): boolean {
  const { platform, arch } = process;
  const candidates = [
    `animus-extract-v2.${platform}-${arch}.node`,
    `animus-extract-v2.${platform}-${arch}-gnu.node`,
    `animus-extract-v2.${platform}-${arch}-msvc.node`,
  ];
  return candidates.some((name) =>
    existsSync(join(REPO_ROOT, 'packages/extract/crates/extract-v2', name))
  );
}

/** Dists the fixture's system module and the plugin resolve at run time. */
const REQUIRED_DISTS = [
  'packages/extract/dist/index.cjs',
  'packages/system/dist/index.js',
  'packages/properties/dist/index.js',
] as const;

export interface DevLanePrerequisites {
  ok: boolean;
  /** Empty when `ok`; otherwise names the missing artifact and its build command. */
  reason: string;
}

export function probeDevLanePrerequisites(): DevLanePrerequisites {
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
    return {
      ok: false,
      reason: `${missingDist} missing. Run: ${BUILD_DISTS}`,
    };
  }

  return { ok: true, reason: '' };
}
