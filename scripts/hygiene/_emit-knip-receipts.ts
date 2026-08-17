#!/usr/bin/env bun
// scripts/hygiene/_emit-knip-receipts.ts
//
// Reads knip `--reporter=json` output on stdin (or as filename arg for tests),
// emits one v1-schema receipt per applicable removal. Used by Layer D wrapper
// in run.sh. Run BEFORE knip --fix; the receipts record what knip will remove,
// which mirrors what --fix actually applies in practice.
//
// Usage:
//   knip --reporter=json [...] | bun run _emit-knip-receipts.ts
//   bun run _emit-knip-receipts.ts <knip-json-file>     (for tests)
//
// Knip 6.6.2 JSON shape (verified against current repo):
//   { "issues": [
//       { "file": "<source-file>",
//         "files":            [<filename>],          // unused files (REMOVABLE)
//         "exports":          [{name,line,col,pos}], // unused named exports (REMOVABLE)
//         "dependencies":     [{name}],              // unused runtime deps (REMOVABLE)
//         "devDependencies":  [{name}],              // unused dev deps (REMOVABLE)
//         "optionalPeerDependencies": [{name}],  // INFORMATIONAL — knip lists these
//                                                 // under "Referenced optional
//                                                 // peerDependencies" and does NOT
//                                                 // remove them with --fix.
//         "types":            [{name,...}],         // not in our --fix-type list
//         "enumMembers":      [...],
//         "namespaceMembers": [...],
//         "duplicates":       [...],
//         "unlisted":         [{name}],
//         "unresolved":       [...],
//         "binaries":         [...],
//         "catalog":          [...]
//       },
//       ...
//   ]}
//
// Receipts emitted (one per record knip --fix would actually remove):
//   - file:        layer="D", verb="delete", kind="file"
//   - export:      layer="D", verb="delete", kind="export-clause"
//   - dependency:  layer="D", verb="delete", kind="dependency"
//
// optionalPeerDependencies are deliberately skipped: knip 6.6.2 reports them
// for visibility but does NOT remove them under --fix-type=dependencies.
// Emitting receipts for these produces false positives (verified against a
// real --apply --all run on 2026-04-26 where two informational @mdx-js/mdx
// records appeared in receipts.jsonl despite knip --fix making no
// dependency-level mutation).
//
// Types/enumMembers/namespaceMembers/duplicates are excluded because our
// knip --fix-type list excludes them. If the fix-type list is widened later,
// extend this emitter accordingly.

import { emitReceipt } from './_receipts';
import {
  type KnipReport,
  ToolReportError,
  decodeKnipReport,
  readReportInput,
} from './_tool-reports';

const SOURCE = 'Layer D receipts (_emit-knip-receipts.ts)';

export function emitForReport(report: KnipReport): number {
  let count = 0;

  for (const issue of report.issues) {
    if (!issue.file) continue;

    if (Array.isArray(issue.files)) {
      for (const filename of issue.files) {
        if (typeof filename !== 'string') continue;
        emitReceipt('D', 'delete', filename, 'file');
        count++;
      }
    }

    if (Array.isArray(issue.exports)) {
      for (const sym of issue.exports) {
        if (!sym?.name) continue;
        const target =
          typeof sym.line === 'number'
            ? `${issue.file}:${sym.line}`
            : `${issue.file}:${sym.name}`;
        emitReceipt('D', 'delete', target, 'export-clause', { name: sym.name });
        count++;
      }
    }

    for (const depKey of ['dependencies', 'devDependencies'] as const) {
      const list = issue[depKey];
      if (!Array.isArray(list)) continue;
      for (const pkg of list) {
        if (!pkg?.name) continue;
        emitReceipt('D', 'delete', pkg.name, 'dependency', { source: depKey });
        count++;
      }
    }
  }

  return count;
}

async function main(): Promise<void> {
  const input = await readReportInput(process.argv[2]);
  emitForReport(decodeKnipReport(input, SOURCE));
}

if (import.meta.main) {
  main().catch((e) => {
    // Same policy as Layer A/C: see `_tool-reports.ts` § Failure policy.
    if (e instanceof ToolReportError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
