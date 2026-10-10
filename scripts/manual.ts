// أداة للتجربة بلا مفتاح API: تشكيل يدوي يُمرَّر على المحرك نفسه.
//   npx tsx scripts/manual.ts list  <raw.txt>                      ← طباعة الفقرات المرقَّمة
//   npx tsx scripts/manual.ts build <raw.txt> <llm.json> <out.json> "<العنوان>" ["<الخطيب>"]
// llm.json بصيغة مخرج النموذج: { paragraphs: [{id, kind, marked}], corrections: [...] }
import fs from 'node:fs';
import { assemble, prepare } from '@/lib/server/process';

const [cmd, rawPath, llmPath, outPath, title, preacher] = process.argv.slice(2);
const paras = prepare(fs.readFileSync(rawPath, 'utf8'));

if (cmd === 'list') {
  for (const p of paras) console.log(`[${p.id}]${p.hint ? ` (${p.hint})` : ''} ${p.text}`);
} else {
  const llm = JSON.parse(fs.readFileSync(llmPath, 'utf8'));
  const results = new Map(llm.paragraphs.map((p: { id: number }) => [p.id, p]));
  const out = assemble(paras, results as never, llm.corrections ?? []);
  fs.writeFileSync(outPath, JSON.stringify({ title, preacher: preacher || undefined, ...out }));
  console.log(`فقرات: ${out.blocks.length}، تصحيحات: ${out.corrections.length}`);
  for (const c of out.corrections) console.log('  تصحيح:', c.original, '←', c.corrected);
  for (const w of out.warnings) console.log('  ملاحظة:', w);
  const quran = out.blocks.flatMap((b) => b.segs.filter((s) => s.k === 'quran'));
  for (const q of quran) console.log('  آية', q.ref);
}
