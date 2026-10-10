/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['puppeteer-core', 'docx'],
  outputFileTracingIncludes: {
    '/api/**': ['./data/quran.json', './public/fonts/**'],
  },
};

export default nextConfig;
