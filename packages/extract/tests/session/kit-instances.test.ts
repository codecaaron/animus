/**
 * The system evaluates the kit instance the host resolves (C8): a bundler
 * alias of a kit extracts from the aliased instance instead of refusing.
 * Against the real engine.
 */
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getSharedCss } from '../../session/singleton';
import {
  createAliasedKitApp,
  disposeTempRoots,
  makeSession,
  resetAnimusGlobals,
} from './session-fixtures';

import type { HostResolve } from '../../pipeline/host-package-resolver';
import type { ExtractionSession } from '../../session/extraction-session';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  disposeTempRoots();
});

/** A host that aliases `kit` to `alt-kit`, as a bundler's `resolve.alias`
 *  would, and leaves anything else to the loader. */
function aliasingHost(root: string): HostResolve {
  return async (specifier) =>
    specifier === 'kit/definition'
      ? join(root, 'node_modules', 'alt-kit', 'dist', 'definition.mjs')
      : null;
}

function strictSession(
  root: string,
  host: HostResolve | null
): ExtractionSession {
  const session = makeSession(root, { strict: true }, { build: 'b' });
  session.hostResolve = host;
  return session;
}

describe("the system evaluates the host's kit instance", () => {
  /** Contract (C8): a strict build whose host aliases a kit evaluates the
   *  aliased instance, the one extraction analyses, so it extracts with
   *  that instance's vocabulary instead of failing with
   *  system-instance-mismatch. */
  test('an aliased kit extracts from the aliased instance', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const session = strictSession(root, aliasingHost(root));
    await session.runFullPipeline();
    expect(getSharedCss(session.key)).toContain('#ff6347');
    expect(getSharedCss(session.key)).not.toContain('#111111');
  }, 60000);

  /** Contract (C8): the instances a participant's host chooses are part of
   *  its resolution context. A participant joining a build whose host
   *  aliases a kit the owner's does not compares unequal, loads its own
   *  system, and refuses the conflict instead of reusing the owner's. */
  test('a participant with other kit instances does not reuse the system', async () => {
    const root = createAliasedKitApp('animus-kit-instances-');
    const owner = strictSession(root, null);
    await owner.runFullPipeline();
    expect(getSharedCss(owner.key)).toContain('#111111');
    const other = strictSession(root, aliasingHost(root));
    await expect(other.agreeWithSystemAuthority()).rejects.toThrow(
      'SessionConfigurationConflict'
    );
  }, 60000);
});
