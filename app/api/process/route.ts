import { z } from 'zod';
import { friendly } from '@/lib/server/errors';
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
