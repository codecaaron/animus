import type { ReactNode } from 'react';

import 'virtual:animus/styles.css';

export const metadata = { title: 'Animus Vinext Canary' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
