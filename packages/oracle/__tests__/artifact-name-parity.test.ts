/**
 * The oracle's artifact filenames and its default artifact directory are
 * copies of the session's, on purpose: importing `@animus-ui/extract` at
 * runtime would put a devDependency — and a built dist — on the runtime path
 * of a package whose `bin` is `./src/cli.ts`. This test is the tether, the
 * same contract as `host-layer-parity.test.ts` — if the session renames an
 * artifact or moves its tree, the copies must move with it, because a drifted
 * name makes `loadAnimusArtifacts` refuse a perfectly good build and makes
 * `revalidate` blind to the file that actually changed.
 */

import {
  ANIMUS_ARTIFACT_DIR,
  CLI_COMMIT_ARTIFACT,
  MANIFEST_ARTIFACT,
  STYLES_ARTIFACT,
} from '@animus-ui/extract/session';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARTIFACT_DIR } from '../src/cli/run';
import {
  COMMIT_FILE,
  MANIFEST_FILE,
  STYLESHEET_FILE,
} from '../src/host/animus/loader';

describe('artifact-name parity with the session', () => {
  it('names the payload artifacts exactly as the session publishes them', () => {
    expect(MANIFEST_FILE).toBe(MANIFEST_ARTIFACT);
    expect(STYLESHEET_FILE).toBe(STYLES_ARTIFACT);
    expect(COMMIT_FILE).toBe(CLI_COMMIT_ARTIFACT);
  });

  it('defaults to the directory the writers publish into', () => {
    // Policy pairing, not just a name: `packages/oracle/src/cli/run.ts`
    // DEFAULT_ARTIFACT_DIR is where the oracle LOOKS, and the session's
    // ANIMUS_ARTIFACT_DIR is where the CLI writes (its `--out-dir` default,
    // `packages/cli/src/config.ts`) and where session hygiene sweeps. A split
    // between them makes the oracle read an empty directory and report a
    // missing build.
    expect(DEFAULT_ARTIFACT_DIR).toBe(ANIMUS_ARTIFACT_DIR);
  });
});
