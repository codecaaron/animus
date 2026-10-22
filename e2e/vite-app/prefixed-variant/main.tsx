import { createRoot } from 'react-dom/client';

import { Card } from './Card';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// Read at runtime, so the prop travels through its runtime slot (a
// conditional of literals alone is proven, and compiles away).
const size = window.location.hash.slice(1) || '20rem';
const tone = window.location.search.slice(1) || 'ink';
const isLook = (value: string): value is 'loud' => value === 'loud';
const lookName = window.name === 'quiet' ? '' : window.name || 'loud';
const look = isLook(lookName) ? lookName : undefined;

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
