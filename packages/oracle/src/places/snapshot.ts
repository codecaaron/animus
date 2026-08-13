import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createAnimusHost } from '../host/animus/host';
import { loadAnimusArtifacts } from '../host/animus/loader';
import { asManifest } from '../host/animus/manifest-types';
import { readSourceStructure } from './source';

import type { AnimusHost, AnimusHostOptions } from '../host/animus/host';
import type {
  AnimusManifest,
  ManifestFileFacts,
  ManifestUsageFact,
} from '../host/animus/manifest-types';
import type { SourceRead } from './source';

/**
 * A Snapshot binds one artifact set to one source tree generation
 * (PLACES.md §2). Every fact the places layer produces is scoped to it; two
 * snapshots never mix.
 */
export interface Snapshot {
  host: AnimusHost;
  manifest: AnimusManifest;
  /** `animus-commit:<hash>` when the artifact set carried a commit record. */
  generation: string | undefined;
  /** The directory the manifest's file keys are relative to. */
  sourceRoot: string;
  fileFacts(file: string): ManifestFileFacts | undefined;
  /** Every manifest file key that has facts. */
  files(): readonly string[];
  /**
   * Structure of one file, correspondence-checked against the manifest's
   * usage record for that file (PLACES.md §1). A refusal is an answer about
   * generations, not an error: the working tree no longer matches the
   * program the artifacts describe, and mixing them would produce facts
   * about a program that never existed.
   */
  structureOf(file: string): StructureResult;
}

export type StructureResult =
  | { ok: true; read: SourceRead }
  | {
      ok: false;
      reason: 'not-in-snapshot' | 'source-missing' | 'diverged';
      detail: string;
      divergences?: readonly string[];
    };

export interface SnapshotOptions {
  /** Defaults to the artifact directory's parent — where `animus build` ran. */
  sourceRoot?: string;
  host?: AnimusHostOptions;
}

const tagOf = (fact: ManifestUsageFact): string | undefined => {
  const tag = fact.element?.tag;
  if (tag === undefined) return undefined;
  return tag.ident ?? tag.member;
};

/**
 * Project a fresh structural read onto the manifest's flat usage sequence.
 * Agreement is the per-file correspondence witness; any disagreement means
 * the file drifted since extraction. Only the manifest's knowledge is
 * checked — the structural read legitimately sees more (spreads, skipped
 * attributes), and extra knowledge is not drift.
 */
const usageDivergences = (
  read: SourceRead,
  usage: readonly ManifestUsageFact[]
): string[] => {
  const divergences: string[] = [];
  const recorded = usage.filter((fact) => fact.element !== undefined);

  if (recorded.length !== read.elements.length) {
    divergences.push(
      `element count: manifest recorded ${recorded.length} JSX element(s), ` +
        `source now has ${read.elements.length}`
    );
    return divergences;
  }

  recorded.forEach((fact, index) => {
    const element = read.elements[index];
    const tag = tagOf(fact);
    if (tag !== element.tag) {
      divergences.push(
        `element ${index}: manifest recorded <${tag ?? '?'}>, source has ` +
          `<${element.tag}>`
      );
      return;
    }
    for (const attr of fact.element?.attrs ?? []) {
      const mine = element.attributes.find((a) => a.name === attr.name);
      if (mine === undefined) {
        divergences.push(
          `element ${index} <${element.tag}>: manifest recorded attribute ` +
            `'${attr.name}', source no longer has it`
        );
        continue;
      }
      if (attr.dynamic === true) {
        if (mine.kind === 'static') {
          divergences.push(
            `element ${index} <${element.tag}>: '${attr.name}' was dynamic ` +
              'at extraction, source now has a static value'
          );
        }
        continue;
      }
      if (attr.staticValue !== null && attr.staticValue !== undefined) {
        if (mine.kind !== 'static' || mine.value !== String(attr.staticValue)) {
          divergences.push(
            `element ${index} <${element.tag}>: '${attr.name}' was ` +
              `'${String(attr.staticValue)}' at extraction, source now has ` +
              (mine.kind === 'static' ? `'${String(mine.value)}'` : mine.kind)
          );
        }
      }
    }
  });

  return divergences;
};

export const loadSnapshot = (
  artifactsDir: string,
  options: SnapshotOptions = {}
): Snapshot => {
  const input = loadAnimusArtifacts(artifactsDir);
  const host = createAnimusHost({
    ...input,
    ...(options.host === undefined ? {} : { options: options.host }),
  });
  const manifest = asManifest(input.manifest);
  const sourceRoot = resolve(options.sourceRoot ?? dirname(artifactsDir));
  const structures = new Map<string, StructureResult>();

  const fileFacts = (file: string): ManifestFileFacts | undefined =>
    manifest.fileFacts?.[file];

  const structureOf = (file: string): StructureResult => {
    const cached = structures.get(file);
    if (cached !== undefined) return cached;

    const facts = fileFacts(file);
    let result: StructureResult;
    if (facts === undefined) {
      result = {
        ok: false,
        reason: 'not-in-snapshot',
        detail:
          `${file} has no fileFacts in this snapshot — it was not part of ` +
          `the analyzed program (generation ${host.program.label ?? host.program.hash})`,
      };
    } else {
      const path = resolve(sourceRoot, file);
      if (!existsSync(path)) {
        result = {
          ok: false,
          reason: 'source-missing',
          detail: `${file} resolves to ${path}, which does not exist`,
        };
      } else {
        const read = readSourceStructure(file, readFileSync(path, 'utf8'));
        const divergences = usageDivergences(read, facts.usage ?? []);
        result =
          divergences.length === 0
            ? { ok: true, read }
            : {
                ok: false,
                reason: 'diverged',
                detail:
                  `${file} no longer corresponds to this snapshot's ` +
                  'generation — rebuild the artifacts or ask about the ' +
                  'committed source',
                divergences,
              };
      }
    }
    structures.set(file, result);
    return result;
  };

  return {
    host,
    manifest,
    generation: host.program.label,
    sourceRoot,
    fileFacts,
    files: () => Object.keys(manifest.fileFacts ?? {}),
    structureOf,
  };
};
