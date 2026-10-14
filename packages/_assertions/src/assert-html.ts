/**
 * Structural assertions over emitted HTML: the no-flash promise is an ORDER
 * promise, so everything here compares character offsets, not mere presence.
 */
import { createHash } from 'node:crypto';

import { AssertionError } from './assert-css';

import type { JsonObject } from './json';

const DEFAULT_MARKER = 'data-animus-bootstrap';

/**
 * Anything that makes the browser apply CSS. The preload counts: Next emits
 * `as="style"` ahead of the link it warms.
 */
const FETCHED_STYLESHEET_REFERENCES: readonly RegExp[] = [
  /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b/i,
  /<link\b[^>]*\bas\s*=\s*["']?style\b/i,
];
const STYLESHEET_REFERENCES: readonly RegExp[] = [
  ...FETCHED_STYLESHEET_REFERENCES,
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

type StylesheetReference = {
  pattern: string;
  index: number;
};

/** The first stylesheet reference in a `<head>`, or why the ordering
 *  contract cannot be witnessed: a head with none is an empty set. */
function firstStylesheetReference(
  head: HeadSlice,
  assertion: string,
  details: JsonObject = {},
  patterns: readonly RegExp[] = STYLESHEET_REFERENCES
): StylesheetReference & { references: StylesheetReference[] } {
  const references = patterns
    .map((pattern) => {
      const found = head.html.match(pattern);
      return { pattern: pattern.source, index: found?.index ?? -1 };
    })
    .filter((reference) => reference.index !== -1);
  if (references.length === 0) {
    throw new AssertionError(
      `${assertion}: no stylesheet reference found in <head> — the ordering contract cannot be witnessed against an empty set`,
      details
    );
  }
  const first = references.reduce((a, b) => (a.index <= b.index ? a : b));
  return { ...first, references };
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

  const { references, ...first } = firstStylesheetReference(
    head,
    'assertBootstrapScriptFirst',
    { marker }
  );
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

/** The metas a font preload follows. */
const FONT_PRELOAD_PRECEDING_METAS: readonly RegExp[] = [
  /<meta\b[^>]*\bcharset\s*=/i,
  /<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i,
];

/**
 * The font preload contract: `<head>` holds exactly one font preload, with
 * `crossorigin`, whose href is `href` — the URL the stylesheet's `url()`
 * loads, so the browser fetches the file once — and it precedes every
 * stylesheet the document fetches. Its type, when it has one, is a font MIME type: a
 * browser ignores a preload whose type it does not support. It follows the
 * charset and viewport metas, so preloads cannot push the charset past the
 * bytes a browser sniffs for it.
 */
export function assertFontPreload(html: string, href: string): void {
  const head = headOf(html);
  const preloads = [...head.html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) =>
      /\brel\s*=\s*["']?preload\b/i.test(tag) &&
      /\bas\s*=\s*["']?font\b/i.test(tag)
  );
  if (preloads.length !== 1) {
    throw new AssertionError(
      `assertFontPreload: expected one font preload in <head>, found ${preloads.length}`,
      { preloads: preloads.map(([tag]) => tag) }
    );
  }
  const [tag] = preloads[0]!;
  const actual = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
  const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(tag)?.[1];
  if (type !== undefined && !/^font\/(?:woff2|woff|ttf|otf)$/.test(type)) {
    throw new AssertionError(
      `assertFontPreload: the preload's type "${type}" is no font MIME type, so the browser ignores it`,
      { tag }
    );
  }
  if (actual !== href || !/\bcrossorigin\b/i.test(tag)) {
    throw new AssertionError(
      `assertFontPreload: the preload must name ${href} with crossorigin`,
      { tag }
    );
  }
  const at = preloads[0]!.index!;
  for (const meta of FONT_PRELOAD_PRECEDING_METAS) {
    const found = head.html.search(meta);
    if (found > at) {
      throw new AssertionError(
        `assertFontPreload: the font preload (head offset ${at}) must follow /${meta.source}/ (head offset ${found})`,
        { tag }
      );
    }
  }
  // An inline `<style>` fetches nothing for the preload to get ahead of.
  const first = firstStylesheetReference(
    head,
    'assertFontPreload',
    {},
    FETCHED_STYLESHEET_REFERENCES
  );
  if (at >= first.index) {
    throw new AssertionError(
      `assertFontPreload: the font preload (head offset ${at}) must precede the first stylesheet reference /${first.pattern}/ (head offset ${first.index})`,
      { tag }
    );
  }
}
