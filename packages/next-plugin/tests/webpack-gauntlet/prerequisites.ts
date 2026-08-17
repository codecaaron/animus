import { existsSync } from 'fs';
import { join } from 'path';

import {
  probeEnginePrerequisites,
  REPO_ROOT,
} from '../../../extract/tests/engine-prerequisites';

import type { EnginePrerequisites } from '../../../extract/tests/engine-prerequisites';

/**
 * Prerequisite probes for the webpack gauntlet (openspec:
 * next-webpack-served-transform-coherence, increment 03).
 *
 * The gauntlet runs against the EXACT compiled webpack each Next e2e
 * fixture ships — never a separately installed webpack — so the only
 * prerequisite this file owns is the fixture install. The real-engine lane
 * also needs the NAPI binary + package dists, which are `packages/extract`'s
 * own prerequisites and are probed by their owner
 * (`packages/extract/tests/engine-prerequisites.ts`). Missing prerequisites
 * SKIP LOUDLY with the exact remediation.
 */

export { REPO_ROOT };

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

export function probeFixtureWebpack(fixtureId: string): EnginePrerequisites {
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

export function probeRealEnginePrerequisites(): EnginePrerequisites {
  const fixtureProbe = probeFixtureWebpack('next-app');
  if (!fixtureProbe.ok) return fixtureProbe;

  return probeEnginePrerequisites();
}
