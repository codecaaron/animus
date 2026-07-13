// Route segment component — directive intentionally preceded by this comment.
'use client';
import { ds } from '../test-system';

export const Panel = ds.styles({ display: 'flex', p: 12 }).asElement('div');

export const App = () => <Panel p={16} />;
