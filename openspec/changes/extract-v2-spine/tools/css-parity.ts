/**
 * CSS-class parity (row 07 Task 07.6): v1 analyzeProject manifest CSS vs
 * v2 ExtractEngine.analyze CSS, byte-compared per sheet, over the same
 * unit universe code-parity uses (extract fixtures as single-file
 * projects + every _parity corpus entry, dirs = multi-file projects).
 * Both engines receive the SAME test-system config/theme inputs.
 * Run: bun run css-parity.ts   (from this directory)
 */
import { createRequire } from 'module';
import { join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';

const ROOT = join(import.meta.dirname, '../../../..');
const require_ = createRequire(import.meta.url);
const v1 = require_(join(ROOT, 'packages/extract/index.js'));
const v2 = require_(join(ROOT, 'packages/extract/index-v2.js'));

const { ds, tokens } = await import(join(ROOT, 'packages/extract/tests/test-system.ts'));
const config = ds.toConfig();
const theme = tokens.serialize();

const FIX = join(ROOT, 'packages/extract/tests/fixtures');
const PARITY = join(ROOT, 'packages/_parity/corpus');

const units: Array<{ id: string; files: Array<{ path: string; source: string }> }> = [];
for (const f of readdirSync(FIX).filter((x) => x.endsWith('.tsx')).sort()) {
  units.push({ id: f, files: [{ path: f, source: readFileSync(join(FIX, f), 'utf-8') }] });
}
for (const entry of readdirSync(PARITY).sort()) {
  if (entry === 'families.json') continue;
  const full = join(PARITY, entry);
  if (statSync(full).isDirectory()) {
    const files = readdirSync(full)
      .filter((x) => /\.(tsx|ts)$/.test(x))
      .sort()
      .map((x) => ({ path: x, source: readFileSync(join(full, x), 'utf-8') }));
    units.push({ id: `parity/${entry}`, files });
  } else if (entry.endsWith('.tsx')) {
    units.push({ id: `parity/${entry}`, files: [{ path: entry, source: readFileSync(full, 'utf-8') }] });
  }
}

const SHEET_KEYS = ['declaration', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom'] as const;

let equal = 0;
const diffs: string[] = [];
const verbose = process.argv.includes('--verbose');

for (const unit of units) {
  const entries = JSON.stringify(unit.files);
  v1.clearAnalysisCache();
  const m1 = JSON.parse(
    v1.analyzeProject(
      entries, theme.scalesJson, theme.variableMapJson, theme.contextualVarsJson || null,
      config.propConfig, config.groupRegistry, '{}', false, null,
      config.selectorAliases ?? null, config.selectorOrder ?? null, null, null, null
    )
  );
  const engine = new v2.ExtractEngine({
    themeJson: theme.scalesJson,
    variableMapJson: theme.variableMapJson,
    contextualVarsJson: theme.contextualVarsJson || undefined,
    configJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    selectorAliasesJson: config.selectorAliases ?? undefined,
  });
  const m2 = JSON.parse(engine.analyze(entries));

  const unitDiffs: string[] = [];
  if ((m1.css ?? '') !== (m2.css ?? '')) unitDiffs.push('css');
  for (const key of SHEET_KEYS) {
    if ((m1.sheets?.[key] ?? '') !== (m2.sheets?.[key] ?? '')) unitDiffs.push(`sheets.${key}`);
  }
  if (unitDiffs.length === 0) {
    equal++;
  } else {
    diffs.push(`${unit.id}[${unitDiffs.join('+')}]`);
    if (verbose) {
      for (const key of SHEET_KEYS) {
        const a = m1.sheets?.[key] ?? '';
        const b = m2.sheets?.[key] ?? '';
        if (a !== b) {
          console.log(`--- ${unit.id} sheets.${key} v1:\n${a}\n--- v2:\n${b}\n`);
        }
      }
    }
  }
}

console.log(`css-parity: equal=${equal}/${units.length} DIFFS=${diffs.length} ${diffs.join(',')}`);
// Vacuity floor (gate-integrity review): empty enumerations must fail.
if (units.length < 25) {
  console.log(`css-parity: VACUOUS — only ${units.length} units (floor 25)`);
  process.exit(1);
}
process.exit(diffs.length ? 1 : 0);
