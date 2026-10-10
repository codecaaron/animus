import { createElement } from 'react';

import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';

import { createComponent } from '../src';
import { ds } from './test-system';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A component definition Animus did not compile reports itself in
 * development when it renders, once, naming what it renders and the module
 * that declared it. Defining one without rendering it, and rendering a
 * compiled component, report nothing.
 */
test('an uncompiled definition reports its first render, and nothing else does', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const Button = ds.styles({ color: 'red' }).asElement('button');
  ds.styles({ color: 'blue' }).asElement('span');
  const label = ds.styles({ display: 'block' }).asClass();
  const Compiled = createComponent('div', 'animus-Box-0f0f0f0f', {});
  expect(warn).not.toHaveBeenCalled();

  renderToString(createElement(Compiled, null));
  expect(warn).not.toHaveBeenCalled();

  renderToString(createElement(Button, null, 'one'));
  renderToString(createElement(Button, null, 'two'));
  label();
  const messages = warn.mock.calls.map(([message]) => String(message));
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatch(
    /^\[animus:uncompiled\] <button> declared in \S+uncompiled-render\.test\.tsx:\d+:\d+ rendered without Animus compiling it/
  );
  expect(messages[0]).toContain('Add the Animus plugin');
  expect(messages[1]).toMatch(
    /^\[animus:uncompiled\] a class resolver declared in \S+uncompiled-render\.test\.tsx/
  );
});
