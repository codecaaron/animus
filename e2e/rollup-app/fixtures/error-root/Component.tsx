// The error negative matches this component name and this file path in
// stderr; renaming either breaks it.
import { ds } from './ds';

export const BadGlow = ds.styles({ glow: '0 0 4px red' }).asElement('div');

export const App = () => <BadGlow>boom</BadGlow>;
