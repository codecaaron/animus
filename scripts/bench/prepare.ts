#!/usr/bin/env bun

// bun scripts/bench/prepare.ts — fetches the published releases verify:bench measures
// against (scripts/bench/releases.json) into .bench/releases/<version>/ and
// checks each tarball against its pinned sha512. verify:bench never fetches:
// it fails on a missing or mismatched tarball and names this script. A plain
// script, not a task, under the root graph's task budget.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '..', '..');
export const BENCH = join(REPO, '.bench');
const PINS = join(import.meta.dirname, 'releases.json');

interface Pins {
  /** The blocking last-known-fast release. */
  reference: string;
  /** Releases measured only as labelled candidates, never as the reference. */
  diagnostic: string[];
  releases: Record<string, Record<string, string>>;
}

function readPins(): Pins {
  // SAFETY: a committed file this module owns, read whole.
  return JSON.parse(readFileSync(PINS, 'utf8')) as Pins;
}

export const pins = readPins();

export function tarballPath(version: string, name: string): string {
  return join(
    BENCH,
    'releases',
    version,
    `${name.slice(1).replace('/', '-')}-${version}.tgz`
  );
}

/** Each pinned tarball of `version` that is missing or whose bytes do not
 *  hash to its pin. */
export function releaseProblems(version: string): string[] {
  const packages = pins.releases[version];
  if (packages === undefined) return [`${version} is not pinned`];
  return Object.entries(packages).flatMap(([name, integrity]) => {
    const path = tarballPath(version, name);
    if (!existsSync(path)) return [`${name}@${version} missing at ${path}`];
    const actual = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
    return actual === integrity
      ? []
      : [`${name}@${version} at ${path} does not match its pinned sha512`];
  });
}

function fetchRelease(version: string): void {
  const dir = join(BENCH, 'releases', version);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(pins.releases[version] ?? {})) {
    const packed = spawnSync(
      'npm',
      ['pack', `${name}@${version}`, '--pack-destination', dir, '--silent'],
      { encoding: 'utf8' }
    );
    if (packed.status !== 0) {
      console.error(
        `[bench prepare] npm pack ${name}@${version} failed:\n${packed.stderr}`
      );
      process.exit(1);
    }
  }
}

function main(): void {
  for (const version of [pins.reference, ...pins.diagnostic]) {
    if (releaseProblems(version).length > 0) fetchRelease(version);
    const problems = releaseProblems(version);
    if (problems.length > 0) {
      console.error(`[bench prepare] ${problems.join('\n')}`);
      process.exit(1);
    }
    console.error(`[bench prepare] ${version} ready`);
  }
}

if (import.meta.main) main();
