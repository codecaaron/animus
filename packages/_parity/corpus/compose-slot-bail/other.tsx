// A same-named Header exists in the universe — under the retired bare-name
// scheme the unresolvable slot below could silently bind to THIS component.
import { ds } from '../test-system';

export const Header = ds
  .styles({ fontSize: 14 })
  .variant({
    prop: 'density',
    variants: { compact: { m: 2 }, loose: { m: 8 } },
  })
  .asElement('header');

export const OtherApp = () => <Header density="compact" />;
