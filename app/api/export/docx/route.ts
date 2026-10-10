import { ExportSchema, contentDisposition, fileName } from '@/lib/schema';
import { buildDocx } from '@/lib/server/docx';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const parsed = ExportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'مستند غير صالح.' }, { status: 400 });
  const { doc, layout, color } = parsed.data;
  try {
    const buf = await buildDocx(doc, { layout, color });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': contentDisposition(fileName(doc.title, layout, color, 'docx')),
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'تعذّر توليد ملف Word.' }, { status: 500 });
  }
}
