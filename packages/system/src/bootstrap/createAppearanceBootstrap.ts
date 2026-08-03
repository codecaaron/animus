import { createHash } from 'node:crypto';

/**
 * Appearance bootstrap generator — build-tooling surface ONLY.
 *
 * This module is reachable exclusively from the `@animus-ui/system/bootstrap`
 * subpath. It is never imported by the component/runtime entries, so no part of
 * it (including the storage keys below) can reach an extracted application
 * bundle.
 */

/** The single versioned appearance record key. */
const DEFAULT_STORAGE_KEY = 'animus:appearance';

/**
 * Pre-record key read once, only when the record is absent. Never written —
 * migration is read-only by contract.
 */
const LEGACY_STORAGE_KEY = 'color-mode';

/** The mode axis attribute. Its ABSENCE means "follow the OS" (D4). */
const MODE_ATTRIBUTE = 'data-color-mode';

/**
 * Reserved mode name. `system` is modeled as attribute absence and can never be
 * a declared mode, so it must never enter the generated allowlist.
 */
const RESERVED_MODE_NAME = 'system';

/** The only appearance-record version this generation of the snippet reads. */
const RECORD_VERSION = 1;

/**
 * The slice of a built theme the generator reads: the declared mode names.
 * Structural on purpose — the generator reads mode KEYS only and never touches
 * the theme's pipeline wire (guardrail G5).
 */
export interface AppearanceBootstrapTheme {
  manifest: {
    /** Mode name → resolved tokens. Only the KEYS are read. */
    modes?: Record<string, unknown>;
  };
}

export interface AppearanceBootstrapOptions {
  /** Overrides the record key. Defaults to `animus:appearance`. */
  storageKey?: string;
}

export interface AppearanceBootstrapArtifact {
  /** Dependency-free inline IIFE, safe to embed in a document head. */
  code: string;
  /**
   * `sha256-<base64>` — the CSP hash of `code`, ready for a `script-src`
   * source list.
   *
   * The source expression MUST be SINGLE-QUOTED in the header, exactly as
   * returned:
   *
   * ```
   * Content-Security-Policy: script-src 'sha256-<the artifact hash>'
   * ```
   *
   * Unquoted, it is parsed as a host source and silently fails to authorize
   * the script.
   *
   * Always derive the header from this field at build time — never hand-copy
   * it. Any theme edit that changes the declared mode names (or a changed
   * `storageKey`) changes `code` and therefore this hash; a stale literal in a
   * config file turns into a blocked script and a flash of the wrong mode.
   */
  cspHash: string;
}

/**
 * Renders a string as a JS literal that is also safe inside an inline
 * `<script>` and inside a consumer's own string context:
 * - `<` is escaped, so an embedded value can never open a closing tag or an
 *   HTML comment;
 * - U+2028/U+2029 are escaped, so `code` survives being nested in string
 *   contexts that still treat them as line terminators.
 *
 * Character-wise on purpose: this file stays pure ASCII, so no invisible
 * separator can hide in it.
 */
function inlineLiteral(value: string): string {
  let out = '';
  for (const char of JSON.stringify(value)) {
    if (char === '<') {
      out += '\\u003c';
      continue;
    }
    const code = char.codePointAt(0);
    if (code === 0x2028 || code === 0x2029) {
      out += `\\u${code.toString(16)}`;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Builds the inline appearance-restoration script for a built theme.
 *
 * The generated snippet, before first paint:
 * 1. reads the appearance record from `storageKey`, falling back to the legacy
 *    `color-mode` key ONLY when the record is absent (missing key, or an empty
 *    string, which is not a record);
 * 2. accepts the record only at version `1` — a future or absent version is
 *    treated as NO record, because an older snippet cannot interpret a newer
 *    record and absence is the neutral fail-safe;
 * 3. sets `data-color-mode` when the resulting name is a declared mode;
 * 4. removes the attribute for `system`, no record, an unreadable store, or an
 *    unknown mode — absence is how "follow the OS" is represented, so later OS
 *    changes apply with no script running.
 *
 * The failure semantics are deliberately asymmetric:
 * - storage that THROWS on read (private browsing, blocked storage) means "no
 *   knowledge", so the attribute is REMOVED and the media-query fallback takes
 *   over; freezing a server-rendered mode would defeat that fallback;
 * - a record that is PRESENT but unparseable means "storage is telling us
 *   something we cannot read", so the snippet exits leaving the server-rendered
 *   markup exactly as it was.
 *
 * It never writes storage, never calls `matchMedia`, and ignores the record's
 * `theme` axis. Identical inputs always yield byte-identical output.
 *
 * @throws if the theme declares no color modes (a bootstrap without a mode
 *   allowlist could not validate anything), declares the reserved name
 *   `system`, or declares a blank mode name.
 */
export function createAppearanceBootstrap(
  theme: AppearanceBootstrapTheme,
  options: AppearanceBootstrapOptions = {}
): AppearanceBootstrapArtifact {
  const { storageKey = DEFAULT_STORAGE_KEY } = options;

  if (typeof storageKey !== 'string' || storageKey === '') {
    throw new Error(
      'createAppearanceBootstrap: storageKey must be a non-empty string.'
    );
  }

  // Sorted so the embedded allowlist — and therefore the code bytes and the
  // CSP hash — do not depend on theme declaration order.
  const modeNames = Object.keys(theme?.manifest?.modes ?? {}).sort();

  if (modeNames.length === 0) {
    throw new Error(
      'createAppearanceBootstrap: the theme declares no color modes — call addColorModes() before generating a bootstrap.'
    );
  }

  if (modeNames.includes(RESERVED_MODE_NAME)) {
    throw new Error(
      `createAppearanceBootstrap: '${RESERVED_MODE_NAME}' is a reserved mode name — the OS preference is represented by the absence of the ${MODE_ATTRIBUTE} attribute, never by a declared mode.`
    );
  }

  // A blank name would sit in the allowlist matching no mode block, while a
  // persisted blank still SETS the attribute and so suppresses the system
  // media guard — a value that is neither a mode nor absence.
  if (modeNames.some((name) => name.trim() === '')) {
    throw new Error(
      'createAppearanceBootstrap: a declared mode name is empty or whitespace-only — such a name matches no mode block and would suppress the system fallback.'
    );
  }

  const allowlist = `[${modeNames.map(inlineLiteral).join(',')}]`;

  // Single line, free `document`/`localStorage` identifiers, no imports and no
  // unresolved placeholders.
  //
  // Control flow (see the asymmetry note above):
  // - inner try around each read  → a throwing store degrades to "no record",
  //   which lands in the removal branch;
  // - inner try around JSON.parse → an unreadable PRESENT record returns early,
  //   before any attribute is touched;
  // - outer try                   → a DOM-level failure can never throw into
  //   the page.
  const code =
    '(function(){try{' +
    `var m=${allowlist};` +
    'var r=document.documentElement;' +
    'var v=null;' +
    `try{v=localStorage.getItem(${inlineLiteral(storageKey)});}catch(e){v=null;}` +
    'var n=null;' +
    'if(typeof v==="string"&&v!==""){' +
    'var p;' +
    'try{p=JSON.parse(v);}catch(e){return;}' +
    `n=p&&typeof p==="object"&&p.v===${RECORD_VERSION}?p.mode:null;` +
    '}else{' +
    `try{n=localStorage.getItem(${inlineLiteral(LEGACY_STORAGE_KEY)});}catch(e){n=null;}` +
    '}' +
    'if(typeof n==="string"&&m.indexOf(n)!==-1)' +
    `{r.setAttribute(${inlineLiteral(MODE_ATTRIBUTE)},n);}` +
    `else{r.removeAttribute(${inlineLiteral(MODE_ATTRIBUTE)});}` +
    '}catch(e){}})();';

  const cspHash = `sha256-${createHash('sha256')
    .update(code, 'utf8')
    .digest('base64')}`;

  return { code, cspHash };
}
