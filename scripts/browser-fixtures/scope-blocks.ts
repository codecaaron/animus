/**
 * `@scope` blocks through real output: a project analyzed by the built
 * extraction engine, finalized as hosts finalize it, and matched by the
 * browser. Each expectation is what the same block nested in the component's
 * rule matches natively (CSS Cascade 6 §3.5): the rule is the scope root, a
 * limit's `&` is that root, a scoped `&` adds no specificity, and a start
 * without `&` is relative to the component. A lowering that styled the
 * component as a descendant of its own scope, bound `&` to the component
 * everywhere, or gave the scope root a specificity, changes a colour here.
 */
import {
  postProcessCss,
  resolveLightningTargets,
} from '../../packages/extract/pipeline/index';
import { createSystem, createTheme } from '../../packages/system/src/index';
import { analyzeFixture } from './analyze';

import type { FixtureCase, Probe } from './cases';

const RED = 'rgb(255, 0, 0)';
const NONE = 'rgba(0, 0, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

const SOURCE = `import { ds } from './setup';
export const Lone = ds.styles({ '@scope': { backgroundColor: 'red' } }).asElement('div');
export const Donut = ds.styles({ '@scope (&) to (& > .stop)': { '& p': { backgroundColor: 'red' } } }).asElement('div');
export const Nest = ds.styles({ '@scope (&)': { '@scope (& > .inner)': { '& p': { backgroundColor: 'red' } } } }).asElement('div');
export const Prose = ds.styles({ '@scope (.zz-prose) to ([data-prose-ignore])': { '& li': { backgroundColor: 'red' } } }).asElement('div');
export const Ranked = ds.styles({ '@scope (&)': { '& p': { backgroundColor: 'red' } } }).asElement('div');
export const App = () => <><Lone /><Donut /><Nest /><Prose /><Ranked /></>;`;

export function scopeBlockCases(root: string): FixtureCase[] {
  const manifest = analyzeFixture({
    path: 'fixtures/scope.tsx',
    source: SOURCE,
    theme: createTheme().build().serialize(),
    config: createSystem().build().seal().toConfig(),
  });
  const css = postProcessCss(manifest.css, {
    minify: true,
    targets: resolveLightningTargets(undefined, root),
  });
  const className = (binding: string): string =>
    manifest.components[`fixtures/scope.tsx::${binding}`].class_name;
  const probe = (label: string, id: string, expected: string): Probe => ({
    label,
    selector: `#${id}`,
    property: 'background-color',
    expected,
  });
  return [
    {
      name: 'an @scope block, lowered and finalized, matches as it does nested in its rule',
      css,
      body: `
        <div id="lone" class="${className('Lone')}"><p id="lone-child"></p></div>
        <div class="${className('Donut')}"><p id="donut-in"></p><div class="stop"><p id="donut-stop"></p></div><div><div class="stop"><p id="donut-deep-stop"></p></div></div></div>
        <div class="${className('Nest')}"><p id="nest-outer"></p><div class="inner"><p id="nest-inner"></p></div></div><div class="inner"><p id="nest-outside"></p></div>
        <div class="${className('Prose')}"><div class="zz-prose"><ul><li id="prose-in"></li></ul><div data-prose-ignore><ul><li id="prose-ignored"></li></ul></div></div></div><div class="zz-prose"><ul><li id="prose-outside"></li></ul></div>`,
      probes: [
        probe('a lone component root is its own scope root', 'lone', RED),
        probe('nothing below the root', 'lone-child', NONE),
        probe('a donut styles inside the scope', 'donut-in', RED),
        probe(
          'the limit `& > .stop` is the root’s own child',
          'donut-stop',
          NONE
        ),
        probe('a deeper .stop is no limit', 'donut-deep-stop', RED),
        probe('a nested scope styles inside its own root', 'nest-inner', RED),
        probe('not in the outer scope alone', 'nest-outer', NONE),
        probe('not outside the component', 'nest-outside', NONE),
        probe('a start without `&` is inside the component', 'prose-in', RED),
        probe('its limit excludes the ignored subtree', 'prose-ignored', NONE),
        probe(
          'the same start outside the component is no scope',
          'prose-outside',
          NONE
        ),
      ],
    },
    {
      name: 'a scoped `&` adds no specificity, so a later equal rule still wins',
      // Native `& p` in the scope is `:where(:scope) p`, as specific as the
      // later `p`; a lowering to `:scope p` would outrank it.
      css: `${css}@layer anm-base{@scope(.${className('Ranked')}){p{background-color:blue}}}`,
      body: `<div class="${className('Ranked')}"><p id="ranked"></p></div>`,
      probes: [
        probe('the later rule of equal specificity wins', 'ranked', BLUE),
      ],
    },
  ];
}
