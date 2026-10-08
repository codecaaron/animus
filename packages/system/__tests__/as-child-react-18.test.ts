import type * as ReactModule from 'react';
import type * as ReactDomModule from 'react-dom';

import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it, vi } from 'vitest';

import type * as ReactDomClientModule from 'react-dom/client';

const require = createRequire(import.meta.url);

// The package's own React is 19, and the store links react-dom 18's `react`
// to it too. Resolving React 19's entry to React 18's for this file gives the
// runtime and the renderer one React 18 instance.
const react19Url = pathToFileURL(require.resolve('react')).href;
const react18Url = pathToFileURL(require.resolve('react-18')).href;
const resolveHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url === react19Url
      ? { ...resolved, url: react18Url }
      : resolved;
  },
});
afterAll(() => resolveHooks.deregister());

const React: typeof ReactModule = require('react-18');
const ReactDom: typeof ReactDomModule = require('react-dom-18');
const {
  createRoot,
}: typeof ReactDomClientModule = require('react-dom-18/client');
const { ds } = await import('./test-system');
const runtimeReact = await import('react');

const Box = ds.styles({ display: 'flex' }).asElement('div');

it('renders through React 18', () => {
  expect(React.version).toBe('18.3.1');
  expect(ReactDom.version).toBe('18.3.1');
  expect(runtimeReact.version).toBe('18.3.1');
});

it("composes the child's ref on React 18 without a React warning", () => {
  const childRef = React.createRef<HTMLElement>();
  const parentRef = React.createRef<HTMLDivElement>();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    ReactDom.flushSync(() => {
      root.render(
        React.createElement(
          Box,
          { asChild: true, ref: parentRef },
          React.createElement('output', { ref: childRef }, 'text')
        )
      );
    });
    const output = container.querySelector('output');
    expect(output).not.toBeNull();
    expect(childRef.current).toBe(output);
    expect(parentRef.current).toBe(output);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
    ReactDom.flushSync(() => root.unmount());
    container.remove();
  }
});
