import type { ReactNode } from 'react';

export const metadata = {
  title: 'fianto Next.js example',
  description: 'App Router example: fianto checkout and webhooks.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
