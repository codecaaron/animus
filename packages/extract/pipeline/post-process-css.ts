/**
 * CSS post-processing (spec: css-post-processing) — Lightning CSS
 * autoprefixing, syntax lowering, and optional minification against
 * browserslist targets. The single implementation consumed by both the
 * Vite plugin (virtual-module serve time) and the Next.js plugin
 * (ExtractionSession artifact emission).
 */
import browserslist from 'browserslist';
import {
  browserslistToTargets,
  transform as lcssTransform,
} from 'lightningcss';

export type LightningTargets = ReturnType<typeof browserslistToTargets>;

/**
 * Resolve browser targets for Lightning CSS.
 * Priority: explicit config → project browserslist → 'defaults' fallback.
 */
export function resolveLightningTargets(
  explicitTargets: string | string[] | undefined,
  rootDir: string
): LightningTargets {
  let queries: string[];
  if (explicitTargets) {
    queries = Array.isArray(explicitTargets)
      ? explicitTargets
      : [explicitTargets];
  } else {
    // Auto-detect from project's browserslist config
    const detected = browserslist(undefined, { path: rootDir });
    // browserslist() with undefined query uses the project's config or defaults
    queries = detected.length > 0 ? detected : browserslist('defaults');
  }
  return browserslistToTargets(
    Array.isArray(queries) &&
      typeof queries[0] === 'string' &&
      queries[0].includes(' ')
      ? browserslist(queries)
      : (queries as ReturnType<typeof browserslist>)
  );
}

/**
 * Post-process CSS with Lightning CSS: autoprefixing + optional minification.
 * On failure, returns the original CSS and logs a warning.
 */
export function postProcessCss(
  css: string,
  opts: {
    minify: boolean;
    targets: LightningTargets;
    warnFn?: (msg: string) => void;
  }
): string {
  if (!css) return css;
  try {
    const result = lcssTransform({
      filename: 'animus-extracted.css',
      code: Buffer.from(css),
      minify: opts.minify,
      targets: opts.targets,
    });
    return result.code.toString();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Console is the pipeline's only warning sink when the caller wires no
    // logger (same exemption as engine-adapter.ts).
    // eslint-disable-next-line no-console
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
}
