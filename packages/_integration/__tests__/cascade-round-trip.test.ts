import { transform as esbuildTransform } from 'esbuild';
import { readFileSync } from 'fs';
import { transform as lcssTransform } from 'lightningcss';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { config, theme } from '../fixtures/setup';

const { analyzeProject } = require('../../extract/index.js');

const FIXTURES = join(__dirname, '../fixtures/components');

const source = readFileSync(join(FIXTURES, 'cascade-combos.tsx'), 'utf-8');
const manifestJson = analyzeProject(
  JSON.stringify([{ path: 'cascade-combos.tsx', source }]),
  theme.scalesJson,
  theme.variableMapJson,
  theme.contextualVarsJson || null,
  config.propConfig,
  config.groupRegistry,
  '{}',
  true,
  null
);
const manifest = JSON.parse(manifestJson);

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

type Side = (typeof SIDES)[number];
type CssProperty = 'padding' | 'margin';
type SideValues = Partial<Record<Side, string>>;
type CascadeCase = {
  label: string;
  binding: string;
  property: CssProperty;
  expected: SideValues;
};
type CssProcessor = {
  mode: string;
  transform: (css: string) => string | Promise<string>;
};

function getBaseCss(binding: string): string {
  const entry = Object.entries(manifest.components as Record<string, any>).find(
    ([, c]) => c.binding === binding
  );
  if (!entry) throw new Error(`Component ${binding} not found in manifest`);
  const componentId = entry[0];
  const fragment = manifest.component_fragments?.[componentId]?.base;
  if (!fragment) throw new Error(`No base fragment for ${binding}`);
  return fragment;
}

function parseSides(css: string, prop: CssProperty): SideValues {
  const result: SideValues = {};
  const declarationRe = new RegExp(
    `(?<![a-z-])${prop}(?:-(${SIDES.join('|')}))?:\\s*([^;}]+)`,
    'g'
  );
  let declaration: RegExpExecArray | null;
  while ((declaration = declarationRe.exec(css)) !== null) {
    const side = declaration[1] as Side | undefined;
    const value = declaration[2].trim();
    if (side) {
      result[side] = value;
      continue;
    }

    const parts = value.split(/\s+/);
    if (parts.length === 1) {
      result.top = result.right = result.bottom = result.left = parts[0];
    } else if (parts.length === 2) {
      result.top = result.bottom = parts[0];
      result.right = result.left = parts[1];
    } else if (parts.length === 3) {
      result.top = parts[0];
      result.right = result.left = parts[1];
      result.bottom = parts[2];
    } else {
      result.top = parts[0];
      result.right = parts[1];
      result.bottom = parts[2];
      result.left = parts[3];
    }
  }
  return result;
}

function throughLcss(css: string, minify: boolean): string {
  return lcssTransform({
    filename: 'test.css',
    code: Buffer.from(css),
    minify,
  }).code.toString();
}

// Scale reference: space.4=0.25rem, space.8=0.5rem, space.16=1rem, space.24=1.5rem

const CASCADE_CASES = [
  {
    label: 'PxPl',
    binding: 'PxPl',
    property: 'padding',
    expected: { right: '.5rem', left: '.25rem' },
  },
  {
    label: 'PyPt',
    binding: 'PyPt',
    property: 'padding',
    expected: { top: '1rem', bottom: '.5rem' },
  },
  {
    label: 'PxPyPt',
    binding: 'PxPyPt',
    property: 'padding',
    expected: {
      top: '.5rem',
      right: '.25rem',
      bottom: '.25rem',
      left: '.25rem',
    },
  },
  {
    label: 'PPx',
    binding: 'PPx',
    property: 'padding',
    expected: {
      top: '1rem',
      right: '.5rem',
      bottom: '1rem',
      left: '.5rem',
    },
  },
  {
    label: 'PPxPl',
    binding: 'PPxPl',
    property: 'padding',
    expected: {
      top: '1rem',
      right: '.5rem',
      bottom: '1rem',
      left: '.25rem',
    },
  },
  {
    label: 'PPxPyPtPb',
    binding: 'PPxPyPtPb',
    property: 'padding',
    expected: {
      top: '.25rem',
      right: '.5rem',
      bottom: '1.5rem',
      left: '.5rem',
    },
  },
  {
    label: 'MxMl',
    binding: 'MxMl',
    property: 'margin',
    expected: { right: '.5rem', left: '.25rem' },
  },
  {
    label: 'MyMt',
    binding: 'MyMt',
    property: 'margin',
    expected: { top: '1rem', bottom: '.5rem' },
  },
  {
    label: 'MMxMl',
    binding: 'MMxMl',
    property: 'margin',
    expected: {
      top: '1rem',
      right: '.5rem',
      bottom: '1rem',
      left: '.25rem',
    },
  },
] satisfies readonly CascadeCase[];

const CSS_PROCESSORS = [
  {
    mode: 'Lightning CSS minify=false',
    transform: (css) => throughLcss(css, false),
  },
  {
    mode: 'Lightning CSS minify=true',
    transform: (css) => throughLcss(css, true),
  },
  {
    mode: 'esbuild loader=css/minify=true',
    transform: async (css) =>
      (
        await esbuildTransform(css, {
          loader: 'css',
          minify: true,
        })
      ).code,
  },
] satisfies readonly CssProcessor[];

test('applies shorthand and longhand declarations in source order', () => {
  expect(parseSides('.a{padding-left:.25rem;padding:1rem}', 'padding')).toEqual(
    {
      top: '1rem',
      right: '1rem',
      bottom: '1rem',
      left: '1rem',
    }
  );
  expect(parseSides('.a{padding:1rem;padding-left:.25rem}', 'padding')).toEqual(
    {
      top: '1rem',
      right: '1rem',
      bottom: '1rem',
      left: '.25rem',
    }
  );
});

describe.each(CSS_PROCESSORS)('cascade round-trip: $mode', ({ transform }) => {
  test.each(CASCADE_CASES)(
    '$label',
    async ({ binding, property, expected }) => {
      const transformed = await transform(getBaseCss(binding));
      expect(parseSides(transformed, property)).toEqual(expected);
    }
  );
});
