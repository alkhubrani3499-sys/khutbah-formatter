'use client';

import { useEffect, useState } from 'react';

// شريط «ثبّت التطبيق»: على الأندرويد (وكروم الكمبيوتر) يثبّت بضغطة، وعلى الآيفون يعرض خطوات Safari.
// لا يظهر إن كان التطبيق مثبّتاً أو أغلقه الخطيب من قبل.

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'minbar-install-dismissed';

export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    // عامل الخدمة: على الموقع المنشور فقط (في التطوير يحفظ ملفات قديمة فيعطّل التحديث الفوري)
    if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {}
    if (standalone || dismissed) return;

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (isIos) {
      setIos(true);
      setHidden(false);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || (!prompt && !ios)) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setHidden(true);
      setPrompt(null);
    } else setSteps(true);
  };
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setHidden(true);
  };

  return (
    <>
      <div className="border-b border-[var(--ui-line)] bg-[var(--ui-soft)]">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="h-8 w-8 flex-none overflow-hidden rounded-lg">
            <img src="/icons/icon-192.png" alt="" className="h-full w-full" />
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] leading-6">
            <b>ثبّت «منسّق الخطب» على جوالك</b>
            <span className="hidden text-[var(--ui-muted)] sm:inline"> — يفتح من الشاشة الرئيسية كأي تطبيق، مجاناً.</span>
          </span>
          <button
            type="button"
            onClick={install}
            className="ui-btn-primary flex-none rounded-full px-4 py-1.5 text-sm font-bold"
          >
            تثبيت
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="إغلاق"
            className="flex-none rounded-full p-1.5 text-[var(--ui-muted)] transition hover:text-[var(--ui-ink)]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M5.3 5.3a1 1 0 011.4 0L10 8.6l3.3-3.3a1 1 0 111.4 1.4L11.4 10l3.3 3.3a1 1 0 01-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 01-1.4-1.4L8.6 10 5.3 6.7a1 1 0 010-1.4z" />
            </svg>
          </button>
        </div>
      </div>

      {steps && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setSteps(false)}
        >
          <div className="ui-card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">تثبيت التطبيق على الآيفون</h2>
            <ol className="mt-4 space-y-3 text-[15px] leading-7">
              <li className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--ui-soft)] text-sm font-bold text-[var(--ui-accent)]">١</span>
                <span>
                  افتح الموقع في متصفح <b>Safari</b>، واضغط زر المشاركة{' '}
                  <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-4px] text-[var(--ui-accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="مشاركة">
                    <path d="M12 3v12M12 3l-4 4M12 3l4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>{' '}
                  أسفل الشاشة.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--ui-soft)] text-sm font-bold text-[var(--ui-accent)]">٢</span>
                <span>
                  اختر <b>«إضافة إلى الشاشة الرئيسية»</b>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--ui-soft)] text-sm font-bold text-[var(--ui-accent)]">٣</span>
                <span>
                  اضغط <b>«إضافة»</b>، فتظهر أيقونة المنبر بين تطبيقاتك.
                </span>
              </li>
            </ol>
            <button type="button" onClick={() => setSteps(false)} className="ui-btn-primary mt-6 w-full rounded-2xl py-3 font-bold">
              حسناً
            </button>
          </div>
        </div>
      )}
    </>
  );
}
