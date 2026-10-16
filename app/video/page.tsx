import type { Metadata } from 'next';

// صفحة مستقلة للمقطع التعريفي: لا يُحمَّل المقطع إلا لمن يفتحها، فلا تتأثر سرعة الصفحة الرئيسة
export const metadata: Metadata = {
  title: 'كيف يعمل منسّق الخطب — مقطع تعريفي',
  description: 'مقطع قصير يشرح منسّق الخطب: ألصق خطبتك، فتُضبط بالشكل ويُصحَّح إعرابها وتُنسَّق للطباعة والجوال.',
};

const logo = (
  <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="currentColor" />
    <path d="M10 25V14l6-5 6 5v11" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M13 25v-6h6v6M8 25h16" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="16" cy="13.5" r="1.4" fill="#e9c98f" />
  </svg>
);

export default function VideoPage() {
  return (
    <div className="ui-pattern min-h-screen">
      <header className="border-b border-[var(--ui-line)] bg-[color-mix(in_srgb,var(--ui-bg)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="h-9 w-9 text-[var(--ui-accent)]">{logo}</span>
            <span className="text-lg font-bold tracking-tight">منسّق الخطب</span>
          </a>
          <a
            href="/"
            className="rounded-full border border-[var(--ui-line)] bg-[var(--ui-card)] px-4 py-2 text-sm font-medium transition hover:border-[var(--ui-accent)] hover:text-[var(--ui-accent)]"
          >
            → العودة إلى الموقع
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1320px] flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-center text-2xl font-bold leading-snug sm:text-4xl">
          كيف يعمل <span className="text-[var(--ui-accent)]">منسّق الخطب</span>؟
        </h1>
        <p className="mt-3 max-w-xl text-center text-[15px] leading-7 text-[var(--ui-muted)] sm:text-base">
          مقطع قصير (أقل من دقيقة) يريك الطريقة من لصق الخطبة إلى تحميلها منسّقةً.
        </p>

        <div className="mt-7 w-full max-w-[420px] overflow-hidden rounded-[28px] border border-[var(--ui-line)] bg-black shadow-[var(--ui-shadow)]">
          <video
            className="block aspect-[9/16] w-full"
            src="/video/minbar.mp4"
            poster="/video/poster.jpg"
            controls
            playsInline
            preload="metadata"
          />
        </div>

        <a
          href="/"
          className="ui-btn-primary mt-8 flex w-full max-w-[420px] items-center justify-center gap-2 rounded-2xl px-4 py-4 text-lg font-bold"
        >
          جرّب الموقع الآن مجاناً
        </a>
      </main>
    </div>
  );
}
