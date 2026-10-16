// عامل الخدمة لتطبيق «منسّق الخطب» (PWA)
// - الملفات الثابتة (الخطوط، الأيقونات، ملفات البناء ذات البصمة): من ذاكرة الجوال أولاً، فيفتح التطبيق أسرع
// - الصفحات: من الشبكة أولاً حتى تصل التحديثات فوراً، ومن الذاكرة عند انقطاع الإنترنت
// - طلبات الضبط والتصدير وقراءة الملفات (/api) والمقطع: لا تُخزَّن أبداً
const VERSION = 'v2'; // ارفعه عند تغيير ملفات ثابتة بالاسم نفسه (كالأيقونات)
const STATIC = `minbar-static-${VERSION}`;
const PAGES = `minbar-pages-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add('/')).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (p) =>
  p.startsWith('/_next/static/') || p.startsWith('/fonts/') || p.startsWith('/icons/') || p === '/pdf.worker.min.mjs';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/video/') || p.startsWith('/print')) return;

  if (isStatic(p)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/')) || Response.error()),
    );
  }
});
