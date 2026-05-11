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

function parseSides(
  css: string,
  prop: 'padding' | 'margin'
): Record<string, string> {
  const result: Record<string, string> = {};
  const shortRe = new RegExp(`(?<![a-z-])${prop}:\\s*([^;}]+)`, 'g');
  let shorthand: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = shortRe.exec(css)) !== null) shorthand = match;
  if (shorthand) {
    const parts = shorthand[1].trim().split(/\s+/);
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
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const m = css.match(new RegExp(`${prop}-${side}:\\s*([^;}]+)`));
    if (m) result[side] = m[1].trim();
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

describe('cascade round-trip: padding combos', () => {
  test('px:8 + pl:4 → padding-left from pl wins', () => {
    const css = getBaseCss('PxPl');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.left).toBe('.25rem');
    expect(p.right).toBe('.5rem');
  });

  test('py:8 + pt:16 → padding-top from pt wins', () => {
    const css = getBaseCss('PyPt');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.top).toBe('1rem');
    expect(p.bottom).toBe('.5rem');
  });

  test('px:4 + py:4 + pt:8 → padding-top from pt wins', () => {
    const css = getBaseCss('PxPyPt');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.top).toBe('.5rem');
    expect(p.left).toBe('.25rem');
    expect(p.right).toBe('.25rem');
    expect(p.bottom).toBe('.25rem');
  });

  test('p:16 + px:8 → left/right from px wins', () => {
    const css = getBaseCss('PPx');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.top).toBe('1rem');
    expect(p.bottom).toBe('1rem');
    expect(p.left).toBe('.5rem');
    expect(p.right).toBe('.5rem');
  });

  test('p:16 + px:8 + pl:4 → padding-left from pl wins', () => {
    const css = getBaseCss('PPxPl');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.top).toBe('1rem');
    expect(p.bottom).toBe('1rem');
    expect(p.right).toBe('.5rem');
    expect(p.left).toBe('.25rem');
  });

  test('p:16 + px:8 + py:8 + pt:4 + pb:24 → all tiers', () => {
    const css = getBaseCss('PPxPyPtPb');
    const lcss = throughLcss(css, false);
    const p = parseSides(lcss, 'padding');
    expect(p.left).toBe('.5rem');
    expect(p.right).toBe('.5rem');
    expect(p.top).toBe('.25rem');
    expect(p.bottom).toBe('1.5rem');
  });
});

describe('cascade round-trip: margin combos', () => {
  test('mx:8 + ml:4 → margin-left from ml wins', () => {
    const css = getBaseCss('MxMl');
    const lcss = throughLcss(css, false);
    const m = parseSides(lcss, 'margin');
    expect(m.left).toBe('.25rem');
    expect(m.right).toBe('.5rem');
  });

  test('my:8 + mt:16 → margin-top from mt wins', () => {
    const css = getBaseCss('MyMt');
    const lcss = throughLcss(css, false);
    const m = parseSides(lcss, 'margin');
    expect(m.top).toBe('1rem');
    expect(m.bottom).toBe('.5rem');
  });

  test('m:16 + mx:8 + ml:4 → margin-left from ml wins', () => {
    const css = getBaseCss('MMxMl');
    const lcss = throughLcss(css, false);
    const m = parseSides(lcss, 'margin');
    expect(m.top).toBe('1rem');
    expect(m.bottom).toBe('1rem');
    expect(m.right).toBe('.5rem');
    expect(m.left).toBe('.25rem');
  });
});

describe('cascade round-trip: esbuild parity', () => {
  test('esbuild minify produces same computed values as Lightning CSS', async () => {
    const css = getBaseCss('PPxPl');
    const lcss = throughLcss(css, true);
    const esbuildResult = await esbuildTransform(css, {
      loader: 'css',
      minify: true,
    });
    const lcssP = parseSides(lcss, 'padding');
    const esbuildP = parseSides(esbuildResult.code, 'padding');
    expect(lcssP.top).toBe(esbuildP.top);
    expect(lcssP.right).toBe(esbuildP.right);
    expect(lcssP.bottom).toBe(esbuildP.bottom);
    expect(lcssP.left).toBe(esbuildP.left);
  });
});
