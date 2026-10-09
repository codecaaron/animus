import { createRoot } from 'react-dom/client';

import { Card } from './Card';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// Read at runtime, so the prop travels through its runtime slot.
const size = window.location.hash.slice(1) || '20rem';

createRoot(container).render(
  <>
    <Card capSize="dialog" tint="ink">
      prefixed
    </Card>
    <Card capSize={size}>runtime</Card>
  </>
);
