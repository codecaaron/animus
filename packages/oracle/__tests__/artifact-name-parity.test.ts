/**
 * The oracle copies these names instead of importing them at runtime: its
 * `bin` runs from source, so the extract dist stays off the runtime path.
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
    // The oracle reads from this directory and the writers publish into it;
    // a split makes the oracle read an empty directory and report no build.
    expect(DEFAULT_ARTIFACT_DIR).toBe(ANIMUS_ARTIFACT_DIR);
  });
});
