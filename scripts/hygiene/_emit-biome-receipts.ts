#!/usr/bin/env bun
// scripts/hygiene/_emit-biome-receipts.ts
//
// Reads biome `--reporter=json` output on stdin (or as filename arg for tests),
// emits one v1-schema receipt per fix-applicable diagnostic. Used by Layer A
// and Layer B wrappers in run.sh. Layer C uses delete-unused.ts directly which
// already emits its own receipts.
//
// Usage:
//   biome check --reporter=json <files> | bun run _emit-biome-receipts.ts <layer>
//   bun run _emit-biome-receipts.ts <layer> <biome-json-file>     (for tests)
//
// <layer> = "A" | "B"
//
// Emission contract:
//   Layer A: verb="format", kind="format-only", extras.rule=<normalized-category>
//     Emitted for every observed diagnostic (best-effort; biome's --write
//     applies all safe fixes, and we cannot know precisely which diagnostic
//     produced which fix without a before/after diff). Acceptable for an
//     audit trail — false-positive receipts are noise, not corruption.
//   Layer B: verb="delete", kind="named-import" | "private-member"
//     Emitted ONLY for diagnostics in the two scoped categories
//     (correctness/noUnusedImports, correctness/noUnusedPrivateClassMembers).
//
// Category strings are normalized to strip the `lint/` prefix, mirroring
// delete-unused.ts. See session-89 (2026-04-24) for the regression context.

import { readFileSync } from 'node:fs';

import { emitReceipt, type ReceiptLayer } from './_receipts';

type BiomeLoc = {
  path: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
};
type BiomeDiagnostic = { category: string; location?: BiomeLoc };
type BiomeReport = { diagnostics?: BiomeDiagnostic[] };

const LAYER_B_KINDS = new Map<string, string>([
  ['correctness/noUnusedImports', 'named-import'],
  ['correctness/noUnusedPrivateClassMembers', 'private-member'],
]);

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf-8');
}

function normalizeCategory(category: string): string {
  return category.replace(/^lint\//, '');
}

export function emitForReport(report: BiomeReport, layer: 'A' | 'B'): number {
  if (!report.diagnostics || !Array.isArray(report.diagnostics)) return 0;
  let count = 0;
  for (const d of report.diagnostics) {
    if (!d.category || !d.location?.path || !d.location.start) continue;
    const normalized = normalizeCategory(d.category);
    const path = d.location.path;
    const line = d.location.start.line;

    if (layer === 'B') {
      const kind = LAYER_B_KINDS.get(normalized);
      if (!kind) continue;
      emitReceipt('B', 'delete', `${path}:${line}`, kind, {
        category: normalized,
      });
      count++;
    } else {
      emitReceipt('A', 'format', `${path}:${line}`, 'format-only', {
        rule: normalized,
      });
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  const layerArg = process.argv[2] as ReceiptLayer | undefined;
  if (layerArg !== 'A' && layerArg !== 'B') {
    console.error('ERROR: layer arg must be "A" or "B"');
    process.exit(1);
  }
  const fileArg = process.argv[3];
  const input = fileArg ? readFileSync(fileArg, 'utf-8') : await readStdin();
  if (!input.trim()) return;

  let report: BiomeReport;
  try {
    report = JSON.parse(input);
  } catch {
    return;
  }
  emitForReport(report, layerArg);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
