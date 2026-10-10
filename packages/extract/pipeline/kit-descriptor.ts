import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  KIT_STALE_DESCRIPTOR,
  KIT_UNSUPPORTED_FORMAT,
  severityFor,
} from './manifest-diagnostics';
import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ProjectManifest } from './manifest-schema';
import type { JsonValue } from './tsconfig-paths';

/** A kit's description, which `animus build --kit` writes at its package
 *  root and the kit exports as `./animus.json`. */
export const KIT_DESCRIPTOR_FILE = 'animus.json';

/** The descriptor format this Animus writes and reads. */
export const KIT_DESCRIPTOR_FORMAT = 1;

export interface KitComponentDescriptor {
  /** The definition fingerprint, which the component's location takes no
   *  part in. */
  definition: string;
  /** The props that accept runtime values: the admitted system props and
   *  custom props. Variants and states are finite and not listed. */
  runtimeProps: string[];
}

export interface KitDescriptor {
  format: typeof KIT_DESCRIPTOR_FORMAT;
  /** The fingerprint of the system the kit was built with, as information. */
  system: string;
  /** Keyed `file::binding`, the file relative to the package root. */
  components: Record<string, KitComponentDescriptor>;
}

/** A path with `/` separators, as descriptors key their components. */
function posixPath(path: string): string {
  return path.split(sep).join('/');
}

/** The descriptor of the kit a build analysed. */
export function buildKitDescriptor(manifest: ProjectManifest): KitDescriptor {
  const components: Record<string, KitComponentDescriptor> = {};
  for (const id of Object.keys(manifest.components).sort()) {
    const component = manifest.components[id];
    components[posixPath(id)] = {
      definition: component.definition_fingerprint,
      runtimeProps: [...new Set(component.system_prop_names)].sort(),
    };
  }
  return {
    format: KIT_DESCRIPTOR_FORMAT,
    system: manifest.system_fingerprint,
    components,
  };
}

/** What a kit package's descriptor records of each component's definition,
 *  with the package root relative to the project root; or, when this Animus
 *  cannot read the descriptor, why. */
export type KitDescriptorRecord =
  | { packageRoot: string; definitions: Record<string, string> }
  | { packageRoot: string; unreadable: string };

/** Reads the descriptor at a kit's package root; `null` when it has none. */
export function readKitDescriptor(
  pkgRoot: string,
  rootDir: string
): KitDescriptorRecord | null {
  const path = join(pkgRoot, KIT_DESCRIPTOR_FILE);
  if (!existsSync(path)) return null;
  const packageRoot = posixPath(relative(rootDir, pkgRoot));
  // Another build's output, so every field is narrowed where it is read.
  let wire: JsonValue;
  try {
    wire = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {
      packageRoot,
      unreadable: 'is not valid JSON: rebuild it with animus build --kit',
    };
  }
  const block = isJsonBlock(wire) ? wire : {};
  if (block.format !== KIT_DESCRIPTOR_FORMAT) {
    return {
      packageRoot,
      unreadable: `declares descriptor format ${JSON.stringify(block.format ?? null)}, which this Animus does not read (it reads format ${KIT_DESCRIPTOR_FORMAT}): upgrade Animus, or install a kit built for this version`,
    };
  }
  const definitions: Record<string, string> = {};
  const components = isJsonBlock(block.components) ? block.components : {};
  for (const [id, component] of Object.entries(components)) {
    const definition = isJsonBlock(component) ? component.definition : null;
    if (isJsonString(definition)) definitions[posixPath(id)] = definition;
  }
  return { packageRoot, definitions };
}

/**
 * A descriptor in a format this Animus cannot read fails the build; one
 * whose component definitions differ from the kit's shipped source, as the
 * analysis read it, or that describes a component its analysed file no
 * longer declares, was built from other source and is stale.
 */
export function kitDescriptorDiagnostics(
  records: readonly KitDescriptorRecord[],
  manifest: ProjectManifest
): ManifestDiagnostic[] {
  if (records.length === 0) return [];
  const diagnostics: ManifestDiagnostic[] = [];
  const analysedById = new Map(
    Object.entries(manifest.components).map(([id, component]) => [
      posixPath(id),
      component,
    ])
  );
  // A chain the source declares but the analysis dropped reports its own
  // diagnostic, so only a component no chain of its analysed file declares
  // is missing. Discovery may read part of a kit, so a file it left out is
  // not judged, nor is one the kit no longer ships.
  const analysedFiles = new Set(Object.keys(manifest.fileFacts).map(posixPath));
  const declared = new Set(
    Object.entries(manifest.fileFacts).flatMap(([file, facts]) =>
      facts.chains.map(
        (chain) => `${posixPath(file)}::${chain.descriptor.binding}`
      )
    )
  );
  for (const record of records) {
    const file = `${record.packageRoot}/${KIT_DESCRIPTOR_FILE}`;
    if ('unreadable' in record) {
      diagnostics.push({
        file,
        component: 'kit',
        kind: 'error',
        message: record.unreadable,
        code: KIT_UNSUPPORTED_FORMAT,
        severity: severityFor(KIT_UNSUPPORTED_FORMAT),
      });
      continue;
    }
    for (const [id, definition] of Object.entries(record.definitions)) {
      const key = `${record.packageRoot}/${id}`;
      const analysed = analysedById.get(key);
      const fileAnalysed = analysedFiles.has(
        key.slice(0, key.lastIndexOf('::'))
      );
      let stale: string;
      if (analysed) {
        if (analysed.definition_fingerprint === definition) continue;
        stale = `describes ${id} with a definition other than the one its shipped source declares`;
      } else if (fileAnalysed && !declared.has(key)) {
        stale = `describes ${id}, which its shipped source no longer declares`;
      } else {
        continue;
      }
      diagnostics.push({
        file,
        component: analysed?.binding ?? id.slice(id.lastIndexOf('::') + 2),
        kind: 'warn',
        message: `${stale}, so the descriptor is stale: rebuild it with animus build --kit`,
        code: KIT_STALE_DESCRIPTOR,
        severity: severityFor(KIT_STALE_DESCRIPTOR),
      });
    }
  }
  return diagnostics;
}
