import { ds } from '../../ds';

/**
 * Minimal wrapper with system arrange group for responsive display toggling.
 * Use to wrap composed slots where system props don't extract on member
 * expression JSX (e.g., <NavBar.Root display={...}> won't extract).
 *
 * Instead: <Responsive display={{ _: 'none', md: 'flex' }}><NavBar.Root>...</NavBar.Root></Responsive>
 */
export const Responsive = ds
  .styles({})
  .system({ arrange: true })
  .asElement('div');
