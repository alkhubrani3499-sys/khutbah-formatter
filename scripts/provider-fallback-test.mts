// اختبار الرجوع من Claude إلى Gemini: مفتاح Claude غير صالح عمداً، ومفتاح Gemini من .env.local
// الاستخدام: npx tsx scripts/provider-fallback-test.mts   (يستهلك طلباً واحداً من حصة Gemini)
import fs from 'node:fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^(GEMINI_API_KEY)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
}
process.env.ANTHROPIC_API_KEY = 'sk-ant-invalid-for-test';
delete process.env.LLM_PROVIDER;

const { PROVIDER, diacritizeChunk } = await import('@/lib/server/llm');
console.log('المزوّد الأساسي:', PROVIDER);
const out = await diacritizeChunk([{ id: 0, text: 'إن المسلمون إخوة' }], 'full');
const ok = out.paragraphs[0]?.marked && /[ً-ْ]/.test(out.paragraphs[0].marked);
console.log(ok ? '✓' : '✗', 'رجع إلى Gemini وشكّل النص:', out.paragraphs[0]?.marked);
process.exit(ok ? 0 : 1);
