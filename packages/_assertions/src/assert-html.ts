/**
 * Structural assertions over emitted HTML: the no-flash promise is an ORDER
 * promise, so everything here compares character offsets, not mere presence.
 */
import { createHash } from 'node:crypto';

import { AssertionError } from './assert-css';

const DEFAULT_MARKER = 'data-animus-bootstrap';

/**
 * Anything that makes the browser apply CSS. The preload counts: Next emits
 * `as="style"` ahead of the link it warms.
 */
const STYLESHEET_REFERENCES: readonly RegExp[] = [
  /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b/i,
  /<link\b[^>]*\bas\s*=\s*["']?style\b/i,
  /<style\b/i,
];

interface HeadSlice {
  html: string;
  offset: number;
}

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
  marker?: string;
  code?: string;
  /**
   * Artifact `cspHash`, recomputed from the EMITTED text a browser hashes: a
   * re-encoding delivery path fails here instead of as a blocked script.
   */
  cspHash?: string;
}

/**
 * The bootstrap script is in `<head>` and precedes every stylesheet reference.
 * A document with no stylesheet reference throws instead of passing vacuously.
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
 * HTML's hard limit: an encoding declaration must be serialized completely
 * within the first 1024 bytes or browsers ignore it and sniff.
 */
const CHARSET_BYTE_BUDGET = 1024;

/**
 * The encoding declaration lives in `<head>` and ends within the byte budget.
 * Head-prepend injection pushes it toward that cliff, and overflow is silent.
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
  // Measured from the DOCUMENT start, what the browser counts, even though the
  // search is scoped to `<head>`, the only place a declaration is honored.
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
 * Ordering and charset budget armed together: a lane that injects into
 * `<head>` and asserts ordering alone ships the overflow silently.
 */
export function assertHeadInjectionContract(
  html: string,
  config?: BootstrapScriptConfig
): void {
  assertBootstrapScriptFirst(html, config);
  assertCharsetWithinByteBudget(html);
}

/**
 * The negative witness: a route the application never touched carries no
 * bootstrap script, even in a build where another route places one.
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
