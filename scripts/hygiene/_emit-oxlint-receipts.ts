#!/usr/bin/env bun
// scripts/hygiene/_emit-oxlint-receipts.ts
//
// Reads oxlint `--format=json` output on stdin (or as filename arg for tests),
// emits one v1-schema receipt per fix-applicable diagnostic for Layer A. Used
// by Layer A wrapper in run.sh. Layer C uses delete-unused.ts directly.
//
// Layer B has been removed (Phase β D3): oxlint's
// `no-unused-private-class-members` is `#field`-only and does not fire on
// the TS `private` keyword Animus uses; the cascade is now A → C → D → D1.
//
// Usage:
//   vp lint --format=json <files> | bun run _emit-oxlint-receipts.ts
//   bun run _emit-oxlint-receipts.ts <oxlint-json-file>     (for tests)
//
// Emission contract (Layer A):
//   - classifyUnusedVar(message) === 'import' →
//       verb='delete', kind='named-import', extras.rule=<unwrapped-code>
//     Layer A's `vp lint --fix-suggestions` removes unused imports
//     automatically; the receipt records that removal.
//   - All other diagnostics →
//       verb='format', kind='format-only', extras.rule=<unwrapped-code>
//     Best-effort audit signal — `vp lint --fix-suggestions` applies many
//     non-deletion fixes, and we cannot perfectly tie a single diagnostic
//     to a single fix without before/after diff. False-positive receipts
//     are noise; missing receipts would be corruption — the trade is
//     biased toward signal preservation.

import { emitReceipt } from './_receipts';
import {
  type OxlintReport,
  ToolReportError,
  classifyUnusedVar,
  decodeOxlintReport,
  readReportInput,
  unwrapCode,
} from './_tool-reports';

const SOURCE = 'Layer A receipts (_emit-oxlint-receipts.ts)';

export function emitForReport(report: OxlintReport): number {
  let count = 0;
  for (const d of report.diagnostics) {
    if (!d.code || !d.filename || !d.labels?.length) continue;
    const span = d.labels[0].span;
    const path = d.filename;
    const line = span.line;
    const code = unwrapCode(d.code);

    const klass = classifyUnusedVar(d.message);
    if (klass === 'import') {
      emitReceipt('A', 'delete', `${path}:${line}`, 'named-import', {
        rule: code,
      });
    } else {
      emitReceipt('A', 'format', `${path}:${line}`, 'format-only', {
        rule: code,
      });
    }
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const input = await readReportInput(process.argv[2]);
  emitForReport(decodeOxlintReport(input, SOURCE));
}

if (import.meta.main) {
  main().catch((e) => {
    // Unreadable tool output is a diagnosed failure, not a silent empty run:
    // zero receipts is how a CLEAN cascade looks, so a decoder that swallowed
    // this would make a broken Layer A indistinguishable from a converged one.
    if (e instanceof ToolReportError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
