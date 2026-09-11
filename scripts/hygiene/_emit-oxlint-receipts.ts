#!/usr/bin/env bun

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
    if (e instanceof ToolReportError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
