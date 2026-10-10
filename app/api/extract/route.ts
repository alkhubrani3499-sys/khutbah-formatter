import { z } from 'zod';
import { friendly } from '@/lib/server/errors';
import { takeExtractQuota, visitorId } from '@/lib/server/limits';
import { extractFromImages } from '@/lib/server/llm';

export const runtime = 'nodejs';
export const maxDuration = 120;

// صور صفحات PDF (JPEG base64) — يرسلها المتصفح دفعات صغيرة لتبقى تحت حد حجم الطلب في Vercel (4.5MB)
const Body = z.object({
  images: z.array(z.string().max(1_500_000)).min(1).max(4),
  first: z.boolean(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'ملف غير صالح أو صفحات كثيرة في طلب واحد.' }, { status: 400 });
  const denied = takeExtractQuota(visitorId(req));
  if (denied) return Response.json({ error: denied }, { status: 429 });
  try {
    const out = await extractFromImages(parsed.data.images, parsed.data.first);
    return Response.json(out);
  } catch (err) {
    console.error(err);
    return Response.json({ error: friendly(err) }, { status: 502 });
  }
}
