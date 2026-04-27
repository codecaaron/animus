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
//         "files": [<filename>],         // whole file is unused
//         "exports": [{name,line,col,pos}], // unused named exports
//         "types":   [{name,line,col,pos}], // unused type exports
//         "enumMembers":      [...],
//         "namespaceMembers": [...],
//         "duplicates":       [...],
//         "dependencies":     [{name}],     // unused runtime deps
//         "devDependencies":  [{name}],
//         "optionalPeerDependencies": [{name}],
//         "unlisted":         [{name}],
//         "unresolved":       [...],
//         "binaries":         [...],
//         "catalog":          [...]
//       },
//       ...
//   ]}
//
// Receipts emitted:
//   - file:        layer="D", verb="delete", kind="file"
//   - export:      layer="D", verb="delete", kind="export-clause"
//   - dependency:  layer="D", verb="delete", kind="dependency"
//
// Types/enumMembers/namespaceMembers/duplicates/etc. are NOT emitted because
// our knip --fix-type list excludes them (see run.sh comment). If the
// fix-type list is widened later, extend this emitter accordingly.

import { readFileSync } from 'node:fs';

import { emitReceipt } from './_receipts';

type KnipNamedSymbol = { name: string; line?: number };
type KnipPackage = { name: string };
type KnipIssue = {
  file: string;
  files?: string[];
  exports?: KnipNamedSymbol[];
  dependencies?: KnipPackage[];
  devDependencies?: KnipPackage[];
  optionalPeerDependencies?: KnipPackage[];
};
type KnipReport = { issues?: KnipIssue[] };

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf-8');
}

export function emitForReport(report: KnipReport): number {
  if (!report.issues || !Array.isArray(report.issues)) return 0;
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

    for (const depKey of [
      'dependencies',
      'devDependencies',
      'optionalPeerDependencies',
    ] as const) {
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
  const fileArg = process.argv[2];
  const input = fileArg ? readFileSync(fileArg, 'utf-8') : await readStdin();
  if (!input.trim()) return;

  let report: KnipReport;
  try {
    report = JSON.parse(input);
  } catch {
    return;
  }
  emitForReport(report);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
