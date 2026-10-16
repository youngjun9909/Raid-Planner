import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '이번 주 공대',
  description: '친구들의 원정대와 이번 주 클리어를 반영해 로스트아크 레이드 공대 후보를 계산해요.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=Nanum+Myeongjo:wght@700;800&display=swap';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
