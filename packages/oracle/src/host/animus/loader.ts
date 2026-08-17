import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AnimusAdapterError } from './errors';
import { isManifestJsonObject, isManifestJsonString } from './manifest-types';

import type { AnimusHostInput } from './host';
import type { ManifestJsonValue } from './manifest-types';

export const MANIFEST_FILE = 'manifest.json';

export const STYLESHEET_FILE = 'styles.css';

export const COMMIT_FILE = 'commit.json';

/**
 * The manifest keeps travelling untrusted (`asManifest` is its validator);
 * `commit.json` is read key-by-key through the manifest module's guards, so
 * nothing in this module ever reads a field off a value it has not decided the
 * domain of first.
 */
const parseArtifactJson = (text: string): ManifestJsonValue => JSON.parse(text);

/**
 * Read one `.animus` output directory into a host input.
 *
 * Both `manifest.json` and `styles.css` are required. `createAnimusHost`
 * tolerates a missing stylesheet — that seam exists for synthetic and
 * in-memory callers — but a *directory* missing one of them is not a degraded
 * artifact set, it is an incomplete build, and quietly producing a
 * token-less host from it would hide the real problem behind an oracle that
 * merely answers a little less.
 *
 * `commit.json` is optional and supplies the program label: the content hash
 * the build recorded for the manifest, which is what makes two runs of the
 * same source recognisably the same program in a probe result.
 */
export const loadAnimusArtifacts = (dir: string): AnimusHostInput => {
  const manifestPath = join(dir, MANIFEST_FILE);
  const stylesheetPath = join(dir, STYLESHEET_FILE);

  const missing = [
    ...(existsSync(manifestPath) ? [] : [MANIFEST_FILE]),
    ...(existsSync(stylesheetPath) ? [] : [STYLESHEET_FILE]),
  ];
  if (missing.length > 0) {
    throw new AnimusAdapterError(
      `${dir} is not an animus artifact directory — missing ` +
        `${missing.join(' and ')}. \`animus build\` writes ` +
        `${MANIFEST_FILE}, ${STYLESHEET_FILE} and ${COMMIT_FILE} into its ` +
        'output directory',
      { construct: 'artifact-directory' }
    );
  }

  const raw = readFileSync(manifestPath, 'utf8');
  let manifest: ManifestJsonValue;
  try {
    manifest = parseArtifactJson(raw);
  } catch {
    throw new AnimusAdapterError(`${manifestPath} is not valid JSON`, {
      construct: MANIFEST_FILE,
      snippet: raw.slice(0, 120),
    });
  }

  const commitPath = join(dir, COMMIT_FILE);
  let label: string | undefined;
  if (existsSync(commitPath)) {
    try {
      const commit = parseArtifactJson(readFileSync(commitPath, 'utf8'));
      const payloads = isManifestJsonObject(commit)
        ? commit.payloads
        : undefined;
      const entry = isManifestJsonObject(payloads)
        ? payloads[MANIFEST_FILE]
        : undefined;
      const hash = isManifestJsonObject(entry) ? entry.hash : undefined;
      if (isManifestJsonString(hash)) label = `animus-commit:${hash}`;
    } catch {
      throw new AnimusAdapterError(`${commitPath} is not valid JSON`, {
        construct: COMMIT_FILE,
      });
    }
  }

  const input: AnimusHostInput = {
    manifest,
    stylesheetText: readFileSync(stylesheetPath, 'utf8'),
  };
  // No `commit.json`, or one without a recorded manifest hash, leaves `label`
  // off the input entirely — `createAnimusHost` distinguishes that from a
  // label it was given.
  if (label !== undefined) input.label = label;

  return input;
};
