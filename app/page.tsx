'use client';

import { useEffect, useRef, useState } from 'react';
import { ensureFonts, renderKhutbah } from '@/lib/render';
import { SAMPLE_TEXT, SAMPLE_TITLE } from '@/lib/sample';
import type { ColorMode, DiacriticsMode, KhutbahDoc, LayoutMode, ProcessEvent } from '@/lib/types';

type Status = { kind: 'idle' } | { kind: 'working'; done: number; total: number } | { kind: 'error'; message: string };

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-bold text-[var(--ui-muted)]">{label}</legend>
      <div className="grid gap-1 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-bg)] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`rounded-lg px-2 py-2 text-sm leading-snug transition ${
              value === o.value
                ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] shadow-sm'
                : 'text-[var(--ui-ink)] hover:bg-[var(--ui-soft)]'
            }`}
          >
            <span className="block font-bold">{o.label}</span>
            {o.hint && <span className="block text-xs opacity-80">{o.hint}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Preview({ doc, layout, color }: { doc: KhutbahDoc; layout: LayoutMode; color: ColorMode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    const el = wrap.current!;
    const pageW = layout === 'a4' ? 794 : 378;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 8) / pageW)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  useEffect(() => {
    let cancelled = false;
    ensureFonts().then(() => {
      if (!cancelled && root.current) setPages(renderKhutbah(root.current, doc, { layout, color }));
    });
    return () => {
      cancelled = true;
    };
  }, [doc, layout, color]);

  return (
    <div ref={wrap} className="kh-preview">
      <p className="mb-3 text-center text-sm text-[var(--ui-muted)]">عدد الصفحات: {pages}</p>
      <div style={{ zoom }}>
        <div ref={root} />
      </div>
    </div>
  );
}

async function download(kind: 'pdf' | 'docx', doc: KhutbahDoc, layout: LayoutMode, color: ColorMode) {
  const res = await fetch(`/api/export/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, layout, color }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'تعذّر التصدير.');
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `khutbah.${kind}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function Home() {
  const [title, setTitle] = useState('');
  const [preacher, setPreacher] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<DiacriticsMode>('full');
  const [spelling, setSpelling] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('a4');
  const [color, setColor] = useState<ColorMode>('maroon');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [doc, setDoc] = useState<KhutbahDoc | null>(null);
  const [exporting, setExporting] = useState<'' | 'pdf' | 'docx'>('');
  const [exportError, setExportError] = useState('');

  // ‎?demo يفتح مستنداً جاهزاً من public/demo/doc.json (للتجربة دون مفتاح API)
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('demo')) return;
    const name = (q.get('demo') || 'doc').replace(/[^\w-]/g, '');
    fetch(`/demo/${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: KhutbahDoc | null) => {
        if (!d) return;
        setDoc(d);
        setTitle(d.title);
        setPreacher(d.preacher ?? '');
      })
      .catch(() => undefined);
  }, []);

  const working = status.kind === 'working';
  const canSubmit = title.trim() && text.trim() && !working;

  async function process() {
    setStatus({ kind: 'working', done: 0, total: 1 });
    setDoc(null);
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title, preacher: preacher || undefined, mode, spelling }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? 'تعذّرت المعالجة.');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, nl)) as ProcessEvent;
          buf = buf.slice(nl + 1);
          if (ev.type === 'progress') setStatus({ kind: 'working', done: ev.done, total: ev.total });
          else if (ev.type === 'error') throw new Error(ev.message);
          else {
            setDoc(ev.doc);
            setStatus({ kind: 'idle' });
          }
        }
      }
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'حدث خطأ.' });
    }
  }

  async function exportFile(kind: 'pdf' | 'docx') {
    if (!doc) return;
    setExporting(kind);
    setExportError('');
    try {
      await download(kind, doc, layout, color);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'تعذّر التصدير.');
    } finally {
      setExporting('');
    }
  }

  const field =
    'w-full rounded-xl border border-[var(--ui-line)] bg-[var(--ui-card)] px-3.5 py-2.5 text-base outline-none transition focus:border-[var(--ui-accent)] focus:ring-2 focus:ring-[var(--ui-soft)]';

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ui-line)] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ui-accent)] sm:text-3xl" style={{ fontFamily: 'KhTitle, serif' }}>
            منسّق الخطب
          </h1>
          <p className="mt-1 text-sm text-[var(--ui-muted)]">
            الصق نص الخطبة كما هو، ويتولى الموقع الضبط بالشكل وتصحيح الإعراب وتحويل الآيات للرسم العثماني والتنسيق — دون تغيير أي كلمة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setTitle(SAMPLE_TITLE);
            setText(SAMPLE_TEXT);
          }}
          className="rounded-lg border border-[var(--ui-line)] px-3 py-1.5 text-sm hover:bg-[var(--ui-soft)]"
        >
          تجربة بنص نموذجي
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ========== المدخلات ========== */}
        <section className="space-y-4 rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-card)] p-4 sm:p-5 lg:sticky lg:top-4 lg:self-start">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">
                عنوان الخطبة <span className="text-[var(--ui-accent)]">*</span>
              </span>
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: فضل العشر من ذي الحجة" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">
                اسم الخطيب <span className="font-normal text-[var(--ui-muted)]">(اختياري)</span>
              </span>
              <input className={field} value={preacher} onChange={(e) => setPreacher(e.target.value)} placeholder="مثال: الشيخ عبد الله" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 flex items-baseline justify-between text-sm font-bold">
              <span>
                نص الخطبة <span className="text-[var(--ui-accent)]">*</span>
              </span>
              <span className="font-normal text-[var(--ui-muted)]">{text.trim() ? text.trim().split(/\s+/).length : 0} كلمة</span>
            </span>
            <textarea
              className={`${field} min-h-[340px] resize-y leading-8`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'الصق النص هنا بلا تشكيل…\nاكتب كل فقرة في سطر مستقل، ويمكن بدء النقاط بـ • أو -\nواكتب «الخطبة الأولى» و«الخطبة الثانية» في أسطر مستقلة.'}
            />
          </label>

          <Segmented<DiacriticsMode>
            label="كثافة التشكيل"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'full', label: 'تشكيل كامل', hint: 'كل الحروف ١٠٠٪' },
              { value: 'functional', label: 'تشكيل وظيفي', hint: 'أواخر الكلمات ومواضع اللبس' },
            ]}
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-bg)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={spelling}
              onChange={(e) => setSpelling(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--ui-accent)]"
            />
            <span className="text-sm leading-6">
              <span className="font-bold">تصحيح الإملاء والهمزات أيضاً</span>
              <span className="block text-[var(--ui-muted)]">
                مثل: «الى» تصبح «إلى»، و«كانو» تصبح «كانوا». يظهر كل تصحيح في قائمة المراجعة. اتركه لإبقاء الإملاء كما كتبته.
              </span>
            </span>
          </label>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={process}
            className="w-full rounded-xl bg-[var(--ui-accent)] px-4 py-3 text-lg font-bold text-[var(--ui-accent-ink)] shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {working ? 'جارٍ الضبط والتنسيق…' : 'اضبط الخطبة ونسّقها'}
          </button>

          {status.kind === 'working' && (
            <div aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-soft)]">
                <div
                  className="h-full rounded-full bg-[var(--ui-accent)] transition-all duration-500"
                  style={{ width: `${Math.max(6, (status.done / status.total) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-center text-sm text-[var(--ui-muted)]">
                تُعالَج الخطبة على {status.total} {status.total > 2 ? 'أجزاء' : 'جزء'} — اكتمل {status.done}. قد يستغرق ذلك دقيقة أو أكثر.
              </p>
            </div>
          )}
          {status.kind === 'error' && (
            <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {status.message}
            </p>
          )}
        </section>

        {/* ========== المعاينة والتصدير ========== */}
        <section className="min-w-0 space-y-4">
          <div className="space-y-4 rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-card)] p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Segmented<LayoutMode>
                label="المقاس"
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'a4', label: 'طباعة A4', hint: 'ورقي بهوامش متناسقة' },
                  { value: 'mobile', label: 'نسخة الجوال', hint: 'خط كبير وأسطر قصيرة' },
                ]}
              />
              <Segmented<ColorMode>
                label="الألوان"
                value={color}
                onChange={setColor}
                options={[
                  { value: 'maroon', label: 'ملوّن', hint: 'عنابي' },
                  { value: 'navy', label: 'ملوّن', hint: 'كحلي' },
                  { value: 'bw', label: 'أسود', hint: 'طباعة اقتصادية' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!doc || !!exporting}
                onClick={() => exportFile('pdf')}
                className="rounded-xl bg-[var(--ui-ink)] px-4 py-2.5 font-bold text-[var(--ui-card)] transition hover:opacity-90 disabled:opacity-40"
              >
                {exporting === 'pdf' ? 'جارٍ التجهيز…' : 'تحميل PDF'}
              </button>
              <button
                type="button"
                disabled={!doc || !!exporting}
                onClick={() => exportFile('docx')}
                className="rounded-xl border-2 border-[var(--ui-ink)] px-4 py-2.5 font-bold transition hover:bg-[var(--ui-soft)] disabled:opacity-40"
              >
                {exporting === 'docx' ? 'جارٍ التجهيز…' : 'تحميل Word'}
              </button>
            </div>
            {exportError && <p className="text-sm text-red-700 dark:text-red-300">{exportError}</p>}
          </div>

          {doc && (doc.corrections.length > 0 || doc.warnings.length > 0) && (
            <div className="space-y-3 rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-card)] p-4 sm:p-5">
              {doc.corrections.length > 0 && (
                <div>
                  <h2 className="mb-2 font-bold">التصحيحات ({doc.corrections.length})</h2>
                  <ul className="space-y-1.5 text-sm">
                    {doc.corrections.map((c, i) => (
                      <li key={i} className="rounded-lg bg-[var(--ui-bg)] px-3 py-2">
                        <span className="me-2 rounded bg-[var(--ui-soft)] px-1.5 py-0.5 text-xs font-bold">
                          {c.type === 'imla' ? 'إملائي' : 'إعرابي'}
                        </span>
                        <span className="line-through opacity-60">{c.original}</span>
                        <span className="mx-2 text-[var(--ui-muted)]">صارت</span>
                        <span className="font-bold text-[var(--ui-accent)]">{c.corrected}</span>
                        <span className="block text-xs text-[var(--ui-muted)]">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doc.warnings.length > 0 && (
                <div>
                  <h2 className="mb-2 font-bold">ملاحظات</h2>
                  <ul className="list-inside list-disc space-y-1 text-sm text-[var(--ui-muted)]">
                    {doc.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-[var(--ui-line)] bg-[color-mix(in_srgb,var(--ui-bg)_60%,#888_8%)] p-3 sm:p-5">
            {doc ? (
              <Preview doc={doc} layout={layout} color={color} />
            ) : (
              <div className="grid min-h-[420px] place-items-center text-center text-[var(--ui-muted)]">
                <div>
                  <p className="text-lg font-bold">ستظهر هنا معاينة الخطبة المنسّقة</p>
                  <p className="mt-1 text-sm">أدخل العنوان والنص ثم اضغط «اضبط الخطبة ونسّقها».</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
