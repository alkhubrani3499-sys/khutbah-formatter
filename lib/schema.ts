import { z } from 'zod';

// التحقق من المستند المرسل من المتصفح إلى واجهات التصدير
export const DocSchema = z.object({
  title: z.string().max(200),
  preacher: z.string().max(120).optional(),
  blocks: z
    .array(
      z.object({
        kind: z.enum(['heading', 'lead', 'bullet', 'para', 'closing']),
        segs: z
          .array(
            z.object({
              k: z.enum(['text', 'emph', 'lead', 'quran', 'hadith']),
              t: z.string().max(20_000),
              ref: z.string().max(40).optional(),
            }),
          )
          .max(2000),
      }),
    )
    .max(2000),
  corrections: z
    .array(
      z.object({
        original: z.string(),
        corrected: z.string(),
        reason: z.string(),
        type: z.enum(['i3rab', 'imla']).optional(),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export const ExportSchema = z.object({
  doc: DocSchema,
  layout: z.enum(['a4', 'mobile']),
  color: z.enum(['maroon', 'bw']),
});

/** اسم ملف آمن مشتق من العنوان */
export const fileName = (title: string, layout: string, color: string, ext: string) => {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 80) || 'خطبة';
  const tag = `${layout === 'mobile' ? 'جوال' : 'A4'}-${color === 'bw' ? 'أسود' : 'ملون'}`;
  return `${base} - ${tag}.${ext}`;
};

export const contentDisposition = (name: string) =>
  `attachment; filename="khutbah.${name.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(name)}`;
