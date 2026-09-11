import { ANIMUS_CSS_MODULE_ID } from '@animus-ui/extract/session';

export interface LoaderPolicyOptions {
  strict?: boolean;
  cssImportTarget?: string;
}

export interface LoaderContextBase<
  O extends LoaderPolicyOptions = LoaderPolicyOptions,
> {
  resourcePath: string;
  rootContext: string;
  getOptions: () => O;
  addDependency?: (file: string) => void;
}

const CSS_IMPORT_RE =
  /import\s+['"](?:[^'"]*\.animus\/styles\.css|virtual:animus\/styles\.css)['"];\n?/g;

const CSS_IMPORT_STATEMENT = `import '${ANIMUS_CSS_MODULE_ID}';\n`;

const ROOT_ENTRY_RE = /^(src\/)?(?:app\/layout|pages\/_app)\.[tj]sx?$/;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isCssImportTarget(
  filename: string,
  cssImportTarget: string | undefined
): boolean {
  const normalized = normalizePath(filename);
  if (cssImportTarget) {
    return normalized === normalizePath(cssImportTarget);
  }
  return ROOT_ENTRY_RE.test(normalized);
}

export function transformWithManifest(args: {
  source: string;
  /** Project-root-relative path of the file being transformed. */
  filename: string;
  manifestJson: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any;
  opts: LoaderPolicyOptions;
}): string {
  const { source, filename, manifestJson, engineApi, opts } = args;
  const isRootEntry = isCssImportTarget(filename, opts.cssImportTarget);

  try {
    const { transformFile } = engineApi();

    const result = transformFile(source, filename, manifestJson);

    let code = result.hasComponents ? result.code : source;

    code = code.replace(CSS_IMPORT_RE, '');

    if (isRootEntry && !code.includes(ANIMUS_CSS_MODULE_ID)) {
      if (code.startsWith("'use client'") || code.startsWith('"use client"')) {
        const nl = code.indexOf('\n');
        if (nl === -1) {
          code = `${code}\n${CSS_IMPORT_STATEMENT}`;
        } else {
          code = `${code.slice(0, nl + 1)}${CSS_IMPORT_STATEMENT}${code.slice(nl + 1)}`;
        }
      } else {
        code = `${CSS_IMPORT_STATEMENT}${code}`;
      }
    }

    return code;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (opts.strict) {
      throw new Error(
        `[animus-extract] Transform failed for ${filename}: ${msg}`,
        { cause: e }
      );
    }

    console.warn(`[animus-extract] Transform failed for ${filename}:`, msg);
    return source;
  }
}
