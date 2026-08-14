import { render } from 'svelte/server';

import App from './App.svelte';

export const renderedHtml = render(App, {
  props: {
    dynamicTone: 'urgent',
    gap: '13px',
  },
}).body;
