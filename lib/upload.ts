// قراءة ملف خطبة في المتصفح: Word و نص مباشرةً، و PDF بتحويل صفحاته إلى صور يقرؤها النموذج.
// (نسخ النص العربي من PDF يخرج غالباً مقلوباً أو مشوّهاً، فالقراءة البصرية أدق)

const MAX_PAGES = 30;
const PAGES_PER_BATCH = 2; // صفحات أكثر في الطلب الواحد تجعل النموذج يُسقط أسطراً
const PAGE_WIDTH = 1400; // عرض صورة الصفحة بالبكسل
const MAX_BATCH_BYTES = 3_000_000; // حد طلب Vercel 4.5MB
const PARALLEL = 3;

export interface Extracted {
  title: string;
  text: string;
}

export async function extractFile(file: File, onProgress: (msg: string) => void): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt')) return { title: '', text: await file.text() };
  if (name.endsWith('.docx')) {
    onProgress('جارٍ قراءة ملف Word…');
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { title: '', text: value.replace(/\n{3,}/g, '\n\n').trim() };
  }
  if (name.endsWith('.doc')) throw new Error('صيغة Word القديمة (.doc) غير مدعومة؛ احفظ الملف بصيغة .docx أو PDF.');
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdf(file, onProgress);
  throw new Error('الملف غير مدعوم. الصيغ المدعومة: PDF و Word (.docx) و نص (.txt).');
}

async function extractPdf(file: File, onProgress: (msg: string) => void): Promise<Extracted> {
  onProgress('جارٍ فتح ملف PDF…');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (doc.numPages > MAX_PAGES) throw new Error(`الملف طويل (${doc.numPages} صفحة)؛ الحد الأقصى ${MAX_PAGES} صفحة.`);

  // 1) تحويل الصفحات إلى صور JPEG
  // الورقة العرضية تحمل غالباً صفحتين متجاورتين (طباعة كتيّب)، فتُقسم نصفين: الأيمن أولاً ثم الأيسر،
  // وكل نصف بدقة صفحة كاملة؛ وإلا صغر الخط فأسقط النموذج أسطراً أو أخطأ في الكلمات
  const images: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress(`جارٍ تجهيز الصفحة ${i} من ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const spread = base.width > base.height * 1.15;
    const viewport = page.getViewport({ scale: Math.min(3, (spread ? 2 * PAGE_WIDTH : PAGE_WIDTH) / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent: 'print' يرسم دون requestAnimationFrame، فلا يتوقف إن انتقل الخطيب إلى تبويب آخر
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    if (!spread) {
      images.push(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
      continue;
    }
    const half = Math.ceil(canvas.width / 2);
    for (const x of [canvas.width - half, 0]) {
      const part = document.createElement('canvas');
      part.width = half;
      part.height = canvas.height;
      part.getContext('2d')!.drawImage(canvas, x, 0, half, canvas.height, 0, 0, half, canvas.height);
      images.push(part.toDataURL('image/jpeg', 0.82).split(',')[1]);
    }
  }

  // 2) تقسيمها دفعات صغيرة
  const batches: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const img of images) {
    if (cur.length && (cur.length >= PAGES_PER_BATCH || size + img.length > MAX_BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(img);
    size += img.length;
  }
  if (cur.length) batches.push(cur);

  // 3) إرسالها للخادم بالتوازي مع الحفاظ على الترتيب
  const results: Extracted[] = new Array(batches.length);
  let next = 0;
  let done = 0;
  onProgress(`جارٍ قراءة النص (0 من ${images.length} صفحة)…`);
  const worker = async () => {
    while (next < batches.length) {
      const k = next++;
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: batches[k], first: k === 0 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? 'تعذّر استخراج النص من الملف.');
      results[k] = data;
      done += batches[k].length;
      onProgress(`جارٍ قراءة النص (${done} من ${images.length} صفحة)…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));

  return {
    title: results[0]?.title?.trim() ?? '',
    text: results.map((r) => r.text.trim()).filter(Boolean).join('\n'),
  };
}
