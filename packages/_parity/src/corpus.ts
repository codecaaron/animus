/**
 * Corpus enumeration. Three sources, all flowing into CorpusUnits:
 *  - extract:  packages/extract/tests/fixtures/*.tsx — one unit per file,
 *              plus one combined `extract-all` unit (multi-file aggregation
 *              exercises system_prop_map / utilities).
 *  - integration: packages/_integration/fixtures/components — one unit per
 *              .tsx file; the mdx-rendering dir is one multi-file unit with
 *              .mdx compiled via the pipeline's preprocessMdx.
 *  - parity:   packages/_parity/corpus — adversarial families; single .tsx
 *              files are one unit each, directories are one multi-file unit.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';

import type { CorpusUnit, FamilyDecl } from './types';

const ROOT = join(import.meta.dirname, '../../..');
const EXTRACT_FIXTURES = join(ROOT, 'packages/extract/tests/fixtures');
const INTEGRATION_FIXTURES = join(
  ROOT,
  'packages/_integration/fixtures/components'
);
const PARITY_CORPUS = join(ROOT, 'packages/_parity/corpus');

interface CorpusDirectory {
  label: string;
  path: string;
}

const REQUIRED_CORPUS_DIRECTORIES: CorpusDirectory[] = [
  { label: 'extract fixtures', path: EXTRACT_FIXTURES },
  { label: 'integration fixtures', path: INTEGRATION_FIXTURES },
  { label: 'parity adversarial corpus', path: PARITY_CORPUS },
];

export function assertCorpusDirectories(
  directories: CorpusDirectory[] = REQUIRED_CORPUS_DIRECTORIES
): void {
  for (const directory of directories) {
    if (
      !existsSync(directory.path) ||
      !statSync(directory.path).isDirectory()
    ) {
      throw new Error(
        `fixture corpus missing: ${directory.label} at ${directory.path} — restore the required directory from version control, then rerun vp run verify:parity`
      );
    }
  }
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .sort();
}

async function loadEntry(
  dir: string,
  file: string
): Promise<{ path: string; source: string }> {
  const raw = readFileSync(join(dir, file), 'utf-8');
  if (file.endsWith('.mdx')) {
    const { preprocessMdx } = await import('@animus-ui/extract/pipeline');
    const result = await preprocessMdx(raw, file);
    if (result.kind !== 'ok' || result.source === undefined) {
      throw new Error(
        `preprocessMdx failed for ${file}: ${JSON.stringify(result)}`
      );
    }
    return { path: file.replace(/\.mdx$/, '.mdx.tsx'), source: result.source };
  }
  return { path: file, source: raw };
}

export async function enumerateUnits(): Promise<CorpusUnit[]> {
  assertCorpusDirectories();
  const units: CorpusUnit[] = [];

  // extract corpus: per-file units + combined unit
  const extractFiles = tsxFiles(EXTRACT_FIXTURES);
  for (const f of extractFiles) {
    units.push({
      id: `extract/${f}`,
      files: [await loadEntry(EXTRACT_FIXTURES, f)],
      configSource: 'test-system',
    });
  }
  units.push({
    id: 'extract-all',
    files: await Promise.all(
      extractFiles.map((f) => loadEntry(EXTRACT_FIXTURES, f))
    ),
    configSource: 'test-system',
  });

  // integration corpus
  for (const entry of readdirSync(INTEGRATION_FIXTURES).sort()) {
    const full = join(INTEGRATION_FIXTURES, entry);
    if (statSync(full).isDirectory()) {
      const files = readdirSync(full)
        .filter((f) => f.endsWith('.tsx') || f.endsWith('.mdx'))
        .sort();
      units.push({
        id: `integration/${entry}`,
        files: await Promise.all(files.map((f) => loadEntry(full, f))),
        configSource: 'test-system',
      });
    } else if (entry.endsWith('.tsx')) {
      units.push({
        id: `integration/${entry}`,
        files: [await loadEntry(INTEGRATION_FIXTURES, entry)],
        configSource: 'test-system',
      });
    }
  }

  // parity adversarial corpus
  for (const entry of readdirSync(PARITY_CORPUS).sort()) {
    if (entry === 'families.json') continue;
    const full = join(PARITY_CORPUS, entry);
    if (statSync(full).isDirectory()) {
      const files = readdirSync(full)
        .filter(
          (f) => f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.mdx')
        )
        .sort();
      units.push({
        id: `parity/${entry}`,
        files: await Promise.all(files.map((f) => loadEntry(full, f))),
        configSource: 'test-system',
      });
    } else if (entry.endsWith('.tsx')) {
      units.push({
        id: `parity/${basename(entry)}`,
        files: [await loadEntry(PARITY_CORPUS, entry)],
        configSource: 'test-system',
      });
    }
  }

  return units;
}

const REQUIRED_FAMILIES = [
  'mdx-provider-scope',
  'aliased-import',
  'duplicate-binding',
  'bare-create-element',
  'compose-reassignment',
];

/** Load families.json and enforce the rendered-usage-semantics contract:
 *  all five required families present, each with a declared verdict, and
 *  every referenced unit existing in the corpus. Throws on violation. */
export function validateFamilies(
  families: FamilyDecl[],
  unitIds: Set<string>
): void {
  for (const family of families) {
    if (
      family.expectedVerdict !== 'identical' &&
      family.expectedVerdict !== 'registered-divergence'
    ) {
      throw new Error(`family ${family.family} lacks a valid expectedVerdict`);
    }
    for (const unit of family.units) {
      if (!unitIds.has(unit)) {
        throw new Error(
          `family ${family.family} references unknown unit ${unit}`
        );
      }
    }
  }
  for (const required of REQUIRED_FAMILIES) {
    const decl = families.find((f) => f.family === required);
    if (!decl)
      throw new Error(`required usage-case family missing: ${required}`);
  }
}

export function loadFamilies(unitIds: Set<string>): FamilyDecl[] {
  const path = join(PARITY_CORPUS, 'families.json');
  if (!existsSync(path)) {
    throw new Error(
      `families.json missing at ${path} — usage-case families are a spec requirement`
    );
  }
  const families: FamilyDecl[] = JSON.parse(readFileSync(path, 'utf-8'));
  validateFamilies(families, unitIds);
  return families;
}
