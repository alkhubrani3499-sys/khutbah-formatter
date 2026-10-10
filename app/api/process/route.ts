import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';
import { z } from 'zod';
import { MAX_WORDS, refundQuota, takeQuota, visitorId } from '@/lib/server/limits';
import { processKhutbah } from '@/lib/server/process';
import type { ProcessEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  text: z.string().min(1).max(60_000),
  title: z.string().trim().min(1).max(200),
  preacher: z.string().max(120).optional(),
  mode: z.enum(['full', 'functional']),
  spelling: z.boolean().optional(),
});

function friendly(err: unknown): string {
  if (err instanceof GeminiApiError) {
    if (err.status === 503 || err.status === 500) return 'خدمة الضبط مزدحمة الآن، يُرجى المحاولة بعد دقائق.';
    if (err.status === 429) return 'بلغت خدمة الضبط حدّها المجاني مؤقتاً، يُرجى المحاولة بعد قليل أو غداً إن شاء الله.';
    if (err.status === 400 && /api key/i.test(err.message)) return 'مفتاح Gemini غير صالح على الخادم.';
    if (err.status === 403) return 'مفتاح Gemini لا يملك صلاحية لهذه الخدمة.';
    return `خطأ من خدمة التشكيل (${err.status}).`;
  }
  if (err instanceof Anthropic.AuthenticationError) return 'مفتاح Claude API غير صالح أو غير مضبوط على الخادم.';
  if (err instanceof Anthropic.RateLimitError) return 'الخدمة مشغولة حالياً، حاول بعد قليل.';
  // نفاد رصيد المفتاح: يُرجع API خطأ 400 برسالة عن رصيد الحساب
  if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message))
    return 'خدمة الضبط متوقفة مؤقتاً لنفاد الرصيد، يُرجى المحاولة لاحقاً إن شاء الله.';
  if (err instanceof Anthropic.APIError) return `خطأ من خدمة التشكيل (${err.status}).`;
  if (err instanceof Error && /authentication method|api ?key must be set|apiKey/i.test(err.message))
    return 'الخدمة غير مهيأة بعد على الخادم (لم يُضبط مفتاح النموذج).';
  return err instanceof Error ? err.message : 'حدث خطأ غير متوقع.';
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'بيانات غير مكتملة: العنوان والنص مطلوبان.' }, { status: 400 });
  const { text, title, preacher, mode, spelling } = parsed.data;

  const words = text.trim().split(/\s+/).length;
  if (MAX_WORDS && words > MAX_WORDS)
    return Response.json({ error: `الخطبة أطول من الحد المسموح (${MAX_WORDS} كلمة).` }, { status: 413 });
  const visitor = visitorId(req);
  const denied = takeQuota(visitor);
  if (denied) return Response.json({ error: denied }, { status: 429 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ProcessEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        const doc = await processKhutbah(text, { title, preacher, mode, spelling }, (done, total) =>
          send({ type: 'progress', done, total }),
        );
        send({ type: 'result', doc });
      } catch (err) {
        console.error(err);
        refundQuota(visitor);
        send({ type: 'error', message: friendly(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
