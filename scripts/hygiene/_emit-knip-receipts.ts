#!/usr/bin/env bun

import { isJsonNumber, isJsonString } from '@animus-ui/assertions';

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
        if (!isJsonString(filename)) continue;
        emitReceipt('D', 'delete', filename, 'file');
        count++;
      }
    }

    if (Array.isArray(issue.exports)) {
      for (const sym of issue.exports) {
        if (!sym?.name) continue;
        const line = sym.line;
        const target =
          line !== undefined && isJsonNumber(line)
            ? `${issue.file}:${line}`
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
    if (e instanceof ToolReportError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
