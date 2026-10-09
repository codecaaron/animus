import { createRoot } from 'react-dom/client';

import { Card } from './Card';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// Read at runtime, so the prop travels through its runtime slot.
const size = window.location.hash.slice(1) || '20rem';
const tone = window.location.search.slice(1) || 'ink';
const look = window.name === 'quiet' ? undefined : 'loud';

createRoot(container).render(
  <>
    <Card capSize="dialog" tint="ink" look="loud">
      prefixed
    </Card>
    <Card capSize={size} tint={tone} look={look}>
      runtime
    </Card>
  </>
);
