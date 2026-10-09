import { createHash } from 'node:crypto';

const DEFAULT_STORAGE_KEY = 'animus:appearance';

const LEGACY_STORAGE_KEY = 'color-mode';

const MODE_ATTRIBUTE = 'data-color-mode';

const RESERVED_MODE_NAME = 'system';

const RECORD_VERSION = 1;

export interface AppearanceBootstrapTheme {
  manifest: {
    modes?: Record<string, unknown>;
  };
}

export interface AppearanceBootstrapOptions {
  storageKey?: string;
  /**
   * Keys your application owns that hold a bare mode name from before the
   * appearance record. Before paint, each is migrated as
   * `migrateLegacyModeKey` migrates it, in order, so the first declared mode
   * becomes the record when none exists. An undeclared value is removed,
   * never applied. The shared `color-mode` key stays read-only.
   */
  legacyKeys?: readonly string[];
}

export interface AppearanceBootstrapArtifact {
  code: string;
  cspHash: string;
}

/**
 * Renders a JS string literal safe inside an inline `<script>`: `<` cannot open
 * a closing tag, and U+2028/U+2029 survive nesting in string contexts. The loop
 * compares code points rather than matching literal separators, so no invisible
 * character has to appear in this source — keep it that way.
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

export function createAppearanceBootstrap(
  theme: AppearanceBootstrapTheme,
  options: AppearanceBootstrapOptions = {}
): AppearanceBootstrapArtifact {
  const { storageKey = DEFAULT_STORAGE_KEY, legacyKeys = [] } = options;

  if (typeof storageKey !== 'string' || storageKey === '') {
    throw new Error(
      'createAppearanceBootstrap: storageKey must be a non-empty string.'
    );
  }

  for (const legacyKey of legacyKeys) {
    if (typeof legacyKey !== 'string' || legacyKey === '') {
      throw new Error(
        'createAppearanceBootstrap: each legacy key must be a non-empty string.'
      );
    }
    if (legacyKey === LEGACY_STORAGE_KEY) {
      throw new Error(
        `createAppearanceBootstrap: '${LEGACY_STORAGE_KEY}' is the contract's shared legacy key — the bootstrap reads it read-only and it may belong to another app on this origin. List only keys your application owns.`
      );
    }
    if (legacyKey === storageKey) {
      throw new Error(
        `createAppearanceBootstrap: legacy key '${legacyKey}' is the record key itself — nothing to migrate.`
      );
    }
  }

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

  if (modeNames.some((name) => name.trim() === '')) {
    throw new Error(
      'createAppearanceBootstrap: a declared mode name is empty or whitespace-only — such a name matches no mode block and would suppress the system fallback.'
    );
  }

  const allowlist = `[${modeNames.map(inlineLiteral).join(',')}]`;
  const record = inlineLiteral(storageKey);

  // `migrateLegacyModeKey` once per key, in order. A record that parses to
  // an object exists, so the key is only removed; otherwise a declared mode
  // becomes the record `persistColorMode` writes. Removing an absent key, or
  // a key whose value was undeclared, leaves the same storage behind.
  const migration =
    legacyKeys.length === 0
      ? ''
      : `var k=[${legacyKeys.map(inlineLiteral).join(',')}];` +
        // No raw `<`, as in the rest of the script.
        'for(var i=0;k.length>i;i++){try{' +
        `var g=localStorage,w=g.getItem(${record}),a=1;` +
        'if(w){try{var q=JSON.parse(w);' +
        'a=!(q&&typeof q==="object"&&!Array.isArray(q));}catch(e){}}' +
        'var l=a?g.getItem(k[i]):null;' +
        `if(m.indexOf(l)!==-1)g.setItem(${record},JSON.stringify({v:${RECORD_VERSION},mode:l,theme:"default"}));` +
        'g.removeItem(k[i]);' +
        '}catch(e){}}';

  const code =
    '(function(){try{' +
    `var m=${allowlist};` +
    migration +
    'var r=document.documentElement;' +
    'var v=null;' +
    `try{v=localStorage.getItem(${record});}catch(e){v=null;}` +
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
