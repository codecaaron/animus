// The component whose static `glow` value drives the bad transform — the
// extraction-error negative asserts the failure names THIS component and
// file on stderr.
import { ds } from './ds';

export const BadGlow = ds.styles({ glow: '0 0 4px red' }).asElement('div');

export const App = () => <BadGlow>boom</BadGlow>;
