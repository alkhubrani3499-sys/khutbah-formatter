// قياس تكلفة Claude وجودته على نص خطبة
// الاستخدام: npx tsx scripts/measure-claude.mts <raw.txt> <out.json> [effort]
import fs from 'node:fs';

const [rawPath, out, effort] = process.argv.slice(2);
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
}
process.env.LLM_PROVIDER = 'claude';
if (effort) process.env.CLAUDE_EFFORT = effort;
delete process.env.GEMINI_API_KEY; // بلا رجوع إلى Gemini: نقيس Claude وحده

// جمع التكلفة من سطور السجل
let cost = 0, inTok = 0, outTok = 0;
const orig = console.info;
console.info = (...a: unknown[]) => {
  const s = a.join(' ');
  const m = s.match(/دخل=(\d+) خرج=(\d+).*\$([\d.]+)/);
  if (m) { inTok += +m[1]; outTok += +m[2]; cost += +m[3]; }
  orig(...a);
};

const { processKhutbah } = await import('@/lib/server/process');
const t0 = Date.now();
const doc = await processKhutbah(fs.readFileSync(rawPath, 'utf8'), { title: 'قياس', mode: 'full', spelling: true }, () => {});
fs.writeFileSync(out, JSON.stringify(doc));
const textChars = doc.blocks.flatMap((b) => b.segs.map((s) => s.t)).join(' ').length;
console.log(
  `\n== الجهد ${process.env.CLAUDE_EFFORT}: ${((Date.now() - t0) / 1000).toFixed(0)}ث | دخل ${inTok} | خرج ${outTok} | التكلفة ≈ $${cost.toFixed(4)} (${(cost * 100).toFixed(2)} سنت) | حروف الناتج ${textChars}`,
);
console.log('تصحيحات:', doc.corrections.filter((c) => c.type !== 'imla').map((c) => `${c.original}←${c.corrected}`).join('، '));
process.exit(0);
