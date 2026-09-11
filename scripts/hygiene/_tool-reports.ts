// Unreadable tool output is raised, naming the tool, and never turned into an
// empty report: zero records already means "converged, nothing to clean".

import { readFileSync } from 'node:fs';

/**
 * Raised when a tool report cannot be read as the shape the cascade requires.
 * `run.sh` swallows the exit code, so the message must diagnose on its own.
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

const OXLINT_NO_FILES_BANNER = 'No files found to lint';

const EXCERPT_LENGTH = 200;

function excerpt(input: string): string {
  const flat = input.trim().replace(/\s+/g, ' ');
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH)}…`
    : flat;
}

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

// oxlint `--format=json` wire shape. `diagnostics` is required: oxlint always
// emits it, so a report without it is a format change, not an empty result.
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
  // Emitted by oxlint, unread here; declared so the model matches the wire.
  severity?: string;
  causes?: string[];
  related?: string[];
  url?: string;
  help?: string;
};
export type OxlintReport = { diagnostics: OxlintDiagnostic[] };

// knip `--reporter=json` wire shape, the subset the cascade reads.
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
    // SAFETY: process.stdin has no encoding set anywhere in the cascade, so
    // every chunk is a Buffer, which is a Uint8Array.
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Reads a tool report from `argv[2]` as a filename, or from stdin when absent.
 */
export async function readReportInput(
  fileArg: string | undefined
): Promise<string> {
  return fileArg ? readFileSync(fileArg, 'utf-8') : await readStdin();
}

/** Decodes oxlint `--format=json`; throws rather than returning empty. */
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

/** Decodes knip `--reporter=json`; throws rather than returning empty. */
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

/** Strips oxlint's `eslint(<rule>)` wrapper to a bare rule name. */
export function unwrapCode(code: string): string {
  const m = code.match(/^eslint\((.+)\)$/);
  return m ? m[1] : code;
}

/**
 * The unused class is recovered from oxlint's message prose, so a reworded
 * message breaks it. One authority: receipts and deletions must agree.
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
