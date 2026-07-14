// @vitest-environment happy-dom

import { act, createElement } from 'react';

import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import ClientRoute from '../app/routes/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('React Router client hydration', () => {
  let root: ReturnType<typeof hydrateRoot> | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it('advances state without navigation', async () => {
    history.replaceState(null, '', '/client');
    const initialUrl = window.location.href;
    const container = document.createElement('main');
    container.innerHTML = renderToString(createElement(ClientRoute));
    document.body.append(container);
    await act(async () => {
      root = hydrateRoot(container, createElement(ClientRoute));
    });
    const button = container.querySelector('button');
    const panel = container.querySelector('section');
    expect(button?.textContent).toContain('Intent: primary');
    expect(panel?.textContent).toContain('Hydrated count: 0');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(button?.textContent).toContain('Intent: danger');
    expect(panel?.textContent).toContain('Hydrated count: 1');
    expect(window.location.href).toBe(initialUrl);
  });
});
