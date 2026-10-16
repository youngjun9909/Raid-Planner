import type { ReactNode } from 'react';

export const metadata = { title: '레이드 파티 편성' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
