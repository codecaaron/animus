import { mount } from 'svelte';

import App from './App.svelte';

const target = document.querySelector('#app');

if (!(target instanceof HTMLElement)) {
  throw new Error('Svelte canary mount target is missing');
}

mount(App, {
  target,
  props: {
    dynamicTone: 'urgent',
    gap: '13px',
  },
});
