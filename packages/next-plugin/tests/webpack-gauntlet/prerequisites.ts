import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Prerequisite probes for the webpack gauntlet (openspec:
 * next-webpack-served-transform-coherence, increment 03).
 *
 * The gauntlet runs against the EXACT compiled webpack each Next e2e
 * fixture ships — never a separately installed webpack — so its only
 * prerequisites are fixture installs (and, for the real-engine lane, the
 * NAPI binary + package dists). Missing prerequisites SKIP LOUDLY with the
 * exact remediation, mirroring
 * `packages/vite-plugin/tests/dev-lane/prerequisites.ts`.
 */

const GAUNTLET_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GAUNTLET_DIR, '../../../..');

/** Fixture id → the compiled webpack module its Next install ships. */
export const WEBPACK_FIXTURES = [
  {
    id: 'next-app',
    webpackPath: join(
      REPO_ROOT,
      'e2e/next-app/node_modules/next/dist/compiled/webpack/webpack.js'
    ),
  },
  {
    id: 'next16-app',
    webpackPath: join(
      REPO_ROOT,
      'e2e/next16-app/node_modules/next/dist/compiled/webpack/webpack.js'
    ),
  },
] as const;

export interface GauntletPrerequisites {
  ok: boolean;
  /** Empty when `ok`; otherwise names the missing artifact + remediation. */
  reason: string;
}

export function probeFixtureWebpack(fixtureId: string): GauntletPrerequisites {
  const fixture = WEBPACK_FIXTURES.find((f) => f.id === fixtureId);
  if (!fixture) {
    return { ok: false, reason: `unknown gauntlet fixture '${fixtureId}'` };
  }
  if (!existsSync(fixture.webpackPath)) {
    return {
      ok: false,
      reason: `${fixture.webpackPath} missing — the ${fixtureId} fixture install is absent. Run: bun install`,
    };
  }
  return { ok: true, reason: '' };
}

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

/** Dists the real-engine lane's fixture resolves at run time. */
const REQUIRED_DISTS = [
  'packages/extract/dist/index.cjs',
  'packages/system/dist/index.js',
  'packages/properties/dist/index.js',
] as const;

export function probeRealEnginePrerequisites(): GauntletPrerequisites {
  const fixtureProbe = probeFixtureWebpack('next-app');
  if (!fixtureProbe.ok) return fixtureProbe;

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
