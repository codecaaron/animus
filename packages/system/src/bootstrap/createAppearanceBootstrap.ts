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
}

export interface AppearanceBootstrapArtifact {
  code: string;
  cspHash: string;
}

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
  const { storageKey = DEFAULT_STORAGE_KEY } = options;

  if (typeof storageKey !== 'string' || storageKey === '') {
    throw new Error(
      'createAppearanceBootstrap: storageKey must be a non-empty string.'
    );
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
