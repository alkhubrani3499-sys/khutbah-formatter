'use client';

import { useEffect, useRef, useState } from 'react';
import { ensureFonts, renderKhutbah } from '@/lib/render';
import { SAMPLE_TEXT, SAMPLE_TITLE } from '@/lib/sample';
import InstallApp from './install-app';
import type { ColorMode, DiacriticsMode, KhutbahDoc, LayoutMode, ProcessEvent } from '@/lib/types';

type Status = { kind: 'idle' } | { kind: 'working'; done: number; total: number } | { kind: 'error'; message: string };

// ===================== أيقونات =====================
const Icon = {
  upload: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 15V4m0 0L8 8m4-4l4 4M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 20 20" className="h-4 w-4 flex-none" fill="currentColor" aria-hidden="true">
      <path d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" strokeLinejoin="round" />
      <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  ),
  sparkle: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  ),
};

// ===================== مكوّنات صغيرة =====================
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
      <legend className="mb-2 text-[13px] font-semibold text-[var(--ui-muted)]">{label}</legend>
      <div
        className="grid gap-1 rounded-2xl bg-[var(--ui-bg-2)] p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className={`rounded-xl px-2 py-2.5 text-sm leading-snug transition ${
                on
                  ? 'bg-[var(--ui-card)] text-[var(--ui-accent)] shadow-[0_1px_3px_rgba(0,0,0,.12)]'
                  : 'text-[var(--ui-muted)] hover:text-[var(--ui-ink)]'
              }`}
            >
              <span className="block font-semibold">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-[11.5px] opacity-80">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function StepTitle({ n, children, aside }: { n: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-lg font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--ui-soft)] text-sm font-bold text-[var(--ui-accent)]">
          {n}
        </span>
        {children}
      </h2>
      {aside}
    </div>
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
      <p className="mb-4 text-center text-[13px] font-medium text-[var(--ui-muted)]">
        {pages ? `${pages} ${pages > 2 && pages < 11 ? 'صفحات' : 'صفحة'}` : '…'}
      </p>
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

// مدة الإلقاء التقريبية: نحو ١٤٠ كلمة في الدقيقة (قياساً: خطبة من ١١٣٠ كلمة أُلقيت في ٨ دقائق)،
// مع دقيقتين احتياطاً لمن هو أبطأ إلقاءً
const WORDS_PER_MINUTE = 140;
const EXTRA_MINUTES = 2;
function speechTime(words: number): string {
  const base = Math.round(words / WORDS_PER_MINUTE);
  if (base < 1) return 'أقل من دقيقة إلقاءً';
  const m = base + EXTRA_MINUTES;
  if (m === 1) return 'نحو دقيقة إلقاءً';
  if (m === 2) return 'نحو دقيقتين إلقاءً';
  const n = m.toLocaleString('ar-SA');
  return `نحو ${n} ${m <= 10 ? 'دقائق' : 'دقيقة'} إلقاءً`;
}

const FEATURES = ['تشكيل كامل أو وظيفي', 'تصحيح الإعراب والإملاء', 'تقدير مدة إلقاء الخطبة', 'الآيات بالرسم العثماني', 'PDF و Word للطباعة والجوال'];

// ===================== الصفحة =====================
export default function Home() {
  const [title, setTitle] = useState('');
  const [preacher, setPreacher] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<DiacriticsMode>('full');
  const [spelling, setSpelling] = useState(true);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadedNote, setUploadedNote] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('a4');
  const [color, setColor] = useState<ColorMode>('maroon');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [doc, setDoc] = useState<KhutbahDoc | null>(null);
  const [exporting, setExporting] = useState<'' | 'pdf' | 'docx'>('');
  const [exportError, setExportError] = useState('');
  const resultRef = useRef<HTMLElement>(null);

  async function onFile(file: File) {
    setUploadError('');
    setUploadedNote(false);
    if (file.size > 40 * 1024 * 1024) {
      setUploadError('حجم الملف كبير جداً (الحد 40 ميغابايت).');
      return;
    }
    if (text.trim() && !confirm('سيُستبدل النص الموجود في الخانة بنص الملف. هل تريد المتابعة؟')) return;
    setUploadMsg('جارٍ قراءة الملف…');
    try {
      const { extractFile } = await import('@/lib/upload');
      const out = await extractFile(file, setUploadMsg);
      if (!out.text.trim()) throw new Error('لم يُعثر على نص في الملف.');
      setText(out.text);
      if (!title.trim()) setTitle(out.title || file.name.replace(/\.[^.]+$/, ''));
      setUploadedNote(true);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'تعذّرت قراءة الملف.');
    } finally {
      setUploadMsg('');
    }
  }

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
  // بصمة ما يحتاج إعادة ضبط: النص وكثافة التشكيل وخيار الإملاء (العنوان واسم الخطيب يُحدَّثان مباشرة دون ضبط)
  const processKey = `${mode}|${spelling}\n${text.trim()}`;
  const [doneKey, setDoneKey] = useState('');
  const alreadyDone = !!doc && doneKey === processKey;
  const canSubmit = title.trim() && text.trim() && !working && !uploadMsg && !alreadyDone;

  // تعديل العنوان أو اسم الخطيب بعد الضبط: تحديث المعاينة والملفات مباشرة ومجاناً
  useEffect(() => {
    setDoc((d) => {
      if (!d) return d;
      const t = title.trim() || d.title;
      const p = preacher.trim() || undefined;
      return d.title === t && d.preacher === p ? d : { ...d, title: t, preacher: p };
    });
  }, [title, preacher]);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function process() {
    const key = processKey;
    setStatus({ kind: 'working', done: 0, total: 1 });
    setDoc(null);
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // الإملاء والهمزات تُصحَّح دائماً (يظهر كل تصحيح في قائمة المراجعة)
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
            setDoneKey(key);
            setStatus({ kind: 'idle' });
            // على الجوال: الانتقال إلى النتيجة
            if (window.innerWidth < 1024) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
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
    'w-full rounded-xl border border-[var(--ui-line)] bg-[var(--ui-card)] px-4 py-3 text-[15px] outline-none transition placeholder:text-[var(--ui-muted)]/70 focus:border-[var(--ui-accent)] focus:ring-4 focus:ring-[var(--ui-soft)]';

  return (
    <div className="min-h-screen">
      {/* ========== الشريط العلوي ========== */}
      <header className="sticky top-0 z-30 border-b border-[var(--ui-line)] bg-[color-mix(in_srgb,var(--ui-bg)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-[10px]" />
            <span className="text-lg font-bold tracking-tight">منسّق الخطب</span>
          </a>
          <a
            href="/video"
            className="flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--ui-accent)_40%,transparent)] bg-[var(--ui-card)] px-4 py-2 text-sm font-semibold text-[var(--ui-accent)] transition hover:bg-[var(--ui-soft)]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 flex-none" fill="currentColor" aria-hidden="true">
              <path d="M6.3 4.2A1 1 0 004.8 5v10a1 1 0 001.5.8l8.2-5a1 1 0 000-1.7l-8.2-5z" />
            </svg>
            شاهد كيف يعمل
          </a>
        </div>
      </header>
      <InstallApp />

      {/* ========== الترحيب ========== */}
      <section className="ui-pattern border-b border-[var(--ui-line)]">
        <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <h1 className="text-3xl font-bold leading-[1.35] sm:text-[2.6rem]">
              خطبتك منسّقةٌ،{' '}
              <span className="bg-gradient-to-l from-[var(--ui-accent)] to-[var(--ui-gold)] bg-clip-text text-transparent">
                جاهزةٌ للمنبر
              </span>
            </h1>
            <button
              type="button"
              onClick={() => {
                setTitle(SAMPLE_TITLE);
                setText(SAMPLE_TEXT);
                setUploadedNote(false);
              }}
              className="rounded-full border border-[color-mix(in_srgb,var(--ui-accent)_40%,transparent)] bg-[var(--ui-card)] px-5 py-2.5 text-sm font-bold text-[var(--ui-accent)] shadow-[var(--ui-shadow)] transition hover:bg-[var(--ui-soft)] sm:text-base"
            >
              اضغط هنا لتجربة نص نموذجي
            </button>
          </div>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--ui-muted)] sm:text-lg">
            ألصق نص الخطبة أو ارفع ملفها، ويتولى الموقع الضبط بالشكل، وتصحيح الإعراب والإملاء، وتحويل الآيات إلى الرسم
            العثماني، والتنسيق للطباعة والجوال.
          </p>
          {/* الميزة الأهم: سلامة النص */}
          <div className="mt-6 flex w-full max-w-xl items-center justify-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--ui-accent)_30%,transparent)] bg-[var(--ui-card)] px-6 py-3.5 text-base font-bold text-[var(--ui-accent)] shadow-[var(--ui-shadow)] sm:text-lg">
            {Icon.shield}
            دون تغيير أي كلمة من نصك
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5 text-sm font-medium">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--ui-ok-soft)] text-[var(--ui-ok)]">
                  {Icon.check}
                </span>
                {f}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-10 max-w-3xl text-center text-lg leading-9 text-[var(--ui-muted)] sm:text-2xl sm:leading-[1.8]">
            صُمِّم هذا الموقع امتثالاً لقوله ﷺ:{' '}
            <span className="font-bold text-[var(--ui-gold)]">«والله في عون العبد ما كان العبد في عون أخيه»</span>{' '}
            <span className="whitespace-nowrap text-base sm:text-lg">رواه مسلم</span>
          </p>
        </div>
      </section>

      <main className="mx-auto grid max-w-[1320px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-10">
        {/* ========== ١) الخطبة ========== */}
        <section className="ui-card p-5 sm:p-7 lg:sticky lg:top-24 lg:self-start">
          <StepTitle n="١">الخطبة</StepTitle>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">
                عنوان الخطبة <span className="text-[var(--ui-accent)]">*</span>
              </span>
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: فضل العشر من ذي الحجة" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">
                اسم الخطيب <span className="font-normal text-[var(--ui-muted)]">(اختياري)</span>
              </span>
              <input className={field} value={preacher} onChange={(e) => setPreacher(e.target.value)} placeholder="مثال: الشيخ عبد الله" />
            </label>
          </div>

          <label className="mt-5 block">
            <span className="mb-2 flex items-baseline justify-between text-sm font-semibold">
              <span>
                نص الخطبة <span className="text-[var(--ui-accent)]">*</span>
              </span>
              <span className="text-[13px] font-normal text-[var(--ui-muted)]">
                {wordCount.toLocaleString('ar-SA')} كلمة
                {wordCount > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-[var(--ui-gold)]">{speechTime(wordCount)}</span>
                  </>
                )}
              </span>
            </span>
            <textarea
              className={`${field} min-h-[320px] resize-y leading-8 ${dragging ? 'border-[var(--ui-accent)] ring-4 ring-[var(--ui-soft)]' : ''}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setDragging(true);
                }
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0];
                setDragging(false);
                if (f) {
                  e.preventDefault();
                  void onFile(f);
                }
              }}
              disabled={!!uploadMsg}
              placeholder={'ألصق نص الخطبة هنا…\nأو ارفع ملف الخطبة (PDF أو Word) بالزر أدناه أو اسحبه إلى هنا.\nيُفضَّل يا فضلاء كتابة كل فقرة في سطر مستقل.'}
            />
          </label>

          {/* رفع ملف */}
          <label
            className={`mt-3 flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-[var(--ui-line)] px-4 py-3.5 transition hover:border-[var(--ui-accent)] hover:bg-[var(--ui-soft)] ${
              uploadMsg ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[var(--ui-soft)] text-[var(--ui-accent)]">
              {Icon.upload}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{uploadMsg || 'رفع ملف الخطبة'}</span>
              <span className="block text-[12.5px] text-[var(--ui-muted)]">PDF أو Word — اضغط للاختيار أو اسحب الملف إلى الخانة</span>
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onFile(f);
              }}
            />
          </label>
          {uploadError && (
            <p role="alert" className="mt-3 rounded-xl bg-red-950 px-3 py-2 text-sm text-red-200">
              {uploadError}
            </p>
          )}
          {uploadedNote && !uploadMsg && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--ui-ok-soft)] px-3 py-2.5 text-sm text-[var(--ui-ok)]">
              <span className="mt-0.5">{Icon.check}</span>
              <span>
                استُخرج النص من الملف. <b>راجعه في الخانة أعلاه</b> قبل الضبط، فقد يقع خطأ في القراءة.
              </span>
            </p>
          )}

          <div className="mt-6">
            <Segmented<DiacriticsMode>
              label="كثافة التشكيل"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'full', label: 'تشكيل كامل', hint: 'كل الحروف' },
                { value: 'functional', label: 'تشكيل وظيفي', hint: 'أواخر الكلمات ومواضع اللبس' },
              ]}
            />
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-bg-2)] px-4 py-3.5 transition hover:border-[var(--ui-accent)]">
            <input
              type="checkbox"
              checked={spelling}
              onChange={(e) => setSpelling(e.target.checked)}
              className="mt-1 h-5 w-5 flex-none cursor-pointer accent-[var(--ui-accent)]"
            />
            <span>
              <span className="block text-sm font-semibold">تصحيح الإملاء والهمزات</span>
              <span className="mt-0.5 block text-[12.5px] leading-6 text-[var(--ui-muted)]">
                مثل: الى ← إلى، كانو ← كانوا، هاذا ← هذا. أمّا الإعراب فيُصحَّح دائماً.
              </span>
            </span>
          </label>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={process}
            className="ui-btn-primary mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {alreadyDone ? Icon.check : Icon.sparkle}
            {working ? 'جارٍ الضبط والتنسيق…' : alreadyDone ? 'تمّ ضبط الخطبة' : 'اضبط الخطبة ونسّقها'}
          </button>
          {alreadyDone && !working && (
            <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--ui-gold)_35%,transparent)] bg-[var(--ui-soft)] px-4 py-4 text-center">
              <span className="text-[var(--ui-gold)] [&>svg]:h-7 [&>svg]:w-7">{Icon.clock}</span>
              <span>
                <span className="block text-2xl font-bold text-[var(--ui-gold)] sm:text-3xl">{speechTime(wordCount)}</span>
                <span className="mt-1 block text-[13px] text-[var(--ui-muted)]">
                  مدة قراءة الخطبة على المنبر تقريباً ({wordCount.toLocaleString('ar-SA')} كلمة)
                </span>
              </span>
            </div>
          )}
          {alreadyDone && !working && (
            <p className="mt-2 text-center text-[13px] leading-6 text-[var(--ui-muted)]">
              لإعادة الضبط عدّل نص الخطبة أو غيّر كثافة التشكيل أو خيار الإملاء. أما العنوان واسم الخطيب فتعديلهما يظهر مباشرة.
            </p>
          )}

          {status.kind === 'working' && (
            <div aria-live="polite" className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-2)]">
                <div
                  className="ui-progress-bar h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(8, (status.done / status.total) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-center text-[13px] text-[var(--ui-muted)]">
                اكتمل {status.done.toLocaleString('ar-SA')} من {status.total.toLocaleString('ar-SA')} أجزاء — يستغرق بضع ثوانٍ، أسعدكم الله.
              </p>
            </div>
          )}
          {status.kind === 'error' && (
            <p role="alert" className="mt-4 rounded-xl border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-200">
              {status.message}
            </p>
          )}
        </section>

        {/* ========== ٢) المعاينة والتحميل ========== */}
        <section ref={resultRef} className="min-w-0 space-y-6 scroll-mt-20">
          <div className="ui-card p-5 sm:p-7">
            <StepTitle n="٢">الشكل والتحميل</StepTitle>
            <div className="grid gap-5 sm:grid-cols-2">
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
                  { value: 'maroon', label: 'ملون' },
                  { value: 'bw', label: 'أسود وأبيض' },
                ]}
              />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!doc || !!exporting}
                onClick={() => exportFile('pdf')}
                className="ui-btn-primary flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold transition disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {Icon.doc}
                {exporting === 'pdf' ? 'جارٍ التجهيز…' : 'تحميل PDF'}
              </button>
              <button
                type="button"
                disabled={!doc || !!exporting}
                onClick={() => exportFile('docx')}
                className="flex items-center justify-center gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-card)] px-4 py-3 font-bold transition hover:border-[var(--ui-accent)] hover:text-[var(--ui-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {Icon.doc}
                {exporting === 'docx' ? 'جارٍ التجهيز…' : 'تحميل Word'}
              </button>
            </div>
            {exportError && <p className="mt-3 text-sm text-red-300">{exportError}</p>}
          </div>

          {doc && (doc.corrections.length > 0 || doc.warnings.length > 0) && (
            <div className="ui-card space-y-5 p-5 sm:p-7">
              {doc.corrections.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 font-bold">
                    التصحيحات
                    <span className="rounded-full bg-[var(--ui-soft)] px-2.5 py-0.5 text-xs text-[var(--ui-accent)]">
                      {doc.corrections.length.toLocaleString('ar-SA')}
                    </span>
                  </h3>
                  <ul className="grid gap-2 text-sm sm:grid-cols-2">
                    {doc.corrections.map((c, i) => (
                      <li key={i} className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-bg)] px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                              c.type === 'imla' ? 'bg-[var(--ui-bg-2)] text-[var(--ui-muted)]' : 'bg-[var(--ui-soft)] text-[var(--ui-accent)]'
                            }`}
                          >
                            {c.type === 'imla' ? 'إملائي' : 'إعرابي'}
                          </span>
                          <span className="text-[var(--ui-muted)] line-through">{c.original}</span>
                          <span className="text-[var(--ui-muted)]">صارت</span>
                          <span className="font-bold text-[var(--ui-accent)]">{c.corrected}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">{c.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doc.warnings.length > 0 && (
                <div>
                  <h3 className="mb-2 font-bold">ملاحظات</h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-[var(--ui-muted)]">
                    {doc.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-[1.25rem] border border-[var(--ui-line)] bg-[var(--ui-bg-2)] p-4 sm:p-7">
            {doc ? (
              <Preview doc={doc} layout={layout} color={color} />
            ) : (
              <div className="grid min-h-[460px] place-items-center text-center">
                <div className="max-w-xs">
                  <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[var(--ui-card)] text-[var(--ui-accent)] shadow-[var(--ui-shadow)]">
                    <span className="h-7 w-7">{Icon.doc}</span>
                  </div>
                  <p className="text-lg font-bold">ستظهر هنا معاينة الخطبة</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--ui-muted)]">
                    أدخل العنوان والنص، ثم اضغط «اضبط الخطبة ونسّقها»، وغيّر المقاس والألوان كما تحب قبل التحميل.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--ui-line)]">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-2 px-4 py-6 text-[13px] text-[var(--ui-muted)] sm:px-6">
          <span>منسّق الخطب — خدمة مجانية لخطباء الجمعة</span>
          <span>نص المصحف من Tanzil (رواية حفص)</span>
        </div>
      </footer>
    </div>
  );
}
