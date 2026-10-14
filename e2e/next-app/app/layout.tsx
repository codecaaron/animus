import { AnimusFontPreloads } from '@animus-ui/next-plugin/font-preloads';

export const metadata = {
  title: 'Animus Next.js Test App',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AnimusFontPreloads />
        {children}
      </body>
    </html>
  );
}
