/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['puppeteer-core', 'docx', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/**': ['./data/quran.json', './public/fonts/**'],
    // ملفات Chromium المضغوطة لتوليد PDF على Vercel
    '/api/export/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
