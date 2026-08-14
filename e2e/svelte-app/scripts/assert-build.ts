import {
  AssertionError,
  findJsFiles,
  readAllConcat,
  readRequiredCss,
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_ROOT = resolve(APP_ROOT, 'dist/client');
const SSR_ENTRY = resolve(APP_ROOT, 'dist/server/ssr.js');

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

function markedTag(html: string, element: string, probe: string): string {
  const match = html.match(
    new RegExp(`<${element}\\b[^>]*\\bdata-animus-probe=["']${probe}["'][^>]*>`)
  );
  if (!match) {
    throw new AssertionError(
      `SSR output has no <${element}> marked data-animus-probe="${probe}"`
    );
  }
  return match[0];
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`));
  if (!match) {
    throw new AssertionError(`Marked SSR element has no ${name} attribute`, {
      tag,
    });
  }
  return match[1];
}

function classToken(tag: string, pattern: RegExp, label: string): string {
  const tokens = attribute(tag, 'class').split(/\s+/);
  const matches = tokens.filter((token) => pattern.test(token));
  if (matches.length !== 1) {
    throw new AssertionError(
      `Expected one ${label} class on marked SSR element, found ${matches.length}`,
      { tag, matches }
    );
  }
  return matches[0];
}

function ruleBody(css: string, selector: string): string | undefined {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return undefined;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function assertFrameworkNeutralArtifact(
  label: string,
  javascript: string
): void {
  const forbidden = [
    ['React module import', /\bfrom\s*["']react(?:\/[^"']*)?["']/],
    ['React require', /\brequire\(\s*["']react(?:\/[^"']*)?["']\s*\)/],
    ['React JSX runtime', /react\/jsx-runtime/],
    ['React production runtime', /react\.production(?:\.min)?\.js/],
    ['React development runtime', /react\.development\.js/],
    ['React element symbol', /Symbol\.for\(["']react\./],
    ['React component API', /\b(?:forwardRef|cloneElement|isValidElement)\b/],
    ['createSystem builder', /\bcreateSystem\b/],
    ['createTheme builder', /\bcreateTheme\b/],
  ] as const;

  for (const [signature, pattern] of forbidden) {
    expect(
      !pattern.test(javascript),
      `${label} must omit ${signature} (${pattern})`
    );
  }
}

async function main(): Promise<void> {
  const css = await readRequiredCss(CLIENT_ROOT, 'Svelte canary client output');
  const clientJsFiles = await findJsFiles(CLIENT_ROOT);
  expect(
    clientJsFiles.length > 0,
    'Svelte canary client output must contain JavaScript'
  );
  const clientJavascript = await readAllConcat(clientJsFiles);
  const ssrJavascript = await readFile(SSR_ENTRY, 'utf8');
  assertFrameworkNeutralArtifact('Client JavaScript', clientJavascript);
  assertFrameworkNeutralArtifact('SSR JavaScript', ssrJavascript);

  const manifest = JSON.parse(
    await readFile(resolve(APP_ROOT, 'package.json'), 'utf8')
  ) as Record<string, Record<string, string> | undefined>;
  expect(
    manifest.devDependencies?.['@types/react'] === '18.3.28',
    'Svelte canary must pin exact @types/react for the strict declaration closure (DEF-2)'
  );
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const) {
    expect(
      manifest[field]?.react == null,
      `Svelte canary must not declare React in ${field} (G1: React-absent authoring)`
    );
  }

  const ssrModule = (await import(pathToFileURL(SSR_ENTRY).href)) as {
    renderedHtml?: unknown;
  };
  expect(
    typeof ssrModule.renderedHtml === 'string',
    'SSR artifact must export renderedHtml as a string'
  );
  const html = ssrModule.renderedHtml;

  const literalTag = markedTag(html, 'p', 'literal');
  const literalBase = classToken(
    literalTag,
    /^animus-literalNotice-[a-f0-9]+$/,
    'literalNotice base'
  );
  const literalQuiet = `${literalBase}--tone-quiet`;
  expect(
    attribute(literalTag, 'class').split(/\s+/).includes(literalQuiet),
    `Literal SSR element must carry selected class ${literalQuiet}`
  );
  expect(
    compact(ruleBody(css, `.${literalQuiet}`) ?? '').includes(
      'border-style:solid'
    ),
    `Client CSS must bind ${literalQuiet} to border-style: solid`
  );
  expect(
    ruleBody(css, `.${literalBase}--tone-loud`) === undefined,
    `Client CSS must prune unselected ${literalBase}--tone-loud`
  );

  const dynamicTag = markedTag(html, 'section', 'dynamic');
  const dynamicBase = classToken(
    dynamicTag,
    /^animus-dynamicNotice-[a-f0-9]+$/,
    'dynamicNotice base'
  );
  const dynamicHash = dynamicBase.slice('animus-dynamicNotice-'.length);
  const gapClass = classToken(
    dynamicTag,
    /^animus-dyn-[a-f0-9]+-gap$/,
    'dynamicNotice gap'
  );
  expect(
    gapClass === `animus-dyn-${dynamicHash}-gap`,
    `Rendered gap class ${gapClass} must belong to ${dynamicBase}`
  );

  const dynamicStyle = attribute(dynamicTag, 'style');
  expect(
    /(?:^|;)\s*--animus-gap:\s*13px(?:;|$)/.test(dynamicStyle),
    `Marked dynamic SSR element must carry --animus-gap: 13px; got ${dynamicStyle}`
  );
  expect(
    compact(ruleBody(css, `.${gapClass}`) ?? '').includes(
      'gap:var(--animus-gap)'
    ),
    `Client CSS must contain exact rendered selector .${gapClass} with gap: var(--animus-gap)`
  );

  const calmClass = `${dynamicBase}--tone-calm`;
  const urgentClass = `${dynamicBase}--tone-urgent`;
  expect(
    compact(ruleBody(css, `.${calmClass}`) ?? '').includes(
      'outline-style:solid'
    ),
    `Dynamic client CSS must retain ${calmClass}`
  );
  expect(
    compact(ruleBody(css, `.${urgentClass}`) ?? '').includes(
      'outline-style:dashed'
    ),
    `Dynamic client CSS must retain ${urgentClass}`
  );
  expect(
    attribute(dynamicTag, 'class').split(/\s+/).includes(urgentClass),
    `Dynamic SSR element must carry runtime-selected class ${urgentClass}`
  );

  const unusedOffsetClass = `.animus-dyn-${dynamicHash}-offset`;
  expect(
    ruleBody(css, unusedOffsetClass) === undefined &&
      !css.includes('--animus-offset'),
    `Unused custom prop must not emit ${unusedOffsetClass} or --animus-offset`
  );
  expect(
    !attribute(dynamicTag, 'class')
      .split(/\s+/)
      .includes(unusedOffsetClass.slice(1)) &&
      !dynamicStyle.includes('--animus-offset'),
    'Unused custom prop must not appear in marked SSR runtime attributes'
  );

  console.log(
    `[svelte-app:assert] client CSS and SSR runtime matched ${gapClass}; literal loud, dynamic offset, React runtime, and builder code were absent from production artifacts`
  );
}

await main();
