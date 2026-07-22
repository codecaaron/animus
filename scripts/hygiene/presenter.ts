#!/usr/bin/env bun
// scripts/hygiene/presenter.ts
//
// Pure analyzer of .hygiene/receipts.jsonl. Computes the cascade verdict
// (converged / cap-hit-clean / cap-hit-divergent), Layer D volume signal,
// and Layer C code-drift WARN — all derived from the receipt stream
// rather than scattered orchestrator counters.
//
// Outputs:
//   - prints summaryLines to stdout (one per line)
//   - writes .hygiene/verdict.json with the structured Verdict
//
// run.sh reads verdict.json for the suggestedExitCode and exits accordingly.
// Process exit here is 0 on a successful analyze; non-zero only on internal
// error (presenter does NOT propagate the cascade's verdict via its own exit).
//
// Usage:
//   bun run scripts/hygiene/presenter.ts [--cap=<N>]
//
// Cap is read from env (HYGIENE_ITERATIONS) or --cap= flag; defaults to 5.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Receipt } from './_receipts';

export type Convergence = 'converged' | 'cap-hit-clean' | 'cap-hit-divergent';

export interface LayerDVolume {
  files: number;
  exports: number;
}

export interface Verdict {
  convergence: Convergence;
  finalIteration: number;
  iterationCap: number;
  finalIterationDeletes: number;
  layerDVolume: LayerDVolume;
  // Fail-closed whole-file deletion signal (design D5, guardrail G7): true when
  // Layer D removed ≥1 whole file and the run recorded no behavior-build proof.
  // Forces suggestedExitCode=1 so a risky deletion cannot finish green on the
  // compile+lint safety envelope alone.
  riskyDeletion: boolean;
  codeDrift?: string[];
  suggestedExitCode: 0 | 1;
  summaryLines: string[];
}

export const LAYER_D_FILE_THRESHOLD = 1;
export const LAYER_D_EXPORT_THRESHOLD = 5;

const DEFAULT_RECEIPTS_PATH = '.hygiene/receipts.jsonl';
const DEFAULT_VERDICT_PATH = '.hygiene/verdict.json';
const DEFAULT_CAP = 5;

// Validates an untrusted JSONL record against the v1 Receipt schema. Every
// required field is present and correctly typed; malformed or wrong-version
// records are rejected so downstream analysis only sees well-formed receipts.
function isReceipt(rec: unknown): rec is Receipt {
  if (rec === null || typeof rec !== 'object') return false;
  const r = rec as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.iter === 'number' &&
    typeof r.layer === 'string' &&
    typeof r.verb === 'string' &&
    typeof r.target === 'string' &&
    typeof r.kind === 'string'
  );
}

export function parseReceipts(jsonl: string): Receipt[] {
  const out: Receipt[] = [];
  const lines = jsonl.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (isReceipt(rec)) out.push(rec);
    } catch {
      // Tolerate partial trailing line (e.g., SIGINT mid-write); skip silently.
    }
  }
  return out;
}

function partitionByIter(records: Receipt[]): Map<number, Receipt[]> {
  const m = new Map<number, Receipt[]>();
  for (const r of records) {
    const list = m.get(r.iter) ?? [];
    list.push(r);
    m.set(r.iter, list);
  }
  return m;
}

function deleteCount(records: Receipt[]): number {
  let n = 0;
  for (const r of records) {
    if (r.verb === 'delete') n++;
  }
  return n;
}

function divergentLayers(records: Receipt[]): Set<string> {
  const layers = new Set<string>();
  for (const r of records) {
    if (
      r.verb === 'delete' &&
      (r.layer === 'C' || r.layer === 'D' || r.layer === 'D1')
    ) {
      layers.add(r.layer);
    }
  }
  return layers;
}

function layerDVolume(records: Receipt[]): LayerDVolume {
  let files = 0;
  let exports_ = 0;
  for (const r of records) {
    if (r.layer !== 'D' || r.verb !== 'delete') continue;
    if (r.kind === 'file') files++;
    else if (r.kind === 'export-clause' || r.kind === 'export-default')
      exports_++;
  }
  return { files, exports: exports_ };
}

// A behavior-build proof attests that every whole-file deletion in the run was
// validated against its behavior consumers (not just compile+lint). No cascade
// layer emits one today — that automatic build selection is DEF-3 / lazy row 04
// — so this is currently always false and any whole-file deletion is risky. The
// seam is explicit (an `extras.behaviorBuildProof` marker) so row 04 can attach
// proof later without reshaping the verdict.
function hasBehaviorBuildProof(records: Receipt[]): boolean {
  return records.some((r) => r.extras?.behaviorBuildProof === true);
}

function codeDrift(records: Receipt[]): string[] | undefined {
  const seen = new Set<string>();
  for (const r of records) {
    if (r.verb !== 'drift-suspected') continue;
    const codes = r.extras?.codesSeen;
    if (Array.isArray(codes)) {
      for (const c of codes) {
        if (typeof c === 'string') seen.add(c);
      }
    }
  }
  return seen.size > 0 ? [...seen].sort() : undefined;
}

// Maps the final-iteration signal to the three-way cascade verdict. Kept
// separate from analyze so the branch ladder reads as one decision.
function classifyConvergence(
  finalIterationDeletes: number,
  finalIteration: number,
  cap: number
): Convergence {
  if (finalIterationDeletes > 0) {
    // Divergent regardless of whether cap was actually hit — the spec frames
    // both as "cap-hit-divergent" because the user-facing semantics are the
    // same: cascade did not settle, manual review needed.
    return 'cap-hit-divergent';
  }
  if (finalIteration < cap) return 'converged';
  return 'cap-hit-clean';
}

// Renders the human-facing summary lines from the already-computed verdict
// dimensions (convergence, Layer D volume, code-drift). Pure string assembly:
// one convergence line, then optional volume NOTE and drift WARN.
function buildSummaryLines(
  convergence: Convergence,
  finalIteration: number,
  volume: LayerDVolume,
  riskyDeletion: boolean,
  drift: string[] | undefined,
  finalRecords: Receipt[]
): string[] {
  const summaryLines: string[] = [];

  if (convergence === 'converged') {
    if (finalIteration === 0) {
      summaryLines.push('converged immediately (no mutations)');
    } else {
      summaryLines.push(`converged in ${finalIteration} iteration(s)`);
    }
  } else if (convergence === 'cap-hit-clean') {
    summaryLines.push(
      'INFO: cascade settled at iteration cap (idempotent A/B churn caused fingerprint drift)'
    );
  } else {
    const layers = [...divergentLayers(finalRecords)].sort().join('/');
    summaryLines.push(
      `WARN: cascade did not converge — Layer ${layers || 'C/D/D1'} still deleting at iteration ${finalIteration}`
    );
  }

  // Whole-file deletion is fail-closed (design D5, G7): it now BLOCKS with a
  // manual-review message (exit non-zero) rather than the prior informational
  // NOTE, because compile+lint cannot see build-time-only consumers.
  if (riskyDeletion) {
    summaryLines.push(
      `MANUAL REVIEW REQUIRED: Layer D deleted ${volume.files} whole file(s) without behavior-build proof. Build-time consumers (vite virtual modules, MDX, Rust extractor) are invisible to knip — run \`vp run verify:full\`, confirm nothing broke, then re-run before committing.`
    );
  }

  // Export-volume cleanup stays an informational nudge (does not change the
  // exit code); retained from the prior NOTE.
  if (volume.exports >= LAYER_D_EXPORT_THRESHOLD) {
    summaryLines.push(
      `NOTE: Layer D removed ${volume.exports} exports. Build-time consumers (vite virtual modules, MDX, custom plugins) are invisible to knip — run \`vp run verify:full\` before committing.`
    );
  }

  if (drift) {
    summaryLines.push(
      `WARN: oxlint diagnostics present but none matched known codes — oxlint may have renamed. Codes seen: ${drift.join(', ')}`
    );
  }

  return summaryLines;
}

export function analyze(
  records: Receipt[],
  cap: number,
  ranIters?: number
): Verdict {
  const byIter = partitionByIter(records);
  const iters = [...byIter.keys()].sort((a, b) => a - b);
  const lastReceiptIter = iters.length > 0 ? iters[iters.length - 1] : 0;
  // The cascade may have run iterations beyond the last one that produced any
  // receipts (e.g., a clean iteration 2 with zero diagnostics emits no
  // records). Trust the orchestrator-supplied ranIters when it exceeds the
  // receipt-derived final iter — those silent iterations are convergence
  // evidence, not absence of evidence.
  const finalIteration =
    ranIters !== undefined && ranIters > lastReceiptIter
      ? ranIters
      : lastReceiptIter;
  const finalRecords =
    finalIteration > 0 ? (byIter.get(finalIteration) ?? []) : [];
  const finalIterationDeletes = deleteCount(finalRecords);

  const convergence = classifyConvergence(
    finalIterationDeletes,
    finalIteration,
    cap
  );

  const volume = layerDVolume(records);
  const drift = codeDrift(records);
  const riskyDeletion = volume.files > 0 && !hasBehaviorBuildProof(records);

  const summaryLines = buildSummaryLines(
    convergence,
    finalIteration,
    volume,
    riskyDeletion,
    drift,
    finalRecords
  );

  const suggestedExitCode: 0 | 1 =
    convergence === 'cap-hit-divergent' || riskyDeletion ? 1 : 0;

  const verdict: Verdict = {
    convergence,
    finalIteration,
    iterationCap: cap,
    finalIterationDeletes,
    layerDVolume: volume,
    riskyDeletion,
    suggestedExitCode,
    summaryLines,
  };
  if (drift) verdict.codeDrift = drift;
  return verdict;
}

function parseFlag(name: string): number | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      const n = Number(arg.slice(prefix.length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function parseCap(): number {
  const flag = parseFlag('cap');
  if (flag !== undefined) return flag;
  const env = Number(process.env.HYGIENE_ITERATIONS ?? '');
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_CAP;
}

function parseRanIters(): number | undefined {
  const flag = parseFlag('final-iter');
  if (flag !== undefined) return flag;
  const env = Number(process.env.HYGIENE_FINAL_ITER ?? '');
  if (Number.isFinite(env) && env > 0) return env;
  return undefined;
}

function main(): void {
  const cap = parseCap();
  const ranIters = parseRanIters();
  const receiptsPath = process.env.RECEIPTS_FILE || DEFAULT_RECEIPTS_PATH;

  let records: Receipt[];
  if (existsSync(receiptsPath)) {
    const raw = readFileSync(receiptsPath, 'utf-8');
    records = parseReceipts(raw);
  } else {
    records = [];
  }

  const verdict = analyze(records, cap, ranIters);

  for (const line of verdict.summaryLines) console.log(line);

  const verdictPath = process.env.VERDICT_FILE || DEFAULT_VERDICT_PATH;
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf-8');
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  }
}
