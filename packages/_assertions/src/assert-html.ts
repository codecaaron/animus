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

/** The `<head>…</head>` slice, or the whole document when there is no head. */
function headOf(html: string): { html: string; offset: number } {
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
