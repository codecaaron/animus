/**
 * Increment 04 cross-engine chain-discovery comparison.
 *
 * v1 exposes no chain-level surface, so the strongest black-box oracle is
 * the manifest: every v1 component id ("file::binding") and every
 * extension-provenance edge must be discoverable by v2's walk on the same
 * entries, and v2's parse count must equal the file count (G1 / NS1).
 * Run: bun run chain-parity.ts   (from this directory)
 */
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../../..');
const require_ = createRequire(import.meta.url);
const v1 = require_(join(ROOT, 'packages/extract/index.js'));
const v2 = require_(join(ROOT, 'packages/extract/index-v2.js'));

interface RawAttr { name: string; staticValue?: unknown; dynamic: boolean; skip: boolean }
interface RawUsage {
  element?: { tag: { ident?: string; member?: string }; attrs: RawAttr[] };
  createElement?: { ident: string | null; member: string | null };
}

const { enumerateUnits } = await import(
  join(ROOT, 'packages/_parity/src/corpus.ts')
);
const { ds, tokens } = await import(
  join(ROOT, 'packages/extract/tests/test-system.ts')
);
const config = ds.toConfig();
const theme = tokens.serialize();

let failures = 0;
let unitsChecked = 0;
let componentsMatched = 0;

for (const unit of await enumerateUnits()) {
  unitsChecked++;
  v1.clearAnalysisCache();
  const manifest = JSON.parse(
    v1.analyzeProject(
      JSON.stringify(unit.files),
      theme.scalesJson,
      theme.variableMapJson,
      theme.contextualVarsJson || null,
      config.propConfig,
      config.groupRegistry,
      '{}',
      false,
      null,
      config.selectorAliases ?? null,
      config.selectorOrder ?? null,
      null,
      null,
      null
    )
  );

  const v2out = JSON.parse(v2.discoverChains(JSON.stringify(unit.files)));

  // G1 / NS1: exactly one parse per file.
  if (v2out.parseCount !== unit.files.length) {
    console.log(
      `FAIL ${unit.id}: v2 parseCount ${v2out.parseCount} != file count ${unit.files.length}`
    );
    failures++;
  }

  // v2 descriptors per (file, binding) — full descriptor kept for
  // content-level comparison (terminal, tag, extendsFrom), not just
  // set membership.
  interface V2Desc {
    binding: string;
    terminal: string;
    tag: string;
    extractable: boolean;
    bailReason: string | null;
    extendsFrom: string | null;
  }
  const v2Map = new Map<string, V2Desc>();
  for (const [file, descriptors] of Object.entries(v2out.files)) {
    for (const d of descriptors as V2Desc[]) {
      v2Map.set(`${file}::${d.binding}`, d);
    }
  }

  // Every v1 component must be v2-discoverable with matching descriptor
  // content where the manifest witnesses it (terminal, tag).
  const crosschecked = new Set<string>();
  for (const [componentId, comp] of Object.entries(
    (manifest.components ?? {}) as Record<string, { terminal: string; tag: string }>
  )) {
    const d = v2Map.get(componentId);
    if (!d) {
      console.log(`FAIL ${unit.id}: v1 component ${componentId} not discovered by v2`);
      failures++;
      continue;
    }
    crosschecked.add(componentId);
    if (d.terminal !== comp.terminal) {
      console.log(
        `FAIL ${unit.id}: ${componentId} terminal ${d.terminal} (v2) vs ${comp.terminal} (v1)`
      );
      failures++;
    } else if (d.tag !== comp.tag) {
      console.log(`FAIL ${unit.id}: ${componentId} tag '${d.tag}' (v2) vs '${comp.tag}' (v1)`);
      failures++;
    } else {
      componentsMatched++;
    }
  }

  // Extension edges: v1 provenance parent binding name must equal v2's
  // extendsFrom NAME for the child — a MISSING v2 edge is a failure, not
  // a silent pass (inc-04 review F2).
  for (const [child, ancestors] of Object.entries(manifest.provenance ?? {})) {
    const parentId = (ancestors as string[])[0];
    if (!parentId) continue;
    const parentBinding = parentId.split('::')[1];
    const v2Parent = v2Map.get(child)?.extendsFrom;
    if (!v2Parent || v2Parent !== parentBinding) {
      console.log(
        `FAIL ${unit.id}: ${child} extends ${v2Parent ?? '(none)'} (v2) vs ${parentBinding} (v1 provenance)`
      );
      failures++;
    }
  }

  // ── Rendered-components cross-check (inc 11): maps derived from v2
  // facts alone (chain bindings + compose member keys), rendered detection
  // mirrored as fact algebra, compared against v1's usage ledger. Gate is
  // one-directional (v1-rendered must be v2-derivable); v2 extras audit.
  {
    const factsOut = JSON.parse(v2.extractFacts(JSON.stringify(unit.files)));
    if (factsOut.parseCount !== unit.files.length) {
      console.log(`FAIL ${unit.id}: extractFacts parseCount ${factsOut.parseCount} != ${unit.files.length}`);
      failures++;
    }
    // Engine-side cross-file algebra (inc 06 Task 06.2): the engine now
    // computes rendered semantics itself; the oracle CONSUMES it — green
    // here proves engine capability, not oracle-code capability (RF-37
    // discharged; the TS mirror is deleted).
    const engine = new v2.ExtractEngine();
    const analyzed = JSON.parse(engine.analyze(JSON.stringify(unit.files)));
    if (analyzed.parseCount !== unit.files.length) {
      console.log(`FAIL ${unit.id}: engine parseCount ${analyzed.parseCount} != ${unit.files.length}`);
      failures++;
    }
    const v2Rendered = new Set<string>(analyzed.crossFile.renderedComponents as string[]);

    // Class-name identity pin (inc 06 Task 06.3): v2's FNV-1a port must
    // reproduce v1's manifest class names exactly, corpus-wide.
    const v2ClassNames = new Map<string, string>();
    for (const [file, ff] of Object.entries(analyzed.files) as Array<[
      string,
      { chains: Array<{ className: string; descriptor: { binding: string } }> },
    ]>) {
      for (const ch of ff.chains) {
        v2ClassNames.set(`${file}::${ch.descriptor.binding}`, ch.className);
      }
    }
    for (const [componentId, comp] of Object.entries(
      (manifest.components ?? {}) as Record<string, { class_name: string }>
    )) {
      const v2Class = v2ClassNames.get(componentId);
      if (v2Class && v2Class !== comp.class_name) {
        console.log(
          `FAIL ${unit.id}: ${componentId} className ${v2Class} (v2) vs ${comp.class_name} (v1)`
        );
        failures++;
      }
    }
    const v1Rendered: string[] = manifest.usage?.rendered_components ?? [];
    for (const r of v1Rendered) {
      if (!v2Rendered.has(r)) {
        console.log(`FAIL ${unit.id}: v1 rendered ${r} not derivable from v2 facts`);
        failures++;
      }
    }
    for (const r of v2Rendered) {
      if (!v1Rendered.includes(r)) {
        console.log(`  audit ${unit.id}: v2-rendered extra ${r} (v1 ledger omits — post-eval map membership)`);
      }
    }
  }

  // Audit (not gate): v2 extras the manifest cannot witness — bailed or
  // eliminated chains. Printed so drift here is at least visible.
  for (const [id, d] of v2Map) {
    if (!crosschecked.has(id)) {
      console.log(
        `  audit ${unit.id}: v2-only descriptor ${id} extractable=${d.extractable} bail=${d.bailReason ?? '-'} (not witnessed by v1 manifest)`
      );
    }
  }
}

console.log(
  `chain-parity: ${unitsChecked} units, ${componentsMatched} v1 components all-discovered=${failures === 0}, failures=${failures}`
);
process.exit(failures ? 1 : 0);
