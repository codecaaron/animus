// Renders both families so usage scanning sees each family's slots under
// its own module identity.
import { FamOne } from './one';
import { FamTwo } from './two';

export const App = () => (
  <>
    <FamOne.Root density="compact">
      <FamOne.Header />
    </FamOne.Root>
    <FamTwo.Root density="loose">
      <FamTwo.Header />
    </FamTwo.Root>
  </>
);
