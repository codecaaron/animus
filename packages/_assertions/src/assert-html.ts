/**
 * Structural assertions for emitted HTML documents
 * (openspec: system-color-scheme, "No-flash restoration").
 *
 * The no-flash promise is a TIMING promise, and the only part of it a build
 * artifact can carry is ORDER: the restoration snippet must be parsed and run
 * before the browser has any stylesheet to apply. Everything here is order over
 * character offsets in the emitted document — a marker that is merely PRESENT
 * proves nothing, which is the whole reason these live in a package instead of
 * a `grep`.
 *
 * Pure over the HTML string; no I/O.
 */
import { createHash } from 'node:crypto';

import { AssertionError } from './assert-css';

/** Attribute the injected/placed bootstrap script is marked with. */
const DEFAULT_MARKER = 'data-animus-bootstrap';

/**
 * Anything that makes the browser apply CSS: a stylesheet link, a preload that
 * warms one (`as="style"` — Next emits this AHEAD of the link), or any inline
 * `<style>` element (the Vite plugin's own `@layer` declaration tag is one).
 */
const STYLESHEET_REFERENCES: readonly RegExp[] = [
  /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b/i,
  /<link\b[^>]*\bas\s*=\s*["']?style\b/i,
  /<style\b/i,
];

/**
 * A document slice plus where it starts, so an offset found inside `html` can
 * be converted back to a DOCUMENT offset — which is the unit both the ordering
 * and the byte-budget contracts are actually written in.
 */
interface HeadSlice {
  /** The sliced markup. */
  html: string;
  /** Offset of `html[0]` in the original document. */
  offset: number;
}

/** The `<head>…</head>` slice, or the whole document when there is no head. */
function headOf(html: string): HeadSlice {
  const open = html.search(/<head\b[^>]*>/i);
  if (open === -1) return { html, offset: 0 };
  const start = html.indexOf('>', open) + 1;
  const end = html.search(/<\/head\s*>/i);
  return {
    html: html.slice(start, end === -1 ? undefined : end),
    offset: start,
  };
}

function scriptRe(marker: string): RegExp {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `<script\\b[^>]*\\b${escaped}\\b[^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
}

export interface BootstrapScriptConfig {
  /** Marker attribute. Defaults to `data-animus-bootstrap`. */
  marker?: string;
  /** Artifact `code`; compared byte-for-byte against the emitted script text. */
  code?: string;
  /**
   * Artifact `cspHash` (`sha256-…`). Recomputed from the EMITTED script text,
   * which is what a browser hashes — so a delivery path that re-encodes or
   * re-indents the snippet fails here rather than as a blocked script and a
   * flash of the wrong mode in production.
   */
  cspHash?: string;
}

/**
 * Assert the bootstrap script is present in `<head>` and precedes every
 * stylesheet reference in the document.
 *
 * Deliberately NOT vacuous-friendly: a document with no stylesheet reference at
 * all throws, because "the script came first" is meaningless when nothing
 * follows it — that shape means the build stopped emitting CSS, not that the
 * ordering contract held.
 */
export function assertBootstrapScriptFirst(
  html: string,
  config?: BootstrapScriptConfig
): void {
  const marker = config?.marker ?? DEFAULT_MARKER;
  const head = headOf(html);

  const match = head.html.match(scriptRe(marker));
  if (!match || match.index === undefined) {
    throw new AssertionError(
      `assertBootstrapScriptFirst: no <script ${marker}> found in <head>`,
      { marker, headLength: head.html.length }
    );
  }
  const scriptIndex = match.index;

  const references = STYLESHEET_REFERENCES.map((pattern) => {
    const found = head.html.match(pattern);
    return { pattern: pattern.source, index: found?.index ?? -1 };
  }).filter((reference) => reference.index !== -1);

  if (references.length === 0) {
    throw new AssertionError(
      'assertBootstrapScriptFirst: no stylesheet reference found in <head> — the ordering contract cannot be witnessed against an empty set',
      { marker }
    );
  }

  const first = references.reduce((a, b) => (a.index <= b.index ? a : b));
  if (scriptIndex >= first.index) {
    throw new AssertionError(
      `assertBootstrapScriptFirst: bootstrap script (head offset ${scriptIndex}) must precede the first stylesheet reference /${first.pattern}/ (head offset ${first.index})`,
      { scriptIndex, firstReference: first, references }
    );
  }

  const emitted = match[1];
  if (config?.code !== undefined && emitted !== config.code) {
    throw new AssertionError(
      'assertBootstrapScriptFirst: emitted script text is not the artifact code verbatim',
      { emittedLength: emitted.length, expectedLength: config.code.length }
    );
  }

  if (config?.cspHash !== undefined) {
    const actual = `sha256-${createHash('sha256').update(emitted, 'utf8').digest('base64')}`;
    if (actual !== config.cspHash) {
      throw new AssertionError(
        `assertBootstrapScriptFirst: sha256 of the emitted script (${actual}) does not match the artifact cspHash (${config.cspHash}) — a CSP built from the artifact would block this script`,
        { actual, expected: config.cspHash }
      );
    }
  }
}

/**
 * The HTML spec's hard limit: an encoding declaration must be serialized
 * completely within the first 1024 BYTES of the document or browsers ignore it
 * and sniff. Spec-fixed, so deliberately not configurable.
 */
const CHARSET_BYTE_BUDGET = 1024;

/**
 * Assert the document's character-encoding declaration lives in `<head>` and
 * is serialized completely within the first {@link CHARSET_BYTE_BUDGET} bytes
 * of the document.
 *
 * Head-prepend injection (the appearance bootstrap plus the `@layer`
 * declaration tag) pushes the app's own `<meta charset>` toward that cliff, and
 * overflowing it is perfectly silent — no build error, no console warning, just
 * a sniffed encoding. This gate makes the overflow loud while there is still
 * headroom to spend; failure details carry `endByte` and `headroom` (negative =
 * bytes over budget).
 */
export function assertCharsetWithinByteBudget(html: string): void {
  const head = headOf(html);
  const match = head.html.match(
    /<meta\b[^>]*\b(?:charset\s*=|http-equiv\s*=\s*["']?content-type)[^>]*>/i
  );
  if (!match || match.index === undefined) {
    throw new AssertionError(
      'assertCharsetWithinByteBudget: no character-encoding declaration (<meta charset> or http-equiv content-type) found in <head>',
      { budget: CHARSET_BYTE_BUDGET }
    );
  }
  // Byte offset measured from the DOCUMENT start (what the browser counts),
  // even though the search is scoped to <head> (the only place a declaration
  // is honored).
  const end = head.offset + match.index + match[0].length;
  const endByte = new TextEncoder().encode(html.slice(0, end)).length;
  if (endByte > CHARSET_BYTE_BUDGET) {
    throw new AssertionError(
      `assertCharsetWithinByteBudget: the encoding declaration ends at byte ${endByte}, past the ${CHARSET_BYTE_BUDGET}-byte limit — browsers will ignore it and sniff the encoding`,
      {
        endByte,
        budget: CHARSET_BYTE_BUDGET,
        headroom: CHARSET_BYTE_BUDGET - endByte,
        declaration: match[0],
      }
    );
  }
}

/**
 * The head-injection contract in one call: a document that had a bootstrap
 * prepended into `<head>` must (a) keep it ahead of every stylesheet reference
 * and (b) still land its charset declaration inside the byte budget the
 * injection spends. Armed together so the budget gate travels with the hazard —
 * a lane that injects but only asserts ordering is exactly how the overflow
 * ships silently. The individual assertions stay exported for special needs.
 */
export function assertHeadInjectionContract(
  html: string,
  config?: BootstrapScriptConfig
): void {
  assertBootstrapScriptFirst(html, config);
  assertCharsetWithinByteBudget(html);
}

/**
 * Assert the document carries no bootstrap script.
 *
 * The live negative witness for "the Next.js plugin SHALL NOT inject the
 * bootstrap script": a route whose document the application never touched must
 * come out clean even in a build where another route places one.
 */
export function assertNoBootstrapScript(
  html: string,
  config?: { marker?: string }
): void {
  const marker = config?.marker ?? DEFAULT_MARKER;
  const index = html.indexOf(marker);
  if (index !== -1) {
    throw new AssertionError(
      `assertNoBootstrapScript: found '${marker}' at offset ${index}`,
      { marker, context: html.slice(Math.max(0, index - 60), index + 90) }
    );
  }
}
