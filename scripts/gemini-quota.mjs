// يجرّب طلباً صغيراً على نماذج Gemini ويطبع تفاصيل الحد إن رُفض (لا يطبع المفتاح)
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = fs.readFileSync('.env.local', 'utf8');
const apiKey = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim();
const ai = new GoogleGenAI({ apiKey });
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['gemini-flash-latest'];

for (const model of models) {
  try {
    const r = await ai.models.generateContent({ model, contents: 'قل: نعم' });
    console.log(`✓ ${model}: ${r.text?.trim()} (${r.modelVersion ?? ''})`);
  } catch (e) {
    const msg = String(e.message || e);
    const metric = msg.match(/quotaMetric"?:\s*"([^"]+)/)?.[1];
    const value = msg.match(/quotaValue"?:\s*"([^"]+)/)?.[1];
    const id = msg.match(/quotaId"?:\s*"([^"]+)/)?.[1];
    const retry = msg.match(/retryDelay"?:\s*"([^"]+)/)?.[1];
    console.log(`✗ ${model}: ${e.status ?? ''} ${metric ? `metric=${metric} limit=${value} id=${id} retry=${retry}` : msg.slice(0, 300)}`);
  }
}
