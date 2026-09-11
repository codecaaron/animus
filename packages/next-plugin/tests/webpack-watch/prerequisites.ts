import { existsSync } from 'fs';
import { join } from 'path';

import {
  probeEnginePrerequisites,
  REPO_ROOT,
} from '../../../extract/tests/engine-prerequisites';

import type { EnginePrerequisites } from '../../../extract/tests/engine-prerequisites';

export { REPO_ROOT };

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
    return {
      ok: false,
      reason: `unknown webpack-watch fixture '${fixtureId}'`,
    };
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
