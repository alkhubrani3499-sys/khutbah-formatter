'use client';

import { useEffect, useState } from 'react';

// دعوة تثبيت التطبيق (PWA):
// - نافذة منبثقة بعد ٥ ثوانٍ من الدخول (لا أثناء الضبط)، و«لاحقاً» يؤجّلها ٧ أيام
// - شريط صغير دائم تحت الشريط العلوي لمن أجّل النافذة (و✕ يخفيه نهائياً)
// على الأندرويد وكروم الكمبيوتر يثبّت بضغطة، وعلى الآيفون يعرض خطوات Safari.
// لا يظهر شيء إن كان التطبيق مثبّتاً أو المتصفح لا يدعم التثبيت.

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STRIP_KEY = 'minbar-install-dismissed';
const POPUP_KEY = 'minbar-install-popup-snooze';
const POPUP_DELAY_MS = 5000;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export default function InstallApp({ busy = false }: { busy?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true); // حتى نتحقق في المتصفح
  const [strip, setStrip] = useState(false);
  const [popupDue, setPopupDue] = useState(false); // مرّت المهلة ولم تُؤجَّل
  const [popup, setPopup] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    // عامل الخدمة: على الموقع المنشور فقط (في التطوير يحفظ ملفات قديمة فيعطّل التحديث الفوري)
    if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    setInstalled(false);
    setStrip(store.get(STRIP_KEY) !== '1');
    const snoozedAt = Number(store.get(POPUP_KEY) || 0);
    const timer = Date.now() - snoozedAt > SNOOZE_MS ? setTimeout(() => setPopupDue(true), POPUP_DELAY_MS) : undefined;

    const ua = navigator.userAgent;
    setIos(/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const available = !installed && (!!prompt || ios);

  // تظهر النافذة متى اجتمع: مرور المهلة، وإمكان التثبيت، وألّا يكون الخطيب في أثناء الضبط
  useEffect(() => {
    if (popupDue && available && !busy) {
      setPopup(true);
      setPopupDue(false);
    }
  }, [popupDue, available, busy]);

  if (!available) return null;

  const install = async () => {
    setPopup(false);
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } else setSteps(true);
  };
  const later = () => {
    store.set(POPUP_KEY, String(Date.now()));
    setPopup(false);
  };
  const hideStrip = () => {
    store.set(STRIP_KEY, '1');
    setStrip(false);
  };

  const num = (n: string) => (
    <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--ui-soft)] text-sm font-bold text-[var(--ui-accent)]">
      {n}
    </span>
  );

  return (
    <>
      {strip && (
        <div className="border-b border-[var(--ui-line)] bg-[var(--ui-soft)]">
          <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 sm:px-6">
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 flex-none rounded-lg" />
            <span className="min-w-0 flex-1 text-[13.5px] leading-6">
              <b>ثبّت «منسّق الخطب» على جوالك</b>
              <span className="hidden text-[var(--ui-muted)] sm:inline"> — يفتح من الشاشة الرئيسية كأي تطبيق، مجاناً.</span>
            </span>
            <button type="button" onClick={install} className="ui-btn-primary flex-none rounded-full px-4 py-1.5 text-sm font-bold">
              تثبيت
            </button>
            <button
              type="button"
              onClick={hideStrip}
              aria-label="إغلاق"
              className="flex-none rounded-full p-1.5 text-[var(--ui-muted)] transition hover:text-[var(--ui-ink)]"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M5.3 5.3a1 1 0 011.4 0L10 8.6l3.3-3.3a1 1 0 111.4 1.4L11.4 10l3.3 3.3a1 1 0 01-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 01-1.4-1.4L8.6 10 5.3 6.7a1 1 0 010-1.4z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* النافذة المنبثقة */}
      {popup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={later}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            className="ui-card w-full max-w-sm p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img src="/icons/icon-192.png" alt="" className="mx-auto h-20 w-20 rounded-[22px] shadow-[var(--ui-shadow)]" />
            <h2 id="install-title" className="mt-4 text-xl font-bold">
              ثبّت «منسّق الخطب» على جوالك
            </h2>
            <ul className="mx-auto mt-4 max-w-[17rem] space-y-2 text-right text-[15px] leading-7">
              {['يفتح من الشاشة الرئيسية كأي تطبيق', 'أسرع، وبملء الشاشة', 'مجاني، ولا يحتاج متجر التطبيقات'].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-[var(--ui-ok-soft)] text-[var(--ui-ok)]">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <button type="button" onClick={install} className="ui-btn-primary mt-6 w-full rounded-2xl py-3.5 text-lg font-bold">
              تثبيت التطبيق
            </button>
            <button
              type="button"
              onClick={later}
              className="mt-2 w-full rounded-2xl py-2.5 text-[15px] text-[var(--ui-muted)] transition hover:text-[var(--ui-ink)]"
            >
              لاحقاً
            </button>
          </div>
        </div>
      )}

      {/* خطوات الآيفون */}
      {steps && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setSteps(false)}>
          <div className="ui-card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">تثبيت التطبيق على الآيفون</h2>
            <ol className="mt-4 space-y-3 text-[15px] leading-7">
              <li className="flex gap-3">
                {num('١')}
                <span>
                  افتح الموقع في متصفح <b>Safari</b>، واضغط زر المشاركة{' '}
                  <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-4px] text-[var(--ui-accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="مشاركة">
                    <path d="M12 3v12M12 3l-4 4M12 3l4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>{' '}
                  أسفل الشاشة.
                </span>
              </li>
              <li className="flex gap-3">
                {num('٢')}
                <span>
                  اختر <b>«إضافة إلى الشاشة الرئيسية»</b>.
                </span>
              </li>
              <li className="flex gap-3">
                {num('٣')}
                <span>
                  اضغط <b>«إضافة»</b>، فتظهر أيقونة «مِنْبَر» بين تطبيقاتك.
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
