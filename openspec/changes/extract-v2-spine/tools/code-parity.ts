/**
 * Interim transformed-code parity (inc 06 Task 06.4 re-scope): v1
 * transformFile vs the v2 ExtractEngine per fixture, byte-compared.
 * The full harness v1-vs-v2 run (all artifact classes) arms when row 07
 * gives v2 a CSS surface; until then this tool is the code-class gate.
 * Run: bun run code-parity.ts   (from this directory)
 */
import { createRequire } from 'module';
import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';

const ROOT = join(import.meta.dirname, '../../../..');
const require_ = createRequire(import.meta.url);
const v1 = require_(join(ROOT, 'packages/extract/index.js'));
const v2 = require_(join(ROOT, 'packages/extract/index-v2.js'));

const { ds, tokens } = await import(join(ROOT, 'packages/extract/tests/test-system.ts'));
const config = ds.toConfig();
const theme = tokens.serialize();

const FIX = join(ROOT, 'packages/extract/tests/fixtures');
const PARITY = join(ROOT, 'packages/_parity/corpus');
let equal = 0;
let needsConfig = 0;
const diffs: string[] = [];

// Units: every extract fixture as a single-file project, every parity
// corpus entry (dirs = MULTI-FILE projects — inc-06 review F-c: the
// cyclic-extension divergence was invisible to single-file units).
import { statSync } from 'fs';
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

for (const unit of units) {
  const entries = JSON.stringify(unit.files);
  v1.clearAnalysisCache();
  const manifest = v1.analyzeProject(
    entries, theme.scalesJson, theme.variableMapJson, theme.contextualVarsJson || null,
    config.propConfig, config.groupRegistry, '{}', false, null,
    config.selectorAliases ?? null, config.selectorOrder ?? null, null, null, null
  );
  const engine = new v2.ExtractEngine({
    themeJson: theme.scalesJson,
    variableMapJson: theme.variableMapJson,
    contextualVarsJson: theme.contextualVarsJson || undefined,
    configJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    selectorAliasesJson: config.selectorAliases ?? undefined,
  });
  engine.analyze(entries);
  for (const file of unit.files) {
    const r1 = v1.transformFile(file.source, file.path, manifest);
    let r2;
    try {
      r2 = JSON.parse(engine.transformFile(file.path));
    } catch {
      needsConfig++; // row-07-gated stages (config/merge) fail loud by design
      continue;
    }
    if (r1.code === r2.code && r1.hasComponents === r2.hasComponents) equal++;
    else diffs.push(`${unit.id}:${file.path}`);
  }
}

console.log(
  `code-parity: byte-equal=${equal} needs-config=${needsConfig} DIFFS=${diffs.length} ${diffs.join(',')}`
);
// Vacuity floors (gate-integrity review): all surfaces are ungated as of
// row 07 — any needs-config or a shrunken unit set is a regression, not
// a pass.
if (units.length < 25) {
  console.log(`code-parity: VACUOUS — only ${units.length} units (floor 25)`);
  process.exit(1);
}
if (needsConfig > 0) {
  console.log('code-parity: FAIL — needs-config gates should be gone post-row-07');
  process.exit(1);
}
process.exit(diffs.length ? 1 : 0);
