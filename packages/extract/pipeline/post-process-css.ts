import browserslist from 'browserslist';
import {
  browserslistToTargets,
  transform as lcssTransform,
} from 'lightningcss';

export type LightningTargets = ReturnType<typeof browserslistToTargets>;

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
    const detected = browserslist(undefined, { path: rootDir });
    queries = detected.length > 0 ? detected : browserslist('defaults');
  }
  // A query ('last 2 versions') carries a space; an already-resolved browser
  // id never does, so it passes through unresolved.
  const [firstQuery] = queries;
  return browserslistToTargets(
    firstQuery !== undefined && firstQuery.includes(' ')
      ? browserslist(queries)
      : queries
  );
}

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
    // eslint-disable-next-line no-console
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
}
