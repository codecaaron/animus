import { createRoot } from 'react-dom/client';

import { Card } from './Card';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(<Card capSize="dialog">prefixed</Card>);
