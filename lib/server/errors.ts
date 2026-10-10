import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';

/** تحويل أخطاء مزوّدي النماذج إلى رسائل عربية مفهومة للخطيب */
export function friendly(err: unknown): string {
  if (err instanceof GeminiApiError) {
    if (err.status === 503 || err.status === 500) return 'الخدمة مزدحمة الآن، يُرجى المحاولة بعد دقائق.';
    if (err.status === 429) return 'بلغت الخدمة حدّها المجاني مؤقتاً، يُرجى المحاولة بعد قليل أو غداً إن شاء الله.';
    if (err.status === 400 && /api key/i.test(err.message)) return 'مفتاح Gemini غير صالح على الخادم.';
    if (err.status === 403) return 'مفتاح Gemini لا يملك صلاحية لهذه الخدمة.';
    return `خطأ من خدمة الذكاء الاصطناعي (${err.status}).`;
  }
  if (err instanceof Anthropic.AuthenticationError) return 'مفتاح Claude API غير صالح أو غير مضبوط على الخادم.';
  if (err instanceof Anthropic.RateLimitError) return 'الخدمة مشغولة حالياً، حاول بعد قليل.';
  // نفاد رصيد المفتاح: يُرجع API خطأ 400 برسالة عن رصيد الحساب
  if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message))
    return 'الخدمة متوقفة مؤقتاً لنفاد الرصيد، يُرجى المحاولة لاحقاً إن شاء الله.';
  if (err instanceof Anthropic.APIError) return `خطأ من خدمة الذكاء الاصطناعي (${err.status}).`;
  if (err instanceof Error && /authentication method|api ?key must be set|apiKey/i.test(err.message))
    return 'الخدمة غير مهيأة بعد على الخادم (لم يُضبط مفتاح النموذج).';
  if (err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(err.message))
    return 'تعذّر الاتصال بالخدمة، يُرجى المحاولة مرة أخرى.';
  return err instanceof Error ? err.message : 'حدث خطأ غير متوقع.';
}
