import { bindComponentProvider } from '@animus/provider';
import { Anchor } from '@animus/elements';

export const {
  ComponentProvider,
  useComponent,
  registry: { Link },
} = bindComponentProvider({
  Link: Anchor,
});
