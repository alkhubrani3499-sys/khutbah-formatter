// حدود الاستخدام لحماية رصيد المفتاح عند النشر العام (في ذاكرة الخادم؛ تُصفَّر بإعادة تشغيله).
const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) && +v >= 0 ? +v : d);

/** عدد الخطب المسموح لكل زائر في اليوم (0 = بلا حد) */
export const PER_VISITOR_DAILY = num(process.env.LIMIT_PER_VISITOR_DAILY, 5);
/** مجموع الخطب المسموح للموقع كله في اليوم (0 = بلا حد) */
export const GLOBAL_DAILY = num(process.env.LIMIT_GLOBAL_DAILY, 300);
/** أقصى عدد كلمات للخطبة الواحدة */
export const MAX_WORDS = num(process.env.LIMIT_MAX_WORDS, 5000);

let day = '';
let globalCount = 0;
const perVisitor = new Map<string, number>();

function rollover() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    globalCount = 0;
    perVisitor.clear();
  }
}

export function visitorId(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || 'local';
}

/** يحجز محاولة؛ يعيد رسالة خطأ إن تجاوز الحد، أو null إن سُمح */
export function takeQuota(visitor: string): string | null {
  rollover();
  const used = perVisitor.get(visitor) ?? 0;
  if (PER_VISITOR_DAILY && used >= PER_VISITOR_DAILY)
    return `بلغتَ الحد اليومي (${PER_VISITOR_DAILY} خطب). يمكنك المحاولة غداً إن شاء الله.`;
  if (GLOBAL_DAILY && globalCount >= GLOBAL_DAILY)
    return 'بلغ الموقع حدّه اليومي من الخطب، يُرجى المحاولة غداً إن شاء الله.';
  perVisitor.set(visitor, used + 1);
  globalCount++;
  return null;
}

/** إرجاع المحاولة عند فشل المعالجة حتى لا تُحتسب على الزائر */
export function refundQuota(visitor: string) {
  const used = perVisitor.get(visitor) ?? 0;
  if (used > 0) perVisitor.set(visitor, used - 1);
  if (globalCount > 0) globalCount--;
}
