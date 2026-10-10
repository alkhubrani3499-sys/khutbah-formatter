// أدوات نصية عربية مشتركة بين الخادم والمتصفح.

/** الحركات والتنوين والشدة والسكون والخنجرية وعلامات المصحف الصغيرة والتطويل */
export const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export const stripDiacritics = (s: string) => s.replace(DIACRITICS, '');

/** الحروف فقط (لمقارنة «هيكل» الكلمة بعد إزالة الحركات وعلامات الترقيم) */
export const letters = (s: string) => stripDiacritics(s).replace(/[^ء-يٱ-ۓa-zA-Z0-9٠-٩]/g, '');

/** تطبيع أوسع لمطابقة الآيات: توحيد الهمزات والألف المقصورة والتاء المربوطة */
export const normalizeForMatch = (s: string) =>
  letters(s)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

/** تقسيم الكلمة إلى: ترقيم سابق + جوهر + ترقيم لاحق */
const CORE_CHAR = /[ء-يٱ-ۓؐ-ًؚ-ٰٟۖ-ۭـa-zA-Z0-9٠-٩ﷺﷻ]/;
export function splitPunct(tok: string): { pre: string; core: string; post: string } {
  let a = 0;
  let b = tok.length;
  while (a < b && !CORE_CHAR.test(tok[a])) a++;
  while (b > a && !CORE_CHAR.test(tok[b - 1])) b--;
  return { pre: tok.slice(0, a), core: tok.slice(a, b), post: tok.slice(b) };
}

export const toArabicDigits = (n: number | string) =>
  String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

/** تقطيع النص الخام إلى كلمات (المسافات فقط) */
export const words = (s: string) => s.split(/\s+/).filter(Boolean);
