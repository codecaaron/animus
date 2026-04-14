import { Anchor } from '../elements';
import { bindComponentProvider } from './bindComponentProvider';

export const {
  ComponentProvider,
  useComponent,
  registry: { Link },
} = bindComponentProvider({
  Link: Anchor,
});
