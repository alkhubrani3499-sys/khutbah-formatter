// يجرّب طلباً صغيراً على نماذج Gemini ويطبع تفاصيل الرفض إن حدث (لا يطبع المفتاح)
// الاستخدام: node scripts/gemini-quota.mjs [--thinking=N] نموذج1 نموذج2 ...
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = fs.readFileSync('.env.local', 'utf8');
const apiKey = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim();
const ai = new GoogleGenAI({ apiKey });
const args = process.argv.slice(2);
const thinkingArg = args.find((a) => a.startsWith('--thinking='));
const models = args.filter((a) => !a.startsWith('--'));
const config = thinkingArg ? { thinkingConfig: { thinkingBudget: Number(thinkingArg.split('=')[1]) } } : {};

for (const model of models.length ? models : ['gemini-flash-latest']) {
  try {
    const r = await ai.models.generateContent({ model, contents: 'قل: نعم', config });
    console.log(`✓ ${model}: ${r.text?.trim()} (${r.modelVersion ?? ''})`);
  } catch (e) {
    console.log(`✗ ${model}: ${e.status ?? ''} ${String(e.message || e).replace(/\s+/g, ' ').slice(0, 260)}`);
  }
}
