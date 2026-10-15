// يشغّل محرك الضبط على نموذج Gemini محدد (لمقارنة جودة النماذج)
// الاستخدام: npx tsx scripts/run-model.ts <النموذج> <raw.txt> <out.json>
import fs from 'node:fs';

const [model, rawPath, out] = process.argv.slice(2);
// تحميل المفاتيح من .env.local قبل استيراد المحرك (يقرأ المزوّد عند التحميل)
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim();
}
process.env.GEMINI_MODELS = model;
process.env.LLM_PROVIDER = 'gemini';

const { processKhutbah } = await import('@/lib/server/process');
const t0 = Date.now();
const doc = await processKhutbah(fs.readFileSync(rawPath, 'utf8'), { title: 'تجربة', mode: 'full' }, () => {});
fs.writeFileSync(out, JSON.stringify(doc));
console.log(
  `${model}: ${((Date.now() - t0) / 1000).toFixed(0)}s | تصحيحات: ${doc.corrections.map((c) => `${c.original}←${c.corrected}`).join('، ') || 'لا شيء'}`,
);
