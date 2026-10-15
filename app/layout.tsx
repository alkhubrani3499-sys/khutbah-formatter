import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';

// خط الواجهة (يُنزَّل وقت البناء ويُخدَم من الموقع نفسه)
const ui = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'منسّق الخطب — ضبط خطب الجمعة وتنسيقها',
  description: 'ألصق نص الخطبة أو ارفع ملفها، فيُضبط بالشكل ويُصحَّح إعرابه وإملاؤه وتُحوَّل آياته للرسم العثماني، ثم حمّله PDF أو Word للطباعة والجوال — مجاناً.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f4ef' },
    { media: '(prefers-color-scheme: dark)', color: '#14110f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={ui.variable}>
      <body>{children}</body>
    </html>
  );
}
