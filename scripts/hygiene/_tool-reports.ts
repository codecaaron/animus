// scripts/hygiene/_tool-reports.ts
//
// Single owner for the EXTERNAL tool wire formats the hygiene cascade
// consumes, and for the one failure policy that governs reading them.
//
// Before this module the oxlint `--format=json` shape was declared three
// times (`_emit-oxlint-receipts.ts`, `delete-unused.ts`,
// `delete-unused.test.ts`) with divergent optionality, and the "what do we do
// with unreadable tool output" question was answered three different ways:
// the Layer A emitter returned silently (exit 0, zero receipts), the Layer C
// deleter exited 1, and the Layer D knip emitter returned silently again.
//
// ## Failure policy (ONE decision, applied to every tool report)
//
// Unreadable tool output is DIAGNOSED AND RAISED, naming the tool. It is
// never converted into an empty report.
//
// The rationale is the cascade's own verdict model: a receipt file with zero
// records reads as "converged, nothing to clean". That is exactly what a
// broken decoder produces, so a silent-empty decode makes a broken cascade
// indistinguishable from a clean one — the same vacuous-gate class the
// Layer C `drift-suspected` receipt already exists to close (see
// scripts/hygiene/CLAUDE.md § "Layer C code-drift WARN").
//
// Consumers catch `ToolReportError`, print `err.message`, and exit non-zero.
// `run.sh` wraps each layer in `|| true`, so the stderr message — not the
// exit code — is what actually reaches the operator; the messages below are
// written to stand alone as the whole diagnosis.
//
// ## Known malformation: the "no files" banner
//
// `vp lint --format=json <paths>` prints
//
//   No files found to lint. Please check your paths and ignore patterns.
//
// to STDOUT, ahead of the JSON document, whenever the invocation matches no
// lintable file. `run.sh` captures stdout (`2>/dev/null`), so this banner
// lands in the cascade's input and `JSON.parse` fails on it. It is called out
// by name below because "oxlint linted zero files" is precisely the silent
// no-op the cascade must never report as clean.

import { readFileSync } from 'node:fs';

/**
 * Raised when an external tool's report cannot be read as the shape the
 * cascade requires. Carries the tool and the calling layer so the message is
 * actionable on its own.
 */
export class ToolReportError extends Error {
  readonly tool: string;
  readonly source: string;

  constructor(tool: string, source: string, detail: string) {
    super(`ERROR: ${source}: unreadable ${tool} report — ${detail}`);
    this.name = 'ToolReportError';
    this.tool = tool;
    this.source = source;
  }
}

// oxlint's `--format=json` banner for an invocation that matched no files.
const OXLINT_NO_FILES_BANNER = 'No files found to lint';

// How much of the offending payload to quote back in a diagnosis.
const EXCERPT_LENGTH = 200;

function excerpt(input: string): string {
  const flat = input.trim().replace(/\s+/g, ' ');
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH)}…`
    : flat;
}

/**
 * The text-level half of the failure policy: reject output that is not even a
 * candidate JSON document, diagnosing the known causes by name.
 */
function requireReportText(
  input: string,
  tool: string,
  source: string
): string {
  const text = input.trim();
  if (!text) {
    throw new ToolReportError(
      tool,
      source,
      `${tool} produced no output. The cascade cannot distinguish this from a clean run, so it is treated as a failure.`
    );
  }
  if (text.startsWith('{') || text.startsWith('[')) return text;

  if (text.startsWith(OXLINT_NO_FILES_BANNER)) {
    throw new ToolReportError(
      tool,
      source,
      `${tool} matched no lintable files and printed "${OXLINT_NO_FILES_BANNER}…" on stdout ahead of its JSON. Zero files linted means this layer inspected nothing — reporting it as a clean pass would hide the no-op. Check the scoped path list and the lint ignorePatterns in vite.config.ts.`
    );
  }
  throw new ToolReportError(
    tool,
    source,
    `expected a JSON document on stdout, got non-JSON leading text: ${excerpt(text)}`
  );
}

// oxlint `--format=json` wire shape. `diagnostics` is REQUIRED: the deleter's
// stricter model is the correct one — oxlint always emits the key, so a report
// without it is a format change the cascade must not silently absorb.
type OxlintSpan = {
  offset: number;
  length: number;
  line: number;
  column: number;
};
type OxlintLabel = { label?: string; span: OxlintSpan };
export type OxlintDiagnostic = {
  message: string;
  code: string;
  filename: string;
  labels: OxlintLabel[];
  // Fields oxlint also emits but the cascade does not read. Declared so the
  // one model describes the real wire rather than a subset of it.
  severity?: string;
  causes?: string[];
  related?: string[];
  url?: string;
  help?: string;
};
export type OxlintReport = { diagnostics: OxlintDiagnostic[] };

// knip `--reporter=json` wire shape. DISTINCT from oxlint by construction —
// a different tool with a different payload — and deliberately kept as its own
// type. Only the FAILURE POLICY above is shared. The full field inventory this
// subset is drawn from is documented at the top of `_emit-knip-receipts.ts`.
type KnipNamedSymbol = { name: string; line?: number };
type KnipPackage = { name: string };
type KnipIssue = {
  file: string;
  files?: string[];
  exports?: KnipNamedSymbol[];
  dependencies?: KnipPackage[];
  devDependencies?: KnipPackage[];
};
export type KnipReport = { issues: KnipIssue[] };

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    // SAFETY: process.stdin is a Readable in binary mode (no encoding set on
    // it anywhere in the cascade), so every chunk is a Buffer — a Uint8Array.
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Read a tool report from the cascade's conventional input: `argv[2]` as a
 * filename when present (tests drive the scripts this way), stdin otherwise.
 */
export async function readReportInput(
  fileArg: string | undefined
): Promise<string> {
  return fileArg ? readFileSync(fileArg, 'utf-8') : await readStdin();
}

/**
 * Decode oxlint `--format=json` output. Throws `ToolReportError` on any input
 * that is not a well-formed report — never returns an empty stand-in.
 */
export function decodeOxlintReport(
  input: string,
  source: string
): OxlintReport {
  const text = requireReportText(input, 'oxlint', source);
  let parsed: OxlintReport;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ToolReportError(
      'oxlint',
      source,
      `JSON parse failed (${String(e)}) on: ${excerpt(text)}`
    );
  }
  if (!Array.isArray(parsed?.diagnostics)) {
    throw new ToolReportError(
      'oxlint',
      source,
      'JSON has no `diagnostics` array (oxlint --format=json shape expected). oxlint may have changed its report format.'
    );
  }
  return parsed;
}

/**
 * Decode knip `--reporter=json` output. Same failure policy as oxlint.
 */
export function decodeKnipReport(input: string, source: string): KnipReport {
  const text = requireReportText(input, 'knip', source);
  let parsed: KnipReport;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ToolReportError(
      'knip',
      source,
      `JSON parse failed (${String(e)}) on: ${excerpt(text)}`
    );
  }
  if (!Array.isArray(parsed?.issues)) {
    throw new ToolReportError(
      'knip',
      source,
      'JSON has no `issues` array (knip --reporter=json shape expected). knip may have changed its report format.'
    );
  }
  return parsed;
}

/**
 * Strip oxlint's `eslint(<rule>)` code wrapper so internal logic operates on
 * bare rule names.
 */
export function unwrapCode(code: string): string {
  const m = code.match(/^eslint\((.+)\)$/);
  return m ? m[1] : code;
}

/**
 * Discriminator for oxlint's `no-unused-vars` rule, which folds biome 2.x's
 * noUnusedVariables + noUnusedFunctionParameters + noUnusedImports into one
 * rule. The class is recovered from the diagnostic message PROSE (verified
 * empirically against the live binary), which makes this the most drift-prone
 * contract in the cascade.
 *
 * This is the single authority. Layer A (`_emit-oxlint-receipts.ts`) uses it
 * to decide what a receipt CLAIMS was deleted; Layer C (`delete-unused.ts`)
 * uses it to decide what actually GETS deleted. A second copy would let the
 * receipt and the mutation disagree about the same diagnostic.
 */
export function classifyUnusedVar(
  message: string
): 'decl' | 'import' | 'param' | 'unknown' {
  if (/^Identifier '[^']+' is imported/.test(message)) return 'import';
  if (/^Parameter '/.test(message)) return 'param';
  if (/^(Variable|Function|Class|Type alias|Interface|Enum) '/.test(message)) {
    return 'decl';
  }
  return 'unknown';
}
