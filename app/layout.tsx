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
  applicationName: 'منسّق الخطب',
  // الآيفون: يفتح من الشاشة الرئيسية بملء الشاشة وبأيقونة المنبر
  appleWebApp: { capable: true, title: 'منسّق الخطب', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d1117',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={ui.variable}>
      <body>{children}</body>
    </html>
  );
}
