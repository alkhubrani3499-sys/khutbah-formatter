import type { MetadataRoute } from 'next';

// تعريف التطبيق (PWA): يُثبَّت من المتصفح على الأندرويد والآيفون ويفتح بملء الشاشة
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'منسّق الخطب',
    short_name: 'منسّق الخطب',
    description: 'ضبط خطب الجمعة بالشكل وتصحيح إعرابها وتنسيقها للطباعة والجوال.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    categories: ['education', 'productivity', 'books'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
